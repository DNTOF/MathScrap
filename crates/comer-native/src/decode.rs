//! Greedy / beam decode for the CoMER encoder+decoder pair.
//!
//! Port of `src/ocr/comer/decode.ts` — same loop the web app runs on
//! onnxruntime-web: encoder once per image, then the decoder is stepped
//! token by token (or width×2 candidates per beam step), logits taken from the
//! last position, log-softmax in f64, length-normalized beam ranking, a
//! 3-repeat guard. Sessions are injected via [`Session`] so the same loop runs
//! on any engine.

use std::error::Error;

#[derive(Clone, Debug)]
pub enum TensorData {
    F32(Vec<f32>),
    /// bool tensors ride as 0/1 bytes on every backend
    U8(Vec<u8>),
    I64(Vec<i64>),
}

#[derive(Clone, Debug)]
pub struct Tensor {
    pub dims: Vec<usize>,
    pub data: TensorData,
}

impl Tensor {
    pub fn len(&self) -> usize {
        match &self.data {
            TensorData::F32(v) => v.len(),
            TensorData::U8(v) => v.len(),
            TensorData::I64(v) => v.len(),
        }
    }
}

/// Minimal session abstraction (ORT-web's `ComerSession` equivalent).
pub trait Session: Send {
    fn run(&mut self, feeds: Vec<(&'static str, Tensor)>) -> Result<Vec<(String, Tensor)>, Box<dyn Error>>;
}

#[derive(Clone, Copy, Debug)]
pub struct DecodeOptions {
    pub sos: i64,
    pub eos: i64,
    pub vocab_size: usize,
    pub beam_width: usize,
    pub max_steps: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodeHit {
    pub ids: Vec<i64>,
    pub log_prob: f64,
}

const REPEAT_LIMIT: usize = 3;

pub fn decode_comer(
    encoder: &mut dyn Session,
    decoder: &mut dyn Session,
    pixel: &Tensor,
    mask: &Tensor,
    opts: DecodeOptions,
) -> Result<Vec<DecodeHit>, Box<dyn Error>> {
    let encoded = encoder.run(vec![("pixel_values", pixel.clone()), ("pixel_mask", mask.clone())])?;
    let mut features: Option<Tensor> = None;
    let mut enc_mask: Option<Tensor> = None;
    for (name, tensor) in encoded {
        match name.as_str() {
            "encoder_features" => features = Some(tensor),
            "encoder_mask" => enc_mask = Some(tensor),
            _ => {}
        }
    }
    let features = features.ok_or("encoder produced no encoder_features")?;
    let enc_mask = enc_mask.ok_or("encoder produced no encoder_mask")?;
    let beam = opts.beam_width.max(1);
    let hits = if beam <= 1 { vec![greedy(decoder, &features, &enc_mask, opts)?] } else { beam_search(decoder, &features, &enc_mask, opts, beam)? };
    Ok(hits)
}

fn greedy(decoder: &mut dyn Session, features: &Tensor, enc_mask: &Tensor, opts: DecodeOptions) -> Result<DecodeHit, Box<dyn Error>> {
    let mut ids = vec![opts.sos];
    let mut log_prob = 0f64;
    let mut repeat = 0usize;
    let mut last = -1i64;
    for _ in 0..opts.max_steps {
        let (next, lp) = next_token(decoder, features, enc_mask, &ids, opts)?;
        if next == opts.eos {
            break;
        }
        log_prob += lp;
        if next == last {
            repeat += 1;
            if repeat >= REPEAT_LIMIT {
                break;
            }
        } else {
            repeat = 0;
        }
        last = next;
        ids.push(next);
    }
    ids.remove(0);
    Ok(DecodeHit { ids, log_prob })
}

#[derive(Clone)]
struct Beam {
    ids: Vec<i64>,
    log_prob: f64,
    finished: bool,
}

fn beam_search(decoder: &mut dyn Session, features: &Tensor, enc_mask: &Tensor, opts: DecodeOptions, width: usize) -> Result<Vec<DecodeHit>, Box<dyn Error>> {
    let mut beams = vec![Beam { ids: vec![opts.sos], log_prob: 0.0, finished: false }];
    for _ in 0..opts.max_steps {
        let mut pool: Vec<Beam> = Vec::new();
        for beam in &beams {
            if beam.finished {
                pool.push(beam.clone());
                continue;
            }
            let logits = logits_of(decoder, features, enc_mask, &beam.ids)?;
            let offset = (beam.ids.len() - 1) * opts.vocab_size;
            let log_probs = log_softmax(&logits, offset, opts.vocab_size);
            for idx in top_k(&log_probs, width * 2) {
                let log_prob = beam.log_prob + log_probs[idx];
                if idx as i64 == opts.eos || tail_repeat(&beam.ids, idx as i64) >= REPEAT_LIMIT {
                    pool.push(Beam { ids: beam.ids.clone(), log_prob, finished: true });
                } else {
                    let mut ids = beam.ids.clone();
                    ids.push(idx as i64);
                    pool.push(Beam { ids, log_prob, finished: false });
                }
            }
        }
        // stable sort, descending by length-normalized logProb (matches JS sort)
        pool.sort_by(|a, b| {
            let ka = a.log_prob / 1f64.max(a.ids.len() as f64);
            let kb = b.log_prob / 1f64.max(b.ids.len() as f64);
            kb.partial_cmp(&ka).unwrap_or(std::cmp::Ordering::Equal)
        });
        beams = pool.into_iter().take(width).collect();
        if beams.iter().all(|b| b.finished) {
            break;
        }
    }
    let done: Vec<&Beam> = beams.iter().filter(|b| b.finished).collect();
    let mut ranked: Vec<&Beam> = if done.is_empty() { beams.iter().collect() } else { done };
    ranked.sort_by(|a, b| {
        let ka = a.log_prob / 1f64.max(a.ids.len() as f64);
        let kb = b.log_prob / 1f64.max(b.ids.len() as f64);
        kb.partial_cmp(&ka).unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(ranked
        .into_iter()
        .take(width)
        .map(|b| {
            let mut ids = b.ids.clone();
            ids.remove(0);
            DecodeHit { ids, log_prob: b.log_prob }
        })
        .collect())
}

fn next_token(decoder: &mut dyn Session, features: &Tensor, enc_mask: &Tensor, ids: &[i64], opts: DecodeOptions) -> Result<(i64, f64), Box<dyn Error>> {
    let logits = logits_of(decoder, features, enc_mask, ids)?;
    let offset = (ids.len() - 1) * opts.vocab_size;
    let log_probs = log_softmax(&logits, offset, opts.vocab_size);
    let mut best = 0usize;
    let mut val = f64::NEG_INFINITY;
    for (i, &lp) in log_probs.iter().enumerate() {
        if lp > val {
            val = lp;
            best = i;
        }
    }
    Ok((best as i64, val))
}

fn logits_of(decoder: &mut dyn Session, features: &Tensor, enc_mask: &Tensor, ids: &[i64]) -> Result<Vec<f32>, Box<dyn Error>> {
    let input = Tensor { dims: vec![1, ids.len()], data: TensorData::I64(ids.to_vec()) };
    let out = decoder.run(vec![
        ("encoder_features", features.clone()),
        ("encoder_mask", enc_mask.clone()),
        ("input_ids", input),
    ])?;
    for (name, tensor) in out {
        if name == "logits" {
            return match tensor.data {
                TensorData::F32(v) => Ok(v),
                _ => Err("decoder logits are not float32".into()),
            };
        }
    }
    Err("decoder produced no logits".into())
}

fn tail_repeat(ids: &[i64], idx: i64) -> usize {
    let mut n = 0;
    for j in (1..ids.len()).rev() {
        if ids[j] == idx {
            n += 1;
        } else {
            break;
        }
    }
    n
}

fn log_softmax(logits: &[f32], offset: usize, size: usize) -> Vec<f64> {
    let mut max = f64::NEG_INFINITY;
    for i in 0..size {
        max = max.max(logits[offset + i] as f64);
    }
    let mut sum = 0f64;
    for i in 0..size {
        sum += (logits[offset + i] as f64 - max).exp();
    }
    let log_z = sum.ln();
    (0..size).map(|i| logits[offset + i] as f64 - max - log_z).collect()
}

fn top_k(arr: &[f64], k: usize) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..arr.len()).collect();
    // stable sort, descending (matches JS topK)
    idx.sort_by(|&a, &b| arr[b].partial_cmp(&arr[a]).unwrap_or(std::cmp::Ordering::Equal));
    idx.truncate(k);
    idx
}
