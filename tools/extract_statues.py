#!/usr/bin/env python3
"""The throwing statues (map props m001_30, blue, and m001_31, red) and the game's own animations of them.

The converted map (props.glb) has each statue baked stiff in its bind pose, with every piece the game's model holds:
the base and body, the head, the jaw, the gem on the chest (twice: dark and lit), the eyes (red: twice, dark and lit),
the hands at its sides and a second pair of hands out in front (blue: lying flat where the player gets on; red: where
it grabs the player). In the game's model (map.brres) every piece is rigid on one bone, so each vertex of the map's
mesh is matched here to the bone it belongs to (by position and UV: an exact match for every vertex).

The animations are files/mr001/map/motion/*.branm (CHR0 bone tracks + VIS0 visibility, 60 frames a second):
  m001_30_1  blue wakes: it rattles, the gem lights, the side hands swing round to the front and lie flat for the
             player, nodding all the while (301 frames)
  m001_30_2  blue throws: the hands sink with the player on them, then fling them up and over (101 frames)
  m001_31_1  red: it rattles, the gem and eyes light, it opens its mouth, its hands swing round and grab the player,
             lift them over its head and throw them (391 frames)
For each clip this keeps the bone tracks (each of T, R, S's numbers either constant or one value per frame) and the
frames where a piece shows or hides. The page rebuilds the bone matrices from them (js15/world/statueRig.js).

One change to the game's data: the red statue keeps its mouth open all through its throw. Here it shuts its mouth as it
lifts the player over its head (the jaw follows the head from frame 288 to 318) and opens it again for the throw.

Usage:  python3 tools/extract_statues.py path/to/map.brres(.lz) path/to/motion/ path/to/props.glb
"""
import sys, os, json, math, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
import numpy as np
from lz import unlz
from brres import brres, be, group
from mdl0 import mdl0
from mesh import read_obj
from chr0 import chr0, sample

raw = open(sys.argv[1], 'rb').read(); d = raw if raw[:4] == b'bres' else unlz(raw)
R = brres(d); MODELS = R['3DModels(NW4R)']; MOT = sys.argv[2]
g = open(sys.argv[3], 'rb').read(); L = struct.unpack('<I', g[12:16])[0]; J = json.loads(g[20:20 + L]); bo = 20 + L + 8
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = {'VEC3': 3, 'VEC2': 2}[a['type']]
    return np.frombuffer(g, '<f4', a['count'] * n, bo + bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, n)

def rot(r):
    x, y, z = [math.radians(v) for v in r]
    Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx
def trs(T, Rr, S):
    m = np.eye(4); m[:3, :3] = rot(Rr) @ np.diag(S); m[:3, 3] = T; return m

