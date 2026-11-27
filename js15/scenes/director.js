// The director: plays a moment's sequence (made in the sequence studio, studioScene.js) over the game's own set piece.
//
// A sequence (see upgradeSequence in moments.js) has, in frames (60 a second):
//   builtin  the game's own set piece (its motion, its effects): which stretch of it plays when, how fast. Without any
//            blocks it plays as it is, from the start. A block with speed 0 holds it (everyone waits).
//   miis     one entry per Mii in the moment (Mii 1 is the one whose moment it is; see castOf in moments.js), each with
//            two tracks: `anim` (which Wii Party animation their body plays, from which frame, how fast, which way they
//            face; the game still moves them, this is what the body does) and `face` (one of the seven Mii faces).
//   camera   keyframes. A 'shot' key is a camera position and the point it looks at, kept relative to the space the
//            moment starts on (and the way the path goes there) so it fits every space of that kind, or to a Mii
//            (follow). Between two shot keys the camera moves smoothly (or at an even speed, or cuts at the second).
//            An 'own' key hands the camera back to the set piece's own cameras; a 'normal' key to the board's camera.
//            A 'board' key: the real game's board camera in one of its shots (follow, turn, react: boardCamera.js), on
//            a Mii (follow: which). Before the first key, the set piece's own.
//   fx       things that happen: a glint, the screen shaking, a caption, a fade to black, a wall's jolt, stone chips,
//            close-up (no number badges).
// A block recorded from the game (rec) is only shown: it is what the game does there now, to edit from.

import { SEQUENCES } from '../game/sequences.js';
import { momentKey, sequenceFrames, upgradeSequence, sequenceIsEmpty } from '../game/moments.js';
import { ISLAND, VOLCANO } from '../game/boardData.js';
import { PLAYER_COLORS } from '../config.js';
import { clipLength } from '../world/clipTable.js';

const LOCAL = 'party-island-sequences';
const FPS = 60;

/** Sequences saved in this browser (the studio's), over the game's own. */
export function localSequences() {
  try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL)) || '{}') || {}; } catch (e) { return {}; }
}
export function saveLocalSequences(all) {
  try { localStorage.setItem(LOCAL, JSON.stringify(all)); return true; } catch (e) { return false; }
}
/** The sequence a moment plays: this browser's (the studio's) if there is one, else the game's, else none. */
export function sequenceFor(key) {
  const mine = localSequences();
  if (mine[key]) return upgradeSequence(mine[key]);
  return upgradeSequence(SEQUENCES[key] || null);
}

/** The kind of space a player is on (for a note: each kind of space has its own). */
export function spotOf(scene, slot) {
  const p = scene.pawns && scene.pawns[slot];
  if (!p) return null;
  const n = (p.track === 'volcano' ? VOLCANO : ISLAND)[p.idx];
  return n ? n.type : null;
}

/** The space a moment starts on, and which way the path goes there: what camera shots are kept relative to. */
export function anchorOf(scene, slot) {
  const p = scene.pawns && scene.pawns[slot];
  const P = p && scene.pos && scene.pos[p.track || 'island'];
  const here = P && P[p.idx];
  if (!here) return { x: p ? p.x : 0, y: p ? p.y : 0, z: p ? p.z : 0, yaw: p ? p.yaw || 0 : 0 };
  const next = P[p.idx + 1], prev = P[p.idx - 1];
  const yaw = next ? Math.atan2(next.x - here.x, next.z - here.z) : prev ? Math.atan2(here.x - prev.x, here.z - prev.z) : p.yaw || 0;
  return { x: here.x, y: here.y, z: here.z, yaw };
}

