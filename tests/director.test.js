// The sequence director (js15/scenes/director.js) and the moments (js15/game/moments.js), on a stand-in scene.
import assert from 'node:assert/strict';
import { momentKey, allMoments, sequenceFrames } from '../js15/game/moments.js';
import { direct, builtinFrame, activeBlock, fromAnchor, toAnchor, shotToWorld, shotFromWorld, recordedSequence } from '../js15/scenes/director.js';

// ---- keys: each kind of moment, each kind of space
assert.equal(momentKey({ t: 'space', fx: 'fireball' }), 'note.fireball');
assert.equal(momentKey({ t: 'space' }, 'plus4'), 'note@plus4');
assert.equal(momentKey({ t: 'move', mode: 'spring', spring: 'red' }), 'move.spring.red');
assert.equal(momentKey({ t: 'move', mode: 'fly', statue: 'blue' }), 'move.fly.statue.blue');
assert.equal(momentKey({ t: 'move', mode: 'fast', swim: true }), 'move.swim');
assert.equal(momentKey({ t: 'move', mode: 'walk', swing: 4 }), 'move.swing');
assert.equal(momentKey({ t: 'broken', challenge: 'spike', later: true }), 'smash.spike');
assert.equal(momentKey({ t: 'broken', challenge: 'final' }), 'smash.final');
assert.equal(momentKey({ t: 'diceStart' }), '');
assert.equal(momentKey({ t: 'ufo', phase: 'down' }), 'ufo.down');
const M = allMoments();
assert.ok(M.length > 50 && new Set(M.map((m) => m.key)).size === M.length, 'every moment once');
for (const k of ['note@plus4', 'note@skull', 'note@shout', 'smash.dragon', 'move.knock', 'ufo.up', 'ufo.down', 'turn.start']) assert.ok(M.some((m) => m.key === k), k);

// ---- the game's own set piece under the sequence: held, slowed
const bl = [{ track: 'builtin', at: 0, len: 60, from: 0, speed: 1 }, { track: 'builtin', at: 60, len: 30, from: 60, speed: 0 }, { track: 'builtin', at: 90, len: 60, from: 60, speed: 0.5 }];
assert.equal(builtinFrame(bl, 30), 30); assert.equal(builtinFrame(bl, 75), 60, 'held'); assert.equal(builtinFrame(bl, 110), 70, 'half speed');
assert.equal(builtinFrame([], 42), 42, 'none: as made');
assert.equal(sequenceFrames({ blocks: bl }), 150);
assert.equal(sequenceFrames({ blocks: [{ track: 'player', at: 0, len: 20 }] }, 100), 100, "without builtin blocks it is at least the game's own length");
assert.equal(activeBlock([{ track: 'camera', at: 0, len: 5 }, { track: 'camera', at: 10, len: 5 }], 'camera', 30, true).at, 10, 'a camera block lasts until the next');
assert.equal(activeBlock([{ track: 'player', at: 0, len: 5 }], 'player', 30), null, 'a body block only for its length');

// ---- shots relative to a space: back and forth
const A = { x: 10, y: 2, z: -4, yaw: 0.7 };
const w = fromAnchor(A, { x: 1, y: 3, z: -6 }), back = toAnchor(A, w);
assert.ok(Math.abs(back.x - 1) < 1e-9 && Math.abs(back.y - 3) < 1e-9 && Math.abs(back.z + 6) < 1e-9);
const s0 = { x: 10, y: 5, z: 3, tx: 11, ty: 1, tz: -2 }, s1 = shotToWorld(A, shotFromWorld(A, s0));
for (const k of Object.keys(s0)) assert.ok(Math.abs(s1[k] - s0[k]) < 0.02, k);
// along the path is +z: a shot 5 behind (z -5) is behind the space
const behind = fromAnchor({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: -5 }); assert.equal(behind.z, -5);

