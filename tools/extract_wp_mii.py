#!/usr/bin/env python3
"""Wii Party's own Mii body and its animations, from the game's files (files/ch_base/):
  player/pl026.brres  the Mii body in Board Game Island's explorer suit: the suit (wear00, its picture: pockets, belt,
                      collar, boots; the rest is the player's colour) and skin (hands, neck, legs), skinned to a skeleton
  player_motion.branm the Mii animations (480 of them, pm000_xx shared, pm001_xx Board Game Island, ...)
Writes js15/world/wpMiiData.js: the skeleton (rest pose), the three skinned meshes (model space, one or two bones per
vertex), and the clips named in CLIPS, each baked per bone as a turn (quaternion) and place every STEP frames.

Usage:  python3 tools/extract_wp_mii.py path/to/ch_base/ [--all out.json]
  --all writes every pm000/pm001 clip to out.json instead (for looking through them).
  --gallery writes every pm000/pm001 clip to js15/world/wpMiiAllClips.js (the island viewer's animation gallery).
"""
import sys, os, json, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
import numpy as np
from lz import unlz
from brres import brres, be
from mdl0 import mdl0
from mesh import read_obj
from chr0 import chr0, sample

STEP = 2
# the clips the game plays (name in the game -> Wii Party's clip); see js15/world/wpMii.js
CLIPS = {
    'idle': 'pm000_01', 'walk': 'pm000_03', 'run': 'pm000_04', 'jump': 'pm000_05', 'boardIdle': 'pm001_02',
    'fly': 'pm001_11', 'tumble': 'pm001_09', 'knock': 'pm001_04', 'sitStunned': 'pm001_05', 'land': 'pm001_12',
    'swim': 'pm001_14', 'hang': 'pm001_13', 'hit': 'pm001_06', 'cheer': 'pm001_10', 'sad': 'pm001_16', 'win': 'pm001_17',
    'scared': 'pm001_19', 'springUp': 'pm001_15',
}

def load(p):
    d = open(p, 'rb').read(); return d if d[:4] == b'bres' else unlz(d)

def rot(r):
    x, y, z = [math.radians(v) for v in r]
    Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1) * 2; w = s / 4; x = (m[2, 1] - m[1, 2]) / s; y = (m[0, 2] - m[2, 0]) / s; z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s; x = s / 4; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s; x = (m[0, 1] + m[1, 0]) / s; y = s / 4; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s; x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = s / 4
    return [x, y, z, w]

CH = sys.argv[1]
BODY = 'pl026'  # Board Game Island's outfit: the explorer suit (shirt with pockets and belt, shorts, boots); pl001 is the plain body
d = load(os.path.join(CH, 'player', BODY + '.brres.lz'))
R = brres(d); M = mdl0(d, R['3DModels(NW4R)'][BODY])
bones = M['bones']
mtx_bone = {b['mtx']: i for i, b in enumerate(bones)}
infl = {}  # matrix id -> [(bone, weight)]
for b in bones: infl[b['mtx']] = [(mtx_bone[b['mtx']], 1.0)]
for op in M['defs']['NodeMix']:
    if op[0] == 'mix': infl[op[1]] = [(mtx_bone[i], w) for i, w in op[2]]
    elif op[0] == 'dup': infl[op[1]] = [(op[2], 1.0)]

def world(i):
    b = bones[i]; m = np.eye(4); m[:3, :3] = rot(b['R']) @ np.diag(b['S']); m[:3, 3] = b['T']
    return world(b['parent']) @ m if b['parent'] >= 0 else m

