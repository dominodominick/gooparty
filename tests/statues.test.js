// The throwing statues: the game's own skeleton and animations (blue wake/launch, red throw), fitted onto the map's meshes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATUES as D } from '../js15/world/statueData.js';
import { rigStatue, statueMats, boneMatrix, shown, statueTimeline, STATUE_FPS, STATUE_DUR } from '../js15/world/statueRig.js';

// ---- the map's own statue meshes (props.glb), by material
const glb = fs.readFileSync(new URL('../assets/board-game-island/props.glb', import.meta.url));
const jl = glb.readUInt32LE(12), J = JSON.parse(glb.subarray(20, 20 + jl).toString()), bin = 20 + jl + 8;
const positions = (acc) => { const a = J.accessors[acc], bv = J.bufferViews[a.bufferView], o = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
  return Float32Array.from({ length: a.count * 3 }, (_, i) => glb.readFloatLE(o + 4 * i)); };
const meshOf = (model) => {
  const mesh = J.meshes[J.nodes.find((n) => n.name === model && n.mesh !== undefined).mesh], out = {};
  for (const p of mesh.primitives) out[J.materials[p.material].name] = positions(p.attributes.POSITION);
  return out;
};
// a stand-in for the placed copy of the map's statue: one mesh per material, as three.js splits it
const fakeStatue = (model) => {
  const prims = meshOf(model), meshes = Object.entries(prims).map(([name, arr]) => {
    const geo = { attributes: { position: { count: arr.length / 3, array: Float32Array.from(arr), needsUpdate: false } } };
    geo.clone = () => { const g = { attributes: { position: { count: geo.attributes.position.count, array: Float32Array.from(geo.attributes.position.array), needsUpdate: false } } }; g.clone = geo.clone; return g; };
    return { isMesh: true, material: { name }, geometry: geo };
  });
  return { meshes, prims, traverse: (fn) => meshes.forEach(fn) };
};

// ---- the data: every vertex of the map's statue meshes is on one of the game's bones
for (const [model, mats] of [['m001_30', ['mr001m030', 'mr001m030_2']], ['m001_31', ['mr001m048', 'mr001m048_2']]]) {
  const M = D[model], prims = meshOf(model);
  assert.deepEqual(Object.keys(M.bind).sort(), mats, `${model}: the body and the eyes/gem are bound (the glare cards are not)`);
  for (const m of mats) {
    assert.equal(M.bind[m].length, prims[m].length / 3, `${model} ${m}: one bone per vertex`);
    assert.ok([...M.bind[m]].every((c) => parseInt(c, 32) < M.slots.length));
  }
  for (const n of [...M.slots, 'hook_player']) assert.equal(M.inv[n].length, 12, `${model} ${n}: inverse bind`);
}
assert.equal(D.fps, 60); assert.equal(STATUE_FPS, 60);
assert.equal(D.m001_30.clips.wake.frames, 301); assert.equal(D.m001_30.clips.launch.frames, 101); assert.equal(D.m001_31.clips.throw.frames, 391);

// ---- helpers: a piece's centre in the posed mesh
const centre = (rig, model, mat, slotName) => {
  const M = D[model], s = M.slots.indexOf(slotName), letters = M.bind[mat], p = rig.parts.find((q) => q.mesh.material.name === mat).attr.array;
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < letters.length; i++) if (parseInt(letters[i], 32) === s) { x += p[3 * i]; y += p[3 * i + 1]; z += p[3 * i + 2]; n++; }
  return { x: x / n, y: y / n, z: z / n, n };
};
const restCentre = (prims, model, mat, slotName) => {
  const M = D[model], s = M.slots.indexOf(slotName), letters = M.bind[mat], p = prims[mat];
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < letters.length; i++) if (parseInt(letters[i], 32) === s) { x += p[3 * i]; y += p[3 * i + 1]; z += p[3 * i + 2]; n++; }
  return { x: x / n, y: y / n, z: z / n };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pitch = (model, clip, name, f) => { const m = boneMatrix(D, D[model], D[model].clips[clip], name, f); return Math.atan2(m[9], m[10]) * 180 / Math.PI; };

