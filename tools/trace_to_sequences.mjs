// Turns moments taken from a trace of the real Board Game Island (tools: the Wii Party recomp's bgi-trace hook, see
// the project notes) into sequences for js15/game/sequences.js: each Mii's clips and faces at the real times, and the
// real camera as keyframes kept relative to the space the moment starts on.
//   node tools/trace_to_sequences.mjs tools/trace_moments.json > /tmp/seq.js && mv /tmp/seq.js js15/game/sequences.js
// (not straight into sequences.js: this reads it, through boardGame.js)
import fs from 'node:fs';
import { islandPositions } from '../js15/game/boardLayout.js';
import { ISLAND } from '../js15/game/boardData.js';
import { DUR } from '../js15/game/boardGame.js';
import { shotFromWorld } from '../js15/scenes/director.js';
import { CLIP_TABLE } from '../js15/world/clipTable.js';

const FPS = 60, P = islandPositions();
const more = JSON.parse(fs.readFileSync(new URL('../mii/clips/more-clips.json', import.meta.url), 'utf8')).clips;
const clip = (n) => CLIP_TABLE[n] || more[n];
const FACE = { Normal: 0, Smile: 1, Anger: 2, Sorrow: 3, Surprise: 4, Blink: 5, OpenMouth: 6 };
const f = (s) => Math.round(s * FPS);
// our own length of each moment's set piece (ms) and whether the game's motion is stretched to the real timing
const OWN = {
  'smash.dragon': [DUR.wall, false], 'note.fireball': [DUR.fire, false], 'move.knock': [DUR.knock, true], 'smash.final': [DUR.gate, false],
  'note.finalFail': [DUR.finalFail, false], 'duel.challenge': [DUR.banner, false], 'spike.shock': [DUR.shock, false],
  'move.spring.blue': [DUR.spring, true], 'move.spring.red': [DUR.spring, true], 'move.spring.green': [DUR.spring, true], 'move.spring.green.back': [DUR.spring, true],
  'move.fly.statue.blue': [DUR.statueThrow, true], 'move.fly.statue.red': [DUR.statueThrow, true], 'ufo.up': [DUR.ufo, true], 'ufo.down': [DUR.ufo, true],
  'note.crates': [700, false], 'move.swim': [DUR.swim, true], 'win': [3000, false],
};
// no recorded camera where the real one follows the Mii from a space that differs each time (the trace has the camera,
// not the Mii): springs go from many spaces, the UFO teleports. These keep the game's own follow camera.
const FACE_CAMERA = new Set(['duel.challenge']);
const NO_CAMERA = new Set(['ufo.up', 'ufo.down', 'move.spring.blue', 'move.spring.red', 'move.spring.green', 'move.spring.green.back']);
const TYPES = { 'move.spring.blue': ['plus4', 'plus5', 'plus6'], 'move.spring.red': ['minus4'], 'duel.challenge': ['mg11'] };
const IN_PLACE = { win: { pm000_03: 'pm011_08', pm000_04: 'pm011_08' } }; // (the real winner walks about the summit; ours stands)

