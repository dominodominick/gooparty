// Replay: the real game's set pieces, played back as they were recorded (tools/extract_recordings.py, from the traces
// of the real Board Game Island: mii/clips/recordings.json, indexed in js15/game/recIndex.js).
//
// A recording is a moment as the real game played it, frame by frame: each Mii in it (where they are, how they are
// turned, the animation their body plays at which frame, their face), what everyone else on the board did where they
// stood, and the camera (where it is, where it looks, which way is up). The board's spaces are where the real game's are,
// so a recording made on the same spaces plays exactly where it was made. One made from other spaces is moved onto ours:
// turned and shifted so it starts where our Mii starts, and eased so it ends where they end (the camera with them).
//
// It wraps the game's own set piece (which still plays its models: the springs, statues, the dragon wall, the tornado,
// the UFO...) and takes over the Miis and the camera on top of it, for as long as the recording lasts.

import { REC_INDEX } from '../game/recIndex.js';
import { pickRecording } from '../game/recPick.js';
import { momentKey } from '../game/moments.js';
import { MII_BASE } from '../world/miiHead.js';
import { ISLAND } from '../game/boardData.js';

let DATA = null, loading = null;
/** Fetch the recordings (once). The game plays its own set pieces until they are in. */
export function loadRecordings() {
  if (DATA || loading) return loading || Promise.resolve(true);
  if (typeof fetch !== 'function') return Promise.resolve(false);
  loading = fetch(`${MII_BASE}clips/recordings.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.rec) DATA = j.rec; return !!DATA; }).catch(() => false);
  return loading;
}
/** For tests: use these recordings. */
export function setRecordings(rec) { DATA = rec; }
export const recordingsLoaded = () => !!DATA;

const D2R = Math.PI / 180;
const spaceName = (track, idx) => (track && idx != null ? `${track === 'volcano' ? 'V' : 'I'}${idx}` : null);

/** The recording key for a scene event (none: '') and which of its Miis plays which part. */
export function recKeyOf(ev) {
  if (!ev) return '';
  if (ev.t === 'ufo') return 'ufo';
  if (ev.t === 'move' && ev.mode === 'fly' && ev.dino) return `move.fly.${ev.dino}`;
  if (ev.t === 'move' && ev.mode === 'fast' && ev.spike) return 'move.fast.spike';
  if (ev.t === 'move' && ev.mode === 'drop') return 'move.drop'; // (which one: from where they are, in replay())
  const k = momentKey(ev);
  return REC_INDEX[k] ? k : '';
}

/** Value of a list of keys [t, ...values] at time t (linear between keys; null where the game does not place them). */
function keyAt(keys, t) {
  if (!keys || !keys.length) return null;
  let lo = 0, hi = keys.length - 1;
  if (t <= keys[0][0]) return keys[0][1] === null ? null : keys[0].slice(1);
  if (t >= keys[hi][0]) return keys[hi][1] === null ? null : keys[hi].slice(1);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m][0] <= t) lo = m; else hi = m; }
  const a = keys[lo], b = keys[hi];
  if (a[1] === null) return null;
  if (b[1] === null) return a.slice(1);
  const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * u);
}

/** The animation a recorded body plays at t: { clip, f } (the clip's frame), from its clip keys [t, clip, frame, speed]. */
export function clipAt(cl, t) {
  if (!cl || !cl.length) return null;
  let clip = null, k = null;
  for (const c of cl) {
    if (c[0] > t) break;
    if (c[1]) clip = c[1];
    k = c;
  }
  if (!k) { k = cl[0]; clip = k[1]; }
  return clip ? { clip, f: k[2] + Math.max(0, t - k[0]) * 60 * k[3] } : null;
}
const faceAt = (fs, t) => { let f = null; for (const x of fs || []) { if (x[0] > t) break; f = x[1]; } return f; };

/** The first and last places a recorded Mii stands (their recorded start and end). */
function ends(keys) {
  const v = (keys || []).filter((k) => k[1] !== null);
  if (!v.length) return null;
  return { a: { x: v[0][1], y: v[0][2], z: v[0][3], t: v[0][0] }, b: { x: v[v.length - 1][1], y: v[v.length - 1][2], z: v[v.length - 1][3], t: v[v.length - 1][0] } };
}
/** When a recorded Mii starts and stops moving about (for easing the end of a moved recording in). */
function moving(keys, E) {
  let t0 = null, t1 = null;
  for (const k of keys || []) {
    if (k[1] === null) continue;
    const da = Math.hypot(k[1] - E.a.x, k[3] - E.a.z), db = Math.hypot(k[1] - E.b.x, k[3] - E.b.z);
    if (t0 === null && da > 0.3) t0 = k[0];
    if (db > 0.3) t1 = k[0];
  }
  return { t0: t0 ?? 0, t1: t1 ?? (t0 ?? 0) };
}

/**
 * How a recording is moved onto our spaces: turned by `rot` about its start and shifted onto our start, plus `fix`
 * eased in while they move (so they end where our move ends).
 */
function placement(E, ourA, ourB, sameSpaces) {
  if (!E || !ourA) return null;
  const rdx = E.b.x - E.a.x, rdz = E.b.z - E.a.z, odx = ourB ? ourB.x - ourA.x : 0, odz = ourB ? ourB.z - ourA.z : 0;
  let rot = 0;
  // (turned onto our way only for a move along the board: never into or out of the volcano, far away)
  if (!sameSpaces && Math.hypot(rdx, rdz) > 1 && Math.hypot(odx, odz) > 1 && Math.hypot(rdx, rdz) < 60 && Math.hypot(odx, odz) < 60) rot = Math.atan2(odx, odz) - Math.atan2(rdx, rdz);
  const c = Math.cos(rot), s = Math.sin(rot);
  const turn = (x, z) => ({ x: E.a.x + (x - E.a.x) * c + (z - E.a.z) * s, z: E.a.z - (x - E.a.x) * s + (z - E.a.z) * c });
  const sh = { x: ourA.x - E.a.x, y: ourA.y - E.a.y, z: ourA.z - E.a.z };
  let fix = { x: 0, y: 0, z: 0 };
  if (ourB) { const tb = turn(E.b.x, E.b.z); fix = { x: ourB.x - (tb.x + sh.x), y: ourB.y - (E.b.y + sh.y), z: ourB.z - (tb.z + sh.z) }; }
  return { rot, c, s, turn, sh, fix };
}
function apply(P, x, y, z, w) {
  if (!P) return { x, y, z };
  const q = P.turn(x, z);
  return { x: q.x + P.sh.x + P.fix.x * w, y: y + P.sh.y + P.fix.y * w, z: q.z + P.sh.z + P.fix.z * w };
}

/**
 * The recording a moment plays, for our event: the same key, played from the same spaces if there is one (else the
 * nearest). Returns { rec, i } or null.
 */
function choose(key, from, to, otherFrom) {
  const i = pickRecording(key, from, to, otherFrom);
  if (i < 0 || !DATA || !DATA[key] || !DATA[key][i]) return null;
  return { rec: DATA[key][i], i };
}

/**
 * Wrap a set piece of the scene (an anim: { t, dur, step(u), end() }) in its recording. Unchanged when there is none
 * (or the recordings are not in yet).
 */
export function replay(scene, anim, ev) {
  if (!anim || !ev || !DATA || scene.noReplay) return anim;
  let key = recKeyOf(ev);
  if (!key) return anim;
  const pawns = scene.pawns || {};
  const actorSlot = ev.slot, actor = pawns[actorSlot];
  if (!actor) return anim;
  if (key === 'move.drop') { // into the volcano (from the volcano-or-not star, or a skull), or back out of it
    const dest = ev.path && ev.path[ev.path.length - 1], here = actor.track === 'island' ? ISLAND[actor.idx] : null;
    key = dest && dest.track === 'volcano' ? (here && here.type === 'skull' ? 'move.drop.skull' : here && here.type === 'volcanoOrNot' ? 'move.drop.von' : '') : dest ? 'move.drop.exit' : '';
    if (!key || !REC_INDEX[key]) return anim;
  }
  // who plays which recorded part, and where our move starts and ends
  let otherSlot = null;
  if (key === 'ufo') otherSlot = ev.with;
  const node = (p) => spaceName(p.track, p.idx);
  let from = key === 'move.swim' ? scene.cratePick || null : node(actor), to = null, ourA = { x: actor.x, y: actor.y, z: actor.z }, ourB = null;
  if (ev.t === 'move' && ev.path && ev.path.length) {
    const last = ev.stopShort && ev.to ? ev.to : ev.path[ev.path.length - 1];
    to = spaceName(last.track, last.idx); ourB = scene.nodeXYZ(last.track, last.idx, actorSlot, true);
  }
  // the UFO: one recording for its four events; each event plays its own stretch of it (the phases)
  let window = null, roleSlots = { actor: actorSlot };
  let pick;
  if (key === 'ufo') {
    const lander = ev.phase === 'up' && !scene.ufoRec ? actorSlot : scene.ufoRec ? scene.ufoRec.lander : actorSlot;
    const other = lander === actorSlot ? ev.with : actorSlot;
    if (!scene.ufoRec || scene.ufoRec.done) {
      // (only from its first event: the lander beamed up, the other's next)
      const nx = scene.queue && scene.queue[0];
      if (ev.phase !== 'up' || (!ev.ufoFirst && (!nx || nx.t !== 'ufo' || nx.phase !== 'up' || nx.slot !== ev.with))) return anim;
      const lp = pawns[lander], op = pawns[other];
      if (!lp || !op) return anim;
      pick = choose(key, node(lp), node(op), node(op));
      if (!pick) return anim;
      scene.ufoRec = { pick, lander, other, n: 0, A: { x: lp.x, y: lp.y, z: lp.z }, B: { x: op.x, y: op.y, z: op.z }, done: false };
    }
    const U = scene.ufoRec; pick = U.pick;
    const ph = pick.rec.phases || [0, 0, 0, 0, pick.rec.len], n = U.n++;
    window = [ph[n] || 0, ph[n + 1] ?? pick.rec.len];
    if (n >= 3) U.done = true;
    roleSlots = { actor: U.lander, other: U.other };
    ourA = U.A; from = null;
  } else pick = choose(key, from, to, null);
  if (!pick) return anim;
  const R = pick.rec, t0 = window ? window[0] : 0, len = window ? Math.max(0, window[1] - window[0]) : R.len;
  // each recorded Mii: their part, our pawn, and how their recording is placed on our spaces
  const parts = [];
  for (const w of R.who) {
    const slot = roleSlots[w.role];
    const p = slot != null ? pawns[slot] : null;
    if (!p) continue;
    const E = ends(w.k);
    let A, B = null, same;
    if (key === 'ufo') { // the lander: from their spot to the other's; the other: the other way round
      const U = scene.ufoRec; A = w.role === 'actor' ? U.A : U.B; B = w.role === 'actor' ? U.B : U.A;
      same = w.role === 'actor' ? w.from === node(pawns[U.lander]) && (R.who[1] || {}).from === node(pawns[U.other]) : (R.who[0].from === node(pawns[U.lander]) && w.from === node(pawns[U.other]));
    } else if (slot === actorSlot) { A = ourA; B = ourB; same = w.from === from && (to == null || !w.to || w.to === to); }
    else { A = { x: p.x, y: p.y, z: p.z }; same = w.from === node(p); }
    const P = placement(E, A, B, same);
    parts.push({ w, p, slot, E, P, mv: E ? moving(w.k, E) : null });
  }
  // the camera follows the recorded Mii it is placed with (the actor's placement)
  const camP = parts.length ? parts[0].P : null, camMv = parts.length ? parts[0].mv : null;
  // everyone else: the recorded onlookers, matched to our pawns standing nearest where they stood
  const used = new Set(parts.map((q) => q.slot)), look = [];
  for (const L of R.look || []) {
    let best = null;
    for (const [k, p] of Object.entries(pawns)) {
      const s = Number(k); if (!p || used.has(s)) continue;
      const d = Math.hypot(p.x - L.at[0], p.z - L.at[2]);
      if (d < 8 && (!best || d < best.d)) best = { d, p, s };
    }
    if (best) { used.add(best.s); look.push({ L, p: best.p }); }
  }
  const camW = (t) => (camMv ? (camMv.t1 <= camMv.t0 ? (t >= camMv.t1 ? 1 : 0) : Math.max(0, Math.min(1, (t - camMv.t0) / (camMv.t1 - camMv.t0)))) : 0);
  const innerDur = Math.max(1, anim.dur || 1);
  const st = { hold: scene.camHold, ended: false };
  const W = {
    t: 0, dur: Math.max(1, len * 1000), moment: anim.moment, inner: anim, replayed: { key, src: R.src },
    fast: true,
    step(u) {
      const tl = u * len, t = t0 + tl;
      // the game's own set piece (its models), on its own clock
      anim.t = Math.min(innerDur, tl * 1000);
      if (anim.step) anim.step(Math.min(1, anim.t / innerDur));
      if (key.startsWith('move.drop') && scene.hideFade) scene.hideFade(); // (the real game does not fade to black: it shows it)
      // the Miis, as recorded
      for (const q of parts) {
        const k = keyAt(q.w.k, t), c = clipAt(q.w.c, t), f = faceAt(q.w.f, t);
        if (!k) { // carried (by the pterodactyl, inside the UFO...): out of sight in the UFO; hanging from what carries them
          if (key === 'ufo') { q.p.group.visible = false; q.p.scale = 0; continue; }
          const carrier = R.models && (R.models.mr001_02 || R.models.mr001_01);
          const m = carrier && keyAt(carrier.k, t);
          if (!m) continue;
          if (!q.hang) { // (where they were under it when it took them: they stay there)
            let last = null; for (const x of q.w.k) { if (x[0] > t) break; if (x[1] !== null) last = x; }
            const m0 = last && keyAt(carrier.k, last[0]);
            q.hang = last && m0 ? { x: last[1] - m0[0], y: last[2] - m0[1], z: last[3] - m0[2], ry: last[5] } : { x: 0, y: -2, z: 0, ry: m[4] };
          }
          const at = apply(q.P, m[0] + q.hang.x, m[1] + q.hang.y, m[2] + q.hang.z, camW(t)), ry = q.hang.ry * D2R + (q.P ? q.P.rot : 0);
          q.p.x = at.x; q.p.y = at.y; q.p.z = at.z; q.p.scale = 1; q.p.group.visible = true;
          q.p.fx = { x: at.x, y: at.y, z: at.z, yaw: ry, raw: true, clip: c ? c.clip : 'pm001_17', clipF: c ? c.f : null, face: f == null ? 0 : f, groundY: null };
          q.p.faceYaw = ry; q.p.yaw = ry;
          if (scene.place) scene.place(q.p);
          continue;
        }
        q.hang = null;
        const mv = q.mv, wgt = !mv || mv.t1 <= mv.t0 ? (t >= (mv ? mv.t1 : 0) ? 1 : 0) : Math.max(0, Math.min(1, (t - mv.t0) / (mv.t1 - mv.t0)));
        const at = apply(q.P, k[0], k[1], k[2], wgt);
        const ry = k[4] * D2R + (q.P ? q.P.rot : 0), rx = k[3] * D2R, rz = k[5] * D2R;
        q.p.x = at.x; q.p.y = at.y; q.p.z = at.z; q.p.scale = 1; q.p.group.visible = true;
        q.p.fx = { x: at.x, y: at.y, z: at.z, yaw: ry, raw: true, clip: c ? c.clip : 'pm011_08', clipF: c ? c.f : null, face: f == null ? 0 : f, groundY: null };
        if ((Math.abs(rx) > 1e-3 || Math.abs(rz) > 1e-3) && scene.T && scene.T.Quaternion) q.p.fx.quat = new scene.T.Quaternion().setFromEuler(new scene.T.Euler(rx, ry, rz, 'ZYX')); // (the real game's rotation: z, then y, then x)
        q.p.faceYaw = ry; q.p.yaw = ry;
        if (scene.place) scene.place(q.p);
      }
      for (const o of look) {
        const c = clipAt(o.L.c.map((x) => [x[0], x[1], 0, 1]), t);
        o.p.recClip = c && c.clip !== 'pm011_08' && c.clip !== 'pm000_16' && c.clip !== 'pm000_17' && c.clip !== 'pm000_03' && c.clip !== 'pm000_04' ? c : null;
        o.p.recFace = faceAt(o.L.f, t);
      }
      // the models in it (the UFO and its beam, the tornado...), as recorded: the scene puts its own copy there
      if (R.models && scene.recModel) {
        for (const [name, m] of Object.entries(R.models)) {
          const k = keyAt(m.k, t); if (!k) continue;
          const at = apply(camP, k[0], k[1], k[2], camW(t)), c = clipAt(m.c, t);
          scene.recModel(name, { x: at.x, y: at.y, z: at.z, ry: k[4] * D2R + (camP ? camP.rot : 0) }, c);
        }
      }
      // the camera, as recorded (moved with the actor's recording)
      const cam = keyAt(R.cam, t);
      if (cam) {
        const w = camW(t);
        const e = apply(camP, cam[0], cam[1], cam[2], w), g = apply(camP, cam[3], cam[4], cam[5], w);
        let up = [cam[6], cam[7], cam[8]];
        if (camP && camP.rot) { const c2 = camP.c, s2 = camP.s; up = [up[0] * c2 + up[2] * s2, up[1], -up[0] * s2 + up[2] * c2]; }
        scene.camHold = { x: e.x, y: e.y, z: e.z, tx: g.x, ty: g.y, tz: g.z, up };
        scene.snapCamera = true;
      }
    },
    end() {
      if (st.ended) return; st.ended = true;
      if (anim.step && anim.t < innerDur) anim.step(1);
      for (const q of parts) { q.p.fx = null; q.p.scale = 1; }
      for (const o of look) { o.p.recClip = null; o.p.recFace = null; }
      if (anim.end) anim.end();
      if (R.models && scene.recModel) for (const name of Object.keys(R.models)) scene.recModel(name, null);
      scene.camHold = st.hold && st.hold !== scene.camHold ? st.hold : null; scene.snapCamera = true;
      if (key === 'ufo' && scene.ufoRec && scene.ufoRec.done) scene.ufoRec = null;
    },
  };
  if (anim.cleanup) W.cleanup = anim.cleanup;
  return W;
}

