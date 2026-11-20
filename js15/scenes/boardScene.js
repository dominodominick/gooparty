import { app } from '../app.js';
import { PLAYER_COLORS, VIRTUAL, BUILD } from '../config.js';
import { ISLAND, VOLCANO, LABELS, TILE_COLORS, isChallenge, EXIT_POS } from '../game/boardData.js';
import { islandPositions, volcanoPositions, legVia, islandWorld, VOLCANO_CENTER, VOLCANO_OFFSET, BRIDGE_PLANKS, SPACE_IDS, stopOfSpace, terrainHeight, nearestPath } from '../game/boardLayout.js';
import { builderMesh } from '../world/worldBuild.js';
import { buildMii, HAIR, SKINS, MII_NECK, LEG_PIVOT, ARM_PIVOT } from '../world/miis.js';
import { tileCanvas } from '../world/tileArt.js';
import { ChallengeFX } from './challengeFx.js';
import { spacesToGo, DROP } from '../game/boardGame.js';
import { esc } from '../util/dom.js';
import { drawPointer } from '../draw.js';
import { DUEL_CARD, duelCardCenter, duelCardAt } from '../game/duelLayout.js';
import { rigStatue, statueTimeline, STATUE_DUR } from '../world/statueRig.js';
import { STATUES } from '../world/statueData.js';
import { makeTornado, TORNADO_FPS } from '../world/tornado.js';
import { TORNADO } from '../world/tornadoData.js';

// The 3D board. Everything the host decides arrives as "events" (roll, move, space, win...)
// and this scene just plays them back. It never decides anything itself.
// Three.js (r160, an ES module) is put on window.THREE by the page before this code runs.
// The island itself is the real Board Game Island map, loaded by app.loadBoard() (see world/islandLoader.js).

const hexNum = (s) => parseInt(s.slice(1), 16);
const FONT = '"Trebuchet MS", sans-serif';

// The rank die's look, by minigame placement (doc: 1st gold, 2nd platinum, 3rd silver, 4th copper, 5th wood).
const TIER_STYLE = {
  base:     { face: '#ffffff', pip: '#16324f', name: '' },
  gold:     { face: '#f6c90e', pip: '#4a3500', name: 'Gold' },
  platinum: { face: '#dfe9f2', pip: '#27506f', name: 'Platinum' },
  silver:   { face: '#aab1b9', pip: '#1c252e', name: 'Silver' },
  copper:   { face: '#c8763a', pip: '#2b1204', name: 'Copper' },
  wood:     { face: '#a57a4a', pip: '#2a1808', name: 'Wood' },
  tornado:  { face: '#d92b2b', pip: '#ffffff', name: '', fourToSix: true }, // the tornado's red die: 4, 5, 6, 4, 5, 6 in pips
};
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};
// BoxGeometry face order is +x, -x, +y, -y, +z, -z. Opposite faces add up to 7, like a real die.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// Rotation that turns the face showing value v toward the camera (+z).
const FACE_EULER = {
  2: [0, 0, 0], 5: [0, Math.PI, 0], 3: [0, -Math.PI / 2, 0], 4: [0, Math.PI / 2, 0], 1: [Math.PI / 2, 0, 0], 6: [-Math.PI / 2, 0, 0],
};
const DICE_SPACING = 2.1;
const diceX = (i, n) => (i - (n - 1) / 2) * DICE_SPACING;

