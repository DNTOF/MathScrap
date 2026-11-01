CoMER INT8 encoder and decoder (`encoder_int8.onnx`, `decoder_int8.onnx`) and `vocab.json`
are the handwritten-math weights distributed by [ink-on](https://github.com/kimseungdae/ink-on)
(Apache-2.0, Copyright 2025 kimseungdae). They are an INT8 export of
[CoMER](https://github.com/Green-Wood/CoMER) (ECCV 2022).

MathScrap does not train these files. The same two ONNX files are what a native
ONNX Runtime build should load.
