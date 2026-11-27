// The director: plays a moment's sequence (made in the sequence editor) over the game's own set piece.
//
// A sequence is blocks on a timeline, in frames (60 a second), each on a track:
//   builtin  the game's own set piece (its motion, its effects): which stretch of it plays when, how fast. Without any,
//            it plays as it is, from the start. A block with speed 0 holds it (everyone waits).
//   player   the Mii whose moment it is: which animation (any Wii Party clip), from which frame, how fast, which way
//            they face. The game still moves them (an arc, a walk); this decides what their body does.
//   others   the same for everyone else in the moment (the spike ball's stretch, a UFO swap).
//   camera   a shot: cut to it, or glide to it over the block; 'game' = the normal camera, 'builtin' = the set piece's own.
//            A shot is kept relative to the space the moment starts on (and the way the path goes there), so it fits
//            every space of that kind; 'follow' keeps it relative to the player as they move.
//   fx       something happens: a glint, the screen shaking, a caption, a fade to black, a wall's jolt, stone chips,
//            close-up (no number badges).
// A block recorded from the game (rec) is only shown: it is what the game does there now, to edit from.

import { SEQUENCES } from '../game/sequences.js';
import { momentKey, sequenceFrames } from '../game/moments.js';
import { ISLAND, VOLCANO } from '../game/boardData.js';
import { PLAYER_COLORS } from '../config.js';
import { clipLength } from '../world/clipTable.js';

const LOCAL = 'party-island-sequences';
const FPS = 60;

