// The birds: the packed flight unpacks, starts exactly where the map has them frozen, flies smoothly, and loops cleanly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BIRDS } from '../js15/world/birdsData.js';
import { unpackMotion, wingAt } from '../js15/world/birds.js';

const M = await unpackMotion(BIRDS);
assert.equal(BIRDS.birds, 30); assert.equal(BIRDS.wings.length, 60);
assert.equal(M.C, 30 * 3 + 60 * 4); assert.equal(M.S, BIRDS.frames / BIRDS.step);
assert.equal(BIRDS.wings.filter((w) => w.side === 0).length, 30, 'a left and a right wing for every bird');
for (let b = 0; b < 30; b++) assert.equal(BIRDS.wings.filter((w) => w.bird === b).length, 2);
assert.ok(BIRDS.wings.every((w) => w.scale >= 0.5 && w.scale <= 1.3), 'birds of a few sizes');

const rot = (q, p) => { const [x, y, z, w] = q; return [
  (1 - 2 * (y * y + z * z)) * p[0] + 2 * (x * y - z * w) * p[1] + 2 * (x * z + y * w) * p[2],
  2 * (x * y + z * w) * p[0] + (1 - 2 * (x * x + z * z)) * p[1] + 2 * (y * z - x * w) * p[2],
  2 * (x * z - y * w) * p[0] + 2 * (y * z + x * w) * p[1] + (1 - 2 * (x * x + y * y)) * p[2]]; };
const cardAt = (wi, f) => { const [P, Q] = wingAt(BIRDS, M, wi, f), c = BIRDS.cards[BIRDS.wings[wi].side].position, s = BIRDS.wings[wi].scale, out = [];
  for (let i = 0; i < c.length; i += 3) { const r = rot(Q, [c[i] * s, c[i + 1] * s, c[i + 2] * s]); out.push([r[0] + P[0], r[1] + P[1], r[2] + P[2]]); } return out; };

// ---- frame 0 is exactly where the converted map has the birds frozen ----
{
  const d = fs.readFileSync(new URL('../assets/board-game-island/island.glb', import.meta.url)), n = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + n).toString('utf8')), bin = 20 + n + 8;
  const grp = j.nodes.find((x) => x.name === 'm001_08' && x.children), node = j.nodes[grp.children[0]]; const pts = [];
  assert.ok(!grp.translation && !grp.rotation && !grp.scale && !node.translation && !node.rotation && !node.scale, 'the frozen birds are stored in map space');
  for (const p of j.meshes[node.mesh].primitives) {
    const a = j.accessors[p.attributes.POSITION], bv = j.bufferViews[a.bufferView], o = bin + (bv.byteOffset || 0) + (a.byteOffset || 0), st = bv.byteStride || 12;
    for (let i = 0; i < a.count; i++) pts.push([0, 1, 2].map((k) => d.readFloatLE(o + i * st + 4 * k)));
  }
  let worst = 0;
  for (let wi = 0; wi < 60; wi++) for (const p of cardAt(wi, 0)) worst = Math.max(worst, Math.min(...pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))));
  assert.ok(worst < 3, `every wing starts where the map has it (worst ${worst.toFixed(2)} map units)`);
}
// ---- they really fly: smoothly, at bird speeds, and the loop joins up ----
{
  let moved = 0, fastest = 0, flap = 0;
  for (let wi = 0; wi < 60; wi += 7) {
    let prev = cardAt(wi, 0);
    for (let f = 0.5; f <= 6000; f += 0.5) {
      const cur = cardAt(wi, f % 6000);
      const dp = Math.hypot(...[0, 1, 2].map((k) => cur[0][k] - prev[0][k])); fastest = Math.max(fastest, dp);
      moved += dp; prev = cur;
    }
    const tip = (f) => cardAt(wi, f).reduce((m, p) => Math.max(m, p[1]), -Infinity) - wingAt(BIRDS, M, wi, f)[0][1];
    let lo = Infinity, hi = -Infinity; for (let f = 0; f < 120; f += 1) { const t = tip(f); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    flap = Math.max(flap, hi - lo);
  }
  assert.ok(moved > 50000, 'the birds cover real distance');
  assert.ok(fastest < 60, `no jumps: at most ${fastest.toFixed(1)} map units per half frame`);
  assert.ok(flap > 20, 'the wings flap');
}
console.log('birds tests passed');
