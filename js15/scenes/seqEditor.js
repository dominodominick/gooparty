// The sequence editor, in the island viewer: pick a moment of the game (a space's note, a move, a smash...), see what the
// game does there now, and re-time it: which Mii animation plays when (and which way they face), where the camera is
// (fly it there and capture the shot; cut or glide), what else happens (glints, shaking, captions, fades), and how the
// game's own set piece runs under it (hold it, slow it). Play it, scrub it, save it. Saved sequences play in this
// browser at once; Export gives the text that makes them the game's (js15/game/sequences.js).
//
// The tracks and their blocks are described in director.js.

import { allMoments, sequenceFrames } from '../game/moments.js';
import { SEQUENCES } from '../game/sequences.js';
import { localSequences, saveLocalSequences, shotFromWorld, shotToWorld } from './director.js';
import { CLIP_TABLE, clipLength, loadMoreClips, nameOfCode } from '../world/clipTable.js';
import { LOADERS } from '../world/wpClipLoaders.js';

const TRACKS = [
  ['builtin', 'Game (built-in)', '#5a6a7a'],
  ['player', 'Player', '#6a3a8a'],
  ['others', 'Others', '#3a5a8a'],
  ['camera', 'Camera', '#2a7a5a'],
  ['fx', 'Effects', '#8a5a2a'],
];
const FACES = [['auto', 'as the game has it'], ['camera', 'the camera'], ['forward', 'along the path'], ['back', 'back down the path'], ['left', 'left of the path'], ['right', 'right of the path']];
const ACTIONS = [['glint', 'Glint (the hit effect)'], ['shake', 'Screen shake'], ['banner', 'Caption'], ['fade', 'Fade to black and back'], ['jolt', "A wall's jolt"], ['chips', 'Stone chips'], ['closeUp', 'Close-up (no number badges)']];
const WHERE = ['player', 'dragon.hit1', 'dragon.hit2', 'dragon.hit3', 'dragon.hit4', 'dragon.hit5', 'gate.hit1', 'gate.hit2', 'gate.hit3', 'gate.hit4', 'gate.hit5', 'gate.break'];
const css = (el, s) => { el.style.cssText = s; return el; };
const mk = (tag, style = '', text = '') => { const e = document.createElement(tag); if (style) e.style.cssText = style; if (text) e.textContent = text; return e; };
const clone = (o) => JSON.parse(JSON.stringify(o));

export class SeqEditor {
  constructor(view) {
    this.v = view; this.key = null; this.seq = null; this.sel = null; this.zoom = 3; this.T = 0;
    this.moments = allMoments();
    this.build();
    loadMoreClips(); // (every Wii Party clip, for the lists)
  }

