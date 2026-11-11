"""
Makes the BiRefNet ONNX export runnable in browsers (ONNX Runtime Web).
No weights are changed; only how the same math is expressed.

1. Deformable convolutions. The upstream export expands torchvision's
   deform_conv2d into GatherND/Transpose chains that create dozens of
   400-800 MB tensors (≈6 GB peak on CPU), more than 32-bit WebAssembly can
   address. Each one is replaced by a single ONNX DeformConv (opset 22) node
   with the same input, offsets, modulation mask, weight and bias.
2. Wide Split/Concat. Many WebGPU devices allow only 16 storage buffers per
   shader; Split nodes with 32 outputs and Concat nodes with up to 1024 inputs
   are rewritten as small trees of equivalent Split/Concat nodes.
3. Sum. Sum has no WebGPU kernel; it becomes a tree of Add nodes.

(2) is bit-identical. (1) and (3) can differ by floating-point rounding
order only. scripts/verify-patch.mjs checks the final mask stays within
1/255 of the original.

Usage: python scripts/patch-model.py <in.onnx> <out.onnx>
"""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

MAX_FANOUT = 8

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
graph = model.graph

consts = {init.name: numpy_helper.to_array(init) for init in graph.initializer}
for n in graph.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value":
                consts[n.output[0]] = numpy_helper.to_array(a.t)
init_dtype = {i.name: i.data_type for i in graph.initializer}

counter = [0]
def uid(base):
    counter[0] += 1
    return f"{base}__bghub{counter[0]}"

def attr(node, name, default=None):
    for a in node.attribute:
        if a.name == name:
            return helper.get_attribute_value(a)
    return default

def chunks(seq, n):
    return [seq[i:i + n] for i in range(0, len(seq), n)]

new_inits = []
stats = {"deform": 0, "split": 0, "concat": 0, "sum": 0}

# ---------------------------------------------------------------- 1. DeformConv
by_name = {n.name: n for n in graph.node}
consumers = {}
for n in graph.node:
    for i in n.input:
        consumers.setdefault(i, []).append(n)

replace = {}  # name of node to replace -> list of replacement nodes
prefixes = sorted({n.name[: -len("offset_conv/Conv")] for n in graph.node if n.name.endswith("/atrous_conv/offset_conv/Conv")})
for p in prefixes:
    off = by_name[p + "offset_conv/Conv"]
    mod = by_name[p + "modulator_conv/Conv"]
    sig = by_name[p + "Sigmoid"]
    assert sig.input[0] == mod.output[0]
    (mul,) = [c for c in consumers[sig.output[0]] if c.op_type == "Mul"]
    scale = [consts[i] for i in mul.input if i != sig.output[0]]
    assert len(scale) == 1 and np.allclose(scale[0], 2.0), "expected modulator = 2 * sigmoid(...)"
    conv = by_name[p + "Conv"]
    (add,) = [c for c in consumers[conv.output[0]] if c.op_type == "Add"]
    bias_name = [i for i in add.input if i != conv.output[0]][0]
    x, w = off.input[0], conv.input[1]
    k = list(attr(off, "kernel_shape"))
    pads = list(attr(off, "pads", [0, 0, 0, 0]))
    assert list(attr(off, "strides", [1, 1])) == [1, 1] and list(attr(off, "dilations", [1, 1])) == [1, 1]
    weight = consts[w]
    bias = consts[bias_name].reshape(-1)
    assert bias.shape[0] == weight.shape[0]
    fp16 = init_dtype.get(w) == TensorProto.FLOAT16
    nodes = []
    w32 = uid(p + "weight_f32"); b32 = uid(p + "bias_f32")
    new_inits.append(numpy_helper.from_array(weight.astype(np.float32), w32))
    new_inits.append(numpy_helper.from_array(bias.astype(np.float32), b32))
    ins = []
    for t in (x, off.output[0], mul.output[0]):
        if fp16:
            c = uid(p + "f32")
            nodes.append(helper.make_node("Cast", [t], [c], name=uid(p + "Cast"), to=TensorProto.FLOAT))
            ins.append(c)
        else:
            ins.append(t)
    out = uid(p + "deform_out") if fp16 else add.output[0]
    # ONNX DeformConv inputs: X, W, offset, B, mask (offset/mask layouts match torchvision).
    nodes.append(helper.make_node("DeformConv", [ins[0], w32, ins[1], b32, ins[2]], [out], name=uid(p + "DeformConv"),
                                  kernel_shape=k, pads=pads, strides=[1, 1], dilations=[1, 1], group=1, offset_group=1))
    if fp16:
        nodes.append(helper.make_node("Cast", [out], [add.output[0]], name=uid(p + "Cast"), to=TensorProto.FLOAT16))
    replace[add.name] = nodes
    stats["deform"] += 1

