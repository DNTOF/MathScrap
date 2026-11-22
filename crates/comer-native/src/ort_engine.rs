//! ort (ONNX Runtime native, pyke bindings) backend.
//!
//! ORT implements every op the INT8 models need (ConvInteger, MatMulInteger,
//! DynamicQuantizeLinear, Trilu) — this is the expected-feasible engine. Feeds
//! the decoder the real growing `input_ids` length, exactly like the TS loop.
//! Feed names are fixed per model, so `ort::inputs!` is used with the two
//! known arities (encoder: pixel_values+pixel_mask, decoder: 3 tensors).

use crate::decode::{Session, Tensor, TensorData};
use std::error::Error;
use std::path::Path;

pub struct OrtSession {
    inner: ort::session::Session,
}

impl OrtSession {
    pub fn load(path: &Path) -> Result<OrtSession, Box<dyn Error>> {
        let inner = ort::session::Session::builder()?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)?
            .commit_from_file(path)?;
        Ok(OrtSession { inner })
    }

    /// Build a session from embedded model bytes (Tauri shell).
    pub fn from_memory(bytes: &[u8]) -> Result<OrtSession, Box<dyn Error>> {
        let inner = ort::session::Session::builder()?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)?
            .commit_from_memory(bytes)?;
        Ok(OrtSession { inner })
    }
}

fn to_ort_value(t: &Tensor) -> Result<ort::value::Value, Box<dyn Error>> {
    let dims: Vec<i64> = t.dims.iter().map(|&d| d as i64).collect();
    match &t.data {
        TensorData::F32(v) => Ok(ort::value::Tensor::from_array((dims, v.clone()))?.into_dyn()),
        TensorData::U8(v) => {
            let bools: Vec<bool> = v.iter().map(|&b| b != 0).collect();
            Ok(ort::value::Tensor::from_array((dims, bools))?.into_dyn())
        }
        TensorData::I64(v) => Ok(ort::value::Tensor::from_array((dims, v.clone()))?.into_dyn()),
    }
}

fn tensor_from_out(value: &ort::value::Value) -> Result<Tensor, Box<dyn Error>> {
    if let Ok((shape, data)) = value.try_extract_tensor::<f32>() {
        return Ok(Tensor {
            dims: shape.iter().map(|&d| d as usize).collect(),
            data: TensorData::F32(data.to_vec()),
        });
    }
    if let Ok((shape, data)) = value.try_extract_tensor::<i64>() {
        return Ok(Tensor {
            dims: shape.iter().map(|&d| d as usize).collect(),
            data: TensorData::I64(data.to_vec()),
        });
    }
    if let Ok((shape, data)) = value.try_extract_tensor::<bool>() {
        return Ok(Tensor {
            dims: shape.iter().map(|&d| d as usize).collect(),
            data: TensorData::U8(data.iter().map(|&b| u8::from(b)).collect()),
        });
    }
    Err("output dtype not in {f32, i64, bool}".into())
}

impl Session for OrtSession {
    fn run(&mut self, feeds: Vec<(&'static str, Tensor)>) -> Result<Vec<(String, Tensor)>, Box<dyn Error>> {
        let names: Vec<&str> = feeds.iter().map(|f| f.0).collect();
        match names.as_slice() {
            ["pixel_values", "pixel_mask"] => {
                let outputs = self.inner.run(ort::inputs![
                    "pixel_values" => to_ort_value(&feeds[0].1)?,
                    "pixel_mask" => to_ort_value(&feeds[1].1)?,
                ])?;
                collect(&outputs)
            }
            ["encoder_features", "encoder_mask", "input_ids"] => {
                let outputs = self.inner.run(ort::inputs![
                    "encoder_features" => to_ort_value(&feeds[0].1)?,
                    "encoder_mask" => to_ort_value(&feeds[1].1)?,
                    "input_ids" => to_ort_value(&feeds[2].1)?,
                ])?;
                collect(&outputs)
            }
            other => Err(format!("unsupported feed set {other:?}").into()),
        }
    }
}

fn collect(outputs: &ort::session::SessionOutputs<'_>) -> Result<Vec<(String, Tensor)>, Box<dyn Error>> {
    let mut out = Vec::new();
    for (name, value) in outputs.iter() {
        out.push((name.to_string(), tensor_from_out(&value)?));
    }
    Ok(out)
}
