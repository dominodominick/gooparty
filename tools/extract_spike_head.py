#!/usr/bin/env python3
"""The spike statue's head (map prop m001_50): its jaws, so it can open its mouth to spit the spike ball.

The game's model of the statue (the MDL0 rip of m001_50) has a jaw skeleton, joint1..joint6, and the head mesh
(polygon32) is skinned to it with weights. Its animation files/mr001/map/motion/m001_50_1.branm (CHR0, 300 frames) is
the whole spit-and-chase: the jaws snap open in the first 8 frames, the ball is spat out at frames 20-40, the jaws stay
open while the ball rolls, and close again in the last dozen frames. This keeps the jaws' part of it: the skin matrices
of the six joints for the opening (frames 0-20) and the closing (frames 288-300), relative to the rest pose, and the
head's points so the page can match the map's own head mesh by position (as tools/extract_dragon.py does for the dragon).

Usage:  python3 tools/extract_spike_head.py path/to/m001_50.mdl0 path/to/m001_50_1.branm.lz
"""
import sys, os, json, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
import numpy as np
from lz import unlz
from brres import brres, be, group
from mdl0 import mdl0
from mesh import attrs
from chr0 import chr0, sample

mdl_path, anm_path = sys.argv[1], sys.argv[2]
d = open(mdl_path, 'rb').read()
M = mdl0(d, 0)
bones = M['bones']; by_name = {b['name']: i for i, b in enumerate(bones)}; by_mtx = {b['mtx']: i for i, b in enumerate(bones)}
MOVERS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']   # matrix 0 is "does not move"
slot_of = {by_name[n]: k + 1 for k, n in enumerate(MOVERS)}

# ---- the matrix weights: NodeMix ('mix' = weighted list of bone matrices, 'dup' = one bone)
mix, single = {}, {}
for op in M['defs']['NodeMix']:
    if op[0] == 'mix': mix[op[1]] = [(by_mtx[m], w) for m, w in op[2]]
    elif op[0] == 'dup': mix[op[1]] = [(op[2], 1.0)]; single[op[1]] = op[2]
def model_space(pi, mid, P):
    """A vertex drawn with one bone's own matrix ('dup') is stored in that bone's space; a weighted one in the model's."""
    if mid in single: W = bones[single[mid]]['W']; return W[:, :3] @ P[pi] + W[:, 3]
    return P[pi]
def weights(mid):
    ws = mix.get(mid) or [(by_mtx[mid], 1.0)]
    ws = sorted(ws, key=lambda x: -x[1])[:4]; s = sum(w for _, w in ws)
    return [(slot_of.get(b, 0), w / s) for b, w in ws]

def walk(o):
    """The object's display list: each vertex with its position index and the matrix it was drawn with."""
    L = attrs(o['vlo'], o['vhi']); p = o['addr'] + 0x24 + o['doff']; end = p + o['dlen']; slots = {}; out = []
    while p < end:
        op = d[p]
        if op == 0: p += 1; continue
        if op == 0x08: p += 6; continue
        if op == 0x10: n = be('H', d, p + 1)[0] + 1; p += 5 + 4 * n; continue
        if op in (0x20, 0x28, 0x30, 0x38):
            idx, ad = be('HH', d, p + 1)
            if op == 0x20: slots[(ad & 0xFFF) // 12] = idx
            p += 5; continue
        n = be('H', d, p + 1)[0]; p += 3
        for _ in range(n):
            v = {}
            for nm, m in L:
                if nm == 'pnm' or nm.startswith('tm'): v[nm] = d[p]; p += 1
                elif m == 2: v[nm] = d[p]; p += 1
                else: v[nm] = be('H', d, p)[0]; p += 2
            out.append((v['pos'], slots.get(v.get('pnm', 0) // 3) if 'pnm' in v else None))
    return out

objs = {o['name']: o for o in M['objs']}
pts, jnt, wts = [], [], []
# the head: model space, skinned (the one object with no single bone of its own)
head = [o for o in M['objs'] if o['node'] < 0][0]; P = M['pos'][head['ids'][0]][1]; seen = {}
for pi, mid in walk(head):
    w = weights(mid)
    if pi in seen: continue
    seen[pi] = w; pts.append(model_space(pi, mid, P)); jnt.append([j for j, _ in w] + [0] * (4 - len(w))); wts.append([x for _, x in w] + [0] * (4 - len(w)))
# ---- the animation
a = open(anm_path, 'rb').read(); a = unlz(a) if a[:4] != b'bres' else a
R = brres(a); name = next(iter(R['AnmChr(NW4R)'])); C = chr0(a, R['AnmChr(NW4R)'][name]); frames = C['frames']
def local(bi, f):
    b = bones[bi]; tr = C['bones'].get(b['name'], {}).get('tracks', {})
    if b['name'] == 'joint1': tr = {}  # the CHR0 also carries the whole head from the model's centre onto its block with
    # T(-1250, 2400, 0) R(-180, 0, 104) (the page's own placement of the head, give or take 25 units) and never moves it
    # after that: the page places the head itself, so the jaws are kept relative to joint1 where the model has it
    val = lambda k, rest: [sample(x, f) if not isinstance(x, float) else x for x in tr[k]] if k in tr else list(rest)
    S, Rr, T = val('S', b['S']), val('R', b['R']), val('T', b['T'])
    x, y, z = [math.radians(v) for v in Rr]
    Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    m = np.eye(4); m[:3, :3] = Rz @ Ry @ Rx @ np.diag(S); m[:3, 3] = T; return m
def world(bi, f):
    m = local(bi, f); p = bones[bi]['parent']
    return world(p, f) @ m if p >= 0 else m
def h(W34): m = np.eye(4); m[:3] = W34; return m
# check: with joint1 kept where the model has it, the CHR0's first frame rebuilds the model's own bind matrices
for n in MOVERS:
    bi = by_name[n]; err = np.abs(world(bi, 0)[:3] - bones[bi]['W']).max()
    assert err < 0.05, (n, err)
rest_inv = {n: np.linalg.inv(world(by_name[n], 0)) for n in MOVERS}
mats = []
for f in range(frames):
    row = []
    for n in MOVERS:
        bi = by_name[n]; S = world(bi, f) @ rest_inv[n]  # relative to the first frame: frame 0 is exactly the map's rest pose
        row += [round(float(x), 4) for x in S[:3].ravel()]
    mats.append(row)
# check: frame 0 leaves the head where it is
assert all(abs(x - y) < 1e-4 for x, y in zip(mats[0][:12], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]))
OPEN, CLOSE = list(range(0, 21)), list(range(288, frames))
data = {
    'points': [round(float(x), 2) for p in pts for x in p], 'joints': [j for r in jnt for j in r], 'weights': [round(float(x), 3) for r in wts for x in r],
    'open': [mats[f] for f in OPEN], 'close': [mats[f] for f in CLOSE] + [mats[0]],
}
out = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'spikeHeadData.js')
with open(out, 'w') as f:
    f.write('// Generated by tools/extract_spike_head.py from the spike statue model (m001_50) and its spit animation\n')
    f.write('// (files/mr001/map/motion/m001_50_1.branm). Do not edit. Map units, the model\'s own space.\n')
    f.write('export const SPIKE_HEAD = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print(f'{len(pts)} points on the head, open {len(OPEN)} frames, close {len(CLOSE)+1} frames -> {os.path.normpath(out)} ({os.path.getsize(out)//1024} KB)')
