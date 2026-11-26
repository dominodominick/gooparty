// Island viewer: the board exactly as the game draws it (same scene, same props, same tiles), with no game running.
// Drag to turn, scroll to zoom, right-drag (or shift-drag) to slide. Buttons jump to each place and play the set pieces.
import { app } from '../app.js';
import { BoardScene } from './boardScene.js';
import { ISLAND } from '../game/boardData.js';
import { DUR, walkForward, walkBack } from '../game/boardGame.js';
import { stopOfSpace, VOLCANO_OFFSET, terrainHeight } from '../game/boardLayout.js';
import { makeFigure, fitFFLHead } from '../world/miiPawn.js';
import { shadeLikeFace } from '../world/wpMii.js';
import { WP_MII } from '../world/wpMiiData.js';
import { ALL_CLIPS } from '../world/wpMiiAllClips.js';
import { LOADERS, SHARED } from '../world/wpClipLoaders.js';

/**
 * The gallery's dropdown: every board, mode and minigame of Wii Party with the clips its program module loads, the list
 * every module shares, and the clips no module names. { value, label, group, clips } ('all': every clip).
 */
export function galleryFilters(allNames = []) {
  const named = new Set(SHARED); for (const L of LOADERS) for (const c of L.clips) named.add(c);
  const out = [{ value: 'all', label: `All animations${allNames.length ? ` (${allNames.length})` : ''}`, group: null, clips: null }];
  const groups = [['board', 'Boards and modes'], ['minigame', 'Minigames'], ['other', 'Menus and screens']];
  for (const [g, title] of groups) {
    const ls = LOADERS.filter((L) => L.group === g).sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
    for (const L of ls) out.push({ value: L.id, label: `${L.name} (${L.id}) · ${L.clips.length || 'none named'}`, group: title, clips: L.clips });
  }
  out.push({ value: 'shared', label: `In every module's shared code (${SHARED.length})`, group: 'Other lists', clips: SHARED });
  const never = allNames.filter((n) => !named.has(n));
  out.push({ value: 'unnamed', label: `Not named by any module${allNames.length ? ` (${never.length})` : ''}`, group: 'Other lists', clips: never, unnamed: true });
  return out;
}
/** Which boards, modes and minigames load a clip: their names. */
export function clipLoadedBy(name) {
  return LOADERS.filter((L) => L.clips.includes(name)).map((L) => L.name);
}

// The rest of Wii Party's Mii clips (other boards' and the minigames': pm002 and up), loaded when the gallery opens:
// mii/clips/more-clips.json, made by tools/extract_wp_mii.py --more (too big to go in the page).
let moreClips = null;
export function loadMoreClips() {
  if (!moreClips) moreClips = typeof fetch !== 'function' ? Promise.resolve(null)
    : fetch(`${MII_BASE}clips/more-clips.json`).then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.clips) || null).catch(() => null);
  return moreClips;
}
/** The gallery's order: Board Game Island's own clips (pm001) first, then the shared ones (pm000), then the rest. */
export function galleryOrder(names) {
  const g = (n) => (n.startsWith('pm001') ? 0 : n.startsWith('pm000') ? 1 : 2);
  return [...names].sort((a, b) => g(a) - g(b) || (a < b ? -1 : a > b ? 1 : 0));
}
import { makeShadowCaster } from '../world/miiShadow.js';
import { parseMii } from '../world/miic.js';
import { PAWN_SCALE } from '../world/miis.js';
import { loadMiiRenderer, MII_BASE } from '../world/miiHead.js';

/** Which of the game's moments plays each clip (from WP_MII.source: the game's name -> Wii Party's clip). */
export function clipUses(source = WP_MII.source || {}) {
  const used = {};
  for (const [k, v] of Object.entries(source)) (used[v] ||= []).push(k);
  return used;
}

const stopOf = (type) => ISLAND.findIndex((n) => n.type === type);

export class ViewerScene extends BoardScene {
  enter() {
    super.enter();
    if (this.broken) return;
    this.viewer = true;
    for (const p of Object.values(this.pawns)) p.group.visible = false;
    this.orbit = { tx: 0, ty: 20, tz: 0, yaw: 0.35, pitch: 0.62, dist: 230 };
    this.demo = [];
    this.buildViewerUi();
    this.bindOrbit();
    // a link can open straight at a place: #spike-statue, #rope-bridge ...
    const want = (typeof window !== 'undefined' && window.__VIEW_AT) || ((typeof location !== 'undefined' && location.hash) || '').slice(1), slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const hit = want && this.places().find(([label]) => slug(label) === want);
    if (hit) this.lookAt(hit[1]);
    // ... or open the animation gallery: #animation-gallery, #animation-gallery-pm001_10
    if (want && want.startsWith('animation-gallery')) this.wantGallery = want.slice('animation-gallery-'.length) || true; // (opened once the board is in)
    // ... or play one of the set pieces over and over: #play-tornado-back-5, #play-red-statue-throw ...
    this.loopDemo = want && want.startsWith('play-') ? want.slice(5) : null; this.loopWait = 4;
  }

  exit() {
    if (this.gallery) this.closeGallery(true);
    for (const [t, f] of this.orbitHandlers || []) removeEventListener(t, f, true);
    super.exit();
  }

