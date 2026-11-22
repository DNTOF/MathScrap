CoMER INT8 encoder and decoder (`encoder_int8.onnx`, `decoder_int8.onnx`) and `vocab.json`
are the handwritten-math weights distributed by [ink-on](https://github.com/kimseungdae/ink-on)
(Apache-2.0, Copyright 2025 kimseungdae). They are an INT8 export of
[CoMER](https://github.com/Green-Wood/CoMER) (ECCV 2022).

MathScrap does not train these files. The same two ONNX files are what a native
ONNX Runtime build should load.

`decoder_int8_compat.onnx` is the same decoder with its one `Trilu` (causal mask) replaced by
`ConstantOfShape`/`CumSum`/`Greater`, built by `scripts/make-compat-decoder.py`. Weights are unchanged.
The non-SIMD onnxruntime-web 1.18 fallback (WebKit before iOS / iPadOS 16.4) loads it because that
runtime has no `Trilu` kernel.
