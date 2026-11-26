#!/usr/bin/env python3
"""The game's own animations for smashing the challenges, for js15/world/breakRig.js.

  dragon: the dragon wall (map prop m001_35): hit (m001_35_2, the jolt each time it is struck) and break (m001_35_3,
          it is blown to pieces).
  gate:   the summit gate (m001_60): hit (m001_60_2) and break (m001_60_3).
  ball:   the spike ball in the statue's mouth (the bibp_* pieces of m001_50): explode (m001_50_2).

Each model's pieces are read from the game's own model in map.brres (MDL0): every piece (object) is drawn on one
bone, except the dragon's head, which is weighted over its jaw joints. For every point of every piece: where it is in
the model's own space (as the converted map has it), and the bones it follows (4 each, with weights). Each animation
(CHR0) is sampled every STEP frames into one 3x4 matrix per bone, relative to the model's rest pose (so frame 0 leaves
the map's mesh as it is), plus which bones are hidden (VIS0). The hit spots the game puts its hit effect on
(hook_hit1..5, hook_break) are kept too.

The page matches the map's own meshes to these points by position (so the map's materials and UVs stay), see breakRig.js.

  python3 tools/extract_breaks.py <map.brres(.lz)> <folder with m001_35_2.branm.lz ...>
writes js15/world/breakData.js.
"""
import sys, os, json, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
import numpy as np
from lz import unlz
from brres import brres, be, group
from mdl0 import mdl0
from mesh import attrs
from chr0 import chr0, sample

STEP = 2
SETS = {
    'dragon': ('m001_35', {'hit': 'm001_35_2', 'break': 'm001_35_3'}, None),
    'gate': ('m001_60', {'hit': 'm001_60_2', 'break': 'm001_60_3'}, None),
    'ball': ('m001_50', {'explode': 'm001_50_2'}, 'bibp_'),  # only the ball's pieces
}

map_path, motion_dir = sys.argv[1], sys.argv[2]
d = open(map_path, 'rb').read(); d = unlz(d) if d[:4] != b'bres' else d
MAP = brres(d)


def load(path):
    a = open(path, 'rb').read(); return unlz(a) if a[:4] != b'bres' else a


