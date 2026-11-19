#!/usr/bin/env python3
"""Put back the texture matrices that the conversion of the map to .glb dropped.

Some Wii materials use a small texture that is one QUARTER of a pattern, wrapped with mirroring, and a texture matrix that
doubles the UVs and shifts them so the quarter shows four times, mirrored. The converted files kept the mirroring but lost
the matrix, so those surfaces showed the quarter once, stretched. This bakes each matrix into the stored UVs.

  Crates and barrels (props.glb: m001_26..29, materials mr001m034*, mr001m066*) and the chain anchors by the pool
  (island.glb, material mr001m034):            uv' = (2u - 1, 2v - 1)
      -> frame bars and metal corners on every side of a crate, metal hoops round a barrel, chains and plates in grey metal
  The carved floor panel under the star at the summit (island.glb, material mr001m029r):   uv' = (2u - 1, 2v)
      -> a square carved panel centred on the star, instead of one enlarged corner of it

The original Wii files were not at hand, so each matrix was worked out from the model: only these values put the metal parts
on the metal part of the texture, line the plank seams up with the edges, and centre the panel's pattern on the star.

It edits the numbers in place (the files keep their size and layout) and is safe to run twice: UVs already fixed are left alone.
Usage:  python3 tools/fix_map_uvs.py [folder with props.glb and island.glb]
"""
import json, re, struct, sys, os

# file, material name pattern, (u scale, u offset, v scale, v offset)
RULES = [
    ('props.glb', r'^mr001m0(34|66)(_\d+)?$', (2, -1, 2, -1)),
    ('island.glb', r'^mr001m034$', (2, -1, 2, -1)),
    ('island.glb', r'^mr001m029r$', (2, -1, 2, 0)),
]


def fix(path, rules):
    data = bytearray(open(path, 'rb').read())
    assert data[:4] == b'glTF', f'{path} is not a .glb file'
    n = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + n])
    bin0 = 20 + n + 8
    done, seen = [], set()
    for mesh in j['meshes']:
        for p in mesh['primitives']:
            name = j['materials'][p['material']]['name'] if 'material' in p else ''
            rule = next((r for r in rules if re.match(r[0], name)), None)
            ai = p['attributes'].get('TEXCOORD_0')
            if rule is None or ai is None or ai in seen:
                continue
            seen.add(ai)
            su, ou, sv, ov = rule[1]
            a = j['accessors'][ai]
            bv = j['bufferViews'][a['bufferView']]
            assert a['componentType'] == 5126 and a['type'] == 'VEC2', 'expected float UVs'
            stride = bv.get('byteStride') or 8
            off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            uv = [list(struct.unpack_from('<2f', data, off + i * stride)) for i in range(a['count'])]
            if min(u for u, _ in uv) < -0.5:  # already fixed (unfixed UVs here never go below -0.12)
                done.append((name, a['count'], 'already fixed'))
                continue
            for i, (u, v) in enumerate(uv):
                struct.pack_into('<2f', data, off + i * stride, su * u + ou, sv * v + ov)
            done.append((name, a['count'], 'fixed'))
    if any(s == 'fixed' for _, _, s in done):
        open(path, 'wb').write(data)
    return done


if __name__ == '__main__':
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'board-game-island')
    for f in sorted({r[0] for r in RULES}):
        for name, count, state in fix(os.path.join(folder, f), [r[1:] for r in RULES if r[0] == f]):
            print(f'{f}: {name} ({count} points): {state}')
