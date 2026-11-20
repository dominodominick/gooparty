#!/usr/bin/env python3
"""The tornado that carries a player back (the board's tornado space), from the game's own files.

files/mr001/option/op001_tornado.brres holds the model (a funnel of see-through streak layers, a ring of leaves, and
the hook the player rides on) and its two textures; files/mr001/option/op001_tornado/motion/ holds three animations:
  op001_tornado_1  it forms around the player and lifts them up (121 frames)
  op001_tornado_2  it spins, carrying them (120 frames, loops)
  op001_tornado_3  it dies away (31 frames)
Each animation has bone tracks (CHR0), which pieces show (VIS0), how see-through each layer is (CLR0, the material
colour's alpha) and how the streak texture scrolls up the funnel (SRT0). Every piece is rigid on one bone, its points
in that bone's own space. This writes all of it to js15/world/tornadoData.js; js15/world/tornado.js builds and plays it.

Usage:  python3 tools/extract_tornado.py path/to/op001_tornado.brres(.lz) path/to/op001_tornado/motion/
"""
import sys, os, json, io, base64
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
import numpy as np
from PIL import Image
from lz import unlz
from brres import brres, be, group
from mdl0 import mdl0
from mesh import read_obj
from tex0 import tex0
from chr0 import chr0, read_track, sample

STEP = 2
raw = open(sys.argv[1], 'rb').read(); d = raw if raw[:4] == b'bres' else unlz(raw)
R = brres(d); M = mdl0(d, R['3DModels(NW4R)']['op001_tornado'])
bones = M['bones']; order = sorted(M['mats'], key=lambda n: M['mats'][n])
mat_tex = {}
for t, refs in M['texlinks'].items():
    inv = {a: n for n, a in M['mats'].items()}
    for m, _ in refs: mat_tex[inv[m]] = t

# ---- the pieces: one per draw, rigid on its bone, points in the bone's own space
pieces = []
for x in M['defs'].get('DrawOpa', []) + M['defs'].get('DrawXlu', []):
    o = M['objs'][x[2]]; vs, tris = read_obj(d, o)
    P = M['pos'][o['ids'][0]][1]; UV = M['uv'][o['ids'][4]][1]
    C = M['clr'][o['ids'][2]][1] if o['ids'][2] >= 0 else None
    pieces.append({
        'bone': bones[x[3]]['name'], 'mat': order[x[1]],
        'pos': [round(float(c), 2) for v in vs for c in P[v['pos']]],
        'uv': [round(float(c), 4) for v in vs for c in UV[v['uv0']]],
        'col': [round(float(c), 3) for v in vs for c in C[v['clr0']]] if C is not None else None,
        'idx': [int(i) for t in tris for i in t],
    })

def textures():
    out = {}
    for t, off in R['Textures(NW4R)'].items():
        a, _ = tex0(d, off); buf = io.BytesIO(); Image.fromarray(a, 'RGBA').save(buf, 'PNG', optimize=True)
        out[t] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    return out

def pack(vals, dec):
    """A constant, or [first frame it changes, then one value every STEP frames, held after the last]."""
    F = len(vals)
    if max(vals) - min(vals) < 1e-4: return round(vals[0], dec)
    a = 0
    while a < F - 1 and abs(vals[a + 1] - vals[0]) < 1e-5: a += 1
    b = F - 1
    while b > 0 and abs(vals[b - 1] - vals[-1]) < 1e-5: b -= 1
    return [a] + [round(float(vals[min(F - 1, f)]), dec) for f in range(a, b + STEP, STEP)]

def srt0(a, c, F):
    out = {}
    for mn, e in group(a, c + be('i', a, c + 0x10)[0]):
        en = be('I', a, e + 4)[0]; p = e + 12
        if not en & 1: continue
        td = e + be('i', a, p)[0]; fl = be('I', a, td)[0]; q = td + 4
        def take(fixed):
            nonlocal q
            v = be('f', a, q)[0] if fixed else read_track(a, q + be('i', a, q)[0], 3, F)
            q += 4; return v
        vals = {}
        if not fl >> 1 & 1: su = take(fl >> 5 & 1); sv = su if fl >> 4 & 1 else take(fl >> 6 & 1)
        if not fl >> 2 & 1: take(fl >> 7 & 1)
        if not fl >> 3 & 1: vals['u'] = take(fl >> 8 & 1); vals['v'] = take(fl >> 9 & 1)
        if vals: out[mn] = {k: pack([sample(v, f) for f in range(F)], 3) for k, v in vals.items()}
    return out