mat_order = sorted(M['mats'], key=lambda n: M['mats'][n])
_wc = {}
_world = world
world = lambda i: _wc[i] if i in _wc else _wc.setdefault(i, _world(i))
meshes = []
for op in M['defs']['DrawOpa']:
    _, mat, obj, bone, _ = op
    o = M['objs'][obj]; vs, tris = read_obj(d, o)
    a = o['addr']; tbl = a + be('i', d, a + 0x64)[0]; n = be('I', d, tbl)[0]; ids = be(f'{n}H', d, tbl + 4)
    P = M['pos'][o['ids'][0]][1]; N = M['nrm'][o['ids'][1]][1]
    UV = M['uv'][o['ids'][4]][1] if o['ids'][4] >= 0 else None
    pos, nrm, ji, jw, uv = [], [], [], [], []
    for v in vs:
        mid = v['mid'] if v.get('mid') is not None else bones[bone]['mtx']
        inf = sorted(infl[mid], key=lambda x: -x[1])[:2] + [(0, 0.0)] * 2
        p = P[v['pos']]; q = N[v['nrm']]
        if len(infl[mid]) == 1: # (a vertex on one bone is stored in that bone's own space; envelope vertices in the model's)
            W = world(infl[mid][0][0]); p = W[:3, :3] @ p + W[:3, 3]; q = W[:3, :3] @ q
        pos += [round(float(c), 3) for c in p]; nrm += [round(float(c), 3) for c in q]
        ji += [inf[0][0], inf[1][0]]; jw += [round(inf[0][1], 3), round(inf[1][1], 3)]
        uv += [round(float(c), 4) for c in UV[v['uv0']]] if UV is not None else [0.0, 0.0]
    # one vertex per distinct (place, normal, bones, weights, texture place)
    key, remap, P2, N2, J2, W2, T2 = {}, [], [], [], [], [], []
    for k in range(len(vs)):
        t = (tuple(pos[3 * k:3 * k + 3]), tuple(nrm[3 * k:3 * k + 3]), tuple(ji[2 * k:2 * k + 2]), tuple(jw[2 * k:2 * k + 2]), tuple(uv[2 * k:2 * k + 2]))
        if t not in key: key[t] = len(key); P2 += t[0]; N2 += t[1]; J2 += t[2]; W2 += t[3]; T2 += t[4]
        remap.append(key[t])
    idx = [remap[int(i)] for t in tris for i in t]
    # smooth normals from the shape itself, with creases: each corner of a face gets the area-weighted normals of the
    # faces round the same place that bend less than 60 degrees from it (so a hem or a cuff stays a sharp edge)
    V = np.array(P2).reshape(-1, 3); faces = list(zip(idx[0::3], idx[1::3], idx[2::3])); at = {}
    FN = [np.cross(V[c_] - V[a_], V[b_] - V[a_]) for a_, b_, c_ in faces]  # (the Wii winds its triangles the other way round)
    for f_, tri in enumerate(faces):
        for v_ in tri: at.setdefault(tuple(np.round(V[v_], 2)), []).append(f_)
    unit = lambda x: x / (np.linalg.norm(x) or 1)
    out_key, P3, N3, J3, W3, T3, idx3 = {}, [], [], [], [], [], []
    for f_, tri in enumerate(faces):
        me = unit(FN[f_])
        for v_ in tri:
            n_ = sum((FN[g] for g in at[tuple(np.round(V[v_], 2))] if np.dot(unit(FN[g]), me) > 0.5), np.zeros(3))
            n_ = [round(float(x), 3) for x in unit(n_)]
            k_ = (v_, tuple(n_))
            if k_ not in out_key:
                out_key[k_] = len(out_key); P3 += P2[3 * v_:3 * v_ + 3]; N3 += n_; J3 += J2[2 * v_:2 * v_ + 2]; W3 += W2[2 * v_:2 * v_ + 2]; T3 += T2[2 * v_:2 * v_ + 2]
            idx3.append(out_key[k_])
    P2, N2, J2, W2, T2, idx = P3, N3, J3, W3, T3, idx3
    meshes.append({'mat': mat_order[mat], 'pos': P2, 'nrm': N2, 'ji': J2, 'jw': W2, 'idx': idx, **({'uv': T2} if UV is not None else {})})

