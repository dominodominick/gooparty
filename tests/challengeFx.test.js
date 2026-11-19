// The long steps of the real map: every crossing is one continuous motion that starts and ends where it should.
import assert from 'node:assert/strict';
globalThis.window = globalThis; globalThis.document = { createElement: () => ({}), body: { style: {} } };
const { ChallengeFX, challengeSpecs, FLOATERS, CHASE_GAP } = await import('../js15/scenes/challengeFx.js');
const { islandPositions, islandWorld, terrainHeight } = await import('../js15/game/boardLayout.js');
const { GAPS, ISLAND } = await import('../js15/game/boardData.js');

// tiny stand-ins for three.js's quaternion and vector (the ball turns as it rolls)
const Q = class { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } identity() { this.x = this.y = this.z = 0; this.w = 1; return this; }
  setFromAxisAngle(a, ang) { const s2 = Math.sin(ang / 2); this.x = a.x * s2; this.y = a.y * s2; this.z = a.z * s2; this.w = Math.cos(ang / 2); return this; }
  premultiply(q) { const { x, y, z, w } = this; this.x = q.w * x + q.x * w + q.y * z - q.z * y; this.y = q.w * y - q.x * z + q.y * w + q.z * x; this.z = q.w * z + q.x * y - q.y * x + q.z * w; this.w = q.w * w - q.x * x - q.y * y - q.z * z; return this; } clone() { const c = new Q(); Object.assign(c, this); return c; } };
