// The sequence studio: a screen of its own for timing the board's moments (landing on a special space, a move, a smash,
// the UFO, a turn starting...). On the left, every moment; in the middle, the game as it plays the moment (the same
// 16:9 picture a game shows); on the right, whatever is picked; along the bottom, the timeline:
//   Game      the game's own set piece: play it, hold it, slow it
//   Camera    keyframes: fly the camera where you want it and press Add camera keyframe; it moves smoothly between them
//   Effects   glints, shaking, captions, fades...
//   Mii 1, 2  for each Mii in the moment: an Animation track (any Wii Party clip) and a Face track (the seven Mii faces)
// Everything saves in this browser as you go (and plays there in games); Export gives the text that puts it in the game.
// Panels can be resized by dragging the bars between them, hidden, and the whole thing made bigger or smaller.
// The sequences themselves are played by director.js.

import { app } from '../app.js';
import { ViewerScene, FACES } from './viewerScene.js';
import { allMoments, castOf, sequenceFrames, upgradeSequence } from '../game/moments.js';
import { SEQUENCES } from '../game/sequences.js';
import { localSequences, saveLocalSequences, shotFromWorld, shotToWorld, cameraAt } from './director.js';
import { CLIP_TABLE, clipLength, loadMoreClips, nameOfCode } from '../world/clipTable.js';
import { PLAYER_COLORS, VIRTUAL } from '../config.js';

const FPS = 60;
const LAYOUT = 'party-island-studio-layout';
const FACE_ICON = ['😐', '😊', '😠', '😢', '😲', '😑', '😮'];
const FACINGS = [['auto', 'As the game has it'], ['camera', 'The camera'], ['forward', 'Along the path'], ['back', 'Back down the path'], ['left', 'Left of the path'], ['right', 'Right of the path']];
const ACTIONS = [['banner', 'Caption'], ['glint', 'Glint (the hit effect)'], ['shake', 'Screen shake'], ['fade', 'Fade to black and back'], ['jolt', "A wall's jolt"], ['chips', 'Stone chips'], ['closeUp', 'Close-up (hide the number badges)']];
const WALL_SPOTS = ['dragon.hit1', 'dragon.hit2', 'dragon.hit3', 'dragon.hit4', 'dragon.hit5', 'gate.hit1', 'gate.hit2', 'gate.hit3', 'gate.hit4', 'gate.hit5', 'gate.break'];
const COLORS = { builtin: '#5b6b7c', camera: '#2f8f6a', fx: '#a86a2c', anim: '#7a4a9c', face: '#c2843a' };
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (f) => { const s = f / FPS; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } } };
const blankSeq = (key) => ({ key, v: 2, builtin: [], miis: [], camera: [], fx: [] });
const hasAnything = (s) => !!(s && (s.len > 0 || s.builtin.length || s.fx.length || s.camera.length || s.miis.some((m) => m.anim.length || m.face.length)));

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

const CSS = `
#studio{position:fixed;inset:0;z-index:30;display:grid;color:#e6edf5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.35;pointer-events:none;
 grid-template-columns:var(--left) var(--sl) minmax(0,1fr) var(--sr) var(--right);grid-template-rows:auto minmax(0,1fr) .4em var(--bottom);
 grid-template-areas:"top top top top top" "left sl view sr right" "sb sb sb sb sb" "tl tl tl tl tl"}
#studio *{box-sizing:border-box}
#studio .p{pointer-events:auto;background:#152231;min-width:0;min-height:0}
#studio button{font:inherit;color:#fff;background:#2b4a6a;border:0;border-radius:.45em;padding:.38em .7em;cursor:pointer;white-space:nowrap}
#studio button:hover{filter:brightness(1.18)}#studio button:disabled{opacity:.45;cursor:default;filter:none}
#studio button.on{background:#3b7bd6;box-shadow:inset 0 0 0 .12em #9cc4ff}
#studio button.go{background:#2f7d4a}#studio button.warn{background:#8a3a3a}#studio button.soft{background:#2a3a4c}
#studio input,#studio select,#studio textarea{font:inherit;color:#111;background:#f2f5f8;border:0;border-radius:.4em;padding:.3em .45em;min-width:0}
#studio .top{grid-area:top;display:flex;flex-wrap:wrap;gap:.4em;align-items:center;padding:.45em .6em;background:#0f1a26;border-bottom:1px solid #fff1}
#studio .top .title{font-weight:700;font-size:1.1em;margin-right:.4em}
#studio .top .moment{font-weight:600;opacity:.95;flex:1 1 6em;min-width:4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#studio .sep{width:1px;align-self:stretch;background:#fff2;margin:0 .2em}
#studio .left{grid-area:left;display:flex;flex-direction:column;border-right:1px solid #fff1}
#studio .right{grid-area:right;overflow:auto;padding:.7em;display:flex;flex-direction:column;gap:.55em;border-left:1px solid #fff1}
#studio .right>*{flex-shrink:0}
#studio .field input,#studio .field select,#studio .two>input,#studio .two>select{width:100%}
#studio .two>*{min-width:0}
#studio .split{pointer-events:auto;background:#0c1520;cursor:col-resize}#studio .split:hover,#studio .split.drag{background:#3b7bd6}
#studio .sl{grid-area:sl}#studio .sr{grid-area:sr}#studio .sb{grid-area:sb;cursor:row-resize}
#studio .view{grid-area:view;display:flex;flex-direction:column;pointer-events:none;min-width:0;min-height:0}
#studio .view .ov{pointer-events:auto}
#studio .vbar{pointer-events:auto;display:flex;flex-wrap:wrap;gap:.35em;align-items:center;padding:.35em .5em;background:#0f1a26;border-bottom:1px solid #fff1}
#studio .vpic{position:relative;flex:1;min-height:0}
#studio .seg{display:flex;border-radius:.5em;overflow:hidden}
#studio .seg button{border-radius:0;background:#203247}
#studio .vhint{display:flex;flex-wrap:wrap;gap:.35em;align-items:center;font-size:.92em}
#studio .chip{background:#0c1520d9;border-radius:.5em;padding:.25em .55em;font-size:.88em;white-space:nowrap}
#studio .vnote{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#0c1520e6;padding:.8em 1.1em;border-radius:.7em;text-align:center;max-width:80%}
#studio .search{margin:.55em;}
#studio .mlist{flex:1;overflow:auto;padding:0 .4em .6em}
#studio .mgroup{font-weight:700;font-size:.82em;text-transform:uppercase;letter-spacing:.05em;opacity:.65;margin:.8em .3em .3em}
#studio .mitem{display:block;width:100%;text-align:left;background:transparent;border-radius:.45em;padding:.38em .5em;white-space:normal}
#studio .mitem:hover{background:#ffffff12}#studio .mitem.cur{background:#3b7bd6}
#studio .mitem small{opacity:.65}
#studio .tl{grid-area:tl;display:flex;flex-direction:column;border-top:1px solid #fff1;background:#101b27}
#studio .transport{display:flex;flex-wrap:wrap;gap:.35em;align-items:center;padding:.4em .6em;border-bottom:1px solid #fff1}
#studio .clock{font-variant-numeric:tabular-nums;background:#0a121b;border-radius:.4em;padding:.3em .6em;min-width:13em;text-align:center}
#studio .tscroll{flex:1;overflow:auto;position:relative}
#studio .tinner{position:relative;min-height:100%}
#studio .row{display:flex;align-items:stretch;flex-wrap:nowrap;gap:0;justify-content:flex-start;height:2.15em;border-bottom:1px solid #ffffff0d}
#studio .row.mii{height:1.7em;background:#ffffff07}
#studio .lab{position:sticky;left:0;z-index:3;width:var(--lab);flex:none;display:flex;align-items:center;gap:.35em;padding:0 .5em;background:#132131;border-right:1px solid #fff1;font-size:.92em;overflow:hidden;white-space:nowrap}
#studio .lab .plus{margin-left:auto;padding:.05em .45em;background:#ffffff1c}
#studio .lane{position:relative;flex:1}
#studio .ruler{height:1.9em;background:#0c1520;cursor:ew-resize}
#studio .tick{position:absolute;top:0;bottom:0;border-left:1px solid #fff2;font-size:.75em;padding-left:.2em;opacity:.75;pointer-events:none}
#studio .blk{position:absolute;top:.22em;bottom:.22em;border-radius:.4em;font-size:.85em;padding:.18em .45em;overflow:hidden;white-space:nowrap;cursor:grab;box-shadow:inset 0 0 0 1px #ffffff26}
#studio .blk.rec{background-image:repeating-linear-gradient(45deg,#ffffff24 0 .4em,transparent .4em .8em)!important;opacity:.78}
#studio .blk.sel{box-shadow:inset 0 0 0 .14em #fff,0 0 .6em #9cc4ff}
#studio .blk .g{position:absolute;top:0;bottom:0;width:.55em;cursor:ew-resize}#studio .blk .g.l{left:0}#studio .blk .g.r{right:0}
#studio .blk .g:hover{background:#ffffff40}
#studio .key{position:absolute;top:50%;width:1em;height:1em;margin:-.5em 0 0 -.5em;transform:rotate(45deg);background:#5fe0b0;border:.12em solid #0c1520;cursor:grab;z-index:2}
#studio .key.own,#studio .key.normal{background:#9aa9b8}#studio .key.sel{background:#fff;box-shadow:0 0 .6em #9cc4ff}
#studio .seg-line{position:absolute;top:50%;height:.18em;margin-top:-.09em;background:#5fe0b0;opacity:.7;pointer-events:none}
#studio .seg-line.linear{background:repeating-linear-gradient(90deg,#5fe0b0 0 .5em,transparent .5em .8em)}
#studio .seg-line.hold{background:#5fe0b055;height:.5em;margin-top:-.25em;border-radius:.2em}
#studio .head{position:absolute;top:0;bottom:0;width:2px;background:#ff5a5a;z-index:5;pointer-events:none}
#studio .head:before{content:"";position:absolute;top:0;left:-.45em;border:.45em solid transparent;border-top:.6em solid #ff5a5a}
#studio .endm{position:absolute;top:0;bottom:0;width:2px;background:#ffd84a;z-index:4;cursor:ew-resize}
#studio .endm.auto{background:#ffd84a77}
#studio .endm:after{content:"end";position:absolute;top:0;left:.25em;font-size:.72em;color:#ffd84a}
#studio .shade{position:absolute;top:0;bottom:0;background:#0007;z-index:1;pointer-events:none}
#studio .insp h3{margin:0;font-size:1.05em}
#studio .insp .hint{opacity:.72;font-size:.9em}
#studio .field{display:flex;flex-direction:column;gap:.2em}
#studio .field>span{opacity:.75;font-size:.88em}
#studio .two{display:grid;grid-template-columns:1fr 1fr;gap:.45em}
#studio .btns{display:flex;flex-wrap:wrap;gap:.3em}
#studio .faces{display:grid;grid-template-columns:repeat(auto-fill,minmax(6.5em,1fr));gap:.35em}
#studio .faces button{display:flex;flex-direction:column;align-items:center;gap:.1em;padding:.45em .3em;background:#24384d;white-space:normal}
#studio .faces button b{font-size:1.7em;line-height:1}
#studio .clips{height:13em;overflow:auto;background:#0b141e;border-radius:.45em;padding:.25em}
#studio .clips button{display:block;width:100%;text-align:left;background:transparent;padding:.22em .4em;font-size:.9em}
#studio .clips button:hover{background:#ffffff14}#studio .clips button.cur{background:#7a4a9c}
#studio .modal{position:fixed;inset:0;background:#0009;display:grid;place-items:center;pointer-events:auto;z-index:5}
#studio .modal>div{background:#152231;border-radius:.8em;padding:1em;width:min(46em,92vw);max-height:86vh;display:flex;flex-direction:column;gap:.6em}
#studio .modal textarea{height:20em;font:.82em monospace}
#studio .toast{position:absolute;left:50%;bottom:1em;transform:translateX(-50%);background:#0c1520f0;padding:.5em .9em;border-radius:.6em;pointer-events:none;transition:opacity .3s}
#studio kbd{background:#ffffff1f;border-radius:.3em;padding:0 .35em;font:inherit;font-size:.85em}
#ui.studio-hud *{visibility:hidden}#ui.studio-hud #banner,#ui.studio-hud #banner *,#ui.studio-hud #fade,#ui.studio-hud #fade *{visibility:visible}
`;

