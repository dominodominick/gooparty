// The dragon on the dragon wall: the game's own skeleton and shooting animation, fitted onto the map's dragon mesh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DRAGON as D } from '../js15/world/dragonData.js';
import { bindDragon, dragonMats, skinDragon, spatBallAt, DRAGON_FPS } from '../js15/world/dragon.js';

// ---- the map's own dragon mesh (props.glb, m001_35), by material
const glb = fs.readFileSync(new URL('../assets/board-game-island/props.glb', import.meta.url));
const jl = glb.readUInt32LE(12), J = JSON.parse(glb.subarray(20, 20 + jl).toString()), bin = 20 + jl + 8;
const positions = (acc) => { const a = J.accessors[acc], bv = J.bufferViews[a.bufferView], o = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
  return Float32Array.from({ length: a.count * 3 }, (_, i) => glb.readFloatLE(o + 4 * i)); };
const mesh = J.meshes[J.nodes.find((n) => n.name === 'm001_35' && n.mesh !== undefined).mesh];
const prim = {}; for (const p of mesh.primitives) prim[J.materials[p.material].name] = positions(p.attributes.POSITION);
assert.ok(prim.mr001m067 && prim.mr001m011_3 && prim.mr001m068, 'head, fireballs and wall');

// ---- the data
assert.equal(D.frames, 51); assert.equal(D.skin.length, 51); assert.ok(D.skin.every((r) => r.length === 84));
assert.equal(D.spit, 15, 'the ball leaves the mouth at frame 15');
assert.ok(D.show.kazandan.slice(0, 15).every((v) => v === 1) && D.show.kazandan.slice(15).every((v) => v === 0), 'the ball in the mouth shows until it is spat');
assert.ok(D.show.kazandan1[15] === 1 && D.show.kazandan1[0] === 0, 'the spat ball appears when it leaves');

// ---- every head and fireball vertex finds its point; the stone under the head stays put
const head = bindDragon(prim.mr001m067, D), balls = bindDragon(prim.mr001m011_3, D);
const n067 = prim.mr001m067.length / 3, n011 = prim.mr001m011_3.length / 3;
assert.ok(head.matched >= n067 - 40 && head.matched < n067, `the head binds (${head.matched}/${n067}); the 40 stone vertices do not`);
assert.equal(balls.matched, n011, 'both fireballs bind');
for (let i = 0; i < n011; i++) assert.ok([6, 7].includes(balls.joints[4 * i]) && balls.weights[4 * i] === 1, 'a fireball is rigid on its bone');
for (let i = 0; i < n067; i++) { const s = head.weights.slice(4 * i, 4 * i + 4).reduce((a, b) => a + b, 0); assert.ok(Math.abs(s - 1) < 0.01, 'weights sum to one'); }
// the wall is never bound or moved
assert.equal(bindDragon(prim.mr001m068, D).matched, 0, 'nothing of the wall follows the head');

// ---- frame 0 is the rest pose; the jaws open wide by frame 12 and are shut again at the end
const pose = (rest, bind, f, ball) => skinDragon(new Float32Array(rest.length), rest, bind, dragonMats(D, f, ball));
const maxMove = (a, b, filter = () => true) => { let m = 0; for (let i = 0; i < a.length / 3; i++) if (filter(i)) m = Math.max(m, Math.hypot(a[3 * i] - b[3 * i], a[3 * i + 1] - b[3 * i + 1], a[3 * i + 2] - b[3 * i + 2])); return m; };
assert.ok(maxMove(pose(prim.mr001m067, head, 0), prim.mr001m067) < 0.05, 'frame 0 = rest');
assert.ok(maxMove(pose(prim.mr001m067, head, D.frames - 1), prim.mr001m067) < 0.1, 'the last frame is back at rest');
const upper = (i) => head.joints[4 * i] === 2, lower = (i) => head.joints[4 * i] === 4;
const gap = (P) => { let u = 0, l = 0, nu = 0, nl = 0; for (let i = 0; i < n067; i++) { if (upper(i)) { u += P[3 * i + 1]; nu++; } if (lower(i)) { l += P[3 * i + 1]; nl++; } } return u / nu - l / nl; };
assert.ok(nu(upper) > 20 && nu(lower) > 20, 'upper and lower jaw vertices');
function nu(fn) { let c = 0; for (let i = 0; i < n067; i++) if (fn(i)) c++; return c; }
const g0 = gap(prim.mr001m067), g12 = gap(pose(prim.mr001m067, head, 12));
assert.ok(g12 > g0 + 25, `the jaws open (${g0.toFixed(0)} -> ${g12.toFixed(0)})`);
const stone = (i) => head.weights[4 * i] === 1 && head.joints[4 * i] === 0;
assert.equal(maxMove(pose(prim.mr001m067, head, 12), prim.mr001m067, stone), 0, 'the stone under the head does not move');