  // ---------------------------------------------------------------- what to look at
  places() {
    const P = this.pos.island, S = (id) => P[stopOfSpace(id)], V = this.pos.volcano;
    const at = (p, dist = 30, pitch = 0.5, yaw = null) => ({ p, dist, pitch, yaw });
    return [
      ['Whole island', { p: { x: 0, y: 20, z: 0 }, dist: 230, pitch: 0.62 }],
      ['Start', at(P[0], 26, 0.45)],
      ['Vine', at(P[stopOf('vine')], 34, 0.42)],
      ['Rope bridge', at(S(15), 30, 0.5)],
      ['Dragon wall', at(P[stopOf('dragon')], 26, 0.4)],
      ['Blue statues', at(S(27), 30, 0.55)],
      ['Volcano space', at(S(33), 24, 0.6)],
      ['Crates & barrels', at(P[stopOf('crates')], 30, 0.62)],
      ['Red statue', at(S(42), 28, 0.55)],
      ['Volcano or not', at(P[stopOf('volcanoOrNot')], 24, 0.5)],
      ['UFO space', at(P[stopOf('ufo')], 26, 0.5)],
      ['Spike ball', at(P[stopOf('spike')], 30, 0.42)],
      ['Spike statue', { p: { x: -1400 * 0.016, y: 2300 * 0.016, z: 0 }, dist: 13, pitch: 0.22, yaw: Math.atan2(-561, 392), exact: true }], // straight at its open mouth, from the path
      ['Summit gate', at(P[stopOf('final')], 34, 0.45)],
      ['Inside the volcano', { p: { x: V[4].x, y: V[4].y, z: V[4].z }, dist: 60, pitch: 0.7 }],
    ];
  }