export class StudioScene extends ViewerScene {
  constructor(opts = {}) { super(); this.startKey = opts.key || null; this.from = opts.from || 'menu'; }

  enter() {
    super.enter();
    if (this.broken) return;
    this.demos(); // (the previews: this.momentDemos)
    this.moments = allMoments();
    const L = store.get(LAYOUT) || {};
    this.lay = { left: 16, right: 22, bottom: 24, scale: 1, showLeft: true, showRight: true, zoom: 2.2, ...L };
    this.key = null; this.seq = null; this.ph = 0; this.sel = null; this.undoStack = []; this.redoStack = []; this.playing = false; this.loop = false; this.speed = 1;
    this.inner = 0; this.anchor = null; this.cast = null; this.ready = false; this.held = new Set();
    app.ui.classList.add('studio-hud'); app.ui.style.pointerEvents = 'none';
    this.buildUi();
    this.applyLayout();
    loadMoreClips().then(() => { if (this.sel && this.sel.list === 'anim') this.inspect(); });
  }

  exit() {
    for (const [t, f, o] of this.studioHandlers || []) removeEventListener(t, f, o);
    if (this.ro) this.ro.disconnect();
    if (this.root) this.root.remove();
    if (this.styleEl) this.styleEl.remove();
    app.ui.classList.remove('studio-hud'); app.ui.style.pointerEvents = '';
    this.seqEdit = null; this.seqRecord = null; this.seqPaused = false; this.seqFreeCam = false; this.slow = 1;
    super.exit();
  }

  buildViewerUi() {} // (the island viewer's panel: not here)

