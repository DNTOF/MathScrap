//! tract-onnx backend (pure Rust engine candidate).
//!
//! Round-1 strategy: tract plans are shape-specialized, so plans are built per
//! concrete encoder width (few distinct values across fixtures) and per decoder
//! feature length S. The decoder gets `input_ids` padded to a fixed length
//! (max_steps+1) — safe because the Trilu causal mask means logits at position
//! L-1 never attend to later padding (same trick the compat decoder plays on
//! WebKit). Compile times are printed; any unsupported ONNX op fails here with
//! the op name, which is the deliverable of this round.

use crate::decode::{Session, Tensor, TensorData};
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tract_onnx::prelude::*;

type Runnable = SimplePlan<TypedFact, Box<dyn TypedOp>, TypedModel>;
type TractTensor = tract_onnx::prelude::Tensor;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Encoder,
    Decoder,
}

impl std::fmt::Debug for TractSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TractSession({:?}, {} plans)", self.kind, self.plans.len())
    }
}

pub struct TractSession {
    kind: Kind,
    path: PathBuf,
    /// fixed decoder input length (padded), unused for the encoder
    pad_len: Option<usize>,
    pad_token: i64,
    plans: HashMap<String, (Runnable, Vec<String>)>,
    /// compile times per plan key, for the report
    pub compile_log: Vec<(String, u128)>,
}

impl TractSession {
    pub fn load_encoder(path: &Path) -> TractSession {
        TractSession { kind: Kind::Encoder, path: path.to_path_buf(), pad_len: None, pad_token: 0, plans: HashMap::new(), compile_log: Vec::new() }
    }

    pub fn load_decoder(path: &Path, pad_len: usize, pad_token: i64) -> TractSession {
        TractSession { kind: Kind::Decoder, path: path.to_path_buf(), pad_len: Some(pad_len), pad_token, plans: HashMap::new(), compile_log: Vec::new() }
    }

