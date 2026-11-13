// Types for the non-SIMD fallback runtime (npm alias of onnxruntime-web 1.18). That release ships
// ambient `declare module 'onnxruntime-web'` typings that would shadow 1.22's, so tsconfig maps the
// alias here. The runtime API used (env.wasm, InferenceSession, Tensor) is the same in both.
export * from 'onnxruntime-web/wasm'