const V = class { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const W = islandWorld(), P = islandPositions(), sp = challengeSpecs(W);
const mk = (idxBefore, extra = {}) => Object.assign(Object.create(ChallengeFX.prototype), { sp, W, s: { idxBefore, pos: { island: P }, camHold: null }, pending: null, ropeTheta: 0, vine: null, swinging: false, active: null, walkTo: null, o: null, debris: [], chips: [] }, extra);
const walk = (from, to, fxExtra = {}, evExtra = {}) => {
  const fx = mk(from, fxExtra), path = []; const step = to > from ? 1 : -1;
  for (let i = from + step; i !== to + step; i += step) path.push({ track: 'island', idx: i });
  const pts = [P[from], ...path.map((n) => P[n.idx])].map((p) => ({ x: p.x, y: p.y, z: p.z }));
  return { fx, legs: fx.buildLegs({ path, dur: 9000, ...evExtra }, pts, 340, { track: 'island', x: pts[0].x, y: pts[0].y, z: pts[0].z }), pts };
};
const check = (leg, A, B, maxJump, what) => {
  let prev = null, worst = 0;
  for (let i = 0; i <= 400; i++) { const q = leg.pose(i / 400); assert.ok(Number.isFinite(q.x + q.y + q.z), what + ': finite'); if (prev) worst = Math.max(worst, Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z)); prev = q; }
  const a = leg.pose(0), b = leg.pose(1);
  assert.ok(Math.hypot(a.x - A.x, a.z - A.z) < 0.01 && Math.hypot(b.x - B.x, b.z - B.z) < 0.01, what + ': starts and ends on the spaces');
  assert.ok(worst < maxJump, `${what}: continuous (largest jump ${worst.toFixed(2)})`);
};
// every gap, forwards and backwards
for (const g of GAPS) {
  for (const [a, b] of [[g.after, g.after + 1], [g.after + 1, g.after]]) {
    const { legs, pts } = walk(a, b);
    assert.equal(legs.length, 1); assert.equal(legs[0].kind, g.kind);
    check(legs[0], pts[0], pts[1], 1.2, `${g.kind} ${a}->${b}`);
  }
}
// the vine roll: from the star, leap for the vine, swing, let go and fly the rolled spaces, then walk the rest
{
  const v = sp.swing, vineIdx = ISLAND.findIndex((n) => n.type === 'vine');
  for (const [d, r] of [[1, 0], [4, 1], [6, 3]]) {
    const fx = mk(vineIdx), path = [], pts = [{ ...P[vineIdx] }];
    for (let k = 1; k <= d + r; k++) { path.push({ track: 'island', idx: vineIdx + k }); pts.push({ ...P[vineIdx + k] }); }
    const legs = fx.buildLegs({ path, swing: d, dur: 99999 }, pts, 340, { track: 'island', ...P[vineIdx] });
    assert.equal(legs.length, 1 + (r ? 1 + r : 0), `one jump of ${d}, a pause, then ${r} steps`);
    assert.equal(legs[0].counter(0), d, 'the vine has its own counter, starting at the vine roll');
    assert.equal(legs[0].counter(1), 0);
    if (r) {
      assert.equal(legs[1].kind, 'pause'); assert.equal(legs[1].steps, 0);
      const a0 = legs[1].pose(0), a1 = legs[1].pose(1); assert.deepEqual(a0, a1, 'standing still on the landing spot');
      assert.equal(legs[1].counter(0.2), 0); assert.equal(legs[1].counter(0.9), r, 'then the spaces still left take its place');
    }
    assert.equal(legs[0].steps, d);
    const end = legs[0].pose(1);
    assert.ok(Math.hypot(end.x - pts[d].x, end.y - pts[d].y, end.z - pts[d].z) < 0.01, `lands on the space ${d} past the star`);
    let prev = null, worst = 0, ropePrev = null, ropeJump = 0;
    for (let i = 0; i <= 800; i++) {
      const q = legs[0].pose(i / 800);
      if (prev) worst = Math.max(worst, Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z));
      if (ropePrev != null && fx.swinging) ropeJump = Math.max(ropeJump, Math.abs(fx.ropeTheta - ropePrev));
      ropePrev = fx.swinging ? fx.ropeTheta : null; prev = q;
    }
    assert.ok(worst < 0.6, `the whole jump is smooth (biggest step ${worst.toFixed(2)})`);
    assert.ok(ropeJump < 0.05, `the vine never jumps (${ropeJump.toFixed(3)})`);
    assert.equal(legs[0].stepAt(0.5), 0, 'the counter waits until the player lets go');
    assert.equal(legs[0].stepAt(1), d);
    assert.ok(fx.ropeFree, 'after letting go the vine swings on by itself');
    // the rope carries on from where it was let go, without a jump
    const th = fx.ropeTheta; fx.ropeFree.t = 0; fx.s.pawns = {}; fx.update(1 / 60);
    assert.ok(Math.abs(fx.ropeTheta - th) < 0.06, 'the vine swings on smoothly');
  }
  // swinging on the vine while the die rolled: the swing carries straight on into the jump
  for (const t0 of [3.7, 4.4, 5.9, 7.2]) {
    const pawn = { x: 0, y: 0, z: 0 }, fx = mk(vineIdx, { vine: { slot: 0, t: t0 - 1 / 60, from: { ...P[vineIdx] } } });
    fx.s.pawns = { 0: pawn }; fx.update(1 / 60); // the last frame of hanging
    const hangPos = { x: pawn.x, y: pawn.y, z: pawn.z }, hangTh = fx.ropeTheta;
    const path = [], pts = [{ ...hangPos }];
    for (let k = 1; k <= 5; k++) { path.push({ track: 'island', idx: vineIdx + k }); pts.push({ ...P[vineIdx + k] }); }
    const legs = fx.buildLegs({ path, swing: 3, dur: 99999 }, pts, 340, { track: 'island', ...hangPos });
    assert.equal(fx.vine, null);
    const first = legs[0].pose(0);
    assert.ok(Math.hypot(first.x - hangPos.x, first.y - hangPos.y, first.z - hangPos.z) < 0.15, `the jump starts exactly where the swinging player is (t=${t0})`);
    assert.ok(Math.abs(fx.ropeTheta - hangTh) < 0.06, 'and the vine is where it was');
    let prev = null, worst = 0, rp = null, rj = 0;
    for (let i = 0; i <= 1000; i++) { const q = legs[0].pose(i / 1000); if (prev) worst = Math.max(worst, Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z)); if (rp != null && fx.swinging) rj = Math.max(rj, Math.abs(fx.ropeTheta - rp)); rp = fx.swinging ? fx.ropeTheta : null; prev = q; }
    assert.ok(worst < 0.6 && rj < 0.05, `smooth all the way (${worst.toFixed(2)}, ${rj.toFixed(3)})`);
    const end = legs[0].pose(1); assert.ok(Math.hypot(end.x - pts[3].x, end.z - pts[3].z) < 0.01, 'lands 3 spaces on');
  }
  assert.ok(Math.abs(v.tip(0).y - (v.near.y + v.far.y) / 2) < 0.01, 'the vine reaches down to the level of the banks');
}
{
  const cr = ISLAND.findIndex((n) => n.type === 'crates');
  for (const hit of [0, 1, 2]) {
    const broke = []; const { legs, pts } = walk(cr, cr + 1, { pending: { picked: 1, safe: false, hit }, breakFloater: (li, k) => broke.push([li, k]) }, { swim: true });
    check(legs[0], pts[0], pts[1], 1.2, 'swim after a barrel breaks');
    assert.deepEqual(broke[0], [1, hit], 'the barrel that was stood on is the one that breaks');
    let low = Infinity; for (let i = 0; i <= 200; i++) low = Math.min(low, legs[0].pose(i / 200).y);
    assert.ok(low < sp.crates.water - 2, 'the player ends up in the water');
  }
  assert.equal(sp.crates.lanes.length, 2); assert.equal(sp.crates.lanes[0].spots.length, FLOATERS); assert.equal(FLOATERS, 3);
assert.ok(sp.volcano.pit && Math.hypot(sp.volcano.dir.x, sp.volcano.dir.z) > 0.99, 'the pit by the volcano star is found');
}
// cameras held for the challenges are above the ground and finite
for (const k of ['vine', 'dragon', 'crates', 'spike']) {
  const h = mk(0).holdFor(k);
  assert.ok(Number.isFinite(h.x + h.y + h.z + h.tx + h.ty + h.tz), k + ' camera');
  assert.ok(h.y > terrainHeight(h.x, h.z) + 1, k + ' camera is not inside the ground');
}

