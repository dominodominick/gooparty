// Island viewer: the board exactly as the game draws it (same scene, same props, same tiles), with no game running.
// Drag to turn, scroll to zoom, right-drag (or shift-drag) to slide. Buttons jump to each place and play the set pieces.
import { app } from '../app.js';
import { BoardScene } from './boardScene.js';
import { ISLAND } from '../game/boardData.js';
import { DUR, walkForward, walkBack } from '../game/boardGame.js';
import { stopOfSpace, VOLCANO_OFFSET, terrainHeight } from '../game/boardLayout.js';

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
  }

  exit() {
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
    const at = (idx) => { const p = this.pawns[0], q = this.pos.island[idx]; this.fx.unhide(p); this.camSlot = 0; for (const o of Object.values(this.pawns)) if (o !== p) o.group.visible = false; Object.assign(p, { track: 'island', idx, x: q.x, y: q.y + 0.05, z: q.z, scale: 1, fx: null }); p.group.visible = true; this.place(p); this.lookAt({ p: q, dist: 32, pitch: 0.45 }); this.follow = true; return p; };
    const walk = (from, n, mode = 'fast', extra = {}) => { const path = []; const step = n > 0 ? 1 : -1; for (let i = 1; i <= Math.abs(n); i++) path.push({ track: 'island', idx: from + i * step }); return { t: 'move', slot: 0, mode, path, dur: Math.abs(n) * (mode === 'fast' ? 190 : 340) + 350 + DUR.cross, ...extra }; };
    const move = (ev) => () => this.wrapMove(ev, this.beginMove(ev));
    const throwBy = (s, color) => { const n = ISLAND[s].arg, w = (color === 'blue' ? walkForward : walkBack)({ track: 'island', idx: s }, n);
      return { t: 'move', slot: 0, mode: 'fly', statue: color, path: w.path, count: { total: n, dir: color === 'blue' ? 'fwd' : 'back' }, dur: DUR.statueThrow }; };
    const spring = (slot, from, n, color) => { const path = []; const st = n > 0 ? 1 : -1; for (let i = 1; i <= Math.abs(n); i++) path.push({ track: 'island', idx: from + i * st }); return { t: 'move', slot, mode: 'spring', spring: color, path, count: { total: Math.abs(n), dir: n > 0 ? 'fwd' : 'back' }, dur: DUR.spring }; };
    const put = (slot, idx) => { const p = this.pawns[slot], q = this.pos.island[idx]; Object.assign(p, { track: 'island', idx, x: q.x, y: q.y + 0.05, z: q.z, scale: 1, fx: null }); p.group.visible = true; this.place(p); return p; };
    return [
      ['Vine swing (4, then walk 2)', () => { const v = stopOf('vine'); at(v); this.fx.begin(0); this.demo.push(() => ({ t: 0, dur: 1200 }), move({ ...walk(v, 6, 'walk', { swing: 4 }), dur: 6 * 340 + 350 + DUR.cross + DUR.swing + DUR.vinePause })); }], // rolled 4 on the vine, 2 spaces left to walk
      ['Dragon fireball', () => { const p = at(stopOf('dragon')); this.demo.push(() => this.fx.playNote({ fx: 'fireball', dur: DUR.fire }, p)); }],
      ['Smash dragon wall', () => { const p = at(stopOf('dragon')); this.demo.push(() => this.fx.brokenAnim({ challenge: 'dragon', dur: DUR.wall }, p)); }],
      ['Blue statue throw', () => { const s = stopOf('statueBlue'); at(s); this.demo.push(move(throwBy(s, 'blue'))); }],
      ['Red statue throw', () => { const s = stopOf('statueRed'); at(s); this.demo.push(move(throwBy(s, 'red'))); }],
      ['Volcano push', () => { const s = stopOf('volcanoOrNot'); at(s); this.demo.push(move({ t: 'move', slot: 0, mode: 'drop', path: [{ track: 'volcano', idx: 0 }], dur: DUR.drop })); }],
      ['Spike ball chase', () => { const s = stopOf('spike'), p = at(s); this.demo.push(() => this.fx.playNote({ fx: 'pit', dur: DUR.pit }, p), move(walk(s, -11, 'fast'))); }],
      ['Smash spike statue', () => { const p = at(stopOf('spike')); this.demo.push(() => this.fx.brokenAnim({ challenge: 'spike', dur: DUR.wall }, p)); }],
      ['Blue spring (+5)', () => { const s = stopOf('plus5'); at(s); this.demo.push(move(spring(0, s, 5, 'blue'))); }],
      ['Red spring (-4)', () => { const s = stopOf('minus4'); at(s); this.demo.push(move(spring(0, s, -4, 'red'))); }],
      ['1v1 won: green springs', () => { const s = stopOf('mg11'); at(s); const o = put(1, s + 2); this.demo.push(move(spring(0, s, 7, 'green')), () => { this.camSlot = 1; return move(spring(1, s + 2, -7, 'green'))(); }); void o; }],
      ['1 vs Rest won: green spring', () => { const s = stopOf('mgRest'); at(s); this.demo.push(move(spring(0, s, 10, 'green'))); }],
      ['UFO swap', () => { const s = stopOf('ufo'), o = s + 6; at(s); put(1, o);
        const ufo = (ev) => () => this.beginUfo({ t: 'ufo', dur: DUR.ufo, ...ev });
        this.demo.push(ufo({ phase: 'up', slot: 0 }), ufo({ phase: 'up', slot: 1 }), ufo({ phase: 'down', slot: 1, to: { track: 'island', idx: s } }), ufo({ phase: 'down', slot: 0, to: { track: 'island', idx: o } })); }],
      ['Open summit', () => { this.openSummit(); }],
    ];
  }

  // never follow the host: nothing is running
  onTurn() {}
  syncIdle() { this.idle = true; }

  tickAnim(dt) {
    if (!this.anim && this.demo.length) { this.anim = this.demo.shift()() || { t: 0, dur: 1 }; this.idle = false; }
    if (!this.anim) return;
    const a = this.anim; a.t += dt * 1000;
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
    this.setAmbience(o.tx > VOLCANO_OFFSET.x / 2 ? 'volcano' : 'island');
    const cp = Math.cos(o.pitch);
    this.camera.position.set(o.tx + Math.sin(o.yaw) * cp * o.dist, o.ty + Math.sin(o.pitch) * o.dist, o.tz + Math.cos(o.yaw) * cp * o.dist);
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
    for (const [label, v] of this.places()) btn(label, () => { this.follow = false; this.lookAt(v); });
    head('Play');
    for (const [label, fn] of this.demos()) btn(label, () => { if (!this.anim) fn(); }, '#3c7a4a');
    head('');
    btn('Reset everything', () => app.go('viewer'), '#7a5a2a');
    btn('Back to menu', () => { app.session = null; app.go('menu'); }, '#7a2a3a');
    const tip = document.createElement('div'); tip.style.cssText = 'opacity:.7;font-size:11px;margin-top:6px';
    tip.textContent = 'Drag to turn, scroll to zoom, right-drag or shift-drag to slide.'; panel.appendChild(tip);
    app.ui.appendChild(panel);
    for (const id of ['.wp-left', '.wp-order', '.wp-map', '.wp-pause', '.hud-bottom', '#turnmsg', '#counter', '#banner']) { const el = app.ui.querySelector(id); if (el && el.style) el.style.display = 'none'; }
  }
}