  lookAt(v) {
    const o = this.orbit;
    o.tx = v.p.x; o.ty = v.p.y + 1.5; o.tz = v.p.z; o.dist = v.dist; o.pitch = v.pitch;
    if (v.yaw != null) o.yaw = v.yaw;
    else { // look at it from the side the path comes from, a little off to one side
      const i = this.pos.island.findIndex((q) => q === v.p);
      const d = i >= 0 ? this.pos.island[i].dir : null;
      if (d) o.yaw = Math.atan2(-d.x, -d.z) + 0.5;
    }
    if (o.tx > VOLCANO_OFFSET.x / 2 || v.exact) return;
    // turn round (and if need be tilt up) until nothing of the island is between the camera and the spot
    const blocked = (yaw, pitch) => {
      const cp = Math.cos(pitch), cx = o.tx + Math.sin(yaw) * cp * o.dist, cy = o.ty + Math.sin(pitch) * o.dist, cz = o.tz + Math.cos(yaw) * cp * o.dist;
      let worst = -Infinity;
      for (let k = 1; k <= 12; k++) { const f = k / 12; worst = Math.max(worst, terrainHeight(o.tx + (cx - o.tx) * f, o.tz + (cz - o.tz) * f) + 0.5 - (o.ty + (cy - o.ty) * f)); }
      return worst;
    };
    let best = null;
    for (const dp of [0, 0.15, 0.3, 0.45, 0.6]) for (let k = 0; k < 24; k++) {
      const yaw = o.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12), pitch = Math.min(1.45, o.pitch + dp), b = blocked(yaw, pitch);
      if (!best || b < best.b) best = { yaw, pitch, b };
      if (b <= 0) { o.yaw = yaw; o.pitch = pitch; return; }
    }
    o.yaw = best.yaw; o.pitch = best.pitch;
  }

  // ---------------------------------------------------------------- the set pieces
  demos() {
    const at = (idx) => { const p = this.pawns[0], q = this.pos.island[idx]; this.fx.unhide(p); this.fx.unbreak(); for (const o of Object.values(this.pawns)) o.rollClip = null; this.camSlot = 0; for (const o of Object.values(this.pawns)) if (o !== p) o.group.visible = false; Object.assign(p, { track: 'island', idx, x: q.x, y: q.y + 0.05, z: q.z, scale: 1, fx: null }); p.group.visible = true; this.place(p); if (!(this.slow < 1)) { this.lookAt({ p: q, dist: 32, pitch: 0.45 }); this.follow = true; } return p; }; // (in slow motion the camera stays where you put it)
    const walk = (from, n, mode = 'fast', extra = {}) => { const path = []; const step = n > 0 ? 1 : -1; for (let i = 1; i <= Math.abs(n); i++) path.push({ track: 'island', idx: from + i * step }); return { t: 'move', slot: 0, mode, path, dur: Math.abs(n) * (mode === 'fast' ? 190 : 340) + 350 + DUR.cross, ...extra }; };
    const move = (ev) => () => this.wrapMove(ev, this.beginMove(ev));
    const throwBy = (s, color) => { const n = ISLAND[s].arg, w = (color === 'blue' ? walkForward : walkBack)({ track: 'island', idx: s }, n);
      return { t: 'move', slot: 0, mode: 'fly', statue: color, path: w.path, count: { total: n, dir: color === 'blue' ? 'fwd' : 'back' }, dur: DUR.statueThrow }; };
    const spring = (slot, from, n, color) => { const path = []; const st = n > 0 ? 1 : -1; for (let i = 1; i <= Math.abs(n); i++) path.push({ track: 'island', idx: from + i * st }); return { t: 'move', slot, mode: 'spring', spring: color, path, count: { total: Math.abs(n), dir: n > 0 ? 'fwd' : 'back' }, dur: DUR.spring }; };
    const look = (...slots) => () => { for (const s of slots) if (this.pawns[s]) this.pawns[s].wonder = true; return { t: 0, dur: DUR.wonder }; }; // ("what is about to happen?" while the banner shows, as in a game)
    const rolling = (slot, ms = 1800) => () => { this.fx.begin(slot); return { t: 0, dur: ms, end: () => { if (this.pawns[slot]) this.pawns[slot].rollClip = null; } }; }; // (eager, or puzzled at the spike ball)
    const done = () => () => { this.fx.release(); this.camHold = null; return { t: 0, dur: 0 }; };
    const put = (slot, idx) => { const p = this.pawns[slot], q = this.pos.island[idx]; Object.assign(p, { track: 'island', idx, x: q.x, y: q.y + 0.05, z: q.z, scale: 1, fx: null }); p.group.visible = true; this.place(p); return p; };
    return [
      ['Vine swing (4, then walk 2)', () => { const v = stopOf('vine'); at(v); this.fx.begin(0); this.demo.push(() => ({ t: 0, dur: 1200 }), move({ ...walk(v, 6, 'walk', { swing: 4 }), dur: 6 * 340 + 350 + DUR.cross + DUR.swing + DUR.vinePause })); }], // rolled 4 on the vine, 2 spaces left to walk
      ['Dragon fireball', () => { const s = stopOf('dragon'), p = at(s); this.demo.push(rolling(0), look(0), () => this.fx.playNote({ fx: 'fireball', dur: DUR.fire }, p), move({ t: 'move', slot: 0, mode: 'knock', path: [{ track: 'island', idx: s - 1 }], count: { total: 1, dir: 'back' }, dur: DUR.knock }), done()); }],
      ['Smash dragon wall', () => { const s = stopOf('dragon'), p = at(s); this.demo.push(rolling(0), () => this.fx.brokenAnim({ challenge: 'dragon', slot: 0, dur: DUR.wall }, p), move(walk(s, 3, 'walk')), done()); }], // rolled 4 or more: punches, cheer, walks on
      ['Blue statue throw', () => { const s = stopOf('statueBlue'); at(s); this.demo.push(move(throwBy(s, 'blue'))); }],
      ['Red statue throw', () => { const s = stopOf('statueRed'); at(s); this.demo.push(move(throwBy(s, 'red'))); }],
      ['Tornado (back 5)', () => { const s = stopOf('tornado') + 3; at(s); const w = walkBack({ track: 'island', idx: s }, 5); this.demo.push(look(0), move({ t: 'move', slot: 0, mode: 'fly', tornado: true, follow: true, path: w.path, count: { total: 5, dir: 'back' }, dur: DUR.tornado })); }], // a player a little past the tornado space is blown back 5
      ['Crates: wrong pick', () => { const s = stopOf('crates'), p = at(s); this.fx.begin(0); // a crate breaks, they swim to the far bank and stand there
        this.demo.push(() => { this.fx.playNote({ fx: 'crates', picked: Math.floor(Math.random() * 2), safe: false, hit: Math.floor(Math.random() * 3) }, p); return { t: 0, dur: 700 }; },
          move({ t: 'move', slot: 0, mode: 'fast', path: [{ track: 'island', idx: s + 1 }], swim: true, stopShort: true, to: { track: 'island', idx: s, across: true }, dur: DUR.swim })); }],
      ['Volcano push', () => { const s = stopOf('volcanoOrNot'); at(s); this.demo.push(move({ t: 'move', slot: 0, mode: 'drop', path: [{ track: 'volcano', idx: 0 }], dur: DUR.drop })); }],
      ['Spike ball chase', () => { // as in a game: the jaws open, the ball chases everyone on the stretch back, then the number goes down
        const s = stopOf('spike'), p = at(s), last = stopOf('volcanoOrNot') + 1, two = this.secondPlayer, from2 = s - 5;
        if (two) { const o = put(1, from2); this.fx.unhide(o); }
        const bank = { track: 'island', idx: last - 1, across: true }; // (they end on the spot past the volcano pit, short of the space)
        const main = { ...walk(s, -(s - last), 'fast'), count: { total: s - last, dir: 'back' }, stopShort: true, to: bank }, side = [];
        if (two) { const path = []; for (let i = from2 - 1; i >= last; i--) path.push({ track: 'island', idx: i }); side.push({ t: 'move', slot: 1, mode: 'fast', path, dur: path.length * 190 + 350 + DUR.cross, with: true, stopShort: true, to: bank }); }
        if ((this.fx.spikeNumber ?? 5) <= 2) this.fx.showSpikeNumber(5); // (the viewer starts again from 5 once it has reached 2)
        const n = this.fx.spikeNumber ?? 5, next = Math.max(2, n - 1);
        const shock = { t: 'spikeShock', slot: 0, slots: two ? [0, 1] : [0], dur: DUR.shock };
        this.demo.push(rolling(0), () => { this.fx.expectShock = true; return this.fx.playNote({ fx: 'pit', dur: DUR.pit }, p); }, () => this.fx.shockAnim(shock), () => { const a = this.wrapMove(main, this.beginMove(main)); return side.length ? this.together(main, a, side) : a; });
        if (next !== n) this.demo.push(() => this.fx.playNote({ fx: 'spikeCount', from: n, to: next, dur: DUR.spikeCount }, p));
      }],
      ['Spike statue passed', () => { const s = stopOf('spike'), p = at(s); this.demo.push(rolling(0), move(walk(s, 3, 'walk')), () => ({ t: 0, dur: 900 }), () => this.fx.brokenAnim({ challenge: 'spike', slot: 0, later: true, dur: DUR.spikeBreak }, p), done()); }], // rolled high enough: on at once; the statue breaks once the turn is over
      ['Summit: gate kicked open (win)', () => { const s = stopOf('final'), p = at(s); this.demo.push(rolling(0), () => this.fx.brokenAnim({ challenge: 'final', slot: 0, dur: DUR.gate }, p), move(walk(s, 1, 'walk')), () => { p.cheer = 'win'; return { t: 0, dur: 2200, end: () => { p.cheer = null; } }; }, done()); }],
      ['Summit: missed', () => { const s = stopOf('final'), p = at(s); this.demo.push(rolling(0), () => this.fx.playNote({ fx: 'finalFail', dur: DUR.finalFail }, p), done()); }],
      ['Blue spring (+5)', () => { const s = stopOf('plus5'); at(s); this.demo.push(look(0), move(spring(0, s, 5, 'blue'))); }],
      ['Red spring (-4)', () => { const s = stopOf('minus4'); at(s); this.demo.push(move(spring(0, s, -4, 'red'))); }],
      ['1v1 won: green springs', () => { const s = stopOf('mg11'); at(s); const o = put(1, s + 2); this.demo.push(move(spring(0, s, 7, 'green')), () => { this.camSlot = 1; return move(spring(1, s + 2, -7, 'green'))(); }); void o; }],
      ['1 vs Rest won: green spring', () => { const s = stopOf('mgRest'); at(s); this.demo.push(move(spring(0, s, 10, 'green'))); }],
      ['UFO swap', () => { const s = stopOf('ufo'), o = s + 6; at(s); put(1, o);
        const ufo = (ev) => () => this.beginUfo({ t: 'ufo', dur: DUR.ufo, ...ev });
        this.demo.push(look(0, 1), ufo({ phase: 'up', slot: 0 }), ufo({ phase: 'up', slot: 1 }), ufo({ phase: 'down', slot: 1, to: { track: 'island', idx: s } }), ufo({ phase: 'down', slot: 0, to: { track: 'island', idx: o } })); }],
      ['Volcano erupts', () => { // the cutscene: the stretch past the volcano-or-not pit and two others (picked at random, as the host does)
        const others = [1, 2, 3, 4, 5].sort(() => Math.random() - 0.5); this.setEruption(0);
        this.demo.push(() => this.eruptionCutscene({ t: 'eruption', active: 1, dur: DUR.eruption, stretches: [0, others[0], others[1]] }), () => ({ t: 0, dur: 1500, end: () => this.setEruption(0) })); }],
      ['Meteor knockback (chain)', () => { // landing on lava during an eruption: hit by a meteor, back 4 onto more lava, hit again, back 4 onto a blank
        const s = 34; at(s); this.setEruption(1);
        const hit = (from) => { const w = walkBack({ track: 'island', idx: from }, 4); return move({ t: 'move', slot: 0, mode: 'fly', meteor: true, path: w.path, count: { total: 4, dir: 'back' }, dur: DUR.meteorHit }); };
        const w1 = walkBack({ track: 'island', idx: s }, 4), mid = w1.path[w1.path.length - 1].idx;
        this.demo.push(hit(s), () => ({ t: 0, dur: 500 }), hit(mid), () => ({ t: 0, dur: 1200, end: () => this.setEruption(0) })); }],
      ['Open summit', () => { this.openSummit(); }],
    ];
  }

  // never follow the host: nothing is running
  onTurn() {}
  syncIdle() { this.idle = true; }

  tickAnim(dt) {
    if (this.wantGallery && this.board && this.pawns && this.pawns[0]) { const c = this.wantGallery; this.wantGallery = null; this.openGallery(c === true ? null : c); }
    if (this.gallery) { this.stepGallery(dt); return; }
    if (this.loopDemo && !this.anim && !this.demo.length && this.board && this.pawns && this.pawns[0] && (this.loopWait -= dt) <= 0) {
      const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), all = this.demos();
      const d = this.loopDemo === 'all' ? all[(this.loopIdx = ((this.loopIdx ?? -1) + 1) % all.length)] : all.find(([n]) => slug(n) === this.loopDemo); // ('all': each in turn)
      if (d) { d[1](); if (typeof document !== 'undefined' && document.body) { this.loopTag ||= Object.assign(document.createElement('div'), { style: 'position:fixed;left:8px;top:8px;z-index:99;background:#000a;color:#fff;font:bold 16px sans-serif;padding:4px 8px;border-radius:6px' }); this.loopTag.textContent = d[0]; if (!this.loopTag.parentNode) document.body.appendChild(this.loopTag); } }
      else this.loopDemo = null;
      this.loopWait = 2;
    }
    if (!this.anim && this.demo.length) { this.anim = this.demo.shift()() || { t: 0, dur: 1 }; this.idle = false; }
    if (!this.anim) return;
    const a = this.anim; a.t += dt * 1000 * (this.slow || 1); // (slow motion: the viewer's own toggle)
    const u = Math.min(1, a.t / Math.max(1, a.dur));
    if (a.step) a.step(u);
    if (u >= 1) { if (a.end) a.end(); this.anim = null; }
  }

  // ---------------------------------------------------------------- camera
  updateCamera(dt = 1 / 60) {
    if (this.camHold && this.anim) { // a set piece with its own cameras (the statue throws): use them
      const h = this.camHold; this.camera.position.set(h.x, h.y, h.z); this.camera.lookAt(h.tx, h.ty, h.tz);
      const o = this.orbit; o.tx = h.tx; o.ty = h.ty; o.tz = h.tz; this.snapCamera = false; this.rolling = false;
      this.setAmbience(h.x > VOLCANO_OFFSET.x / 2 ? 'volcano' : 'island');
      return;
    }
    const o = this.orbit, p = this.pawns[this.camSlot ?? 0] || this.pawns[0];
    if (this.follow && p && p.group.visible && (this.anim || this.demo.length)) { // keep the player of a set piece in view
      const fx = p.fx && p.fx.x != null ? p.fx : p, k = 1 - Math.exp(-dt * 3);
      if (Math.abs(fx.x - o.tx) > 200 || this.snapCamera) { o.tx = fx.x; o.ty = fx.y + 1.5; o.tz = fx.z; this.snapCamera = false; } // a jump into the volcano, or a cut: cut
      else { o.tx += (fx.x - o.tx) * k; o.ty += (fx.y + 1.5 - o.ty) * k; o.tz += (fx.z - o.tz) * k; }
    }
    if (!this.gallery) this.setAmbience(o.tx > VOLCANO_OFFSET.x / 2 ? 'volcano' : 'island');
    const cp = Math.cos(o.pitch), dist = o.dist * ((typeof window !== 'undefined' && window.__VIEW_ZOOM) || 1); // (__VIEW_ZOOM: a page can bring the camera in, for checking the Miis by eye)
    this.camera.position.set(o.tx + Math.sin(o.yaw) * cp * dist, o.ty + Math.sin(o.pitch) * dist, o.tz + Math.cos(o.yaw) * cp * dist);
    this.camera.lookAt(o.tx, o.ty, o.tz);
    this.rolling = false;
  }

  bindOrbit() {
    let drag = null;
    const onUi = (e) => e.target.closest && e.target.closest('.viewer-panel');
    const down = (e) => { if (onUi(e)) return; drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, o = this.orbit; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) { const k = o.dist * 0.0016, cx = Math.cos(o.yaw), sx = Math.sin(o.yaw); o.tx += (-dx * cx - dy * sx) * k; o.tz += (dx * sx - dy * cx) * k; }
      else { o.yaw -= dx * 0.006; o.pitch = Math.max(0.05, Math.min(1.5, o.pitch + dy * 0.005)); }
    };
    const up = () => { drag = null; };
    const wheel = (e) => { if (onUi(e)) return; e.preventDefault(); this.orbit.dist = Math.max(4, Math.min(600, this.orbit.dist * Math.exp(e.deltaY * 0.0012))); };
    this.orbitHandlers = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['wheel', wheel]];
    for (const [t, f] of this.orbitHandlers) addEventListener(t, f, t === 'wheel' ? { capture: true, passive: false } : true);
  }

  buildViewerUi() {
    const panel = document.createElement('div');
    panel.className = 'viewer-panel';
    panel.style.cssText = 'position:absolute;right:12px;top:12px;bottom:12px;width:200px;overflow:auto;background:rgba(16,32,48,.86);color:#fff;border-radius:14px;padding:10px;font:13px sans-serif;pointer-events:auto;display:flex;flex-direction:column;gap:5px';
    const btn = (label, fn, bg = '#2a5a86') => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `background:${bg};color:#fff;border:0;border-radius:8px;padding:6px 8px;text-align:left;font:13px sans-serif;cursor:pointer`; b.onclick = fn; panel.appendChild(b); return b; };
    const head = (t) => { const h = document.createElement('div'); h.textContent = t; h.style.cssText = 'font-weight:bold;margin-top:6px;opacity:.8'; panel.appendChild(h); };
    head('Go to');
    for (const [label, v] of this.places()) btn(label, () => { if (this.gallery) this.closeGallery(true); this.follow = false; this.lookAt(v); });
    head('Mii animations');
    btn('Animation gallery', () => this.openGallery(), '#8a4a9a');
    head('Play');
    for (const [label, fn] of this.demos()) btn(label, () => { if (!this.anim && !this.gallery) fn(); }, '#3c7a4a');
    const second = btn('Second player on the spike stretch: off', () => { this.secondPlayer = !this.secondPlayer; second.textContent = `Second player on the spike stretch: ${this.secondPlayer ? 'on' : 'off'}`; }, '#4a4a7a');
    const slow = btn('Slow motion: off', () => { this.slow = this.slow === 0.15 ? 0.04 : this.slow === 0.04 ? 1 : 0.15; slow.textContent = `Slow motion: ${this.slow === 0.04 ? 'very slow' : this.slow < 1 ? 'on' : 'off'}`; }, '#4a4a7a'); // off -> on -> very slow -> off
    head('');
    btn('Reset everything', () => app.go('viewer'), '#7a5a2a');
    btn('Back to menu', () => { app.session = null; app.go('menu'); }, '#7a2a3a');
    const tip = document.createElement('div'); tip.style.cssText = 'opacity:.7;font-size:11px;margin-top:6px';
    tip.textContent = 'Drag to turn, scroll to zoom, right-drag or shift-drag to slide.'; panel.appendChild(tip);
    app.ui.appendChild(panel);
    for (const id of ['.wp-left', '.wp-order', '.wp-map', '.wp-pause', '.hud-bottom', '#turnmsg', '#counter', '#banner']) { const el = app.ui.querySelector(id); if (el && el.style) el.style.display = 'none'; }
  }

  // ---------------------------------------------------------------- the animation gallery
  // A separate stage (the island is hidden; only the sky stays) with one Mii, the first player's, and every Mii animation
  // Wii Party has for the boards (pm000_xx, shared) and for Board Game Island (pm001_xx): pick one to watch it, slow it
  // down, pause it and scrub it frame by frame. Each clip says which of the game's moments plays it now, if any.

  /** Open the gallery (on `clip`, or the first). */
  openGallery(clip = null) {
    if (this.gallery || !this.board || typeof document === 'undefined') return;
    if (this.anim) { this.anim = null; this.demo = []; } // (a set piece stops)
    const T = this.T, root = new T.Group(), G = { root, f: 0, speed: 1, playing: true, repeat: true, lock: true, hold: 0, clips: { ...ALL_CLIPS }, more: 'loading' };
    this.gallery = G;
    // the stage: a round of grass with a sandy edge, like a spot on the island
    const disc = new T.Mesh(new T.CylinderGeometry(4.2, 4.6, 0.6, 48), [new T.MeshLambertMaterial({ color: 0xc9b07a }), new T.MeshLambertMaterial({ color: 0x6cbf3f }), new T.MeshLambertMaterial({ color: 0xa88f5c })]);
    disc.position.y = -0.3; root.add(disc);
    const mark = new T.Mesh(new T.RingGeometry(0.9, 1.0, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    mark.rotation.x = -Math.PI / 2; mark.position.y = 0.01; root.add(mark);
    const mii = parseMii(this.miiDataOf(0));
    const fig = makeFigure(T, 0, mii, { ...WP_MII, clips: G.clips }); // (G.clips fills up when the rest arrive)
    fig.group.scale.setScalar(PAWN_SCALE); root.add(fig.group);
    G.fig = fig; G.mii = mii;
    try { G.caster = makeShadowCaster(T, fig.body.root, 9); } catch (e) { G.caster = null; }
    // everything else in the scene is hidden while the gallery is open (the sky and the lights stay)
    const keep = new Set([this.board.sky, this.camera, this.hemi, this.sun]);
    G.hidden = this.scene3d.children.filter((o) => o.visible && !keep.has(o));
    for (const o of G.hidden) o.visible = false;
    this.board.sky.visible = true;
    this.scene3d.add(root);
    this.follow = false;
    Object.assign(this.orbit, { tx: 0, ty: 1.3, tz: 0, dist: 5.5, pitch: 0.2, yaw: 0 });
    // the real head and the face's shading, once the Mii renderer is there
    loadMiiRenderer().then((F) => {
      if (!F || this.gallery !== G || !this.renderer) return;
      try { shadeLikeFace(T, fig.body, F); } catch (e) { /* plain lighting */ }
      try { fitFFLHead(fig.head, F.head(mii.ffl, this.renderer)); } catch (e) { /* the stand-in head */ }
      try { if (G.caster) G.caster.rebuild(); } catch (e) { /* */ }
      G.fflMats = null;
    }).catch(() => {});
    this.buildGalleryUi();
    this.playClip(clip && G.clips[clip] ? clip : galleryOrder(Object.keys(G.clips))[0]);
    // the rest of the clips: in the list once they are here (and played, if the link asked for one of them)
    loadMoreClips().then((more) => {
      if (this.gallery !== G) return;
      G.more = more ? 'in' : 'failed';
      if (more) Object.assign(G.clips, more);
      G.ui.list();
      if (more && clip && more[clip] && G.clip !== clip) this.playClip(clip);
    });
  }

  /** Back to the island. */
  closeGallery(quiet = false) {
    const G = this.gallery; if (!G) return;
    this.gallery = null;
    if (G.root.parent) G.root.parent.remove(G.root);
    for (const o of G.hidden) o.visible = true;
    if (G.panel && G.panel.parentNode) G.panel.parentNode.removeChild(G.panel);
    if (G.keys) removeEventListener('keydown', G.keys, true);
    const main = app.ui && app.ui.querySelector('.viewer-panel'); if (main) main.style.display = '';
    if (!quiet) this.lookAt(this.places()[0][1]);
  }

  playClip(name) {
    const G = this.gallery; if (!G || !G.clips[name]) return;
    G.clip = name; G.f = 0; G.hold = 0; G.playing = true;
    if (G.ui) G.ui.update(true);
  }

  stepGallery(dt) {
    const G = this.gallery, C = G && G.clips[G.clip]; if (!C) return;
    const last = C.frames - 1;
    if (G.playing) {
      if (C.loop) G.f = (G.f + dt * 60 * G.speed) % C.frames;
      else if (G.f < last) G.f = Math.min(last, G.f + dt * 60 * G.speed);
      else if (G.repeat && (G.hold += dt) > 1) { G.f = 0; G.hold = 0; } // (a clip that plays once: hold its end a second, then again)
    }
    const b = G.fig.body; b.rest(); b.pose(G.clip, G.f);
    if (G.lock && b.bones.ske_root) { const r = b.bones.ske_root; r.position.x = 0; r.position.z = 0; } // (in place, as the game plays them)
    if (G.caster && this.sun) { const L = this.sun.position, l = Math.hypot(L.x, L.y, L.z) || 1; G.caster.set({ x: 0, y: 0.03, z: 0 }, { x: 0, y: 1, z: 0 }, { x: -L.x / l, y: -L.y / l, z: -L.z / l }, 0.3); }
    if (G.ui) G.ui.update(false);
  }

  lightMiis() {
    super.lightMiis();
    const G = this.gallery; if (!G || !this.sun || !this.camera) return;
    const T = this.T, L = (this._galleryLight ||= { sun: new T.Vector3(), ffl: new T.Vector3(-0.4531539381, 0.4226179123, 0.7848858833), dir: new T.Vector3() });
    L.sun.copy(this.sun.position).normalize().transformDirection(this.camera.matrixWorldInverse);
    L.dir.copy(L.sun).multiplyScalar(0.6).addScaledVector(L.ffl, 0.4).normalize();
    if (!G.fflMats) { G.fflMats = []; G.fig.group.traverse((o) => { if (o.material && o.material.uniforms && o.material.uniforms.u_light_dir) G.fflMats.push(o.material); }); if (!G.fflMats.length) G.fflMats = null; }
    for (const m of G.fflMats || []) m.uniforms.u_light_dir.value.copy(L.dir);
  }

  buildGalleryUi() {
    const G = this.gallery, used = clipUses(); let names = [];
    const main = app.ui.querySelector('.viewer-panel'); if (main) main.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'viewer-panel gallery-panel';
    panel.style.cssText = 'position:absolute;right:12px;top:12px;bottom:12px;width:280px;display:flex;flex-direction:column;gap:6px;background:rgba(16,32,48,.9);color:#fff;border-radius:14px;padding:10px;font:13px sans-serif;pointer-events:auto';
    const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
    const button = (label, fn, bg = '#2a5a86') => { const b = el('button', `background:${bg};color:#fff;border:0;border-radius:8px;padding:6px 8px;font:13px sans-serif;cursor:pointer`, label); b.onclick = fn; return b; };
    panel.appendChild(el('div', 'font-weight:bold;font-size:15px', 'Animation gallery'));
    const now = el('div', 'background:#0006;border-radius:8px;padding:6px 8px;line-height:1.4'); panel.appendChild(now);
    const row = el('div', 'display:flex;gap:5px;flex-wrap:wrap'); panel.appendChild(row);
    const play = button('Pause', () => { G.playing = !G.playing; G.hold = 0; G.ui.update(true); });
    const speeds = [1, 0.5, 0.25, 0.1];
    const speed = button('Speed 1x', () => { G.speed = speeds[(speeds.indexOf(G.speed) + 1) % speeds.length]; G.ui.update(true); }, '#4a4a7a');
    const restart = button('Restart', () => { G.f = 0; G.hold = 0; G.playing = true; G.ui.update(true); }, '#4a4a7a');
    const lock = button('In place: on', () => { G.lock = !G.lock; G.ui.update(true); }, '#4a4a7a');
    row.append(play, speed, restart, lock);
    const scrub = el('input'); scrub.type = 'range'; scrub.min = 0; scrub.step = 1; scrub.style.cssText = 'width:100%';
    scrub.oninput = () => { G.playing = false; G.f = +scrub.value; G.hold = 0; G.ui.update(true); };
    panel.appendChild(scrub);
    const step = el('div', 'display:flex;gap:5px');
    step.append(button('< frame', () => { G.playing = false; G.f = Math.max(0, Math.round(G.f) - 1); G.ui.update(true); }, '#4a4a7a'), button('frame >', () => { G.playing = false; G.f = Math.min(G.clips[G.clip].frames - 1, Math.round(G.f) + 1); G.ui.update(true); }, '#4a4a7a'));
    panel.appendChild(step);
    panel.appendChild(el('div', 'opacity:.75;font-size:11px', 'Pick a board, mode or minigame to see the clips Wii Party loads for it. Purple = Party Island plays it now (as the name after it). Up/down arrows: next clip; space: pause.'));
    // which game's clips to show: every board, mode and minigame (from the disc: tools/extract_clip_loaders.py)
    const pick = el('select', 'width:100%;box-sizing:border-box;border:0;border-radius:8px;padding:6px 8px;font:13px sans-serif');
    pick.addEventListener('keydown', (e) => e.stopPropagation()); // (the arrow keys pick in the dropdown here)
    let filters = [];
    const fillPick = () => {
      const keep = pick.value || G.filter || 'all';
      filters = galleryFilters(Object.keys(G.clips)); pick.textContent = ''; let og = null, cur = null;
      for (const f of filters) {
        if (f.group !== cur) { cur = f.group; og = f.group ? el('optgroup') : null; if (og) { og.label = f.group; pick.appendChild(og); } }
        const o = el('option', null, f.label); o.value = f.value; if (f.clips && !f.clips.length) o.disabled = true;
        (og || pick).appendChild(o);
      }
      pick.value = filters.some((f) => f.value === keep) ? keep : 'all';
    };
    pick.onchange = () => { G.filter = pick.value; G.ui.list(); };
    panel.appendChild(pick);
    const search = el('input'); search.type = 'search'; search.placeholder = 'Find a clip (e.g. pm206 or 206_03)';
    search.style.cssText = 'width:100%;box-sizing:border-box;border:0;border-radius:8px;padding:6px 8px;font:13px sans-serif';
    search.addEventListener('keydown', (e) => e.stopPropagation()); // (typing here is not the arrow keys or space)
    search.oninput = () => G.ui.list();
    panel.appendChild(search);
    const status = el('div', 'font-size:11px;opacity:.85'); panel.appendChild(status);
    const list = el('div', 'flex:1;overflow:auto;display:flex;flex-direction:column;gap:3px;min-height:80px'); panel.appendChild(list);
    let items = {};
    panel.appendChild(button('Back to the island', () => this.closeGallery(), '#7a2a3a'));
    app.ui.appendChild(panel);
    G.panel = panel;
    G.keys = (e) => {
      if (!this.gallery) return;
      const i = names.indexOf(G.clip);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.playClip(names[(i + (e.key === 'ArrowDown' ? 1 : -1) + names.length) % names.length]); }
      else if (e.key === ' ') { e.preventDefault(); G.playing = !G.playing; G.ui.update(true); }
    };
    addEventListener('keydown', G.keys, true);
    let shown = null;
    const loadedBy = (n) => { // which of Wii Party's games load it (on the disc)
      const sel = LOADERS.find((L) => L.id === pick.value), shared = SHARED.includes(n);
      const by = clipLoadedBy(n).sort((a, b) => (sel ? (b === sel.name) - (a === sel.name) : 0)); // (the game picked first)
      if (!by.length) return `<span style="opacity:.75">Wii Party: ${shared ? 'only in every module\'s shared code' : 'not named by any game'}</span>`;
      const show = by.length > 4 ? `${by.slice(0, 4).join(', ')} and ${by.length - 4} more` : by.join(', ');
      return `<span style="opacity:.9">Wii Party loads it in: ${show}${shared ? ' (and in every module\'s shared code)' : ''}</span>`;
    };
    G.ui = {
      /** (Re)build the list: every clip there is so far that matches the search. */
      list: () => {
        const q = search.value.trim().toLowerCase();
        fillPick();
        const f = filters.find((x) => x.value === pick.value), only = f && f.clips ? new Set(f.clips) : null;
        names = galleryOrder(Object.keys(G.clips)).filter((n) => (!only || only.has(n)) && (!q || n.includes(q) || (used[n] || []).some((u) => u.toLowerCase().includes(q))));
        list.textContent = ''; items = {};
        let group = null;
        for (const n of names) {
          const gname = n.startsWith('pm001') ? 'Board Game Island (pm001)' : n.startsWith('pm000') ? 'Shared by every board (pm000)' : 'Other boards and minigames';
          if (gname !== group) { group = gname; list.appendChild(el('div', 'font-weight:bold;font-size:12px;margin:6px 0 2px;opacity:.9', gname)); }
          const C = G.clips[n], u = used[n];
          const b = button('', () => this.playClip(n), u ? '#6a3a7a' : '#2a4a66');
          b.style.textAlign = 'left'; b.style.padding = '4px 8px';
          b.innerHTML = `<b>${n}</b>${u ? ` &middot; ${u.join(', ')}` : ''}<span style="float:right;opacity:.7">${C.frames}f ${C.loop ? 'loop' : 'once'}</span>`;
          list.appendChild(b); items[n] = b;
        }
        const total = Object.keys(G.clips).length;
        status.textContent = G.more === 'loading' ? `${total} clips; loading the other boards' and minigames' clips...`
          : G.more === 'failed' ? `${total} clips (the other boards' and minigames' clips could not be loaded: they need mii/clips/ next to the page)`
          : (only ? `${names.length} of ${total} clips` + (f.value !== 'shared' && !f.unnamed && G.more !== 'in' ? ' so far' : '') : `${total} clips` + (q ? `, ${names.length} found` : ''));
        shown = null; G.ui.update(true);
      },
      update(full) {
        const C = G.clips[G.clip]; if (!C) return;
        if (full || shown !== G.clip) {
          if (shown && items[shown]) items[shown].style.outline = '';
          if (items[G.clip]) { items[G.clip].style.outline = '2px solid #ffd84a'; if (shown !== G.clip && items[G.clip].scrollIntoView) items[G.clip].scrollIntoView({ block: 'nearest' }); }
          shown = G.clip; scrub.max = C.frames - 1;
          play.textContent = G.playing ? 'Pause' : 'Play'; speed.textContent = `Speed ${G.speed}x`; lock.textContent = `In place: ${G.lock ? 'on' : 'off'}`;
        }
        scrub.value = Math.round(G.f);
        const u = used[G.clip];
        now.innerHTML = `<b style="font-size:15px">${G.clip}</b><br>${u ? `Party Island plays it as: <b>${u.join(', ')}</b>` : 'Not used by Party Island now'}<br>${loadedBy(G.clip)}<br>Frame ${Math.round(G.f)} / ${C.frames - 1} &middot; ${C.loop ? 'loops' : 'plays once'} &middot; ${(C.frames / 60).toFixed(2)} s`;
      },
    };
    G.ui.list();
  }
}