// the spike ball: out of the mouth onto the ledge, down the whole stretch without stopping, past the tunnel mouth, over the edge
{
  const fx = mk(0); fx.s.pos = { island: P };
  const r = fx.chaseRoute(), p = sp.pit;
  assert.ok(dist(r.at(0), p.popTo) < 0.01, 'starts where it popped out, in front of the statue');
  const last = P[r.lastIdx];
  assert.ok(Math.hypot(r.at(r.sLast).x - last.x, r.at(r.sLast).z - last.z) < 0.01, 'rolls all the way to the last space of the stretch');
  assert.ok(r.at(r.total).y < last.y - 20, 'and ends over the edge, falling');
  // the hiding place is out of the ball's way
  let closest = Infinity; for (let d = r.sLast - 10; d <= r.sEdge; d += 0.2) { const q = r.at(d); closest = Math.min(closest, Math.hypot(q.x - p.hide.x, q.z - p.hide.z)); }
  assert.ok(closest > p.R + 0.9, `the tunnel mouth is clear of the ball (${closest.toFixed(2)})`);
  // the chase never stops; whoever is on the last space ducks in before the ball gets there and stays out of sight
  const pawn = { slot: 0, track: 'island', idx: r.lastIdx, x: last.x, y: last.y, z: last.z };
  const ball = { at: {}, spinX: 0, set(q) { this.at = q; }, spin(a) { this.spinX = a; }, show() {}, goHome() { this.home = true; } };
  Object.assign(fx, { o: { ball }, hidden: new Map(), broken: {}, chase: { slot: 1, t: 0, s: 0, v: 0, route: r, dodgers: new Map() } });
  fx.s.pawns = { 0: pawn }; fx.s.anim = null; fx.s.camSlot = 0;
  let prevS = -1, steps = 0, hiddenBeforeBall = null;
  while (fx.chase && steps++ < 3000) {
    fx.updateChase(1 / 60); fx.updateHidden();
    if (fx.chase) { assert.ok(fx.chase.s > prevS, 'never stops'); prevS = fx.chase.s; if (hiddenBeforeBall == null && fx.chase.s >= r.sLast) hiddenBeforeBall = fx.hidden.has(pawn); }
  }
  assert.ok(!fx.chase && ball.home, 'gone over the edge, then back in the mouth for next time');
  assert.equal(hiddenBeforeBall, true, 'ducked into the tunnel mouth before the ball got there');
  assert.ok(pawn.fx && Math.hypot(pawn.fx.x - p.hide.x, pawn.fx.z - p.hide.z) < 1, 'still hidden while the camera is on them');
  fx.s.camSlot = 1; fx.updateHidden();
  assert.equal(pawn.fx, null, 'back on the space once the camera has gone elsewhere (never seen walking back)');
  // the player running back from the statue: the run ends with a leg into the tunnel mouth
  fx.chase = { slot: 0, t: 0, s: 0, v: 0, route: r, dodgers: new Map() }; fx.s.camSlot = 0;
  const path = []; for (let i = r.lastIdx + 3; i >= r.lastIdx; i--) path.push({ track: 'island', idx: i });
  const leg = fx.hideLegFor({ slot: 0, path }, last);
  assert.ok(leg && leg.kind === 'hide' && leg.steps === 0);
  const end = leg.pose(1); assert.ok(Math.hypot(end.x - p.hide.x, end.z - p.hide.z) < 1, 'the run ends in the tunnel mouth');
  const runner = { slot: 0, x: last.x, y: last.y, z: last.z };
  assert.equal(fx.endsHidden({ slot: 0, path }, runner), true); assert.ok(fx.hidden.has(runner), 'and stays there');
  assert.equal(fx.hideLegFor({ slot: 0, path: [{ track: 'island', idx: r.lastIdx + 2 }] }, last), null, 'a run that stops short does not hide');
  // two running in at once get a spot each
  fx.hidden = new Map(); fx.hideSpots = new Map();
  const l0 = fx.hideLegFor({ slot: 0, path }, last).pose(1), l1 = fx.hideLegFor({ slot: 1, path }, last).pose(1);
  assert.ok(Math.hypot(l0.x - l1.x, l0.z - l1.z) > 0.5, 'two hiders do not stand in each other');
}
// the ball keeps right behind whoever is running from it, and rolls the way it goes
{
  const fx = mk(0); fx.s.pos = { island: P };
  const r = fx.chaseRoute();
  const ball = { at: {}, set(q) { this.at = q; }, show() {}, goHome() {} };
  const runner = { slot: 0, track: 'island', idx: 60, x: 0, y: 0, z: 0 };
  Object.assign(fx, { o: { ball }, hidden: new Map(), broken: {}, chase: { slot: 0, t: 0, s: 0, v: 0, route: r, dodgers: new Map() } });
  fx.s.pawns = { 0: runner }; fx.s.anim = { slotMoving: 0 };
  let worst = 0, ahead = Infinity;
  for (let k = 0; k < 60 * 2.2; k++) { // the runner covers the stretch at about 9 units a second
    const sr = Math.min(r.sLast, 6 + k / 60 * 9), q = r.at(sr); Object.assign(runner, { x: q.x, y: q.y - sp.pit.R, z: q.z });
    fx.updateChase(1 / 60);
    const gap = sr - fx.chase.s;
    if (k > 60) worst = Math.max(worst, gap);
    ahead = Math.min(ahead, gap);
  }
  assert.ok(worst < 6, `right behind the runner (at most ${worst.toFixed(1)} behind)`);
  assert.ok(ahead > CHASE_GAP - 1, 'but never on top of them');
}
// the map's ball turns about the level axis across the way it rolls
{
  const parts = [0, 1].map(() => ({ isMesh: true, material: { name: 'mr001m016_21' }, visible: true, userData: {}, position: { set() {} }, quaternion: { copy(q) { this.q = q.clone ? q.clone() : q; } }, rotation: {}, geometry: { clone() { return { translate() {} }; } } }));
  const fx = mk(0); fx.T = { Quaternion: Q, Vector3: V };
  const ball = fx.mapBall({ scale: 0.016, island: { traverse: (fn) => parts.forEach(fn) } });
  ball.set({ x: ball.at.x + 1, y: ball.at.y, z: ball.at.z }); // rolling +x: it turns about -z
  assert.ok(ball.quat.z < -0.1 && Math.abs(ball.quat.x) < 1e-9, 'rolling along x turns it about z');
  ball.goHome(); ball.set({ x: ball.at.x, y: ball.at.y, z: ball.at.z + 1 }); // rolling +z: about +x
  assert.ok(ball.quat.x > 0.1 && Math.abs(ball.quat.z) < 1e-9, 'rolling along z turns it about x');
}

