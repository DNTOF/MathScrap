//! comer-native parity runner.
//!
//! Loads the TS-captured fixtures (crates/comer-native/fixtures/fixtures.json —
//! produced by diagnostics/baseline.ts with onnxruntime-web) and checks the
//! native pipeline at two surfaces:
//!   1. decode-level: raw token latex + model confidence (rounds 1–2),
//!   2. full-text level: bind/sigma/repair/agree post-processing output
//!      `{text, confidence}` — the exact surface `recognizeStrokes` returns to
//!      the app (round 3).

use comer_native::decode::{Session, Tensor, TensorData};
use comer_native::engine::recognize_strokes;
use comer_native::preprocess::{is_ink_meaningful, preprocess_strokes};
use comer_native::source::Vocab;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(serde::Deserialize)]
struct Dims {
    height: usize,
    width: usize,
}

#[derive(serde::Deserialize)]
struct Expected {
    latex: String,
    conf: f64,
}

#[derive(serde::Deserialize)]
struct TextCand {
    text: String,
    confidence: f64,
}

#[derive(serde::Deserialize)]
struct Fixture {
    name: String,
    strokes: Vec<comer_native::preprocess::Stroke>,
    dims: Dims,
    #[serde(rename = "tensorSum")]
    tensor_sum: f64,
    #[serde(rename = "tensorAbsSum")]
    tensor_abs_sum: f64,
    #[serde(rename = "maskSum")]
    mask_sum: f64,
    expected: Vec<Expected>,
    #[serde(default)]
    tensor: Option<Vec<f32>>,
    #[serde(default)]
    text: Vec<TextCand>,
}

#[derive(serde::Deserialize)]
struct FixtureFile {
    runtime: String,
    #[serde(rename = "vocabSize")]
    vocab_size: usize,
    fixtures: Vec<Fixture>,
}

fn arg_value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn engine_name() -> &'static str {
    #[cfg(feature = "ort")]
    {
        "ort (ONNX Runtime native)"
    }
    #[cfg(all(feature = "tract", not(feature = "ort")))]
    {
        "tract-onnx"
    }
    #[cfg(not(any(feature = "ort", feature = "tract")))]
    {
        "none"
    }
}

fn build_sessions(models: &Path, decoder_file: &str, pad_len: usize, pad: i64) -> Result<(Box<dyn Session>, Box<dyn Session>, Vec<(String, u128)>), Box<dyn Error>> {
    #[cfg(feature = "ort")]
    {
        let _ = (pad_len, pad);
        let enc = comer_native::ort_engine::OrtSession::load(&models.join("encoder_int8.onnx"))?;
        let dec = comer_native::ort_engine::OrtSession::load(&models.join(decoder_file))?;
        Ok((Box::new(enc), Box::new(dec), Vec::new()))
    }
    #[cfg(all(feature = "tract", not(feature = "ort")))]
    {
        let _ = decoder_file;
        let enc = comer_native::tract_engine::TractSession::load_encoder(&models.join("encoder_int8.onnx"));
        let dec = comer_native::tract_engine::TractSession::load_decoder(&models.join("decoder_int8.onnx"), pad_len, pad);
        Ok((Box::new(enc), Box::new(dec), Vec::new()))
    }
    #[cfg(not(any(feature = "ort", feature = "tract")))]
    {
        Err("no engine feature enabled: build with --features ort or --features tract".into())
    }
}