/** A point kept relative to an anchor (x: to the right, y: up, z: along the path) into the scene, and back. */
export function fromAnchor(A, l) {
  const fx = Math.sin(A.yaw), fz = Math.cos(A.yaw), rx = -fz, rz = fx;
  return { x: A.x + rx * l.x + fx * l.z, y: A.y + l.y, z: A.z + rz * l.x + fz * l.z };
}
export function toAnchor(A, w) {
  const fx = Math.sin(A.yaw), fz = Math.cos(A.yaw), rx = -fz, rz = fx, dx = w.x - A.x, dz = w.z - A.z;
  return { x: dx * rx + dz * rz, y: w.y - A.y, z: dx * fx + dz * fz };
}
export const shotToWorld = (A, s) => { const p = fromAnchor(A, s), t = fromAnchor(A, { x: s.tx, y: s.ty, z: s.tz }); return { x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z }; };
export const shotFromWorld = (A, w) => { const p = toAnchor(A, w), t = toAnchor(A, { x: w.tx, y: w.ty, z: w.tz }); return { x: round(p.x), y: round(p.y), z: round(p.z), tx: round(t.x), ty: round(t.y), tz: round(t.z) }; };
const round = (v) => Math.round(v * 100) / 100;
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const KEYS6 = ['x', 'y', 'z', 'tx', 'ty', 'tz'];

/** Where the game's own set piece is (in its frames) at sequence frame T. */
export function builtinFrame(blocks, T) {
  const bs = (blocks || []).filter((b) => !b.rec).sort((a, b) => a.at - b.at);
  if (!bs.length) return T;
  let cur = null; for (const b of bs) if (b.at <= T) cur = b;
  if (!cur) return bs[0].from || 0;
  return (cur.from || 0) + Math.min(T - cur.at, cur.len || 0) * (cur.speed ?? 1);
}

/** The block of a list playing at frame T (the last one started that has not ended). */
export function activeBlock(blocks, T) {
  let cur = null;
  for (const b of blocks || []) if (!b.rec && b.at <= T && T < b.at + Math.max(1, b.len || 0) && (!cur || b.at >= cur.at)) cur = b;
  return cur;
}

/**
 * Who a moment is about, in the order of its Mii tracks: its player, then the others the event names (the opponent,
 * who they swap with, the stretch...), then everyone else by player number.
 */
export function castSlots(scene, ev, anim) {
  const slot = ev.slot ?? scene.camSlot ?? 0, out = [slot];
  const add = (s) => { if (s != null && !out.includes(s) && scene.pawns && scene.pawns[s]) out.push(s); };
  for (const s of [ev.opp, ev.with, ev.victim, ev.other, ...(ev.cast || []), ...(ev.order || []), ...(ev.wonder || []), ...(ev.slots || []), ...((anim && anim.otherSlots) || [])]) add(s);
  for (const s of Object.keys(scene.pawns || {}).map(Number).sort((a, b) => a - b)) add(s);
  return out;
}

