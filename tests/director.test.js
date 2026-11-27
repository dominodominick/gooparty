// The sequence director (js15/scenes/director.js) and the moments (js15/game/moments.js), on a stand-in scene.
import assert from 'node:assert/strict';
import { momentKey, allMoments, sequenceFrames, upgradeSequence, castOf } from '../js15/game/moments.js';
import { direct, builtinFrame, activeBlock, fromAnchor, toAnchor, shotToWorld, shotFromWorld, recordedSequence, cameraAt, castSlots } from '../js15/scenes/director.js';

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
for (const k of ['note@plus4', 'note@skull', 'note@shout', 'smash.dragon', 'move.knock', 'ufo.up', 'ufo.down', 'turn.start', 'minigame.duel', 'minigame.rest', 'eruption']) assert.ok(M.some((m) => m.key === k), k);

// ---- the game's own set piece under the sequence: held, slowed
const bl = [{ at: 0, len: 60, from: 0, speed: 1 }, { at: 60, len: 30, from: 60, speed: 0 }, { at: 90, len: 60, from: 60, speed: 0.5 }];
assert.equal(builtinFrame(bl, 30), 30); assert.equal(builtinFrame(bl, 75), 60, 'held'); assert.equal(builtinFrame(bl, 110), 70, 'half speed');
assert.equal(builtinFrame([], 42), 42, 'none: as made');
assert.equal(sequenceFrames({ v: 2, builtin: bl, miis: [], camera: [], fx: [] }), 150);
assert.equal(sequenceFrames({ v: 2, builtin: [], miis: [{ anim: [{ at: 0, len: 20 }], face: [] }], camera: [], fx: [] }, 100), 100, "without builtin blocks it is at least the game's own length");
assert.equal(sequenceFrames({ v: 2, len: 240, builtin: [], miis: [], camera: [], fx: [] }, 100), 240, 'its own length when set');
assert.equal(activeBlock([{ at: 0, len: 5 }], 30), null, 'a block only for its length');
assert.equal(activeBlock([{ at: 0, len: 50 }, { at: 10, len: 5 }], 12).at, 10, 'the later one wins');

// ---- an old sequence (one list of blocks) becomes a new one
const up = upgradeSequence({ key: 'k', blocks: [{ track: 'player', at: 0, len: 10, clip: 'punch', face: 'back' }, { track: 'others', at: 5, len: 10, clip: 'shock' }, { track: 'camera', at: 20, mode: 'cut', shot: { x: 1, y: 2, z: 3, tx: 0, ty: 0, tz: 0 } }, { track: 'camera', at: 40, len: 20, mode: 'glide', shot: { x: 0, y: 2, z: 3, tx: 0, ty: 0, tz: 0 } }, { track: 'camera', at: 90, mode: 'builtin' }] });
assert.equal(up.v, 2); assert.equal(up.miis[0].anim[0].facing, 'back', "the old 'face' was the facing"); assert.equal(up.miis[1].anim[0].clip, 'shock');
assert.deepEqual(up.camera.map((k) => [k.at, k.kind, k.ease || '']), [[20, 'shot', 'cut'], [60, 'shot', 'smooth'], [90, 'own', '']]);

// ---- shots relative to a space: back and forth
const A = { x: 10, y: 2, z: -4, yaw: 0.7 };
const w = fromAnchor(A, { x: 1, y: 3, z: -6 }), back = toAnchor(A, w);
assert.ok(Math.abs(back.x - 1) < 1e-9 && Math.abs(back.y - 3) < 1e-9 && Math.abs(back.z + 6) < 1e-9);
const s0 = { x: 10, y: 5, z: 3, tx: 11, ty: 1, tz: -2 }, s1 = shotToWorld(A, shotFromWorld(A, s0));
for (const k of Object.keys(s0)) assert.ok(Math.abs(s1[k] - s0[k]) < 0.02, k);
const behind = fromAnchor({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: -5 }); assert.equal(behind.z, -5);

// ---- camera keyframes: through each key, smooth between, cuts, handing back
const O = { x: 0, y: 0, z: 0, yaw: 0 }, at0 = () => O;
const K = [{ at: 10, kind: 'shot', shot: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 } }, { at: 30, kind: 'shot', ease: 'smooth', shot: { x: 0, y: 10, z: 0, tx: 0, ty: 0, tz: 1 } }, { at: 50, kind: 'shot', ease: 'cut', shot: { x: 0, y: 99, z: 0, tx: 0, ty: 0, tz: 1 } }, { at: 70, kind: 'own' }];
assert.equal(cameraAt(K, 5, at0).kind, 'none', "before the first key: the set piece's own");
assert.equal(cameraAt(K, 10, at0).pose.y, 0); assert.equal(cameraAt(K, 30, at0).pose.y, 10, 'exactly on each key');
const mid = cameraAt(K, 20, at0).pose.y; assert.ok(mid > 3 && mid < 7, `between: ${mid}`);
assert.ok(cameraAt(K, 13, at0).pose.y < 1, 'eases out of the first');
assert.equal(cameraAt(K, 45, at0).pose.y, 10, 'holds until the cut'); assert.equal(cameraAt(K, 50, at0).pose.y, 99, 'cuts at the key');
assert.equal(cameraAt(K, 80, at0).kind, 'own', 'handed back');
assert.ok(Math.abs(cameraAt([K[0], { ...K[1], ease: 'linear' }], 20, at0).pose.y - 5) < 1e-9, 'even speed');

