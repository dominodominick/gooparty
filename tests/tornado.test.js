// The tornado of the tornado space: the game's own model (op001_tornado) and its form / spin / fade animations.
import assert from 'node:assert/strict';
import { TORNADO as D } from '../js15/world/tornadoData.js';
import { tornadoBones, tornadoHook, track } from '../js15/world/tornado.js';

assert.deepEqual(Object.keys(D.clips), ['form', 'spin', 'fade']);
assert.equal(D.clips.form.frames, 121); assert.equal(D.clips.spin.frames, 120); assert.equal(D.clips.fade.frames, 31);
assert.ok(D.clips.spin.loop, 'it spins round and round while it carries the player');
assert.equal(D.pieces.length, 11);
for (const p of D.pieces) {
  assert.ok(D.bones.some((b) => b.name === p.bone), `${p.bone} is a bone`);
  assert.equal(p.pos.length / 3, p.uv.length / 2); if (p.col) assert.equal(p.col.length / 4, p.pos.length / 3);
  assert.ok(p.idx.length % 3 === 0 && Math.max(...p.idx) < p.pos.length / 3);
  assert.ok(D.textures[D.matTex[p.mat]].startsWith('data:image/png;base64,'), `${p.mat} has its texture`);
}
assert.ok(D.bones.every((b, i) => b.parent < i), 'parents come before their children');

// it grows out of nothing, and the leaves and layers fade in
const height = (clip, f) => { const B = tornadoBones(D, clip, f); return B.tornado_mm1[5] * B.tornado_mm2[5]; };
assert.ok(height('form', 0) < 0.3 && height('form', 60) > 0.9, 'it rises up out of the ground as it forms');
assert.ok(track(D.clips.form.alpha.leaf, 0) < 0.05 && track(D.clips.form.alpha.leaf, 120) > 0.95, 'the leaves fade in');
assert.ok(height('fade', 30) < 0.3, 'and sinks away when it dies');
// the streaks scroll up the funnel all the time
for (const m of ['mr001m040_2', 'mr001m040_3']) assert.ok(track(D.clips.spin.scroll[m].v, 100) > track(D.clips.spin.scroll[m].v, 0) + 2, `${m} scrolls`);
// the player rides near its top, going round
const hs = [0, 15, 30, 45].map((f) => tornadoHook(D, 'spin', f));
assert.ok(hs.every((h) => h.y > 150 && h.y < 220), 'carried up near the top');
const ang = hs.map((h) => Math.atan2(h.x, h.z)); assert.ok(new Set(ang.map((a) => a.toFixed(1))).size === 4, 'going round as it spins');
console.log('tornado tests passed');