// ---- blue: asleep, it shows its side hands only and a dark gem; awake, its hands come round flat in front
{
  const S = fakeStatue('m001_30'), rig = rigStatue(S, D, 'm001_30'), B = 'mr001m030', G = 'mr001m030_2';
  assert.ok(rig, 'the blue statue rigs');
  assert.ok(S.meshes.every((m) => m.geometry.attributes.position.array !== undefined) && rig.parts.length === 2);
  for (const n of ['i_daiza1', 'i_head', 'i_jaw', 'hand_l1', 'hand_r1']) assert.ok(dist(centre(rig, 'm001_30', B, n), restCentre(S.prims, 'm001_30', B, n)) < 0.01, `asleep: ${n} where the map has it`);
  for (const n of ['hand_l1_1', 'hand_r1_1']) { const c = centre(rig, 'm001_30', B, n); assert.ok(Math.hypot(c.x, c.y, c.z) < 1e-6, `asleep: the big front hand ${n} is not there`); }
  assert.ok(dist(centre(rig, 'm001_30', G, 'off1'), restCentre(S.prims, 'm001_30', G, 'off1')) < 0.01, 'the dark gem shows');
  { const c = centre(rig, 'm001_30', G, 'on1'); assert.ok(Math.hypot(c.x, c.y, c.z) < 1e-6, 'the lit gem does not'); }
  // waking: the gem lights at frame 52, the hands jiggle a little in place first and only then swing round
  const W = D.m001_30.clips.wake;
  assert.ok(!shown(W, 'on1', 51) && shown(W, 'on1', 52) && shown(W, 'off1', 51) && !shown(W, 'off1', 52), 'the gem lights at frame 52');
  rig.pose('wake', 20, { jiggle: true }); const j = centre(rig, 'm001_30', B, 'hand_l1'), r0 = restCentre(S.prims, 'm001_30', B, 'hand_l1');
  assert.ok(dist(j, r0) > 0.5 && dist(j, r0) < 15, `the side hand jiggles in place as it wakes (${dist(j, r0).toFixed(1)})`);
  rig.pose('wake', 20); assert.ok(dist(centre(rig, 'm001_30', B, 'hand_l1'), r0) < 0.01, '(the game itself leaves the hands still)');
  rig.pose('wake', 100, { jiggle: true }); assert.ok(dist(centre(rig, 'm001_30', B, 'hand_l1'), r0) < 0.01, 'no jiggle once it is awake');
  // at frame 270 the side hands lie flat in front, where the big front pair sits in the map
  rig.pose('wake', 270);
  for (const [a, b] of [['hand_l1', 'hand_l1_1'], ['hand_r1', 'hand_r1_1']]) {
    const d = dist(centre(rig, 'm001_30', B, a), restCentre(S.prims, 'm001_30', B, b));
    assert.ok(d < 8, `${a} comes round flat in front of the statue (${d.toFixed(1)} from the front pair)`);
  }
  // and the launch clip swaps them for the front pair: the same place, no jump
  rig.pose('wake', 300); const before = centre(rig, 'm001_30', B, 'hand_l1');
  rig.pose('launch', 0); const after = centre(rig, 'm001_30', B, 'hand_l1_1');
  assert.ok(dist(before, after) < 8, `the hands carry on from wake into launch (${dist(before, after).toFixed(1)})`);
  { const c = centre(rig, 'm001_30', B, 'hand_l1'); assert.ok(Math.hypot(c.x, c.y, c.z) < 1e-6, 'the side pair is gone in launch'); }
  // it nods all the while its hands come round, and stops once the player is on them (frame 288)
  const p = (clip, f) => pitch('m001_30', clip, 'i_head', f);
  let lo = 99, hi = -99, turns = 0;
  for (let f = 130; f <= 282; f += 2) { lo = Math.min(lo, p('wake', f)); hi = Math.max(hi, p('wake', f)); }
  for (let f = 132; f <= 282; f += 2) if (Math.sign(p('wake', f + 2) - p('wake', f)) !== Math.sign(p('wake', f) - p('wake', f - 2))) turns++;
  assert.ok(hi - lo > 6 && turns >= 4, `nodding while the hands come round (${(hi - lo).toFixed(1)}°, ${turns} turns)`);
  let still = 0; for (let f = 288; f <= 300; f++) still = Math.max(still, Math.abs(p('wake', f) - p('wake', 288)));
  assert.ok(still < 0.8, `still once the player is on (${still.toFixed(2)}°)`);
  assert.ok(Math.abs(p('wake', 300) - p('launch', 0)) < 0.1, 'and launch starts from that same pose');
  // the hook (where the player stands) is on the hands, then flung up over the statue
  const hk = (f) => { const m = rig.hook('launch', f); return { x: m[3], y: m[7], z: m[11] }; };
  assert.ok(Math.abs(hk(0).y - 100) < 1 && Math.abs(hk(0).z - 450) < 1, 'standing on the flat hands');
  assert.ok(hk(58).y < 50, 'the hands sink first');
  assert.ok(hk(66).y > 250 && hk(66).y - hk(64).y > 50, 'then fling the player up (let go at 66)');
}