    fn plan_key(&self, feeds: &[(&'static str, Tensor)]) -> String {
        // full shape signature — decoder encoder_features keep the SAME leading
        // dims across widths (rows fixed, cols vary), so a coarse key like
        // dims[1] reuses a plan built for another width and resolves clash
        let sig = feeds
            .iter()
            .map(|(n, t)| {
                let dims = if self.kind == Kind::Decoder && *n == "input_ids" {
                    vec![1, self.pad_len.unwrap_or_default()]
                } else {
                    t.dims.clone()
                };
                format!("{n}{dims:?}")
            })
            .collect::<Vec<_>>()
            .join("|");
        format!("{self:?}-{sig}")
    }

    fn input_index(model: &InferenceModel, name: &str) -> Result<usize, Box<dyn Error>> {
        for (i, outlet) in model.inputs.iter().enumerate() {
            if model.node(outlet.node).name == name {
                return Ok(i);
            }
        }
        Err(format!(
            "model has no input named {name} (inputs: {:?})",
            model.inputs.iter().map(|o| model.node(o.node).name.clone()).collect::<Vec<_>>()
        )
        .into())
    }

    fn build_plan(&mut self, feeds: &[(&'static str, Tensor)]) -> Result<(Runnable, Vec<String>), Box<dyn Error>> {
        let t0 = Instant::now();
        // two tract workarounds combined (both needed, found round 1):
        // 1. ignore ONNX intermediate shape hints — they carry symbolic dims
        //    (Sym("width")) that conflict with the concrete facts at analysis;
        // 2. set CONCRETE input facts so the analyser never runs on streaming
        //    dims (tract cannot analyse StridedSlice over streaming dims).
        let mut model = tract_onnx::onnx().with_ignore_output_shapes(true).model_for_path(&self.path)?;
        // nuke every value_info-seeded intermediate fact (they hard-code
        // Sym("width") etc. and conflict with concrete analysis) — the solver
        // re-derives them from sources/consts + op rules. Only the concrete
        // input facts we set below survive.
        let mut outlets = Vec::new();
        for (id, node) in model.nodes().iter().enumerate() {
            if node.op().name() == "Const" || node.op().name() == "Source" {
                continue;
            }
            for slot in 0..node.outputs.len() {
                outlets.push(OutletId::new(id, slot));
            }
        }
        for outlet in outlets {
            model.set_outlet_fact(outlet, InferenceFact::default())?;
        }
        let concrete = |name: &str| -> Vec<i64> {
            let feed = feeds.iter().find(|(n, _)| *n == name).expect("feed for model input");
            if self.kind == Kind::Decoder && name == "input_ids" {
                vec![1, self.pad_len.expect("decoder pad_len") as i64]
            } else {
                feed.1.dims.iter().map(|&d| d as i64).collect()
            }
        };
        for name in ["pixel_values", "pixel_mask", "encoder_features", "encoder_mask", "input_ids"] {
            if let Ok(idx) = Self::input_index(&model, name) {
                let dims = concrete(name);
                let dt = match name {
                    "pixel_values" | "encoder_features" => f32::datum_type(),
                    "input_ids" => i64::datum_type(),
                    _ => DatumType::Bool,
                };
                model.set_input_fact(idx, InferenceFact::dt_shape(dt, dims.iter().map(|&d| d.to_dim()).collect::<TVec<_>>()))?;
            }
        }
        let typed = model.into_typed()?;
        let optimized = typed.into_optimized()?;
        // outputs are looked up by their ONNX label (e.g. "encoder_features"),
        // not the tract node name
        let names: Vec<String> = optimized
            .output_outlets()?
            .iter()
            .map(|o| optimized.outlet_label(*o).map(|s| s.to_string()).unwrap_or_else(|| optimized.node(o.node).name.clone()))
            .collect();
        let plan = optimized.into_runnable()?;
        self.compile_log.push((self.plan_key(feeds), t0.elapsed().as_millis()));
        Ok((plan, names))
    }

    fn to_tract(t: &Tensor) -> Result<TractTensor, Box<dyn Error>> {
        let dims: Vec<usize> = t.dims.clone();
        match &t.data {
            TensorData::F32(v) => Ok(TractTensor::from_shape(&dims, v)?),
            TensorData::I64(v) => Ok(TractTensor::from_shape(&dims, v)?),
            TensorData::U8(v) => {
                let bools: Vec<bool> = v.iter().map(|&b| b != 0).collect();
                Ok(TractTensor::from_shape(&dims, &bools)?)
            }
        }
    }

    /// input_ids padded to the plan's fixed length (causal-safe, see module doc)
    fn padded_i64(t: &Tensor, len: usize, pad_token: i64) -> Result<TractTensor, Box<dyn Error>> {
        let TensorData::I64(ids) = &t.data else { return Err("input_ids must be i64".into()) };
        if ids.len() > len {
            return Err(format!("input_ids len {} exceeds padded plan length {len}", ids.len()).into());
        }
        let mut padded = ids.clone();
        padded.resize(len, pad_token);
        Ok(TractTensor::from_shape(&[1, len], &padded)?)
    }

    fn from_tract(name: &str, tensor: &TractTensor) -> Result<Tensor, Box<dyn Error>> {
        let dims: Vec<usize> = tensor.shape().to_vec();
        let data = if tensor.datum_type() == f32::datum_type() {
            TensorData::F32(tensor.as_slice::<f32>()?.to_vec())
        } else if tensor.datum_type() == i64::datum_type() {
            TensorData::I64(tensor.as_slice::<i64>()?.to_vec())
        } else if tensor.datum_type() == DatumType::Bool {
            TensorData::U8(tensor.as_slice::<bool>()?.iter().map(|&b| u8::from(b)).collect())
        } else {
            return Err(format!("output {name}: unsupported dtype {:?}", tensor.datum_type()).into());
        };
        Ok(Tensor { dims, data })
    }
}

impl Session for TractSession {
    fn run(&mut self, feeds: Vec<(&'static str, Tensor)>) -> Result<Vec<(String, Tensor)>, Box<dyn Error>> {
        let key = self.plan_key(&feeds);
        if !self.plans.contains_key(&key) {
            let built = self.build_plan(&feeds)?;
            self.plans.insert(key.clone(), built);
        }
        let (plan, names) = self.plans.get(&key).expect("plan built above");
        let mut inputs: TVec<TValue> = TVec::new();
        for (name, tensor) in &feeds {
            let t = if self.kind == Kind::Decoder && *name == "input_ids" {
                Self::padded_i64(tensor, self.pad_len.expect("decoder pad_len"), self.pad_token)?
            } else {
                Self::to_tract(tensor)?
            };
            inputs.push(t.into_tvalue());
        }
        let outputs = plan.run(inputs).map_err(|e| {
            format!(
                "tract plan {} failed with feeds {:?}: {e}",
                key,
                feeds.iter().map(|(n, t)| (n.to_string(), t.dims.clone())).collect::<Vec<_>>()
            )
        })?;
        let mut out = Vec::new();
        for (i, name) in names.iter().enumerate() {
            out.push((name.clone(), Self::from_tract(name, &outputs[i])?));
        }
        Ok(out)
    }
}