// ---- the map's spike ball: the loose copies along its old course (one over the pit, one in front of the statue) are hidden
{
  const meshes = ['mr001m016', 'mr001m016_2', 'mr001m016_21', 'mr001m016_22', 'mr001m001'].map((name) => ({
    isMesh: true, material: { name }, visible: true, userData: {}, position: { set() {} }, quaternion: { copy() {} }, rotation: {},
    geometry: { clone() { return { translate() {} }; } } }));
  const board = { scale: 0.016, island: { traverse: (fn) => meshes.forEach(fn) } };
  const f0 = mk(0); f0.T = { Quaternion: Q, Vector3: V }; const ball = f0.mapBall(board);
  assert.equal(meshes[0].visible, false); assert.equal(meshes[1].visible, false, 'the loose copies are hidden');
  assert.equal(ball.parts.length, 2, 'the ball itself is the two m016_21/22 parts'); assert.equal(meshes[4].visible, true, 'nothing else is touched');
}
// attach() must set the ball up (build 57 lost this line and the loose copies showed again)
{
  const src = (await import('node:fs')).readFileSync(new URL('../js15/scenes/challengeFx.js', import.meta.url), 'utf8');
  const attach = src.slice(src.indexOf('  attach(board) {'), src.indexOf('  spikeHead(board) {'));
  assert.ok(/o\.ball = this\.mapBall\(board\)/.test(attach), 'attach() sets up the spike ball');
}