// ---- red: it opens its mouth to grab, shuts it to lift the player over its head, and throws them
{
  const S = fakeStatue('m001_31'), rig = rigStatue(S, D, 'm001_31'), B = 'mr001m048', G = 'mr001m048_2';
  assert.ok(rig, 'the red statue rigs');
  for (const n of ['i_daiza1', 'i_head', 'i_tuno', 'i_jaw', 'hand_l1', 'hand_r1']) assert.ok(dist(centre(rig, 'm001_31', B, n), restCentre(S.prims, 'm001_31', B, n)) < 0.01, `asleep: ${n}`);
  for (const n of ['hand_l2', 'hand_r2']) { const c = centre(rig, 'm001_31', B, n); assert.ok(Math.hypot(c.x, c.y, c.z) < 1e-6, `asleep: no ${n}`); }
  for (const n of ['on1', 'i_eye_on']) { const c = centre(rig, 'm001_31', G, n); assert.ok(Math.hypot(c.x, c.y, c.z) < 1e-6, `asleep: no ${n}`); }
  const C = D.m001_31.clips.throw;
  assert.ok(!shown(C, 'i_eye_on', 51) && shown(C, 'i_eye_on', 52) && !shown(C, 'i_eye_off', 52), 'its eyes light at 52');
  assert.ok(shown(C, 'hand_l1', 289) && !shown(C, 'hand_l1', 290) && shown(C, 'hand_l2', 290), 'the grabbing hands take over at 290');
  const mouth = (f) => pitch('m001_31', 'throw', 'i_jaw', f) - pitch('m001_31', 'throw', 'i_head', f);
  const head = (f) => pitch('m001_31', 'throw', 'i_head', f);
  assert.ok(mouth(260) > 15 && head(260) < -10, `the mouth is open, head back, as it grabs (${mouth(260).toFixed(1)}°)`);
  for (const f of [318, 326, 334, 342]) assert.ok(Math.abs(mouth(f)) < 0.5, `the mouth is shut while it lifts the player over its head (frame ${f}: ${mouth(f).toFixed(2)}°)`);
  // grabbed on the space in front, carried up over the head and behind, then swung forward and let go at 352
  const hk = (f) => { const m = rig.hook('throw', f); return { x: m[3], y: m[7], z: m[11] }; };
  assert.ok(Math.abs(hk(270).z - 650) < 1 && Math.abs(hk(270).y) < 1, 'held where the player stood');
  assert.ok(hk(312).y > 450 && Math.abs(hk(312).z) < 150, 'right over its head');
  assert.ok(hk(336).z < -400, 'and behind it');
  assert.ok(hk(352).z > hk(348).z + 150 && hk(352).y > 250, 'then swung forward over its head again: the throw');
  // the hands it grabs with close round the player (either side of the hook)
  rig.pose('throw', 270); const l = centre(rig, 'm001_31', B, 'hand_l1'), r = centre(rig, 'm001_31', B, 'hand_r1');
  assert.ok(Math.abs((l.z + r.z) / 2 - 650) < 40 && Math.abs(l.x - r.x) < 200 && Math.abs(l.x - r.x) > 40, 'its hands close round the player');
  assert.ok(Math.abs(rig.frames('throw') - 391) === 0);
}

// ---- the timeline: the game's 60 frames a second, scaled with the move
{
  const b = statueTimeline('blue'), r = statueTimeline('red');
  assert.equal(STATUE_DUR, 13000);
  assert.ok(Math.abs(b.release - 6100) < 1 && Math.abs(r.release - 352 / 60 * 1000) < 1, 'let go at launch 66 (blue) / throw 352 (red)');
  assert.ok(b.hop[0] < b.hop[1] && b.hop[1] <= b.lift && b.lift < b.release && b.release < b.land && b.land < b.walk && b.walk < b.dur);
  assert.ok(r.grab < r.lift && r.lift < r.release && r.release < r.land);
  assert.deepEqual(b.at(1000), { clip: 'wake', f: 60 }); assert.equal(b.at(5100).clip, 'launch'); assert.ok(Math.abs(b.at(5100).f - 6) < 1e-9);
  assert.equal(b.at(99999).f, 100, 'holds the last frame after the clip');
  const half = statueTimeline('red', 6500); assert.ok(Math.abs(half.release - r.release / 2) < 1e-6, 'a shorter move is the same, faster');
  assert.ok(b.land - b.release > 3000, 'a good long flight');
}
console.log('statue tests passed');