/** Sequences saved in this browser (the editor's), over the game's own. */
export function localSequences() {
  try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL)) || '{}') || {}; } catch (e) { return {}; }
}
export function saveLocalSequences(all) {
  try { localStorage.setItem(LOCAL, JSON.stringify(all)); return true; } catch (e) { return false; }
}
/** The sequence a moment plays: this browser's (the editor's) if there is one, else the game's, else none. */
export function sequenceFor(key) {
  const mine = localSequences();
  if (mine[key]) return mine[key];
  return SEQUENCES[key] || null;
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

/** Where the game's own set piece is (in its frames) at sequence frame T. */
export function builtinFrame(blocks, T) {
  const bs = blocks.filter((b) => b.track === 'builtin' && !b.rec).sort((a, b) => a.at - b.at);
  if (!bs.length) return T;
  let cur = null; for (const b of bs) if (b.at <= T) cur = b;
  if (!cur) return bs[0].from || 0;
  return (cur.from || 0) + Math.min(T - cur.at, cur.len || 0) * (cur.speed ?? 1);
}

/** The block of a track playing at frame T (the last one started; a camera or builtin block lasts until the next). */
export function activeBlock(blocks, track, T, lasting = false) {
  let cur = null;
  for (const b of blocks) if (b.track === track && !b.rec && b.at <= T && (lasting || T < b.at + (b.len || 0)) && (!cur || b.at >= cur.at)) cur = b;
  return cur;
}

/** Who a moment is about: its player, and everyone else in it. */
function actorsOf(scene, ev, anim) {
  const slot = ev.slot ?? scene.camSlot ?? 0;
  const others = new Set([...(ev.slots || []), ...((anim && anim.otherSlots) || []), ...(ev.victim != null ? [ev.victim] : []), ...(ev.other != null ? [ev.other] : [])]);
  others.delete(slot);
  return { slot, others: [...others] };
}

/**
 * Wrap a set piece of the scene (an anim: { t, dur, step(u), end() }) in its moment's sequence. Unchanged when the
 * moment has none (and nothing is being recorded or edited).
 */
export function direct(scene, anim, ev) {
  if (!anim || !ev) return anim;
  const { slot, others } = actorsOf(scene, ev, anim);
  const key = momentKey(ev, ev.t === 'space' ? spotOf(scene, slot) : null);
  if (!key) return anim;
  anim.moment = key;
  const editing = scene.seqEdit && scene.seqEdit.key === key ? scene.seqEdit : null;
  const seq = editing ? editing.seq : sequenceFor(key);
  const rec = scene.seqRecord && scene.seqRecord.key === key ? scene.seqRecord : null;
  const blocks = ((seq && seq.blocks) || []).filter((b) => !b.rec);
  if (!blocks.length && !rec && !editing) return anim;

  const innerFrames = Math.max(1, Math.round((anim.dur || 0) * FPS / 1000));
  const total = Math.max(1, blocks.length ? sequenceFrames({ blocks }, innerFrames) : innerFrames);
  const A = anchorOf(scene, slot);
  const st = { prevT: -1, innerHold: scene.camHold, ours: false, fired: new Set(), touched: new Set(), shake: false, banner: false, fade: false, closeUp: false, glideFrom: new Map(), lastShot: null };
  const pawn = (k) => scene.pawns && scene.pawns[k];
  const record = rec ? { frames: [], innerFrames } : null;

  const W = {
    t: 0, dur: total * 1000 / FPS, moment: key, inner: anim, ev,
    step(u) {
      const T = u * total;
      // the game's own set piece, at its own time (its camera as it left it)
      if (st.ours) scene.camHold = st.innerHold;
      const B = Math.max(0, Math.min(innerFrames, builtinFrame(blocks, T)));
      anim.t = B * 1000 / FPS;
      if (anim.step) anim.step(Math.min(1, anim.t / Math.max(1, anim.dur)));
      st.innerHold = scene.camHold;
      if (editing) Object.assign(editing, { T, B, anchor: A, innerFrames, total }); // (the editor's playhead)
      if (record) { // (what the set piece asks for now; otherwise what the body chose last frame: a walk, idle)
        const p = pawn(slot), o = others.map(pawn).filter(Boolean)[0], c = (q) => (q && q.fx && q.fx.clip ? [q.fx.clip, q.fx.clipF ?? (q.wp ? q.wp.f : 0)] : q && q.wp ? [q.wp.clip, q.wp.f] : [null, 0]);
        record.frames.push([T, ...c(p), ...c(o)]);
      }
      // the bodies
      applyBody(scene, blocks, 'player', T, [pawn(slot)], A, st);
      applyBody(scene, blocks, 'others', T, others.map(pawn), A, st);
      // the camera
      const cb = activeBlock(blocks, 'camera', T, true);
      if (cb && cb.mode !== 'builtin') {
        if (cb.mode === 'game') { scene.camHold = null; }
        else if (cb.shot) {
          const p = pawn(slot), anchor = cb.follow && p ? { ...A, x: (p.fx && p.fx.x != null ? p.fx.x : p.x), y: (p.fx && p.fx.y != null ? p.fx.y : p.y), z: (p.fx && p.fx.z != null ? p.fx.z : p.z) } : A;
          const to = shotToWorld(anchor, cb.shot);
          let pose = to;
          if (cb.mode === 'glide' && cb.len > 0 && T < cb.at + cb.len) {
            if (!st.glideFrom.has(cb)) st.glideFrom.set(cb, st.lastShot || cameraPose(scene, to));
            const f = st.glideFrom.get(cb), k = ease((T - cb.at) / cb.len);
            pose = { x: f.x + (to.x - f.x) * k, y: f.y + (to.y - f.y) * k, z: f.z + (to.z - f.z) * k, tx: f.tx + (to.tx - f.tx) * k, ty: f.ty + (to.ty - f.ty) * k, tz: f.tz + (to.tz - f.tz) * k };
          } else if (st.lastBlock !== cb) scene.snapCamera = true; // a cut
          scene.camHold = pose; st.lastShot = pose;
        }
        st.ours = true; st.lastBlock = cb;
      } else if (st.ours) { st.ours = false; st.lastBlock = null; scene.snapCamera = true; } // back to the set piece's own
      // things that happen
      applyFx(scene, blocks, T, st, slot, A);
      st.prevT = T;
    },
    end() {
      if (st.ours) scene.camHold = st.innerHold;
      if (anim.end) anim.end();
      if (st.ours && scene.camHold === st.lastShot) { scene.camHold = null; scene.snapCamera = true; }
      for (const p of st.touched) if (p && p.fx && p.fx.__dir) { p.fx = null; } // (bodies the sequence moved, back to the game's)
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

/** Where the camera is now, as a shot (for a glide to start from). */
function cameraPose(scene, to) {
  const c = scene.camera;
  if (!c || !c.position) return to;
  const d = Math.hypot(to.tx - to.x, to.ty - to.y, to.tz - to.z) || 10;
  const dir = c.getWorldDirection ? c.getWorldDirection(new c.position.constructor()) : { x: 0, y: 0, z: -1 };
  return { x: c.position.x, y: c.position.y, z: c.position.z, tx: c.position.x + dir.x * d, ty: c.position.y + dir.y * d, tz: c.position.z + dir.z * d };
}

/** The animation (and facing) a block gives the bodies on a track at frame T. */
function applyBody(scene, blocks, track, T, pawns, A, st) {
  const b = activeBlock(blocks, track, T);
  if (!b || !b.clip) return;
  for (const p of pawns) {
    if (!p) continue;
    const base = p.fx || {}, x = base.x ?? p.x, y = base.y ?? p.y, z = base.z ?? p.z;
    const frames = clipFrames(scene, b.clip), local = (T - b.at) * (b.speed ?? 1) + (b.from || 0);
    const clipF = frames ? (b.loop === false ? Math.min(frames - 1, local) : local % frames) : local;
    let yaw = base.yaw ?? p.yaw;
    const cam = scene.camera && scene.camera.position;
    if (b.face === 'camera' && cam) yaw = Math.atan2(cam.x - x, cam.z - z);
    else if (b.face === 'forward') yaw = A.yaw;
    else if (b.face === 'back') yaw = A.yaw + Math.PI;
    else if (b.face === 'left') yaw = A.yaw + Math.PI / 2;
    else if (b.face === 'right') yaw = A.yaw - Math.PI / 2;
    else if (typeof b.face === 'number') yaw = A.yaw + b.face * Math.PI / 180;
    p.fx = { ...base, x, y, z, yaw, clip: b.clip, clipF, __dir: true };
    p.faceYaw = yaw;
    st.touched.add(p);
    if (scene.place) scene.place(p);
  }
}

/** How long a clip is (frames). */
export function clipFrames(scene, clip) { return clipLength(clip); }

function fadeEl(o) {
  const f = typeof document !== 'undefined' && document.querySelector && document.querySelector('#fade');
  if (f) { f.style.transition = 'none'; f.style.opacity = String(o); }
}

/** Where an effect goes: on the player, or one of a wall's hit spots ('dragon.hit1', 'gate.break'). */
function fxAt(scene, where, slot) {
  const p = scene.pawns && scene.pawns[slot];
  if (where && where.includes('.') && scene.fx && scene.fx.breakRig) {
    const [model, hook] = where.split('.');
    if (scene.fx.breakRig(model)) { const h = scene.fx.hookAt(model, hook); if (h) return h; }
  }
  if (!p) return null;
  const x = p.fx && p.fx.x != null ? p.fx.x : p.x, y = p.fx && p.fx.y != null ? p.fx.y : p.y, z = p.fx && p.fx.z != null ? p.fx.z : p.z, yaw = (p.fx && p.fx.yaw) ?? p.yaw ?? 0;
  return { x: x + Math.sin(yaw) * 0.7, y: y + 1.3, z: z + Math.cos(yaw) * 0.7 };
}

function applyFx(scene, blocks, T, st, slot, A) {
  let shake = false, closeUp = false, fade = null;
  for (const b of blocks) {
    if (b.track !== 'fx' || b.rec) continue;
    const on = T >= b.at && T < b.at + Math.max(1, b.len || 1), starts = st.prevT < b.at && T >= b.at;
    if (starts && !st.fired.has(b)) {
      st.fired.add(b);
      const at = fxAt(scene, b.where, slot), color = b.color && b.color !== 'player' ? b.color : (PLAYER_COLORS[slot] || PLAYER_COLORS[0]).hex;
      if (b.action === 'glint' && at && scene.fx && scene.fx.glint) scene.fx.glint(at, color, b.size || 1);
      if (b.action === 'chips' && at && scene.fx && scene.fx.burst) scene.fx.burst(at);
      if (b.action === 'banner' && scene.setBanner) { scene.setBanner(b.text || ''); st.banner = true; }
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
 * What the game did, as a sequence to start editing from: the set piece at its own pace, and the clips the player (and
 * the first of the others) played, as blocks marked 'rec' (shown, not played: edit one and it plays).
 */
export function recordedSequence(key, rec) {
  const blocks = [{ track: 'builtin', at: 0, len: rec.innerFrames, from: 0, speed: 1 }, { track: 'camera', at: 0, len: rec.innerFrames, mode: 'builtin' }];
  for (const [track, ci, fi] of [['player', 1, 2], ['others', 3, 4]]) {
    let cur = null;
    rec.frames.forEach((f, i) => {
      const T = i === 0 ? 0 : Math.round(f[0]), clip = f[ci]; // (the first frame drawn is the start)
      if (cur && cur.clip === clip) { cur.len = Math.max(1, T - cur.at); return; }
      if (cur) blocks.push(cur);
      cur = clip ? { track, at: T, len: 1, clip, from: Math.max(0, Math.round(f[fi])), speed: 1, face: 'auto', rec: true } : null;
    });
    if (cur) { cur.len = Math.max(cur.len, rec.innerFrames - cur.at); blocks.push(cur); } // (the last one lasts to the end)
  }
  return { key, blocks };
}