// Natural dice jump. p runs 0..1. Real parabolas (slow at the top, fast near the floor), a crouch before
// take-off, a squash on every landing and a stretch while flying. The first jump is big on purpose.
const JUMPS = [{ a: 0.08, b: 0.50, h: 7.5, hit: 1.0 }, { a: 0.50, b: 0.74, h: 2.4, hit: 0.55 }, { a: 0.74, b: 0.90, h: 0.7, hit: 0.3 }];
export function diceBounce(p) {
  p = Math.min(1, Math.max(0, p));
  let y = 0, squash = 0, stretch = 0;
  if (p < JUMPS[0].a) squash = 0.22 * Math.sin(Math.PI * (p / JUMPS[0].a)); // crouch before the jump
  for (const j of JUMPS) {
    if (p >= j.a && p < j.b) {
      const t = (p - j.a) / (j.b - j.a);
      y = 4 * j.h * t * (1 - t);
      stretch = 0.16 * Math.abs(1 - 2 * t) * Math.sqrt(j.h / 7.5);
    }
    if (p >= j.b && p < j.b + 0.06) squash = Math.max(squash, 0.3 * j.hit * Math.sin(Math.PI * ((p - j.b) / 0.06))); // landing squash
  }
  const sy = 1 - squash + stretch;
  return { y, sy, sxz: 1 / Math.sqrt(sy) };
}
function bounceY(p) { return diceBounce(p).y; }
// The statues' landing platforms (blue and red patterned stone in the map: materials mr001m039 and mr001m049):
// the middle of the top, and roughly how far it is to the edge. Wii units x 0.016.
const STATUE_PLATFORMS = {
  blue: { x: 2456 * 0.016, y: 1420 * 0.016, z: 1675 * 0.016, r: 3.2 },
  red: { x: -890 * 0.016, y: 950 * 0.016, z: -4246 * 0.016, r: 2.6 },
};
const hop = (a, b, t, h) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * h, z: a.z + (b.z - a.z) * t });
const lerp3v = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const SPRING_H = 2.4;
const TORNADO_SIZE = 2; // the game's tornado, twice the map's own scale: a funnel well taller than the player riding its top // how tall the spring stands when fully out
const ease01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const CRATES_IDX = ISLAND.findIndex((n) => n.type === 'crates'); // the crates and barrels stop
const VON_IDX = ISLAND.findIndex((n) => n.type === 'volcanoOrNot'); // the volcano-or-not stop
const LAVA_TYPES = new Set(['blank', 'start', 'volcano', 'vine', 'dragon', 'crates', 'volcanoOrNot', 'spike', 'final', 'finish']); // same list as the host's LAVA_SAFE
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** A texture drawn on a canvas holds ordinary (sRGB) colours. */
/** A colour made lighter (k > 1) or darker (k < 1). */
function shadeHex(hex, k) {
  const n = parseInt(String(hex).slice(1), 16), ch = (v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
}
function canvasTex(T, c) { const t = new T.CanvasTexture(c); if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace; return t; }
/** Newer three.js measures light differently: the same numbers come out about 3x darker. */
const lightK = (T) => (parseInt(T.REVISION, 10) >= 155 ? Math.PI : 1);

// ---------- small Three.js helpers ----------
function mat(T, color, opts = {}) { return new T.MeshLambertMaterial({ color, flatShading: true, ...opts }); }
function part(T, geo, color, x = 0, y = 0, z = 0, opts) {
  const m = new T.Mesh(geo, mat(T, color, opts));
  m.position.set(x, y, z);
  return m;
}

function labelTexture(T, text, { bg = null, fg = '#16324f', border = '#16324f', size = 128 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg; g.beginPath(); g.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2); g.fill();
    g.lineWidth = size * 0.06; g.strokeStyle = border; g.stroke();
  }
  if (text) {
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${text.length > 4 ? size * 0.25 : text.length > 2 ? size * 0.36 : size * 0.52}px ${FONT}`;
    g.fillText(text, size / 2, size / 2 + size * 0.03);
  }
  return canvasTex(T, c);
}

function dieFaceTexture(T, value, style) {
  const size = 128, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = style.face; g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 8; g.strokeRect(4, 4, size - 8, size - 8);
  g.fillStyle = style.pip;
  const shown = style.fourToSix ? 4 + (value - 1) % 3 : value; // the tornado die's faces read 4, 5, 6, 4, 5, 6
  for (const [x, y] of PIPS[shown]) { g.beginPath(); g.arc(x * size, y * size, 12, 0, Math.PI * 2); g.fill(); }
  return canvasTex(T, c);
}

const PANTS = ['#35508f', '#2b2b3a', '#6a5a3a', '#3a5a8a', '#4a3a6a', '#3a3f4a'];
const START_SPACING = 2.4; // how far apart the waiting pawns stand
function makePawn(T, slot) {
  const c = PLAYER_COLORS[slot];
  const g = new T.Group();
  const { body, head, legs, arms } = buildMii({ shirt: c.hex, pants: PANTS[slot], hair: HAIR[slot], skin: SKINS[slot], parts: true });
  g.add(builderMesh(T, body));
  g.userData.legs = []; g.userData.arms = []; // swung from the hips and shoulders when the pawn walks
  [-1, 1].forEach((sgn, i) => {
    const lg = new T.Group(); lg.position.set(sgn * LEG_PIVOT.x, LEG_PIVOT.y, 0); lg.add(builderMesh(T, legs[i])); g.add(lg); g.userData.legs.push(lg);
    const ag = new T.Group(); ag.position.set(sgn * ARM_PIVOT.x, ARM_PIVOT.y, 0); ag.add(builderMesh(T, arms[i])); g.add(ag); g.userData.arms.push(ag);
  });
  const headGroup = new T.Group(); // tips up to look at the camera while rolling; pivots at the neck
  headGroup.position.set(0, MII_NECK, 0);
  headGroup.add(builderMesh(T, head));
  g.add(headGroup);
  g.userData.head = headGroup;
  // the shadow: a soft dark disc; it is laid on whatever is under the player each frame (see placeShadow)
  const sg = new T.CircleGeometry(0.95, 18); if (sg.rotateX) sg.rotateX(-Math.PI / 2);
  const shadow = new T.Mesh(sg, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
  shadow.position.y = -0.02; shadow.renderOrder = 2;
  g.add(shadow);
  g.userData.shadow = shadow;
  const tex = labelTexture(T, String(slot + 1), { bg: c.hex, fg: c.ink, border: '#16324f' });
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.8, 1.8, 1);
  sprite.position.set(0, 4.7, 0);
  g.add(sprite);
  g.userData.badge = sprite; // hidden while the dice are on screen so it never draws over them
  return g;
}

const PTR_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']; // what moves (and presses) your custom pointer

export class BoardScene {
  // [turn round the pawn (radians), distance x, extra height]: tried in this order
  static CAM_OPTIONS = [[0, 1, 0], [0.55, 1, 0], [-0.55, 1, 0], [0, 0.85, 5], [1.1, 1, 1], [-1.1, 1, 1], [0.55, 0.85, 6], [-0.55, 0.85, 6], [0, 0.65, 11], [1.7, 1, 2], [-1.7, 1, 2], [Math.PI, 1, 2], [1.1, 0.7, 10], [-1.1, 0.7, 10], [0, 0.4, 17]];
  constructor() { this.is3d = true; this.fixedStage = true; } // fixedStage: always the same 16:9 view for everyone

  // ===================================================================== lifecycle
  enter() {
    const T = window.THREE;
    this.s = app.session;
    app.ui.className = 'ui-hud';

    if (!T) { // CDN blocked or offline
      this.broken = true;
      app.ui.innerHTML = `<section class="panel"><h2>The 3D board could not load</h2>
        <p>The 3D library (Three.js) didn't load. Check your internet connection and reload.</p>
        <button class="btn" data-act="leave">Leave room</button></section>`;
      app.ui.onclick = (e) => { if (e.target.closest('[data-act="leave"]')) app.leave(); };
      return;
    }
    this.T = T;
    this.queue = []; this.anim = null; this.idle = true;
    this.control = null; this.stopSent = false; this.camSlot = null; this.snapCamera = false; this.cam = null; this.camTrack = null;
    this.tiles = { island: [], volcano: [] };
    this.floaters = []; this.t = 0; this.texCache = {}; this.dieTex = {}; this.dice = [];
    this.pos = { island: islandPositions(), volcano: volcanoPositions() };

    this.buildHud();
    this.buildRenderer();
    this.fx = new ChallengeFX(this);
    this.buildWorld();
    this.buildPawns();

    this.onKey = (e) => {
      if ((e.code === 'Backquote' || e.code === 'F2') && !e.repeat && this.s.offline) { e.preventDefault(); this.toggleDev(); return; }
      if (e.code === 'Escape' && !e.repeat) { e.preventDefault(); if (this.devOpen) this.toggleDev(false); else this.setPaused(!this.paused); return; }
      if (this.paused) return;
      if (e.code === 'Space' && !e.repeat && this.canStop()) { e.preventDefault(); this.doStop(); }
      // Offline games only (handy for trying things out): while it is your roll, keys 1-6 put you right before the
      // vine, the guardian, the pool, the cave, the boulder and the summit.
      if (e.code === 'Digit0' && this.s.offline && !e.repeat) { // offline only: look at each challenge spot in turn (0 again for the next; ends back at the game)
        const P = this.pos, top = P.island[79], v = P.volcano[4], S = (id) => P.island[stopOfSpace(id)];
        const views = ['vine', 'dragon', 'crates', 'spike'].map((k) => this.fx.holdFor(k)).concat([
          { x: top.x + 26, y: top.y + 16, z: top.z + 34, tx: top.x, ty: top.y - 3, tz: top.z + 6 },
          { x: S(45).x + 10, y: S(45).y + 9, z: S(45).z - 12, tx: S(45).x, ty: S(45).y + 1, tz: S(45).z + 6 },
          { x: v.x + 26, y: v.y + 24, z: v.z + 30, tx: v.x, ty: v.y, tz: v.z },
          { x: S(27).x + 4, y: S(27).y + 10, z: S(27).z + 16, tx: S(27).x, ty: S(27).y + 2, tz: S(27).z - 8 },
          { x: S(15).x + 14, y: S(15).y + 8, z: S(15).z - 4, tx: (S(15).x + S(16).x) / 2, ty: S(15).y - 1, tz: (S(15).z + S(16).z) / 2 },
          { x: S(41).x + 6, y: S(41).y + 9, z: S(41).z + 14, tx: S(42).x + 4, ty: S(42).y + 2, tz: S(42).z + 4 },
          { x: top.x + 4, y: top.y + 9, z: top.z + 22, tx: top.x, ty: top.y + 2, tz: top.z + 6 },
          { x: 0, y: 70, z: 150, tx: 0, ty: 20, tz: 0 }, null]);
        this.debugView = ((this.debugView == null ? -1 : this.debugView) + 1) % views.length;
        this.camHold = views[this.debugView]; this.snapCamera = true;
      }
      const jump = { Digit1: 6, Digit2: 23, Digit3: 41, Digit4: 48, Digit5: 60, Digit6: 76 }[e.code];
      if (jump != null && this.s.offline && this.canStop() && this.s.game && this.s.game.board) {
        this.s.game.board.positions[this.s.mySlot] = { track: 'island', idx: jump };
        this.s._push(); this.s.board = this.s.game.board.snapshot();
        const pawn = this.pawns[this.s.mySlot], q = this.nodeXYZ('island', jump, this.s.mySlot);
        if (pawn) { pawn.track = 'island'; pawn.idx = jump; pawn.x = q.x; pawn.y = q.y; pawn.z = q.z; this.place(pawn); this.snapCamera = true; }
      }
    };
    addEventListener('keydown', this.onKey);

    // The camera follows ONE explicit player. It only changes behind the black fade between turns
    // (never because the host's "current player" moved on while this screen is still playing a turn).
    const b0 = this.s.board;
    this.camSlot = b0.control?.slot ?? b0.current ?? b0.winner ?? Number(Object.keys(b0.positions)[0]);
    this.shownTurn = b0.control?.slot ?? b0.current ?? null; // whose turn the SCREEN is showing; moves on only when that turn's intro plays
    for (const wall of Object.keys(b0.broken || {})) { this.markBroken(wall); this.fx.setBroken(wall); }
    if (b0.eruptions) this.setEruption(b0.eruptions); // joined mid-eruption

    // A player who (re)joins in the middle of a roll or a choice catches up from the snapshot.
    const c = b0.control;
    if (c) {
      this.applyControl(c);
      this.setBanner(this.controlBanner(c));
      if (c.type === 'roll' || c.type === 'choose') this.fx.begin(c.slot);
    }
    this.s.setTurnHandler((m) => this.onTurn(m)); // also flushes any turn that arrived early
    this.refreshHud();
  }

  exit() {
    if (this.broken) { app.ui.onclick = null; return; }
    this.left = true;
    removeEventListener('keydown', this.onKey);
    this.unhookPointer();
    this.s?.setTurnHandler(null);
    app.canvas3d.style.display = 'none';
    app.ui.onclick = null;
  }

  onRoster() { if (!this.broken && this.idle) this.refreshHud(); }

  // ===================================================================== setup
  buildRenderer() {
    const T = this.T;
    if (!app.renderer) app.renderer = new T.WebGLRenderer({ canvas: app.canvas3d, antialias: true });
    this.renderer = app.renderer;
    app.canvas3d.style.display = 'block';
    this.scene3d = new T.Scene();
    this.scene3d.background = new T.Color(0x8fd0f2);
    this.scene3d.fog = new T.Fog(0x8fd0f2, 500, 2600);
    const LK = this.LK = lightK(T);
    // The map is drawn with its own baked lighting; these lights are only for the pawns, the dice and the effects.
    this.hemi = new T.HemisphereLight(0xffffff, 0x9aa890, 1.0 * LK);
    this.scene3d.add(this.hemi);
    this.sun = new T.DirectionalLight(0xffffff, 0.7 * LK);
    this.sun.position.set(60, 100, 40);
    this.scene3d.add(this.sun);
    this.ambience = 'island';
    // Same vertical field of view and the same 16:9 shape for every player, whatever their window size.
    this.camera = new T.PerspectiveCamera(50, VIRTUAL.w / VIRTUAL.h, 0.3, 7000);
    this.scene3d.add(this.camera);
    // The dice live in front of the camera so they are always on screen, big and in 3D.
    this.diceGroup = new T.Group();
    this.diceGroup.position.set(0, -0.4, -8);
    this.diceGroup.visible = false;
    this.camera.add(this.diceGroup);
    this.resize();
  }

  /** The 3D canvas is exactly the 16:9 stage; main.js centers it and letterboxes the rest. */
  resize() {
    if (this.broken) return;
    const w = Math.max(1, Math.round(VIRTUAL.w * app.view.scale)), h = Math.max(1, Math.round(VIRTUAL.h * app.view.scale));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = VIRTUAL.w / VIRTUAL.h;
    this.camera.updateProjectionMatrix();
  }

  onResize() { this.resize(); }

  tex(text, opts) {
    const key = text + JSON.stringify(opts || {});
    return (this.texCache[key] ||= labelTexture(this.T, text, opts));
  }

  /** The spaces are part of the map model; here we only remember what each one is. The model itself arrives a moment later. */
  buildWorld() {
    this.tileTexCache = {}; this.spinners = [];
    for (const [track, nodes] of [['island', ISLAND], ['volcano', VOLCANO]]) {
      nodes.forEach((node, i) => {
        const real = i > 0 && i < nodes.length - 1; // the first and last stop of each track are places, not space tiles
        // island: the map's own number for the tile at this stop (the challenge stars have none)
        this.tiles[track][i] = { node, label: LABELS[node.type], id: track === 'island' ? SPACE_IDS[i] : real ? 100 + i : null };
      });
    }
    if (!app.loadBoard) return;
    this.loading = true;
    app.loadBoard().then((board) => { this.loading = false; if (!this.left) this.attachBoard(board); })
      .catch((e) => { this.loading = false; this.loadError = String(e && e.message || e); });
  }

  /** The map has loaded: put it in the scene, paint the spaces, and hand the props to the challenges. */
  attachBoard(board) {
    const T = this.T, sc = this.scene3d;
    this.board = board;
    sc.add(board.sky); sc.add(board.island);
    board.volcano.position.set(VOLCANO_OFFSET.x, VOLCANO_OFFSET.y, VOLCANO_OFFSET.z); sc.add(board.volcano);
    this.world = { sky: board.sky };
    this.paintTiles();
    const S = board.scale, place = (name, p, yaw = 0, k = 1) => { // a prop of the map, put at a world position
      const tpl = board.props.get(name); if (!tpl) return null;
      const h = new T.Group(); h.add(tpl.clone(true)); h.scale.setScalar(S * k); h.position.set(p.x, p.y, p.z); h.rotation.y = yaw; sc.add(h); return h;
    };
    const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const W = islandWorld(), H = W.hooks;
    // the challenge stops are the map's small stars; the dragon wall and the spike ball have none in the map, so add them
    for (const type of ['dragon', 'spike']) { const p = this.pos.island[ISLAND.findIndex((n) => n.type === type)]; place('m001_70', { ...p, y: p.y + 0.03 }); }
    // the glowing rays over the summit and the volcano's way-out glow are effects the game turns on at a moment; keep them off
    this.rays = [];
    board.island.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'mr001m059') { o.visible = false; this.rays.push(o); } });
    this.exitGlow = [];
    board.volcano.traverse((o) => { if (o.isMesh && o.material && /^mr001m015_[23]$/.test(o.material.name)) { o.visible = false; this.exitGlow.push(o); } });
    // the summit gate shows the 6 you need to win; it stands in front of the final star, facing it
    { const fin = this.pos.island[ISLAND.findIndex((n) => n.type === 'final')]; this.gate = place('m001_60', H.gate, faceTo(H.gate, fin)); }
    // the white path markers are the game's own route points: never shown in the game
    board.island.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'tms_mat') o.visible = false; });
    // the red lava frames under every special space (m001_41, material mr001m109) are the game's eruption overlay, only shown
    // while the volcano erupts in the Wii game; the eruption here paints the spaces themselves, so they are never shown
    board.island.traverse((o) => { if (o.isMesh && o.material && /^mr001m109/.test(o.material.name || '')) o.visible = false; });
    // the statues by their spaces: blue ones send you forward, the red one back
    const sp = (id) => this.pos.island[stopOfSpace(id)];
    this.statues = {};
    const statue = (name, at, spaceId, back = 0) => {
      const a = faceTo(at, sp(spaceId)), g = place(name, { x: at.x - Math.sin(a) * back, y: at.y, z: at.z - Math.cos(a) * back }, a);
      if (g) this.statues[stopOfSpace(spaceId)] = this.setupStatue(g, name);
    };
    statue('m001_30', H.iwao_b1, 26);
    statue('m001_30', H.iwao_b2, 28);
    statue('m001_31', H.iwao_r1, 42); // where the map puts it: over its own shadow, by the track
    // the rope bridge's planks
    for (const pl of BRIDGE_PLANKS) place('m001_22', pl, pl.yaw);
    // the clouds sit well away from the island, so they never come between the camera and the board
    board.sky.scale.setScalar(board.scale * 4); // (set, not multiplied: the board is attached again after a return to the lobby)
    board.sky.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.fog = false; });
    this.fx.attach(board);
    this.showArea(this.ambience || 'island');
    if (this.s.board && this.s.board.over) this.openSummit();
    if (this.eruptionCount) this.setEruption(this.eruptionCount);
  }

  /** Draws each space's icon onto its tile in the map model (plain spaces keep the map's own blank tile). */
  paintTiles() {
    if (!this.board) return;
    const n = this.eruptionCount || 0;
    for (const track of ['island', 'volcano']) {
      for (const t of this.tiles[track]) {
        if (!t || t.id == null || t.node.type === 'blank') continue;
        const lava = n && track === 'island' && !LAVA_TYPES.has(t.node.type);
        const key = `${t.node.type}|${lava ? n : 0}|${t.dim ? 1 : 0}`;
        if (t.painted === key) continue;
        t.painted = key;
        const tex = this.tileTex(t.node.type, lava ? `-${4 * n}` : t.label, !!lava);
        this.board.setSpaceTexture(track, t.id, tex);
        // the map draws its two volcano-teleport tiles (on spaces 27 and 66) as one extra mesh, space 121, over those spaces
        const warp = track === 'island' && t.node.type === 'skull' && this.board.spaceMeshes && this.board.spaceMeshes.island.get(121);
        if (warp) { this.board.setSpaceTexture('island', 121, tex); const own = this.board.spaceMeshes.island.get(t.id); if (own) own.visible = false; }
      }
    }
  }

  /** Cached glossy tile art for a space. */
  tileTex(type, text, erupt) {
    const key = `${type}|${text}|${erupt ? 1 : 0}`;
    if (!this.tileTexCache[key]) {
      const t = canvasTex(this.T, tileCanvas(type, text || '', TILE_COLORS[type] || '#f4efe0', erupt));
      try { t.anisotropy = 4; } catch (e) { /* older GPUs */ }
      this.tileTexCache[key] = t;
    }
    return this.tileTexCache[key];
  }

  buildPawns() {
    const T = this.T, b = this.s.board;
    this.pawns = {};
    for (const key of Object.keys(b.positions)) {
      const slot = Number(key), at = b.positions[slot];
      const group = makePawn(T, slot);
      this.scene3d.add(group);
      const pawn = { slot, group, head: group.userData.head, yaw: 0, pitch: 0, badge: group.userData.badge, track: at.track, idx: at.idx, x: 0, y: 0, z: 0, scale: 1 };
      this.snapPawn(pawn, at);
      this.pawns[slot] = pawn;
    }
  }

  // ===================================================================== positions
  /** The players, in seat order: they all wait side by side on the start plaza until it is their turn. */
  startSlots() { return Object.keys(this.s.board.positions).map(Number).sort((a, b) => a - b); }

  nodeXYZ(track, idx, slot, centre = false) {
    const own = this.pawns && this.pawns[slot];
    if (track === 'island' && own && own.across && own.idx === idx && this.farBank(idx)) { const q = this.farBank(idx); return { x: q.x, y: q.y + 0.05, z: q.z }; }
    const p = this.pos[track][idx], a = slot * (Math.PI / 3);
    if (track === 'island' && idx === 0) { // a row across the path, in front of the gate's posts
      const row = this.startSlots(), r = (row.indexOf(slot) - (row.length - 1) / 2) * START_SPACING, lx = -p.dir.z, lz = p.dir.x;
      return { x: p.x + lx * r - p.dir.x * 0.4, y: p.y + 0.05, z: p.z + lz * r - p.dir.z * 0.4 };
    }
    // a player on their own (or walking along) stands in the middle of the space; players sharing one stand in a ring
    const shared = !centre && Object.values(this.pawns || {}).some((o) => o && o.slot !== slot && o.track === track && o.idx === idx);
    if (!shared) return { x: p.x, y: p.y + 0.05, z: p.z };
    return { x: p.x + Math.cos(a) * 0.95, y: p.y + 0.05, z: p.z + Math.sin(a) * 0.95 }; // pawns stand in a ring so they don't overlap
  }

  place(pawn) {
    pawn.group.position.set(pawn.x, pawn.y, pawn.z);
    pawn.group.scale.set(pawn.scale, pawn.scale, pawn.scale);
  }

  /**
   * The spots past a challenge that are not spaces (players stand there, but the way on counts the next space first):
   * the far bank of the crates-and-barrels pool, where a player who picked wrong swims to; and the way past the
   * volcano-or-not pit (the map's path point just short of the next space), where players come back out of the volcano
   * and where everyone chased by the spike ball ends up.
   */
  farBank(idx = CRATES_IDX) {
    if (idx === CRATES_IDX) return (this.fx && this.fx.sp && this.fx.sp.crates.out) || this.pos.island[CRATES_IDX];
    if (idx === VON_IDX) return islandWorld().aux['702'] || this.pos.island[VON_IDX + 1];
    return null;
  }

  /** The middle of where a pawn rests: its space's centre, or the spot past a challenge it stands on. */
  restCentre(pawn) { return pawn.across && pawn.track === 'island' && this.farBank(pawn.idx) ? this.farBank(pawn.idx) : this.pos[pawn.track][pawn.idx]; }

  snapPawn(pawn, at) {
    pawn.across = !!at.across; pawn.idx = at.idx; pawn.track = at.track;
    const p = this.nodeXYZ(at.track, at.idx, pawn.slot);
    pawn.track = at.track; pawn.idx = at.idx; pawn.x = p.x; pawn.y = p.y; pawn.z = p.z; pawn.scale = 1;
    this.place(pawn);
  }

  // ===================================================================== events (host -> everyone)
  onTurn(m) {
    this.queue.push(...m.events);
    this.idle = false;
  }

  /** Host messages may name players as {slot}; fill in their names here. */
  fillNames(text) { return esc(text).replace(/\{(\d+)\}/g, (m, d) => esc(this.nameOf(Number(d)))); }

  nameOf(slot) { return this.s.roster?.players[slot]?.name || `Player ${slot + 1}`; }

  startNext() {
    const ev = this.queue.shift();
    switch (ev.t) {
      case 'roundStart': {
        const names = ev.order.map((s) => esc(this.nameOf(s))).join(', ');
        if (!this.fromBlack) this.setBanner(`Round ${ev.round}<small>Order: ${names}</small><small>Random order for now. Minigames decide it later.</small>`);
        this.holdHud = false; this.refreshHud();
        const fade = app.ui.querySelector('#fade'), nm = app.ui.querySelector('#fadeName');
        if (this.fromBlack) { // straight after the flyover: stay black, cut to the first roller, show the order on black
          this.fromBlack = false; this.blackIn = true;
          this.clearBanner();
          this.camSlot = ev.order[0]; this.snapCamera = true; this.clearDice();
          nm.innerHTML = `<div style="text-align:center">Round ${ev.round}<div style="font-size:1.4rem;margin-top:10px">Order: ${names}</div></div>`;
          nm.style.opacity = '1'; fade.style.opacity = '1';
          this.anim = { t: 0, dur: ev.dur, end: () => { nm.style.opacity = '0'; } };
          break;
        }
        this.anim = { t: 0, dur: ev.dur, end: () => this.clearBanner() };
        break;
      }
      case 'turnStart': this.anim = this.beginTurnStart(ev); break;
      case 'flyover': this.anim = this.beginFlyover(ev); break;
      case 'eruption': {
        this.setEruption(ev.active);
        if (ev.dur) { this.shake = ev.dur; this.setBanner('The volcano erupts!<small>Lava turns every special space into a -4 for three turns.</small>'); }
        this.anim = { t: 0, dur: ev.dur, end: () => { this.shake = 0; if (ev.dur) this.clearBanner(); } };
        break;
      }
      case 'minigame': {
        this.setBanner(ev.kind === 'duel' ? `${esc(this.nameOf(ev.slot))} vs ${esc(this.nameOf(ev.opp))}<small>Minigames are not built yet: random result for now.</small>`
          : `${esc(this.nameOf(ev.slot))} vs the rest<small>Minigames are not built yet: random result for now.</small>`);
        this.anim = { t: 0, dur: ev.dur, end: () => this.clearBanner() };
        break;
      }
      case 'choiceStop': // the choice is made: take the Crates/Barrels buttons away right now
        this.control = null; this.stopSent = false;
        this.clearBanner();
        this.refreshHud();
        break;
      case 'broken': {
        const pawn = this.pawns[ev.slot ?? this.camSlot], show = pawn && this.fx ? this.fx.brokenAnim(ev, pawn) : null; // the smash itself (it used to be skipped: the event did not say who)
        this.setBanner(`${ev.challenge === 'dragon' ? 'The dragon wall' : 'The spike ball'} is smashed!<small>Everyone can pass it now.</small>`);
        this.anim = show || { t: 0, dur: ev.dur };
        const end = this.anim.end;
        this.anim.end = () => { if (end) end(); this.markBroken(ev.challenge); this.clearBanner(); };
        break;
      }
      case 'diceStart': {
        this.applyControl({ type: 'roll', slot: ev.slot, dice: ev.dice, label: ev.label, landed: ev.landed, wheel: ev.wheel });
        this.setBanner(this.controlBanner(this.control));
        this.fx.begin(ev.slot); // a challenge space: the camera stays put and the vine swings
        this.anim = { t: 0, dur: 0 };
        break;
      }
      case 'choiceStart': {
        this.applyControl({ type: 'choose', slot: ev.slot, label: ev.label, options: ev.options, slots: ev.slots, places: ev.places });
        this.setBanner(this.controlBanner(this.control));
        this.fx.begin(ev.slot);
        this.anim = { t: 0, dur: 0 };
        break;
      }
      case 'diceStop': this.anim = this.beginLand(ev); break;
      case 'space': {
        this.setBanner(this.fillNames(ev.text));
        const show = ev.fx ? this.fx.playNote(ev, this.pawns[ev.slot]) : null; // fireball, pit, crates
        this.anim = show || { t: 0, dur: ev.dur };
        const end = this.anim.end;
        this.anim.end = () => { if (end) end(); this.clearBanner(); };
        break;
      }
      case 'win':
        this.camSlot = ev.slot;
        this.openSummit();
        this.setBanner(`${esc(this.nameOf(ev.slot))} wins!`);
        this.anim = { t: 0, dur: ev.dur };
        break;
      case 'move': {
        const main = this.wrapMove(ev, this.beginMove(ev)), side = [];
        while (this.queue.length && this.queue[0].t === 'move' && this.queue[0].with) side.push(this.queue.shift()); // run at the same time
        this.anim = side.length ? this.together(ev, main, side) : main;
        break;
      }
      case 'ufo': this.anim = this.beginUfo(ev); break;
      case 'devJump': { // dev tools: the dice go away and the player is simply there
        this.control = null; this.stopSent = false; this.clearDice(); this.clearBanner();
        const pawn = this.pawns[ev.slot];
        if (pawn) { pawn.across = false; const q = this.nodeXYZ(ev.to.track, ev.to.idx, ev.slot, true); Object.assign(pawn, { track: ev.to.track, idx: ev.to.idx, x: q.x, y: q.y, z: q.z, liveAt: null, fx: null, scale: 1 }); pawn.group.visible = true; this.place(pawn); }
        this.camSlot = ev.slot; this.snapCamera = true; this.refreshHud();
        this.anim = { t: 0, dur: ev.dur };
        break;
      }
      default: break;
    }
  }

  /** Between turns: fade to black, show whose turn it is, fade back in. The camera cuts while it's black. */
  beginTurnStart(ev) {
    const fade = app.ui.querySelector('#fade'), nm = app.ui.querySelector('#fadeName');
    const c = PLAYER_COLORS[ev.slot];
    nm.innerHTML = `<span class="badge" style="--c:${c.hex};--ink-on:${c.ink}">${ev.slot + 1}</span><span>${esc(this.nameOf(ev.slot))}</span>`;
    this.clearBanner();
    if (this.fx) this.fx.reset();
    const blackIn = this.blackIn; this.blackIn = false; // coming straight from the black round screen: no fade-in
    const a = { t: 0, dur: ev.dur, cut: false };
    a.step = (u) => {
      const o = blackIn ? (u < 0.675 ? 1 : 1 - (u - 0.675) / 0.325) : u < 0.175 ? u / 0.175 : u < 0.675 ? 1 : 1 - (u - 0.675) / 0.325;
      fade.style.opacity = String(clamp01(o));
      nm.style.opacity = String(clamp01(o));
      if (!a.cut && u >= 0.2) { a.cut = true; this.camSlot = ev.slot; this.snapCamera = true; this.clearDice(); this.staged = true; this.shownTurn = ev.slot; this.refreshHud(); }
    };
    a.end = () => { fade.style.opacity = '0'; nm.style.opacity = '0'; this.camSlot = ev.slot; };
    return a;
  }

  /** Everyone has gone: black out, circle the whole mountain, black out again. The minigame will start after this. */
  beginFlyover(ev) {
    const fade = app.ui.querySelector('#fade');
    this.clearBanner(); this.clearDice(); this.setCounter(null);
    this.holdHud = true; this.shownTurn = null; this.refreshHud(); // the next round's order and dice tiers are not shown until the round starts
    const a = { t: 0, dur: ev.dur, cut: false };
    a.step = (u) => {
      const o = u < 0.07 ? u / 0.07 : u < 0.14 ? 1 - (u - 0.07) / 0.07 : u < 0.93 ? 0 : (u - 0.93) / 0.07;
      fade.style.opacity = String(clamp01(o));
      if (!a.cut && u >= 0.08) { a.cut = true; this.flying = true; }
      if (this.flying) {
        const v = clamp01((u - 0.07) / 0.86), ang = -0.6 + v * Math.PI * 2 * 1.05;
        const r = 150 - 25 * Math.sin(Math.PI * v), h = 62 + 18 * Math.sin(Math.PI * v);
        this.flyCam = { x: Math.cos(ang) * r, y: h, z: Math.sin(ang) * r, tx: 0, ty: 22, tz: 0 };
      }
    };
    a.end = () => { // leave the screen black: the round banner fades back in on the player camera
      this.flying = false; this.flyCam = null; this.snapCamera = true; this.fromBlack = true;
      fade.style.opacity = '1';
    };
    return a;
  }

  /** Volcano eruptions: every non-blank space on the island turns into a red lava -4 (-8, -12... when they stack). */
  setEruption(n) {
    this.eruptionCount = n;
    this.paintTiles();
  }

  /** A challenge that has been beaten for good (the guardian, the boulder): its set piece is gone for everybody. */
  markBroken(challenge) { if (this.fx) this.fx.setBroken(challenge); }

  // ===================================================================== 3D dice
  controlBanner(c) {
    const who = esc(this.nameOf(c.slot));
    return c.type === 'choose' ? `${who}<small>${esc(c.label || 'Pick a path')}</small>`
      : `${who} is rolling${c.label ? `<small>${esc(c.label)}</small>` : ''}`;
  }

  /** The host asked someone to stop the dice (or choose). Show it; every screen sees the same thing. */
  applyControl(c) {
    this.control = c;
    this.stopSent = false;
    if (this.camSlot == null) this.camSlot = c.slot;
    if (c.type === 'roll') { this.startSpinning(c.dice, c.landed); if (c.wheel) this.startWheel(c.wheel); }
  }

  dieMesh(tier) {
    const T = this.T, style = TIER_STYLE[tier] || TIER_STYLE.base;
    const mats = FACE_VALUES.map((v) => {
      const key = `${tier}:${v}`;
      const map = (this.dieTex[key] ||= dieFaceTexture(T, v, style));
      return new T.MeshLambertMaterial({ map });
    });
    mats.forEach((m) => { m.depthTest = false; m.depthWrite = false; m.transparent = true; }); // transparent list = drawn after the space labels, which are transparent too // dice always draw over the map and the pawns
    const mesh = new T.Mesh(new T.BoxGeometry(1.3, 1.3, 1.3), mats);
    mesh.renderOrder = 1000;
    return mesh;
  }

  addDie(tier, x, y = 0) {
    const T = this.T;
    const holder = new T.Group();
    holder.position.set(x, y, 0);
    holder.rotation.set(0.45, 0.3, 0); // a slight tilt so you always see the die's depth
    const mesh = this.dieMesh(tier);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const squash = new T.Group(); // squashed and stretched without skewing the tumbling cube
    squash.add(mesh);
    holder.add(squash);
    this.diceGroup.add(holder);
    const dir = () => (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5);
    const die = { holder, squash, mesh, x, tx: x, shift: false, sx: dir(), sy: dir(), sz: dir(), landing: false,
      drift: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5), axis: new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), spin: 9 + Math.random() * 6 };
    this.dice.push(die);
    return die;
  }

  // ---- the tornado / UFO wheel: a slice per player, spinning until Stop ----
  startWheel(info) {
    this.wheel = { slots: [...info.slots], purpose: info.purpose, theta: Math.random() * 6.28, landing: false };
    const el = this.wheelEl = app.ui.querySelector('#wheel');
    el.hidden = false; el.classList.toggle('left', info.purpose === 'tornado'); // the red die takes the right half
    this.wheelCtx = el.getContext('2d');
    this.diceGroup.position.x = info.purpose === 'tornado' ? 3.4 : 0;
  }

  hideWheel() {
    this.wheel = null;
    if (this.diceGroup) this.diceGroup.position.x = 0;
    const el = app.ui?.querySelector('#wheel');
    if (el) el.hidden = true;
  }

  /** Rotation that puts slice `k` under the pointer at the top (slices run clockwise from the top). */
  wheelTarget(from, k, n) {
    const sa = Math.PI * 2 / n, off = (((k * 37) % 7) - 3) * 0.07 * sa; // lands off-centre in its slice, same on every screen
    let to = -(k + 0.5) * sa + off;
    while (to < from + Math.PI * 6) to += Math.PI * 2; // at least three more turns
    return to;
  }

  drawWheel() {
    const w = this.wheel, g = this.wheelCtx;
    if (!w || !g) return;
    const S = this.wheelEl.width, R = S * 0.45, n = w.slots.length, sa = Math.PI * 2 / n;
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(w.theta);
    w.slots.forEach((slot, k) => {
      const c = PLAYER_COLORS[slot], a0 = -Math.PI / 2 + k * sa;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a0 + sa); g.closePath();
      g.fillStyle = c.hex; g.fill(); g.lineWidth = S * 0.012; g.strokeStyle = '#fff'; g.stroke();
      g.save(); g.rotate(a0 + sa / 2);
      g.fillStyle = c.ink; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.font = `bold ${S * (n > 4 ? 0.06 : 0.075)}px ${FONT}`;
      const name = this.nameOf(slot);
      g.fillText(name.length > 9 ? `${name.slice(0, 8)}\u2026` : name, R * 0.93, 0);
      g.restore();
    });
    g.beginPath(); g.arc(0, 0, S * 0.06, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.restore();
    g.lineWidth = S * 0.014; g.strokeStyle = '#16324f'; g.beginPath(); g.arc(S / 2, S / 2, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(S / 2 - S * 0.045, S * 0.015); g.lineTo(S / 2 + S * 0.045, S * 0.015); g.lineTo(S / 2, S * 0.1); g.closePath(); // the pointer
    g.fillStyle = '#ffd84a'; g.fill(); g.strokeStyle = '#16324f'; g.stroke();
  }

  setBadges(on) { // the pawns' number markers would draw on top of the dice
    for (const k of Object.keys(this.pawns || {})) if (this.pawns[k].badge) this.pawns[k].badge.visible = on;
  }

  clearDice() {
    this.staged = false;
    this.hideWheel();
    for (const d of this.dice) this.diceGroup.remove(d.holder);
    this.dice = [];
    this.diceGroup.visible = false;
    this.setBadges(true);
  }

  /**
   * Dice start spinning. `landed` = dice that already settled this turn (doubles): they stay put, face up,
   * and the new die spins next to them until its own Stop.
   */
  startSpinning(kinds, landed) {
    const T = this.T, keep = landed ? landed.length : 0;
    const total = keep + kinds.length;
    if (keep && this.dice.length === keep) {
      this.dice.forEach((d, i) => { d.tx = diceX(i, total); d.shift = true; }); // make room: slide over
    } else {
      this.clearDice();
      (landed || []).forEach((d, i) => { // (re)build the landed dice showing their result
        const die = this.addDie(d.kind === 'bonus' ? d.tier : d.kind === 'tornado' ? 'tornado' : 'base', diceX(i, total));
        const e = FACE_EULER[d.v];
        die.mesh.quaternion.setFromEuler(new T.Euler(e[0], e[1], e[2]));
        die.landing = true;
      });
    }
    kinds.forEach((k, i) => {
      const die = this.addDie(k.kind === 'bonus' ? k.tier : k.kind === 'tornado' ? 'tornado' : 'base', diceX(keep + i, total));
      die.tx = die.x;
    });
    this.diceGroup.visible = this.dice.length > 0; // the UFO has a wheel but no dice
    this.setBadges(!this.diceGroup.visible);
  }

  /** Each die turns to look straight at the eye, so the face it lands on is seen square-on (no top or side showing). */
  faceDiceToEye() {
    if (!this.dice || !this.dice.length || !this.diceGroup.visible) return;
    const T = this.T, eye = new T.Vector3(-this.diceGroup.position.x, -this.diceGroup.position.y, -this.diceGroup.position.z); // the camera, seen from the dice table
    this.zAxis ||= new T.Vector3(0, 0, 1);
    for (const die of this.dice) {
      if (!die.holder) continue;
      const d = eye.clone().sub(die.holder.position).normalize();
      die.holder.quaternion.setFromUnitVectors(this.zAxis, d);
    }
  }

  /** Stop pressed: the dice bounce way up, tumble into place and settle on the result. */
  beginLand(ev) {
    const T = this.T;
    this.control = null; this.stopSent = false;
    this.clearBanner();
    this.refreshHud(); // the Stop button and "Press Stop" go as soon as the dice land, however the roll was stopped
    // (no dice spinning: build them now. The UFO has only its wheel: building none would clear the wheel away with them)
    if (!this.dice.length && ev.dice.length) this.startSpinning(ev.dice.map((d) => ({ kind: d.kind, tier: d.tier })));
    const n = this.dice.length, off = Math.max(0, n - ev.dice.length); // doubles: only the newest die lands now
    ev.dice.forEach((d, i) => {
      const die = this.dice[off + i], e = FACE_EULER[d.v];
      die.landing = true; die.shift = false;
      die.fromX = die.holder.position.x; die.toX = diceX(off + i, n);
      die.startQ = die.mesh.quaternion.clone();
      die.endQ = new T.Quaternion().setFromEuler(new T.Euler(e[0], e[1], e[2]));
    });

    const wheel = ev.wheel && this.wheel, k = wheel ? Math.max(0, wheel.slots.indexOf(ev.wheel.target)) : 0;
    const w0 = wheel ? wheel.theta : 0, w1 = wheel ? this.wheelTarget(w0, k, wheel.slots.length) : 0;
    if (wheel) wheel.landing = true;
    const a = { t: 0, dur: ev.dur, shown: false };
    a.step = (u) => {
      if (wheel) { const f = clamp01(u / 0.75); wheel.theta = w0 + (w1 - w0) * (1 - Math.pow(1 - f, 3)); } // the wheel slows to a stop on its slice
      ev.dice.forEach((d, i) => {
        const die = this.dice[off + i];
        const p = clamp01((u - 0.05 * i) / 0.68);           // jump progress for this die
        const settle = clamp01(p / 0.9);                      // it finishes turning just before it stops bouncing
        const b = diceBounce(p);
        die.holder.position.x = die.fromX + (die.toX - die.fromX) * clamp01(u / 0.25) + die.drift * Math.sin(Math.PI * settle) * (1 - p);
        die.holder.position.y = b.y - 0.65 * (1 - b.sy);      // squashing keeps the bottom on the floor
        die.squash.scale.set(b.sxz, b.sy, b.sxz);
        const ease = 1 - Math.pow(1 - settle, 3);
        die.mesh.quaternion.copy(die.startQ).slerp(die.endQ, ease);
        this.tmpQ = this.tmpQ || new T.Quaternion();
        die.mesh.quaternion.premultiply(this.tmpQ.setFromAxisAngle(die.axis, die.spin * 6.75 * settle * Math.pow(1 - settle, 2))); // tumble that dies away
      });
      if (!a.shown && u > 0.6) {
        a.shown = true;
        if (ev.wheel) this.setBanner(`${esc(this.nameOf(ev.wheel.target))}<small>${ev.total ? `Back ${ev.total} spaces!` : 'is picked!'}</small>`);
        else this.setBanner(ev.partial
          ? `${esc(this.nameOf(ev.slot))} rolled ${ev.total}<small>Doubles! One more die to stop.</small>`
          : `${esc(this.nameOf(ev.slot))} rolled ${ev.total}${ev.doubles ? '<small>Doubles!</small>' : ''}`);
      }
    };
    // With doubles the two landed dice stay on the table: the bonus die joins them next.
    a.end = () => { if (!ev.partial) { this.clearDice(); this.clearBanner(); } };
    return a;
  }

  /** Dice that haven't been stopped yet keep tumbling. */
  updateDice(dt) {
    if (!this.dice.length) return;
    this.dice.forEach((d, i) => {
      if (d.shift) d.holder.position.x += (d.tx - d.holder.position.x) * (1 - Math.exp(-dt * 8)); // slide over for a new die
      if (d.landing) return;
      d.mesh.rotation.x += d.sx * dt; d.mesh.rotation.y += d.sy * dt; d.mesh.rotation.z += d.sz * dt;
      d.holder.position.y = Math.sin(this.t * 5 + i * 1.3) * 0.25;
    });
  }

  setCounter(count, remaining) {
    const el = app.ui.querySelector('#counter');
    if (!count) { el.hidden = true; return; }
    el.hidden = false;
    el.className = `counter${count.dir === 'back' ? ' back' : ''}`;
    el.textContent = `${count.dir === 'back' ? '-' : ''}${Math.max(0, remaining)}`;
  }

  /** The UFO swap, one step at a time: the camera cuts to the player, the UFO beams them up (or drops them off). */
  beginUfo(ev) {
    const pawn = this.pawns[ev.slot];
    if (!pawn) return { t: 0, dur: 1 };
    this.clearDice();
    if (ev.phase === 'down') { // they arrive at their new spot: put them there (out of sight), and look there
      const to = ev.to; pawn.track = to.track; pawn.idx = to.idx; pawn.across = !!to.across; // (swapped with someone on the pool's far bank: lands there)
      const q = this.nodeXYZ(to.track, to.idx, ev.slot);
      pawn.x = q.x; pawn.y = q.y; pawn.z = q.z; pawn.liveAt = null;
    }
    if (this.camSlot !== ev.slot || ev.phase === 'down') this.snapCamera = true; // a cut
    this.camSlot = ev.slot;
    const anim = this.fx.ufoAnim(ev.phase, pawn, ev.dur);
    return anim || { t: 0, dur: ev.dur };
  }

  /** The big spring (one per colour, made once): a coil with a plate on top, standing on a ring in the ground. */
  springFor(color) {
    this.springs ||= {};
    if (this.springs[color]) return this.springs[color];
    const T = this.T, hex = { blue: 0x2f6fed, red: 0xe5383b, green: 0x2fb344 }[color] || 0x2f6fed;
    const mat = new T.MeshLambertMaterial({ color: hex }), dark = new T.MeshLambertMaterial({ color: 0x3a3f46 });
    const group = new T.Group(), coilBox = new T.Group();
    const turns = 5, r = 0.95, pts = [];
    for (let i = 0; i <= turns * 24; i++) { const t = i / (turns * 24), a = t * turns * Math.PI * 2; pts.push(new T.Vector3(Math.cos(a) * r, t, Math.sin(a) * r)); }
    const coil = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), turns * 48, 0.17, 8, false), mat);
    coilBox.add(coil);
    const plate = new T.Mesh(new T.CylinderGeometry(1.25, 1.25, 0.28, 24), mat);
    const ring = new T.Mesh(new T.CylinderGeometry(1.45, 1.45, 0.12, 24), dark); ring.position.y = 0.04;
    group.add(coilBox, plate, ring); group.visible = false;
    this.scene3d.add(group);
    const sp = { group, set: (ext) => { coilBox.scale.set(1, SPRING_H * ext, 1); plate.position.y = SPRING_H * ext + 0.14; plate.visible = ext > 0.02; coil.visible = ext > 0.02; } };
    sp.set(0.001);
    return (this.springs[color] = sp);
  }

  beginMove(ev) {
    const pawn = this.pawns[ev.slot];
    if (!pawn || !ev.path.length) return null;
    if (this.fx) this.fx.unhide(pawn); // out of the hiding place (the camera has been elsewhere) before moving on
    // start from where they are shown (they may have stepped aside) and walk down the middle of every space
    const shownX = pawn.x + (pawn.ox || 0), shownZ = pawn.z + (pawn.oz || 0);
    pawn.x = shownX; pawn.z = shownZ; pawn.ox = 0; pawn.oz = 0;
    const bankXYZ = (idx) => { const q = this.farBank(idx); return { x: q.x, y: q.y + 0.05, z: q.z }; };
    const pts = [{ x: pawn.x, y: pawn.y, z: pawn.z }, ...ev.path.map((n) => (n.across && this.farBank(n.idx) ? bankXYZ(n.idx) : this.nodeXYZ(n.track, n.idx, ev.slot, true)))];
    if (ev.stopShort && ev.to && this.farBank(ev.to.idx)) pts[pts.length - 1] = bankXYZ(ev.to.idx); // ends on a spot past a challenge, short of the space: stops there
    const last = ev.stopShort && ev.to ? ev.to : ev.path[ev.path.length - 1], B = pts[pts.length - 1], A = pts[0];
    const a = { t: 0, dur: ev.dur, slotMoving: ev.slot };
    const count = ev.count;
    if (ev.follow) { this.camSlot = ev.slot; a.fast = true; } // someone else's pawn is flying: the camera pans over to it

    if (ev.mode === 'walk' || ev.mode === 'fast') {
      const n = pts.length - 1, stepMs = ev.mode === 'walk' ? 340 : 190;
      // cum[k] = how many of the first k steps count as spaces (challenge spaces are free)
      const cum = [0];
      ev.path.forEach((nd, k) => {
        const type = (nd.track === 'island' ? ISLAND : VOLCANO)[nd.idx].type;
        cum[k + 1] = cum[k] + (isChallenge(type) || type === 'exit' ? 0 : 1);
      });
      // the move is cut into legs: ordinary steps, jumps over gaps, the vine swing, the crates on the river
      this.idxBefore = pawn.track === ev.path[0].track && !pawn.across ? pawn.idx : null; // (from a spot past a challenge: already across, just walk on to the space)
      const legs = this.fx.buildLegs(ev, pts, stepMs, pawn);
      const hideLeg = this.fx.hideLegFor(ev, B); // running from the spike ball: the run ends ducked into the tunnel mouth
      if (hideLeg) legs.push(hideLeg);
      const total = legs.reduce((x, l) => x + l.ms, 0), moveFrac = Math.min(1, total / Math.max(1, ev.dur));
      if (count) this.setCounter(count, count.total);
      if (count && count.dir === 'back' && !this.camHold && !ev.side) { // running backwards: cut to a camera in front of the pawn and let it run towards it; nothing spins
        const dx = B.x - A.x, dz = B.z - A.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
        const cx0 = A.x - ux * 8.5 - uz * 3, cz0 = A.z - uz * 8.5 + ux * 3;
        this.camHold = { x: cx0, y: Math.max(A.y, B.y) + 7.5, z: cz0, tx: (A.x + B.x) / 2, ty: (A.y + B.y) / 2 + 1.6, tz: (A.z + B.z) / 2 };
        this.runHold = true;
        pawn.faceYaw = Math.atan2(pts[1].x - A.x, pts[1].z - A.z); pawn.yaw = pawn.faceYaw; // turn round instantly, not in a spin
      }
      a.step = (u) => {
        let ms = clamp01(u / moveFrac) * total, done = 0, leg = legs[legs.length - 1], l = 1;
        for (const lg of legs) { if (ms <= lg.ms) { leg = lg; l = lg.ms ? ms / lg.ms : 1; break; } ms -= lg.ms; done += lg.steps; }
        const P = leg.pose(clamp01(l));
        pawn.x = P.x; pawn.y = P.y; pawn.z = P.z;
        pawn.fx = P.fx ? { x: P.x, y: P.y, z: P.z, ...P.fx } : null;
        if (!P.fx) pawn.groundY = null; // back on their feet: no leftover "in the air" from a jump (arms up while running)
        this.place(pawn);
        const reached = Math.min(n, done + (leg.stepAt ? leg.stepAt(clamp01(l)) : Math.min(leg.steps, Math.floor(clamp01(l) * leg.steps + 1e-9))));
        if (reached > 0) pawn.liveAt = ev.path[reached - 1]; // the "Left" banner counts down as each space is reached
        if (count && leg.counter) { const c = leg.counter(clamp01(l)); if (c == null) app.ui.querySelector('#counter').hidden = true; else this.setCounter(count, c); }
        else if (count) this.setCounter(count, count.total - cum[reached]); // ticks down on each step
      };
    } else if (ev.mode === 'spring') {
      // A big spring pops out of the ground under the player, squashes, and bounces them the whole way in one jump
      // (blue: + space, red: - space, green: a minigame win or loss). Then it sinks back into the ground.
      const sp = this.springFor(ev.spring || 'blue'), H = SPRING_H, back = count && count.dir === 'back';
      const T1 = 0.16, T2 = 0.26, T3 = 0.72;  // rise out of the ground, squash, launch / landing, then sink away
      const lift = 4 + Math.hypot(B.x - A.x, B.z - A.z) * 0.16, fwd = this.pathDir(pawn);
      const faceYaw = Math.atan2(fwd.x, fwd.z); // facing along the path, so a backward bounce goes over their back
      sp.group.position.set(A.x, A.y, A.z); sp.group.visible = true; sp.group.rotation.y = faceYaw;
      a.fast = true;
      if (count) this.setCounter(count, count.total);
      a.step = (u) => {
        let ext, yOff = 0; // ext: how far the spring is out of the ground (0..1), and squashed/stretched
        if (u < T1) ext = ease01(u / T1);
        else if (u < T2) ext = 1 - 0.35 * Math.sin(Math.PI * (u - T1) / (T2 - T1)); // squash and spring back
        else if (u < T3) ext = 1 + 0.25 * Math.sin(Math.PI * clamp01((u - T2) / 0.08)) ;
        else ext = 1 - ease01((u - T3) / (1 - T3));
        sp.set(Math.max(0.001, ext));
        const top = A.y + H * Math.max(0, ext); // the player stands on the spring's top until it fires
        if (u < T2) { yOff = top - A.y; pawn.x = A.x; pawn.z = A.z; pawn.y = A.y + yOff; pawn.fx = { x: A.x, y: A.y + yOff, z: A.z, yaw: faceYaw, arms: [-0.4, -0.4], groundY: A.y }; }
        else {
          const f = clamp01((u - T2) / (T3 - 0.06 - T2)), y0 = A.y + H;
          const x = A.x + (B.x - A.x) * f, z = A.z + (B.z - A.z) * f, y = y0 + (B.y - y0) * f + Math.sin(f * Math.PI) * lift;
          const q = nearestPath(x, z), gy = q && q.d < 2.4 ? q.y + 0.08 : terrainHeight(x, z) + 0.14;
          pawn.x = x; pawn.y = y; pawn.z = z;
          pawn.fx = f < 1 ? { x, y, z, yaw: faceYaw, arms: [-2.8, -2.8], legs: [back ? -0.5 : 0.5, back ? 0.4 : -0.4], tilt: (back ? 0.35 : -0.35) * Math.sin(f * Math.PI), groundY: ev.path[0] && ev.path[0].track === 'volcano' ? Math.min(A.y, B.y) - 0.28 : gy } : null;
          if (count) this.setCounter(count, Math.round(count.total * (1 - f)));
        }
        this.place(pawn);
      };
      a.cleanup = () => { sp.group.visible = false; sp.set(0.001); };
    } else if (ev.mode === 'knock') {
      // Blown back by the dragon's fireball: one low arc backwards onto the space behind, still facing the dragon, then on their feet.
      const faceYaw = Math.atan2(A.x - B.x, A.z - B.z), lift = 1.6, T1 = 0.7;
      if (count) this.setCounter(count, count.total);
      a.step = (u) => {
        const f = clamp01(u / T1), e = 1 - (1 - f) * (1 - f); // fast off the ground, slowing into the landing
        const x = A.x + (B.x - A.x) * e, z = A.z + (B.z - A.z) * e, y = A.y + (B.y - A.y) * e + Math.sin(f * Math.PI) * lift;
        pawn.x = x; pawn.y = y; pawn.z = z; pawn.yaw = pawn.faceYaw = faceYaw;
        const land = clamp01((u - T1) / (1 - T1)); // a little stagger on landing, then upright
        pawn.fx = f < 1 ? { x, y, z, yaw: faceYaw, tilt: 0.55 * Math.sin(f * Math.PI) + 0.2, arms: [-2.4, -2.4], legs: [0.5, -0.3], groundY: Math.min(A.y, B.y) }
          : land < 1 ? { x, y, z, yaw: faceYaw, tilt: 0.25 * (1 - land), arms: [-1.2 * (1 - land), -1.2 * (1 - land)] } : null;
        if (count) this.setCounter(count, f < 1 ? count.total : 0);
        this.place(pawn);
      };
    } else if (ev.mode === 'fly' && ev.tornado && this.board && pawn.track === 'island') {
      Object.assign(a, this.tornadoAnim(ev, pawn, pts, count));
    } else if (ev.mode === 'fly' && ev.statue && this.statues && this.statues[pawn.idx] && this.statues[pawn.idx].rig) {
      Object.assign(a, this.statueThrowAnim(ev, pawn, this.statues[pawn.idx], A, B, count));
    } else if (ev.mode === 'fly') {
      // Fly for the first 60% of the time, then stay put so the camera catches up and you can see where you landed.
      const lift = 5 + Math.hypot(B.x - A.x, B.z - A.z) * 0.15;
      a.fast = true;
      if (count) this.setCounter(count, count.total);
      a.step = (u) => {
        const f = clamp01(u / 0.6);
        pawn.x = A.x + (B.x - A.x) * f; pawn.z = A.z + (B.z - A.z) * f;
        pawn.y = A.y + (B.y - A.y) * f + Math.sin(f * Math.PI) * lift;
        const q = nearestPath(pawn.x, pawn.z); // the shadow stays on the ground below while the pawn is in the sky
        pawn.groundY = q && q.d < 2.4 ? q.y + 0.08 : terrainHeight(pawn.x, pawn.z) + 0.14;
        if (ev.path[0] && ev.path[0].track === 'volcano') pawn.groundY = Math.min(A.y, B.y) - 0.28;
        this.place(pawn);
        if (count) this.setCounter(count, Math.round(count.total * (1 - f)));
      };
    } else {
      // 'drop' (into / out of the volcano): shrink away where you are, the camera STAYS for a few seconds,
      // fade to black, reappear at the destination (camera cut hidden by the black), fade in, hold.
      const D = DROP, total = Object.values(D).reduce((x, y) => x + y, 0);
      const pushed = pawn.track === 'island' && ISLAND[pawn.idx] && ISLAND[pawn.idx].type === 'volcanoOrNot' && ev.path[0].track === 'volcano';
      const t1 = D.shrink, t2 = t1 + D.hold, t3 = t2 + D.fadeOut, t4 = t3 + D.black, t5 = t4 + D.fadeIn;
      const fade = app.ui.querySelector('#fade'), nm = app.ui.querySelector('#fadeName');
      nm.style.opacity = '0';
      a.step = (u) => {
        const ms = u * total;
        this.pushing = pushed && ms < t3;
        if (ms < t3 && pushed) { // the block shoves the player into the pit, and they fall out of sight
          pawn.x = A.x; pawn.y = A.y; pawn.z = A.z; pawn.scale = 1;
          this.fx.volcanoPush(pawn, ms / t2, A);
          fade.style.opacity = ms < t2 ? '0' : String(clamp01((ms - t2) / D.fadeOut));
        } else if (ms < t3) { // still at the start: shrink, then just watch the spot for a moment
          pawn.x = A.x; pawn.y = A.y; pawn.z = A.z; pawn.scale = ms < t1 ? 1 - ms / t1 : 0;
          fade.style.opacity = ms < t2 ? '0' : String(clamp01((ms - t2) / D.fadeOut));
        } else {
          if (!a.switched) { a.switched = true; pawn.fx = null; pawn.track = last.track; pawn.idx = last.idx; pawn.across = !!last.across; this.snapCamera = true; this.clearDice(); }
          pawn.x = B.x; pawn.y = B.y; pawn.z = B.z;
          if (last.track === 'volcano') { // into the volcano: they come falling down from above
            const k = clamp01((ms - t4) / (total - t4)); pawn.scale = ms < t4 ? 0 : 1;
            pawn.fx = k < 1 ? { x: B.x, y: B.y + (1 - k) * (1 - k) * 24, z: B.z, tilt: (1 - k) * 0.8, arms: [-2.8, -2.8], groundY: B.y } : null;
          } else pawn.scale = ms < t4 ? 0 : clamp01((ms - t4) / D.fadeIn);
          fade.style.opacity = ms < t4 ? '1' : String(clamp01(1 - (ms - t4) / D.fadeIn));
        }
        this.place(pawn);
      };
    }
    a.end = () => {
      pawn.x = B.x; pawn.y = B.y; pawn.z = B.z; pawn.scale = 1; pawn.groundY = null; pawn.fx = null;
      if (this.fx && this.fx.endsHidden(ev, pawn)) { /* stays in the tunnel mouth (on the space as far as the game goes) */ }
      pawn.track = last.track; pawn.idx = last.idx; pawn.across = !!last.across; pawn.liveAt = null; this.pushing = false;
      if (a.cleanup) a.cleanup();
      this.fx.swinging = false;
      if (this.fx.active && this.fx.active.slot === ev.slot) { if (this.fx.active.kind === 'crates') this.fx.restoreCrates(); this.fx.release(); } // the challenge is over: the camera is free again
      if (this.runHold && !ev.side && this.fx.chase && this.fx.chase.cam) this.runHold = false; // (the camera stays on the rolling spike ball)
      else if (this.runHold && !ev.side) { this.runHold = false; this.camHold = null; this.snapCamera = true; const d = this.pathDir(pawn); pawn.faceYaw = Math.atan2(d.x, d.z); } // back to the follow camera, cut
      this.place(pawn);
      if (!ev.side) { this.setCounter(null); app.ui.querySelector('#fade').style.opacity = '0'; }
      this.refreshHud();
    };
    return a;
  }

  // ===================================================================== per frame
  update(dt) {
    if (this.broken) return;
    if (this.pausedHard) { this.renderer.render(this.scene3d, this.camera); return; } // offline pause: everything stands still
    this.t += dt;
    this.tickAnim(dt);
    if (this.fx) this.fx.update(dt);
    this.updateDice(dt);
    if (this.wheel && !this.wheel.landing) this.wheel.theta += 6.5 * dt; // spins until somebody presses Stop
    this.drawWheel();
    this.updateCamera(dt);
    this.updatePawnPose(dt);
    this.setBadges(!this.diceGroup.visible);
    for (const f of this.floaters) f.obj.position.y = f.base + Math.sin(this.t * 2) * 0.25;
    this.animateWorld(dt);
    this.faceDiceToEye();
    this.updateDuelPointer();
    this.drawMinimap();
    this.updateHudLive();
    if (this.devOpen || this.devPending) this.devTick();
    this.renderer.render(this.scene3d, this.camera);
  }

  tickAnim(dt) {
    if (!this.anim) {
      while (!this.anim && this.queue.length) this.startNext(); // events with nothing to show are skipped
      if (!this.anim) { if (!this.idle) this.syncIdle(); return; }
    }
    const a = this.anim;
    a.t += dt * 1000;
    const u = Math.min(1, a.t / Math.max(1, a.dur));
    if (a.step) a.step(u);
    if (u >= 1) { if (a.end) a.end(); this.anim = null; }
  }

  /** Nothing left to play: make sure what's on screen matches the host's truth, then show the HUD. */
  syncIdle() {
    this.idle = true;
    if (this.fx && !this.fx.active) this.fx.vine = null;
    if (!this.flying && !this.blackIn) { const f = app.ui.querySelector('#fade'); if (f && f.style.opacity === '1') f.style.opacity = '0'; }
    const b = this.s.board;
    if (this.fx && b.spikeNeeds && this.fx.spikeNumber !== b.spikeNeeds) this.fx.showSpikeNumber(b.spikeNeeds); // the number beside the spike statue
    for (const key of Object.keys(b.positions)) {
      const pawn = this.pawns[key], at = b.positions[key];
      if (pawn && (pawn.track !== at.track || pawn.idx !== at.idx || !!pawn.across !== !!at.across)) this.snapPawn(pawn, at);
    }
    if (b.over) this.setBanner(`${esc(this.nameOf(b.winner))} wins!<small>The host can return everyone to the lobby.</small>`);
    this.refreshHud();
  }

  /** The island is bright and open; the lava cave is dark and red. Switched behind the black fade. */
  setAmbience(track) {
    if (this.ambience === track) return;
    this.ambience = track;
    const cave = track === 'volcano', bg = cave ? 0x1a0a08 : 0x8fd0f2, LK = this.LK || 1;
    this.scene3d.background.set(bg); this.scene3d.fog.color.set(bg);
    this.scene3d.fog.near = cave ? 120 : 500; this.scene3d.fog.far = cave ? 600 : 2600;
    this.hemi.intensity = (cave ? 0.75 : 1.0) * LK; this.hemi.color.set(cave ? 0xffb08a : 0xffffff); this.hemi.groundColor.set(cave ? 0x6a2a1a : 0x9aa890);
    this.sun.intensity = (cave ? 0.2 : 0.7) * LK;
    this.showArea(track);
  }

  /**
   * The tornado space: the game's own tornado (world/tornado.js) forms round the player who was picked and lifts them
   * up, carries them back along the path spinning, dies away on the space they are blown back to, and drops them there.
   */
  tornadoAnim(ev, pawn, pts, count) {
    const T = this.T, D = TORNADO, dur = ev.dur || 7000, k = dur / 7000, frameMs = 1000 / TORNADO_FPS * k;
    if (!this.tornado) { this.tornado = makeTornado(T, D); this.scene3d.add(this.tornado.group); }
    const tor = this.tornado, g = tor.group, S = this.board.scale * TORNADO_SIZE;
    g.scale.setScalar(S); g.visible = false;
    const tForm = (D.clips.form.frames - 1) * frameMs, tFade = (D.clips.fade.frames - 1) * frameMs, tDrop = 450 * k;
    const tTravel = Math.max(500, dur - tForm - tFade - tDrop), t1 = tForm, t2 = t1 + tTravel, t3 = t2 + tFade;
    // the way back along the path, by distance
    const seg = [0]; for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const L = seg[seg.length - 1] || 1, A = pts[0], B = pts[pts.length - 1];
    const along = (s) => { // the point that far along the path
      let i = 1; while (i < seg.length - 1 && seg[i] < s) i++;
      const a = pts[i - 1], b = pts[Math.min(i, pts.length - 1)], f = seg[i] > seg[i - 1] ? clamp01((s - seg[i - 1]) / (seg[i] - seg[i - 1])) : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    };
    const out = { fast: true };
    if (count) this.setCounter(count, count.total);
    let lastY = A.y;
    out.step = (u) => {
      const t = u * dur;
      let at, clip, f;
      if (t < t1) { at = A; clip = 'form'; f = t / frameMs; }
      else if (t < t2) { const e = ease01((t - t1) / tTravel); at = along(e * L); clip = 'spin'; f = ((t - t1) / frameMs) % (D.clips.spin.frames - 1);
        if (count) this.setCounter(count, Math.round(count.total * (1 - e))); }
      else { at = B; clip = 'fade'; f = Math.min(D.clips.fade.frames - 1, (t - t2) / frameMs); if (count) this.setCounter(count, 0); }
      g.visible = t < t3; g.position.set(at.x, at.y, at.z);
      if (g.visible) tor.pose(clip, f);
      // the player rides the tornado's hook, spinning with it; once it has gone they drop onto the space
      const h = tor.hook(t < t3 ? clip : 'fade', t < t3 ? f : D.clips.fade.frames - 1);
      const lift = t < t1 ? clamp01(t / (tForm * 0.5)) : 1; // (lifted off the ground as it forms)
      let x = at.x + h.x * S, y = at.y + h.y * S * lift, z = at.z + h.z * S;
      const spinYaw = Math.atan2(h.x, h.z) + Math.PI / 2;
      if (t >= t3) { const d = clamp01((t - t3) / tDrop); x = B.x; z = B.z; y = lastY + (B.y - lastY) * d * d; }
      else lastY = y;
      pawn.x = x; pawn.y = y; pawn.z = z;
      pawn.fx = t >= t3 && y <= B.y + 0.01 ? null : { x, y, z, yaw: spinYaw, arms: [-2.6, -2.6], legs: [0.5, -0.4], tilt: t < t3 ? 0.25 : 0, groundY: at.y };
      this.place(pawn);
    };
    out.cleanup = () => { g.visible = false; };
    return out;
  }

  /**
   * A throwing statue (m001_30 blue, m001_31 red), rigged to play the game's own animations (see world/statueRig.js):
   * asleep it shows only its side hands and a dark gem. The two see-through glare cards in front of its face
   * (mr001m031/032) are not shown; the eyes and the gem (…_2) stay dark until it wakes.
   */
  setupStatue(g, model) {
    const out = { root: g, rig: null };
    g.traverse((m) => {
      if (!m.isMesh || !m.material) return;
      const n = m.material.name || '';
      if (/^mr001m03[12]$/.test(n)) m.visible = false;
      if (/^mr001m0(30|48)_2$/.test(n)) { m.material = m.material.clone(); out.eyes = m; }
    });
    try { out.rig = rigStatue(g, STATUES, model); } catch (e) { out.rig = null; }
    this.statueEyes(out, 0);
    return out;
  }

  /** How lit a statue's eyes and gem are: 0 dark (asleep) .. 1 glowing. */
  statueEyes(st, k) {
    if (!st || !st.eyes || !st.eyes.material.color) return;
    st.eyes.material.color.setScalar(0.22 + 0.78 * clamp01(k)); st.eyes.userData.lit = k;
  }

  /**
   * A statue throw, as in the Wii game: the statue plays the game's own animation, with its own cameras.
   *  - a wide shot of the statue with the player on the space in front of it. It wakes up: it rattles, its hands jiggle
   *    and its eyes and gem light up;
   *  - blue: its side hands swing round to the front and lie flat for the player, the statue nodding all the while; the
   *    player hops on and the nodding stops. A cut to the statue's side: the hands sink, then fling the player up and over;
   *  - red: it opens its mouth, its hands swing round and grab the player; a cut to the side: it shuts its mouth, lifts
   *    the player over its head and throws them across the island;
   *  - a cut to a camera high over the island that turns to follow the player across the sky;
   *  - a cut to a camera over the statue's platform: the player lands with a thump, stands, and walks off onto the space.
   *    (The statue goes back to sleep behind that cut.)
   */
  statueThrowAnim(ev, pawn, st, A, B, count) {
    const T = this.T, red = ev.statue === 'red', rig = st.rig, dur = ev.dur || STATUE_DUR, TL = statueTimeline(ev.statue, dur);
    const plat = STATUE_PLATFORMS[ev.statue], P = { x: plat.x, y: plat.y + 0.06, z: plat.z };
    const mesh = rig.mesh; mesh.updateWorldMatrix(true, false);
    const v3 = new T.Vector3(), toWorld = (x, y, z) => { v3.set(x, y, z).applyMatrix4(mesh.matrixWorld); return { x: v3.x, y: v3.y, z: v3.z }; };
    const qStatue = new T.Quaternion(); mesh.getWorldQuaternion(qStatue);
    const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI), m4 = new T.Matrix4(), qh = new T.Quaternion();
    const carried = (clip, f) => { // where the statue's hands hold the player (the game's hook_player bone), turned with them, facing the statue
      const H = rig.hook(clip, f);
      m4.set(H[0], H[1], H[2], 0, H[4], H[5], H[6], 0, H[8], H[9], H[10], 0, 0, 0, 0, 1); qh.setFromRotationMatrix(m4);
      return { p: toWorld(H[3], H[7], H[11]), q: qStatue.clone().multiply(qh).multiply(turn) };
    };
    const statueW = toWorld(0, 0, 0), faceStatue = Math.atan2(statueW.x - A.x, statueW.z - A.z);
    const dx = B.x - P.x, dz = B.z - P.z, dl = Math.hypot(dx, dz) || 1, edge = { x: P.x + dx / dl * Math.min(dl * 0.45, plat.r), y: P.y, z: P.z + dz / dl * Math.min(dl * 0.45, plat.r) };
    const walkYaw = Math.atan2(dx, dz);
    const lift = 40 + Math.hypot(P.x - A.x, P.z - A.z) * 0.3;
    // where the player gets on: blue, onto the flat hands (a hop from the space); red, where the hands close round them
    const onHands = carried(red ? 'throw' : 'launch', 0), getOn = onHands.p;
    const walkUp = Math.hypot(getOn.x - A.x, getOn.z - A.z) > 0.3; // (red: the space is where it grabs; if not, walk there first)
    // the cameras (world): a wide shot, a shot from the statue's side (the hands lifting and throwing), a high shot over the island, a shot over the platform
    const toS = { x: statueW.x - A.x, z: statueW.z - A.z }, sl = Math.hypot(toS.x, toS.z) || 1, ux = toS.x / sl, uz = toS.z / sl, wx = -uz, wz = ux;
    const wide = { x: A.x - ux * 13 + wx * 7, y: A.y + 6.5, z: A.z - uz * 13 + wz * 7, tx: (A.x + statueW.x) / 2, ty: A.y + 2.4, tz: (A.z + statueW.z) / 2 };
    // (the side shot goes on whichever side of the statue the ground in between is lower: no hill in front of the lens)
    const bump = (k) => { let m = -Infinity; for (let d = 6; d <= 16; d += 2) m = Math.max(m, terrainHeight(statueW.x + wx * k * d - ux, statueW.z + wz * k * d - uz) - statueW.y); return m; };
    const sk = bump(-1) <= bump(1) ? -1 : 1, sideY = statueW.y + Math.max(9, Math.max(bump(sk), 0) + 6); // (high enough to see over the ruins and platforms beside the statues)
    const side = { x: statueW.x + wx * sk * 16 - ux * 1, y: sideY, z: statueW.z + wz * sk * 16 - uz * 1, tx: statueW.x - ux * 1, ty: statueW.y + 4.2, tz: statueW.z - uz * 1 };
    const mid = { x: (A.x + P.x) / 2, y: Math.max(A.y, P.y), z: (A.z + P.z) / 2 }, fdx = P.x - A.x, fdz = P.z - A.z, fl = Math.hypot(fdx, fdz) || 1;
    const sky = { x: mid.x - fdx / fl * 30 - fdz / fl * 18, y: mid.y + lift + 34, z: mid.z - fdz / fl * 30 + fdx / fl * 18 };
    const over = { x: P.x - Math.sin(walkYaw) * 7 + Math.cos(walkYaw) * 3, y: P.y + 10, z: P.z - Math.cos(walkYaw) * 7 - Math.sin(walkYaw) * 3 };
    let shot = null;
    const cut = (name, cam) => { if (shot !== name) { shot = name; this.snapCamera = true; } this.camHold = cam; };
    const ms = TL.ms, flyFrom = carried(red ? 'throw' : 'launch', TL.at(TL.release).f).p; // where the hands let go
    const out = { fast: false };
    if (count) this.setCounter(count, count.total);
    const stand = (p, extra = {}) => { pawn.x = p.x; pawn.y = p.y; pawn.z = p.z; pawn.fx = { x: p.x, y: p.y, z: p.z, yaw: faceStatue, ...extra }; };
    out.step = (u) => {
      const t = u * dur;
      // the statue: the game's clips, then asleep again once the camera is over the platform
      if (t < TL.land) { const s = TL.at(t); rig.pose(s.clip, s.f, { jiggle: true }); this.statueEyes(st, clamp01((t - ms(8)) / (TL.lightUp - ms(8)))); }
      else if (rig.clip) { rig.pose(null); this.statueEyes(st, 0); }
      // the player
      if (t < TL.release) {
        const ready = t > ms(red ? 200 : 180) ? [-0.9, -0.9] : [0, 0];
        if (red) {
          if (t < TL.grab) { // waiting on the space (or walking up to where the hands will close)
            const k = walkUp ? clamp01((t - ms(150)) / ms(90)) : 0;
            stand(lerp3v(A, getOn, k), { arms: ready });
          } else if (t < TL.lift) stand(getOn, { arms: [-2.9, -2.9], legs: [0.2, -0.2] }); // grabbed
          else { const c = carried('throw', TL.at(t).f); stand(c.p, { quat: c.q, arms: [-2.9, -2.9], legs: [0.5, -0.5], groundY: A.y }); }
        } else if (t < TL.hop[0]) stand(A, { arms: ready });
        else if (t < TL.hop[1]) { // a hop from the space onto the flat hands
          const k = (t - TL.hop[0]) / (TL.hop[1] - TL.hop[0]);
          stand(hop(A, getOn, ease01(k), 1.3), { arms: [-2.4, -2.4], legs: [0.5 * Math.sin(Math.PI * k), -0.4 * Math.sin(Math.PI * k)], groundY: k < 0.5 ? A.y : getOn.y });
        } else if (t < TL.lift) stand(getOn, { arms: [-0.5, -0.5], groundY: getOn.y });
        else { // riding the hands: down, then flung up
          const f = TL.at(t).f, c = carried('launch', f);
          stand(c.p, { quat: c.q, arms: f < 58 ? [-0.5, -0.5] : [-2.8, -2.8], legs: f < 58 ? [0.35, -0.35] : [0.6, -0.5], groundY: f < 58 ? c.p.y : A.y });
        }
      } else if (t < TL.land) { // high over the island
        const f = (t - TL.release) / (TL.land - TL.release), s0 = flyFrom;
        const x = s0.x + (P.x - s0.x) * f, z = s0.z + (P.z - s0.z) * f, y = s0.y + (P.y - s0.y) * f + Math.sin(f * Math.PI) * lift;
        const q = nearestPath(x, z), gy = q && q.d < 2.4 ? q.y + 0.08 : terrainHeight(x, z) + 0.14;
        pawn.x = x; pawn.y = y; pawn.z = z;
        pawn.fx = { x, y, z, yaw: faceStatue + f * Math.PI * 6, arms: [-2.8, -2.8], legs: [0.6, -0.5], tilt: -0.6 * Math.sin(f * Math.PI), groundY: gy };
        if (count) this.setCounter(count, Math.round(count.total * (1 - f)));
      } else if (t < TL.walk) { // a thump on the platform, then a moment standing there
        const k = clamp01((t - TL.land) / (dur * 0.03));
        pawn.x = P.x; pawn.y = P.y; pawn.z = P.z;
        pawn.fx = { x: P.x, y: P.y - Math.sin(k * Math.PI) * 0.3, z: P.z, yaw: walkYaw, arms: [-0.7 * (1 - k), -0.7 * (1 - k)], legs: [0.5 * (1 - k), -0.5 * (1 - k)] };
        if (count) this.setCounter(count, 0);
      } else { // walk to the edge, step down, walk onto the space
        const k = (t - TL.walk) / (dur - TL.walk), s1 = { x: edge.x + (B.x - edge.x) * 0.35, y: B.y, z: edge.z + (B.z - edge.z) * 0.35 };
        const p = k < 0.4 ? lerp3v(P, edge, k / 0.4) : k < 0.6 ? hop(edge, s1, (k - 0.4) / 0.2, 0.6) : lerp3v(s1, B, (k - 0.6) / 0.4);
        pawn.x = p.x; pawn.y = p.y; pawn.z = p.z; pawn.fx = null; pawn.groundY = null; pawn.faceYaw = walkYaw;
      }
      this.place(pawn);
      // the camera
      if (t < (red ? ms(286) : TL.lift)) cut('wide', wide);
      else if (t < TL.release + ms(10)) cut('side', side);
      else if (t < TL.land - dur * 0.03) cut('sky', { ...sky, tx: pawn.x, ty: pawn.y, tz: pawn.z });
      else cut('platform', { ...over, tx: pawn.x, ty: pawn.y + 1, tz: pawn.z });
    };
    out.cleanup = () => { rig.pose(null); this.statueEyes(st, 0); this.camHold = null; this.snapCamera = true; };
    return out;
  }

  /** (Old quick throw: no longer used; statue throws have their own move.) */
  statueThrow() {}

  /**
   * Moves played at the same time (everyone on the stretch running from the spike ball): the first one leads (camera,
   * counter); the others run alongside, without a counter or a camera of their own.
   */
  together(ev, main, side) {
    const subs = [{ ev, a: main }];
    for (const e of side) { const a = this.beginMove({ ...e, count: null, side: true }); if (a) subs.push({ ev: e, a }); }
    const all = subs.filter((x) => x.a), dur = Math.max(...all.map((x) => x.a.dur || 0), 1);
    const slotsMoving = new Set(all.map((x) => x.ev.slot));
    const comp = { t: 0, dur, slotMoving: ev.slot, slotsMoving, fast: main && main.fast };
    comp.step = (u) => {
      const ms = u * dur;
      for (const x of all) {
        if (x.done) continue;
        const v = Math.min(1, ms / Math.max(1, x.a.dur));
        if (x.a.step) x.a.step(v);
        if (v >= 1) { x.done = true; slotsMoving.delete(x.ev.slot); if (x.a.end) x.a.end(); }
      }
    };
    comp.end = () => { for (const x of all) if (!x.done) { x.done = true; if (x.a.step) x.a.step(1); if (x.a.end) x.a.end(); } };
    return comp;
  }

  /** Extra pieces of a move: a statue's hands throwing the player, the volcano's way out lighting up. */
  wrapMove(ev, anim) {
    const pw = this.pawns[ev.slot];
    const st = pw && pw.track === 'island' && ev.mode === 'fly' && !ev.statue && this.statues && this.statues[pw.idx];
    if (st) { // the statue throws them: its hands come up under the player as they are launched
      const step = anim.step, end = anim.end;
      anim.step = (u) => { if (step) step(u); this.statueThrow(st, u); };
      anim.end = () => { if (end) end(); this.statueThrow(st, 1); };
    }
    if (pw && pw.track === 'volcano' && ev.path.some((n) => n.track === 'island') && this.exitGlow) { // the way out lights up as the player leaves
      for (const m of this.exitGlow) m.visible = true;
      const end = anim.end; anim.end = () => { if (end) end(); for (const m of this.exitGlow) m.visible = false; };
    }
    return anim;
  }

  /** Somebody won: the gate in front of the treasure opens and the light shines out of the summit. */
  openSummit() {
    if (this.gate) this.gate.visible = false;
    for (const m of this.rays || []) m.visible = true;
  }

  /** Only the place the camera is in is drawn: the volcano's inside would otherwise show on the island's horizon. */
  showArea(track) {
    if (!this.board) return;
    const cave = track === 'volcano';
    this.board.island.visible = !cave; this.board.sky.visible = !cave; this.board.volcano.visible = cave;
    if (this.fx && this.fx.root) this.fx.root.visible = !cave;
  }

  /**
   * Keeps the island out of the way of the camera. If hillside, cliff or temple wall is between the wanted camera spot and
   * the pawn, try the same shot swung round the pawn or lifted higher, and take the first that sees it. The choice is kept
   * for as long as it still works, so the camera does not flip back and forth. Under a roof (the cave tunnel) it comes close.
   */
  fitCamera(want, pawn) {
    if (terrainHeight(pawn.x, pawn.z) - pawn.y > 5) { // something overhead: stay low and near
      const dx = want.x - pawn.x, dz = want.z - pawn.z, d = Math.hypot(dx, dz) || 1;
      return { ...want, x: pawn.x + dx / d * 6, y: pawn.y + 3.4, z: pawn.z + dz / d * 6 };
    }
    const ox = want.x - pawn.x, oy = want.y - pawn.y, oz = want.z - pawn.z;
    const make = ([ang, dm, up]) => { const c = Math.cos(ang), sn = Math.sin(ang); return { ...want, x: pawn.x + (ox * c - oz * sn) * dm, y: pawn.y + oy + up, z: pawn.z + (ox * sn + oz * c) * dm }; };
    const blocked = (w) => {
      let worst = terrainHeight(w.x, w.z) + 1.5 - w.y;
      for (let k = 3; k <= 9; k++) { const f = k / 10; worst = Math.max(worst, terrainHeight(pawn.x + (w.x - pawn.x) * f, pawn.z + (w.z - pawn.z) * f) + 0.6 - (pawn.y + 1.6 + (w.y - pawn.y - 1.6) * f)); }
      return worst;
    };
    const O = BoardScene.CAM_OPTIONS;
    if (this.camPick != null && blocked(make(O[this.camPick])) <= 0) { if (this.camPick === 0 || blocked(make(O[0])) > -1.5) return make(O[this.camPick]); }
    let best = 0, bestV = Infinity;
    for (let i = 0; i < O.length; i++) { const v = blocked(make(O[i])); if (v <= 0) { best = i; bestV = v; break; } if (v < bestV) { bestV = v; best = i; } }
    this.camPick = best;
    return make(O[best]);
  }

  updateCamera(dt) {
    if (this.flying && this.flyCam) { // fixed orbit, no easing
      const f = this.flyCam;
      this.setAmbience('island');
      this.camera.position.set(f.x, f.y, f.z);
      this.camera.lookAt(f.tx, f.ty, f.tz);
      this.rolling = false;
      return;
    }
    const pawn = this.pawns[this.camSlot];
    if (!pawn) return;
    const volcano = pawn.track === 'volcano';
    this.setAmbience(pawn.track);
    // The chase camera sits behind the pawn along the way it is walking (so it follows the path round every bend).
    if (!this.cam || this.camTrack !== pawn.track) { const d0 = this.pathDir(pawn); pawn.faceYaw = Math.atan2(d0.x, d0.z); } // a fresh place: start looking down the path
    const way = pawn.faceYaw !== undefined ? { x: Math.sin(pawn.faceYaw), z: Math.cos(pawn.faceYaw) } : this.pathDir(pawn);
    const dist = volcano ? 12 : 13, height = volcano ? 9 : 9.5;
    let want = { x: pawn.x - way.x * dist, y: pawn.y + height, z: pawn.z - way.z * dist, tx: pawn.x + way.x * 3.5, ty: pawn.y + 1.6, tz: pawn.z + way.z * 3.5 };
    this.rolling = this.diceGroup.visible; // dice on screen: get close to the roller and look the way they will go
    if (this.rolling || this.staged) {
      const d = this.pathDir(pawn), c = (pawn.track === 'island' && pawn.idx === 0) ? pawn : (this.restCentre(pawn) || pawn); // aim at the space's centre (at the start: at the roller)
      want = { x: c.x - d.x * 12, y: pawn.y + 6.8, z: c.z - d.z * 12, tx: c.x + d.x * 7, ty: pawn.y + 1.8, tz: c.z + d.z * 7 }; // well back, the roller in the middle
    }
    // volcano or not: stand back and look at the rock face, the block and the player in front of it (as in the Wii game)
    const vn = this.fx && this.fx.sp && this.fx.sp.volcano, onV = !volcano && !pawn.across && ISLAND[pawn.idx] && ISLAND[pawn.idx].type === 'volcanoOrNot'; // (not someone already past it)
    const vView = vn && onV && !this.camHold && (this.rolling || this.pushing);
    if (vView) { const st = vn.star, d = vn.dir; want = { x: st.x + d.x * 11, y: st.y + 5.2, z: st.z + d.z * 11, tx: st.x - d.x * 0.6, ty: st.y + 2.2, tz: st.z - d.z * 0.6 }; }
    if (this.camHold) want = { ...this.camHold };
    if (!volcano && !this.camHold && !vView) want = this.fitCamera(want, pawn);
    if (!this.cam || this.camTrack !== pawn.track || this.snapCamera || this.camHold) { // cuts only happen behind a black screen
      this.cam = want; this.camTrack = pawn.track; this.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-dt * (this.rolling ? 2.5 : this.anim && this.anim.fast ? 6 : 3)); // follow faster during a throw
      for (const key of Object.keys(want)) this.cam[key] += (want[key] - this.cam[key]) * k;
    }
    const sh = this.shake > 0 ? 0.35 : 0; // a little rumble while the volcano erupts
    this.camera.position.set(this.cam.x + Math.sin(this.t * 53) * sh, this.cam.y + Math.sin(this.t * 61) * sh, this.cam.z + Math.cos(this.t * 47) * sh);
    this.camera.lookAt(this.cam.tx, this.cam.ty, this.cam.tz);
  }

  /** Flat unit vector along the path at this pawn's space (the way the next step goes). */
  pathDir(pawn) {
    const n = this.pos[pawn.track][pawn.idx];
    return n && n.dir ? { x: n.dir.x, z: n.dir.z } : { x: 0, z: 1 };
  }

  /**
   * Pawn poses. While the camera is on a roller, everyone in the shot turns to look up at it, and the roller's
   * space-mates step to the side so they are not in the way. Otherwise pawns face the way they are walking.
   */
  updatePawnPose(dt) {
    const k = 1 - Math.exp(-dt * 6), cam = this.camera.position;
    const focus = this.pawns[this.camSlot], focusMoving = this.anim && this.anim.slotMoving === this.camSlot;
    const spot = focus && !focusMoving ? focus : null; // whoever the camera is on stands in the middle of their space; the others step aside
    const roller = this.rolling ? spot : null;
    const dir = spot ? this.pathDir(spot) : null;
    const black = Number(app.ui.querySelector('#fade').style.opacity) > 0.95;
    const ko = black ? 1 : k; // behind a black screen pawns jump straight into place, so nobody is seen hopping aside
    const peers = spot ? Object.keys(this.pawns).map(Number).filter((q) => q !== this.camSlot && this.pawns[q].track === spot.track && this.pawns[q].idx === spot.idx).sort((a, b) => a - b) : [];
    let sideSign = 1;
    if (spot && spot.track === 'island') { // line the others up on the flatter side of the path
      const c0 = this.pos.island[spot.idx], lx = -dir.z, lz = dir.x;
      const hA = terrainHeight(c0.x + lx * 5, c0.z + lz * 5), hB = terrainHeight(c0.x - lx * 5, c0.z - lz * 5);
      if (Math.abs(hB - c0.y) < Math.abs(hA - c0.y)) sideSign = -1;
    }
    for (const key of Object.keys(this.pawns)) {
      const pawn = this.pawns[key];
      // what way are we walking? (from how far the pawn moved since the last frame)
      const mx = pawn.x - (pawn.lx ?? pawn.x), mz = pawn.z - (pawn.lz ?? pawn.z);
      pawn.lx = pawn.x; pawn.lz = pawn.z;
      if (pawn.faceYaw === undefined) { const d0 = this.pathDir(pawn); pawn.faceYaw = Math.atan2(d0.x, d0.z); pawn.yaw = pawn.faceYaw; }
      if (Math.hypot(mx, mz) > 8) { const d1 = this.pathDir(pawn); pawn.faceYaw = Math.atan2(d1.x, d1.z); pawn.yaw = pawn.faceYaw; } // teleported (volcano trip): face along the path there
      else if (Math.hypot(mx, mz) > 0.02) pawn.faceYaw = Math.atan2(mx, mz);

      // in the shot of the rolling camera? then look at it
      const dx = pawn.x - cam.x, dz = pawn.z - cam.z;
      let inShot = false;
      if (roller) {
        const ahead = dx * dir.x + dz * dir.z; // in front of the camera
        inShot = Math.hypot(dx, dz) < 26 && ahead > -2;
      }
      // space-mates of the roller step aside (the roller stands on the space's centre)
      let tox = 0, toz = 0, toh = 0;
      if (spot && pawn.track === spot.track && pawn.idx === spot.idx && !!pawn.across === !!spot.across) {
        const c = this.restCentre(pawn);
        if (spot.track === 'island' && spot.idx === 0) { /* everybody keeps their place in the start row */ }
        else if (pawn === spot) { if (!(this.fx.active && this.fx.active.slot === Number(key))) { tox = c.x - pawn.x; toz = c.z - pawn.z; } } else {
          const n = peers.indexOf(Number(key));
          let side, off;
          if (spot.track === 'island') { side = { x: -dir.z * sideSign, z: dir.x * sideSign }; off = 3.4 + n * 1.9; } // side by side next to the roller
          else { side = { x: dir.x, z: dir.z }; off = 4.1; } // in the cave there is no ground beside the slab: use the next slab along
          const across = spot.track === 'island' ? 0 : (n - (peers.length - 1) / 2) * 1.8;
          tox = c.x + side.x * off + -dir.z * across - pawn.x; toz = c.z + side.z * off + dir.x * across - pawn.z;
          if (spot.track === 'island') toh = 0;
          else toh = (this.pos.volcano[Math.min(this.pos.volcano.length - 1, spot.idx + 1)].y - c.y);
        }
      }
      pawn.ox = (pawn.ox || 0) + (tox - (pawn.ox || 0)) * ko;
      pawn.oz = (pawn.oz || 0) + (toz - (pawn.oz || 0)) * ko;
      pawn.oh = (pawn.oh || 0) + (toh - (pawn.oh || 0)) * ko;
      pawn.group.position.x = pawn.x + pawn.ox; pawn.group.position.z = pawn.z + pawn.oz; pawn.group.position.y = pawn.y + pawn.oh;
      if (pawn.fx) { // a challenge or a jump is taking over this pawn's body
        const F = pawn.fx;
        pawn.group.position.set(F.x, F.y, F.z);
        if (F.yaw !== undefined) { pawn.yaw = F.yaw; pawn.group.rotation.y = F.yaw; }
        pawn.groundY = F.groundY === undefined ? null : F.groundY;
      }
      pawn.group.rotation.x = pawn.fx && pawn.fx.tilt ? pawn.fx.tilt : 0;
      pawn.group.rotation.z = 0; // (only a statue's hands roll the pawn, through fx.quat below; nothing keeps that roll afterwards)
      pawn.group.scale.set(pawn.scale, pawn.scale, pawn.scale);
      this.animateLimbs(pawn, dt);

      let target = pawn.faceYaw;
      if (inShot) target = Math.atan2(cam.x - (pawn.x + pawn.ox), cam.z - (pawn.z + pawn.oz));
      const diff = Math.atan2(Math.sin(target - pawn.yaw), Math.cos(target - pawn.yaw));
      pawn.yaw += diff * k;
      pawn.pitch += ((inShot ? -0.55 : 0) - pawn.pitch) * k;
      pawn.group.rotation.y = pawn.yaw;
      if (pawn.fx && pawn.fx.quat) pawn.group.quaternion.copy(pawn.fx.quat); // carried by a statue's hands: turned with them
      if (pawn.head) pawn.head.rotation.x = pawn.pitch;
    }
  }

  /** Walking: legs and arms swing from the hips and shoulders in step with how fast the pawn is actually moving. */
  animateLimbs(pawn, dt) {
    const g = pawn.group, U = g.userData;
    const gx = g.position.x, gz = g.position.z;
    const moved = pawn.gx === undefined ? 0 : Math.hypot(gx - pawn.gx, gz - pawn.gz);
    pawn.gx = gx; pawn.gz = gz;
    const speed = dt > 0 ? (moved < 4 ? moved / dt : 0) : 0;            // jumps (teleports) do not count as running
    const want = Math.min(1, speed / 9);
    pawn.amp = (pawn.amp || 0) + (want - (pawn.amp || 0)) * Math.min(1, dt * 12);
    pawn.phase = (pawn.phase || 0) + Math.min(moved, 1.6) * 1.1;       // long strides: one full stride about every 5.7 units
    const sw = Math.sin(pawn.phase) * pawn.amp * 1.3, flying = pawn.groundY != null, F = pawn.fx;
    if (U.legs) {
      if (F && F.legs) { U.legs[0].rotation.x = F.legs[0]; U.legs[1].rotation.x = F.legs[1]; }
      else { U.legs[0].rotation.x = flying ? 0.5 : sw; U.legs[1].rotation.x = flying ? -0.4 : -sw; }
      if (F && F.arms) { U.arms[0].rotation.x = F.arms[0]; U.arms[1].rotation.x = F.arms[1]; }
      else { U.arms[0].rotation.x = flying ? -2.4 : -sw * 0.8; U.arms[1].rotation.x = flying ? -2.4 : sw * 0.8; } // arms up while flying
    }
    if (!F) g.position.y += Math.abs(Math.cos(pawn.phase)) * pawn.amp * 0.24;    // a little spring in each step
    if (U.shadow) this.placeShadow(pawn, U.shadow, flying);
  }

  /**
   * Lay a player's shadow on whatever is really under them (a space, a slope, a step, a statue's platform), tilted to
   * match it: five short rays straight down find the surface and its slope. In the sky it stays down there, smaller
   * and fainter. The shadow lives in the scene itself (not in the player), so the player's lean does not tilt it.
   */
  placeShadow(pawn, sh, flying) {
    const T = this.T, g = pawn.group;
    if (sh.parent === g && this.scene3d) { g.remove(sh); this.scene3d.add(sh); }
    sh.visible = g.visible !== false && pawn.scale > 0.05;
    if (!sh.visible) return;
    const x = g.position.x, y = g.position.y, z = g.position.z;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${pawn.groundY}`;
    if (pawn.shadowKey !== key) {
      pawn.shadowKey = key;
      const from = flying ? y : y + 1.2, far = flying ? Math.max(4, y - (pawn.groundY ?? y) + 6) : 3.2;
      const hit = (dx, dz) => this.groundHit(x + dx, from, z + dz, far);
      const c = hit(0, 0);
      let gy = c ? c.y : (flying ? pawn.groundY : y - 0.02), n = { x: 0, y: 1, z: 0 };
      if (c) {
        const R = 0.55, ax = hit(R, 0), bx = hit(-R, 0), az = hit(0, R), bz = hit(0, -R);
        const sx = ax && bx && Math.abs(ax.y - bx.y) < 1.4 ? (ax.y - bx.y) / (2 * R) : 0;      // a step edge is not a slope
        const sz = az && bz && Math.abs(az.y - bz.y) < 1.4 ? (az.y - bz.y) / (2 * R) : 0;
        const l = Math.hypot(sx, 1, sz); n = { x: -sx / l, y: 1 / l, z: -sz / l };
      }
      pawn.shadowAt = { y: gy, n };
    }
    const at = pawn.shadowAt, h = Math.max(0, y - at.y), k = 1 / (1 + h * 0.06);
    sh.position.set(x, at.y + 0.03, z);
    this.upAxis ||= new T.Vector3(0, 1, 0); this.tmpN ||= new T.Vector3();
    if (sh.quaternion.setFromUnitVectors) sh.quaternion.setFromUnitVectors(this.upAxis, this.tmpN.set(at.n.x, at.n.y, at.n.z));
    const s = (g.scale.x || 1) * k; sh.scale.set(s, s, s);
    sh.material.opacity = 0.28 * k;
  }

  /** The first solid, visible surface straight below a point (the island or the volcano's inside), or null. */
  groundHit(x, y, z, far) {
    const T = this.T, b = this.board;
    if (!b || !T.Raycaster) return null;
    this.ray ||= new T.Raycaster(); this.down ||= new T.Vector3(0, -1, 0); this.rayFrom ||= new T.Vector3();
    this.ray.set(this.rayFrom.set(x, y, z), this.down); this.ray.far = far;
    const hits = this.ray.intersectObject(b.volcano && b.volcano.visible ? b.volcano : b.island, true);
    if (!Array.isArray(hits)) return null;
    for (const h of hits) {
      const m = h.object, mat = m.material;
      if (!mat || mat.blending === T.AdditiveBlending || (mat.transparent && mat.opacity < 0.5) || (mat.name || '').startsWith('tms')) continue;
      let o = m, seen = true; while (o) { if (o.visible === false) { seen = false; break; } o = o.parent; }
      if (seen) return { y: h.point.y };
    }
    return null;
  }

  // ===================================================================== HUD
  buildHud() {
    app.ui.innerHTML = `
      <div class="wp-left" id="left" hidden><span class="wp-left-label">Left:</span><span class="wp-left-n" id="leftn"></span></div>
      <div class="wp-order" id="order" aria-label="Turn order"></div>
      <div class="wp-map"><canvas id="mm" width="360" height="360" aria-label="Map of every player's position"></canvas></div>
      <button class="wp-pause" data-act="pause" aria-label="Pause"><span></span><span></span></button>
      <div id="banner" class="banner"></div>
      <div id="loadnote" style="display:none;position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);background:rgba(16,40,60,.85);color:#fff;font:bold 22px sans-serif;padding:14px 22px;border-radius:14px"></div>
      <canvas id="wheel" class="wheel" width="760" height="760" hidden aria-label="Spinning wheel of players"></canvas>
      <div id="duel" class="duel" hidden></div>
      <canvas id="ptrs" class="ptrs" width="1280" height="720" aria-hidden="true"></canvas>
      <div id="counter" class="counter" hidden aria-live="polite"></div>
      <div class="hud-bottom">
        <div id="turnmsg" class="turnmsg"></div><br>
        <button id="stop" class="btn big" data-act="stop" hidden>Stop</button>
        <span id="choices" class="row" hidden></span>
      </div>
      <div id="pause" class="pause" hidden>
        <div class="pause-card" role="dialog" aria-label="Paused">
          <h2>Paused</h2>
          <div class="pause-sub" id="pauseSub"></div>
          <div class="standings" id="standings"></div>
          <div class="pause-btns">
            <button class="btn big" data-act="resume">Resume</button>
            ${this.s.role === 'host' ? '<button class="btn" data-act="lobby">Back to lobby</button>' : ''}
            <button class="btn ghost" data-act="leave">Leave game</button>
            ${this.s.offline ? '<button class="btn ghost" data-act="dev">Dev tools (` key)</button>' : ''}
          </div>
          <div class="pause-build">build ${BUILD}</div>
        </div>
      </div>
      <div id="dev" class="dev" hidden></div>
      <div id="fade" class="fade"><div id="fadeName" class="fade-name"></div></div>`;
    this.mm = app.ui.querySelector('#mm').getContext('2d');
    // while you are picking a 1v1 opponent, your mouse drives your custom pointer (the one from the pointer test), and everyone sees it
    this.unhookPointer();
    this.onPtr = (e) => {
      if (!app.toNormalized) return;
      const p = app.toNormalized(e.clientX, e.clientY);
      this.mouse = { x: p.x, y: p.y }; // always remembered, so the pointer starts where your mouse already is
      const c = this.duelShown;
      if (c && c.slot === this.s.mySlot) this.s.sendPointer(p.x, p.y, e.buttons);
    };
    for (const ev of PTR_EVENTS) addEventListener(ev, this.onPtr);
    this.hudKey = null; this.paused = false; this.pausedHard = false;
    app.ui.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'dev') { this.setPaused(false); this.toggleDev(true); return; }
      if (act === 'devclose') { this.toggleDev(false); return; }
      if (act && act.startsWith('dev:')) { const d = e.target.closest('[data-v]')?.dataset; this.devDo(act.slice(4), d?.v, d?.l); return; }
      if (act === 'pause') this.setPaused(true);
      else if (act === 'resume') this.setPaused(false);
      else if (this.paused && act !== 'lobby' && act !== 'leave') return;
      else if (act === 'stop') this.doStop();
      else if (act === 'choose') this.doChoose(Number(e.target.closest('[data-o]').dataset.o));
      else if (act === 'lobby') { this.setPaused(false); this.s.backToLobby(); }
      else if (act === 'leave') { this.setPaused(false); app.leave(); }
    };
  }

  // ---------------------------------------------------------------- dev tools (offline games only)
  /** A quick panel for trying things out: set the next roll, or put yourself right before any kind of space. */
  toggleDev(on = !this.devOpen) {
    if (!this.s.offline) return;
    this.devOpen = !!on;
    const el = app.ui.querySelector('#dev');
    if (!el) return;
    el.hidden = !this.devOpen;
    if (this.devOpen) this.fillDev();
  }

  fillDev(msg = '') {
    const el = app.ui.querySelector('#dev'), b = this.s.game && this.s.game.board;
    if (!el || !b) return;
    const yours = this.devReady(), p = this.devPending;
    this.devShownReady = yours;
    const btn = (act, v, label) => `<button class="btn small${p && p.act === act && p.v === String(v) ? ' on' : ''}" data-act="dev:${act}" data-v="${v}" data-l="${esc(String(label))}">${label}</button>`;
    const spaces = [['plus5', '+ space'], ['minus4', '- space'], ['ufo', 'UFO'], ['tornado', 'Tornado'], ['skull', 'Skull'], ['volcano', 'Volcano erupts'],
      ['mg11', '1 vs 1'], ['mgRest', '1 vs Rest'], ['statueBlue', 'Blue statue'], ['statueRed', 'Red statue'], ['dino', 'Dino'], ['blank', 'Blank']];
    const challenges = [['vine', 'Vine'], ['dragon', 'Dragon wall'], ['crates', 'Crates'], ['volcanoOrNot', 'Volcano or not'], ['spike', 'Spike ball'], ['final', 'Summit']];
    el.innerHTML = `<div class="dev-card" role="dialog" aria-label="Dev tools">
      <div class="dev-head"><strong>Dev tools</strong><span class="dev-sub">${p ? `Waiting for your dice: you go to <b>${esc(p.label)}</b> as soon as they spin. <button class="btn small ghost" data-act="dev:cancel" data-v="0">Cancel</button>` : yours ? 'Pick a spot: your dice go away and you land there.' : 'Pick a spot: you go there as soon as your dice spin on your turn.'}</span>
        <button class="btn small ghost" data-act="devclose">Close (\`)</button></div>
      ${msg ? `<div class="dev-msg">${esc(msg)}</div>` : ''}
      <div class="dev-sec">Land on a space <small>(the next one of that kind ahead of you)</small></div>
      <div class="dev-row">${spaces.map(([t, l]) => btn('land', t, l)).join('')}</div>
      <div class="dev-sec">Challenges <small>(you land on its star and it starts)</small></div>
      <div class="dev-row">${challenges.map(([t, l]) => btn('land', t, l)).join('')}</div>
      <div class="dev-sec">Other</div>
      <div class="dev-row">${btn('volcano', 1, 'Into the volcano')}${btn('start', 1, 'Back to the start')}</div>
      <div class="dev-sec">Set the next roll <small>(the next dice anyone stops${b.rigNext != null ? `; now set to ${b.rigNext}` : ''})</small></div>
      <div class="dev-row">${Array.from({ length: 12 }, (_, i) => btn('roll', i + 1, i + 1)).join('')}${btn('roll', 0, 'Random')}</div>
    </div>`;
  }

  /** Your own dice are spinning on a normal roll: a dev jump can happen right now. */
  devReady() {
    const b = this.s.game && this.s.game.board;
    return !!b && this.canStop() && !(this.control && this.control.wheel) && !b.step;
  }

  devTarget(act, v) {
    const b = this.s.game && this.s.game.board, cur = b.positions[this.s.mySlot];
    if (act === 'land') {
      const from = cur.track === 'island' ? cur.idx : 0;
      let idx = ISLAND.findIndex((n, i) => i > from && n.type === v);
      if (idx < 0) idx = ISLAND.findIndex((n) => n.type === v);
      return idx > 0 ? { track: 'island', idx } : null;
    }
    if (act === 'volcano') return { track: 'volcano', idx: 0 };
    if (act === 'start') return { track: 'island', idx: 0 };
    return null;
  }

  devDo(act, v, label = v) {
    const b = this.s.game && this.s.game.board;
    if (!b) return;
    if (act === 'roll') { b.rigNext = Number(v) || null; this.fillDev(Number(v) ? `Next roll: ${v}` : 'Next roll: random'); return; }
    if (act === 'cancel') { this.devPending = null; this.fillDev(); return; }
    if (!this.devTarget(act, v)) { this.fillDev('There is no space like that.'); return; }
    this.devPending = { act, v: String(v), label: String(label) };
    if (this.devReady()) this.devTick();
    else this.fillDev(); // not your dice yet: it happens by itself as soon as they spin
  }

  /** Every frame: carry out a waiting dev jump once your dice spin, and keep the panel's text current. */
  devTick() {
    if (this.devPending && this.devReady()) {
      const p = this.devPending, at = this.devTarget(p.act, p.v);
      this.devPending = null;
      if (at && this.s.devJump(at)) { this.toggleDev(false); return; }
      if (this.devOpen) this.fillDev('That did not work. Try again while your dice spin.');
      return;
    }
    if (this.devOpen && this.devShownReady !== this.devReady()) this.fillDev();
  }

  /** The pause menu. Offline (only CPU players) the game really stops; online it keeps going for everyone else. */
  setPaused(on) {
    on = !!on;
    if (on === this.paused) return;
    this.paused = on;
    const hard = on && !!this.s.offline && this.s.role === 'host';
    this.pausedHard = hard;
    if (this.s.setPaused) this.s.setPaused(hard);
    const el = app.ui.querySelector('#pause');
    if (el) el.hidden = !on;
    if (on) this.fillPause();
    this.refreshHud();
  }

  fillPause() {
    const b = this.s.board;
    if (!b) return;
    const hold = !!this.holdHud, round = hold ? Math.max(1, b.round - 1) : b.round;
    app.ui.querySelector('#pauseSub').textContent = `Round ${round}` + (this.pausedHard ? '' : ' \u00b7 the game keeps going for everyone else');
    const rows = Object.keys(b.positions).map(Number).map((i) => ({ i, left: this.leftFor(i) })).sort((x, y) => x.left - y.left);
    app.ui.querySelector('#standings').innerHTML = rows.map(({ i, left }) => {
      const c = PLAYER_COLORS[i], tier = !hold && b.tiers && b.tiers[i];
      const inV = this.pawns[i] && this.pawns[i].track === 'volcano';
      return `<div class="st-row" style="--c:${c.hex};--ink-on:${c.ink}"><img class="st-face" alt="" src="${this.faceUrl(i)}">
        <span class="st-name">${esc(this.nameOf(i))}</span><span class="st-meta">${inV ? 'in the volcano \u00b7 ' : ''}${left} left</span>
        ${tier ? `<span class="pill tier-${tier}">${TIER_STYLE[tier].name} die</span>` : ''}</div>`;
    }).join('');
  }

  setBanner(html) { app.ui.querySelector('#banner').innerHTML = html; }
  clearBanner() { app.ui.querySelector('#banner').innerHTML = ''; }

  canStop() {
    const c = this.control;
    return !!c && c.type === 'roll' && c.slot === this.s.mySlot && this.idle && !this.stopSent && !this.paused;
  }

  canChoose() {
    const c = this.control;
    return !!c && c.type === 'choose' && c.slot === this.s.mySlot && this.idle && !this.stopSent && !this.paused;
  }

  doStop() {
    if (!this.canStop()) return;
    this.stopSent = true;
    this.s.stop();
    this.refreshHud();
  }

  doChoose(option) {
    if (!this.canChoose()) return;
    this.stopSent = true;
    this.s.choose(option);
    this.refreshHud();
  }

  refreshHud() {
    const b = this.s.board, r = this.s.roster;
    if (!b || !r) return;
    const hold = !!this.holdHud; // hold: between rounds, nothing about the next round yet
    this.hudKey = null; // the order strip and the "Left" banner are redrawn on the next frame
    this.updateHudLive();
    if (this.paused) this.fillPause();
    const c = this.control, mine = this.shownTurn === this.s.mySlot;
    app.ui.querySelector('#turnmsg').textContent = hold ? '' : b.over ? `${this.nameOf(b.winner)} won!`
      : c && c.slot === this.s.mySlot ? (c.type === 'roll' ? 'Your turn! Press Stop (or Space)' : 'Your turn! Pick a path')
      : mine ? 'Your turn!' : (this.shownTurn == null ? '' : `${this.nameOf(this.shownTurn)}'s turn`);
    app.ui.querySelector('#stop').hidden = !this.canStop();
    const choices = app.ui.querySelector('#choices'), duel = app.ui.querySelector('#duel');
    // the 1v1 cards: everyone sees them (and the chooser's pointer); only the chooser can pick
    const showDuel = !!c && c.type === 'choose' && !!c.slots && this.idle && !this.paused && !(c.slot === this.s.mySlot && this.stopSent);
    const duelKey = showDuel ? `${c.slot}|${c.slots.join(',')}|${this.canChoose()}` : '';
    duel.hidden = !showDuel;
    if (duelKey !== this.duelKey) { this.duelKey = duelKey; duel.innerHTML = showDuel ? this.duelHtml(c) : ''; }
    this.duelShown = showDuel ? c : null;
    choices.hidden = !this.canChoose() || showDuel;
    if (choices.hidden) choices.innerHTML = '';
    else choices.innerHTML = c.options.map((o, i) => `<button class="btn big" data-act="choose" data-o="${i}">${esc(c.slots ? this.nameOf(c.slots[i]) : o)}</button>`).join('');
  }

  /** 1v1: one box per possible opponent, sorted by place, and a last "?" box that lets the game pick. */
  duelHtml(c) {
    const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
    const mine = this.canChoose(), n = c.slots.length;
    const pos = (i) => { const q = duelCardCenter(i, n); return `left:${q.x * 1280 - DUEL_CARD.w / 2}px;top:${q.y * 720 - DUEL_CARD.h / 2}px`; };
    const boxes = c.slots.map((slot, i) => {
      const attrs = mine ? `data-act="choose" data-o="${i}"` : 'tabindex="-1" aria-disabled="true"';
      if (slot == null) return `<button class="pbox random" ${attrs} data-card="${i}" style="${pos(i)}"><span class="pbox-place">&nbsp;</span><span class="pbox-q">?</span><span class="pbox-name">Random</span></button>`;
      const col = PLAYER_COLORS[slot];
      return `<button class="pbox" ${attrs} data-card="${i}" style="${pos(i)};--c:${col.hex};--ink-on:${col.ink}"><span class="pbox-place">${ord(c.places[i])}</span><span class="badge">${slot + 1}</span><span class="pbox-name">${esc(this.nameOf(slot))}</span></button>`;
    }).join('');
    const title = mine ? (c.label || 'Pick who to challenge') : `${this.nameOf(c.slot)} is picking who to challenge`;
    return `<div class="duel-title" style="top:${(DUEL_CARD.y - DUEL_CARD.h / 2 - 64)}px">${esc(title)}</div><div class="duel-row ${mine ? 'mine' : 'watching'}">${boxes}</div>`;
  }

  /**
   * Every frame while the 1v1 cards are up: the chooser's own mouse is sent to everyone (they see their normal mouse
   * pointer, not the custom one); everyone else sees the chooser's pointer, in the chooser's colour, and the card it
   * is over lifts up for them too.
   */
  unhookPointer() {
    if (this.onPtr) for (const ev of PTR_EVENTS) removeEventListener(ev, this.onPtr);
    this.onPtr = null;
    this.hideCursor(false);
  }

  /** Your own 1v1 pick: the custom pointer replaces the mouse cursor (as on the pointer test screen). */
  hideCursor(on) {
    if (!!on === !!this.cursorHidden) return;
    this.cursorHidden = !!on;
    if (typeof document !== 'undefined' && document.body && document.body.classList) document.body.classList.toggle('own-pointer', !!on);
  }

  updateDuelPointer() {
    const cv = app.ui.querySelector('#ptrs'), g = cv && cv.getContext ? cv.getContext('2d') : null, c = this.duelShown;
    if (g && g.clearRect) g.clearRect(0, 0, 1280, 720);
    const mineChoice = !!c && c.slot === this.s.mySlot;
    this.hideCursor(mineChoice && !this.devOpen); // the dev panel sits above the pointer layer, so the mouse cursor stays while it is open
    if (mineChoice && !this.duelMine && this.mouse && this.s.sendPointer) this.s.sendPointer(this.mouse.x, this.mouse.y, 0); // start where the mouse is
    this.duelMine = mineChoice;
    if (!c) { if (this.duelHover != null) this.duelHover = null; return; }
    const n = c.slots.length;
    let hover = -1;
    // the chooser's pointer, on every screen: the chooser's own included
    const p = this.s.getPointer ? this.s.getPointer(c.slot) : null;
    if (p) {
      if (g && g.save) {
        const col = PLAYER_COLORS[c.slot] || PLAYER_COLORS[0];
        drawPointer(g, p.x * 1280, p.y * 720, { color: col.hex, ink: col.ink, number: c.slot + 1, buttons: p.buttons, label: this.nameOf(c.slot) });
      }
      hover = duelCardAt(p.x, p.y, n);
    }
    if (hover !== this.duelHover) {
      this.duelHover = hover;
      const els = app.ui.querySelectorAll ? app.ui.querySelectorAll('#duel .pbox') : [];
      for (const el of els) if (el.classList) el.classList.toggle('hover', Number(el.dataset.card) === hover);
    }
  }

  /** Spaces left for a player (from the spot they will come out at, if they are in the volcano). */
  leftFor(i) {
    const b = this.s.board, pawn = this.pawns[i];
    const at = pawn ? (pawn.liveAt || { track: pawn.track, idx: pawn.idx }) : b.positions[i];
    return spacesToGo(at, b.volcanoReturn && b.volcanoReturn[i]);
  }

  /** Whose game the screen is showing right now: the player the camera is on. */
  focusSlot() {
    if (this.holdHud) return null;
    const f = this.camSlot ?? this.shownTurn;
    return f != null && this.pawns[f] ? f : null;
  }

  /** A little round portrait of a player's Mii (their hair and skin) on their colour, as an image URL. Cached. */
  faceUrl(i) {
    this.faces ||= {};
    if (this.faces[i]) return this.faces[i];
    const cv = document.createElement('canvas'); cv.width = cv.height = 96;
    const g = cv.getContext('2d'), col = PLAYER_COLORS[i].hex, hair = HAIR[i] || HAIR[0], skin = SKINS[i] || SKINS[0];
    const bg = g.createRadialGradient(36, 30, 6, 48, 48, 48); bg.addColorStop(0, shadeHex(col, 1.35)); bg.addColorStop(0.7, col); bg.addColorStop(1, shadeHex(col, 0.7));
    g.fillStyle = bg; g.beginPath(); g.arc(48, 48, 47, 0, Math.PI * 2); g.fill();
    const ell = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
    if (hair.style === 'long') { g.fillStyle = hair.c; g.beginPath(); g.ellipse(48, 56, 31, 32, 0, Math.PI, 0); g.lineTo(79, 82); g.lineTo(17, 82); g.fill(); }
    if (hair.style === 'bun') ell(48, 16, 11, 10, hair.c);
    ell(48, 56, 25, 27, skin);                                   // face
    ell(23, 58, 4, 6, shadeHex(skin, 0.9)); ell(73, 58, 4, 6, shadeHex(skin, 0.9)); // ears
    g.save(); g.beginPath(); g.ellipse(48, 52, 29, 32, 0, 0, Math.PI * 2); g.clip();   // hair over the top of the head
    g.fillStyle = hair.c; g.beginPath(); g.ellipse(48, 34, 30, 19, 0, 0, Math.PI * 2); g.fill();
    if (hair.style === 'short') { g.beginPath(); g.ellipse(58, 42, 16, 7, -0.3, 0, Math.PI * 2); g.fill(); }
    g.restore();
    if (hair.style === 'spiky') { g.fillStyle = hair.c; for (let k = 0; k < 5; k++) { const x = 26 + k * 11; g.beginPath(); g.moveTo(x - 7, 30); g.lineTo(x, 12 + (k % 2) * 5); g.lineTo(x + 7, 30); g.fill(); } }
    const ink = '#2a1d17';
    ell(39, 58, 3.2, 5, ink); ell(57, 58, 3.2, 5, ink);          // eyes
    g.strokeStyle = shadeHex(hair.c, 0.8); g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(34, 49); g.lineTo(43, 48); g.moveTo(53, 48); g.lineTo(62, 49); g.stroke(); // brows
    ell(48, 65, 2.6, 2, shadeHex(skin, 0.82));                  // nose
    g.strokeStyle = '#a2463a'; g.lineWidth = 2.2; g.beginPath(); g.arc(48, 70, 6, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); // smile
    const gl = g.createLinearGradient(0, 0, 0, 50); gl.addColorStop(0, 'rgba(255,255,255,0.45)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); // glass shine
    g.fillStyle = gl; g.beginPath(); g.ellipse(48, 24, 34, 20, 0, 0, Math.PI * 2); g.fill();
    return (this.faces[i] = cv.toDataURL());
  }

  /** Every frame: the "Left" banner and the turn-order strip. */
  updateHudLive() {
    const b = this.s.board;
    if (!b) return;
    const f = this.focusSlot(), order = (b.order && b.order.length ? b.order : Object.keys(b.positions).map(Number));
    const left = f == null ? null : this.leftFor(f);
    const key = `${f}|${left}|${order.join(',')}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      const lb = app.ui.querySelector('#left');
      lb.hidden = f == null;
      if (f != null) { const c = PLAYER_COLORS[f]; lb.style.setProperty('--c', c.hex); lb.style.setProperty('--cd', shadeHex(c.hex, 0.55)); app.ui.querySelector('#leftn').textContent = String(left); }
      app.ui.querySelector('#order').innerHTML = order.map((i, k) => {
        const c = PLAYER_COLORS[i], on = i === f;
        return `${k ? '<span class="wp-arrow">\u203a</span>' : ''}<span class="wp-dot${on ? ' on' : ''}" style="--c:${c.hex};--cl:${shadeHex(c.hex, 1.4)};--cd:${shadeHex(c.hex, 0.62)}" title="${esc(this.nameOf(i))}">${on ? `<img alt="${esc(this.nameOf(i))}" src="${this.faceUrl(i)}">` : ''}</span>`;
      }).join('');
    }
  }

  /** The course as a line seen from above, start at the bottom, fitted to the map's square. Worked out once per track. */
  mapShape(track) {
    this.mapGeo ||= {};
    if (this.mapGeo[track]) return this.mapGeo[track];
    const P = this.pos[track], raw = [];
    P.forEach((p, i) => { raw.push(p); if (i < P.length - 1) for (const q of legVia(track, i, i + 1)) raw.push(q); });
    let cx = 0, cz = 0; for (const p of raw) { cx += p.x; cz += p.z; } cx /= raw.length; cz /= raw.length;
    const a = Math.PI / 2 - Math.atan2(P[0].z - cz, P[0].x - cx), ca = Math.cos(a), sa = Math.sin(a); // turn so the start is at the bottom
    const rot = (p) => ({ x: (p.x - cx) * ca - (p.z - cz) * sa, y: (p.x - cx) * sa + (p.z - cz) * ca });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of raw) { const q = rot(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const k = 310 / Math.max(x1 - x0, y1 - y0, 1), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const to = (p) => { const q = rot(p); return { x: 180 + (q.x - mx) * k, y: 180 + (q.y - my) * k }; };
    return (this.mapGeo[track] = { to, line: raw.map(to) });
  }

  drawMinimap() {
    const g = this.mm, b = this.s.board;
    if (!g || !b) return;
    g.clearRect(0, 0, 360, 360);
    const f = this.focusSlot(), fp = f != null ? this.pawns[f] : null;
    const track = fp && fp.track === 'volcano' ? 'volcano' : 'island'; // the cave's map only while the camera is on someone in there
    const geo = this.mapShape(track), L = geo.line;
    // the path: a thick pale line with a darker rim, a round cap at the start
    g.lineJoin = 'round'; g.lineCap = 'round';
    const stroke = (w, c) => { g.beginPath(); L.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.lineWidth = w; g.strokeStyle = c; g.stroke(); };
    stroke(21, 'rgba(60,70,80,0.55)'); stroke(14, '#e9ecef');
    const s0 = L[0];
    g.fillStyle = 'rgba(60,70,80,0.55)'; g.beginPath(); g.arc(s0.x, s0.y, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e9ecef'; g.beginPath(); g.arc(s0.x, s0.y, 10.5, 0, Math.PI * 2); g.fill();
    // the players: on the island map, players in the volcano stay where they will come back out, faded
    const dots = [];
    for (const key of Object.keys(b.positions)) {
      const i = Number(key), pawn = this.pawns[i];
      if (!pawn) continue;
      if (track === 'volcano') { if (pawn.track === 'volcano') dots.push({ i, p: geo.to(pawn), faded: false }); continue; }
      if (pawn.track === 'island') dots.push({ i, p: geo.to(pawn), faded: false });
      else { const back = (b.volcanoReturn && b.volcanoReturn[i]) || EXIT_POS; dots.push({ i, p: geo.to(this.pos.island[back.idx]), faded: true }); }
    }
    // players on the same spot share one dot, whose colour takes turns between them
    const groups = [];
    for (const d of dots) {
      const gr = groups.find((q) => q.faded === d.faded && Math.hypot(q.p.x - d.p.x, q.p.y - d.p.y) < 11);
      if (gr) gr.who.push(d.i); else groups.push({ p: d.p, faded: d.faded, who: [d.i] });
    }
    groups.sort((x, y) => Number(y.faded) - Number(x.faded)); // faded ones underneath
    for (const gr of groups) {
      gr.who.sort((x, y) => x - y);
      const tick = Math.max(0, Math.floor((Number(this.t) || 0) / 0.8)), i = gr.who[tick % gr.who.length], col = (PLAYER_COLORS[i] || PLAYER_COLORS[0]).hex, { x, y } = gr.p;
      g.globalAlpha = gr.faded ? 0.38 : 1;
      const gd = g.createRadialGradient(x - 5, y - 6, 2, x, y, 16);
      gd.addColorStop(0, shadeHex(col, 1.55)); gd.addColorStop(0.45, col); gd.addColorStop(1, shadeHex(col, 0.62));
      g.fillStyle = gd; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  }

  /** Little things that move: the whirlwinds turn, and the loading note shows until the map is in. */
  animateWorld(dt) {
    for (const sp of this.spinners) sp.rotation.y += dt * 1.6;
    if (this.board && this.board.tick) this.board.tick(dt); // the map's own motion: the water runs (see world/water.js)
    const el = app.ui.querySelector('#loadnote');
    if (el && !this.debugNote) { const msg = this.loadError ? 'The island could not load: ' + this.loadError : this.loading ? 'Loading the island\u2026' : ''; if (el.textContent !== msg) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } }
  }
}