// ---- the director on a stand-in scene
const faces = [];
const head = (slot) => ({ userData: { charModel: { setExpression(n) { faces.push([slot, n]); } } } });
const pawn = { slot: 0, x: 0, y: 0, z: 0, yaw: 0, track: 'island', idx: 3, fx: null, wp: { clip: 'idle', f: 0 }, fflHead: head(0) };
const pawn1 = { slot: 1, x: 5, y: 0, z: 5, yaw: 0, track: 'island', idx: 1, fx: null, wp: { clip: 'idle', f: 0 }, fflHead: head(1) };
const scene = { pawns: { 0: pawn, 1: pawn1 }, pos: { island: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 4 }] }, camHold: null, snapCamera: false, banners: [], setBanner(t) { this.banners.push(t); }, clearBanner() { this.banners.push(null); }, place() {} };
let innerU = [], ended = 0;
const inner = () => ({ t: 0, dur: 1000, step(u) { innerU.push(u); pawn.fx = { x: 1, y: 0, z: 2, yaw: 0.5, clip: 'punch', clipF: 3 }; scene.camHold = { x: 9, y: 9, z: 9, tx: 0, ty: 0, tz: 0 }; }, end() { ended++; pawn.fx = null; scene.camHold = null; } });
// no sequence: untouched
const plain = inner(); assert.equal(direct(scene, plain, { t: 'move', mode: 'walk', slot: 0 }), plain);
// who is in it: the player, the opponent, then everyone else
assert.deepEqual(castSlots(scene, { t: 'minigame', kind: 'duel', slot: 1, opp: 0 }), [1, 0]);
assert.deepEqual(castSlots(scene, { t: 'eruption', slot: 1 }), [1, 0]);
// a sequence (as the studio would have it): the 1 vs 1 space, before the minigame
scene.seqEdit = { key: 'minigame.duel', seq: { key: 'minigame.duel', v: 2,
  builtin: [{ at: 0, len: 30, from: 0, speed: 1 }, { at: 30, len: 60, from: 30, speed: 0 }], // half a second of the game's, then a second held
  miis: [{ anim: [{ at: 30, len: 60, clip: 'pumped', from: 0, speed: 1, facing: 'back' }, { at: 0, len: 30, clip: 'idle', rec: true }], face: [{ at: 40, len: 20, face: 1 }] },
    { anim: [{ at: 30, len: 60, clip: 'shock', from: 0, speed: 1, facing: 'auto' }], face: [{ at: 30, len: 60, face: 4 }] }],
  camera: [{ at: 45, kind: 'shot', ease: 'cut', shot: { x: 0, y: 3, z: -6, tx: 0, ty: 1, tz: 2 } }],
  fx: [{ at: 50, len: 20, action: 'banner', text: 'Yes!' }] } };
const a = inner(), Wr = direct(scene, a, { t: 'minigame', kind: 'duel', slot: 0, opp: 1 });
assert.notEqual(Wr, a); assert.equal(Wr.moment, 'minigame.duel'); assert.deepEqual(Wr.cast, [0, 1]);
assert.equal(Math.round(Wr.dur), 1500, "90 frames: the held second makes it longer than the game's own");
const at = (f) => { Wr.t = f * 1000 / 60; Wr.step(Math.min(1, Wr.t / Wr.dur)); };
at(20); assert.equal(pawn.fx.clip, 'punch', "the game's own (the recorded block only shows)");
at(40); assert.equal(pawn.fx.clip, 'pumped'); assert.ok(Math.abs(pawn.fx.yaw - Math.PI) < 1e-9, 'faces back down the path'); assert.equal(pawn.fx.x, 1, 'still where the game put them');
assert.equal(pawn1.fx.clip, 'shock', 'Mii 2 (the opponent) has their own track');
assert.deepEqual(faces.slice(-2).sort(), [[0, 1], [1, 4]].sort(), 'each face: Mii 1 smiles, Mii 2 is surprised');
assert.ok(Math.abs(innerU[innerU.length - 1] - 0.5) < 1e-6, "the game's own held at its frame 30");
assert.deepEqual(scene.camHold, { x: 9, y: 9, z: 9, tx: 0, ty: 0, tz: 0 }, "the set piece's camera until the first key");
at(46); assert.equal(scene.camHold.z, 3 - 6, 'the keyframe: 6 behind the space'); assert.equal(scene.snapCamera, true);
at(55); assert.deepEqual(scene.banners, ['Yes!']);
at(65); assert.deepEqual(faces[faces.length - 1], [0, 0], "Mii 1's smile over: back to normal");
at(75); assert.deepEqual(scene.banners, ['Yes!', null], 'the caption goes after its 20 frames');
at(90); Wr.end();
assert.equal(ended, 1); assert.equal(pawn.fx, null); assert.equal(pawn1.fx, null); assert.equal(scene.camHold, null, 'the camera back to the game');
assert.equal(pawn1.face, 0, 'faces back to normal at the end');
// recording: the clips each Mii played, as recorded blocks
const rec = recordedSequence('k', { innerFrames: 100, cast: 2, frames: [[0, ['idle', 0], ['walk', 0]], [10, ['idle', 10], ['walk', 10]], [20, ['punch', 0], ['walk', 20]], [50, ['punch', 30], ['shock', 0]]] });
assert.deepEqual(rec.miis[0].anim.map((b) => [b.at, b.len, b.clip, !!b.rec]), [[0, 10, 'idle', true], [20, 80, 'punch', true]]);
assert.deepEqual(rec.miis[1].anim.map((b) => [b.at, b.clip]), [[0, 'walk'], [50, 'shock']]);
assert.equal(sequenceFrames(rec, 100), 100);
// the moments: every special space is there, with its Miis
assert.deepEqual(castOf('minigame.duel'), ['Challenger', 'Opponent']);
assert.equal(momentKey({ t: 'minigame', kind: 'rest', slot: 0 }), 'minigame.rest');
assert.equal(momentKey({ t: 'eruption', active: 1, dur: 0 }), '', 'an eruption wearing off is no moment');
console.log('director tests passed');
