#!/usr/bin/env python3
"""Turns assets/board-game-island/board.json + island.glb into js15/game/boardMap.js (pure data, no Three.js):
space positions, the waypoints between spaces, named hooks, and a coarse height map of the island for the camera."""
import json, struct, base64, sys, os
import numpy as np
root = os.path.join(os.path.dirname(__file__), '..')
A = os.path.join(root, 'assets', 'board-game-island')
b = json.load(open(os.path.join(A, 'board.json')))
I, V = b['island'], b['volcano']
aux = {a['name'][4:]: a['position'] for a in I['aux_nodes']}
vaux = {a['name'][4:]: a['position'] for a in V['aux_nodes']}
r = lambda p: [round(v, 1) for v in p]
sp = {s['id']: s['position'] for s in I['spaces']}; vs = {s['id']: s['position'] for s in V['spaces']}
# waypoints walked through between node a and node a+1 (index into `island`)
via = {0: ['1'], 6: ['2', '3'], 15: ['4', '5'], 22: ['6', '7', '9', '11', '12'], 39: ['13', '14', '15', '16', '17'],
       45: ['18', '19', '20', '400', '702'], 56: ['701', '21', '22'], 65: ['23', '24', '25'], 69: ['26', '27', '28'],
       72: ['29', '30', '31', '36', '37', '38']}
# ---- the stops: the map's spaces, with a challenge star added after some of them. The star is the map's small star
# marker (or the hook where the game puts one); the waypoints between the two spaces are split around it.
import math
STAR45 = [1059.0, 1456.0, 1402.0]           # the small star on the ground before the cave (volcano-or-not)
GATE_STAR = [0.0, 3102.0, 1000.0]           # the small star in front of the summit gate (final challenge)
CH = {6: aux['2'], 22: aux['9'], 39: aux['13'], 45: STAR45, 56: aux['701'], 72: GATE_STAR}
R = [aux['0']] + [sp[i] for i in range(1, 73)] + [aux['39']]
vm = {k: [aux[n] for n in v] for k, v in via.items()}
# the rope bridge between the map's 15 and 16: the game lays wooden planks between the two posts; the walk goes over them
B1, B2 = I['hooks']['hook_bridge1'], I['hooks']['hook_bridge2']
NPL, SAG = 9, 55.0
dx, dz = B2[0] - B1[0], B2[2] - B1[2]
planks = []
for k in range(NPL):
    t = (k + 0.5) / NPL
    planks.append({'p': [B1[0] + dx * t, B1[1] + (B2[1] - B1[1]) * t - SAG * math.sin(math.pi * t) - 8, B1[2] + dz * t], 'yaw': math.atan2(dx, dz)})
vm[15] = [aux['4']] + [[q['p'][0], q['p'][1] + 10, q['p'][2]] for q in planks] + [aux['5']]
def split(full, P):
    hit = min(range(len(full)), key=lambda k: math.dist(full[k], P))
    if math.dist(full[hit], P) < 80: return full[1:hit], full[hit + 1:-1]
    best = min(range(len(full) - 1), key=lambda k: math.dist([(full[k][q] + full[k + 1][q]) / 2 for q in range(3)], P))
    return full[1:best + 1], full[best + 1:-1]
nodes, ids, vias = [R[0]], [None], []
for k in range(0, 73):
    chain = vm.get(k, [])
    if k in CH:
        before, after = split([R[k]] + chain + [R[k + 1]], CH[k])
        vias.append(before); nodes.append(CH[k]); ids.append(None)
        vias.append(after)
    else: vias.append(chain)
    nodes.append(R[k + 1]); ids.append(k + 1 if k + 1 <= 72 else None)
island = [r(p) for p in nodes]
pts_via = {i: v for i, v in enumerate(vias)}
volcano = [r(vaux['100'])] + [r(vs[i]) for i in range(101, 109)] + [r(vaux['108'])]  # where you land, spaces 101..108, the way out
vvia = {0: ['101'], 3: ['102', '103', '104'], 4: ['105', '106', '107']}
out = {
  'island': island, 'via': {str(k): [r(p) for p in v] for k, v in pts_via.items() if v},
  'bridge': [{'p': r(q['p']), 'yaw': round(q['yaw'], 4)} for q in planks], 'spaceIds': ids,
  'volcano': volcano, 'vvia': {str(k): [r(vaux[n]) for n in v] for k, v in vvia.items()},
  'hooks': {k[5:]: r(v) for k, v in I['hooks'].items()}, 'vhooks': {k[5:]: r(v) for k, v in V['hooks'].items()},
  'aux': {k: r(v) for k, v in aux.items()},
}
# ---- height map from the terrain meshes
d = open(os.path.join(A, 'island.glb'), 'rb').read()
n = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + n]); bin0 = 20 + n + 8
def acc(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0)
    if stride and stride != np.dtype(dt).itemsize * nc:
        raw = np.frombuffer(d, np.uint8, stride * a['count'], off).reshape(a['count'], stride)[:, :np.dtype(dt).itemsize * nc]
        return np.frombuffer(raw.tobytes(), dt).reshape(a['count'], nc)
    return np.frombuffer(d, dt, a['count'] * nc, off).reshape(a['count'], nc)
X0, Z0, CELL, NX, NZ = -9000, -9000, 100, 190, 180
H = np.zeros((NZ, NX), np.float32)
def meshes(k):
    x = j['nodes'][k]; o = [x['mesh']] if 'mesh' in x else []
    for c in x.get('children', []): o += meshes(c)
    return o
for ni in j['scenes'][0]['nodes']:
    nm = j['nodes'][ni]['name']
    if not (nm.startswith('m001_00') or nm in ('m001_61', 'm001_41', 'm001_50', 'm001_77', 'm001_21')): continue
    for m in meshes(ni):
        for p in j['meshes'][m]['primitives']:
            P = acc(p['attributes']['POSITION']).astype(np.float64); idx = acc(p['indices']).reshape(-1, 3)
            t = P[idx]                                    # (n,3,3)
            for u, v in [(u, v) for u in np.linspace(0, 1, 14) for v in np.linspace(0, 1, 14) if u + v <= 1]:
                q = t[:, 0] * (1 - u - v) + t[:, 1] * u + t[:, 2] * v
                # long triangles need more samples; a second pass below handles them
                ix = ((q[:, 0] - X0) / CELL).astype(int); iz = ((q[:, 2] - Z0) / CELL).astype(int)
                ok = (ix >= 0) & (ix < NX) & (iz >= 0) & (iz < NZ)
                np.maximum.at(H, (iz[ok], ix[ok]), q[ok, 1])
H = np.clip(H, 0, 6553)
out['height'] = {'x0': X0, 'z0': Z0, 'cell': CELL, 'nx': NX, 'nz': NZ, 'data': base64.b64encode((H * 10).astype('<u2').tobytes()).decode()}
js = '// GENERATED by tools/gen_board_map.py from assets/board-game-island (board.json, island.glb). Wii units, Y up.\n' \
     'export const BOARD_MAP = ' + json.dumps(out, separators=(',', ':')) + ';\n'
open(os.path.join(root, 'js15', 'game', 'boardMap.js'), 'w').write(js)
print('boardMap.js', len(js), 'bytes; max height', H.max(), 'filled', (H > 0).mean())