  // ===================================================================== the screen
  buildUi() {
    this.styleEl = h('style', { text: CSS }); document.head.appendChild(this.styleEl);
    const B = (label, fn, cls = '', title = '') => h('button', { class: cls, title, onclick: fn, text: label });
    // the top bar
    this.momentName = h('span', { class: 'moment' });
    this.undoBtn = B('↶ Undo', () => this.undo(), 'soft', 'Undo (Ctrl+Z)');
    this.redoBtn = B('↷ Redo', () => this.redo(), 'soft', 'Redo (Ctrl+Shift+Z)');
    this.saved = h('span', { class: 'chip', style: 'background:transparent;opacity:.8' });
    this.leftBtn = B('☰ Moments', () => { this.lay.showLeft = !this.lay.showLeft; this.applyLayout(); }, '', 'Show or hide the list of moments');
    this.rightBtn = B('⚙ Details', () => { this.lay.showRight = !this.lay.showRight; this.applyLayout(); }, '', 'Show or hide the details panel');
    this.scaleLabel = h('span', { class: 'chip', style: 'min-width:3.6em;text-align:center' });
    const top = h('div', { class: 'p top' },
      B(this.from === 'viewer' ? '← Island viewer' : '← Menu', () => this.leave(), 'soft'),
      h('span', { class: 'title', text: 'Sequence studio' }), this.momentName,
      B('⏺ Record the game', () => this.record(), '', 'Play the moment as the game does it now and turn what each Mii does into blocks you can edit'),
      this.undoBtn, this.redoBtn, this.saved, h('span', { class: 'sep' }),
      B('⇄ Export', () => this.exportBox(), 'soft', 'Every moment you changed, as text: send it to put it in the game for everyone'),
      B('Reset', () => this.resetMoment(), 'warn', "Throw away your changes to this moment (back to the game's own)"),
      h('span', { class: 'sep' }), this.leftBtn, this.rightBtn,
      B('A−', () => this.setScale(this.lay.scale / 1.1), 'soft', 'Make everything smaller'), this.scaleLabel, B('A+', () => this.setScale(this.lay.scale * 1.1), 'soft', 'Make everything bigger'),
      B('↺', () => this.resetLayout(), 'soft', 'Put the panels back as they were'));
    // the moments
    this.search = h('input', { type: 'search', placeholder: 'Find a moment…', class: 'search', oninput: () => this.fillMoments() });
    this.mlist = h('div', { class: 'mlist' });
    const left = h('div', { class: 'p left' }, this.search, this.mlist);
    // the picture
    this.camSeg = { seq: B('🎬 Sequence camera', () => this.setFreeCam(false), '', 'See it through the sequence’s camera, as a game shows it'), free: B('🕹 Free camera', () => this.setFreeCam(true), '', 'Move the camera yourself: drag to turn, right-drag (or Shift) to slide, wheel to zoom, W A S D / Q E to fly') };
    this.keyBtn = B('◆ Add camera keyframe', () => this.addCameraKey(), 'go', 'Put where the camera is now on the timeline, at the red line (K)');
    this.vhint = h('div', { class: 'vhint' });
    this.vnote = h('div', { class: 'vnote ov', style: 'display:none' });
    this.toastEl = h('div', { class: 'toast', style: 'opacity:0' });
    this.picEl = h('div', { class: 'vpic' }, this.vnote, this.toastEl);
    this.viewEl = h('div', { class: 'view' }, h('div', { class: 'vbar' }, h('div', { class: 'seg' }, this.camSeg.seq, this.camSeg.free), this.keyBtn, this.vhint), this.picEl);
    // details
    this.insp = h('div', { class: 'p right insp' });
    // the timeline
    this.playBtn = B('▶ Play', () => this.togglePlay(), 'go', 'Play / pause (Space)');
    this.clock = h('span', { class: 'clock' });
    this.loopBtn = B('🔁 Loop', () => { this.loop = !this.loop; this.loopBtn.classList.toggle('on', this.loop); }, 'soft', 'Play it over and over');
    this.speedBtn = B('Speed 1×', () => { const s = [1, 0.5, 0.25, 2]; this.speed = s[(s.indexOf(this.speed) + 1) % s.length]; this.speedBtn.textContent = `Speed ${this.speed}×`; this.slow = this.speed; }, 'soft', 'Playback speed');
    const transport = h('div', { class: 'transport' },
      B('⏮', () => this.seek(0), 'soft', 'To the start (Home)'), B('◀', () => this.seek(this.ph - 1), 'soft', 'One frame back (←; Shift: 10)'), this.playBtn,
      B('▶', () => this.seek(this.ph + 1), 'soft', 'One frame on (→; Shift: 10)'), B('⏭', () => this.seek(this.total() - 0.01), 'soft', 'To the end (End)'),
      this.clock, this.loopBtn, this.speedBtn, h('span', { class: 'sep' }),
      B('−', () => this.setZoom(this.lay.zoom / 1.25), 'soft', 'Zoom the timeline out (Ctrl+wheel)'), B('+', () => this.setZoom(this.lay.zoom * 1.25), 'soft', 'Zoom the timeline in (Ctrl+wheel)'), B('Fit', () => this.fitZoom(), 'soft', 'Fit the whole moment'),
      h('span', { class: 'hint', style: 'opacity:.6;margin-left:.4em;font-size:.88em', text: 'Double-click a track to add something there · drag to move · drag an edge to trim' }));
    this.tscroll = h('div', { class: 'tscroll' });
    const tl = h('div', { class: 'p tl' }, transport, this.tscroll);
    // the bars between them (drag to resize)
    this.splits = { sl: h('div', { class: 'split sl', title: 'Drag to resize' }), sr: h('div', { class: 'split sr', title: 'Drag to resize' }), sb: h('div', { class: 'split sb', title: 'Drag to resize' }) };
    this.root = h('div', { id: 'studio' }, top, left, this.splits.sl, this.viewEl, this.splits.sr, this.insp, this.splits.sb, tl);
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); }); // (so Space plays, not the last button pressed)
    this.studioHandlers = [];
    this.bindSplits();
    this.bindKeys();
    this.bindViewport();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.layoutViewport()); this.ro.observe(this.picEl); }
    this.tscroll.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.setZoom(this.lay.zoom * Math.exp(-e.deltaY * 0.002), e.clientX); } }, { passive: false });
    this.fillMoments();
    this.setFreeCam(false);
  }

  /** The panels' sizes, what is shown, the size of everything; kept for next time. */
  applyLayout() {
    const L = this.lay, r = this.root.style;
    L.scale = clamp(L.scale, 0.6, 2.2);
    r.fontSize = `${13 * L.scale}px`;
    r.setProperty('--left', L.showLeft ? `${clamp(L.left, 10, 40)}em` : '0px');
    r.setProperty('--right', L.showRight ? `${clamp(L.right, 14, 45)}em` : '0px');
    r.setProperty('--sl', L.showLeft ? '.4em' : '0px');
    r.setProperty('--sr', L.showRight ? '.4em' : '0px');
    r.setProperty('--bottom', `${clamp(L.bottom, 8, 60)}em`);
    r.setProperty('--lab', '13em');
    this.root.querySelector('.left').style.display = L.showLeft ? '' : 'none';
    this.insp.style.display = L.showRight ? '' : 'none';
    this.splits.sl.style.display = L.showLeft ? '' : 'none'; this.splits.sr.style.display = L.showRight ? '' : 'none';
    this.leftBtn.classList.toggle('on', L.showLeft); this.rightBtn.classList.toggle('on', L.showRight);
    this.scaleLabel.textContent = `${Math.round(L.scale * 100)}%`;
    store.set(LAYOUT, L);
    this.layoutViewport();
    if (this.seq) this.draw();
  }
  setScale(s) { this.lay.scale = Math.round(clamp(s, 0.6, 2.2) * 100) / 100; this.applyLayout(); }
  resetLayout() { this.lay = { left: 16, right: 22, bottom: 24, scale: 1, showLeft: true, showRight: true, zoom: 2.2 }; this.applyLayout(); }
  get em() { return 13 * this.lay.scale; }

  bindSplits() {
    const drag = (el, fn) => {
      el.onpointerdown = (e) => {
        e.preventDefault(); el.classList.add('drag');
        const x0 = e.clientX, y0 = e.clientY, start = { ...this.lay };
        const mv = (m) => { fn(m.clientX - x0, m.clientY - y0, start); this.applyLayout(); };
        const up = () => { el.classList.remove('drag'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      };
    };
    drag(this.splits.sl, (dx, dy, s) => { this.lay.left = s.left + dx / this.em; });
    drag(this.splits.sr, (dx, dy, s) => { this.lay.right = s.right - dx / this.em; });
    drag(this.splits.sb, (dx, dy, s) => { this.lay.bottom = s.bottom - dy / this.em; });
  }

  /** The game's picture fills the middle, at the game's own 16:9 shape (so a shot frames as it will in a game). */
  layoutViewport() {
    if (!this.picEl || !this.renderer) return;
    const r = this.picEl.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const k = Math.min(r.width / VIRTUAL.w, r.height / VIRTUAL.h), w = Math.round(VIRTUAL.w * k), hh = Math.round(VIRTUAL.h * k);
    const x = Math.round(r.left + (r.width - w) / 2), y = Math.round(r.top + (r.height - hh) / 2);
    this.vp = { x, y, w, h: hh };
    app.canvas3d.style.cssText = `display:block;position:fixed;inset:auto;left:${x}px;top:${y}px;width:${w}px;height:${hh}px;`;
    app.ui.style.cssText = `inset:auto;position:fixed;left:${x}px;top:${y}px;width:${VIRTUAL.w}px;height:${VIRTUAL.h}px;transform:scale(${k});transform-origin:0 0;pointer-events:none;`;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, w), Math.max(1, hh), false);
    this.camera.aspect = VIRTUAL.w / VIRTUAL.h; this.camera.updateProjectionMatrix();
  }
  resize() { if (this.vp) this.layoutViewport(); else super.resize(); }
  onResize() { this.layoutViewport(); }

  leave() { if (this.from === 'viewer' && app.openViewer) app.openViewer(); else app.go('menu'); }

  toast(t) { this.toastEl.textContent = t; this.toastEl.style.opacity = '1'; clearTimeout(this.toastT); this.toastT = setTimeout(() => { this.toastEl.style.opacity = '0'; }, 2200); }

  // ===================================================================== the moments
  fillMoments() {
    const q = this.search.value.trim().toLowerCase(), mine = localSequences();
    this.mlist.textContent = '';
    let g = null;
    for (const m of this.moments) {
      if (q && !(`${m.title} ${m.key} ${m.group}`.toLowerCase().includes(q))) continue;
      if (m.group !== g) { g = m.group; this.mlist.appendChild(h('div', { class: 'mgroup', text: g })); }
      const tag = mine[m.key] ? '✎ changed' : SEQUENCES[m.key] ? '● in the game' : '';
      const nop = this.momentDemos && this.momentDemos[m.key] ? '' : 'no preview';
      const b = h('button', { class: `mitem${m.key === this.key ? ' cur' : ''}`, onclick: () => this.open(m.key), title: m.key },
        m.title, (tag || nop) ? h('div', {}, h('small', { text: [tag, nop].filter(Boolean).join(' · ') })) : null);
      this.mlist.appendChild(b);
      if (m.key === this.key) this.curItem = b;
    }
  }

  open(key) {
    this.cleanupRun();
    this.key = key; this.ph = 0; this.sel = null; this.undoStack = []; this.redoStack = []; this.anchor = null; this.cast = null; this.inner = 0;
    const saved = localSequences()[key] || SEQUENCES[key];
    this.seq = saved ? upgradeSequence(clone(saved)) : blankSeq(key);
    this.seq.key = key; this.padMiis();
    const m = this.moments.find((x) => x.key === key);
    this.momentName.textContent = m ? m.title : key;
    store.set(LAYOUT, { ...this.lay, last: key }); this.lay.last = key;
    this.fillMoments();
    if (this.curItem && this.curItem.scrollIntoView) this.curItem.scrollIntoView({ block: 'nearest' });
    this.savedState();
    this.vnote.style.display = this.previewFn ? 'none' : '';
    this.vnote.textContent = this.previewFn ? '' : 'There is no preview of this moment here (it plays in a game). You can still set it up on the timeline.';
    this.draw(); this.inspect();
    if (this.previewFn) this.seek(0); // (the picture: its first frame)
  }

  /** At least a Mii track for everyone the moment has (the cast). */
  padMiis() { const n = Math.max(castOf(this.key).length, this.seq.miis.length, 1); while (this.seq.miis.length < n) this.seq.miis.push({ anim: [], face: [] }); for (const m of this.seq.miis) { m.anim ||= []; m.face ||= []; } }

  get previewFn() { return this.momentDemos && this.momentDemos[this.key]; }
  total() { return Math.max(30, sequenceFrames(this.seq, this.inner || 120)); }

  // ===================================================================== playing
  /** Stop whatever the preview was playing, and tidy up after it. */
  cleanupRun() {
    this.playing = false; this.simulating = false;
    this.seqRecord = null;
    const a = this.anim;
    this.anim = null; this.demo = [];
    if (a && a.end) { try { a.end(); } catch (e) { /* */ } }
    this.camHold = null; this.shake = 0; this.hidePawns = false; this.closeUp = false;
    try { this.clearBanner(); } catch (e) { /* */ }
    const f = document.querySelector('#fade'); if (f) f.style.opacity = '0';
    if (this.fx) { try { this.fx.release(); } catch (e) { /* */ } }
    if (this.playBtn) this.playBtn.textContent = '▶ Play';
  }

  /** Start the moment's preview from the very beginning (its lead-in, then the moment). */
  startRun(seq = this.seq) {
    const d = this.previewFn;
    if (!d) return false;
    this.cleanupRun();
    this.seqPaused = false; this.slow = this.speed;
    this.seqEdit = { key: this.key, seq };
    d();
    return true;
  }

  togglePlay() { if (this.playing) this.pause(); else this.play(); }

  play() {
    if (!this.previewFn) { this.toast('No preview of this moment here.'); return; }
    const a = this.anim, inMoment = a && a.moment === this.key && this.seqEdit && !this.seqEdit.done;
    if (!inMoment || this.ph >= this.total() - 0.5) { this.startRun(); }
    this.seqPaused = false; this.slow = this.speed; this.playing = true;
    this.playBtn.textContent = '⏸ Pause';
  }
  pause() { this.playing = false; this.seqPaused = true; this.playBtn.textContent = '▶ Play'; }

  /** Show frame F: replay the moment up to there (quickly, without drawing), and stop. */
  seek(F) {
    F = clamp(Math.round(F * 100) / 100, 0, this.total() - 0.01);
    this.ph = F;
    if (!this.previewFn) { this.drawHead(); return; }
    const a = this.anim, e = this.seqEdit;
    const canGoOn = a && a.moment === this.key && e && !e.done && e.T != null && e.T <= F && e.seq === this.seq;
    if (!canGoOn) { if (!this.startRun()) return; }
    this.simulate(F);
    this.pause();
    this.drawHead();
  }

  simulate(F) {
    const dt = 1 / FPS;
    this.simulating = true; this.seqPaused = false; this.slow = 1;
    for (let i = 0; i < 9000; i++) {
      const a = this.anim, e = this.seqEdit;
      if (a && a.moment === this.key && e && e.T != null && e.T >= F - 1e-6) break;
      if (!a && !this.demo.length && i > 0) break;
      this.t += dt; this.tickAnim(dt);
      if (this.fx) this.fx.update(dt);
    }
    const a = this.anim;
    if (a && a.moment === this.key && a.step) { a.t = F * 1000 / FPS; a.step(Math.min(1, a.t / Math.max(1, a.dur))); }
    this.readEdit();
    this.updatePawnPose(dt);
    this.simulating = false; this.slow = this.speed;
  }

  readEdit() {
    const e = this.seqEdit;
    if (e && e.T != null) { this.anchor = e.anchor; this.cast = e.cast; if (e.innerFrames && e.innerFrames !== this.inner) { this.inner = e.innerFrames; this.draw(); if (!this.sel) this.inspect(); } }
  }

  /** Each frame, from the scene: follow the playhead, stop at the end. */
  onTick() {
    if (!this.ready && this.board && this.pawns && this.pawns[0]) {
      this.ready = true;
      const want = this.startKey && this.moments.some((m) => m.key === this.startKey) ? this.startKey : this.lay.last && this.moments.some((m) => m.key === this.lay.last) ? this.lay.last : 'minigame.duel';
      setTimeout(() => this.open(want), 0); // (after this frame: not in the middle of the scene's update)
    }
    if (this.simulating || !this.key) return;
    const e = this.seqEdit, a = this.anim;
    if (a && a.moment === this.key && e && e.T != null) { this.ph = e.T; this.readEdit(); }
    if (e && e.done && (this.playing || this.recording)) {
      e.done = false;
      if (this.recording) return; // (the recording's own end does the rest)
      this.demo = [];
      if (this.loop && this.playing) { this.startRun(); this.playing = true; this.playBtn.textContent = '⏸ Pause'; return; }
      this.playing = false; this.seek(this.total() - 0.01);
    }
    this.drawHead();
  }

  /** The camera: the sequence's (as a game shows it), or yours to move. */
  setFreeCam(on) {
    if (on && !this.seqFreeCam && this.camera) { // (start from where the camera is)
      const c = this.camera, o = this.orbit, dir = c.getWorldDirection(new c.position.constructor());
      const p = this.pawns && this.pawns[(this.cast || [0])[0]], d = p ? clamp(Math.hypot(p.x - c.position.x, p.y + 1 - c.position.y, p.z - c.position.z), 3, 250) : 12; // (turn round the Mii in the shot)
      o.tx = c.position.x + dir.x * d; o.ty = c.position.y + dir.y * d; o.tz = c.position.z + dir.z * d; o.dist = d;
      o.pitch = Math.asin(clamp(-dir.y, -1, 1)); o.yaw = Math.atan2(-dir.x, -dir.z);
    }
    this.seqFreeCam = !!on;
    this.camSeg.seq.classList.toggle('on', !on); this.camSeg.free.classList.toggle('on', !!on);
    this.vhint.textContent = '';
    const chip = (t) => this.vhint.appendChild(h('span', { class: 'chip', html: t }));
    if (on) chip('Drag: turn · right-drag: slide · wheel: zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <kbd>Q</kbd><kbd>E</kbd>: fly');
    else chip('As a game shows it. Drag the picture to move the camera yourself.');
    this.showCast();
  }

  /** Who is who in the picture (Mii 1 = ...). */
  showCast() {
    if (!this.cast || !this.vhint) return;
    const roles = castOf(this.key);
    this.seq.miis.forEach((_, i) => {
      const s = this.cast[i]; if (s == null) return;
      const c = PLAYER_COLORS[s] || PLAYER_COLORS[0];
      this.vhint.appendChild(h('span', { class: 'chip', style: `border-left:.4em solid ${c.hex}`, title: roles[i] || '', text: `Mii ${i + 1}: ${this.nameOf(s)}` }));
    });
  }

  updateCamera(dt = 1 / 60) {
    if (this.seqFreeCam && this.held.size) { // fly
      const o = this.orbit, sp = Math.max(6, o.dist * 0.9) * dt * (this.held.has('shift') ? 3 : 1);
      const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), rx = -fz, rz = fx;
      if (this.held.has('w')) { o.tx += fx * sp; o.tz += fz * sp; }
      if (this.held.has('s')) { o.tx -= fx * sp; o.tz -= fz * sp; }
      if (this.held.has('d')) { o.tx += rx * sp; o.tz += rz * sp; }
      if (this.held.has('a')) { o.tx -= rx * sp; o.tz -= rz * sp; }
      if (this.held.has('e')) o.ty += sp;
      if (this.held.has('q')) o.ty -= sp;
    }
    super.updateCamera(dt);
  }

  bindOrbit() {} // (the studio's own, below: only in the picture)
  lookAt(v) { if (!this.seqFreeCam) super.lookAt(v); } // (the camera you are placing stays put when the preview starts again)
  bindViewport() {
    let drag = null;
    const inView = (e) => this.vp && e.clientX >= this.vp.x && e.clientX <= this.vp.x + this.vp.w && e.clientY >= this.vp.y && e.clientY <= this.vp.y + this.vp.h && !(e.target.closest && e.target.closest('#studio .ov, #studio .p'));
    const down = (e) => {
      if (!inView(e)) return;
      e.preventDefault();
      if (!this.seqFreeCam) { this.setFreeCam(true); this.toast('Free camera: move it where you want, then ◆ Add camera keyframe (K).'); }
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, o = this.orbit; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = o.dist * 0.0022 * (1280 / Math.max(300, this.vp.w)), cx = Math.cos(o.yaw), sx = Math.sin(o.yaw), sp = Math.sin(o.pitch);
        o.tx += (-dx * cx - dy * sx * sp) * k; o.tz += (dx * sx - dy * cx * sp) * k; o.ty += dy * Math.cos(o.pitch) * k;
      } else { o.yaw -= dx * 0.005; o.pitch = clamp(o.pitch + dy * 0.004, -1.45, 1.5); }
    };
    const up = () => { drag = null; };
    const wheel = (e) => { if (!inView(e)) return; e.preventDefault(); if (!this.seqFreeCam) this.setFreeCam(true); this.orbit.dist = clamp(this.orbit.dist * Math.exp(e.deltaY * 0.0012), 0.5, 600); };
    const hs = [['pointerdown', down, true], ['pointermove', move, true], ['pointerup', up, true], ['wheel', wheel, { capture: true, passive: false }]];
    for (const [t, f, o] of hs) addEventListener(t, f, o);
    this.studioHandlers.push(...hs);
  }

  bindKeys() {
    const typing = (e) => /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '');
    const kd = (e) => {
      if (!this.root.isConnected || typing(e) || this.root.querySelector('.modal')) { if (e.key === 'Escape') { const m = this.root.querySelector('.modal'); if (m) m.remove(); } return; }
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (ctrl && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (ctrl && k === 'd') { e.preventDefault(); this.duplicate(); return; }
      if (ctrl && k === 'c') { if (this.sel) { this.clip = clone(this.selItem()); this.clipKind = this.sel; this.toast('Copied.'); } return; }
      if (ctrl && k === 'v') { e.preventDefault(); this.paste(); return; }
      if (ctrl) return;
      if (this.seqFreeCam && 'wasdqe'.includes(k) && k.length === 1) { e.preventDefault(); this.held.add(k); if (e.shiftKey) this.held.add('shift'); return; }
      if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.seek(this.ph - (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.seek(this.ph + (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'Home') { e.preventDefault(); this.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); this.seek(this.total() - 0.01); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel) { e.preventDefault(); this.removeSel(); } }
      else if (e.key === 'Escape') { this.select(null); }
      else if (k === 'k') { e.preventDefault(); this.addCameraKey(); }
      else if (k === 'f') { e.preventDefault(); this.setFreeCam(!this.seqFreeCam); }
    };
    const ku = (e) => { const k = e.key.toLowerCase(); this.held.delete(k); if (e.key === 'Shift') this.held.delete('shift'); };
    const blur = () => this.held.clear();
    const hs = [['keydown', kd, true], ['keyup', ku, true], ['blur', blur, false]];
    for (const [t, f, o] of hs) addEventListener(t, f, o);
    this.studioHandlers.push(...hs);
  }

  // ===================================================================== changing things (undo, saving)
  /** Call before changing the sequence: what to go back to. */
  commit() { this.undoStack.push(JSON.stringify(this.seq)); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; }
  /** Call after changing it: saved, drawn, and the picture shows it. */
  changed({ redraw = true, inspect = true } = {}) {
    const all = localSequences();
    if (hasAnything(this.seq)) all[this.key] = clone(this.seq); else delete all[this.key];
    const ok = saveLocalSequences(all);
    this.savedState(ok);
    if (redraw) this.draw();
    if (inspect) this.inspect();
    this.fillMomentsSoon();
    this.refreshSoon();
  }
  savedState(ok = true) {
    this.undoBtn.disabled = !this.undoStack.length; this.redoBtn.disabled = !this.redoStack.length;
    const mine = localSequences()[this.key];
    this.saved.textContent = !ok ? '⚠ Could not save (this browser blocks storage)' : mine ? '✓ Saved in this browser' : SEQUENCES[this.key] ? 'The game’s own sequence' : 'Not changed yet';
  }
  fillMomentsSoon() { clearTimeout(this.fmT); this.fmT = setTimeout(() => this.fillMoments(), 300); }
  /** The picture again at the playhead (after a change), when it isn't playing. */
  refreshSoon() { clearTimeout(this.rfT); this.rfT = setTimeout(() => { if (!this.playing && !this.recording && this.previewFn) { const T = this.ph; this.startRun(); this.simulate(T); this.ph = T; this.pause(); this.drawHead(); } }, 120); }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.seq)); this.seq = JSON.parse(this.undoStack.pop()); this.padMiis(); this.sel = null; this.changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.seq)); this.seq = JSON.parse(this.redoStack.pop()); this.padMiis(); this.sel = null; this.changed(); }

  resetMoment() {
    if (!this.resetArmed) { this.resetArmed = true; this.toast('Press Reset again to throw away your changes to this moment.'); setTimeout(() => { this.resetArmed = false; }, 3000); return; }
    this.resetArmed = false;
    this.commit();
    const all = localSequences(); delete all[this.key]; saveLocalSequences(all);
    this.seq = SEQUENCES[this.key] ? upgradeSequence(clone(SEQUENCES[this.key])) : blankSeq(this.key); this.padMiis(); this.sel = null;
    this.draw(); this.inspect(); this.savedState(); this.fillMoments(); this.refreshSoon();
    this.toast("Back to the game's own. (Undo brings your changes back.)");
  }

  // ===================================================================== what is picked
  /** sel: { list: 'builtin'|'fx'|'anim'|'face'|'camera', mii, item } */
  listOf(sel) { if (!sel) return null; if (sel.list === 'anim' || sel.list === 'face') return this.seq.miis[sel.mii][sel.list]; return this.seq[sel.list]; }
  selItem() { return this.sel && this.sel.item; }
  select(sel) {
    if (this.sel === sel) return;
    this.sel = sel;
    for (const el of this.root.querySelectorAll('#studio .blk.sel, #studio .key.sel')) el.classList.remove('sel'); // (no redraw: a double-click's second click must find the same track)
    if (sel && sel.el) sel.el.classList.add('sel');
    this.inspect();
  }
  removeSel() {
    const L = this.listOf(this.sel); if (!L) return;
    this.commit(); const i = L.indexOf(this.sel.item); if (i >= 0) L.splice(i, 1); this.sel = null; this.changed();
  }
  duplicate() {
    const L = this.listOf(this.sel); if (!L) return;
    this.commit(); const c = clone(this.sel.item); delete c.rec; c.at = this.sel.list === 'camera' ? c.at + 30 : c.at + Math.max(1, c.len || 30); L.push(c); this.sel = { ...this.sel, item: c }; this.changed();
  }
  paste() {
    if (!this.clip || !this.clipKind) return;
    const sel = this.sel && this.sel.list === this.clipKind.list ? this.sel : this.clipKind, L = this.listOf(sel); if (!L) return;
    this.commit(); const c = clone(this.clip); c.at = Math.round(this.ph); delete c.rec; L.push(c); this.sel = { ...sel, item: c }; this.changed();
  }

  /** Add something to a track at frame `at` (double-click, or + at the playhead). */
  addAt(row, at) {
    at = Math.max(0, Math.round(at));
    if (row.list === 'camera') { this.seek(at); this.addCameraKey(); return; }
    this.commit();
    let b;
    if (row.list === 'builtin') b = { at, len: 60, from: Math.round(this.seqEdit && this.seqEdit.B != null ? this.seqEdit.B : at), speed: 0 };
    else if (row.list === 'fx') b = { at, len: 90, action: 'banner', text: 'Caption', where: 'mii1' };
    else if (row.list === 'anim') { const last = this.recentClip || 'pm000_01'; b = { at, len: Math.max(20, clipLength(last) || 60), clip: last, from: 0, speed: 1, facing: 'auto' }; }
    else if (row.list === 'face') b = { at, len: 60, face: this.recentFace ?? 1 };
    this.listOf(row).push(b);
    this.sel = { ...row, item: b };
    this.changed();
    this.toast(row.list === 'anim' ? 'Added. Pick its animation on the right.' : row.list === 'face' ? 'Added. Pick the face on the right.' : 'Added.');
  }

  // ===================================================================== the camera keys
  /** Where a key is kept relative to: the space the moment starts on, or a Mii. */
  keyAnchor(k) {
    const A = this.anchor; if (!A) return null;
    if (k.follow == null) return A;
    const p = this.pawns[(this.cast || [])[k.follow]]; if (!p) return A;
    return { ...A, x: p.fx && p.fx.x != null ? p.fx.x : p.x, y: p.fx && p.fx.y != null ? p.fx.y : p.y, z: p.fx && p.fx.z != null ? p.fx.z : p.z };
  }
  /** Where the camera is now, as a world shot. */
  cameraNow() {
    const c = this.camera, o = this.orbit, dir = c.getWorldDirection(new c.position.constructor()), d = this.seqFreeCam ? o.dist : 12;
    return { x: c.position.x, y: c.position.y, z: c.position.z, tx: c.position.x + dir.x * d, ty: c.position.y + dir.y * d, tz: c.position.z + dir.z * d };
  }
  addCameraKey() {
    if (!this.previewFn) { this.toast('No preview here: nothing to frame.'); return; }
    if (!this.anchor) this.seek(this.ph);
    if (!this.anchor) { this.toast('Play the moment first.'); return; }
    const at = Math.round(this.ph), ks = this.seq.camera, same = ks.find((k) => Math.abs(k.at - at) < 1 && k.kind === 'shot');
    this.commit();
    if (same) { same.shot = shotFromWorld(this.keyAnchor(same), this.cameraNow()); this.sel = { list: 'camera', item: same }; this.toast('Keyframe updated to this view.'); }
    else {
      const k = { at, kind: 'shot', ease: ks.some((q) => q.kind === 'shot' && q.at < at) ? 'smooth' : 'cut', follow: null };
      k.shot = shotFromWorld(this.keyAnchor(k), this.cameraNow());
      ks.push(k); ks.sort((a, b) => a.at - b.at);
      this.sel = { list: 'camera', item: k };
      this.toast(`Camera keyframe at frame ${at}. Move the red line, move the camera, add another: it glides between them.`);
    }
    this.changed();
  }
  /** Look through a key (in the free camera, to change it). */
  lookThrough(k) {
    if (!this.anchor) this.seek(k.at);
    const A = this.keyAnchor(k); if (!A || !k.shot) return;
    this.seek(k.at);
    const w = shotToWorld(A, k.shot), o = this.orbit, dx = w.tx - w.x, dy = w.ty - w.y, dz = w.tz - w.z, d = Math.hypot(dx, dy, dz) || 10;
    this.seqFreeCam = false; this.setFreeCam(true);
    o.tx = w.tx; o.ty = w.ty; o.tz = w.tz; o.dist = d; o.pitch = Math.asin(clamp(-dy / d, -1, 1)); o.yaw = Math.atan2(-dx, -dz);
  }

  // ===================================================================== recording
  record() {
    if (!this.previewFn) { this.toast('No preview of this moment here: nothing to record.'); return; }
    this.startRun(blankSeq(this.key)); // (the game's own, untouched, while it is recorded)
    this.recording = true; this.playBtn.textContent = '⏺ Recording…';
    this.saved.textContent = 'Recording what the game does…';
    this.seqRecord = { key: this.key, done: (got) => {
      this.seqRecord = null; this.recording = false;
      this.commit();
      const S = this.seq;
      if (!S.builtin.some((b) => !b.rec)) S.builtin = got.builtin.map((b) => ({ ...b, rec: true }));
      got.miis.slice(0, S.miis.length).forEach((m, i) => { S.miis[i].anim = [...S.miis[i].anim.filter((b) => !b.rec), ...m.anim]; }); // (the Miis this moment has tracks for)
      this.padMiis();
      this.inner = this.seqEdit && this.seqEdit.innerFrames || this.inner;
      this.demo = []; this.playing = false;
      this.changed();
      this.toast('Recorded. The striped blocks are what the game does now: they play as they are until you change one.');
      setTimeout(() => this.seek(0), 30);
    } };
    this.playing = true; this.seqPaused = false;
  }

  // ===================================================================== the timeline
  rows() {
    const roles = castOf(this.key), out = [
      { list: 'builtin', label: '🎮 Game', tip: "The game's own set piece for this moment: play it, hold it (everyone waits), slow it down" },
      { list: 'camera', label: '🎥 Camera', tip: 'Camera keyframes: the camera glides from one to the next' },
      { list: 'fx', label: '✨ Effects', tip: 'Captions, glints, shaking, fades...' },
    ];
    this.seq.miis.forEach((_, i) => {
      const s = this.cast && this.cast[i], c = s != null ? (PLAYER_COLORS[s] || PLAYER_COLORS[0]).hex : '#8899aa';
      out.push({ header: true, mii: i, label: `Mii ${i + 1}${roles[i] ? ` · ${roles[i]}` : ''}${s != null ? ` (${this.nameOf(s)})` : ''}`, color: c });
      out.push({ list: 'anim', mii: i, label: '🕺 Animation', tip: `What Mii ${i + 1}'s body does` });
      out.push({ list: 'face', mii: i, label: '🙂 Face', tip: `Mii ${i + 1}'s face` });
    });
    return out;
  }
  ppf() { return this.lay.zoom * this.lay.scale; } // (pixels a frame)
  setZoom(z, atX = null) {
    const old = this.ppf(), sc = this.tscroll, lab = 13 * this.em;
    const fAt = atX != null ? (atX - sc.getBoundingClientRect().left + sc.scrollLeft - lab) / old : null;
    this.lay.zoom = clamp(z, 0.25, 30); store.set(LAYOUT, this.lay); this.draw();
    if (fAt != null) sc.scrollLeft = fAt * this.ppf() + lab - (atX - sc.getBoundingClientRect().left);
  }
  fitZoom() { const w = this.tscroll.clientWidth - 13 * this.em; this.setZoom(w / (this.total() * 1.05) / this.lay.scale); this.tscroll.scrollLeft = 0; }

  draw() {
    if (!this.seq || !this.tscroll) return;
    const z = this.ppf(), total = this.total(), W = Math.max(total * 1.15 + 120, 600) * z, sc = this.tscroll, keepL = sc.scrollLeft, keepT = sc.scrollTop;
    sc.textContent = '';
    const inner = h('div', { class: 'tinner', style: `width:calc(var(--lab) + ${W}px)` });
    // the ruler
    const rlane = h('div', { class: 'lane ruler' });
    const step = z >= 8 ? 5 : z >= 3 ? 10 : z >= 1.2 ? 30 : 60;
    for (let f = 0; f <= total * 1.15 + 120; f += step) rlane.appendChild(h('div', { class: 'tick', style: `left:${f * z}px;${f % 60 ? 'height:40%;top:60%' : ''}`, text: f % 60 === 0 ? `${f / 60}s` : (z >= 3 && f % 30 === 0 ? `${f}` : '') }));
    inner.appendChild(h('div', { class: 'row', style: 'height:1.9em;position:sticky;top:0;z-index:4' }, h('div', { class: 'lab', style: 'background:#0c1520', text: 'Time' }), rlane));
    this.bindScrub(rlane);
    // the tracks
    this.laneEls = [];
    for (const row of this.rows()) {
      if (row.header) { inner.appendChild(h('div', { class: 'row mii' }, h('div', { class: 'lab', style: `border-left:.35em solid ${row.color};font-weight:700`, text: row.label, title: row.label }), h('div', { class: 'lane' }))); continue; }
      const lane = h('div', { class: 'lane' });
      const plus = h('button', { class: 'plus', title: 'Add one at the red line', text: '+', onclick: () => this.addAt(row, this.ph) });
      inner.appendChild(h('div', { class: 'row' }, h('div', { class: 'lab', title: row.tip }, row.label, plus), lane));
      this.fillLane(lane, row, z);
      lane.ondblclick = (e) => { if (e.target === lane) this.addAt(row, (e.clientX - lane.getBoundingClientRect().left) / z); };
      lane.onpointerdown = (e) => { if (e.target === lane && e.button === 0) { this.select(null); this.scrubFrom(e, lane); } };
      this.laneEls.push(lane);
    }
    // the end of the moment (drag it to make it longer or shorter), and past it
    const endX = total * z;
    const endm = h('div', { class: `endm${this.seq.len > 0 ? '' : ' auto'}`, style: `left:calc(var(--lab) + ${endX}px)`, title: this.seq.len > 0 ? 'The end of the moment: drag to change (double-click: automatic again)' : 'The end of the moment (automatic: where the last thing ends). Drag to set it yourself.' });
    endm.onpointerdown = (e) => this.dragEnd(e, endm);
    endm.ondblclick = () => { this.commit(); delete this.seq.len; this.changed(); };
    inner.appendChild(h('div', { class: 'shade', style: `left:calc(var(--lab) + ${endX}px);right:0` }));
    inner.appendChild(endm);
    this.headEl = h('div', { class: 'head' }); inner.appendChild(this.headEl);
    sc.appendChild(inner);
    sc.scrollLeft = keepL; sc.scrollTop = keepT;
    this.drawHead();
    this.savedState();
  }

  fillLane(lane, row, z) {
    const L = this.listOf(row) || [];
    if (row.list === 'camera') {
      const ks = [...L].sort((a, b) => a.at - b.at);
      ks.forEach((k, i) => {
        const nx = ks[i + 1];
        if (k.kind === 'shot' && nx) {
          const cls = nx.kind !== 'shot' || nx.ease === 'cut' ? 'hold' : nx.ease === 'linear' ? 'linear' : '';
          lane.appendChild(h('div', { class: `seg-line ${cls}`, style: `left:${k.at * z}px;width:${(nx.at - k.at) * z}px` }));
        } else if (k.kind === 'shot') lane.appendChild(h('div', { class: 'seg-line hold', style: `left:${k.at * z}px;width:${Math.max(0, (this.total() - k.at) * z)}px` }));
      });
      for (const k of ks) {
        const el = h('div', { class: `key ${k.kind}${this.sel && this.sel.item === k ? ' sel' : ''}`, style: `left:${k.at * z}px`, title: `${k.kind === 'shot' ? `Camera keyframe (${k.ease === 'cut' ? 'cuts here' : k.ease === 'linear' ? 'even speed' : 'smooth'})` : k.kind === 'own' ? "The game's own camera from here" : 'The board camera from here'} · frame ${k.at}` });
        this.dragItem(el, row, k, z, 'key');
        lane.appendChild(el);
      }
      return;
    }
    for (const b of L) {
      const len = Math.max(1, b.len || 1), sel = this.sel && this.sel.item === b;
      const el = h('div', { class: `blk${b.rec ? ' rec' : ''}${sel ? ' sel' : ''}`, style: `left:${b.at * z}px;width:${Math.max(6, len * z)}px;background:${COLORS[row.list]}`, title: `${this.label(row, b)}${b.rec ? ' · recorded from the game (plays as the game has it until you change it)' : ''}` });
      el.appendChild(document.createTextNode(this.label(row, b)));
      el.appendChild(h('div', { class: 'g l' })); el.appendChild(h('div', { class: 'g r' }));
      this.dragItem(el, row, b, z, 'block');
      lane.appendChild(el);
    }
  }

  label(row, b) {
    if (row.list === 'builtin') return b.speed === 0 ? `⏸ hold at ${Math.round(b.from || 0)}` : `▶ play from ${Math.round(b.from || 0)}${b.speed !== 1 ? ` ×${b.speed}` : ''}`;
    if (row.list === 'anim') return `${b.clip}${nameOfCode[b.clip] ? ` (${nameOfCode[b.clip]})` : ''}${b.facing && b.facing !== 'auto' ? ` · faces ${typeof b.facing === 'number' ? `${b.facing}°` : b.facing}` : ''}`;
    if (row.list === 'face') { const f = FACES.find((x) => x.n === (b.face | 0)); return `${FACE_ICON[b.face | 0] || ''} ${f ? f.name : b.face}`; }
    if (row.list === 'fx') return `${(ACTIONS.find((a) => a[0] === b.action) || [0, b.action])[1]}${b.action === 'banner' && b.text ? `: ${b.text}` : ''}`;
    return '';
  }

  /** Drag a block (move it; its edges trim it) or a camera key (move it). Snaps to the red line and to other blocks' edges. */
  dragItem(el, row, item, z, kind) {
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const edge = e.target.classList.contains('g') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      const at0 = item.at, len0 = item.len || 1, x0 = e.clientX;
      let moved = false, committed = false;
      const others = (this.listOf(row) || []).filter((o) => o !== item).flatMap((o) => [o.at, o.at + (o.len || 0)]).concat([this.ph, 0]);
      const snap = (f, alt) => { if (alt) return Math.round(f); let best = Math.round(f), d = 6 / z; for (const o of others) if (Math.abs(o - f) < d) { d = Math.abs(o - f); best = o; } return Math.round(best); };
      if (!(this.sel && this.sel.item === item)) this.select({ list: row.list, mii: row.mii, item, el });
      const mv = (m) => {
        const df = (m.clientX - x0) / z;
        if (!moved && Math.abs(m.clientX - x0) < 3) return;
        if (!committed) { this.commit(); committed = true; }
        moved = true;
        if (item.rec) delete item.rec;
        if (kind === 'key') item.at = Math.max(0, snap(at0 + df, m.altKey));
        else if (edge === 'r') item.len = Math.max(1, snap(at0 + len0 + df, m.altKey) - item.at);
        else if (edge === 'l') { const end = at0 + len0, na = clamp(snap(at0 + df, m.altKey), 0, end - 1); if (row.list === 'anim' || row.list === 'builtin') item.from = Math.max(0, Math.round((item.from || 0) + (na - at0) * (item.speed ?? 1))); item.at = na; item.len = end - na; }
        else item.at = Math.max(0, snap(at0 + df, m.altKey));
        el.style.left = `${item.at * z}px`;
        if (kind !== 'key') el.style.width = `${Math.max(6, (item.len || 1) * z)}px`;
        el.classList.remove('rec');
      };
      const up = () => {
        removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
        if (moved) { if (row.list === 'camera') this.seq.camera.sort((a, b) => a.at - b.at); this.changed(); }
        else if (kind === 'key') this.seek(item.at);
      };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
    };
  }

  dragEnd(e, el) {
    e.preventDefault(); e.stopPropagation();
    const z = this.ppf(), x0 = e.clientX, t0 = this.total(); let committed = false;
    const mv = (m) => { if (!committed) { this.commit(); committed = true; } this.seq.len = Math.max(30, Math.round(t0 + (m.clientX - x0) / z)); el.style.left = `calc(var(--lab) + ${this.seq.len * z}px)`; el.classList.remove('auto'); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); if (committed) this.changed(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  bindScrub(lane) { lane.onpointerdown = (e) => { if (e.button === 0) this.scrubFrom(e, lane); }; }
  /** Click or drag along the time: the red line follows (the picture catches up as you go). */
  scrubFrom(e, lane) {
    e.preventDefault();
    const z = this.ppf(), f = (x) => (x - lane.getBoundingClientRect().left) / z;
    if (this.playing) this.pause();
    this.seek(Math.round(f(e.clientX)));
    let pend = null, busy = false;
    const go = () => { busy = false; if (pend != null) { const p = pend; pend = null; busy = true; this.seek(p); requestAnimationFrame(go); } };
    const mv = (m) => { pend = Math.round(f(m.clientX)); this.ph = clamp(pend, 0, this.total()); this.drawHead(); if (!busy) { busy = true; requestAnimationFrame(go); } };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  drawHead() {
    if (this.headEl) this.headEl.style.left = `calc(var(--lab) + ${this.ph * this.ppf()}px)`;
    if (this.clock) {
      const tot = this.total(), lead = this.playing && this.anim && this.anim.moment !== this.key;
      this.clock.textContent = lead ? 'The game’s lead-in…' : `${fmt(this.ph)}  ·  frame ${Math.round(this.ph)} / ${Math.round(tot)}`;
    }
    if (this.playing && this.headEl && this.tscroll) { // (keep the red line in sight)
      const x = this.ph * this.ppf() + 13 * this.em, sc = this.tscroll;
      if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft + 13 * this.em) sc.scrollLeft = x - 13 * this.em - 40;
    }
    const ck = this.cast ? this.cast.join(',') : ''; if (ck && ck !== this.castShown) { this.castShown = ck; this.setFreeCam(this.seqFreeCam); this.draw(); } // (who is who: once it is known)
  }

  // ===================================================================== the details panel
  inspect() {
    const P = this.insp; if (!P) return;
    P.textContent = '';
    const I = { append: (...xs) => P.append(...xs.filter((x) => x != null && x !== false)) };
    const sel = this.sel, b = sel && sel.item;
    const edit = (fn, opts) => { this.commit(); fn(); if (b) delete b.rec; this.changed(opts); };
    const field = (label, input) => h('label', { class: 'field' }, h('span', { text: label }), input);
    const num = (label, get, set, step = 1, min = null) => { const i = h('input', { type: 'number', step, value: get() }); if (min != null) i.min = min; i.onchange = () => edit(() => set(Number(i.value))); return field(label, i); };
    const choice = (opts, cur, pick) => h('div', { class: 'btns' }, ...opts.map(([v, t, tip]) => h('button', { class: String(cur) === String(v) ? 'on' : 'soft', title: tip || '', text: t, onclick: () => edit(() => pick(v)) })));
    const actions = (...extra) => h('div', { class: 'btns', style: 'margin-top:.3em' }, ...extra, h('button', { class: 'soft', text: 'Duplicate', title: 'Ctrl+D', onclick: () => this.duplicate() }), h('button', { class: 'warn', text: 'Delete', title: 'Delete key', onclick: () => this.removeSel() }));
    const timing = () => h('div', { class: 'two' }, num('Starts at (frame)', () => b.at, (v) => { b.at = Math.max(0, Math.round(v)); }), num('Lasts (frames)', () => b.len, (v) => { b.len = Math.max(1, Math.round(v)); }, 1, 1));
    const recNote = () => (b && b.rec ? h('div', { class: 'hint', style: 'background:#ffffff10;padding:.5em;border-radius:.45em' }, 'Recorded from the game: shown, not played. Change anything (or ', h('button', { class: 'go', text: 'Use it', onclick: () => edit(() => {}) }), ') and it plays as set.') : null);

    if (!b) {
      const roles = castOf(this.key), m = this.moments.find((x) => x.key === this.key);
      I.append(h('h3', { text: m ? m.title : this.key || '' }), h('div', { class: 'hint', text: `Key: ${this.key}` }));
      I.append(h('div', { class: 'hint', html: this.previewFn ? '' : '<b>No preview here.</b> This moment only happens in a game.' }));
      I.append(h('div', {}, h('b', { text: 'Who is in it' }), h('div', { class: 'hint' }, ...this.seq.miis.map((_, i) => h('div', { text: `Mii ${i + 1}: ${roles[i] || 'another Mii'}${this.cast && this.cast[i] != null ? ` (in the preview: ${this.nameOf(this.cast[i])})` : ''}` })))));
      I.append(h('button', { class: 'soft', text: '+ Add a Mii track', title: 'For another Mii on the board (in a game: everyone else, by player number)', onclick: () => edit(() => { this.seq.miis.push({ anim: [], face: [] }); }) }));
      if (this.seq.miis.length > castOf(this.key).length && this.seq.miis.length > 1) I.append(h('button', { class: 'soft', text: '− Remove the last Mii track', onclick: () => edit(() => { this.seq.miis.pop(); }) }));
      const lenIn = h('input', { type: 'number', min: 30, step: 1, value: Math.round(this.total()), style: 'width:6em' }); lenIn.onchange = () => edit(() => { this.seq.len = Math.max(30, Math.round(Number(lenIn.value))); });
      I.append(h('label', { class: 'field' }, h('span', { text: `Length: ${(this.total() / FPS).toFixed(2)} s${this.seq.len > 0 ? '' : ' (automatic: where the last thing ends)'}` }),
        h('span', { style: 'display:flex;gap:.4em;align-items:center' }, lenIn, 'frames', h('button', { class: this.seq.len > 0 ? 'soft' : 'on', text: 'Automatic', title: 'Ends where the last thing ends', onclick: () => edit(() => { delete this.seq.len; }) }))));
      I.append(h('div', { class: 'hint', html: `<b>How to make a sequence</b><ol style="padding-left:1.2em;margin:.3em 0">
        <li>Press <b>▶ Play</b> to see what the game does now, or <b>⏺ Record the game</b> to turn it into blocks to edit.</li>
        <li><b>Double-click</b> a track to add something there (or <b>+</b> for the red line). Drag blocks to move them, their edges to trim them.</li>
        <li>For the camera: <b>drag the picture</b> to move the camera, then <b>◆ Add camera keyframe</b> (<kbd>K</kbd>). Move the red line, move the camera, add another: it glides between them.</li>
        <li>It saves in this browser as you go (and plays in games here). <b>⇄ Export</b> gives the text to put it in the game for everyone.</li></ol>
        <b>Keys</b>: <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> a frame (Shift: 10) · <kbd>K</kbd> keyframe · <kbd>F</kbd> free camera · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy / paste at the red line · <kbd>Delete</kbd> · Ctrl+wheel zooms the timeline. Drag the bars between the panels to resize them; A− / A+ for the size of everything.` }));
      return;
    }

    if (sel.list === 'camera') {
      I.append(h('h3', { text: '🎥 Camera keyframe' }));
      I.append(num('At frame', () => b.at, (v) => { b.at = Math.max(0, Math.round(v)); this.seq.camera.sort((x, y) => x.at - y.at); }));
      I.append(field('What the camera does from here', choice([['shot', 'This view'], ['own', 'The game’s own camera', "Hand the camera back to the set piece's own shots"], ['normal', 'The board camera', 'The camera that follows the player on the board']], b.kind, (v) => { b.kind = v; if (v === 'shot' && !b.shot && this.anchor) b.shot = shotFromWorld(this.keyAnchor(b), this.cameraNow()); })));
      if (b.kind === 'shot') {
        I.append(field('How it gets here from the keyframe before', choice([['smooth', 'Smooth', 'Eases out of the last keyframe and into this one'], ['linear', 'Even speed'], ['cut', 'Cut', 'Jumps here at this frame']], b.ease || 'smooth', (v) => { b.ease = v; })));
        const roles = castOf(this.key);
        I.append(field('Kept relative to', choice([[null, 'The space'], ...this.seq.miis.map((_, i) => [i, `Mii ${i + 1}`, `Moves with Mii ${i + 1}${roles[i] ? ` (${roles[i]})` : ''}`])], b.follow ?? null, (v) => {
          const w = this.anchor && b.shot ? shotToWorld(this.keyAnchor(b), b.shot) : null; b.follow = v; if (w) b.shot = shotFromWorld(this.keyAnchor(b), w); })));
        I.append(h('div', { class: 'btns' }, h('button', { class: 'go', text: '📷 Set to my current view', title: 'Make this keyframe what the picture shows now', onclick: () => { if (!this.anchor) this.seek(b.at); edit(() => { b.shot = shotFromWorld(this.keyAnchor(b), this.cameraNow()); }); this.toast('Keyframe set to this view.'); } }),
          h('button', { class: 'soft', text: '👁 Look through it', title: 'Go to its frame and put the free camera there, to adjust it', onclick: () => this.lookThrough(b) })));
        I.append(h('div', { class: 'hint', text: 'A keyframe kept relative to the space fits every space of this kind. Before the first keyframe the game uses its own camera.' }));
      }
      I.append(actions());
      return;
    }

    if (sel.list === 'face') {
      I.append(h('h3', { text: `🙂 Mii ${sel.mii + 1}: face` }), recNote());
      const grid = h('div', { class: 'faces' }, ...FACES.map((f) => h('button', { class: (b.face | 0) === f.n ? 'on' : '', title: f.uses, onclick: () => { this.recentFace = f.n; edit(() => { b.face = f.n; }); } }, h('b', { text: FACE_ICON[f.n] }), f.name)));
      I.append(grid, timing(), h('div', { class: 'hint', text: 'The face shows for as long as the block lasts, then back to normal. Hover a face for what Wii Party uses it with.' }), actions());
      return;
    }

    if (sel.list === 'anim') {
      I.append(h('h3', { text: `🕺 Mii ${sel.mii + 1}: animation` }), recNote());
      const fr = clipLength(b.clip);
      I.append(h('div', {}, h('b', { text: b.clip }), nameOfCode[b.clip] ? ` (${nameOfCode[b.clip]})` : '', h('span', { class: 'hint', text: `  ${fr || '?'} frames${fr ? ` · ${(fr / FPS).toFixed(2)} s` : ''}` })));
      const find = h('input', { type: 'search', placeholder: 'Search: pm301, cheer, walk…', value: this.clipQuery || '' });
      const groups = [['', 'All'], ['pm001', 'Board Game Island'], ['pm000', 'Shared'], ['other', 'Other games']];
      const gsel = h('select', {}, ...groups.map(([v, t]) => h('option', { value: v, text: t })));
      gsel.value = this.clipGroup || '';
      const list = h('div', { class: 'clips' });
      const fill = () => {
        const q = find.value.trim().toLowerCase(), g = gsel.value; this.clipQuery = find.value; this.clipGroup = g;
        list.textContent = '';
        const named = new Set(Object.values(nameOfCode)), names = Object.keys(CLIP_TABLE).filter((n) => /^pm\d/.test(n) || !named.has(n)).sort((a, c) => (/^pm/.test(a) - /^pm/.test(c)) || (a < c ? -1 : 1));
        let n = 0;
        for (const c of names) {
          const nice = nameOfCode[c] ? `${c} (${nameOfCode[c]})` : c;
          if (q && !nice.toLowerCase().includes(q)) continue;
          if (g === 'pm001' && !c.startsWith('pm001')) continue;
          if (g === 'pm000' && !c.startsWith('pm000')) continue;
          if (g === 'other' && (c.startsWith('pm000') || c.startsWith('pm001') || !/^pm/.test(c))) continue;
          if (++n > 600) break;
          const bt = h('button', { class: c === b.clip ? 'cur' : '', text: `${nice} · ${CLIP_TABLE[c].frames}f${CLIP_TABLE[c].loop ? ' · loops' : ''}`, onclick: () => { this.recentClip = c; edit(() => { const L = clipLength(c); if (b.clip !== c && L) b.len = Math.round(L / (b.speed || 1)); b.clip = c; b.from = 0; }); } });
          list.appendChild(bt);
        }
        if (!n) list.appendChild(h('div', { class: 'hint', text: 'Nothing found.' }));
      };
      find.oninput = fill; gsel.onchange = fill; fill();
      I.append(h('div', { class: 'two' }, find, gsel), list);
      I.append(timing());
      I.append(h('div', { class: 'two' }, num('From its frame', () => b.from || 0, (v) => { b.from = Math.max(0, v); }), num('Speed', () => b.speed ?? 1, (v) => { b.speed = clamp(v, 0, 4); }, 0.05, 0)));
      const times = h('input', { type: 'number', step: 0.5, min: 0.5, value: fr ? Math.round(((b.len || 0) * (b.speed ?? 1)) / fr * 10) / 10 : '' });
      times.onchange = () => { if (fr) edit(() => { b.len = Math.max(1, Math.round(Number(times.value) * fr / (b.speed || 1))); }); };
      const loopBox = h('input', { type: 'checkbox' }); loopBox.checked = b.loop !== false; loopBox.onchange = () => edit(() => { b.loop = loopBox.checked; });
      I.append(h('div', { class: 'two' }, field('Times it plays', times), h('label', { class: 'field' }, h('span', { text: 'When it runs out' }), h('span', { style: 'display:flex;gap:.4em;align-items:center' }, loopBox, 'start again (else hold the last frame)'))));
      I.append(field('Which way they face', choice(FACINGS, typeof b.facing === 'number' ? 'angle' : b.facing || 'auto', (v) => { b.facing = v; })));
      I.append(num('…or an angle from the path (°)', () => (typeof b.facing === 'number' ? b.facing : ''), (v) => { b.facing = v; }, 5));
      I.append(h('div', { class: 'hint', text: 'The game still moves them (a walk, a jump, an arc); this is what their body does on the way.' }));
      I.append(actions());
      return;
    }

    if (sel.list === 'builtin') {
      I.append(h('h3', { text: '🎮 The game’s own set piece' }), recNote());
      I.append(field('What it does', choice([[1, '▶ Play'], [0.5, 'Half speed'], [0, '⏸ Hold (everyone waits)']], b.speed ?? 1, (v) => { b.speed = v; })));
      I.append(timing(), num("From the game's frame", () => Math.round(b.from || 0), (v) => { b.from = Math.max(0, Math.round(v)); }), num('Speed', () => b.speed ?? 1, (v) => { b.speed = clamp(v, 0, 4); }, 0.05, 0));
      I.append(h('div', { class: 'hint', text: `The game's own version of this moment lasts ${this.inner || '?'} frames. With no blocks here it plays as it is. Hold it to give the Miis or the camera time, or play part of it slower.` }), actions());
      return;
    }

    if (sel.list === 'fx') {
      I.append(h('h3', { text: '✨ Effect' }));
      const act = h('select', {}, ...ACTIONS.map(([v, t]) => h('option', { value: v, text: t }))); act.value = b.action; act.onchange = () => edit(() => { b.action = act.value; });
      I.append(field('What happens', act));
      if (b.action === 'banner') { const t = h('input', { value: b.text || '' }); t.onchange = () => edit(() => { b.text = t.value; }); I.append(field('Caption ({0}, {1}… are players’ names)', t)); }
      if (['glint', 'chips', 'jolt'].includes(b.action)) {
        const w = h('select', {}, ...this.seq.miis.map((_, i) => h('option', { value: `mii${i + 1}`, text: `At Mii ${i + 1}` })), ...WALL_SPOTS.map((s) => h('option', { value: s, text: s })));
        w.value = b.where === 'player' || !b.where ? 'mii1' : b.where; w.onchange = () => edit(() => { b.where = w.value; });
        I.append(field('Where', w));
      }
      if (b.action === 'glint') { const c = h('input', { value: b.color || '', placeholder: "blank: that Mii's colour" }); c.onchange = () => edit(() => { b.color = c.value || undefined; }); I.append(field('Colour', c), num('Size', () => b.size || 1, (v) => { b.size = v; }, 0.1, 0.1)); }
      I.append(timing(), actions());
    }
  }

  // ===================================================================== export / import
  exportBox() {
    const all = localSequences(), keys = Object.keys(all);
    const ta = h('textarea', { spellcheck: 'false' }); ta.value = JSON.stringify(all);
    const msg = h('div', { class: 'hint' });
    const close = () => modal.remove();
    const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } }, h('div', {},
      h('h3', { text: 'Export / import' }),
      h('div', { class: 'hint', text: `${keys.length} moment${keys.length === 1 ? '' : 's'} changed in this browser${keys.length ? `: ${keys.join(', ')}` : ''}. Copy this text and send it to have them put in the game for everyone. To bring sequences in (from another browser, or the island viewer's page), paste such text here and press Import.` }),
      ta, msg,
      h('div', { class: 'btns' },
        h('button', { class: 'go', text: 'Copy', onclick: async () => { ta.select(); try { await navigator.clipboard.writeText(ta.value); msg.textContent = 'Copied.'; } catch (e) { msg.textContent = 'Selected: press Ctrl+C (Cmd+C) to copy.'; } } }),
        h('button', { text: 'Import', onclick: () => { try { const got = JSON.parse(ta.value || '{}'); const mine = localSequences(); for (const [k, v] of Object.entries(got)) mine[k] = upgradeSequence(v); saveLocalSequences(mine); this.fillMoments(); if (got[this.key]) this.open(this.key); close(); this.toast(`Imported ${Object.keys(got).length} moment(s).`); } catch (e) { msg.textContent = 'That is not an export.'; } } }),
        h('button', { class: 'soft', text: 'Close', onclick: close }))));
    this.root.appendChild(modal);
  }
}
