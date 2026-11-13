"""
Build public/models/comer/decoder_int8_compat.onnx for the non-SIMD OCR fallback.

onnxruntime-web 1.18 (the last release with a non-SIMD `ort-wasm.wasm`) has no Trilu kernel.
The decoder uses one Trilu to build its causal mask: Trilu(ones[L, L] bool, k=1, upper=1),
i.e. mask[i, j] = j > i. This swaps it for ops 1.18 ships:

    f    = ConstantOfShape(shape, 1.0f)        # [L, L]
    col  = CumSum(f, axis=1)                   # j + 1
    row  = CumSum(f, axis=0)                   # i + 1
    mask = Greater(col, row)                   # j > i  (bool, same as the Trilu output)

Weights and every other node are untouched. Requires `pip install onnx`.

    python scripts/make-compat-decoder.py
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

SRC = 'public/models/comer/decoder_int8.onnx'
DST = 'public/models/comer/decoder_int8_compat.onnx'

model = onnx.load(SRC)
graph = model.graph
nodes = list(graph.node)
trilu = [n for n in nodes if n.op_type == 'Trilu']
if len(trilu) != 1:
    sys.exit(f'expected one Trilu, found {len(trilu)}')
tri = trilu[0]
upper = next((a.i for a in tri.attribute if a.name == 'upper'), 1)
produced = {o: n for n in nodes for o in n.output}
src_ones = produced[tri.input[0]]
k_node = produced[tri.input[1]]
fill = numpy_helper.to_array(src_ones.attribute[0].t)
k = int(numpy_helper.to_array(k_node.attribute[0].t))
if src_ones.op_type != 'ConstantOfShape' or fill.dtype != np.bool_ or not bool(fill.reshape(-1)[0]) or k != 1 or upper != 1:
    sys.exit('decoder mask is not Trilu(ones bool, k=1, upper=1); refusing to rewrite')

shape = src_ones.input[0]
p = '/decoder/compat_mask'
axis1 = numpy_helper.from_array(np.array(1, dtype=np.int64), f'{p}/axis1')
axis0 = numpy_helper.from_array(np.array(0, dtype=np.int64), f'{p}/axis0')
graph.initializer.extend([axis0, axis1])
replacement = [
    helper.make_node('ConstantOfShape', [shape], [f'{p}/ones'], name=f'{p}/ones', value=numpy_helper.from_array(np.array([1.0], dtype=np.float32))),
    helper.make_node('CumSum', [f'{p}/ones', axis1.name], [f'{p}/col'], name=f'{p}/col'),
    helper.make_node('CumSum', [f'{p}/ones', axis0.name], [f'{p}/row'], name=f'{p}/row'),
    helper.make_node('Greater', [f'{p}/col', f'{p}/row'], [tri.output[0]], name=f'{p}/greater'),
]
idx = nodes.index(tri)
out = nodes[:idx] + replacement + nodes[idx + 1 :]
# drop the bool ConstantOfShape and k Constant if nothing else reads them
used = {i for n in out for i in n.input}
out = [n for n in out if not (n in (src_ones, k_node) and not any(o in used for o in n.output))]
del graph.node[:]
graph.node.extend(out)
onnx.checker.check_model(model)
onnx.save(model, DST)
print(f'wrote {DST}')
