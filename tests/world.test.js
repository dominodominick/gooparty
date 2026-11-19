// The real map's layout: spaces, waypoints, gaps and the height map all agree with each other.
import assert from 'node:assert/strict';
import { islandPositions, volcanoPositions, islandWorld, legVia, terrainHeight, nearestPath, MAP_SCALE, VOLCANO_OFFSET } from '../js15/game/boardLayout.js';
import { ISLAND, VOLCANO, GAPS } from '../js15/game/boardData.js';
import { BOARD_MAP } from '../js15/game/boardMap.js';

const P = islandPositions(), V = volcanoPositions(), W = islandWorld();
assert.equal(P.length, ISLAND.length); assert.equal(V.length, VOLCANO.length);
assert.equal(BOARD_MAP.island.length, 80);
assert.equal(BOARD_MAP.spaceIds.filter((x) => x != null).length, 72, 'every one of the map\'s 72 tiles is a stop'); assert.equal(BOARD_MAP.volcano.length, 10);
// space 1 of the map is node 1, at the map's own coordinates
assert.ok(Math.abs(P[1].x - BOARD_MAP.island[1][0] * MAP_SCALE) < 1e-9);
import('../js15/game/boardData.js').then(({ ISLAND: IS, isChallenge }) => IS.forEach((n, i) => { if (isChallenge(n.type) || n.type === 'final') assert.equal(BOARD_MAP.spaceIds[i], null, 'a star is not a tile'); }));
// ordinary steps are even; the long ones are exactly the listed gaps
for (let i = 1; i < P.length; i++) {
  const d = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y, P[i].z - P[i - 1].z), gap = GAPS.some((g) => g.after === i - 1);
  const toStand = [7, 24, 42, 49, 61, 78].includes(i); // walking up to a challenge's star: off the line of tiles, through the old tile spot
  if (!toStand) assert.equal(d > 7, gap, `step ${i - 1}->${i} is ${d.toFixed(1)} long`);
  if (gap) assert.ok(legVia('island', i - 1, i).length > 0, `the gap after ${i - 1} has waypoints`);
  const back = legVia('island', i, i - 1), fwd = legVia('island', i - 1, i);
  assert.deepEqual(back, fwd.slice().reverse(), 'walking back uses the same waypoints, reversed');
}
// every node has a direction and a facing
for (const p of [...P, ...V]) { assert.ok(Math.abs(Math.hypot(p.dir.x, p.dir.z) - 1) < 1e-6); assert.ok(Number.isFinite(p.yaw + p.s)); }
// the volcano's inside is parked away from the island
assert.ok(V.every((p) => Math.abs(p.x - VOLCANO_OFFSET.x) < 40));
// the height map agrees with the spaces that are in the open
let close = 0;
for (let i = 1; i <= 78; i++) if (Math.abs(terrainHeight(P[i].x, P[i].z) - P[i].y) < 1.5) close++;
// the rope bridge has planks, and the walk over the bridge goes across them
import('../js15/game/boardLayout.js').then(({ BRIDGE_PLANKS }) => { assert.equal(BRIDGE_PLANKS.length, 9); const v = legVia('island', 16, 17); assert.ok(v.length === 11, 'over every plank'); });
assert.ok(close > 60, `most stops sit on the height map (${close}/78)`);
assert.equal(terrainHeight(900, 900), 0, 'open sea');
// nearest path finds the space you are standing next to
for (const i of [3, 20, 47, 64]) { const q = nearestPath(P[i].x + 0.5, P[i].z, P[i].y); assert.ok(q.d < 1 && Math.abs(q.i - i) < 0.6, `near space ${i}`); }
// the hooks the challenges need exist
for (const h of ['tarzan', 'enemy', 'star1', 'star2', 'taru1', 'taru2', 'step1', 'step2', 'g_rock', 'count', 'river']) assert.ok(W.hooks[h], h);
// ---- the crates and barrels: their quarter-textures are mirrored four ways (see tools/fix_map_uvs.py) ----
{
  const fs = await import('node:fs');
  const glb = (file) => {
    const d = fs.readFileSync(new URL(`../assets/board-game-island/${file}`, import.meta.url)), n = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + n).toString('utf8')), bin = 20 + n + 8;
    const floats = (ai, size) => { const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], stride = bv.byteStride || size * 4, off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
      return Array.from({ length: a.count }, (_, i) => Array.from({ length: size }, (_, k) => d.readFloatLE(off + i * stride + k * 4))); };
    return (node, material) => { const out = [];
      for (const x of j.nodes) if (x.name === node && x.mesh != null) for (const p of j.meshes[x.mesh].primitives) if (j.materials[p.material].name.startsWith(material)) out.push({ pos: floats(p.attributes.POSITION, 3), uv: floats(p.attributes.TEXCOORD_0, 2) });
      assert.ok(out.length, `${file}: ${node} / ${material}`); return out[0]; };
  };
  const mirror = (u) => { const m = Math.abs(u) % 2; return m > 1 ? 2 - m : m; }; // where a mirrored texture is read
  const metal = (uv) => mirror(uv[0]) > 0.74 && mirror(uv[1]) > 0.74;               // the grey quarter of both textures
  const props = glb('props.glb'), island = glb('island.glb');
  // a crate face runs from -1 to 1, so the quarter shows four times: frame bars and metal corners on every side
  const crate = props('m001_26', 'mr001m034');
  const corners = crate.pos.map((q, i) => (q.every((c) => Math.abs(Math.abs(c) - 80) < 0.01) ? crate.uv[i] : null)).filter(Boolean);
  assert.equal(corners.length, 24, 'four corners on each of the six faces');
  assert.ok(corners.every((uv) => Math.abs(Math.abs(uv[0]) - 1) < 1e-6 && Math.abs(Math.abs(uv[1]) - 1) < 1e-6), 'crate faces span the mirrored texture corner to corner');
  // the chain and its plate are painted with the metal part of the texture, on crates and barrels alike
  for (const [node, mat] of [['m001_26', 'mr001m034'], ['m001_27', 'mr001m034'], ['m001_28', 'mr001m066'], ['m001_29', 'mr001m066']]) {
    const m = props(node, mat), hw = m.uv.filter((_, i) => Math.abs(m.pos[i][0]) <= 27.2 && Math.abs(m.pos[i][1]) <= 50 && Math.abs(m.pos[i][2]) >= 79.9);
    assert.ok(hw.length >= 48 && hw.every(metal), `${node}: the chain and plate are metal`);
  }
  // a barrel's top rim is a metal hoop
  const barrel = props('m001_28', 'mr001m066');
  const rim = barrel.uv.filter((_, i) => barrel.pos[i][1] === 80 && Math.hypot(barrel.pos[i][0], barrel.pos[i][2]) > 60);
  assert.ok(rim.length >= 12 && rim.every(metal), 'the barrel has a metal rim');
  // the carved panel under the star at the summit: its quarter-texture is mirrored about the star (uv 0,1 = the plain middle of the carving)
  const panel = island('m001_00h', 'mr001m029r');
  const at = (x, z) => panel.uv[panel.pos.findIndex((q) => Math.abs(q[0] - x) < 0.5 && Math.abs(q[2] - z) < 0.5)];
  assert.deepEqual(at(0, 1000).map(mirror), [0, 1], 'the middle of the carving is under the star');
  for (const [x, z] of [[-255.079, 1172.578], [255.079, 1172.578], [-169.619, 779.726], [169.619, 779.726]]) assert.deepEqual(at(x, z).map(mirror), [1, 0], 'each corner of the panel shows the carving\'s outer corner');
  assert.deepEqual(at(0, 800).map(mirror), [0, 0]); assert.deepEqual(at(0, 1200).map(mirror), [0, 0], 'the pattern is the same on both sides of the star');
  // the chain anchors on the island use the same texture the same way
  assert.ok(island('m001_00e', 'mr001m034').uv.every(metal), 'the island\'s chain anchors are metal');
}
console.log('world tests passed');