staged = []
for n in graph.node:
    staged.extend(replace.get(n.name, [n]))

# ---------------------------------------------------------------- 2/3. Split, Concat, Sum
new_nodes = []

def emit_split(name, inp, sizes, outputs, axis):
    if len(outputs) <= MAX_FANOUT:
        sz = uid(name + "_sizes")
        new_inits.append(numpy_helper.from_array(np.array(sizes, dtype=np.int64), sz))
        new_nodes.append(helper.make_node("Split", [inp, sz], outputs, name=uid(name), axis=axis))
        return
    groups = chunks(list(range(len(outputs))), -(-len(outputs) // MAX_FANOUT))
    group_sizes = [int(sum(sizes[i] for i in g)) for g in groups]
    group_outs = [uid(name + "_grp") for _ in groups]
    emit_split(name + "_top", inp, group_sizes, group_outs, axis)
    for g, gout in zip(groups, group_outs):
        sub_outs = [outputs[i] for i in g]
        if len(sub_outs) == 1:
            new_nodes.append(helper.make_node("Identity", [gout], sub_outs, name=uid(name + "_id")))
        else:
            emit_split(name + "_sub", gout, [sizes[i] for i in g], sub_outs, axis)

def emit_concat(name, inputs, output, axis):
    if len(inputs) <= MAX_FANOUT:
        new_nodes.append(helper.make_node("Concat", inputs, [output], name=uid(name), axis=axis))
        return
    parts = []
    for c in chunks(inputs, MAX_FANOUT):
        if len(c) == 1:
            parts.append(c[0]); continue
        out = uid(name + "_part")
        new_nodes.append(helper.make_node("Concat", c, [out], name=uid(name), axis=axis))
        parts.append(out)
    emit_concat(name + "_up", parts, output, axis)

for n in staged:
    if n.op_type == "Split" and len(n.output) > MAX_FANOUT:
        sizes = [int(v) for v in consts[n.input[1]].tolist()] if len(n.input) > 1 and n.input[1] else attr(n, "split")
        if sizes is None:
            raise SystemExit(f"Split {n.name} without explicit sizes is not supported")
        emit_split(n.name, n.input[0], sizes, list(n.output), attr(n, "axis", 0))
        stats["split"] += 1
    elif n.op_type == "Concat" and len(n.input) > MAX_FANOUT:
        emit_concat(n.name, list(n.input), n.output[0], attr(n, "axis"))
        stats["concat"] += 1
    elif n.op_type == "Sum" and len(n.input) > 1:
        level = list(n.input)
        while len(level) > 2:
            nxt = []
            for pair in chunks(level, 2):
                if len(pair) == 1: nxt.append(pair[0]); continue
                out = uid(n.name + "_add")
                new_nodes.append(helper.make_node("Add", pair, [out], name=uid(n.name)))
                nxt.append(out)
            level = nxt
        new_nodes.append(helper.make_node("Add", level, [n.output[0]], name=uid(n.name)))
        stats["sum"] += 1
    else:
        new_nodes.append(n)

# ---------------------------------------------------------------- dead-node pruning
needed = {o.name for o in graph.output}
kept = []
for n in reversed(new_nodes):
    if any(o in needed for o in n.output):
        kept.append(n)
        needed.update(i for i in n.input if i)
kept.reverse()
removed = len(new_nodes) - len(kept)
all_inits = list(graph.initializer) + new_inits
del graph.node[:]
graph.node.extend(kept)
del graph.initializer[:]
graph.initializer.extend(i for i in all_inits if i.name in needed)
del graph.value_info[:]

# DeformConv needs opset 22. The ops used here have identical semantics from 17 to 22.
for o in model.opset_import:
    if o.domain in ("", "ai.onnx"):
        o.version = max(o.version, 22)
model.ir_version = max(model.ir_version, 10)

onnx.checker.check_model(model)
onnx.save(model, dst)
print(f"patched: {stats['deform']} deformable convs → DeformConv, {stats['split']} Split, {stats['concat']} Concat, "
      f"{stats['sum']} Sum rewritten; {removed} dead nodes pruned")
