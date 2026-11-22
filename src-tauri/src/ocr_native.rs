//! Opt-in native OCR command for the Tauri shell.
//!
//! Compiled only with the `native-ocr` cargo feature (default off). At runtime
//! the frontend additionally gates on `?ocr-native=1` / localStorage
//! `mathscrap.ocr-native` and falls back to onnxruntime-web on any failure —
//! this module only ever serves a request that already opted in.

use comer_native::engine::{recognize_strokes, OcrCandidate};
use comer_native::preprocess::{Point, Stroke};
use comer_native::source::Vocab;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

const ENCODER_BYTES: &[u8] = include_bytes!("../../public/models/comer/encoder_int8.onnx");
const DECODER_BYTES: &[u8] = include_bytes!("../../public/models/comer/decoder_int8.onnx");
const VOCAB_JSON: &str = include_str!("../../public/models/comer/vocab.json");

#[derive(Deserialize)]
pub struct NativePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
pub struct NativeStroke {
    pub points: Vec<NativePoint>,
    #[serde(rename = "lineWidth")]
    pub line_width: f64,
}

impl From<&NativeStroke> for Stroke {
    fn from(s: &NativeStroke) -> Stroke {
        Stroke {
            points: s.points.iter().map(|p| Point { x: p.x, y: p.y }).collect(),
            line_width: s.line_width,
        }
    }
}

#[derive(Serialize)]
pub struct NativeCandidate {
    pub text: String,
    pub confidence: f64,
    pub latex: String,
}

struct Pipeline {
    encoder: Box<dyn comer_native::decode::Session>,
    decoder: Box<dyn comer_native::decode::Session>,
    vocab: Vocab,
}

fn pipeline() -> Result<&'static Mutex<Pipeline>, String> {
    static PIPELINE: OnceLock<Result<Mutex<Pipeline>, String>> = OnceLock::new();
    PIPELINE
        .get_or_init(|| {
            let encoder = comer_native::ort_engine::OrtSession::from_memory(ENCODER_BYTES).map_err(|e| format!("encoder load: {e}"))?;
            let decoder = comer_native::ort_engine::OrtSession::from_memory(DECODER_BYTES).map_err(|e| format!("decoder load: {e}"))?;
            let vocab = Vocab::from_json_str(VOCAB_JSON).map_err(|e| format!("vocab: {e}"))?;
            Ok(Mutex::new(Pipeline { encoder: Box::new(encoder), decoder: Box::new(decoder), vocab }))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Tauri command: strokes → `{text, confidence, latex}` candidates. Identical
/// surface to `recognizeStrokes` on the web side (post-processing included).
#[tauri::command]
pub fn ocr_native_recognize(strokes: Vec<NativeStroke>) -> Result<Vec<NativeCandidate>, String> {
    let guard = pipeline()?;
    let mut pipeline = guard.lock().map_err(|_| "pipeline poisoned")?;
    let ink: Vec<Stroke> = strokes.iter().map(|s| Stroke::from(s)).collect();
    let Pipeline { encoder, decoder, vocab } = &mut *pipeline;
    let cands: Vec<OcrCandidate> = recognize_strokes(&ink, encoder.as_mut(), decoder.as_mut(), vocab, 2).map_err(|e| format!("recognize: {e}"))?;
    Ok(cands
        .into_iter()
        .map(|c| NativeCandidate { text: c.text, confidence: c.confidence, latex: c.latex })
        .collect())
}
