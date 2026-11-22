//! Full recognize pipeline port of `src/ocr/comer/engine.ts`:
//! preprocess → decode (beam 2) → tokens → latex/source → bind/sigma/agree.

use crate::bind::bind_ink;
use crate::decode::{decode_comer, Session, DecodeOptions};
use crate::gate::looks_like_isolated_sigma;
use crate::preprocess::{is_ink_meaningful, preprocess_strokes};
use crate::repair::repair_latex;
use crate::sigma::repair_isolated_sigma;
use crate::source::Vocab;
use regex::Regex;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct OcrCandidate {
    pub text: String,
    pub confidence: f64,
    pub latex: String,
}

/**
 * The live over-arrow sample scores about 0.48, under the sheet's 0.62 write
 * line. A read at or above this, when the ink agrees, is lifted. Weaker than
 * this stays ink.
 */
const AGREE_AT: f64 = 0.42;
/**
 * A compact σ often ranks under a dropped letter at about 0.29. Shape agreement
 * can lift that. Weaker than this stays ink.
 */
const SIGMA_AT: f64 = 0.26;
/// Above the sheet accept threshold (0.62), below the 0.97 cap.
const AGREED: f64 = 0.78;

fn named_or_agree(text: &str) -> bool {
    let t: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    ["sigma", "pi", "theta", "alpha", "beta", "gamma", "lambda", "mu", "phi"].contains(&t.as_str())
}

/// Raise confidence only when the decoder and the ink describe the same thing.
pub fn agree_confidence(strokes: &[crate::preprocess::Stroke], text: &str, model: f64) -> f64 {
    if !model.is_finite() || model < 0.0 {
        return 0.0;
    }
    let capped = 0.97f64.min(model);
    let t = text.trim();
    let isolated = t == "sigma" && model >= SIGMA_AT && looks_like_isolated_sigma(strokes);
    if model < AGREE_AT && !isolated {
        return capped;
    }
    let arrow = Regex::new(r"^\\vec\{[a-z]\} = \(").unwrap().is_match(t) && crate::bind::find_over_arrow(strokes).is_some();
    let sum = {
        // /^(?:y\s*=\s*)?\\(?:sum|int)(?![A-Za-z])/ — negative lookahead hand-rolled
        let re = Regex::new(r"^(?:y\s*=\s*)?\\(?:sum|int)").unwrap();
        if let Some(m) = re.find(t) {
            m.start() == 0 && t[m.end()..].chars().next().map(|c| !c.is_ascii_alphabetic()).unwrap_or(true)
        } else {
            false
        }
    };
    let greek = named_or_agree(t);
    if arrow || sum || greek || isolated {
        return capped.max(AGREED);
    }
    capped
}

/// Stroke points → LaTeX candidates (full port of recognizeStrokes).
pub fn recognize_strokes(
    strokes: &[crate::preprocess::Stroke],
    encoder: &mut dyn Session,
    decoder: &mut dyn Session,
    vocab: &Vocab,
    beam_width: usize,
) -> Result<Vec<OcrCandidate>, Box<dyn std::error::Error>> {
    if !is_ink_meaningful(strokes) {
        return Ok(Vec::new());
    }
    let image = preprocess_strokes(strokes);
    let pixel = crate::decode::Tensor { dims: vec![1, 1, image.height, image.width], data: crate::decode::TensorData::F32(image.tensor) };
    let mask = crate::decode::Tensor { dims: vec![1, image.height, image.width], data: crate::decode::TensorData::U8(image.mask) };
    let hits = decode_comer(
        encoder,
        decoder,
        &pixel,
        &mask,
        DecodeOptions { sos: vocab.special_tokens.sos, eos: vocab.special_tokens.eos, vocab_size: vocab.vocab_size, beam_width, max_steps: 40 },
    )?;
    let mut out: Vec<OcrCandidate> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for hit in hits {
        let decoded = vocab.decode_tokens(&hit.ids);
        let latex = decoded.join(" ");
        let source = crate::source::tokens_to_source(&decoded);
        let n = 1f64.max(hit.ids.len() as f64);
        let mean = hit.log_prob / n;
        let model = mean.exp();
        if !model.is_finite() || model < 0.2 {
            continue;
        }
        // A mid-or-better read of 0 / Y / u is σ only when the ink has that glyph.
        let repaired = if model >= AGREE_AT { repair_isolated_sigma(strokes, &source) } else { None };
        let text = match repaired {
            Some(r) => r,
            None => bind_ink(strokes, &source),
        };
        if text.is_empty() || seen.contains(&text) {
            continue;
        }
        seen.insert(text.clone());
        out.push(OcrCandidate { confidence: agree_confidence(strokes, &text, model), text, latex });
    }
    out.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| js_locale_cmp(&a.text, &b.text))
    });
    let best = out.first().map(|c| c.confidence).unwrap_or(0.0);
    out.retain(|c| c.confidence >= best - 0.22);
    out.truncate(3);
    Ok(out)
}

/// Approximate JS `localeCompare` for ASCII: primary = lowercase, secondary = raw char.
fn js_locale_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let ka: Vec<char> = a.chars().map(|c| c.to_ascii_lowercase()).collect();
    let kb: Vec<char> = b.chars().map(|c| c.to_ascii_lowercase()).collect();
    let ord = ka.cmp(&kb);
    if ord != std::cmp::Ordering::Equal {
        return ord;
    }
    a.chars().cmp(b.chars())
}

/// repairLatex re-export kept for tests
pub fn repair(tokens: &[String]) -> Vec<String> {
    repair_latex(tokens)
}
