// The challenges, played on the real map: the vine over the river gorge, the stone guardian, the crates and barrels
// on the waterfall pool, and the spiked boulder. Also every "long step" of the route (rope bridge, cave tunnel, temple
// stairs), which is walked through the map's own waypoints.
// The props (vine, guardian, crates, barrels, boulder) are the map's own models; they arrive with attach(board).
import { ISLAND, gapBetween } from '../game/boardData.js';
const islandTypeAt = (i) => ISLAND[i] && ISLAND[i].type;
import { DUR } from '../game/boardGame.js';
import { islandWorld, legVia, terrainHeight, MAP_SCALE } from '../game/boardLayout.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hop = (a, b, t, h) => { const p = lerp3(a, b, t); p.y += Math.sin(Math.PI * t) * h; return p; };

/** Walk along a chain of points at an even speed: returns pose(l), l = 0..1. */
function chainPose(chain) {
  const cum = [0];
  for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + dist(chain[i - 1], chain[i]));
  const total = cum[cum.length - 1] || 1;
  return (l) => {
    const d = clamp01(l) * total;
    for (let i = 1; i < chain.length; i++) if (d <= cum[i] || i === chain.length - 1) return lerp3(chain[i - 1], chain[i], clamp01((d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
    return { ...chain[0] };
  };
}
/** Several pieces one after another, each with a share of the time: [[weight, fn(t)], ...]. */
function sequence(parts) {
  const total = parts.reduce((s, p) => s + p[0], 0);
  return (l) => {
    let d = clamp01(l) * total;
    for (let i = 0; i < parts.length; i++) { if (d <= parts[i][0] || i === parts.length - 1) return parts[i][1](clamp01(d / (parts[i][0] || 1))); d -= parts[i][0]; }
    return parts[0][1](0);
  };
}

export const SWING_AMP = 0.85;   // how far the vine swings each way (radians)
const VINE_W = 2.1;
export const CHASE_SPEED = 17;
const HIDE_MS = 450;             // ducking into the tunnel mouth   // how fast the spike ball rolls down the stretch (world units per second)              // the vine's rhythm while a player swings on it (radians of phase per second)
export const FLOATERS = 3;       // crates / barrels in each lane of the pool

/** Where the set pieces are, worked out from the map's hooks (world units). */
export function challengeSpecs(W = islandWorld()) {
  const H = W.hooks, A = W.aux, gap = (k) => W.gaps.find((g) => g.kind === k);
  // ---- the vine
  const near = A['2'], far = A['3'], pivot = H.tarzan, ul = flat(near, far);
  const u = { x: (far.x - near.x) / ul, z: (far.z - near.z) / ul };
  const L = pivot.y - (near.y + far.y) / 2;   // the vine reaches down to the level of the two banks
  const swing = { g: gap('swing'), near, far, pivot, u, L, riverY: H.river.y };
  swing.tip = (th) => ({ x: pivot.x + u.x * Math.sin(th) * L, y: pivot.y - Math.cos(th) * L, z: pivot.z + u.z * Math.sin(th) * L });
  swing.hang = (th) => { const t = swing.tip(th); return { x: t.x, y: t.y - 3.9, z: t.z }; }; // the pawn's feet when its hands hold the end
  // ---- the dragon wall: the challenger stands on the star, facing the dragon
  const wall = { g: gap('wall'), at: H.enemy, stand: H.star1 };
  wall.yaw = Math.atan2(wall.stand.x - wall.at.x, wall.stand.z - wall.at.z);
  // ---- the pool: lane 0 = crates (the "step" hooks), lane 1 = barrels (the "taru" hooks)
  const lanes = [[H.step1, H.step2], [H.taru1, H.taru2]], water = H.taru1.y;
  const crates = { g: gap('crates'), water, stand: A['13'], out: A['17'], lanes: lanes.map(([a, b]) => {
    const spots = [];
    for (let k = 0; k < FLOATERS; k++) { const t = (k + 0.5) / FLOATERS; spots.push({ x: a.x + (b.x - a.x) * t, y: water, z: a.z + (b.z - a.z) * t }); }
    return { a, b, spots, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }) };
  crates.top = water + 1.75; // where a pawn's feet are when it stands on a crate or barrel
  // ---- the spiked boulder
  // the ball floats in the open mouth of the statue's head, which sits on a stone block (all part of the map)
  const S = MAP_SCALE, w = (x, y, z) => ({ x: x * S, y: y * S, z: z * S });
  // the volcano-or-not star: a stone block beside it shoves a failing player into the pit next to it
  const vStar = W.nodes[W.nodes.findIndex((_, i) => i > 0 && islandTypeAt(i) === 'volcanoOrNot')];
  // The block (map node m001_36) is a stone cube set in the rock face; its front face looks at the star along
  // (0.43, 0.90) (worked out from its geometry). It slides straight out along that, and the pit is right in front.
  const fl = Math.hypot(0.43, 0.9), dir = { x: 0.43 / fl, z: 0.9 / fl };
  const volcano = { star: vStar, pit: { x: vStar.x + dir.x * 3.2, y: vStar.y, z: vStar.z + dir.z * 3.2 }, dir, block: 'm001_36' };
  // The ball's own stops, from the spare copies of it the map keeps: in the statue's mouth (from), rolled out onto the
  // ledge in front of the statue (popTo), and at the far end of the stretch, going over the edge (overEdge). Players
  // escape the ball by ducking into the tunnel mouth beside the last space of the stretch (hide).
  const pit = { g: gap('pit'), stand: H.star2, from: w(-1425, 2350, 0), mid: H.count, head: w(-1612, 2281, 212), R: 2.5,
    popTo: w(-2050, 2340, 0), overEdge: w(1205, 1480, 1825), hide: w(524, 1505, 1670) };
  return { swing, wall, crates, pit, volcano };
}

export class ChallengeFX {
  constructor(scene) {
    this.s = scene; this.T = scene.T; this.W = islandWorld(); this.sp = challengeSpecs(this.W);
    this.active = null; this.vine = null; this.swinging = false; this.pending = null; this.broken = {};
    this.ropeTheta = 0; this.debris = []; this.shot = null; this.chase = null; this.o = null; this.walkTo = null; this.hidden = new Map();
    this.root = new this.T.Group(); scene.scene3d.add(this.root);
    // things that do not need the map's models
    const T = this.T;
    this.fire = new T.Mesh(new T.SphereGeometry(1.1, 12, 8), new T.MeshBasicMaterial({ color: 0xff8a2a })); this.fire.visible = false; this.root.add(this.fire);
    this.chips = [];
    for (let i = 0; i < 26; i++) { const m = new T.Mesh(new T.BoxGeometry(0.7, 0.5, 0.6), new T.MeshLambertMaterial({ color: i % 2 ? 0x9a948a : 0xb9b2a6 })); m.visible = false; this.root.add(m); this.chips.push(m); }
  }

  /** The map has loaded: build the set pieces from its prop models. */
  attach(board) {
    const T = this.T, sp = this.sp, make = (name) => {
      const h = new T.Group(), tpl = board.props.get(name);
      if (tpl) h.add(tpl.clone(true));
      h.scale.setScalar(board.scale); this.root.add(h); return h;
    };
    const o = this.o = {};
    o.rope = make('m001_20'); o.rope.position.set(sp.swing.pivot.x, sp.swing.pivot.y, sp.swing.pivot.z);
    o.ropeAxis = new T.Vector3(-sp.swing.u.z, 0, sp.swing.u.x);
    // the dragon wall: m001_35l is the dragon at rest; m001_35 is the same with fire in its mouth, shown only while it shoots
    o.guard = make('m001_35l'); o.guard.position.set(sp.wall.at.x, sp.wall.at.y, sp.wall.at.z); o.guard.rotation.y = sp.wall.yaw;
    o.guardFire = make('m001_35'); o.guardFire.position.copy(o.guard.position); o.guardFire.rotation.y = sp.wall.yaw; o.guardFire.visible = false;
    o.ball = this.mapBall(board);
    // the spike ball statue: a monster head that holds the ball in its open mouth, sitting on a stone block. Both are part
    // of the map (m001_50), but the converted map left the head at the middle of the island, under the ground.
    o.statue = this.spikeHead(board);
    o.plate = []; board.island.traverse((m) => { if (m.isMesh && /^mr001m0(67|68|86_[2-5])$/.test(m.material && m.material.name || '') && m.parent && /m001_51/.test(m.parent.name + m.name)) o.plate.push(m); });
    o.block = board.island.getObjectByName(sp.volcano.block); o.S = board.scale;
    // the UFO (m001_82, without its painted-on shadow) and its striped tractor beam (m001_83, 450 tall)
    o.ufo = make('m001_82'); o.ufo.visible = false;
    o.ufo.traverse((m) => { if (m.isMesh && m.material && /^mr001m032/.test(m.material.name || '')) m.visible = false; });
    o.beam = make('m001_83'); o.beam.visible = false;
    o.floaters = sp.crates.lanes.map((lane, li) => lane.spots.map((p, k) => {
      const m = make(li === 0 ? (k % 2 ? 'm001_27' : 'm001_26') : (k % 2 ? 'm001_29' : 'm001_28'));
      m.position.set(p.x, p.y + 0.45, p.z); m.rotation.y = lane.yaw; return m;
    }));
    // the map is loaded once and shared, so a statue smashed earlier (in a game, or the viewer's demo) is put back first
    if (o.statue) o.statue.visible = true;
    for (const m of o.plate) m.visible = true;
    for (const k of Object.keys(this.broken)) this.setBroken(k);
  }

  /**
   * The spike statue's head. In the map it is part of the same mesh as the block it sits on, but it was left at the map's
   * centre: split it off and put it on its block (centre x -1400, z 0, top 175 above 2050), mouth toward the path, where
   * it closes round the floating spike ball.
   */
  spikeHead(board) {
    const T = this.T; let src = null;
    board.island.traverse((m) => {
      if (src || !m.isMesh || !m.material || m.material.name !== 'mr001m067') return;
      let p = m; while (p && !/m001_50/.test(p.name || '')) p = p.parent;
      if (p) src = m;
    });
    if (!src) return null;
    if (src.userData.spikeHead) return src.userData.spikeHead;
    const g = src.geometry, pos = g.attributes.position, idx = g.index, n = (idx ? idx.count : pos.count) / 3;
    const vi = (t, v) => (idx ? idx.getX(t * 3 + v) : t * 3 + v), head = [], rest = [];
    for (let t = 0; t < n; t++) { const cx = (pos.getX(vi(t, 0)) + pos.getX(vi(t, 1)) + pos.getX(vi(t, 2))) / 3; (Math.abs(cx) < 600 ? head : rest).push(t); }
    if (!head.length) return null;
    const pick = (tris) => {
      const out = new T.BufferGeometry();
      for (const [k, a] of Object.entries(g.attributes)) {
        const sz = a.itemSize, arr = new Float32Array(tris.length * 3 * sz), get = ['getX', 'getY', 'getZ', 'getW'];
        tris.forEach((t, i) => { for (let v = 0; v < 3; v++) { const j = vi(t, v); for (let c = 0; c < sz; c++) arr[(i * 3 + v) * sz + c] = a[get[c]](j); } });
        out.setAttribute(k, new T.BufferAttribute(arr, sz));
      }
      out.computeBoundingSphere();
      return out;
    };
    const mesh = new T.Mesh(pick(head), src.material);
    src.geometry = pick(rest);
    mesh.position.set(-1400, 2050, 0); mesh.rotation.y = -Math.PI / 2; // in the map's own units, like the mesh it came from
    mesh.name = 'spike_head';
    src.add(mesh);
    src.userData.spikeHead = mesh;
    return mesh;
  }

  /**
   * The spike ball floating by the statue is part of the island model. Re-centre it so it can roll, and hide the loose
   * copies of it that the converted map scatters along the ball's old course.
   */
  mapBall(board) {
    const S = board.scale, parts = [], home = this.sp.pit.from;
    board.island.traverse((m) => {
      if (!m.isMesh || !m.material) return;
      const n = m.material.name || '';
      if (n === 'mr001m016' || n === 'mr001m016_2') m.visible = false;
      if (n === 'mr001m016_21' || n === 'mr001m016_22') parts.push(m);
    });
    for (const m of parts) { if (m.userData.recentred) continue; m.userData.recentred = true; m.geometry = m.geometry.clone(); m.geometry.translate(-home.x / S, -home.y / S, -home.z / S); m.frustumCulled = false; }
    const ball = {
      parts, home, at: { ...home }, spinX: 0,
      set(p) { this.at = { ...p }; for (const m of parts) m.position.set(p.x / S, p.y / S, p.z / S); },
      spin(a) { this.spinX = a; for (const m of parts) m.rotation.x = a; },
      show(v) { for (const m of parts) m.visible = v; },
      get visible() { return parts.length ? parts[0].visible : false; },
      goHome() { this.set(home); this.spin(0); },
    };
    ball.goHome();
    return ball;
  }

  reset() { this.pending = null; }

  // ------------------------------------------------------------------ camera
  /** A fixed camera spot that really sees `t`: tries both sides and a few distances and heights, staying clear of the ground. */
  clearCam(base, side, dists, ups, t) {
    let best = null;
    for (const sg of [1, -1]) for (const d of dists) for (const up of ups) {
      const a = { x: base.x + side.x * sg * d, y: base.y + up, z: base.z + side.z * sg * d };
      a.y = Math.max(a.y, terrainHeight(a.x, a.z) + 3);
      let worst = 0;
      for (let k = 1; k <= 8; k++) { const f = k / 10, y = a.y + (t.y - a.y) * f; worst = Math.max(worst, terrainHeight(a.x + (t.x - a.x) * f, a.z + (t.z - a.z) * f) + 0.8 - y); }
      const score = worst + d * 0.02 + up * 0.03;
      if (!best || score < best.score) best = { a, score };
    }
    return { x: best.a.x, y: best.a.y, z: best.a.z, tx: t.x, ty: t.y, tz: t.z };
  }

  holdFor(kind) {
    const sp = this.sp;
    if (kind === 'vine') { const v = sp.swing, t = v.tip(0), side = { x: -v.u.z, z: v.u.x }; return this.clearCam({ x: t.x, y: v.near.y, z: t.z }, side, [24, 30, 36], [7, 12, 18], { x: t.x, y: v.near.y + 1, z: t.z }); }
    if (kind === 'dragon') { const w = sp.wall, m = lerp3(w.stand, w.at, 0.5), d = flat(w.stand, w.at) || 1, side = { x: -(w.at.z - w.stand.z) / d, z: (w.at.x - w.stand.x) / d };
      return this.clearCam({ x: m.x - (w.at.x - w.stand.x) / d * 6, y: m.y, z: m.z - (w.at.z - w.stand.z) / d * 6 }, side, [11, 15, 20], [6, 9, 13], { x: m.x, y: m.y + 2.2, z: m.z }); }
    if (kind === 'crates') { const c = sp.crates, a = lerp3(c.lanes[0].a, c.lanes[1].a, 0.5), b = lerp3(c.lanes[0].b, c.lanes[1].b, 0.5), m = lerp3(a, b, 0.5), d = flat(a, b) || 1;
      return this.clearCam({ x: m.x, y: c.water, z: m.z }, { x: (a.x - b.x) / d, z: (a.z - b.z) / d }, [20, 25, 30], [11, 15, 20], { x: m.x, y: c.water + 1, z: m.z }); }
    if (kind === 'spike') { const p = sp.pit, d = flat(p.stand, p.from) || 1, back = { x: (p.stand.x - p.from.x) / d, z: (p.stand.z - p.from.z) / d };
      return this.clearCam(p.stand, back, [10, 14], [7, 10, 14], { x: (p.stand.x + p.mid.x) / 2, y: p.stand.y + 2.5, z: (p.stand.z + p.mid.z) / 2 }); }
    return null;
  }

  /** A challenge roll or choice is starting: the pawn takes its place and the camera stays put. */
  begin(slot) {
    const pawn = this.s.pawns[slot];
    if (!pawn || pawn.track !== 'island') return;
    const kind = ISLAND[pawn.idx].type;
    if (!['vine', 'dragon', 'crates', 'spike'].includes(kind) || this.broken[kind]) return;
    if (this.active && this.active.slot === slot && this.active.kind === kind) return;
    this.active = { slot, kind };
    const hold = this.holdFor(kind);
    if (hold) this.s.camHold = hold;
    if (kind === 'vine') this.vine = { slot, t: 0, from: { x: pawn.x, y: pawn.y, z: pawn.z } }; // leap onto the vine and swing while the die rolls
    if (kind === 'dragon') this.walkTo = { slot, to: this.sp.wall.stand };
    if (kind === 'crates') { this.restoreCrates(); this.walkTo = { slot, to: this.sp.crates.stand }; } // every player gets a full set
    if (kind === 'spike') this.walkTo = { slot, to: this.sp.pit.stand };
  }

  release() {
    this.active = null; this.walkTo = null; // (a spike ball still rolling keeps rolling)
    if (this.s.camHold && !this.s.runHold) { this.s.camHold = null; this.s.snapCamera = true; }
  }

  // ------------------------------------------------------------------ broken for good
  setBroken(kind) {
    this.broken[kind] = true;
    if (this.o && kind === 'dragon') { this.o.guard.visible = false; this.o.guardFire.visible = false; }
    if (this.o && kind === 'spike') { if (this.o.ball) this.o.ball.show(false); if (this.o.statue) this.o.statue.visible = false; for (const m of this.o.plate) m.visible = false; } // the statue is broken for good
  }

  burst(at, n = 26) {
    for (let i = 0; i < Math.min(n, this.chips.length); i++) {
      const m = this.chips[i], r = ((i * 37) % 11) / 11, a = i * 2.4;
      m.visible = true; m.position.set(at.x + Math.cos(a) * 1.2, at.y + 1 + r * 4, at.z + Math.sin(a) * 1.2); m.scale.set(1.4, 1.4, 1.4);
      this.debris.push({ m, vx: Math.cos(a) * (4 + r * 7), vy: 7 + r * 8, vz: Math.sin(a) * (4 + r * 7), spin: (r - 0.5) * 14, t: 0, floor: at.y + 0.3 });
    }
  }

  /** The roller hits the thing in the way three times and it goes to pieces. */
  brokenAnim(ev, pawn) {
    const kind = ev.challenge, sp = this.sp, o = this.o;
    const target = kind === 'dragon' ? sp.wall.at : lerp3(sp.pit.stand, sp.pit.mid, 0.7);
    const ball = kind === 'spike' && o ? o.ball : null, obj = o && kind === 'dragon' ? o.guard : null;
    const from = { x: pawn.x, y: pawn.y, z: pawn.z }, d = flat(from, target) || 1, ux = (target.x - from.x) / d, uz = (target.z - from.z) / d;
    const gapTo = kind === 'dragon' ? 3.8 : sp.pit.R + 1.2;
    const reach = { x: target.x - ux * gapTo, y: from.y, z: target.z - uz * gapTo }, yaw = Math.atan2(ux, uz);
    const base = obj ? { x: target.x, y: target.y, z: target.z } : null, ballStop = { x: target.x, y: from.y + sp.pit.R, z: target.z };
    this.walkTo = null;
    let shattered = false;
    const a = { t: 0, dur: ev.dur };
    a.step = (u) => {
      if (u < 0.2) { // run up to it (the boulder rolls down to meet the player)
        const p = lerp3(from, reach, ease(u / 0.2)); pawn.x = p.x; pawn.y = p.y; pawn.z = p.z; pawn.fx = null;
        if (ball) { ball.show(true); ball.set(lerp3(sp.pit.from, ballStop, ease(u / 0.2))); ball.spin(u * 30); }
      } else if (u < 0.62) { // three hits: lunge, the thing shakes
        const k = (u - 0.2) / 0.42 * 3, f = k - Math.floor(k), lunge = Math.sin(Math.min(1, f * 1.6) * Math.PI);
        pawn.x = reach.x + ux * lunge * 1.3; pawn.z = reach.z + uz * lunge * 1.3; pawn.y = reach.y + lunge * 0.5;
        pawn.fx = { x: pawn.x, y: pawn.y, z: pawn.z, yaw, arms: [-1.6 - lunge * 1.2, -1.6 - lunge * 1.2], tilt: lunge * 0.25 };
        const sh = f > 0.3 && f < 0.75 ? Math.sin(f * 60) * 0.35 : 0;
        if (obj && base) obj.position.set(base.x + sh, base.y, base.z + sh * 0.6);
        if (ball) ball.set({ x: ballStop.x + sh, y: ballStop.y, z: ballStop.z + sh * 0.6 });
      } else {
        if (!shattered) { shattered = true; pawn.fx = null; pawn.x = reach.x; pawn.y = reach.y; pawn.z = reach.z; this.burst(ball ? ballStop : target); if (ball) ball.show(false); }
        if (obj) { const k = clamp01((u - 0.62) / 0.2); obj.position.y = (base ? base.y : target.y) - k * 2; obj.rotation.x = -k * 1.2; if (k >= 1) obj.visible = false; }
      }
      this.s.place(pawn);
    };
    a.end = () => { pawn.fx = null; if (obj) { obj.visible = false; obj.rotation.x = 0; } if (ball) ball.show(false); this.setBroken(kind); this.release(); };
    return a;
  }

  // ------------------------------------------------------------------ what a "space" note shows
  playNote(ev, pawn) {
    if (!pawn) return null;
    const sp = this.sp, o = this.o;
    if (ev.fx === 'crates') { this.pending = { picked: ev.picked, safe: ev.safe, hit: ev.hit }; return null; }
    if (ev.fx === 'fireball') { // the guardian spits fire and the player is blown back
      const mouth = 1.6, from = { x: sp.wall.at.x + Math.sin(sp.wall.yaw) * mouth, y: sp.wall.at.y + 3.4, z: sp.wall.at.z + Math.cos(sp.wall.yaw) * mouth }, start = { x: pawn.x, y: pawn.y, z: pawn.z };
      const d = flat(sp.wall.at, start) || 1, bx = (start.x - sp.wall.at.x) / d, bz = (start.z - sp.wall.at.z) / d;
      const land = { x: start.x + bx * 6, y: start.y, z: start.z + bz * 6 }; land.y = Math.max(start.y - 1, Math.min(start.y + 1, land.y));
      this.walkTo = null;
      const a = { t: 0, dur: ev.dur };
      a.step = (u) => {
        if (u < 0.4) { const p = lerp3(from, { x: start.x, y: start.y + 2.2, z: start.z }, u / 0.4); this.fire.visible = true; this.fire.position.set(p.x, p.y, p.z); const s = 0.8 + Math.sin(u * 60) * 0.15; this.fire.scale.set(s, s, s); if (o) { o.guard.visible = false; o.guardFire.visible = true; o.guardFire.rotation.x = -Math.sin(u / 0.4 * Math.PI) * 0.18; } }
        else {
          this.fire.visible = false;
          if (o && !this.broken.dragon) { o.guard.visible = true; o.guardFire.visible = false; o.guardFire.rotation.x = 0; }
          const k = clamp01((u - 0.4) / 0.45), p = hop(start, land, k, 3.2);
          pawn.x = p.x; pawn.y = p.y; pawn.z = p.z;
          pawn.fx = k < 1 ? { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-bx, -bz), tilt: -1.1 * Math.sin(k * Math.PI), arms: [-2.6, -2.6], groundY: start.y } : null;
          this.s.place(pawn);
        }
      };
      a.end = () => { this.fire.visible = false; pawn.fx = null; pawn.x = land.x; pawn.y = land.y; pawn.z = land.z; this.s.place(pawn); };
      return a;
    }
    if (ev.fx === 'pit') { // the spike ball pops out of the statue's mouth onto the ledge in front of it
      const p = sp.pit, out = { x: p.popTo.x, y: p.popTo.y, z: p.popTo.z };
      this.walkTo = null; this.chase = null;
      const a = { t: 0, dur: ev.dur };
      a.step = (u) => {
        if (!o || !o.ball) return;
        o.ball.show(true);
        let q;
        if (u < 0.12) { const w = Math.sin(u * 120) * 0.12; q = { x: p.from.x, y: p.from.y + Math.abs(w), z: p.from.z + w }; }  // rattles in the mouth
        else if (u < 0.45) q = hop(p.from, out, ease((u - 0.12) / 0.33), 1.6);                                         // shoots out
        else if (u < 0.6) q = hop(out, out, (u - 0.45) / 0.15, 0.7);                                                      // one bounce
        else q = { ...out };
        o.ball.set(q); o.ball.spin(clamp01(u / 0.6) * 9);
        if (u > 0.5) { const j = Math.abs(Math.sin((u - 0.5) * 22)) * 0.9; pawn.fx = { x: pawn.x, y: pawn.y + j, z: pawn.z, arms: [-2.8, -2.8] }; } // the player jumps in fright
      };
      a.end = () => { pawn.fx = null; this.startChase(pawn.slot); };
      return a;
    }
    return null;
  }

  /** The way the spike ball rolls: off the ledge in front of the statue, down the whole stretch, over the edge. */
  chaseRoute() {
    const p = this.sp.pit, P = this.s.pos.island, R = p.R;
    const spikeIdx = ISLAND.findIndex((n) => n.type === 'spike'), lastIdx = ISLAND.findIndex((n) => n.type === 'volcanoOrNot') + 1;
    const pts = [{ ...p.popTo }];
    for (let i = spikeIdx; i >= lastIdx; i--) {
      pts.push({ x: P[i].x, y: P[i].y + R, z: P[i].z });
      if (i > lastIdx) for (const q of legVia('island', i, i - 1)) pts.push({ x: q.x, y: q.y + R, z: q.z });
    }
    const atLast = pts.length - 1;
    const edge = { ...p.overEdge }, dx = edge.x - P[lastIdx].x, dz = edge.z - P[lastIdx].z, dl = Math.hypot(dx, dz) || 1;
    pts.push(edge, { x: edge.x + dx / dl * 4, y: edge.y - 30, z: edge.z + dz / dl * 4 }); // over the edge and down
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const at = (sd) => {
      const d = Math.max(0, Math.min(cum[cum.length - 1], sd));
      for (let i = 1; i < pts.length; i++) if (d <= cum[i]) return lerp3(pts[i - 1], pts[i], (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1));
      return { ...pts[pts.length - 1] };
    };
    return { pts, cum, at, total: cum[cum.length - 1], sLast: cum[atLast], sEdge: cum[atLast + 1], lastIdx };
  }

  startChase(slot) {
    if (!this.o || !this.o.ball) return;
    const route = this.chaseRoute(), steps = Math.max(1, ISLAND.findIndex((n) => n.type === 'spike') - route.lastIdx);
    // the ball reaches the bottom only once the player has got there and ducked into the tunnel mouth
    const arrive = (steps * DUR.fastStep * 1.35 + DUR.moveTail + HIDE_MS) / 1000 + 0.5;
    this.chase = { slot, t: 0, s: 0, route, speed: Math.min(CHASE_SPEED, route.sLast / arrive), dodgers: new Map() };
  }

  /** Where a player ducks in, and the pose they hold there (looking out at the path). */
  hidePose(i = 0) {
    const p = this.sp.pit, last = this.s.pos.island[ISLAND.findIndex((n) => n.type === 'volcanoOrNot') + 1];
    const a = { x: p.hide.x + (i % 2 ? 0.7 : -0.7) * (i ? 1 : 0), y: last.y, z: p.hide.z - Math.floor(i / 2) * 0.8 }; // a few can squeeze in
    return { at: a, yaw: Math.atan2(last.x - a.x, last.z - a.z) };
  }

  /** A run back that ends on the last space while the spike ball is coming: one more leg, into the tunnel mouth. */
  hideLegFor(ev, B) {
    const c = this.chase, last = ev.path[ev.path.length - 1];
    this.hidden ||= new Map();
    if (!c || !last || last.track !== 'island' || last.idx !== c.route.lastIdx) return null;
    const hp = this.hidePose(this.hidden.size);
    return { ms: HIDE_MS, steps: 0, kind: 'hide', pose: (l) => { const q = lerp3(B, hp.at, ease(l)); q.y += Math.sin(Math.PI * l) * 0.6; return { ...q, fx: { yaw: hp.yaw, arms: [-2.6, -2.6] } }; } };
  }

  /** The run back has ended: if it ended in the tunnel mouth, the player stays there out of sight of the ball. */
  endsHidden(ev, pawn) {
    if (!this.hideLegFor(ev, pawn)) return false;
    this.hide(pawn);
    return true;
  }

  hide(pawn) {
    this.hidden ||= new Map();
    if (this.hidden.has(pawn)) return;
    const hp = this.hidePose(this.hidden.size);
    this.hidden.set(pawn, hp);
    pawn.fx = { x: hp.at.x, y: hp.at.y, z: hp.at.z, yaw: hp.yaw, arms: [0, 0] };
  }

  /** Back onto the space, without being seen: only once the ball is gone and the camera is not on them. */
  unhide(pawn) {
    if (!this.hidden || !this.hidden.has(pawn)) return;
    this.hidden.delete(pawn); pawn.fx = null;
    if (this.s.place) this.s.place(pawn);
  }

  updateChase(dt) {
    const c = this.chase, o = this.o, s = this.s, p = this.sp.pit, r = c.route, R = p.R;
    this.hidden ||= new Map();
    c.t += dt;
    c.s += c.speed * (c.s > r.sEdge ? 1.6 : 1) * dt; // never stops; picks up speed as it goes over the edge
    const q = r.at(c.s);
    if (c.s > r.sEdge) q.y -= Math.pow((c.s - r.sEdge) / c.speed, 2) * 9; // falling
    o.ball.show(true); o.ball.set(q); o.ball.spin(c.s / R);
    const moving = s.anim && s.anim.slotMoving;
    for (const pawn of Object.values(s.pawns)) {
      if (!pawn || pawn.track !== 'island' || pawn.slot === moving || this.hidden.has(pawn)) continue;
      // already standing on the last space when the ball comes: duck in too
      if (pawn.idx === r.lastIdx) { if (c.s > r.sLast - c.speed * 1.2) this.hide(pawn); continue; }
      // anyone else the ball passes on the stretch hops aside and back
      const near = Math.hypot(pawn.x - q.x, pawn.z - q.z), side = c.s < r.sEdge ? clamp01(1 - (near - 2) / 4) : 0;
      if (side > 0.01) {
        const a2 = r.at(c.s + 1), dx = a2.x - q.x, dz = a2.z - q.z, l = Math.hypot(dx, dz) || 1;
        pawn.fx = { x: pawn.x - dz / l * side * 2.6, y: pawn.y + side * 0.6, z: pawn.z + dx / l * side * 2.6, arms: [-2.4, -2.4] }; c.dodgers.set(pawn, true);
      } else if (c.dodgers.has(pawn)) { pawn.fx = null; c.dodgers.delete(pawn); }
    }
    if (c.s > r.total + c.speed * 1.5) { // long gone: the ball back in the statue's mouth (the hiders stay put until the camera has left them)
      for (const pw of c.dodgers.keys()) pw.fx = null;
      this.chase = null;
      if (!(this.broken && this.broken.spike)) o.ball.goHome(); else o.ball.show(false);
    }
  }

  /** Hiders step back onto their space as soon as nobody is looking: the ball is gone and the camera is on someone else. */
  updateHidden() {
    if (!this.hidden || !this.hidden.size || this.chase) return;
    for (const pawn of [...this.hidden.keys()]) if (this.s.camSlot !== pawn.slot || this.s.flying) this.unhide(pawn);
  }

  /**
   * One step of the UFO swap. 'up': the UFO flies in over the player, the beam comes on, the player floats up into it,
   * shrinking and turning, the beam goes off and the UFO zooms away. 'down' is the same backwards at the new spot.
   */
  ufoAnim(phase, pawn, dur) {
    const o = this.o;
    if (!o || !o.ufo) return null;
    const S = o.S, ground = { x: pawn.x, y: pawn.y, z: pawn.z }, HOVER = 8.5;
    const over = { x: ground.x, y: ground.y + HOVER, z: ground.z }, away = { x: ground.x - 26, y: ground.y + HOVER + 16, z: ground.z + 10 };
    const up = phase === 'up';
    const a = { t: 0, dur };
    const setBeam = (k) => { o.beam.visible = k > 0.01; o.beam.position.set(ground.x, ground.y, ground.z); o.beam.scale.set(S * (0.6 + 0.4 * k), (HOVER - 0.6) / 450 * Math.max(0.01, k), S * (0.6 + 0.4 * k)); };
    a.step = (u) => {
      o.ufo.visible = true;
      // the UFO: in, hover (bobbing), out
      let pos;
      if (u < 0.25) pos = lerp3(away, over, ease(u / 0.25));
      else if (u < 0.82) pos = { x: over.x, y: over.y + Math.sin((u - 0.25) * 18) * 0.15, z: over.z };
      else pos = lerp3(over, { x: away.x * -1 + 2 * over.x, y: away.y, z: away.z * -1 + 2 * over.z }, ease((u - 0.82) / 0.18));
      o.ufo.position.set(pos.x, pos.y, pos.z); o.ufo.rotation.y = u * 6;
      // the beam: on, then off
      const beamK = u < 0.28 ? 0 : u < 0.36 ? (u - 0.28) / 0.08 : u < 0.74 ? 1 : u < 0.8 ? 1 - (u - 0.74) / 0.06 : 0;
      setBeam(beamK); o.beam.rotation.y = u * 10;
      // the player: floats up into the UFO (or down out of it)
      let k = clamp01((u - 0.36) / 0.36); if (!up) k = 1 - k;          // 0 on the ground, 1 inside the UFO
      const e = ease(k);
      pawn.scale = 1 - 0.85 * e;
      pawn.fx = { x: ground.x, y: ground.y + (HOVER - 1.2) * e, z: ground.z, yaw: (pawn.yaw || 0) + e * 6, arms: [-2.8 * Math.min(1, e * 3), -2.8 * Math.min(1, e * 3)], groundY: ground.y };
      if (up ? u > 0.72 : u < 0.36) { pawn.scale = 0; } // inside the UFO: not to be seen
      this.s.place(pawn);
    };
    a.end = () => {
      o.ufo.visible = false; setBeam(0);
      pawn.fx = null;
      if (up) { pawn.scale = 0; pawn.group.visible = false; } // gone until the UFO drops them off
      else { pawn.scale = 1; pawn.group.visible = true; }
      this.s.place(pawn);
    };
    if (!up) { pawn.group.visible = true; pawn.scale = 0; }
    return a;
  }

  /** Volcano or not, failed: the stone block slides out and shoves the player over the edge into the pit (0..1 of `u`). */
  volcanoPush(pawn, u, A) {
    const V = this.sp.volcano, o = this.o, S = o ? o.S : 1;
    const slide = ease(clamp01(u / 0.3)) - ease(clamp01((u - 0.75) / 0.25)); // out, and back in at the end
    if (o && o.block) o.block.position.set(V.dir.x * slide * 3.2 / S, 0, V.dir.z * slide * 3.2 / S);
    const shove = ease(clamp01((u - 0.18) / 0.25)), fall = clamp01((u - 0.4) / 0.35);
    const p = lerp3(A, V.pit, shove); p.y = A.y + Math.sin(shove * Math.PI) * 0.8 - fall * fall * 26;
    pawn.fx = { x: p.x, y: p.y, z: p.z, tilt: fall * 1.4, arms: [-2.8, -2.8], groundY: A.y - 30 };
    return p;
  }

  restoreCrates() {
    if (!this.o) return;
    for (const lane of this.o.floaters) for (const m of lane) { m.visible = true; m.rotation.x = 0; }
  }

  // ------------------------------------------------------------------ moving along the route
  /** The points walked through from pts[i] to pts[i + 1] (the map's waypoints, minus any the pawn is already past). */
  chainFor(a, b, P0, P1, first) {
    let via = legVia('island', a, b);
    if (first && via.length) { // the pawn may already be standing part-way (in front of the guardian, by the pool...)
      let k = -1, best = flat(P0, this.s.pos.island[a]) < 2.6 ? Infinity : 1e9;
      if (best !== Infinity) { via.forEach((v, i) => { const d = flat(P0, v); if (d < best) { best = d; k = i; } }); via = via.slice(k + 1); }
    }
    return [P0, ...via, P1];
  }

  /** The legs of a walk: ordinary steps, steps that follow the map's waypoints, and the long ones across each gap. */
  buildLegs(ev, pts, stepMs, pawn) {
    const legs = [], n = pts.length - 1;
    const hanging = this.vine;                  // the roller has been swinging on the vine while the dice rolled
    this.vine = null; this.walkTo = null;
    let prev = this.s.idxBefore, track = pawn.track;
    for (let i = 0; i < n; i++) {
      const node = ev.path[i], cur = node.idx, P0 = pts[i], P1 = pts[i + 1];
      const same = prev != null && node.track === track;
      const g = same && track === 'island' ? gapBetween(prev, cur) : null, fwd = cur > prev;
      if (!g) {
        const via = same ? legVia(track, prev, cur) : [];
        if (via.length) legs.push({ ms: stepMs * 2, steps: 1, kind: 'walk', pose: chainPose([P0, ...via, P1]) }); // e.g. from the start area through the gate
        else legs.push({ ms: stepMs, steps: 1, kind: 'walk', pose: (l) => lerp3(P0, P1, l) });
        prev = cur; track = node.track; continue;
      }
      if (g.kind === 'swing' && fwd && i === 0 && ev.swing > 0) { // the vine roll: leap for the vine, swing, let go and fly the rolled spaces
        const k = Math.min(ev.swing, n), land = pts[k], jp = this.vineJump(P0, land, hanging);
        // the vine has its own counter: the rolled number counts down through the flight
        legs.push({ ms: jp.ms, steps: k, kind: 'swing', pose: jp.pose, stepAt: (l) => jp.stepAt(l, k), counter: (l) => k - jp.stepAt(l, k) });
        if (k < n) { // landed: a moment standing there, then the spaces still left take the counter's place and the walk goes on
          const r = n - k, at = { ...land };
          legs.push({ ms: DUR.vinePause, steps: 0, kind: 'pause', pose: () => ({ ...at }), counter: (l) => (l < 0.55 ? 0 : r) });
        }
        prev = ev.path[k - 1].idx; track = ev.path[k - 1].track; i = k - 1;
        continue;
      }
      const chain = this.chainFor(prev, cur, P0, P1, i === 0);
      let ms = stepMs + DUR.cross, pose;
      if (g.kind === 'swing') { ms += ev.swing && i === 0 ? DUR.swing : 0; pose = this.swingPose(chain, fwd, !!hanging && i === 0); }
      else if (g.kind === 'crates') { if (ev.swim) ms = Math.max(ms, ev.dur - 400); pose = this.poolPose(chain, fwd, i === 0 ? this.pending : null); }
      else pose = chainPose(chain);
      const done = { v: false };
      legs.push({ ms, steps: 1, kind: g.kind, pose: (l) => { const p = pose(l); if (l > 0.96 && !done.v && this.active) { done.v = true; this.release(); } return p; } });
      prev = cur;
    }
    this.pending = null;
    return legs;
  }

  /**
   * The vine roll, in one unbroken movement: run to the edge while the vine is drawn back, leap and catch it at the
   * top of its swing, ride it down and up the other side, let go while still moving forward and fly through the air
   * to land on the space the roll reaches. The vine then swings on by itself and settles. Returns { ms, pose, stepAt }.
   */
  vineJump(P0, land, hanging = null) {
    if (hanging) return this.vineJumpFromSwing(land, hanging);
    const v = this.sp.swing, A = SWING_AMP, th0 = -A, REL = 0.8;            // let go at 80% of the half swing
    const yaw = Math.atan2(v.u.x, v.u.z), grab = v.hang(th0);
    const tRun = flat(P0, v.near) / 9 + 0.05, tHop = 0.6, tSwing = 1.25 * REL;
    const thRel = -A * Math.cos(Math.PI * REL), letGo = v.hang(thRel);
    const d = flat(letGo, land), tFly = 0.7 + d * 0.03, hFly = 3 + d * 0.3; // a real leap, well clear of the ground
    const run = chainPose([P0, v.near]), rope0 = { th: null };
    const pull = (t) => { // the vine is drawn back while the player runs up and leaps, and is at the top when caught
      if (rope0.th == null) rope0.th = this.ropeTheta;
      this.ropeFree = null; this.swinging = true;
      this.ropeTheta = rope0.th + (th0 - rope0.th) * ease(t);
    };
    const T = tRun + tHop;
    const parts = [
      [tRun, (t) => { pull((t * tRun) / T); const p = run(t); return { ...p, fx: { yaw, arms: [-0.6 - t * 1.6, -0.6 - t * 1.6] } }; }],
      [tHop, (t) => { pull((tRun + t * tHop) / T); return { ...hop(v.near, grab, ease(t), 2.2), fx: { yaw, groundY: v.riverY, arms: [-2.8, -2.8], legs: [0.5, -0.4] } }; }],
      [tSwing, (t) => { // a pendulum: slow at the top, fastest at the bottom
        const th = -A * Math.cos(Math.PI * REL * t); this.swinging = true; this.ropeTheta = th;
        return { ...v.hang(th), fx: { yaw, groundY: v.riverY, arms: [-3.0, -3.0], legs: [0.6 * Math.sin(t * Math.PI), -0.3], tilt: -th * 0.5 } };
      }],
      [tFly, (t) => {
        if (this.swinging) { // let go: the vine swings on by itself, and the camera is free to follow the flight
          this.swinging = false; this.ropeFree = { t: 0, phase: Math.PI * REL, w: (Math.PI * REL) / tSwing };
          if (this.active) { this.active = null; this.walkTo = null; if (this.s.camHold && !this.s.runHold) this.s.camHold = null; }
        }
        const p = hop(letGo, land, t, hFly), ground = t < 0.25 ? v.riverY : terrainHeight(p.x, p.z) + 0.14;
        return { ...p, fx: { yaw, groundY: Math.min(p.y, ground), arms: [-2.6 + t * 1.2, -2.6 + t * 1.2], legs: [0.7 * (1 - t), -0.6 * (1 - t)], tilt: -0.35 * (1 - t) } };
      }],
    ];
    const total = tRun + tHop + tSwing + tFly, flyStart = (tRun + tHop + tSwing) / total;
    return {
      ms: total * 1000,
      pose: sequence(parts),
      stepAt: (l, k) => (l <= flyStart ? 0 : l >= 1 ? k : Math.min(k, Math.floor(((l - flyStart) / (1 - flyStart)) * k + 1e-9))), // the counter ticks down through the flight
    };
  }

  /**
   * The vine roll when the player has been swinging on the vine while the die rolled: the swing simply carries on
   * (same rhythm, a little higher each time) until the next forward swing, they let go on the way up and fly the
   * rolled spaces. Nothing restarts or jumps: the first frame is exactly the hanging pose of the frame before.
   */
  vineJumpFromSwing(land, hanging) {
    const v = this.sp.swing, A = SWING_AMP, W = VINE_W, REL = 0.8, yaw = Math.atan2(v.u.x, v.u.z);
    const ph0 = W * hanging.t, rel = Math.PI * REL;
    let phEnd = rel + 2 * Math.PI * Math.ceil((ph0 + 0.5 - rel) / (2 * Math.PI)); // the next let-go point at least a moment away
    const tSwing = (phEnd - ph0) / W, amp = (t) => A * (0.8 + 0.2 * ease(t));        // swings a bit higher towards the end
    const thRel = -amp(1) * Math.cos(phEnd), letGo = v.hang(thRel);
    const d = flat(letGo, land), tFly = 0.7 + d * 0.03, hFly = 3 + d * 0.3; // a real leap, well clear of the ground
    const parts = [
      [tSwing, (t) => {
        const ph = ph0 + (phEnd - ph0) * t, th = -amp(t) * Math.cos(ph); this.ropeFree = null; this.swinging = true; this.ropeTheta = th;
        return { ...v.hang(th), fx: { yaw, groundY: v.riverY, arms: [-3.0, -3.0], legs: [0.35 * Math.sin(ph), -0.2], tilt: -th * 0.4 } };
      }],
      [tFly, (t) => {
        if (this.swinging) {
          this.swinging = false; this.ropeFree = { t: 0, phase: phEnd, w: W, amp: amp(1) };
          if (this.active) { this.active = null; this.walkTo = null; if (this.s.camHold && !this.s.runHold) this.s.camHold = null; }
        }
        const p = hop(letGo, land, t, hFly), ground = t < 0.25 ? v.riverY : terrainHeight(p.x, p.z) + 0.14;
        return { ...p, fx: { yaw, groundY: Math.min(p.y, ground), arms: [-2.6 + t * 1.2, -2.6 + t * 1.2], legs: [0.7 * (1 - t), -0.6 * (1 - t)], tilt: -0.35 * (1 - t) } };
      }],
    ];
    const total = tSwing + tFly, flyStart = tSwing / total;
    return {
      ms: total * 1000,
      pose: sequence(parts),
      stepAt: (l, k) => (l <= flyStart ? 0 : l >= 1 ? k : Math.min(k, Math.floor(((l - flyStart) / (1 - flyStart)) * k + 1e-9))),
    };
  }

  /** Across the gorge on the vine: run to the edge, leap for the vine, ride it over, let go, land, walk on. */
  swingPose(chain, fwd, hanging) {
    const v = this.sp.swing, A = SWING_AMP, sgn = fwd ? 1 : -1;
    const edgeIn = fwd ? v.near : v.far, edgeOut = fwd ? v.far : v.near, P0 = chain[0], P1 = chain[chain.length - 1];
    const yaw = Math.atan2(v.u.x * sgn, v.u.z * sgn), th0 = -A * sgn, th1 = A * sgn;
    const air = (p, extra) => ({ ...p, fx: { yaw, groundY: v.riverY, ...extra } });
    const start = hanging ? null : chainPose([P0, edgeIn]);
    const grab = v.hang(th0), let_go = v.hang(th1);
    const parts = [];
    if (hanging) parts.push([0.5, (t) => { const th = this.ropeTheta + (th0 - this.ropeTheta) * ease(t); this.swinging = true; this.ropeTheta = th; return air(v.hang(th), { arms: [-3.0, -3.0], legs: [0.3, -0.2] }); }]);
    else {
      parts.push([flat(P0, edgeIn) / 9 + 0.05, (t) => { this.swinging = true; this.ropeTheta += (th0 - this.ropeTheta) * 0.2; return start(t); }]);
      parts.push([0.7, (t) => { this.swinging = true; this.ropeTheta = th0; return air(hop(edgeIn, grab, t, 2.5), { arms: [-2.8, -2.8] }); }]);
    }
    parts.push([1.3, (t) => { const th = th0 + (th1 - th0) * ease(t); this.swinging = true; this.ropeTheta = th; return air(v.hang(th), { arms: [-3.0, -3.0], legs: [0.5 * sgn * Math.cos(t * 3), -0.3], tilt: -th * sgn * 0.5 }); }]);
    parts.push([0.9, (t) => { this.swinging = false; return air(hop(let_go, edgeOut, t, 3.5), { arms: [-2.4, -2.4], legs: [0.6, -0.5] }); }]);
    const walkOut = chainPose([edgeOut, P1]);
    parts.push([flat(edgeOut, P1) / 9 + 0.05, (t) => { this.swinging = false; return walkOut(t); }]);
    return sequence(parts);
  }

  /** Across the pool: hop from one floating crate (or barrel) to the next. If the wrong lane was picked, one breaks and it is a swim. */
  poolPose(chain, fwd, pending) {
    const c = this.sp.crates, li = pending ? pending.picked : 0, lane = c.lanes[li], P0 = chain[0], P1 = chain[chain.length - 1];
    const order = lane.spots.map((p, k) => ({ p: { x: p.x, y: c.top, z: p.z }, k })); if (!fwd) order.reverse();
    const inB = fwd ? lane.a : lane.b, outB = fwd ? lane.b : lane.a;
    const yaw = Math.atan2(outB.x - inB.x, outB.z - inB.z), air = (p) => ({ ...p, fx: { yaw, groundY: c.water } });
    const parts = [[flat(P0, inB) / 9 + 0.05, chainPose([P0, inB])]];
    const bad = pending && !pending.safe ? Math.min(order.length - 1, pending.hit) : -1;
    let at = inB;
    for (let i = 0; i < order.length; i++) {
      const from = at, to = order[i].p, k = order[i].k;
      parts.push([0.55, (t) => air(hop(from, to, t, 2.2))]);
      at = to;
      if (i === bad) { // crack: this one gives way under the player
        const swimY = c.water - 2.9, sunk = { x: to.x, y: swimY, z: to.z }, shore = { x: outB.x, y: swimY, z: outB.z };
        parts.push([0.35, (t) => { this.breakFloater(li, k); return air(lerp3(to, sunk, t)); }]);
        parts.push([flat(sunk, shore) / 7, (t) => { const p = lerp3(sunk, shore, t); p.y += Math.sin(t * 40) * 0.12; return { ...p, fx: { yaw, tilt: 0.9, arms: [-2.4 + Math.sin(t * 50) * 0.8, -2.4 - Math.sin(t * 50) * 0.8], groundY: swimY } }; }]);
        parts.push([0.4, (t) => air(hop(shore, outB, t, 1.5))]);
        at = null; break;
      }
    }
    if (at) { const from = at; parts.push([0.55, (t) => air(hop(from, outB, t, 2.2))]); }
    parts.push([flat(outB, P1) / 9 + 0.05, chainPose([outB, P1])]);
    return sequence(parts);
  }

  breakFloater(li, k) {
    if (!this.o) return;
    const m = this.o.floaters[li][k];
    if (!m.visible) return;
    m.visible = false; this.burst({ x: m.position.x, y: this.sp.crates.water, z: m.position.z }, 12);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const s = this.s, sp = this.sp, o = this.o;
    // swinging on the vine while the dice roll
    if (this.vine) {
      const pawn = s.pawns[this.vine.slot], v = sp.swing;
      this.vine.t += dt;
      const th = -SWING_AMP * 0.8 * Math.cos(this.vine.t * VINE_W);
      this.ropeTheta = th; this.swinging = true;
      if (pawn) {
        const h = v.hang(th), k = ease(clamp01(this.vine.t / 0.7)), p = k < 1 ? hop(this.vine.from, h, k, 2.5) : h;
        pawn.fx = { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(v.u.x, v.u.z), arms: [-3.0, -3.0], legs: [0.35 * Math.sin(this.vine.t * VINE_W), -0.2], tilt: -th * 0.4, groundY: v.riverY };
        pawn.x = p.x; pawn.y = p.y; pawn.z = p.z; // the move that follows starts from the vine
      }
    } else if (!this.swinging && this.ropeFree) { // let go of: it swings on by itself and dies down
      const f = this.ropeFree; f.t += dt;
      this.ropeTheta = -(f.amp || SWING_AMP) * Math.cos(f.phase + f.w * f.t) * Math.exp(-0.55 * f.t);
      if (f.t > 9) this.ropeFree = null;
    } else if (!this.swinging) this.ropeTheta *= Math.max(0, 1 - dt * 2.5);
    if (o) o.rope.quaternion.setFromAxisAngle(o.ropeAxis, this.ropeTheta);
    // walking up to where the challenge is faced
    if (this.walkTo) {
      const pawn = s.pawns[this.walkTo.slot], to = this.walkTo.to;
      if (pawn) {
        const d = flat(pawn, to), stepLen = Math.min(d, dt * 9);
        if (d > 0.05) { pawn.x += (to.x - pawn.x) / d * stepLen; pawn.z += (to.z - pawn.z) / d * stepLen; pawn.y += (to.y - pawn.y) * Math.min(1, stepLen / d); s.place(pawn); }
      }
    }
    // the spike ball rolling down the whole stretch without stopping, past the players hiding in the tunnel mouth,
    // and over the edge at the end
    if (this.chase && o) this.updateChase(dt);
    this.updateHidden();
    // bits flying about
    for (const d of this.debris) {
      if (d.t > 3.2) continue;
      d.t += dt; d.vy -= 26 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      if (d.m.position.y < d.floor) { d.m.position.y = d.floor; if (d.vy < -2) { d.vy = -d.vy * 0.38; d.spin *= 0.6; } else d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; }
      else { d.m.rotation.x += d.spin * dt; d.m.rotation.z += d.spin * 0.7 * dt; }
      const k = d.t > 2.4 ? Math.max(0, 1 - (d.t - 2.4) / 0.8) : 1; d.m.scale.set(1.4 * k, 1.4 * k, 1.4 * k);
      if (d.t > 3.2) d.m.visible = false;
    }
    if (this.debris.length && this.debris.every((d) => d.t > 3.2)) this.debris = [];
  }
}
