#!/usr/bin/env python3
"""The board's big springs, from the game's own files.

files/mr001/option/op001_jump1.brres and op001_jump2.brres hold the two spring models, and each one's
op001_jumpN/motion/op001_jumpN_1.branm its one animation (91 frames): the plate is pushed down (frames 0-40), the game
holds it there for a moment, then it shoots up, throwing the player, and wobbles back to rest.
  jump1  the blue one: every forward bounce (+4/+5/+6, after winning a 1 vs 1 or a 1 vs Rest, +4 in the volcano), and
         the 1 vs 1 loser's bounce back (the trace of the real game: op001_jump1_1 every time)
  jump2  the red one: the -4 spaces. The same parts, turned round, so it throws the player back over their head.
The player stands on bone hook_ch (139 units up at rest). Every piece is rigid on one bone, its points in that bone's own
space. The plate's colour is the material's TEV colour register 1 (blue 90,186,231 / red 236,91,99); the coil carries the
op001_spring texture; the plate's top is the material colour (224,224,224).
This writes js15/world/springData.js; js15/world/spring.js builds and plays it.

Usage:  python3 tools/extract_spring.py path/to/mr001/option/
"""
import sys, os, json, io, base64, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
from PIL import Image
from lz import unlz
from brres import brres, be
from mdl0 import mdl0
from mesh import read_obj
from tex0 import tex0
from chr0 import chr0, sample

STEP = 1
SRC = sys.argv[1]

def load(path):
    raw = open(path, 'rb').read(); return raw if raw[:4] == b'bres' else unlz(raw)

def pack(vals, dec):
    """A constant, or [first frame it changes, then one value every STEP frames, held after the last]."""
    F = len(vals)
    if max(vals) - min(vals) < 1e-4: return round(vals[0], dec)
    a = 0
    while a < F - 1 and abs(vals[a + 1] - vals[0]) < 1e-5: a += 1
    b = F - 1
    while b > 0 and abs(vals[b - 1] - vals[-1]) < 1e-5: b -= 1
    return [a] + [round(float(vals[min(F - 1, f)]), dec) for f in range(a, b + STEP, STEP)]

def colours(d, off):
    """A material's TEV colour register 1 (BP 0xE2/0xE3, not konst) and its light channel's material colour."""
    L = be('I', d, off)[0]; h = d[off:off + L].hex(); c1 = None
    for m in re.finditer('61e2([0-9a-f]{6})61e3([0-9a-f]{6})', h):
        if m.start() % 2: continue
        ra, bg = int(m.group(1), 16), int(m.group(2), 16)
        if ra >> 23 & 1: continue
        c1 = [ra & 0x7ff, bg >> 12 & 0x7ff, bg & 0x7ff]; break
    mat = list(d[off + 0x3f4: off + 0x3f7]); amb = list(d[off + 0x3f8: off + 0x3fb])
    return c1, mat, amb

def model(n):
    d = load(os.path.join(SRC, f'op001_{n}.brres.lz')); R = brres(d); M = mdl0(d, R['3DModels(NW4R)'][f'op001_{n}'])
    bones = M['bones']; order = sorted(M['mats'], key=lambda k: M['mats'][k]); inv = {a: k for k, a in M['mats'].items()}
    mat_tex = {}
    for t, refs in M['texlinks'].items():
        for m, _ in refs:
            if t == 'op001_spring' or inv[m] not in mat_tex: mat_tex[inv[m]] = t  # (the coil's own picture; the rim maps are lighting)
    mats = {}
    for k in order:
        c1, mc, amb = colours(d, M['mats'][k])
        mats[k] = {'tev1': c1 if c1 and any(c1) else None, 'mat': mc, 'amb': amb, 'tex': mat_tex.get(k) if mat_tex.get(k) == 'op001_spring' else None}
    pieces = []
    for x in M['defs'].get('DrawOpa', []):
        o = M['objs'][x[2]]; vs, tris = read_obj(d, o)
        P = M['pos'][o['ids'][0]][1]; N = M['nrm'][o['ids'][1]][1] if o['ids'][1] >= 0 else None
        UV = M['uv'][o['ids'][4]][1] if o['ids'][4] >= 0 else None
        pieces.append({
            'bone': bones[x[3]]['name'], 'mat': order[x[1]],
            'pos': [round(float(c), 2) for v in vs for c in P[v['pos']]],
            'nrm': [round(float(c), 3) for v in vs for c in N[v['nrm']]] if N is not None else None,
            'uv': [round(float(c), 4) for v in vs for c in UV[v['uv0']]] if UV is not None and mats[order[x[1]]]['tex'] else None,
            'idx': [int(i) for t in tris for i in t],
        })
    tex = {}
    for t, off in R['Textures(NW4R)'].items():
        if t != 'op001_spring': continue
        a, _ = tex0(d, off); buf = io.BytesIO(); Image.fromarray(a, 'RGBA').save(buf, 'PNG', optimize=True)
        tex[t] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    a = load(os.path.join(SRC, f'op001_{n}', 'motion', f'op001_{n}_1.branm.lz')); r = brres(a)
    C = chr0(a, r['AnmChr(NW4R)'][f'op001_{n}_1']); F = C['frames'] + 1
    tr = {}
    for b in bones:
        e = C['bones'].get(b['name']); t = e['tracks'] if e else {}
        comps = []
        for k, rest, dec in (('T', b['T'], 2), ('R', b['R'], 2), ('S', b['S'], 3)):
            for c in range(3):
                x = t[k][c] if k in t else float(rest[c])
                comps.append(pack([x] * F if isinstance(x, float) else [sample(x, f) for f in range(F)], dec))
        tr[b['name']] = comps
    return {
        'bones': [{'name': b['name'], 'parent': b['parent'], 'rest': [round(float(x), 4) for x in list(b['T']) + list(b['R']) + list(b['S'])]} for b in bones],
        'pieces': pieces, 'mats': mats, 'textures': tex,
        'clips': {'jump': {'frames': C['frames'], 'loop': bool(C['loop']), 'bones': tr}},
    }

data = {'fps': 60, 'step': STEP, 'blue': model('jump1'), 'red': model('jump2')}
# both carry the same coil picture: keep one
data['texture'] = data['blue']['textures'].pop('op001_spring'); data['red']['textures'].clear()
for m in ('blue', 'red'): del data[m]['textures']
# the parts are the same in both (only the bones differ): keep one copy
if data['red']['pieces'] == data['blue']['pieces']: data['red']['pieces'] = 'blue'
dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'springData.js')
with open(dst, 'w') as f:
    f.write('// Generated by tools/extract_spring.py from the game\'s files/mr001/option/op001_jump1.brres (blue) and\n')
    f.write('// op001_jump2.brres (red) and their animations. Do not edit. Map units. Bone tracks: T, R (degrees), S, each a constant\n')
    f.write('// or [first frame it moves, then one value every `step` frames].\n')
    f.write('export const SPRING_MODEL = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print({k: (len(v['pieces']) if isinstance(v['pieces'], list) else v['pieces'], v['mats']) for k, v in data.items() if isinstance(v, dict) and 'pieces' in v}, os.path.getsize(dst) // 1024, 'KB')