def clr0(a, c):
    F = be('H', a, c + 0x20)[0]; out = {}
    for mn, e in group(a, c + be('i', a, c + 0x10)[0]):
        fl = be('I', a, e + 4)[0]
        if not fl & 1: continue
        p = e + 8
        if fl & 2: out[mn] = round(a[p + 7] / 255, 3)
        else: q = p + 4 + be('i', a, p + 4)[0]; out[mn] = pack([a[q + 4 * k + 3] / 255 for k in range(F)], 3)
    return out

def vis(a, r, F):
    out = {}
    for v in r.get('AnmVis(NW4R)', {}).values():
        for bn, e in group(a, v + be('i', a, v + 0x10)[0]):
            fl = be('I', a, e + 4)[0]
            bits = [fl & 1] * F if fl & 2 else [int(c) for c in ''.join(format(be('I', a, e + 8 + 4 * k)[0], '032b') for k in range((F + 31) // 32))[:F]]
            out[bn] = [bits[0]] + [f for f in range(1, F) if bits[f] != bits[f - 1]]
    return out

clips = {}
for key, n in (('form', 1), ('spin', 2), ('fade', 3)):
    path = os.path.join(sys.argv[2], f'op001_tornado_{n}.branm.lz'); a = open(path, 'rb').read(); a = unlz(a) if a[:4] != b'bres' else a
    r = brres(a); nm = f'op001_tornado_{n}'; C = chr0(a, r['AnmChr(NW4R)'][nm]); F = C['frames']
    tr = {}
    for b in bones:
        e = C['bones'].get(b['name']); t = e['tracks'] if e else {}; code = e['code'] if e else 0
        # a bone the clip lists without a track: its flags say whether it is at identity (scale one, no turn or move)
        ident = code >> 1 & 1
        rest_of = {'T': (0, 0, 0) if e and (ident or code >> 2 & 1) else b['T'], 'R': (0, 0, 0) if e and (ident or code >> 2 & 1) else b['R'],
                   'S': (1, 1, 1) if e and (ident or code >> 3 & 1) else b['S']}
        comps = []
        for k, rest, dec in (('T', rest_of['T'], 2), ('R', rest_of['R'], 2), ('S', rest_of['S'], 3)):
            for c in range(3):
                x = t[k][c] if k in t else float(rest[c])
                comps.append(pack([x] * F if isinstance(x, float) else [sample(x, f) for f in range(F)], dec))
        tr[b['name']] = comps
    clips[key] = {'frames': F, 'loop': bool(C['loop']), 'bones': tr, 'shows': vis(a, r, F),
                  'alpha': clr0(a, r['AnmClr(NW4R)'][nm]), 'scroll': srt0(a, r['AnmTexSrt(NW4R)'][nm], F)}

data = {
    'fps': 60, 'step': STEP,
    'bones': [{'name': b['name'], 'parent': b['parent'], 'rest': [round(float(x), 4) for x in list(b['T']) + list(b['R']) + list(b['S'])]} for b in bones],
    'pieces': pieces, 'matTex': mat_tex, 'textures': textures(), 'clips': clips,
}
dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'tornadoData.js')
with open(dst, 'w') as f:
    f.write('// Generated by tools/extract_tornado.py from the game\'s files/mr001/option/op001_tornado.brres and its three\n')
    f.write('// animations. Do not edit. Map units. Bone tracks: T, R (degrees), S, each a constant or [first frame it moves,\n')
    f.write('// then one value every `step` frames]; shows: [shown at frame 0, frames it flips]; alpha and scroll the same way.\n')
    f.write('export const TORNADO = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print(len(pieces), 'pieces', {k: c['frames'] for k, c in clips.items()}, os.path.getsize(dst) // 1024, 'KB')