def extract(model, clips, only):
    M = mdl0(d, MAP['3DModels(NW4R)'][model])
    bones = M['bones']; by_name = {b['name']: i for i, b in enumerate(bones)}; by_mtx = {b['mtx']: i for i, b in enumerate(bones)}
    mix, single = {}, {}
    for op in M['defs'].get('NodeMix', []):
        if op[0] == 'mix': mix[op[1]] = [(by_mtx[m], w) for m, w in op[2]]
        elif op[0] == 'dup': mix[op[1]] = [(op[2], 1.0)]; single[op[1]] = op[2]

    def walk(o):
        """The object's display list: each vertex's position index and the matrix it was drawn with."""
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

    # ---- the points: every piece, in the model's own space, with the bones each follows
    draw = M['defs'].get('DrawOpa', []) + M['defs'].get('DrawXlu', [])
    pts, wts = [], []   # wts: [(bone index, weight)] per point
    for _, mi, oi, bi, _p in draw:
        o = M['objs'][oi]
        if only and not bones[bi]['name'].startswith(only): continue
        P = M['pos'][o['ids'][0]][1]; seen = set()
        if P.shape[1] == 2: P = np.hstack([P, np.zeros((len(P), 1))]) # (a flat piece stores x, y only)
        for pi, mid in walk(o):
            key = (pi, mid)
            if key in seen: continue
            seen.add(key)
            if mid is not None and mid in mix and mid not in single: # weighted over several bones: stored in the model's space
                ws = sorted(mix[mid], key=lambda x: -x[1])[:4]; s = sum(w for _, w in ws)
                pts.append(np.array(P[pi], float)); wts.append([(b, w / s) for b, w in ws])
            else: # one bone: stored in that bone's space
                b = single.get(mid, bi) if mid is not None else bi
                if mid is not None and mid not in single: b = by_mtx.get(mid, bi)
                W = bones[b]['W']; pts.append(W[:, :3] @ np.array(P[pi], float) + W[:, 3]); wts.append([(b, 1.0)])

    # ---- the animations
    anims = {}
    for key, name in clips.items():
        a = load(os.path.join(motion_dir, name + '.branm.lz')); R = brres(a)
        C = chr0(a, R['AnmChr(NW4R)'][name]); frames = C['frames']
        vis = {}
        if 'AnmVis(NW4R)' in R:
            v = R['AnmVis(NW4R)'][name]
            for bn, e in group(a, v + be('i', a, v + 0x10)[0]):
                fl = be('I', a, e + 4)[0]
                vis[bn] = [fl & 1] * frames if fl & 2 else [int(c) for c in ''.join(format(be('I', a, e + 8 + 4 * k)[0], '032b') for k in range((frames + 31) // 32))[:frames]]
        anims[key] = (C, frames, vis)

    def local(C, bi, f):
        b = bones[bi]; tr = C['bones'].get(b['name'], {}).get('tracks', {})
        val = lambda k, rest: [sample(x, f) if not isinstance(x, float) else x for x in tr[k]] if k in tr else list(rest)
        S, Rr, T = val('S', b['S']), val('R', b['R']), val('T', b['T'])
        x, y, z = [math.radians(q) for q in Rr]
        Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
        Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
        Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
        m = np.eye(4); m[:3, :3] = Rz @ Ry @ Rx @ np.diag(S); m[:3, 3] = T; return m

    def world(C, bi, f):
        m = local(C, bi, f); p = bones[bi]['parent']
        return world(C, p, f) @ m if p >= 0 else m

    def bind(bi): m = np.eye(4); m[:3] = bones[bi]['W']; return m

    def hidden_by(vis, bi, f):
        """A bone is hidden when it or any bone above it is hidden at frame f."""
        while bi >= 0:
            n = bones[bi]['name']
            if n in vis and not vis[n][min(f, len(vis[n]) - 1)]: return True
            bi = bones[bi]['parent']
        return False

    used = sorted({b for ws in wts for b, _ in ws})
    # which bones really move (or hide) in some clip: the rest stay put (matrix 0)
    movers = []
    for bi in used:
        inv = np.linalg.inv(bind(bi)); moves = False
        for C, frames, vis in anims.values():
            for f in range(0, frames, 4):
                if hidden_by(vis, bi, f) or np.abs((world(C, bi, f) @ inv)[:3] - np.eye(4)[:3]).max() > 1e-3: moves = True; break
            if moves: break
        if moves: movers.append(bi)
    slot = {bi: k + 1 for k, bi in enumerate(movers)}
    J, Wt = [], []
    for ws in wts:
        js = [slot.get(b, 0) for b, _ in ws] + [0] * (4 - len(ws)); w = [x for _, x in ws] + [0] * (4 - len(ws))
        J += js; Wt += [round(x, 3) for x in w]
    out_clips = {}
    for key, (C, frames, vis) in anims.items():
        samples = list(range(0, frames, STEP)) + ([frames - 1] if (frames - 1) % STEP else [])
        mats = []
        for f in samples:
            row = []
            for bi in movers:
                if hidden_by(vis, bi, f): row += [0] * 12; continue
                S = world(C, bi, f) @ np.linalg.inv(bind(bi))
                row += [round(float(x), 4) if k % 4 != 3 else round(float(x), 2) for k, x in enumerate(S[:3].ravel())]
            mats.append(row)
        out_clips[key] = {'frames': frames, 'samples': samples, 'mats': mats}
    hooks = {b['name'][5:]: [round(float(x), 2) for x in b['W'][:, 3]] for b in bones if b['name'].startswith('hook_')}
    return {
        'model': model, 'step': STEP, 'movers': [bones[bi]['name'] for bi in movers],
        'points': [round(float(x), 2) for p in pts for x in p], 'joints': J, 'weights': Wt,
        'hooks': hooks, 'clips': out_clips,
    }


data = {}
for key, (model, clips, only) in SETS.items():
    data[key] = extract(model, clips, only)
    D = data[key]
    print(f"{key}: {D['model']}, {len(D['points']) // 3} points, {len(D['movers'])} moving bones, clips " + ', '.join(f"{k} {c['frames']}f" for k, c in D['clips'].items()) + f", hooks {sorted(D['hooks'])}")
out = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'breakData.js')
with open(out, 'w') as f:
    f.write('// Generated by tools/extract_breaks.py from the game\'s models (map.brres: m001_35, m001_60, m001_50) and their\n')
    f.write('// hit / break animations (files/mr001/map/motion/m001_35_2, _35_3, _60_2, _60_3, _50_2). Do not edit.\n')
    f.write('// Map units, each model\'s own space. See breakRig.js.\n')
    f.write('export const BREAKS = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('->', os.path.normpath(out), os.path.getsize(out) // 1024, 'KB')