def load_clip(name):
    a = open(os.path.join(MOT, name + '.branm.lz'), 'rb').read(); a = unlz(a) if a[:4] != b'bres' else a
    r = brres(a); nm = next(iter(r['AnmChr(NW4R)'])); C = chr0(a, r['AnmChr(NW4R)'][nm]); F = C['frames']
    vis = {}
    for v in r.get('AnmVis(NW4R)', {}).values():
        for bn, e in group(a, v + be('i', a, v + 0x10)[0]):
            fl = be('I', a, e + 4)[0]
            vis[bn] = [fl & 1] * F if fl & 2 else [int(c) for c in ''.join(format(be('I', a, e + 8 + 4 * k)[0], '032b') for k in range((F + 31) // 32))[:F]]
    return C, vis

STEP = 2                              # one value every two frames (the page draws between them)
GLARE = ('mr001m031', 'mr001m032')   # the see-through glare cards in front of the face: never shown on this page
def statue(model, clips, edit=None):
    M = mdl0(d, MODELS[model]); bones = M['bones']; by = {b['name']: i for i, b in enumerate(bones)}
    root = bones[0]; assert root['parent'] < 0 and np.abs(root['W'] - np.eye(4)[:3]).max() < 1e-6, 'the root bone is the identity'
    assert all(b['parent'] in (-1, 0) for b in bones), 'every bone hangs straight off the root'
    for i, b in enumerate(bones):  # the rest values rebuild the bind matrices
        assert np.abs(trs(b['T'], b['R'], b['S'])[:3] - b['W']).max() < 1e-3, b['name']
    order = sorted(M['mats'], key=lambda n: M['mats'][n])
    draws = M['defs']['DrawOpa'] + M['defs'].get('DrawXlu', [])
    # ---- which bone each vertex of the map's mesh is on
    me = [m for m in J['meshes'] if m['name'] == model][0]
    slots, bind = [], {}
    for p in me['primitives']:
        mat = J['materials'][p['material']]['name']
        if mat in GLARE: continue
        GP = acc(p['attributes']['POSITION']); GU = acc(p['attributes']['TEXCOORD_0'])
        cands = []
        for x in draws:
            if order[x[1]] != mat: continue
            o = M['objs'][x[2]]; vs, _ = read_obj(d, o); P = M['pos'][o['ids'][0]][1]; U = M['uv'][o['ids'][4]][1]; W = bones[x[3]]['W']
            for v in vs: cands.append((x[3], W[:, :3] @ P[v['pos']] + W[:, 3], U[v['uv0']]))
        cp = np.array([c[1] for c in cands]); cu = np.array([c[2] for c in cands]); s = ''
        for gi in range(len(GP)):
            e = np.abs(cp - GP[gi]).sum(1) + np.abs(cu - GU[gi]).sum(1) * 100; c = int(np.argmin(e))
            assert e[c] < 0.01, (model, mat, gi, e[c])
            assert len({cands[k][0] for k in np.where(e < 0.01)[0]}) == 1, (model, mat, gi, 'two bones')
            bn = bones[cands[c][0]]['name']
            if bn not in slots: slots.append(bn)
            s += '0123456789abcdefghijklmnopqrstuv'[slots.index(bn)]
        bind[mat] = s
    names = slots + ['hook_player']
    inv = {n: [round(float(x), 6) for x in np.linalg.inv(trs(bones[by[n]]['T'], bones[by[n]]['R'], bones[by[n]]['S']))[:3].ravel()] for n in names}
    rest = {n: [round(float(x), 4) for x in list(bones[by[n]]['T']) + list(bones[by[n]]['R']) + list(bones[by[n]]['S'])] for n in names}
    out = {'slots': slots, 'inv': inv, 'rest': rest, 'bind': bind, 'clips': {}}
    for key, clip in clips.items():
        C, vis = load_clip(clip); F = C['frames']
        tr = {}
        for n in names:
            t = C['bones'].get(n, {}).get('tracks', {}); b = bones[by[n]]
            comp = []
            for k, rest_v in (('T', b['T']), ('R', b['R']), ('S', b['S'])):
                for c in range(3):
                    x = t[k][c] if k in t else float(rest_v[c])
                    comp.append([float(x)] * F if isinstance(x, float) else [sample(x, f) for f in range(F)])
            tr[n] = comp
        if edit: edit(key, tr, F)
        bones_out = {}
        for n in names:
            cs = []
            for c, vals in enumerate(tr[n]):
                dec = 1 if c < 3 else 2 if c < 6 else 3
                if max(vals) - min(vals) < 1e-3: cs.append(round(vals[0], dec)); continue
                # held before `a` and after `b`; in between one value every STEP frames: [a, values...]
                a = 0
                while a < F - 1 and abs(vals[a + 1] - vals[0]) < 1e-5: a += 1
                b = F - 1
                while b > 0 and abs(vals[b - 1] - vals[-1]) < 1e-5: b -= 1
                cs.append([a] + [round(vals[min(F - 1, f)], dec) for f in range(a, b + STEP, STEP)])
            if all(not isinstance(x, list) for x in cs) and all(abs(x - y) < 1e-3 for x, y in zip(cs, rest[n])): continue  # at rest the whole clip
            bones_out[n] = cs
        shows = {}
        for n in names:
            if n not in vis: continue
            bits = vis[n]; ch = [f for f in range(1, F) if bits[f] != bits[f - 1]]
            shows[n] = [bits[0]] + ch
        out['clips'][key] = {'frames': F, 'bones': bones_out, 'shows': shows}
    return out

def red_mouth(key, tr, F):
    """The red statue shuts its mouth while it lifts the player over its head, and opens it again for the throw."""
    smooth = lambda t: (lambda c: c * c * (3 - 2 * c))(min(1, max(0, t)))
    for f in range(F):
        k = smooth((f - 288) / 30) if f < 346 else 1 - smooth((f - 346) / 8)
        if k <= 0: continue
        for c in range(9): tr['i_jaw'][c][f] += (tr['i_head'][c][f] - tr['i_jaw'][c][f]) * k

data = {
    'm001_30': statue('m001_30', {'wake': 'm001_30_1', 'launch': 'm001_30_2'}),
    'm001_31': statue('m001_31', {'throw': 'm001_31_1'}, red_mouth),
}
data['fps'] = 60; data['step'] = STEP
dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'statueData.js')
with open(dst, 'w') as f:
    f.write('// Generated by tools/extract_statues.py from the game\'s map.brres (m001_30, m001_31) and its statue animations\n')
    f.write('// (files/mr001/map/motion/m001_30_1, m001_30_2, m001_31_1). Do not edit. Map units, the model\'s own space.\n')
    f.write('// bind: for each vertex of the map\'s mesh (props.glb, by material, in order), the bone it is on (a letter: slots[n]).\n')
    f.write('// clips: per bone the nine numbers T, R (degrees), S, each a constant or [first frame it moves, then one value every `step` frames,\n// held after the last]; shows: [shown at frame 0, the frames it flips].\n')
    f.write('export const STATUES = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print({m: {'slots': data[m]['slots'], 'bind': {k: len(v) for k, v in data[m]['bind'].items()}, 'clips': {k: (c['frames'], list(c['bones'])) for k, c in data[m]['clips'].items()}} for m in ('m001_30', 'm001_31')})
print(os.path.normpath(dst), os.path.getsize(dst) // 1024, 'KB')