function anchorAt(i) {
  const here = P[i], next = P[i + 1], prev = P[i - 1];
  const yaw = next ? Math.atan2(next.x - here.x, next.z - here.z) : Math.atan2(here.x - prev.x, here.z - prev.z);
  return { x: here.x, y: here.y, z: here.z, yaw };
}
/** The space the moment starts on: the named kind of space nearest to where the camera looks, or any space. */
function spaceOf(m) {
  const types = m.space ? [m.space] : TYPES[m.key] || null, t = m.cam[0] ? m.cam[0].tgt : null;
  let best = -1, bd = Infinity;
  P.forEach((p, i) => { if (types && !types.includes(ISLAND[i].type)) return; const d = t ? Math.hypot(p.x - t[0], p.z - t[2]) : 0; if (d < bd) { bd = d; best = i; } });
  return best;
}
function animBlocks(list, end) {
  const L = list.filter(([, c]) => clip(c));
  const out = [];
  L.forEach(([t, c], i) => {
    const t2 = i + 1 < L.length ? L[i + 1][0] : end;
    if (t2 - t < 0.1) return; // (a clip the game swapped to and away in the same moment)
    const prev = out[out.length - 1];
    if (prev && prev.clip === c) { prev.len = f(t2) - prev.at; return; }
    out.push({ at: f(t), len: Math.max(1, f(t2) - f(t)), clip: c, from: 0, speed: 1, facing: 'auto', ...(clip(c).loop ? {} : { loop: false }) });
  });
  if (out.length) { out[0].len += out[0].at; out[0].at = 0; } // (from the start)
  return out;
}
function faceBlocks(list, end) {
  const out = [];
  list.forEach(([t, name], i) => {
    const n = FACE[name] ?? 0, t2 = i + 1 < list.length ? list[i + 1][0] : end;
    if (!n || t2 - t < 0.05) return;
    out.push({ at: f(t), len: Math.max(1, f(t2) - f(t)), face: n });
  });
  return out;
}
const SEQ = {};
for (const m of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
  const T = m.t1 - m.t0, frames = f(T), [ownMs, stretch] = OWN[m.key] || [0, false], own = Math.round(ownMs * FPS / 1000);
  const seq = { key: m.key, v: 2, len: Math.max(frames, stretch ? 0 : own), builtin: [], miis: [], camera: [], fx: [], from: 'trace' };
  if (stretch && own) seq.builtin.push({ at: 0, len: frames, from: 0, speed: Math.round(own / frames * 1000) / 1000 });
  const swap = IN_PLACE[m.key] || {};
  for (const mi of m.miis) seq.miis.push({ anim: animBlocks(mi.anim.map(([t, c]) => [t, swap[c] || c]), T), face: faceBlocks(mi.face, T) });
  if (!NO_CAMERA.has(m.key) && m.cam.length) {
    const sp = spaceOf(m), A = anchorAt(sp);
    seq.space = ISLAND[sp].type;
    for (const k of m.cam) {
      if (k.t > T) continue;
      seq.camera.push({ at: Math.max(0, f(k.t)), kind: 'shot', ease: k.cut ? 'cut' : 'linear', follow: null,
        shot: shotFromWorld(A, { x: k.eye[0], y: k.eye[1], z: k.eye[2], tx: k.tgt[0], ty: k.tgt[1], tz: k.tgt[2] }) });
    }
    // (two keys on one frame: keep the later)
    seq.camera = seq.camera.filter((k, i, a) => !(a[i + 1] && a[i + 1].at === k.at));
  }
  if (FACE_CAMERA.has(m.key)) for (const b of seq.miis[0].anim) b.facing = 'camera'; // (the pose is struck at you)
  SEQ[m.key] = seq;
}
// made by hand from what the trace shows (the board, back from a 1 vs 1): the winner pumps a fist and smiles, the loser
// hangs their head (pm001_06 / pm001_07, as after every minigame)
SEQ['duel.result'] = { key: 'duel.result', v: 2, len: 120, builtin: [], camera: [], fx: [], from: 'trace',
  miis: [{ anim: [{ at: 0, len: 84, clip: 'pm001_06', from: 0, speed: 1, facing: 'camera', loop: false }], face: [{ at: 0, len: 110, face: 1 }] },
    { anim: [{ at: 0, len: 92, clip: 'pm001_07', from: 0, speed: 1, facing: 'auto', loop: false }], face: [{ at: 0, len: 110, face: 3 }] }] };
const head = `// The moments' sequences: what the director (js15/scenes/director.js) plays over the game's own set pieces.
// Made in the sequence studio, or taken from a trace of the real Board Game Island (tools/trace_to_sequences.mjs:
// the real clips, faces, timings and camera). A sequence saved in a browser's studio plays there over these.
`;
process.stdout.write(`${head}export const SEQUENCES = ${JSON.stringify(SEQ)};\n`);