# the outfit's own picture (pockets, belt, collar, boots): where it is see-through the shirt is the player's colour
import io, base64
from PIL import Image
from tex0 import tex0
tex = {}
inv_mat = {i: n for n, i in M['mats'].items()}
for t, refs in M['texlinks'].items():
    if t in ('RIMTEXq', 'body_hl'): continue  # (the rim light and highlight: lighting the game does its own way)
    # two opaque pictures, the colours and the mix (its alpha, as grey): a browser loses the colour of see-through pixels
    arr, _ = tex0(d, R['Textures(NW4R)'][t]); urls = []
    for im in (Image.fromarray(arr[..., :3].copy(), 'RGB'), Image.fromarray(arr[..., 3].copy(), 'L')):
        buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); urls.append('data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode())
    for m_, _ in refs: tex[inv_mat.get(m_, 'wear00')] = {'rgb': urls[0], 'mix': urls[1]}

skel = [{'name': b['name'], 'parent': b['parent'], 't': [round(x, 4) for x in b['T']], 'r': [round(x, 4) for x in b['R']], 's': [round(x, 4) for x in b['S']],
         'inv': [round(float(x), 5) for x in np.linalg.inv(world(i))[:3].ravel()]} for i, b in enumerate(bones)]

# ---- animations
a = load(os.path.join(CH, 'player_motion.branm.lz')); ra = brres(a)
def bake(name):
    C = chr0(a, ra['AnmChr(NW4R)'][name]); F = C['frames']; out = {}
    for i, b in enumerate(bones):
        e = C['bones'].get(b['name'])
        if not e: continue
        t, code = e['tracks'], e['code']; ident = code >> 1 & 1
        frames = []
        for f in list(range(0, F, STEP)) + ([F - 1] if (F - 1) % STEP else []):
            vals = {}
            for k, rest, idv, flag in (('T', b['T'], (0, 0, 0), ident or code >> 2 & 1), ('R', b['R'], (0, 0, 0), ident or code >> 2 & 1), ('S', b['S'], (1, 1, 1), ident or code >> 3 & 1)):
                vals[k] = [sample(x, f) if not isinstance(x, float) else x for x in t[k]] if k in t else (list(idv) if flag else list(rest))
            q = quat(rot(vals['R'])); frames.append([round(x, 3) for x in q] + [round(x, 2) for x in vals['T']])
        moves = any(abs(fr[4 + c] - b['T'][c]) > 0.01 for fr in frames for c in range(3))
        fr2 = [fr if moves else fr[:4] for fr in frames]
        out[b['name']] = fr2[:1] if all(f == fr2[0] for f in fr2) else fr2  # (a bone that holds still: one frame)
    return {'frames': F, 'loop': bool(C['loop']), 'bones': out}

if '--gallery' in sys.argv: # every shared (pm000) and Board Game Island (pm001) clip, for the island viewer's animation gallery
    names = sorted(n for n in ra['AnmChr(NW4R)'] if n.startswith(('pm000', 'pm001')))
    dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'wpMiiAllClips.js')
    with open(dst, 'w') as f:
        f.write("// Generated by tools/extract_wp_mii.py --gallery from Wii Party's files/ch_base/player_motion.branm: every Mii\n")
        f.write("// animation shared by the boards (pm000_xx) and Board Game Island's own (pm001_xx), baked as in wpMiiData.js. Only the\n")
        f.write("// island viewer's animation gallery loads it (to pick which clip goes where); the game plays WP_MII.clips.\n")
        f.write('export const ALL_CLIPS = ' + json.dumps({n: bake(n) for n in names}, separators=(',', ':')) + ';\n')
    print(len(names), 'clips ->', dst); sys.exit()

if '--all' in sys.argv:
    names = [n for n in ra['AnmChr(NW4R)'] if n.startswith(('pm000', 'pm001'))]
    json.dump({'skel': skel, 'meshes': meshes, 'clips': {n: bake(n) for n in names}}, open(sys.argv[sys.argv.index('--all') + 1], 'w'))
    print(len(names), 'clips'); sys.exit()

data = {'step': STEP, 'body': BODY, 'skel': skel, 'meshes': meshes, 'tex': tex, 'clips': {k: bake(v) for k, v in CLIPS.items()}, 'source': CLIPS}
dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'wpMiiData.js')
with open(dst, 'w') as f:
    f.write("// Generated by tools/extract_wp_mii.py from Wii Party's files/ch_base/ (player/pl001.brres, the Mii body, and\n")
    f.write("// player_motion.branm, the Mii animations). Do not edit. skel: bones (rest T, R in degrees, S; inverse bind 3x4);\n")
    f.write("// meshes: model-space skinned meshes (two bones per vertex); clips: per bone [qx,qy,qz,qw, tx,ty,tz] every `step` frames.\n")
    f.write('export const WP_MII = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print(len(meshes), 'meshes', sum(len(m['pos']) // 3 for m in meshes), 'verts;', len(data['clips']), 'clips;', os.path.getsize(dst) // 1024, 'KB')