// ---- the fireballs: the one in the mouth rises with the open jaws, then the spat one goes where it is sent
const inMouth = (i) => balls.joints[4 * i] === 6, spat = (i) => balls.joints[4 * i] === 7;
const centre = (P, fn) => { let c = [0, 0, 0], k = 0; for (let i = 0; i < n011; i++) if (fn(i)) { c[0] += P[3 * i]; c[1] += P[3 * i + 1]; c[2] += P[3 * i + 2]; k++; } return c.map((v) => v / k); };
const b0 = pose(prim.mr001m011_3, balls, 0), b10 = pose(prim.mr001m011_3, balls, 10);
assert.ok(centre(b10, inMouth)[1] > centre(b0, inMouth)[1] + 20, 'the ball in the mouth rises as the jaws open');
assert.ok(centre(b0, spat).every((v) => Math.abs(v) < 1e-6), 'the spat ball is hidden before it is spat (shrunk to nothing)');
const b20 = pose(prim.mr001m011_3, balls, 20, { at: [10, 100, 300] }), c20 = centre(b20, spat);
assert.ok(Math.hypot(c20[0] - 10, c20[1] - 100, c20[2] - 300) < 6, 'the spat ball flies where it is sent');
assert.ok(centre(b20, inMouth).every((v) => Math.abs(v) < 1e-6), 'and the one in the mouth is gone');
assert.ok(centre(pose(prim.mr001m011_3, balls, 20, { hide: true }), spat).every((v) => Math.abs(v) < 1e-6), 'hidden once it bursts');
const s15 = spatBallAt(D, 15); assert.ok(s15[1] > 200 && s15[2] > 50, 'it leaves from the open mouth, high and in front');
assert.ok(DRAGON_FPS >= 30 && D.spit / DRAGON_FPS < 0.6, 'the ball is spat within the first half second');

// ---- the spike statue's jaws (the same fitting, on the head the page splits off the map's m001_50)
{
  const { SPIKE_HEAD: J } = await import('../js15/world/spikeHeadData.js');
  const { jawMats, jawSecs, JAW_FPS } = await import('../js15/world/spikeHead.js');
  const ig = fs.readFileSync(new URL('../assets/board-game-island/island.glb', import.meta.url));
  const il = ig.readUInt32LE(12), IJ = JSON.parse(ig.subarray(20, 20 + il).toString()), ib = 20 + il + 8;
  const ipos = (acc) => { const a = IJ.accessors[acc], bv = IJ.bufferViews[a.bufferView], o = ib + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return Float32Array.from({ length: a.count * 3 }, (_, i) => ig.readFloatLE(o + 4 * i)); };
  const iidx = (acc) => { const a = IJ.accessors[acc], bv = IJ.bufferViews[a.bufferView], o = ib + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const rd = a.componentType === 5125 ? (i) => ig.readUInt32LE(o + 4 * i) : (i) => ig.readUInt16LE(o + 2 * i); return Array.from({ length: a.count }, (_, i) => rd(i)); };
  const node = IJ.nodes.find((n) => n.name === 'm001_50' && n.mesh !== undefined), prim = IJ.meshes[node.mesh].primitives.find((p) => IJ.materials[p.material].name === 'mr001m067');
  const all = ipos(prim.attributes.POSITION), idx = prim.indices !== undefined ? iidx(prim.indices) : null, n = (idx ? idx.length : all.length / 3) / 3;
  const head = []; // the head's triangles, as the page splits them off (centre within 600 of the model's middle)
  for (let t = 0; t < n; t++) { const v = [0, 1, 2].map((k) => (idx ? idx[3 * t + k] : 3 * t + k)); if (Math.abs((all[3 * v[0]] + all[3 * v[1]] + all[3 * v[2]]) / 3) < 600) for (const k of v) head.push(all[3 * k], all[3 * k + 1], all[3 * k + 2]); }
  const rest = Float32Array.from(head), bind = bindDragon(rest, J);
  assert.equal(bind.matched, rest.length / 3, `every vertex of the statue's head binds (${bind.matched}/${rest.length / 3})`);
  const pose = (seq, f) => skinDragon(new Float32Array(rest.length), rest, bind, jawMats(J, seq, f));
  const mv = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - rest[i])); return m; };
  assert.ok(mv(pose('open', 0)) < 0.05, 'shut at the start');
  assert.ok(mv(pose('open', J.open.length - 1)) > 20, 'wide open after the opening');
  assert.ok(mv(pose('close', J.close.length - 1)) < 0.05, 'shut again at the end of the closing');
  assert.ok(jawSecs(J, 'open') > 0.2 && jawSecs(J, 'open') < 0.5 && JAW_FPS === 60, 'opens in about a third of a second');
}

console.log('dragon tests passed');
