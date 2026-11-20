// The pictures on the wooden signs (arrow, 4, 3): the game's second UV set on the map's own sign meshes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SIGN_DECALS as D } from '../js15/world/signDecals.js';
import { addSignDecals } from '../js15/world/signs.js';

const glb = fs.readFileSync(new URL('../assets/board-game-island/island.glb', import.meta.url));
const jl = glb.readUInt32LE(12), J = JSON.parse(glb.subarray(20, 20 + jl).toString());
const mi = J.materials.findIndex((m) => m.name === 'mr001m023');
const count = {}; J.meshes.forEach((me) => me.primitives.forEach((p) => { if (p.material === mi) count[me.name] = J.accessors[p.attributes.POSITION].count; }));
assert.deepEqual(Object.keys(D.uv1).sort(), ['m001_00a1', 'm001_00c', 'm001_00e'], 'the three signs');
for (const [n, uv] of Object.entries(D.uv1)) assert.equal(uv.length, count[n] * 2, `${n}: one second-UV pair per vertex of the map's sign`);
// which part of the atlas each sign shows (the atlas is arrow / 4 / 3 / blank from the top, in quarters)
const band = (n) => { const v = D.uv1[n].filter((_, i) => i % 2 === 1 && 1); const inside = v.filter((x) => x >= 0); return [Math.min(...inside), Math.max(...inside)]; };
const [a0, a1] = band('m001_00a1'), [f0, f1] = band('m001_00c'), [t0, t1] = band('m001_00e');
assert.ok(a1 <= 0.26, 'the start sign shows the arrow (top quarter)');
assert.ok(f0 >= 0.13 && f1 <= 0.49 && f1 > 0.4, 'the second sign shows the 4');
assert.ok(t1 <= 0.74 && t1 > 0.65, 'the volcano push sign shows the 3');
assert.ok(D.texture.startsWith('data:image/png;base64,'), 'the atlas');

// at load: each sign gets a picture over it, sharing its geometry, through the second UV set
class Attr { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
const made = [];
const THREE = { TextureLoader: class { load() { return {}; } }, SRGBColorSpace: 's', ClampToEdgeWrapping: 'c', Float32BufferAttribute: Attr,
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; made.push(this); } }, MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } } };
const signs = Object.keys(D.uv1).map((n, i) => ({ isMesh: true, name: i === 0 ? n + '_3' : n, /* three.js names the parts of a mesh with several materials so */ material: { name: 'mr001m023' }, kids: [], add(c) { this.kids.push(c); },
  key: n, geometry: { attributes: { position: { count: count[n] } }, setAttribute(k, v) { this.attributes[k] = v; } } }));
const other = { isMesh: true, name: 'm001_00a1', material: { name: 'mr001m005' }, add() { throw new Error('not a sign'); } };
const out = addSignDecals(THREE, { traverse: (fn) => [other, ...signs].forEach(fn) }, D);
assert.equal(Object.keys(out).length, 3);
for (const s of signs) {
  assert.equal(s.kids.length, 1); const p = s.kids[0];
  assert.ok(p.geometry === s.geometry && s.geometry.attributes.uv1.count === count[s.key], 'shares the sign, with the second UV set');
  assert.ok(p.material.transparent && p.material.map.channel === 1 && p.material.map.flipY === false, 'see-through, drawn through the second UV set');
}
console.log('signs tests passed');