  // ------------------------------------------------------------------ the panel
  build() {
    const root = this.root = mk('div', 'position:absolute;left:8px;right:220px;bottom:8px;height:46vh;min-height:300px;background:rgba(14,24,36,.94);color:#fff;border-radius:12px;font:12px sans-serif;display:flex;flex-direction:column;pointer-events:auto;z-index:40');
    root.className = 'viewer-panel seq-editor';
    const bar = mk('div', 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:6px 8px;border-bottom:1px solid #fff2');
    const B = (label, fn, bg = '#2a5a86', title = '') => { const b = mk('button', `background:${bg};color:#fff;border:0;border-radius:6px;padding:5px 8px;font:12px sans-serif;cursor:pointer`, label); b.onclick = fn; if (title) b.title = title; bar.appendChild(b); return b; };
    this.pick = mk('select', 'max-width:270px;font:12px sans-serif;border-radius:6px;padding:4px');
    this.pick.onchange = () => this.open(this.pick.value);
    this.pick.addEventListener('keydown', (e) => e.stopPropagation());
    bar.appendChild(this.pick);
    this.playBtn = B('▶ Play', () => this.togglePlay(), '#3c7a4a', 'Play the moment from the start (space)');
    B('⏮', () => this.seek(0), '#4a4a7a', 'Back to the start');
    B('◀ 1', () => this.seek(Math.max(0, this.T - 1)), '#4a4a7a', 'One frame back');
    B('1 ▶', () => this.seek(this.T + 1), '#4a4a7a', 'One frame on');
    B('Record from the game', () => this.record(), '#7a5a2a', 'Play the moment as the game does it now, and show what it does as blocks to edit');
    B('📷 Capture shot', () => this.capture(), '#2a7a5a', 'A camera shot from where the camera is now (pause, fly the camera, capture)');
    B('Save', () => this.save(), '#3c7a4a', 'Keep this sequence (it plays in this browser from now on)');
    B('Revert', () => this.revert(), '#7a3a3a', "Forget this browser's sequence for this moment (back to the game's)");
    B('Export / import', () => this.exportBox(), '#4a4a7a', 'All saved sequences as text: send it to have them put in the game');
    B('−', () => { this.zoom = Math.max(0.5, this.zoom / 1.5); this.draw(); }, '#4a4a7a', 'Zoom out');
    B('+', () => { this.zoom = Math.min(16, this.zoom * 1.5); this.draw(); }, '#4a4a7a', 'Zoom in');
    this.status = mk('span', 'opacity:.8;margin-left:6px'); bar.appendChild(this.status);
    this.foldBtn = B('▾ Hide timeline', () => this.fold(), '#4a4a7a', 'Show the whole picture (H)');
    B('Close', () => this.close(), '#7a2a3a');
    root.appendChild(bar);
    const body = this.body = mk('div', 'flex:1;display:flex;min-height:0');
    this.lanesBox = mk('div', 'flex:1;overflow:auto;position:relative;min-width:0');
    this.inspector = mk('div', 'width:260px;overflow:auto;border-left:1px solid #fff2;padding:8px;display:flex;flex-direction:column;gap:5px');
    body.appendChild(this.lanesBox); body.appendChild(this.inspector);
    root.appendChild(body);
    this.v.ui ? this.v.ui.appendChild(root) : (document.querySelector('#ui') || document.body).appendChild(root);
    this.keys = (e) => {
      if (!this.root.isConnected || /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.seek(Math.max(0, this.T - (e.shiftKey ? 10 : 1))); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.seek(this.T + (e.shiftKey ? 10 : 1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.remove(this.sel); }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); this.fold(); }
    };
    addEventListener('keydown', this.keys, true);
    const banner = document.querySelector('#banner'); if (banner) { this.bannerWas = banner.style.display; banner.style.display = ''; } // (captions show while editing)
    this.fillPick();
  }

  /** Fold the timeline away (just the toolbar), to see the whole picture as the game shows it; and back. */
  fold() {
    this.folded = !this.folded;
    this.body.style.display = this.folded ? 'none' : 'flex';
    this.root.style.height = this.folded ? 'auto' : '46vh'; this.root.style.minHeight = this.folded ? '0' : '300px';
    this.foldBtn.textContent = this.folded ? '▴ Show timeline' : '▾ Hide timeline';
  }

  fillPick() {
    const mine = localSequences(), cur = this.pick.value;
    this.pick.textContent = '';
    let og = null, g = null;
    for (const m of this.moments) {
      if (m.group !== g) { g = m.group; og = mk('optgroup'); og.label = g; this.pick.appendChild(og); }
      const o = mk('option', '', `${mine[m.key] ? '● ' : SEQUENCES[m.key] ? '○ ' : ''}${m.title}${this.v.momentDemos && this.v.momentDemos[m.key] ? '' : '  (no preview)'}`);
      o.value = m.key; og.appendChild(o);
    }
    this.pick.value = cur || (this.key || this.moments[0].key);
  }

  close() {
    this.stop();
    removeEventListener('keydown', this.keys, true);
    this.root.remove();
    const banner = document.querySelector('#banner'); if (banner) banner.style.display = this.bannerWas ?? 'none';
    this.v.seqEdit = null; this.v.seqRecord = null; this.v.seqPaused = false; this.v.seqFreeCam = false; this.v.slow = 1;
    this.v.seqEditor = null;
  }

  // ------------------------------------------------------------------ a moment
  open(key) {
    this.stop();
    this.key = key; this.pick.value = key; this.sel = null; this.T = 0;
    const saved = localSequences()[key] || SEQUENCES[key];
    this.seq = saved ? clone(saved) : { key, blocks: [] };
    this.v.seqEdit = { key, seq: this.seq };
    this.say(saved ? '' : 'Nothing changed here yet: press Record from the game to see what it does now.');
    this.draw(); this.inspect(null);
  }

  get demo() { return this.v.momentDemos && this.v.momentDemos[this.key]; }
  get total() { return Math.max(60, sequenceFrames(this.seq, this.liveTotal || 0), ...this.seq.blocks.map((b) => (b.at || 0) + (b.len || 0))); }
  say(t) { this.status.textContent = t; }

  // ------------------------------------------------------------------ playing
  /** Run the moment's preview (from the viewer's set pieces); pause at frame `stopAt` if given. */
  run(stopAt = null) {
    const d = this.demo;
    if (!d) { this.say('No preview for this moment in the viewer: it plays in a game.'); return false; }
    const v = this.v;
    v.seqPaused = false; v.seqFreeCam = false;
    v.anim = null; v.demo = []; v.loopDemo = null; v.camHold = null;
    v.seqEdit = { key: this.key, seq: this.seq };
    this.liveT = null; this.stopAt = stopAt; this.running = true;
    v.slow = stopAt != null && stopAt > 0 ? 6 : 1; // (to a frame: fast)
    d();
    this.playBtn.textContent = '⏸ Pause';
    return true;
  }
  stop() { this.running = false; this.stopAt = null; if (this.v) { this.v.slow = 1; } if (this.playBtn) this.playBtn.textContent = '▶ Play'; }
  togglePlay() {
    const v = this.v;
    if (v.seqPaused) { this.unfreeze(); return; }
    if (this.running && v.seqEdit && v.seqEdit.T != null && v.anim && v.anim.moment === this.key) { this.freeze(); return; }
    this.run();
  }
  /** Pause where it is: the camera is yours to fly (to capture a shot). */
  freeze() {
    const v = this.v; v.seqPaused = true; this.playBtn.textContent = '▶ Resume';
    const c = v.camera, o = v.orbit; // (the orbit picks up from the camera as it is)
    const dir = c.getWorldDirection(new c.position.constructor()), d = 10;
    o.tx = c.position.x + dir.x * d; o.ty = c.position.y + dir.y * d; o.tz = c.position.z + dir.z * d; o.dist = d;
    o.pitch = Math.asin(Math.max(-1, Math.min(1, -dir.y))); o.yaw = Math.atan2(-dir.x, -dir.z);
    this.say(`Paused at frame ${Math.round(this.T)}: drag to turn the camera, scroll to zoom, right-drag to slide; Capture shot puts it on the timeline.`);
  }
  unfreeze() { this.v.seqPaused = false; this.playBtn.textContent = '⏸ Pause'; this.say(''); }
  seek(T) { this.T = Math.max(0, Math.round(T)); if (!this.run(this.T)) this.draw(); }

  /** Each frame (from the viewer): where the moment is, and stopping at a frame. */
  tick() {
    const e = this.v.seqEdit;
    if (e && e.T != null && this.running) {
      this.T = e.T; this.liveTotal = e.innerFrames || this.liveTotal;
      if (this.stopAt != null && this.stopAt - e.T < 14) this.v.slow = 1; // (slow down near the frame)
      if (this.stopAt != null && e.T >= this.stopAt) { // exactly there
        const a = this.v.anim, F = this.stopAt;
        if (a && a.moment === this.key && a.step) { a.t = F * 1000 / 60; a.step(Math.min(1, a.t / a.dur)); this.T = F; this.drawHead(); }
        this.stopAt = null; this.freeze();
      }
      if (e.done) { e.done = false; this.running = false; this.playBtn.textContent = '▶ Play'; }
      this.drawHead();
    }
  }

  /** Play the moment as the game does it now, and keep what it did as blocks (marked as recorded) to edit from. */
  record() {
    if (!this.demo) { this.say('No preview for this moment in the viewer: nothing to record.'); return; }
    const keep = this.seq.blocks.filter((b) => !b.rec && b.track !== 'builtin' && !(b.track === 'camera' && b.mode === 'builtin'));
    this.seq.blocks = []; // (the game's own, untouched, while it is recorded)
    this.v.seqRecord = { key: this.key, done: (got) => {
      this.v.seqRecord = null;
      this.seq.blocks = [...got.blocks, ...keep];
      this.v.seqEdit = { key: this.key, seq: this.seq };
      this.say('Recorded: the hatched blocks are what the game does (they play as the game has them; edit one to change it).');
      this.draw();
    } };
    this.say('Recording...');
    this.run();
  }

  // ------------------------------------------------------------------ the camera
  capture() {
    const v = this.v, e = v.seqEdit, A = e && e.anchor;
    if (!A) { this.say('Play the moment first (the shot is kept relative to the space it starts on).'); return; }
    const c = v.camera, dir = c.getWorldDirection(new c.position.constructor()), d = v.seqPaused ? v.orbit.dist : 10;
    const w = { x: c.position.x, y: c.position.y, z: c.position.z, tx: c.position.x + dir.x * d, ty: c.position.y + dir.y * d, tz: c.position.z + dir.z * d };
    const shot = shotFromWorld(A, w);
    if (this.sel && this.sel.track === 'camera') { this.sel.shot = shot; if (this.sel.mode === 'builtin' || this.sel.mode === 'game') this.sel.mode = 'cut'; }
    else this.add('camera', { mode: 'cut', shot, len: 30 });
    this.say('Shot captured.'); this.draw(); this.inspect(this.sel);
  }
  viewShot(b) {
    const v = this.v, e = v.seqEdit, A = e && e.anchor;
    if (!A || !b.shot) return;
    if (!v.seqPaused) this.freeze();
    const w = shotToWorld(A, b.shot), o = v.orbit, dx = w.tx - w.x, dy = w.ty - w.y, dz = w.tz - w.z, d = Math.hypot(dx, dy, dz) || 10;
    o.tx = w.tx; o.ty = w.ty; o.tz = w.tz; o.dist = d; o.pitch = Math.asin(-dy / d); o.yaw = Math.atan2(-dx, -dz);
  }

  // ------------------------------------------------------------------ blocks
  add(track, extra = {}) {
    const len = track === 'player' || track === 'others' ? 60 : track === 'builtin' ? Math.max(30, (this.liveTotal || 120) - this.T) : 30;
    const b = { track, at: Math.round(this.T), len, ...(track === 'player' || track === 'others' ? { clip: 'idle', from: 0, speed: 1, face: 'auto' } : {}),
      ...(track === 'builtin' ? { from: Math.round(this.v.seqEdit && this.v.seqEdit.B != null ? this.v.seqEdit.B : this.T), speed: 1 } : {}),
      ...(track === 'camera' ? { mode: 'game' } : {}), ...(track === 'fx' ? { action: 'glint', where: 'player' } : {}), ...extra };
    this.seq.blocks.push(b); this.sel = b; this.dirty();
    return b;
  }
  remove(b) { this.seq.blocks = this.seq.blocks.filter((x) => x !== b); if (this.sel === b) this.sel = null; this.dirty(); this.inspect(null); }
  dirty() { this.v.seqEdit = { key: this.key, seq: this.seq }; this.draw(); this.say('Not saved yet.'); }

  save() {
    const all = localSequences();
    all[this.key] = clone(this.seq);
    this.say(saveLocalSequences(all) ? 'Saved: it plays like this in this browser now. Export it to have it put in the game.' : 'Could not save here (this browser blocks storage).');
    this.fillPick();
  }
  revert() {
    const all = localSequences(); delete all[this.key]; saveLocalSequences(all);
    this.open(this.key); this.fillPick(); this.say("Back to the game's own.");
  }

  exportBox() {
    const box = mk('div', 'position:absolute;inset:10%;background:#101a26;color:#fff;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;z-index:60;pointer-events:auto;font:13px sans-serif');
    box.className = 'viewer-panel';
    box.appendChild(mk('div', 'font-weight:bold', 'Export / import'));
    box.appendChild(mk('div', 'opacity:.8', 'Every sequence saved in this browser, as text. Copy it and send it, and it can be put in the game for everyone. To bring sequences in, paste such text here and press Import.'));
    const ta = mk('textarea', 'flex:1;font:11px monospace;border-radius:8px;padding:8px');
    ta.value = JSON.stringify(localSequences());
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    box.appendChild(ta);
    const row = mk('div', 'display:flex;gap:6px');
    const b = (t, fn, bg) => { const x = mk('button', `background:${bg};color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer`, t); x.onclick = fn; row.appendChild(x); };
    b('Copy', async () => { ta.select(); try { await navigator.clipboard.writeText(ta.value); this.say('Copied.'); } catch (e) { document.execCommand && document.execCommand('copy'); } }, '#2a5a86');
    b('Download file', () => { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ta.value], { type: 'application/json' })); a.download = 'party-island-sequences.json'; a.click(); } catch (e) { this.say('Downloading is blocked here: use Copy.'); } }, '#2a5a86');
    b('Import', () => { try { const got = JSON.parse(ta.value || '{}'); const all = { ...localSequences(), ...got }; saveLocalSequences(all); this.fillPick(); if (got[this.key]) this.open(this.key); this.say(`Imported ${Object.keys(got).length} sequence(s).`); box.remove(); } catch (e) { alertIn(box, 'That is not an export.'); } }, '#3c7a4a');
    b('Close', () => box.remove(), '#7a2a3a');
    box.appendChild(row);
    this.root.parentNode.appendChild(box);
  }

  // ------------------------------------------------------------------ the timeline
  draw() {
    const box = this.lanesBox, total = this.total, z = this.zoom, W = total * z + 120;
    box.textContent = '';
    const inner = mk('div', `position:relative;width:${W}px;min-height:100%`);
    // the ruler: seconds
    const ruler = mk('div', 'position:sticky;top:0;height:18px;background:#0e1824;z-index:3;margin-left:110px;position:relative');
    for (let f = 0; f <= total; f += 30) { const t = mk('div', `position:absolute;left:${f * z}px;top:0;height:18px;border-left:1px solid #fff3;padding-left:2px;font-size:10px;opacity:.7`, f % 60 === 0 ? `${f / 60}s` : ''); ruler.appendChild(t); }
    ruler.onpointerdown = (e) => this.seek((e.clientX - ruler.getBoundingClientRect().left) / z);
    inner.appendChild(ruler);
    for (const [track, label, color] of TRACKS) {
      const lane = mk('div', 'position:relative;height:30px;border-bottom:1px solid #fff1;display:flex');
      const name = mk('div', 'width:104px;flex:none;padding:7px 4px;position:sticky;left:0;background:#0e1824;z-index:2;display:flex;justify-content:space-between;align-items:center', label);
      const plus = mk('button', 'background:#fff2;color:#fff;border:0;border-radius:4px;cursor:pointer;padding:0 6px', '+');
      plus.title = `Add a ${label} block at the playhead`; plus.onclick = () => { const b = this.add(track); this.inspect(b); };
      name.appendChild(plus); lane.appendChild(name);
      const area = mk('div', 'position:relative;flex:1;margin-left:6px');
      area.onpointerdown = (e) => { if (e.target === area) this.seek((e.clientX - area.getBoundingClientRect().left) / z); };
      for (const b of this.seq.blocks.filter((x) => x.track === track)) area.appendChild(this.blockEl(b, color, z));
      lane.appendChild(area); inner.appendChild(lane);
    }
    this.head = mk('div', 'position:absolute;top:0;bottom:0;width:2px;background:#ff5a5a;pointer-events:none;z-index:4');
    inner.appendChild(this.head);
    box.appendChild(inner);
    this.drawHead();
  }
  drawHead() { if (this.head) this.head.style.left = `${110 + 6 + this.T * this.zoom}px`; }

  blockEl(b, color, z) {
    const len = Math.max(1, b.len || 1);
    const el = mk('div', `position:absolute;top:3px;height:22px;left:${b.at * z}px;width:${Math.max(6, len * z)}px;background:${color};border-radius:5px;overflow:hidden;white-space:nowrap;font-size:11px;padding:3px 5px;box-sizing:border-box;cursor:grab;${b.rec ? 'background-image:repeating-linear-gradient(45deg,#fff2 0 6px,transparent 6px 12px);opacity:.75;' : ''}${this.sel === b ? 'outline:2px solid #fff;' : ''}`);
    el.textContent = this.label(b);
    el.title = this.label(b) + (b.rec ? ' (recorded from the game)' : '');
    const grip = mk('div', 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:ew-resize;background:#fff3');
    el.appendChild(grip);
    el.onpointerdown = (e) => {
      e.stopPropagation(); this.sel = b; this.inspect(b);
      const x0 = e.clientX, at0 = b.at, len0 = b.len || 1, resize = e.target === grip;
      const mv = (m) => { const df = Math.round((m.clientX - x0) / z); if (resize) b.len = Math.max(1, len0 + df); else b.at = Math.max(0, at0 + df); if (b.rec && df) delete b.rec; el.style.left = `${b.at * z}px`; el.style.width = `${Math.max(6, (b.len || 1) * z)}px`; };
      const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); this.dirty(); this.inspect(b); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
    };
    return el;
  }

  label(b) {
    if (b.track === 'builtin') return b.speed === 0 ? `hold at ${b.from}` : `play from ${b.from || 0}${b.speed !== 1 ? ` ×${b.speed}` : ''}`;
    if (b.track === 'player' || b.track === 'others') return `${nameOfCode[b.clip] ? `${b.clip} (${nameOfCode[b.clip]})` : b.clip}${b.face && b.face !== 'auto' ? ` · faces ${b.face}` : ''}`;
    if (b.track === 'camera') return b.mode === 'builtin' ? "the set piece's own" : b.mode === 'game' ? 'the game camera' : `${b.mode}${b.follow ? ' (follows)' : ''}`;
    if (b.track === 'fx') return `${b.action}${b.where && b.where !== 'player' && b.action !== 'banner' ? ` @ ${b.where}` : ''}${b.text ? `: ${b.text}` : ''}`;
    return b.track;
  }

  // ------------------------------------------------------------------ the inspector
  inspect(b) {
    const I = this.inspector; I.textContent = '';
    if (!b) {
      I.appendChild(mk('div', 'opacity:.8;line-height:1.4', 'Pick a block to change it, or + on a track to add one at the red line. Drag a block to move it, its right edge to make it longer. Space plays and pauses; arrows step a frame (shift: 10).'));
      if (this.demo) I.appendChild(mk('div', 'opacity:.6;margin-top:6px', `Key: ${this.key}`));
      return;
    }
    const row = (label, input) => { const r = mk('label', 'display:flex;flex-direction:column;gap:2px'); r.appendChild(mk('span', 'opacity:.75', label)); r.appendChild(input); I.appendChild(r); input.addEventListener('keydown', (e) => e.stopPropagation()); return input; };
    const num = (label, key, step = 1) => { const i = mk('input', 'border-radius:5px;padding:3px'); i.type = 'number'; i.step = step; i.value = b[key] ?? ''; i.onchange = () => { b[key] = Number(i.value); delete b.rec; this.dirty(); }; return row(label, i); };
    const sel = (label, key, opts) => { const s = mk('select', 'border-radius:5px;padding:3px'); for (const [v, t] of opts) { const o = mk('option', '', t); o.value = v; s.appendChild(o); } s.value = String(b[key] ?? opts[0][0]); s.onchange = () => { b[key] = s.value; delete b.rec; this.dirty(); this.inspect(b); }; return row(label, s); };
    const text = (label, key) => { const i = mk('input', 'border-radius:5px;padding:3px'); i.value = b[key] ?? ''; i.onchange = () => { b[key] = i.value; delete b.rec; this.dirty(); }; return row(label, i); };
    const check = (label, key, def = false) => { const r = mk('label', 'display:flex;gap:6px;align-items:center'); const i = mk('input'); i.type = 'checkbox'; i.checked = b[key] ?? def; i.onchange = () => { b[key] = i.checked; delete b.rec; this.dirty(); }; r.appendChild(i); r.appendChild(mk('span', '', label)); I.appendChild(r); return i; };
    const btn = (t, fn, bg = '#2a5a86') => { const x = mk('button', `background:${bg};color:#fff;border:0;border-radius:6px;padding:5px;cursor:pointer`, t); x.onclick = fn; I.appendChild(x); return x; };
    const title = TRACKS.find(([t]) => t === b.track);
    I.appendChild(mk('div', 'font-weight:bold', `${title ? title[1] : b.track} block`));
    if (b.rec) { I.appendChild(mk('div', 'opacity:.8', 'Recorded from the game: shown, not played. Change anything here (or press Use) and it plays as you set it.')); btn('Use this block', () => { delete b.rec; this.dirty(); this.inspect(b); }, '#3c7a4a'); }
    num('Starts at frame (60 a second)', 'at');
    num(b.track === 'camera' ? 'Lasts (frames; for a glide: how long it glides)' : 'Lasts (frames)', 'len');
    if (b.track === 'builtin') {
      num("From the game's frame", 'from');
      num('Speed (1 = as made, 0 = hold still, 0.5 = half speed)', 'speed', 0.05);
      I.appendChild(mk('div', 'opacity:.7', "The game's own set piece runs under the sequence. With no block here it plays as it is; hold it to make everything wait, or play a part of it slower."));
    }
    if (b.track === 'player' || b.track === 'others') {
      // the clip: a searchable list of every clip (the game's names, and every Wii Party code)
      const find = mk('input', 'border-radius:5px;padding:3px'); find.placeholder = 'Search (e.g. pm301, cheer)';
      const list = mk('select', 'border-radius:5px;padding:3px'); list.size = 6;
      const fill = () => {
        const q = find.value.trim().toLowerCase(); list.textContent = '';
        const names = Object.keys(CLIP_TABLE).sort((a, c) => (/^pm/.test(a) - /^pm/.test(c)) || (a < c ? -1 : 1));
        for (const n of names) {
          const nice = nameOfCode[n] ? `${n} (${nameOfCode[n]})` : n;
          if (q && !nice.toLowerCase().includes(q)) continue;
          const o = mk('option', '', `${nice} · ${CLIP_TABLE[n].frames}f`); o.value = n; list.appendChild(o);
        }
        list.value = b.clip;
      };
      find.oninput = fill; fill();
      list.onchange = () => { b.clip = list.value; delete b.rec; this.dirty(); this.inspect(b); };
      row('Animation', find); I.appendChild(list);
      const fr = clipLength(b.clip);
      I.appendChild(mk('div', 'opacity:.7', `${b.clip}: ${fr || '?'} frames${fr ? ` (${(fr / 60).toFixed(2)} s)` : ''}`));
      num('From its frame', 'from');
      num('Speed', 'speed', 0.05);
      check('Loop (otherwise it holds its last frame)', 'loop', true);
      const times = mk('input', 'border-radius:5px;padding:3px'); times.type = 'number'; times.step = 1; times.min = 1;
      times.value = fr ? Math.round(((b.len || 0) * (b.speed ?? 1)) / fr * 10) / 10 : '';
      times.onchange = () => { if (fr) { b.len = Math.round(Number(times.value) * fr / (b.speed || 1)); delete b.rec; this.dirty(); this.inspect(b); } };
      row('Times it plays (sets how long it lasts)', times);
      const faces = [...FACES]; if (typeof b.face === 'number') faces.push([String(b.face), `${b.face}° from the path`]);
      sel('Faces', 'face', faces);
      const deg = mk('input', 'border-radius:5px;padding:3px'); deg.type = 'number'; deg.placeholder = 'or an angle from the path (°)';
      deg.onchange = () => { b.face = Number(deg.value); delete b.rec; this.dirty(); this.inspect(b); }; row('Angle from the path (°)', deg);
      I.appendChild(mk('div', 'opacity:.7', b.track === 'others' ? 'Everyone else in the moment (the spike stretch, the other UFO player...).' : 'The game still moves them (a walk, an arc); this is what their body does.'));
    }
    if (b.track === 'camera') {
      sel('Camera', 'mode', [['cut', 'Cut to this shot'], ['glide', 'Glide to this shot'], ['game', 'The game camera'], ['builtin', "The set piece's own"]]);
      if (b.mode === 'cut' || b.mode === 'glide') {
        check('Follow the player (the shot moves with them)', 'follow');
        btn('📷 Capture the camera into this shot', () => { this.sel = b; this.capture(); });
        if (b.shot) btn('View this shot (pauses)', () => this.viewShot(b), '#4a4a7a');
        I.appendChild(mk('div', 'opacity:.7', 'A shot is kept relative to the space the moment starts on (and the way the path goes there), so it fits every space of the kind.'));
      }
    }
    if (b.track === 'fx') {
      sel('What happens', 'action', ACTIONS);
      if (b.action === 'glint' || b.action === 'chips' || b.action === 'jolt') sel('Where', 'where', WHERE.map((w) => [w, w === 'player' ? 'at the player' : w]));
      if (b.action === 'banner') text('Caption (a [name] is fine)', 'text');
      if (b.action === 'glint') { text("Colour (blank: the player's)", 'color'); num('Size', 'size', 0.1); }
    }
    btn('Duplicate', () => { const c = clone(b); c.at = (b.at || 0) + (b.len || 30); delete c.rec; this.seq.blocks.push(c); this.sel = c; this.dirty(); this.inspect(c); }, '#4a4a7a');
    btn('Delete', () => this.remove(b), '#7a3a3a');
  }
}

function alertIn(box, msg) { const d = mk('div', 'color:#ff9a9a', msg); box.appendChild(d); setTimeout(() => d.remove(), 3000); }
