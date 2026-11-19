#!/usr/bin/env python3
"""The dragon on the dragon wall (map prop m001_35) and how it shoots: open its mouth and spit its fireball.

The converted map (props.glb) has the dragon baked stiff in its rest pose. The game's own model
(the MDL0 rip of m001_35) has a small skeleton: joint1 is the head, joint2/joint3 the upper jaw, joint4/joint5 the
lower jaw, and two fireball bones, kazandan (the ball held in its mouth) and kazandan1 (the ball it spits). The head
mesh (polygon1) is skinned to the jaw joints with weights; each fireball is a rigid copy on its own bone; the wall
pieces are rigid on bones the shooting animation never moves.

The shooting animation is files/mr001/map/motion/m001_35_4.branm (CHR0 + VIS0, 51 frames). This samples it into
skin matrices for those seven bones, frame by frame, plus the frames each fireball shows, and writes
js15/world/dragonData.js. The page matches each vertex of the map's own dragon mesh to these points by position, so
it keeps the map's own materials, textures and UVs.

Usage:  python3 tools/extract_dragon.py path/to/m001_35.mdl0 path/to/m001_35_4.branm.lz
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
MOVERS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'kazandan', 'kazandan1']   # matrix 0 is "does not move"
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
# the head: model space, skinned
head = objs['polygon1']; P = M['pos'][head['ids'][0]][1]; seen = {}
for pi, mid in walk(head):
    w = weights(mid)
    if pi in seen:
        if seen[pi] != w: print('note: position', pi, 'drawn with two weightings; keeping the first')
        continue
    seen[pi] = w; pts.append(model_space(pi, mid, P)); jnt.append([j for j, _ in w] + [0] * (4 - len(w))); wts.append([x for _, x in w] + [0] * (4 - len(w)))
# the two fireballs: their own bone's space, placed at rest
for oname, bname in (('polygon2', 'kazandan'), ('polygon0', 'kazandan1')):
    o = objs[oname]; P = M['pos'][o['ids'][0]][1]; W = bones[by_name[bname]]['W']
    for pi in sorted({pi for pi, _ in walk(o)}):
        pts.append(W[:, :3] @ P[pi] + W[:, 3]); jnt.append([slot_of[by_name[bname]], 0, 0, 0]); wts.append([1, 0, 0, 0])

# ---- the animation
a = open(anm_path, 'rb').read(); a = unlz(a) if a[:4] != b'bres' else a
R = brres(a); name = next(iter(R['AnmChr(NW4R)'])); C = chr0(a, R['AnmChr(NW4R)'][name]); frames = C['frames']
def local(bi, f):
    b = bones[bi]; tr = C['bones'].get(b['name'], {}).get('tracks', {})
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
# check: the CHR0 rest values rebuild the model's own bind matrices
for n in MOVERS:
    bi = by_name[n]; err = np.abs(world(bi, 0)[:3] - bones[bi]['W']).max() if n.startswith('joint') else 0
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
# the visibility of the two balls (VIS0: one bit per frame, most significant first)
vis = {}
v = R['AnmVis(NW4R)'][name]
for bn, e in group(a, v + be('i', a, v + 0x10)[0]):
    fl = be('I', a, e + 4)[0]
    if bn in ('kazandan', 'kazandan1'):
        vis[bn] = [fl & 1] * frames if fl & 2 else [int(c) for c in ''.join(format(be('I', a, e + 8 + 4 * k)[0], '032b') for k in range((frames + 31) // 32))[:frames]]
spit = vis['kazandan1'].index(1)
ballW = [[round(float(x), 3) for x in world(by_name['kazandan1'], f)[:3].ravel()] for f in range(frames)]
data = {
    'frames': frames, 'spit': spit, 'movers': MOVERS,
    'points': [round(float(x), 2) for p in pts for x in p], 'joints': [j for r in jnt for j in r], 'weights': [round(float(x), 3) for r in wts for x in r],
    'skin': mats, 'show': vis, 'ballWorld': ballW,
    'ballInv': [round(float(x), 6) for x in rest_inv['kazandan1'][:3].ravel()],
}
out = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'dragonData.js')
with open(out, 'w') as f:
    f.write('// Generated by tools/extract_dragon.py from the dragon wall model (m001_35) and its shooting animation\n')
    f.write('// (files/mr001/map/motion/m001_35_4.branm). Do not edit. Map units, the model\'s own space.\n')
    f.write('export const DRAGON = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print(f'{len(pts)} points ({len(seen)} on the head), {frames} frames, the ball leaves at frame {spit} -> {os.path.normpath(out)} ({os.path.getsize(out)//1024} KB)')
