// The board's big springs: the game's own models (op001_jump1 blue, op001_jump2 red) and their animation.
import assert from 'node:assert/strict';
import { SPRING_MODEL as D } from '../js15/world/springData.js';
import { springHook, springFrame, springHoldFor, SPRING_HOLD_AT, SPRING_LAUNCH, SPRING_FRAMES } from '../js15/world/spring.js';
import { SPRING } from '../js15/game/realTimings.js';

assert.ok(D.texture.startsWith('data:image/png;base64,'), 'the coil\'s own picture');
for (const c of ['blue', 'red']) {
  const M = D[c], pieces = typeof M.pieces === 'string' ? D[M.pieces].pieces : M.pieces;
  assert.equal(pieces.length, 5, `${c}: base, rim, plate, plate top, coil`);
  for (const p of pieces) {
    assert.ok(M.bones.some((b) => b.name === p.bone), `${p.bone} is a bone`);
    assert.ok(M.mats[p.mat], `${p.mat} is a material`);
    assert.equal(p.pos.length % 3, 0); if (p.nrm) assert.equal(p.nrm.length, p.pos.length);
    if (p.uv) assert.equal(p.uv.length / 2, p.pos.length / 3);
    assert.ok(p.idx.length % 3 === 0 && Math.max(...p.idx) < p.pos.length / 3);
  }
  assert.ok(M.bones.every((b, i) => b.parent < i), 'parents come before their children');
  assert.equal(M.clips.jump.frames, SPRING_FRAMES);
}
// the colours are the materials' own: a blue spring and a red one
assert.deepEqual(D.blue.mats.jump_mat1.tev1, [90, 186, 231]);
assert.deepEqual(D.red.mats.jump_mat1.tev1, [236, 91, 99]);

// the player stands 139-140 units up at rest; pushed down to about 80 (the trace: 82); thrown up and forward (blue) or
// back (red) when it fires; and it comes back to rest
for (const c of ['blue', 'red']) {
  assert.ok(Math.abs(springHook(c, 0).y - 140) < 1);
  assert.ok(Math.abs(springHook(c, SPRING_HOLD_AT).y - 80) < 3, 'pushed right down');
  const L = springHook(c, SPRING_LAUNCH);
  assert.ok(L.y > 200, 'fired up');
  assert.ok(c === 'blue' ? L.z > 20 : L.z < -20, `${c}: leaning ${c === 'blue' ? 'forward' : 'back'} as it fires`);
  assert.ok(Math.abs(springHook(c, SPRING_FRAMES).y - 140) < 2, 'back at rest');
}
// it is held pushed down, then goes on: the take-off comes `wind` seconds after the animation starts (the real game's
// hold of about 0.27 s for a forward bounce)
assert.ok(Math.abs(springHoldFor(SPRING.fwd.wind) - 0.267) < 0.01);
const h = springHoldFor(SPRING.fwd.wind);
assert.equal(springFrame(0.5, h), 30);
assert.equal(springFrame(0.8, h), SPRING_HOLD_AT);
assert.ok(Math.abs(springFrame(SPRING.fwd.wind, h) - SPRING_LAUNCH) < 1e-6);
assert.equal(springFrame(10, h), SPRING_FRAMES);
console.log('spring tests passed');
