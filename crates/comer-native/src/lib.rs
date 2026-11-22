//! Native CoMER INT8 pipeline: preprocessing, encode/decode, and the full
//! post-processing chain (bind / sigma / repair / gate helpers / token→source),
//! ported line-for-line from `src/ocr/comer/*.ts` so a Tauri backend can return
//! the same `{text, confidence}` the web path produces.

pub mod bind;
pub mod decode;
pub mod engine;
pub mod gate;
pub mod preprocess;
pub mod repair;
pub mod sigma;
pub mod source;

#[cfg(feature = "ort")]
pub mod ort_engine;
#[cfg(feature = "tract")]
pub mod tract_engine;

pub use preprocess::{Point, Stroke};