// ---- the camera on the rolling spike ball: cuts in, stays out beside the path (away from the rock), looks on ahead
{
  const fx = mk(0); fx.s.camHold = null; fx.s.snapCamera = false;
  const route = { sEdge: 100, at: (sd) => ({ x: 20 * Math.cos(sd / 20), y: 30 - sd * 0.1, z: 20 * Math.sin(sd / 20) }) };
  const c = { s: 10, route }; const q = route.at(10);
  fx.chaseCamera(c, q, 1 / 60);
  assert.equal(fx.s.snapCamera, true, 'a cut to the ball');
  const h = fx.s.camHold; assert.ok(h && Math.hypot(h.x, h.z) > Math.hypot(q.x, q.z) + 4, 'out from the rock');
  assert.ok(h.y > q.y + 4, 'above the ball');
  const look = route.at(17); assert.ok(Math.hypot(h.tx - look.x, h.tz - look.z) < 0.5, 'looking on down the path');
  fx.s.snapCamera = false; c.s = 12; fx.chaseCamera(c, route.at(12), 1 / 60);
  assert.equal(fx.s.snapCamera, false, 'then it goes along with the ball, no more cuts');
  fx.counting = true; fx.s.camHold = 'number'; fx.chaseCamera(c, route.at(12), 1 / 60);
  assert.equal(fx.s.camHold, 'number', 'the number count-down has the camera');
}

// ---- the count-down waits for the spike ball to drop into the pit; the camera watches it fall
{
  const fx = mk(0); fx.s.camHold = null;
  const route = { sEdge: 50, at: (sd) => ({ x: 20 * Math.cos(sd / 20), y: 30 - sd * 0.1, z: 20 * Math.sin(sd / 20) }) };
  const c = { s: 49, route }; fx.chaseCamera(c, route.at(49), 1 / 60);
  const camAt = { x: fx.s.camHold.x, y: fx.s.camHold.y, z: fx.s.camHold.z };
  c.s = 52; const falling = { ...route.at(52), y: route.at(52).y - 10 };
  for (let i = 0; i < 60; i++) fx.chaseCamera(c, falling, 1 / 60);
  assert.deepEqual({ x: fx.s.camHold.x, y: fx.s.camHold.y, z: fx.s.camHold.z }, camAt, 'over the edge the camera stays put');
  assert.ok(Math.abs(fx.s.camHold.ty - falling.y) < 1.5, 'and looks down at the falling ball');
  // a count-down that starts while the ball is still rolling waits for it
  class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    applyMatrix4() { return this; } subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    cross(v) { const { x, y, z } = this; this.x = y * v.z - z * v.y; this.y = z * v.x - x * v.z; this.z = x * v.y - y * v.x; return this; }
    normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } negate() { this.x *= -1; this.y *= -1; this.z *= -1; return this; } }
  const pts = [[0, 0, 0], [0, 1, 0], [1, 0, 0]];
  const panel = { updateWorldMatrix() {}, matrixWorld: null, geometry: { boundingBox: { getCenter: (v) => v }, attributes: { position: { getX: (i) => pts[i][0], getY: (i) => pts[i][1], getZ: (i) => pts[i][2] } } } };
  fx.T = { Vector3: V3 }; fx.o = { numbers: { 5: panel, 4: panel } }; fx.chase = c; fx.rippleFor = () => null; fx.showSpikeNumber = () => {};
  const cam = fx.s.camHold, anim = fx.countAnim({ from: 5, to: 4, dur: 2600 });
  anim.t = 500; anim.step(0.2);
  assert.equal(anim.t, 0, 'the count-down holds while the ball still rolls'); assert.equal(fx.s.camHold, cam, 'and the camera stays on the ball');
  fx.chase = null; anim.step(0.01);
  assert.notEqual(fx.s.camHold, cam, 'once it has dropped into the pit, the count-down cuts to the number'); assert.equal(fx.s.snapCamera, true);
}
console.log('challengeFx tests passed');