/** The camera at frame T from keyframes: { kind: 'none' | 'own' | 'normal' | 'shot', pose, cut }. `where(k)` gives a key's anchor. */
export function cameraAt(keys, T, where) {
  const ks = (keys || []).filter((k) => !k.rec).sort((a, b) => a.at - b.at);
  let i = -1; for (let j = 0; j < ks.length; j++) if (ks[j].at <= T) i = j;
  if (i < 0) return { kind: 'none' };
  const k = ks[i];
  if (k.kind === 'own' || k.kind === 'normal' || k.kind === 'board') return { kind: k.kind, key: k };
  const pose = (q) => shotToWorld(where(q), q.shot);
  const P1 = pose(k), next = ks[i + 1];
  if (!next || next.kind !== 'shot' || next.ease === 'cut' || next.at <= k.at) return { kind: 'shot', pose: P1, key: k };
  const raw = (T - k.at) / (next.at - k.at), u = next.ease === 'linear' ? raw : ease(raw);
  const P2 = pose(next), prev = ks[i - 1], after = ks[i + 2];
  const P0 = prev && prev.kind === 'shot' && k.ease !== 'cut' ? pose(prev) : P1, P3 = after && after.kind === 'shot' && after.ease !== 'cut' ? pose(after) : P2;
  const out = {};
  for (const c of KEYS6) out[c] = catmull(P0[c], P1[c], P2[c], P3[c], u); // (through every key, without corners)
  return { kind: 'shot', pose: out, key: k, between: [k, next] };
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Show one of the seven Mii faces (0 normal, 1 smile, 2 anger, 3 sorrow, 4 surprise, 5 blink, 6 open mouth) on a pawn. */
export function setPawnFace(p, n) {
  const cm = p && p.fflHead && p.fflHead.userData && p.fflHead.userData.charModel;
  if (!cm || p.face === n) return;
  try { cm.setExpression(n); p.face = n; } catch (e) { /* this head was made without that face */ }
}

/**
 * Wrap a set piece of the scene (an anim: { t, dur, step(u), end() }) in its moment's sequence. Unchanged when the
 * moment has none (and nothing is being recorded or edited).
 */
export function direct(scene, anim, ev) {
  if (!anim || !ev) return anim;
  const cast = castSlots(scene, ev, anim), slot = cast[0];
  const key = momentKey(ev, ev.t === 'space' && !ev.fx ? spotOf(scene, slot) : null);
  if (!key) return anim;
  anim.moment = key;
  const editing = scene.seqEdit && scene.seqEdit.key === key ? scene.seqEdit : null;
  const seq = upgradeSequence(editing ? editing.seq : sequenceFor(key));
  const rec = scene.seqRecord && scene.seqRecord.key === key ? scene.seqRecord : null;
  if ((!seq || sequenceIsEmpty(seq)) && !rec && !editing) return anim;
  const S = seq || { v: 2, builtin: [], miis: [], camera: [], fx: [] };

  const innerFrames = Math.max(1, Math.round((anim.dur || 0) * FPS / 1000));
  const total = Math.max(1, sequenceIsEmpty(S) && !S.len ? innerFrames : sequenceFrames(S, innerFrames));
  const A = anchorOf(scene, slot);
  const pawn = (k) => scene.pawns && scene.pawns[k];
  const st = { prevT: -1, innerHold: scene.camHold, ours: false, fired: new Set(), touched: new Set(), faced: new Set(), shake: false, banner: false, fade: false, closeUp: false, lastKey: null, lastPose: null };
  const record = rec ? { frames: [], innerFrames, cast: cast.length } : null;
  // where a camera key is kept relative to: the space, or a Mii (follow), as they are now
  const where = (k) => {
    if (k.follow == null || k.follow === false) return A;
    const p = pawn(cast[k.follow === true ? 0 : k.follow]);
    if (!p) return A;
    return { ...A, x: p.fx && p.fx.x != null ? p.fx.x : p.x, y: p.fx && p.fx.y != null ? p.fx.y : p.y, z: p.fx && p.fx.z != null ? p.fx.z : p.z };
  };

  const W = {
    t: 0, dur: total * 1000 / FPS, moment: key, inner: anim, ev, cast,
    step(u) {
      const T = u * total;
      // the game's own set piece, at its own time (its camera as it left it)
      if (st.ours) scene.camHold = st.innerHold;
      const B = Math.max(0, Math.min(innerFrames, builtinFrame(S.builtin, T)));
      anim.t = B * 1000 / FPS;
      if (anim.step) anim.step(Math.min(1, anim.t / Math.max(1, anim.dur)));
      st.innerHold = scene.camHold;
      if (editing) Object.assign(editing, { T, B, anchor: A, innerFrames, total, cast }); // (the studio's playhead)
      if (record) { // (what the set piece asks for now; otherwise what the body chose last frame: a walk, idle)
        const c = (q) => (q && q.fx && q.fx.clip ? [q.fx.clip, q.fx.clipF ?? (q.wp ? q.wp.f : 0)] : q && q.wp ? [q.wp.clip, q.wp.f] : [null, 0]);
        record.frames.push([T, ...cast.slice(0, 6).map((s) => c(pawn(s)))]);
      }
      // each Mii: their body, their face
      (S.miis || []).forEach((m, i) => {
        const p = pawn(cast[i]); if (!p) return;
        applyBody(scene, activeBlock(m.anim, T), T, p, A, st);
        const f = activeBlock(m.face, T);
        if (f) { setPawnFace(p, f.face | 0); st.faced.add(p); } else if (st.faced.has(p)) setPawnFace(p, 0);
      });
      // the camera
      const cam = cameraAt(S.camera, T, where);
      if (cam.kind === 'shot') {
        if (st.lastKey !== cam.key && !cam.between) scene.snapCamera = true; // (a cut)
        scene.camHold = cam.pose; st.lastPose = cam.pose; st.ours = true; scene.snapCamera = true; st.lastKey = cam.key;
      } else if (cam.kind === 'board') { // the real game's board camera, in one of its shots (boardCamera.js: follow, turn, react), on a Mii
        if (scene.camHold === st.lastPose || st.lastKey !== cam.key) scene.camHold = null;
        scene.camPreset = { name: cam.key.preset || 'follow', slot: cast[cam.key.follow == null ? 0 : cam.key.follow] };
        st.ours = true; st.preset = true; st.lastKey = cam.key;
      } else if (cam.kind === 'normal') {
        if (!st.ours || st.lastKey !== cam.key) scene.snapCamera = true;
        scene.camHold = null; st.ours = true; st.lastKey = cam.key;
      } else if (st.ours) { st.ours = false; st.lastKey = null; scene.snapCamera = true; } // back to the set piece's own
      if (cam.kind !== 'board' && st.preset) { scene.camPreset = null; st.preset = false; }
      // things that happen
      applyFx(scene, S.fx || [], T, st, cast, A);
      st.prevT = T;
    },
    end() {
      if (st.ours) scene.camHold = st.innerHold;
      if (anim.end) anim.end();
      if (st.ours && (scene.camHold === st.lastPose || scene.camHold === null)) { scene.camHold = null; scene.snapCamera = true; }
      for (const p of st.touched) if (p && p.fx && p.fx.__dir) { p.fx = null; } // (bodies the sequence moved, back to the game's)
      for (const p of st.faced) setPawnFace(p, 0);
      if (st.preset) { scene.camPreset = null; st.preset = false; }
      if (st.shake) scene.shake = 0;
      if (st.banner && scene.clearBanner) scene.clearBanner();
      if (st.closeUp) scene.closeUp = false;
      if (st.fade) fadeEl(0);
      if (record) rec.done(recordedSequence(key, record));
      if (editing) editing.done = true;
    },
  };
  return W;
}

/** The animation (and facing) a block gives a body at frame T. */
function applyBody(scene, b, T, p, A, st) {
  if (!b || !b.clip) return;
  const base = p.fx || {}, x = base.x ?? p.x, y = base.y ?? p.y, z = base.z ?? p.z;
  const frames = clipLength(b.clip), local = (T - b.at) * (b.speed ?? 1) + (b.from || 0);
  const clipF = frames ? (b.loop === false ? Math.min(frames - 1, local) : local % frames) : local;
  let yaw = base.yaw ?? p.yaw;
  const cam = scene.camera && scene.camera.position;
  if (b.facing === 'camera' && cam) yaw = Math.atan2(cam.x - x, cam.z - z);
  else if (b.facing === 'forward') yaw = A.yaw;
  else if (b.facing === 'back') yaw = A.yaw + Math.PI;
  else if (b.facing === 'left') yaw = A.yaw + Math.PI / 2;
  else if (b.facing === 'right') yaw = A.yaw - Math.PI / 2;
  else if (typeof b.facing === 'number') yaw = A.yaw + b.facing * Math.PI / 180;
  p.fx = { ...base, x, y, z, yaw, clip: b.clip, clipF, __dir: true };
  p.faceYaw = yaw;
  st.touched.add(p);
  if (scene.place) scene.place(p);
}

function fadeEl(o) {
  const f = typeof document !== 'undefined' && document.querySelector && document.querySelector('#fade');
  if (f) { f.style.transition = 'none'; f.style.opacity = String(o); }
}

/** Where an effect goes: on a Mii ('mii1'...; 'player' is Mii 1), or one of a wall's hit spots ('dragon.hit1', 'gate.break'). */
function fxAt(scene, where, cast) {
  if (where && where.includes('.') && scene.fx && scene.fx.breakRig) {
    const [model, hook] = where.split('.');
    if (scene.fx.breakRig(model)) { const h = scene.fx.hookAt(model, hook); if (h) return h; }
  }
  const m = /^mii(\d)$/.exec(where || ''), p = scene.pawns && scene.pawns[cast[m ? Number(m[1]) - 1 : 0]];
  if (!p) return null;
  const x = p.fx && p.fx.x != null ? p.fx.x : p.x, y = p.fx && p.fx.y != null ? p.fx.y : p.y, z = p.fx && p.fx.z != null ? p.fx.z : p.z, yaw = (p.fx && p.fx.yaw) ?? p.yaw ?? 0;
  return { x: x + Math.sin(yaw) * 0.7, y: y + 1.3, z: z + Math.cos(yaw) * 0.7, slot: p.slot };
}

function applyFx(scene, blocks, T, st, cast, A) {
  let shake = false, closeUp = false, fade = null;
  for (const b of blocks) {
    if (b.rec) continue;
    const on = T >= b.at && T < b.at + Math.max(1, b.len || 1), starts = st.prevT < b.at && T >= b.at;
    if (starts && !st.fired.has(b)) {
      st.fired.add(b);
      const at = fxAt(scene, b.where, cast), who = at && at.slot != null ? at.slot : cast[0];
      const color = b.color && b.color !== 'player' ? b.color : (PLAYER_COLORS[who] || PLAYER_COLORS[0]).hex;
      if (b.action === 'glint' && at && scene.fx && scene.fx.glint) scene.fx.glint(at, color, b.size || 1);
      if (b.action === 'chips' && at && scene.fx && scene.fx.burst) scene.fx.burst(at);
      if (b.action === 'banner' && scene.setBanner) { scene.setBanner(scene.fillNames ? scene.fillNames(b.text || '') : b.text || ''); st.banner = true; }
    }
    if (b.action === 'banner' && st.banner && T >= b.at + (b.len || 0) && st.prevT < b.at + (b.len || 0) && scene.clearBanner) { scene.clearBanner(); st.banner = false; }
    if (!on) continue;
    if (b.action === 'shake') shake = true;
    if (b.action === 'closeUp') closeUp = true;
    if (b.action === 'fade') { const k = (T - b.at) / Math.max(1, b.len), o = k < 0.5 ? k * 2 : 2 - k * 2; fade = Math.max(fade ?? 0, Math.min(1, o * 1.15)); }
    if (b.action === 'jolt' && scene.fx && scene.fx.breakRig) { const r = scene.fx.breakRig(b.where && b.where.startsWith('gate') ? 'gate' : 'dragon'); if (r) { const f = T - b.at; if (f < r.frames('hit')) r.pose('hit', f); else r.rest(); } }
  }
  if (shake) { scene.shake = 1; st.shake = true; } else if (st.shake) { scene.shake = 0; st.shake = false; }
  if (closeUp) { scene.closeUp = true; st.closeUp = true; } else if (st.closeUp) { scene.closeUp = false; st.closeUp = false; }
  if (fade != null) { fadeEl(fade); st.fade = true; } else if (st.fade) { fadeEl(0); st.fade = false; }
}

/**
 * What the game did, as a sequence to start editing from: the set piece at its own pace, and the clips each Mii played,
 * as blocks marked 'rec' (shown, not played: change one and it plays).
 */
export function recordedSequence(key, rec) {
  const n = Math.max(1, Math.min(6, rec.cast || 1));
  const out = { key, v: 2, builtin: [{ at: 0, len: rec.innerFrames, from: 0, speed: 1 }], miis: [], camera: [], fx: [] };
  for (let m = 0; m < n; m++) {
    const anim = [];
    let cur = null;
    rec.frames.forEach((f, i) => {
      const T = i === 0 ? 0 : Math.round(f[0]), [clip, cf] = f[1 + m] || [null, 0]; // (the first frame drawn is the start)
      if (cur && cur.clip === clip) { cur.len = Math.max(1, T - cur.at); return; }
      if (cur) anim.push(cur);
      cur = clip ? { at: T, len: 1, clip, from: Math.max(0, Math.round(cf)), speed: 1, facing: 'auto', rec: true } : null;
    });
    if (cur) { cur.len = Math.max(cur.len, rec.innerFrames - cur.at); anim.push(cur); } // (the last one lasts to the end)
    out.miis.push({ anim, face: [] });
  }
  return out;
}