// ---- the director on a stand-in scene
const pawn = { slot: 0, x: 0, y: 0, z: 0, yaw: 0, track: 'island', idx: 3, fx: null, wp: { clip: 'idle', f: 0 } };
const scene = { pawns: { 0: pawn }, pos: { island: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 4 }] }, camHold: null, snapCamera: false, banners: [], setBanner(t) { this.banners.push(t); }, clearBanner() { this.banners.push(null); }, place() {} };
let innerU = [], ended = 0;
const inner = () => ({ t: 0, dur: 1000, step(u) { innerU.push(u); pawn.fx = { x: 1, y: 0, z: 2, yaw: 0.5, clip: 'punch', clipF: 3 }; scene.camHold = { x: 9, y: 9, z: 9, tx: 0, ty: 0, tz: 0 }; }, end() { ended++; pawn.fx = null; scene.camHold = null; } });
// no sequence: untouched
const plain = inner(); assert.equal(direct(scene, plain, { t: 'move', mode: 'walk', slot: 0 }), plain);
// a sequence (as the editor would have it)
scene.seqEdit = { key: 'smash.dragon', seq: { blocks: [
  { track: 'builtin', at: 0, len: 30, from: 0, speed: 1 }, { track: 'builtin', at: 30, len: 60, from: 30, speed: 0 }, // half a second of the game's, then a second held
  { track: 'player', at: 30, len: 60, clip: 'pumped', from: 0, speed: 1, face: 'back' },
  { track: 'camera', at: 45, mode: 'cut', shot: { x: 0, y: 3, z: -6, tx: 0, ty: 1, tz: 2 } },
  { track: 'fx', at: 50, len: 20, action: 'banner', text: 'Yes!' },
  { track: 'player', at: 0, len: 30, clip: 'idle', rec: true }, // (recorded: shown, not played)
] } };
const a = inner(), W = direct(scene, a, { t: 'broken', challenge: 'dragon', slot: 0 });
assert.notEqual(W, a); assert.equal(W.moment, 'smash.dragon');
assert.equal(Math.round(W.dur), 1500, '90 frames: the held second makes it longer than the game\'s own');
const at = (f) => { W.t = f * 1000 / 60; W.step(Math.min(1, W.t / W.dur)); };
at(20); assert.equal(pawn.fx.clip, 'punch', "the game's own (the recorded block only shows)");
at(40); assert.equal(pawn.fx.clip, 'pumped'); assert.ok(Math.abs(pawn.fx.yaw - Math.PI) < 1e-9, 'faces back down the path'); assert.equal(pawn.fx.x, 1, 'still where the game put them');
assert.ok(Math.abs(innerU[innerU.length - 1] - 0.5) < 1e-6, "the game's own held at its frame 30");
assert.deepEqual(scene.camHold, { x: 9, y: 9, z: 9, tx: 0, ty: 0, tz: 0 }, "the set piece's camera until the shot");
at(46); assert.equal(scene.camHold.z, 3 - 6, 'the cut: 6 behind the space'); assert.equal(scene.snapCamera, true);
at(55); assert.deepEqual(scene.banners, ['Yes!']);
at(75); assert.deepEqual(scene.banners, ['Yes!', null], 'the caption goes after its 20 frames');
at(90); W.end();
assert.equal(ended, 1); assert.equal(pawn.fx, null); assert.equal(scene.camHold, null, 'the camera back to the game');
// recording: the clips the set piece played, as recorded blocks
const rec = recordedSequence('k', { innerFrames: 100, frames: [[0, 'idle', 0, null, 0], [10, 'idle', 10, null, 0], [20, 'punch', 0, null, 0], [50, 'punch', 30, null, 0]] });
assert.deepEqual(rec.blocks.filter((b) => b.track === 'player').map((b) => [b.at, b.len, b.clip, !!b.rec]), [[0, 10, 'idle', true], [20, 80, 'punch', true]]);
assert.equal(sequenceFrames(rec, 100), 100);
console.log('director tests passed');
