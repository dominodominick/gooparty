// The swimming dinosaur in the pool by the rope bridge: its model data, its path, and that the path matches the map.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WATASY_PATH, swimmerAt, bobAt } from '../js15/world/watasy.js';
import { WATASY } from '../js15/world/watasyModel.js';

// ---- the model, from the game's own file ----
{
  const n = WATASY.position.length / 3;
  assert.ok(n > 300 && WATASY.normal.length === n * 3 && WATASY.uv.length === n * 2);
  assert.equal(WATASY.index.length % 3, 0); assert.ok(WATASY.index.length / 3 > 500);
  assert.ok(WATASY.index.every((i) => Number.isInteger(i) && i >= 0 && i < n), 'every triangle uses real vertices');
  const ys = WATASY.position.filter((_, i) => i % 3 === 1);
  assert.ok(Math.min(...ys) < -100 && Math.max(...ys) > 600, 'a body under the waterline and a long neck up out of it');
  for (let i = 0; i < n; i++) assert.ok(Math.abs(Math.hypot(WATASY.normal[3 * i], WATASY.normal[3 * i + 1], WATASY.normal[3 * i + 2]) - 1) < 0.01);
  assert.ok(WATASY.uv.every((u) => u >= 0 && u <= 1));
  assert.ok(WATASY.texture.startsWith('data:image/png;base64,'));
  const png = Buffer.from(WATASY.texture.split(',')[1], 'base64');
  assert.equal(png.readUInt32BE(16), 128); assert.equal(png.readUInt32BE(20), 128, 'the 128x128 body texture');
  // front faces point outwards (three.js winding): most face normals agree with the vertex normals
  let agree = 0; const P = WATASY.position, N = WATASY.normal, I = WATASY.index;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]], e1 = [0, 1, 2].map((k) => P[3 * b + k] - P[3 * a + k]), e2 = [0, 1, 2].map((k) => P[3 * c + k] - P[3 * a + k]);
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if ([0, 1, 2].reduce((s, k) => s + fn[k] * (N[3 * a + k] + N[3 * b + k] + N[3 * c + k]), 0) > 0) agree++;
  }
  assert.ok(agree / (I.length / 3) > 0.95, 'triangles face outwards');
}

// ---- the path: a circle about the pool, facing along it, with a gentle bob ----
{
  const P = WATASY_PATH;
  const at = (f) => swimmerAt(f);
  assert.deepEqual([at(0).x, at(0).z], [-5600, -2650]);
  for (const f of [0, 137, 500, 999, 1500, 1999]) {
    const s = at(f); assert.ok(Math.abs(Math.hypot(s.x - P.cx, s.z - P.cz) - P.r) < 1e-9, 'on the circle');
  }
  assert.ok(Math.abs(at(500).x - -6150) < 1e-9 && Math.abs(at(500).z - -2100) < 1e-9, 'a quarter lap round');
  assert.ok(Math.abs(at(P.lapFrames).x - at(0).x) < 1e-9 && Math.abs(at(P.lapFrames).z - at(0).z) < 1e-9, 'a lap ends where it began');
  assert.equal(at(1000).ry, -180, 'half a lap, half a turn');
  assert.equal(bobAt(0), 0); assert.equal(bobAt(50), -50); assert.ok(Math.abs(bobAt(100)) < 1e-9);
  for (let f = 0; f < 100; f += 7) assert.ok(bobAt(f) <= 0 && bobAt(f) >= -50);
  assert.ok(P.lapFrames / P.fps > 30 && P.lapFrames / P.fps < 40, 'a lap takes about half a minute');
}

// ---- the map: the ripple ring the dinosaur swims in sits where the path starts ----
{
  const d = fs.readFileSync(new URL('../assets/board-game-island/island.glb', import.meta.url)), n = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + n).toString('utf8')), bin = 20 + n + 8;
  const node = j.nodes.find((x) => x.name === 'm001_09');
  assert.ok(node && node.mesh != null && !node.translation && !node.rotation && !node.matrix, 'the ring is in the map, baked where the path starts');
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of j.meshes[node.mesh].primitives) {
    const a = j.accessors[p.attributes.POSITION];
    lo[0] = Math.min(lo[0], a.min[0]); lo[1] = Math.min(lo[1], a.min[2]); hi[0] = Math.max(hi[0], a.max[0]); hi[1] = Math.max(hi[1], a.max[2]);
  }
  const s = swimmerAt(0);
  assert.ok(s.x > lo[0] && s.x < hi[0] && s.z > lo[1] && s.z < hi[1], `the swimmer starts inside the ring (${lo.map(Math.round)} .. ${hi.map(Math.round)})`);
  assert.ok(hi[0] - lo[0] < 1500 && hi[1] - lo[1] < 1500, 'and the ring is a small one round it');
}
console.log('watasy tests passed');