fn main() {
    if let Some(name) = arg_value("--dump-beam") {
        if let Err(e) = dump_beam(&name, arg_value("--prefix").unwrap_or_else(|| "a ^ { 2 } = b".into())) {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
        return;
    }
    if let Err(e) = run() {
        eprintln!("error: {e}");
        let mut src: Option<&dyn Error> = e.source();
        while let Some(s) = src {
            eprintln!("  caused by: {s}");
            src = s.source();
        }
        std::process::exit(1);
    }
}

/// Round-4 diagnostic: per-step top-6 next-token logits for a fixed prefix —
/// the same surface as diagnostics/beam-dump.ts (onnxruntime-web), used to
/// locate the backend disagreement behind the near-tie beam reshuffle.
fn dump_beam(name: &str, prefix: String) -> Result<(), Box<dyn Error>> {
    let models = PathBuf::from(arg_value("--models").unwrap_or_else(|| "public/models/comer".into()));
    let fixtures_path = PathBuf::from(arg_value("--fixtures").unwrap_or_else(|| "crates/comer-native/fixtures/fixtures.json".into()));
    let file: FixtureFile = serde_json::from_str(&std::fs::read_to_string(&fixtures_path)?)?;
    let vocab = Vocab::load(&models.join("vocab.json"))?;
    let (mut encoder, mut decoder, _) = build_sessions(&models, "decoder_int8.onnx", 41, vocab.special_tokens.pad)?;

    let fixture = file
        .fixtures
        .iter()
        .find(|f| f.name == name || f.name == format!("{name}-w3") || f.name == format!("{name}-w5"))
        .ok_or_else(|| format!("fixture {name} not found"))?;
    let image = preprocess_strokes(&fixture.strokes);
    let pixel = Tensor { dims: vec![1, 1, image.height, image.width], data: TensorData::F32(image.tensor) };
    let mask = Tensor { dims: vec![1, image.height, image.width], data: TensorData::U8(image.mask) };
    let encoded = encoder.run(vec![("pixel_values", pixel), ("pixel_mask", mask)])?;
    let mut features = None;
    let mut enc_mask = None;
    for (n, t) in encoded {
        match n.as_str() {
            "encoder_features" => features = Some(t),
            "encoder_mask" => enc_mask = Some(t),
            _ => {}
        }
    }
    let features = features.ok_or("no encoder_features")?;
    let enc_mask = enc_mask.ok_or("no encoder_mask")?;

    let ids: Vec<i64> = prefix
        .split_whitespace()
        .map(|t| vocab.word2idx.get(t).copied().ok_or_else(|| format!("token {t} not in vocab")))
        .collect::<Result<_, _>>()?;
    println!("fixture={name} prefix=[{:?}] vocabSize={}", ids, vocab.vocab_size);

    for len in 1..=ids.len() + 1 {
        let feed: Vec<i64> = if len <= ids.len() { ids[..len].to_vec() } else { [ids.as_slice(), &[vocab.special_tokens.eos]].concat() };
        let input = Tensor { dims: vec![1, feed.len()], data: TensorData::I64(feed.clone()) };
        let out = decoder.run(vec![
            ("encoder_features", features.clone()),
            ("encoder_mask", enc_mask.clone()),
            ("input_ids", input),
        ])?;
        let logits = out
            .into_iter()
            .find(|(n, _)| n == "logits")
            .ok_or("no logits")?
            .1;
        let TensorData::F32(data) = logits.data else { return Err("logits dtype".into()) };
        let offset = (feed.len() - 1) * vocab.vocab_size;
        let mut row: Vec<(usize, f32)> = (0..vocab.vocab_size).map(|i| (i, data[offset + i])).collect();
        row.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top: Vec<String> = row
            .iter()
            .take(6)
            .map(|(id, v)| format!("{}:{v:.4}", vocab.idx2word.get(&id.to_string()).map(String::as_str).unwrap_or("?")))
            .collect();
        let len_out = feed.len();
        println!("L={len_out} top: {}", top.join(" "));
    }
    Ok(())
}

fn run() -> Result<(), Box<dyn Error>> {
    let models = PathBuf::from(arg_value("--models").unwrap_or_else(|| "public/models/comer".into()));
    let fixtures_path = PathBuf::from(arg_value("--fixtures").unwrap_or_else(|| "crates/comer-native/fixtures/fixtures.json".into()));
    let decoder_file = arg_value("--decoder").unwrap_or_else(|| "decoder_int8.onnx".into());
    let filter = arg_value("--filter");
    let repeat: usize = arg_value("--repeat").and_then(|v| v.parse().ok()).unwrap_or(1);

    let raw = std::fs::read_to_string(&fixtures_path)?;
    let file: FixtureFile = serde_json::from_str(&raw)?;
    let vocab = Vocab::load(&models.join("vocab.json"))?;
    println!("engine: {} | baseline: {} | fixtures: {}", engine_name(), file.runtime, file.fixtures.len());
    if vocab.vocab_size != file.vocab_size {
        return Err("vocab_size mismatch between fixture file and vocab.json".into());
    }

    let pad_len = 40 + 1; // maxSteps + 1 (tract's padded decoder plan length)
    let (mut encoder, mut decoder, compile_log) = build_sessions(&models, &decoder_file, pad_len, vocab.special_tokens.pad)?;

    let mut pass = 0usize;
    let mut fail = 0usize;
    let mut text_pass = 0usize;
    let mut text_fail = 0usize;
    let mut max_tensor_diff = 0f64;
    let mut max_conf_delta = 0f64;
    let mut max_text_conf_delta = 0f64;
    let mut infer_first: Vec<Duration> = Vec::new();
    let mut infer_repeat_min: Vec<Duration> = Vec::new();
    let mut enc_ms: Vec<f64> = Vec::new();
    let mut preprocess_us: Vec<u128> = Vec::new();

    for fixture in &file.fixtures {
        if let Some(f) = &filter {
            if !fixture.name.contains(f) {
                continue;
            }
        }
        let t0 = Instant::now();
        let image = preprocess_strokes(&fixture.strokes);
        let preprocess_micros = t0.elapsed().as_micros();

        // preprocess parity against the onnxruntime-web baseline
        let mut tensor_diff: Option<f64> = None;
        if let Some(reference) = &fixture.tensor {
            if reference.len() != image.tensor.len() {
                return Err(format!("{}: fixture tensor length {} != rust {}", fixture.name, reference.len(), image.tensor.len()).into());
            }
            let diff = reference.iter().zip(image.tensor.iter()).map(|(a, b)| (*a - *b).abs() as f64).fold(0f64, f64::max);
            tensor_diff = Some(diff);
            max_tensor_diff = max_tensor_diff.max(diff);
        }
        let sum_diff = (image.tensor.iter().map(|&v| v as f64).sum::<f64>() - fixture.tensor_sum).abs();
        let mask_diff = (image.mask.iter().map(|&v| v as f64).sum::<f64>() - fixture.mask_sum).abs();

        if !is_ink_meaningful(&fixture.strokes) {
            println!("{:<12} SKIPPED (ink not meaningful)", fixture.name);
            continue;
        }

        let pixel = Tensor { dims: vec![1, 1, image.height, image.width], data: TensorData::F32(image.tensor.clone()) };
        let mask = Tensor { dims: vec![1, image.height, image.width], data: TensorData::U8(image.mask.clone()) };
        let beam = 2usize;

        let t1 = Instant::now();
        // encoder alone (per-stage breakdown)
        let enc_ms_here = {
            let t = Instant::now();
            let _ = encoder.as_mut().run(vec![("pixel_values", pixel.clone()), ("pixel_mask", mask.clone())])?;
            t.elapsed().as_secs_f64() * 1000.0
        };
        let opts = comer_native::decode::DecodeOptions {
            sos: vocab.special_tokens.sos,
            eos: vocab.special_tokens.eos,
            vocab_size: vocab.vocab_size,
            beam_width: beam,
            max_steps: 40,
        };
        let hits = comer_native::decode::decode_comer(encoder.as_mut(), decoder.as_mut(), &pixel, &mask, opts)?;
        let first = t1.elapsed();
        let mut min_repeat = first;
        let mut total_repeat = first;
        for _ in 1..repeat.max(1) {
            let t = Instant::now();
            let _ = comer_native::decode::decode_comer(encoder.as_mut(), decoder.as_mut(), &pixel, &mask, opts)?;
            let e = t.elapsed();
            min_repeat = min_repeat.min(e);
            total_repeat += e;
        }
        let avg_repeat = total_repeat / repeat.max(1) as u32;

        // decode-level surface (rounds 1–2)
        let mut rows = Vec::new();
        for hit in &hits {
            let tokens = vocab.decode_tokens(&hit.ids);
            let latex = tokens.join(" ");
            let conf = (hit.log_prob / 1f64.max(hit.ids.len() as f64)).exp();
            rows.push((latex, conf));
        }
        let latex_ok = rows.iter().zip(fixture.expected.iter()).all(|((latex, _), e)| latex == &e.latex)
            && rows.len() == fixture.expected.len();
        let conf_delta = rows
            .iter()
            .zip(fixture.expected.iter())
            .map(|((_, c), e)| (c - e.conf).abs())
            .fold(0f64, f64::max);
        max_conf_delta = max_conf_delta.max(conf_delta);

        // full-text surface (round 3): bind/sigma/repair/agree in Rust
        let text_t = Instant::now();
        let cands = recognize_strokes(&fixture.strokes, encoder.as_mut(), decoder.as_mut(), &vocab, beam)?;
        let text_ms = text_t.elapsed().as_secs_f64() * 1000.0;
        let top1_text_ok = cands
            .first()
            .zip(fixture.text.first())
            .map(|(c, e)| c.text == e.text)
            .unwrap_or(fixture.text.is_empty() && cands.is_empty());
        let text_conf_delta = cands
            .iter()
            .zip(fixture.text.iter())
            .map(|(c, e)| (c.confidence - e.confidence).abs())
            .fold(0f64, f64::max);
        max_text_conf_delta = max_text_conf_delta.max(text_conf_delta);
        if top1_text_ok {
            text_pass += 1;
        } else {
            text_fail += 1;
        }

        let top1_ok = rows
            .first()
            .zip(fixture.expected.first())
            .map(|((latex, _), e)| latex == &e.latex)
            .unwrap_or(false);
        if top1_ok && mask_diff == 0.0 {
            pass += 1;
        } else {
            fail += 1;
        }
        infer_first.push(first);
        infer_repeat_min.push(min_repeat);
        enc_ms.push(enc_ms_here);
        preprocess_us.push(preprocess_micros);
        let parity = tensor_diff.map(|d| format!("{d:.2e}")).unwrap_or_else(|| "n/a".into());
        println!(
            "{:<12} W={:<4} parity={:<8} latex={} confΔ={:.2e} text={} textΔ={:.2e} fullT={:.1}ms infer 1st={:>7.1}ms rep(min)={:>7.1}ms enc={enc_ms_here:.1}ms pre={}µs",
            fixture.name,
            image.width,
            parity,
            if latex_ok { "OK " } else { "FAIL" },
            conf_delta,
            if top1_text_ok { "OK " } else { "FAIL" },
            text_conf_delta,
            text_ms,
            first.as_secs_f64() * 1000.0,
            min_repeat.as_secs_f64() * 1000.0,
            preprocess_micros
        );
        if !latex_ok || !top1_text_ok {
            let got: Vec<String> = rows.iter().map(|(l, c)| format!("\"{l}\" ({c:.3})")).collect();
            let want: Vec<String> = fixture.expected.iter().map(|e| format!("\"{}\" ({:.3})", e.latex, e.conf)).collect();
            println!("              latex got:  {}", got.join(" | "));
            println!("              latex want: {}", want.join(" | "));
            let gt: Vec<String> = cands.iter().map(|c| format!("\"{}\" ({:.3})", c.text, c.confidence)).collect();
            let wt: Vec<String> = fixture.text.iter().map(|e| format!("\"{}\" ({:.3})", e.text, e.confidence)).collect();
            println!("              text got:  {}", gt.join(" | "));
            println!("              text want: {}", wt.join(" | "));
        }
        let _ = avg_repeat;
    }

    let min_of = |v: &[Duration]| v.iter().min().map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
    let avg_of = |v: &[Duration]| (!v.is_empty()).then(|| v.iter().map(|d| d.as_secs_f64()).sum::<f64>() / v.len() as f64 * 1000.0).unwrap_or(0.0);
    println!(
        "\nsummary: engine={} latex pass={pass} fail={fail} text top-1 pass={text_pass} fail={text_fail} maxConfΔ={max_conf_delta:.2e} maxTextConfΔ={max_text_conf_delta:.2e} maxTensorDiff={max_tensor_diff:.2e}\n  preprocess(avg)={}µs infer(1st avg)={:.1}ms infer(repeat min)={:.1}ms enc(avg)={:.1}ms",
        engine_name(),
        preprocess_us.iter().sum::<u128>() / preprocess_us.len().max(1) as u128,
        avg_of(&infer_first),
        min_of(&infer_repeat_min),
        enc_ms.iter().sum::<f64>() / enc_ms.len().max(1) as f64
    );
    if !compile_log.is_empty() {
        println!("tract plan compile times:");
        for (key, ms) in &compile_log {
            println!("  {key}: {ms}ms");
        }
    }
    if fail > 0 || text_fail > 0 {
        return Err(format!("{fail} latex and/or {text_fail} text fixture(s) diverged from the onnxruntime-web baseline").into());
    }
    Ok(())
}
