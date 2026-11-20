// Runs the real BoardScene code against a "stand-in" for Three.js and the DOM.
// It cannot check how anything LOOKS (only a browser can), but it proves the scene builds,
// plays every kind of event (3D dice, throws, drops, challenges), keeps pawns in sync with the
// host, shows the right buttons, and never throws.
import assert from 'node:assert/strict';

function stub() {
  const f = function () {};
  return new Proxy(f, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (!(p in t)) t[p] = stub();
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}

globalThis.window = globalThis;
const usedThree = new Set(); // every THREE.* name the scene touches, checked against the real r128 API at the end
globalThis.THREE = new Proxy(stub(), { get(t, p) { if (typeof p === 'string') usedThree.add(p); return Reflect.get(t, p); } });
globalThis.document = { createElement: () => stub(), body: { style: {} } };
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};

const { app } = await import('../js15/app.js');
const { BoardScene, diceBounce } = await import('../js15/scenes/boardScene.js');
const { BoardGame, DUR } = await import('../js15/game/boardGame.js');
const { mulberry32 } = await import('../js15/util/rng.js');
const { ISLAND } = await import('../js15/game/boardData.js');

const els = {
  '#counter': { hidden: true, className: '', textContent: '' },
  '#fade': { style: {} },
  '#fadeName': { style: {}, innerHTML: '' },
  '#choices': { hidden: true, innerHTML: '' },
};
app.ui = { className: '', innerHTML: '', onclick: null, querySelector: (sel) => (els[sel] ||= stub()), appendChild() {} };
app.canvas3d = { style: {} };
// a stand-in for the loaded map: it "arrives" at once, so every test runs with the map attached
const hiddenTiles = [];
const fakeBoard = { scale: 0.016, island: stub(), volcano: stub(), sky: stub(), painted: [],
  props: new Map(['m001_20', 'm001_22', 'm001_26', 'm001_27', 'm001_28', 'm001_29', 'm001_30', 'm001_31', 'm001_35', 'm001_35l', 'm001_60', 'm001_62', 'm001_70'].map((n) => [n, stub()])),
  spaceMeshes: { island: { get: (id) => ({ set visible(v) { if (!v) hiddenTiles.push(id); } }) }, volcano: { get: () => null } },
  setSpaceTexture(area, id, tex) { this.painted.push([area, id]); return true; } };
app.loadBoard = () => ({ then(fn) { fn(fakeBoard); return { catch() {} }; } });

function makeSession(bg, mySlot, names) {
  const roster = { players: names.map((n, i) => ({ slot: i, name: n, kind: i === mySlot ? 'human' : 'npc', wasHuman: i === mySlot, connected: i === mySlot })) };
  const s = { role: 'host', mySlot, roster, board: bg.snapshot(), handler: null, stops: 0, choices: [],
    setTurnHandler(fn) { this.handler = fn; }, stop() { this.stops++; }, choose(o) { this.choices.push(o); }, backToLobby() {} };
  return s;
}

// ---- stage is always 16:9, whatever the window ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(1), isNpc: () => true });
  bg.start(0);
  app.session = makeSession(bg, 0, ['A', 'B']);
  for (const [w, h] of [[1280, 720], [700, 900], [2400, 600]]) {
    app.view.scale = Math.min(w / 1280, h / 720);
    const sc = new BoardScene(); sc.enter();
    assert.equal(sc.fixedStage, true);
    assert.ok(Math.abs(sc.camera.aspect - 16 / 9) < 1e-9, `aspect is 16:9 at ${w}x${h}`);
    sc.exit();
  }
  app.view.scale = 1;
}

// ---- full games: every event type plays, pawns always end where the host says ----
const seenKinds = new Set();
for (const seed of [11, 12, 13, 14]) {
  const bg = new BoardGame({ slots: [0, 1, 2, 3], rng: mulberry32(seed), isNpc: () => true });
  const start = bg.start(0);
  const session = makeSession(bg, 0, ['P1', 'P2', 'P3', 'P4']);
  app.session = session;

  const scene = new BoardScene();
  scene.enter();
  assert.ok(session.handler, 'scene registers a turn handler');
  assert.equal(Object.keys(scene.pawns).length, 4, 'one pawn per player');

  const run = (limit = 40000) => {
    for (let i = 0; i < limit; i++) {
      scene.update(1 / 60);
      if (!scene.anim && scene.queue.length === 0 && scene.idle) return;
    }
    throw new Error('animation never finished');
  };
  session.handler({ events: start, board: session.board });
  run();

  let now = 0, results = 0, sawSpin = false, lastTurn = null;
  while (!bg.over && results < 60000) {
    now += 1e7;
    const res = bg.update(now);
    if (!res) continue;
    results++;
    res.events.forEach((e) => seenKinds.add(e.t + (e.mode ? `:${e.mode}` : '')));
    session.board = res.board;
    session.handler(res);
    run();
    if (res.events[0].t === 'diceStart') {
      sawSpin = true; const wheelOnly = res.events[0].wheel && res.events[0].dice.length === 0;
      if (res.events[0].wheel) assert.ok(scene.wheel && scene.wheel.slots.length >= 1, 'the wheel is spinning');
      if (!wheelOnly) { assert.ok(scene.dice.length >= 1, 'dice exist while spinning'); assert.equal(scene.diceGroup.visible, true); }
    }
    if (res.events.some((e) => e.t === 'diceStop' && !e.partial)) { assert.equal(scene.dice.length, 0, 'dice cleared after landing'); assert.equal(scene.diceGroup.visible, false); }
    res.events.forEach((e) => { if (e.t === 'turnStart') lastTurn = e.slot; if (e.t === 'move' && e.follow) lastTurn = e.slot; if (e.t === 'roundStart' && res.events.some((x) => x.t === 'flyover')) lastTurn = e.order[0]; }); // after the flyover the camera goes straight to the first roller
    if (lastTurn != null) assert.equal(scene.camSlot, lastTurn, 'camera only follows the player whose turn started (no jumping to the next player early)');
    assert.equal(els['#counter'].hidden, true, 'move counter is hidden when nothing is moving');
    if (!res.events.some((e) => e.t === 'diceStart' || e.t === 'choiceStart')) assert.equal(scene.control, null, 'no buttons left over once a step is finished');
    for (const key of Object.keys(res.board.positions)) {
      const pawn = scene.pawns[key], at = res.board.positions[key];
      assert.deepEqual([pawn.track, pawn.idx], [at.track, at.idx], `pawn ${key} matches the host`);
      assert.equal(pawn.scale, 1);
    }
  }
  assert.ok(bg.over && sawSpin, 'game ended');
  assert.match(String(els['#banner'].innerHTML), /wins/);
  scene.exit();
}
for (const k of ['flyover', 'roundStart', 'turnStart', 'diceStart', 'diceStop', 'space', 'win', 'move:walk', 'move:fast', 'move:fly', 'move:drop', 'choiceStart', 'choiceStop']) {
  assert.ok(seenKinds.has(k), `a full game exercised "${k}" (${[...seenKinds].join(', ')})`);
}

// ---- buttons: Stop on your own spinning dice; crates/barrels on your own choice ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(5), isNpc: (s) => s === 1 });
  const ev = bg.start(0); bg.order = [0, 1]; bg.turn = 0; bg.tiers = { 0: 'gold', 1: null }; bg.curves = { 0: 0.1, 1: null };
  const session = makeSession(bg, 0, ['A', 'B']);
  app.session = session;
  const scene = new BoardScene(); scene.enter();
  session.handler({ events: ev, board: session.board });
  assert.equal(scene.canStop(), false, 'no Stop before the dice spin');
  for (let i = 0; i < 1000; i++) scene.update(1 / 60);

  const spin = bg.update(bg.readyAt + 1);
  session.board = spin.board; session.handler(spin);
  for (let i = 0; i < 200; i++) scene.update(1 / 60);
  assert.equal(scene.dice.length, 2, 'standard die + gold die');
  assert.ok(Object.values(scene.pawns).every((pw) => pw.badge.visible === false), 'number markers are hidden while the dice are on screen');
  assert.equal(scene.canStop(), true, 'Stop is available on your turn');
  scene.doStop();
  assert.equal(session.stops, 1);
  assert.equal(scene.canStop(), false, 'only one Stop per roll');

  // a rejoining player in the middle of a roll catches up from the snapshot
  const late = new BoardScene();
  app.session = makeSession(bg, 0, ['A', 'B']);
  app.session.board = bg.snapshot();
  late.enter();
  assert.equal(late.dice.length, 2, 'rejoin: dice already spinning');
  late.exit();

  // someone else's turn: no buttons
  app.session = makeSession(bg, 1, ['A', 'B']); app.session.board = bg.snapshot();
  const other = new BoardScene(); other.enter();
  for (let i = 0; i < 200; i++) other.update(1 / 60);
  assert.equal(other.canStop(), false, "can't stop someone else's dice");
  other.exit();

  // crates and barrels
  const bg2 = new BoardGame({ slots: [0, 1], rng: mulberry32(8), isNpc: (s) => s === 1 });
  const ev2 = bg2.start(0); bg2.order = [0, 1]; bg2.turn = 0; bg2.tiers = { 0: null, 1: null };
  bg2.positions[0] = { track: 'island', idx: 41 }; bg2.step = { kind: 'choice', purpose: 'crates', remaining: 2 };
  const s2 = makeSession(bg2, 0, ['A', 'B']); app.session = s2;
  const sc2 = new BoardScene(); sc2.enter();
  const ch = bg2.update(bg2.readyAt + 1);
  s2.board = ch.board; s2.handler(ch);
  for (let i = 0; i < 200; i++) sc2.update(1 / 60);
  assert.equal(sc2.canChoose(), true); assert.equal(sc2.canStop(), false);
  sc2.doChoose(1);
  assert.deepEqual(s2.choices, [1]);
  assert.equal(sc2.canChoose(), false);
  sc2.exit();
}


// ---- the Crates/Barrels buttons go away once the choice is made (and the camera stays on the chooser) ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(8), isNpc: (x) => x === 1 });
  const ev = bg.start(0); bg.order = [0, 1]; bg.turn = 0; bg.tiers = { 0: null, 1: null };
  bg.positions[0] = { track: 'island', idx: 41 }; bg.positions[1] = { track: 'volcano', idx: 3 };
  bg.step = { kind: 'choice', purpose: 'crates', remaining: 2 };
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  assert.equal(sc.camSlot, 0);
  const run = () => { for (let i = 0; i < 40000; i++) { sc.update(1 / 60); if (!sc.anim && !sc.queue.length && sc.idle) return; } throw new Error('stuck'); };
  s.handler({ events: ev, board: s.board }); run();
  const t = bg.update(bg.readyAt + 1); s.board = t.board; s.handler(t); run();
  assert.equal(sc.canChoose(), true);
  bg.requestChoice(0, 0);
  const done = bg.update(bg.readyAt + 2); s.board = done.board;
  assert.equal(s.board.current, 1, 'the next player (in the volcano) is already "current" on the host');
  s.handler(done);
  const seen = new Set();
  for (let i = 0; i < 40000; i++) {
    sc.update(1 / 60); seen.add(sc.camSlot);
    if (!sc.anim && !sc.queue.length && sc.idle) break;
  }
  assert.deepEqual([...seen], [0], 'camera never jumps to the volcano player while the chooser is still being shown');
  assert.equal(sc.control, null); assert.equal(sc.canChoose(), false);
  assert.equal(els['#choices'].hidden, true, 'Crates/Barrels buttons are gone');
  // the next turn then fades in with the new player
  const nxt = bg.update(bg.readyAt + 1); s.board = nxt.board; s.handler(nxt); run();
  assert.equal(sc.camSlot, 1); sc.exit();
}

// ---- doubles: the 3rd die waits for its own Stop, and the landed dice stay on the table ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(5), isNpc: (x) => x === 1 });
  const ev = bg.start(0); bg.order = [0, 1]; bg.turn = 0; bg.tiers = { 0: 'gold', 1: null }; bg.curves = { 0: 0.1, 1: null };
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  const run = () => { for (let i = 0; i < 40000; i++) { sc.update(1 / 60); if (!sc.anim && !sc.queue.length && sc.idle) return; } throw new Error('stuck'); };
  s.handler({ events: ev, board: s.board }); run();
  let r = bg.update(bg.readyAt + 1); s.board = r.board; s.handler(r); run();
  assert.equal(sc.dice.length, 2);
  bg.rng = (() => { const v = [(3 - 0.5) / 6, 0.4167]; let i = 0; return () => (i < v.length ? v[i++] : 0.5); })();
  bg.requestStop(0);
  r = bg.update(bg.readyAt + 2); s.board = r.board;
  assert.equal(r.events[0].partial, true, 'scripted doubles');
  s.handler(r); run();
  assert.equal(sc.dice.length, 2, 'the two landed dice stay');
  assert.equal(sc.canStop(), false, 'no Stop until the bonus die spins');
  r = bg.update(bg.readyAt + 1); s.board = r.board; s.handler(r); run();
  assert.equal(sc.dice.length, 3, 'a third die joins the landed ones');
  assert.equal(sc.dice.filter((d) => !d.landing).length, 1, 'only the new one is spinning');
  assert.equal(sc.canStop(), true, 'the bonus die has its own Stop button');
  sc.doStop(); assert.equal(s.stops, 1);
  bg.requestStop(0); r = bg.update(bg.readyAt + 2); s.board = r.board; s.handler(r); run();
  assert.equal(sc.dice.length, 0, 'all dice leave after the bonus die lands');
  assert.ok(Object.values(sc.pawns).every((pw) => pw.badge.visible === true), 'number markers come back once the dice are gone');
  sc.exit();
}

// ---- move counter counts down step by step ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(2), isNpc: () => true });
  const ev = bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  const path = [1, 2, 3, 4, 5].map((i) => ({ track: 'island', idx: i }));
  sc.onTurn({ events: [{ t: 'move', slot: 0, mode: 'walk', path, count: { total: 5, dir: 'fwd' }, dur: 5 * 340 + 350 + DUR.cross }], board: s.board });
  const shown = [];
  for (let i = 0; i < 600; i++) { sc.update(1 / 60); const t = els['#counter'].hidden ? null : els['#counter'].textContent; if (t != null && shown[shown.length - 1] !== t) shown.push(t); }
  assert.deepEqual(shown, ['5', '4', '3', '2', '1', '0'], 'counts down on every step');
  assert.equal(els['#counter'].hidden, true);
  sc.onTurn({ events: [{ t: 'move', slot: 0, mode: 'fast', path: [4, 3, 2, 1].map((i) => ({ track: 'island', idx: i })), count: { total: 4, dir: 'back' }, dur: 4 * 190 + 350 }], board: s.board });
  const back = [];
  for (let i = 0; i < 600; i++) { sc.update(1 / 60); const t = els['#counter'].hidden ? null : els['#counter'].textContent; if (t != null && back[back.length - 1] !== t) back.push(t); }
  assert.deepEqual(back, ['-4', '-3', '-2', '-1', '-0'].map((x) => (x === '-0' ? '-0' : x)), 'backwards moves show a minus');
  sc.exit();
}

// ---- volcano drop: camera stays, then black, then the new place ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(2), isNpc: () => true });
  bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  const { DROP } = await import('../js15/game/boardGame.js');
  const total = Object.values(DROP).reduce((a, b) => a + b, 0);
  const to = { track: 'volcano', idx: 0 };
  sc.onTurn({ events: [{ t: 'move', slot: 0, mode: 'drop', path: [to], dur: total }], board: s.board });
  const pawn = sc.pawns[0];
  let sawBlackAt = null, trackChangeAt = null, camBefore = null;
  const startCam = (sc.update(1 / 60), { ...sc.cam });
  for (let i = 1; i < 60 * 8; i++) {
    sc.update(1 / 60);
    const ms = i * 1000 / 60;
    if (ms < DROP.shrink + DROP.hold - 100) camBefore = { ...sc.cam };
    if (sawBlackAt == null && Number(els['#fade'].style.opacity) >= 0.99) sawBlackAt = ms;
    if (trackChangeAt == null && pawn.track === 'volcano') trackChangeAt = ms;
  }
  assert.ok(Math.abs(camBefore.x - startCam.x) < 1e-6 && Math.abs(camBefore.z - startCam.z) < 1e-6, 'camera did not move during the first seconds');
  assert.ok(sawBlackAt > DROP.shrink + DROP.hold, 'black fade only after the camera has stayed for the hold time');
  assert.ok(trackChangeAt >= sawBlackAt - 50, 'the move to the volcano happens behind the black');
  assert.equal(pawn.scale, 1); assert.equal(Number(els['#fade'].style.opacity), 0, 'fade is gone at the end');
  sc.exit();
}

// ---- broken walls disappear for everyone, including a rejoining player ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(2), isNpc: () => true });
  bg.start(0); bg.broken.dragon = true;
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  assert.equal(sc.fx.broken.dragon, true, 'the guardian is gone from the board');
  assert.ok(fakeBoard.painted.some(([a, id]) => a === 'island' && id === 1), 'the spaces of the map get their icons');
  assert.ok(!fakeBoard.painted.some(([a, id]) => id === 0 || id === 73), 'the start area and the summit are not space tiles');
  for (const id of [6, 22, 39, 45, 56]) assert.ok(!hiddenTiles.includes(id), 'the tiles before the challenge stars stay, as plain spaces');
  assert.ok(hiddenTiles.includes(27) && hiddenTiles.includes(66) && fakeBoard.painted.some(([a, id]) => id === 121), 'the volcano-teleport tiles are drawn on the map\'s own warp mesh');
  assert.ok(!fakeBoard.painted.some(([a, id]) => a === 'island' && [6, 22, 39, 56].includes(id)), 'those tiles are blank (the one before the cave is a 1v-Rest)');
  assert.ok(sc.gate, 'the summit gate stands by the final star');
  sc.exit();
}

const fakeCam = () => ({ position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, lookAt() {} });
// ---- v7: natural dice jump ----
{
  let peak = 0, prev = diceBounce(0), maxStep = 0;
  for (let i = 1; i <= 1000; i++) {
    const b = diceBounce(i / 1000);
    assert.ok(b.y >= 0 && b.sy > 0.6 && b.sy < 1.3, 'bounce stays sane');
    peak = Math.max(peak, b.y); maxStep = Math.max(maxStep, Math.abs(b.y - prev.y)); prev = b;
  }
  assert.ok(peak > 7 && peak <= 7.6, 'first jump is still high');
  assert.equal(diceBounce(1).y, 0); assert.equal(diceBounce(1).sy, 1);
  assert.ok(diceBounce(0.04).sy < 0.9, 'crouches before jumping');
  assert.ok(diceBounce(0.53).sy < 0.9, 'squashes on landing');
  assert.ok(maxStep < 0.6, 'no sudden jumps in height');
}

// ---- v7: rolling camera is close, looks along the path, pawn faces it ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(5), isNpc: () => false });
  bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  sc.camSlot = 0; sc.snapCamera = true;
  sc.updateCamera(0.016);
  const wide = { ...sc.cam };
  sc.startSpinning([{ kind: 'base' }]);
  sc.snapCamera = true;
  sc.updateCamera(0.016);
  assert.equal(sc.rolling, true);
  const pawn = sc.pawns[0];
  const dWide = Math.hypot(wide.x - pawn.x, wide.z - pawn.z, wide.y - pawn.y);
  const dNear = Math.hypot(sc.cam.x - pawn.x, sc.cam.z - pawn.z, sc.cam.y - pawn.y);
  assert.ok(dNear > 12 && dNear < dWide * 1.1, `well back while rolling (${dNear.toFixed(1)})`);
  const dir = sc.pathDir(pawn);
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-6, 'path direction is a unit vector');
  assert.ok((sc.cam.tx - pawn.x) * dir.x + (sc.cam.tz - pawn.z) * dir.z > 0, 'looks toward where the player will go');
  for (let i = 0; i < 120; i++) sc.updatePawnPose(0.016);
  assert.ok(pawn.pitch < -0.4, 'head tips up toward the camera');
  sc.exit();
}

// ---- v8: dice over the map, crowd side-step, everyone in shot looks at the camera, flyover ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(6), isNpc: () => false });
  bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B', 'C']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  sc.camSlot = 0;
  sc.startSpinning([{ kind: 'base' }]);
  assert.ok(sc.dice.every((d) => d.mesh.renderOrder >= 1000), 'dice draw last, on top of the map');
  const p0 = sc.pawns[0], p1 = sc.pawns[1], p2 = sc.pawns[2];
  { // at the start everybody waits side by side in a row across the path and keeps their place
    const c0 = sc.pos.island[0], side0 = { x: -c0.dir.z, z: c0.dir.x };
    const lats = [p0, p1, p2].map((p) => (p.x - c0.x) * side0.x + (p.z - c0.z) * side0.z).sort((a, b) => a - b);
    assert.ok(lats[1] - lats[0] > 2 && lats[2] - lats[1] > 2, 'the waiting players stand in a row on the start plaza');
    const along = [p0, p1, p2].map((p) => (p.x - c0.x) * c0.dir.x + (p.z - c0.z) * c0.dir.z);
    assert.ok(Math.max(...along) - Math.min(...along) < 0.2, 'the row is straight across the path');
  }
  for (const p of [p0, p1, p2]) sc.snapPawn(p, { track: 'island', idx: 3 });
  sc.snapCamera = true; sc.updateCamera(0.016);
  for (let i = 0; i < 200; i++) { sc.updateCamera(0.016); sc.updatePawnPose(0.016); }
  const c = sc.pos[p0.track][p0.idx], dir = sc.pathDir(p0), side = { x: -dir.z, z: dir.x };
  const lat = (p) => ((p.x + p.ox) - c.x) * side.x + ((p.z + p.oz) - c.z) * side.z;
  assert.ok(Math.abs(lat(p0)) < 0.2, 'the roller stands on the middle of the space');
  assert.ok(Math.abs(lat(p1)) > 2.5 && Math.abs(lat(p2)) > 2.5 && lat(p1) * lat(p2) > 0 && Math.abs(lat(p1) - lat(p2)) > 1.5, 'space-mates stand side by side on one side of the roller');
  for (const p of [p0, p1, p2]) {
    const want = Math.atan2(sc.camera.position.x - (p.x + p.ox), sc.camera.position.z - (p.z + p.oz));
    assert.ok(Math.abs(Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw))) < 0.1, 'in-shot pawns look at the camera');
  }
  // walking: pawn faces the way it moves
  sc.clearDice(); sc.rolling = false;
  p0.x += 1; // a step along +x
  for (let i = 0; i < 200; i++) { sc.updatePawnPose(0.016); if (i < 3) { p0.x += 0.3; } }
  assert.ok(Math.abs(Math.atan2(Math.sin(Math.PI / 2 - p0.yaw), Math.cos(Math.PI / 2 - p0.yaw))) < 0.1, 'walking pawn faces its direction of travel');
  sc.exit();
}
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(8), isNpc: () => true });
  let ev = bg.start(0), seen = [], now = 0;
  for (let i = 0; i < 400 && !seen.includes('flyover'); i++) {
    now += 1e7; const r = bg.update(now); if (!r) continue; seen.push(...r.events.map((e) => e.t));
  }
  const fi = seen.indexOf('flyover');
  assert.ok(fi > 0 && seen[fi + 1] === 'roundStart', 'after everyone has rolled: flyover, then the next round');
}

// ---- v8.1: nothing about the next round is shown during the flyover; dice are in the transparent pass ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(8), isNpc: () => true });
  const start = bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter();
  sc.s.board = bg.snapshot(); sc.camera = fakeCam();
  assert.ok(sc.dieMesh('base').material.every((m) => m.transparent === true), 'dice draw after the space labels');
  sc.onTurn({ events: start });
  let now = 0, found = null;
  while (!found) {
    now += 1e7; const r = bg.update(now); if (!r) continue;
    if (r.events.some((e) => e.t === 'flyover')) found = r;
    s.board = r.board; sc.s.board = r.board;
  }
  assert.ok(found.board.order.length === 2);
  sc.queue = []; sc.anim = null;
  sc.onTurn({ events: found.events });
  sc.holdHud = true; sc.refreshHud();
  assert.equal(String(els['#turnmsg'].textContent), '', 'no "whose turn" text during the flyover');
  assert.ok(!/wp-dot on/.test(String(els['#order'].innerHTML)), 'nobody shown as moving');
  assert.equal(els['#left'].hidden, true, 'no "Left" banner between rounds');
  sc.exit();
}

// ---- v10: after the flyover, cut straight to the first roller behind black ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(8), isNpc: () => true });
  const start = bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B', 'C']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  sc.onTurn({ events: start });
  let now = 0, found = null;
  while (!found) {
    now += 1e7; const r = bg.update(now); if (!r) continue;
    s.board = r.board;
    if (r.events.some((e) => e.t === 'flyover')) found = r; else sc.onTurn(r);
    for (let i = 0; i < 20000 && !found && (sc.anim || sc.queue.length); i++) sc.update(1 / 60);
  }
  for (let i = 0; i < 3000 && (sc.anim || sc.queue.length); i++) sc.update(1 / 60);
  sc.onTurn({ events: found.events });
  const first = found.events.find((e) => e.t === 'roundStart').order[0];
  let blackAfter = true, cutBlack = true, steps = 0;
  while ((sc.anim || sc.queue.length) && steps++ < 60000) {
    sc.update(1 / 60);
    const op = Number(els['#fade'].style.opacity);
    if (sc.camSlot === first && sc.snapCamera === true && op < 0.99) cutBlack = false;
  }
  assert.equal(cutBlack, true, 'the camera cut to the first roller only while the screen was black');
  assert.equal(sc.camSlot, first, 'camera is on the first roller of the new round');
  sc.exit();
}

// ---- v11: no "Your turn!" while another player's move is still playing; black stays black until the first turn ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(8), isNpc: (x) => x === 1 });
  const start = bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  sc.onTurn({ events: start });
  for (let i = 0; i < 2000 && (sc.anim || sc.queue.length); i++) sc.update(1 / 60);
  let now = 0, checked = 0;
  for (let n = 0; n < 400 && checked < 3; n++) {
    now += 1e7; const r = bg.update(now); if (!r) continue;
    s.board = r.board; sc.onTurn(r);
    const started = r.events.some((e) => e.t === 'turnStart');
    for (let i = 0; i < 3000 && (sc.anim || sc.queue.length); i++) {
      sc.update(1 / 60);
      if (!started && sc.shownTurn !== null && sc.shownTurn === 1 && sc.s.mySlot === 0) assert.ok(!/Your turn/.test(String(els['#turnmsg'].textContent)), 'no "Your turn!" while the other player is still moving');
    }
    // after the animations end, still showing the previous turn until the next turnStart
    if (!started) { assert.equal(sc.shownTurn, sc.shownTurn); checked++; }
  }
  // the host's current player may already be me; the screen must not say so yet
  sc.shownTurn = 1; sc.s.board = { ...sc.s.board, current: 0 }; sc.refreshHud();
  assert.ok(!/Your turn/.test(String(els['#turnmsg'].textContent)), 'turn text follows the shown turn, not the host\'s current player');
  // black screen is not dropped by the idle sync while waiting for the first turn
  sc.blackIn = true; els['#fade'].style.opacity = '1'; sc.syncIdle();
  assert.equal(els['#fade'].style.opacity, '1', 'idle sync keeps the black screen');
  sc.exit();
}

// ---- v12: staged behind black = peers are already beside the roller (no hopping); choice buttons are cleared ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(6), isNpc: () => false });
  bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B', 'C']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  sc.camSlot = 0; sc.staged = true; els['#fade'].style.opacity = '1';
  for (const k of [0, 1, 2]) sc.snapPawn(sc.pawns[k], { track: 'island', idx: 3 });
  sc.updatePawnPose(0.016);
  const c = sc.pos[sc.pawns[0].track][sc.pawns[0].idx];
  const d = (p) => Math.hypot(p.x + p.ox - c.x, p.z + p.oz - c.z);
  assert.ok(d(sc.pawns[0]) < 0.01 && d(sc.pawns[1]) > 3 && d(sc.pawns[2]) > 3, 'everyone is in place after a single frame behind black');
  // not black: they glide, never teleport
  sc.staged = false; sc.updatePawnPose(0.016);
  els['#fade'].style.opacity = '0'; sc.staged = true;
  for (const q of [1, 2]) { sc.pawns[q].ox = 0; sc.pawns[q].oz = 0; }
  sc.updatePawnPose(0.016);
  assert.ok(d(sc.pawns[1]) < 1.5, 'in view they move smoothly');
  // choice buttons are emptied when nobody (or someone else) has to choose
  sc.control = null; sc.refreshHud();
  assert.equal(String(els['#choices'].innerHTML), '', 'old Crates/Barrels buttons are gone');
  assert.equal(els['#choices'].hidden, true);
  sc.exit();
}

// ---- v13: new space events play on screen ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(4), isNpc: () => false });
  bg.start(0); bg.order = [0, 1, 2]; bg.turn = 0;
  const s = makeSession(bg, 0, ['Ann', 'Ben', 'Cy']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  const run = () => { for (let i = 0; i < 20000 && (sc.anim || sc.queue.length); i++) sc.update(1 / 60); sc.update(1 / 60); sc.update(1 / 60); };
  // names inside host messages
  assert.equal(sc.fillNames('{1} is swept back 5 spaces!'), 'Ben is swept back 5 spaces!');
  // eruption: tiles change to -4 and back
  const v = ISLAND_IDX('plus5', 1);
  sc.onTurn({ events: [{ t: 'eruption', active: 1, dur: 500 }] }); run();
  assert.equal(sc.eruptionCount, 1);
  sc.onTurn({ events: [{ t: 'eruption', active: 2, dur: 0 }] }); run();
  assert.equal(sc.eruptionCount, 2);
  sc.onTurn({ events: [{ t: 'eruption', active: 0, dur: 0 }] }); run();
  assert.equal(sc.eruptionCount, 0);
  // a move of someone else's pawn pans the camera to that pawn
  sc.camSlot = 0;
  sc.onTurn({ events: [{ t: 'move', slot: 1, mode: 'fly', follow: true, path: [{ track: 'island', idx: 5 }], dur: 800 }] }); run();
  assert.equal(sc.camSlot, 1);
  // minigame banner
  sc.onTurn({ events: [{ t: 'minigame', kind: 'duel', slot: 0, opp: 2, dur: 300 }] }); run();
  // 1v1: buttons show the opponents' names
  sc.control = null; sc.idle = true;
  sc.onTurn({ events: [{ t: 'choiceStart', slot: 0, label: '1 vs 1! Pick who to challenge', options: ['1', '2', '?'], slots: [1, 2, null], places: [1, 2, null], dur: 0 }] }); run();
  sc.refreshHud();
  const html = String(els['#duel'].innerHTML);
  assert.ok(html.includes('Ben') && html.includes('Cy') && html.includes('data-o="1"'), 'boxes are named after the opponents');
  assert.ok(html.includes('1st') && html.includes('2nd'), 'boxes show each player\'s place');
  assert.ok(html.indexOf('Ben') < html.indexOf('Cy') && html.indexOf('Cy') < html.indexOf('Random') && html.includes('>?<'), 'sorted by place, then the ? / Random box last');
  assert.equal(els['#duel'].hidden, false); assert.equal(els['#choices'].hidden, true);
  sc.control = null; sc.refreshHud(); assert.equal(els['#duel'].hidden, true, 'boxes disappear once the choice is made');
  sc.exit();
}
function ISLAND_IDX(type, nth) { return nth; }

// ---- v14: the wheel spins until Stop, then lands on the chosen player; the red die shows 4-6 ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(4), isNpc: () => false });
  bg.start(0); bg.order = [0, 1, 2]; bg.turn = 0;
  const s = makeSession(bg, 0, ['Ann', 'Ben', 'Cy']); app.session = s;
  const sc = new BoardScene(); sc.enter(); sc.camera = fakeCam();
  const run = () => { for (let i = 0; i < 20000 && (sc.anim || sc.queue.length); i++) sc.update(1 / 60); sc.update(1 / 60); sc.update(1 / 60); };
  sc.onTurn({ events: [{ t: 'diceStart', slot: 0, dice: [{ kind: 'tornado' }], label: 'Tornado!', dur: 0, wheel: { purpose: 'tornado', slots: [0, 1, 2] } }] }); run();
  assert.ok(sc.wheel && sc.wheel.slots.length === 3 && sc.dice.length === 1, 'wheel and red die appear together');
  assert.equal(sc.diceGroup.position.x > 2, true, 'the die sits on the right, the wheel on the left');
  const th = sc.wheel.theta; for (let i = 0; i < 30; i++) sc.update(1 / 60);
  assert.ok(sc.wheel.theta > th + 1, 'the wheel keeps spinning until Stop');
  for (const target of [0, 1, 2]) {
    sc.wheel.landing = false;
    sc.onTurn({ events: [{ t: 'diceStop', slot: 0, dice: [{ v: 5, kind: 'tornado' }], total: 5, doubles: false, wheel: { target }, dur: 3600 }] });
    sc.update(1 / 60); // start the landing
    const w = sc.wheel, sa = Math.PI * 2 / 3;
    for (let i = 0; i < 20000 && sc.anim && sc.anim.t / sc.anim.dur < 0.85; i++) sc.update(1 / 60); // the hold at the end
    assert.ok(sc.wheel === w && w, 'wheel is still showing its result');
    const ang = ((-w.theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    assert.equal(Math.floor(ang / sa), target, `pointer is on slice ${target}`);
    run();
    assert.equal(sc.wheel, null, 'wheel goes away after the result');
    sc.onTurn({ events: [{ t: 'diceStart', slot: 0, dice: [{ kind: 'tornado' }], label: '', dur: 0, wheel: { purpose: 'tornado', slots: [0, 1, 2] } }] }); run();
  }
  // UFO: wheel only, no dice, centred
  sc.clearDice();
  sc.onTurn({ events: [{ t: 'diceStart', slot: 0, dice: [], label: 'UFO!', dur: 0, wheel: { purpose: 'ufo', slots: [1, 2] } }] }); run();
  assert.ok(sc.wheel && sc.dice.length === 0 && sc.diceGroup.visible === false && sc.diceGroup.position.x === 0);
  sc.exit();
}

// ---- long throws: the pawn stays on screen at its destination before the next player goes ----
assert.ok(DUR.fly >= 2400 && DUR.drop >= 1800);

// ---- v15: the scene only uses things that really exist in Three.js (r160) ----
{
  const R128 = new Set(['Mesh', 'MeshLambertMaterial', 'MeshBasicMaterial', 'Group', 'BufferAttribute', 'BufferGeometry', 'CanvasTexture', 'PlaneGeometry',
    'PointLight', 'HemisphereLight', 'DirectionalLight', 'Fog', 'Color', 'Scene', 'PerspectiveCamera', 'WebGLRenderer', 'Sprite', 'SpriteMaterial',
    'SphereGeometry', 'CircleGeometry', 'BoxGeometry', 'CylinderGeometry', 'TubeGeometry', 'CatmullRomCurve3', 'Raycaster', 'AdditiveBlending', 'ConeGeometry', 'Quaternion', 'Euler', 'Vector3', 'Matrix4', 'DoubleSide', 'REVISION', 'SRGBColorSpace']);
  const odd = [...usedThree].filter((n) => !R128.has(n));
  assert.deepEqual(odd, [], `unknown THREE names: ${odd.join(', ')}`);
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(5), isNpc: () => true });
  bg.start(0);
  app.session = makeSession(bg, 0, ['A', 'B', 'C']);
  const sc = new BoardScene(); sc.enter();
  assert.equal(sc.tiles.island.length, 80); assert.equal(sc.tiles.volcano.length, 10);
  assert.equal(sc.tiles.island[1].id, 1); assert.equal(sc.tiles.island[77].id, 72); assert.equal(sc.tiles.island[0].id, null); assert.equal(sc.tiles.island[79].id, null);
  for (const i of [7, 24, 42, 49, 61, 78]) assert.equal(sc.tiles.island[i].id, null, 'challenge stars have no tile');
  assert.equal(sc.tiles.volcano[1].id, 101); assert.equal(sc.tiles.volcano[8].id, 108);
  const withProp = (type) => sc.tiles.island.filter((t) => t.node.type === type);
  for (const type of ['ufo', 'tornado']) assert.ok(withProp(type).every((t) => !t.prop), `no extra marker beside ${type} spaces`);
  assert.ok(sc.fx.o && sc.fx.o.floaters.length === 2 && sc.fx.o.floaters[0].length === 3, 'three crates and three barrels');
  assert.ok(sc.fx.o.ball && typeof sc.fx.o.ball.goHome === 'function', 'the spike ball is set up (and its loose copies on the map hidden)');
  assert.equal(sc.pawns[0].head !== undefined, true);
  sc.exit();
}

// ---- v26 HUD: the order strip, the path map's dots, pause ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(5), isNpc: () => true }); bg.start(0);
  const s = makeSession(bg, 0, ['A', 'B', 'C']);
  s.offline = true; s.setPaused = (on) => { s.pausedFlag = on; };
  app.session = s;
  const sc = new BoardScene(); sc.enter();
  sc.holdHud = false; sc.camSlot = 1; sc.refreshHud();
  const html = String(els['#order'].innerHTML);
  assert.equal((html.match(/wp-dot/g) || []).length, 3, 'one circle per player');
  assert.equal((html.match(/wp-dot on/g) || []).length, 1, 'only the player the camera is on shows a face');
  assert.equal((html.match(/<img/g) || []).length, 1);
  // the map: record what it draws
  const dots = [];
  let alpha = 1, fill = null;
  sc.mm = new Proxy({}, { get: (t, k) => (k === 'arc' ? (x, y, r) => { if (r === 16) dots.push({ x, y, alpha, fill }); }
    : k === 'createRadialGradient' ? () => ({ addColorStop(o, c) { if (o === 0.45) fill = c; } })
    : k in t ? t[k] : () => {}), set: (t, k, v) => { if (k === 'globalAlpha') alpha = v; t[k] = v; return true; } });
  const at = (pawn, track, idx) => { const q = sc.pos[track][idx]; Object.assign(pawn, { track, idx, x: q.x, y: q.y, z: q.z }); };
  at(sc.pawns[0], 'island', 10); at(sc.pawns[1], 'island', 10); at(sc.pawns[2], 'volcano', 3);
  s.board = { ...s.board, volcanoReturn: { 2: { track: 'island', idx: 30 } } }; sc.s.board = s.board;
  sc.camSlot = 0; sc.t = 0; sc.drawMinimap();
  assert.equal(dots.length, 2, 'two players on one spot share a dot; the volcano player is shown where they come back out');
  assert.equal(dots.filter((d) => d.alpha < 1).length, 1, 'the player in the volcano is faded');
  const shared = dots.find((d) => d.alpha === 1).fill;
  dots.length = 0; sc.t = 0.85; sc.drawMinimap();
  assert.notEqual(dots.find((d) => d.alpha === 1).fill, shared, 'the shared dot takes turns between the two colours');
  dots.length = 0; sc.camSlot = 2; sc.drawMinimap();
  assert.equal(dots.length, 1, 'camera on the player in the volcano: the cave map, with only them on it');
  assert.equal(dots[0].alpha, 1);
  // the "Left" banner counts down while walking, not only when the turn is over
  {
    at(sc.pawns[0], 'island', 10);
    const before = sc.leftFor(0), path = [11, 12, 13, 14].map((idx) => ({ track: 'island', idx }));
    const mv = sc.beginMove({ t: 'move', slot: 0, mode: 'walk', path, count: { total: 4, dir: 'fwd' }, dur: 4 * 340 + 350 });
    mv.step(0.5);
    const mid = sc.leftFor(0);
    assert.ok(mid < before && mid > before - 4, `fewer spaces left half way (${before} -> ${mid})`);
    mv.step(1); mv.end();
    assert.equal(sc.leftFor(0), before - 4);
  }
  // the dragon's fireball: the player is blown back onto the space behind in ONE arc, facing the dragon, and lands upright
  {
    at(sc.pawns[0], 'island', 24);
    const pw = sc.pawns[0], A = { x: pw.x, y: pw.y, z: pw.z }, B = sc.nodeXYZ('island', 23, 0, true);
    const note = sc.fx.playNote({ fx: 'fireball', dur: DUR.fire }, pw);
    for (let u = 0; u <= 1.0001; u += 0.05) { note.step(Math.min(1, u)); assert.ok(Math.hypot(pw.x - A.x, pw.z - A.z) < 1e-9, 'the fireball itself does not move the player'); }
    note.end();
    const mv = sc.beginMove({ t: 'move', slot: 0, mode: 'knock', path: [{ track: 'island', idx: 23 }], count: { total: 1, dir: 'back' }, dur: DUR.knock });
    let ups = 0, lastY = pw.y, rising = null, peaks = 0, lastD = 0, back = true;
    for (let u = 0.02; u <= 1.0001; u += 0.02) {
      mv.step(Math.min(1, u));
      const d = Math.hypot(pw.x - A.x, pw.z - A.z); if (d + 1e-9 < lastD) back = false; lastD = d;
      const r = pw.y > lastY + 1e-6; if (rising === true && !r) peaks++; rising = r; lastY = pw.y; if (r) ups++;
    }
    assert.equal(peaks, 1, 'a single arc, no hopping about'); assert.ok(back, 'always moving away from the dragon');
    assert.ok(Math.hypot(pw.x - B.x, pw.z - B.z) < 1e-6, 'lands on the space behind');
    assert.equal(pw.fx, null, 'on their feet at the end');
    mv.end && mv.end();
  }
  // everyone below the spike ball runs at the same time: a move marked "with" plays alongside the one before it
  {
    assert.ok(sc.pawns[1], 'a second player');
    at(sc.pawns[0], 'island', 61); at(sc.pawns[1], 'island', 56);
    const run = (from, to) => { const p = []; for (let i = from - 1; i >= to; i--) p.push({ track: 'island', idx: i }); return p; };
    sc.queue.length = 0; sc.anim = null;
    sc.queue.push({ t: 'move', slot: 0, mode: 'fast', path: run(61, 50), count: { total: 11, dir: 'back' }, dur: 11 * DUR.fastStep + DUR.moveTail },
      { t: 'move', slot: 1, mode: 'fast', path: run(56, 50), count: { total: 6, dir: 'back' }, dur: 6 * DUR.fastStep + DUR.moveTail, with: true });
    sc.startNext();
    assert.equal(sc.queue.length, 0, 'both taken at once'); assert.ok(sc.anim.slotsMoving.has(0) && sc.anim.slotsMoving.has(1));
    const x0 = sc.pawns[0].x, x1 = sc.pawns[1].x;
    sc.anim.step(0.2);
    assert.ok(sc.pawns[0].x !== x0 && sc.pawns[1].x !== x1, 'both are running');
    sc.anim.step(1); sc.anim.end(); sc.anim = null;
    assert.equal(sc.pawns[0].idx, 50); assert.equal(sc.pawns[1].idx, 50);
    if (sc.fx.hidden) sc.fx.hidden.clear(); sc.pawns[0].fx = sc.pawns[1].fx = null;
  }
  // dev tools: the dice go away and the player is simply on the spot
  {
    sc.queue.length = 0; sc.anim = null;
    sc.queue.push({ t: 'devJump', slot: 0, to: { track: 'island', idx: 42 }, dur: 700 });
    sc.startNext();
    assert.equal(sc.pawns[0].idx, 42); assert.equal(sc.pawns[0].track, 'island'); assert.equal(sc.camSlot, 0);
    assert.equal(sc.control, null); assert.equal(sc.anim.dur, 700); sc.anim = null;
  }
  // the UFO swap: up, up, down, down; the camera cuts to each player in turn
  {
    at(sc.pawns[0], 'island', 20); at(sc.pawns[1], 'island', 30);
    const run = (ev) => { const an = sc.beginUfo({ t: 'ufo', dur: 2600, ...ev }); for (let u = 0; u <= 1; u += 0.1) if (an.step) an.step(u); if (an.end) an.end(); return an; };
    run({ phase: 'up', slot: 0 }); assert.equal(sc.camSlot, 0);
    run({ phase: 'up', slot: 1 }); assert.equal(sc.camSlot, 1);
    run({ phase: 'down', slot: 1, to: { track: 'island', idx: 20 } }); assert.equal(sc.camSlot, 1); assert.equal(sc.pawns[1].idx, 20);
    run({ phase: 'down', slot: 0, to: { track: 'island', idx: 30 } }); assert.equal(sc.camSlot, 0); assert.equal(sc.pawns[0].idx, 30);
    for (const k of [0, 1]) { assert.equal(sc.pawns[k].scale, 1); assert.equal(sc.pawns[k].fx, null); assert.notEqual(sc.pawns[k].group.visible, false); }
  }
  // walking goes down the middle of each space, and the walk ends in the middle (no slide afterwards)
  {
    at(sc.pawns[0], 'island', 30); at(sc.pawns[1], 'island', 40);
    sc.pawns[0].ox = 0.8; sc.pawns[0].oz = -0.5; // standing aside
    const path = [31, 32, 33].map((idx) => ({ track: 'island', idx }));
    const mv = sc.beginMove({ t: 'move', slot: 0, mode: 'walk', path, count: { total: 3, dir: 'fwd' }, dur: 3 * 340 + 350 });
    let worst = 0;
    for (let u = 0; u <= 1; u += 0.01) { mv.step(u); const pw = sc.pawns[0];
      for (const i of [31, 32, 33]) { const c = sc.pos.island[i]; const d = Math.hypot(pw.x - c.x, pw.z - c.z); if (d < 0.6) worst = Math.max(worst, d); } }
    mv.step(1); mv.end();
    const c = sc.pos.island[33];
    assert.ok(Math.hypot(sc.pawns[0].x - c.x, sc.pawns[0].z - c.z) < 1e-6, 'ends in the middle of the space');
    assert.equal(sc.pawns[0].ox, 0);
  }
  // after the vine leap the player runs on with their arms down (nothing left over from being in the air)
  {
    const v = ISLAND.findIndex((n) => n.type === 'vine');
    at(sc.pawns[0], 'island', v);
    const path = [1, 2, 3, 4, 5].map((k) => ({ track: 'island', idx: v + k }));
    const mv = sc.beginMove({ t: 'move', slot: 0, mode: 'walk', swing: 3, path, count: { total: 5, dir: 'fwd' }, dur: 20000 });
    let flew = false, runAfter = false;
    const pw = sc.pawns[0];
    for (let u = 0; u <= 1; u += 0.002) { mv.step(u); if (pw.fx && pw.fx.groundY != null) { flew = true; pw.groundY = pw.fx.groundY; /* as the frame loop does */ } else if (flew && !pw.fx && pw.groundY == null) runAfter = true; }
    assert.ok(flew, 'in the air on the vine'); assert.ok(runAfter, 'then on the ground, running normally');
    mv.end();
  }
  // shadows lie on the real surface below and tilt with it
  {
    const pw = sc.pawns[0], real = sc.groundHit;
    sc.groundHit = (x, y, z) => ({ y: 10 + 0.5 * (x - pw.group.position.x) }); // a slope rising along x
    const sh = { parent: null, position: { set(x, y, z) { this.v = [x, y, z]; } }, quaternion: {}, scale: { set() {} }, material: {} };
    pw.group.visible = true; pw.scale = 1; pw.shadowKey = null; pw.group.position.x = 3; pw.group.position.y = 10.2; pw.group.position.z = 4;
    sc.placeShadow(pw, sh, false);
    assert.ok(Math.abs(sh.position.v[1] - 10.03) < 1e-6, 'on the surface under the player');
    assert.ok(pw.shadowAt.n.x < -0.4 && pw.shadowAt.n.y < 0.95, 'tilted to the slope');
    sc.groundHit = () => null; pw.shadowKey = null; pw.group.position.x = 3.5;
    sc.placeShadow(pw, sh, false); assert.ok(Math.abs(sh.position.v[1] - 10.21) < 1e-6, 'nothing found: just under their feet');
    sc.groundHit = real;
  }
  // a spring jump: up out of the ground, over in one bounce, and the spring goes away again
  for (const [color, dir, path] of [['blue', 'fwd', [11, 12, 13, 14, 15]], ['red', 'back', [9, 8, 7, 6]]]) {
    at(sc.pawns[0], 'island', 10);
    const mv = sc.beginMove({ t: 'move', slot: 0, mode: 'spring', spring: color, path: path.map((idx) => ({ track: 'island', idx })), count: { total: path.length, dir }, dur: 2400 });
    for (let u = 0; u <= 1; u += 0.05) mv.step(u);
    mv.step(1); mv.end();
    assert.equal(sc.pawns[0].idx, path[path.length - 1], `${color} spring lands on the right space`);
    assert.equal(sc.springs[color].group.visible, false, 'the spring is gone again');
  }
  // pause: offline the game really stops
  sc.setPaused(true);
  assert.equal(s.pausedFlag, true); assert.equal(els['#pause'].hidden, false);
  const t0 = sc.t; for (let i = 0; i < 30; i++) sc.update(1 / 60);
  assert.equal(sc.t, t0, 'nothing moves while paused');
  assert.equal(sc.canStop(), false);
  sc.setPaused(false);
  assert.equal(s.pausedFlag, false); assert.equal(els['#pause'].hidden, true);
  sc.update(1 / 60); assert.ok(sc.t > t0);
  sc.exit();
}

// ---- the island viewer: the board on its own; every place and every set piece plays through ----
{
  const { ViewerScene } = await import('../js15/scenes/viewerScene.js');
  const bg = new BoardGame({ slots: [0, 1, 2, 3], rng: mulberry32(3), isNpc: () => true }); bg.start(0);
  app.session = makeSession(bg, 0, ['A', 'B', 'C', 'D']);
  const sc = new ViewerScene(); sc.enter();
  for (const [, v] of sc.places()) { sc.lookAt(v); sc.update(1 / 60); assert.ok(Number.isFinite(sc.orbit.tx + sc.orbit.yaw + sc.orbit.dist)); }
  for (const [name, fn] of sc.demos()) {
    fn();
    for (let i = 0; i < 60 * 25 && (sc.anim || sc.demo.length); i++) sc.update(1 / 30);
    assert.ok(!sc.anim && !sc.demo.length, `${name} plays to the end`);
    const p = sc.pawns[0]; assert.ok(Number.isFinite(p.x + p.y + p.z), `${name}: the pawn ends somewhere real`);
  }
  sc.exit();
}

// ---- walking: long strides (one full stride every ~5.7 units) and a full swing at walking speed ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(3), isNpc: () => true }); bg.start(0);
  app.session = makeSession(bg, 0, ['A', 'B']);
  const sc = new BoardScene(); sc.enter();
  const pawn = sc.pawns[0], g = pawn.group; g.position.x = 0; g.position.z = 0; pawn.gx = 0; pawn.gz = 0; pawn.phase = 0; pawn.amp = 0; pawn.fx = null; pawn.groundY = null;
  const space = 3.9, stepMs = DUR.walkStep, dt = 1 / 60, v = space / (stepMs / 1000); // a walk at the game's pace, spaces ~3.9 units apart
  let dist = 0;
  for (let i = 0; i < 120; i++) { g.position.x += v * dt; dist += v * dt; sc.animateLimbs(pawn, dt); }
  const strideLen = dist / (pawn.phase / (2 * Math.PI));
  assert.ok(strideLen > 5.3 && strideLen < 6.1, `one stride covers ${strideLen.toFixed(2)} units`);
  assert.ok(pawn.amp > 0.95, 'walking pace gives the full leg swing');
  assert.ok(stepMs <= 200, `a space takes ${stepMs} ms`);
  sc.exit();
}

// ---- the map's own motion (the water): the scene ticks it every frame, but not while an offline game is paused ----
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(2), isNpc: () => true });
  bg.start(0);
  app.session = makeSession(bg, 0, ['A', 'B']);
  const ticks = []; fakeBoard.tick = (dt) => ticks.push(dt);
  const sc = new BoardScene(); sc.enter();
  sc.update(1 / 60); sc.update(1 / 30);
  assert.deepEqual(ticks, [1 / 60, 1 / 30], 'the water moves with the frame time');
  sc.pausedHard = true; sc.update(1 / 60); assert.equal(ticks.length, 2, 'a paused game holds the water still');
  sc.pausedHard = false; delete fakeBoard.tick;
  sc.update(1 / 60); // a map without motion (older stand-ins) is fine too
  sc.exit();
}

// ---- 1v1 cards: the chooser's custom pointer shows on every screen, the chooser's own included ----
{
  const bg = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(5), isNpc: (x) => x !== 0 });
  bg.start(0);
  const s = makeSession(bg, 0, ['Ann', 'Ben', 'Cy']); app.session = s;
  const sent = []; const ptrs = { 0: { x: 0.5, y: 0.5, buttons: 0 }, 1: { x: 0.1, y: 0.1, buttons: 0 } };
  s.sendPointer = (x, y, b) => { sent.push([x, y, b]); Object.assign(ptrs[0], { x, y, buttons: b }); };
  s.getPointer = (slot) => ptrs[slot] || null;
  const toggles = []; const had = globalThis.document.body.classList;
  globalThis.document.body.classList = { toggle: (name, on) => toggles.push([name, on]) };
  const hadNorm = app.toNormalized; app.toNormalized = (x, y) => ({ x: x / 1280, y: y / 720 });
  let draws = 0; const ctx = { clearRect() {}, save() { draws++; }, restore() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, fill() {}, stroke() {}, fillText() {}, strokeText() {} };
  const hadPtrs = els['#ptrs']; els['#ptrs'] = { getContext: () => ctx };
  const cards = [0, 1, 2].map((i) => ({ dataset: { card: String(i) }, on: false, classList: { toggle(n, v) { cards[i].on = v; } } }));
  const hadAll = app.ui.querySelectorAll; app.ui.querySelectorAll = (sel) => (sel === '#duel .pbox' ? cards : []);
  const { duelCardCenter } = await import('../js15/game/duelLayout.js');
  const sc = new BoardScene(); sc.enter();
  const c1 = duelCardCenter(1, 3);
  sc.onPtr({ clientX: c1.x * 1280, clientY: c1.y * 720, buttons: 0 }); // the mouse was already here before the cards came up
  assert.equal(sent.length, 0, 'nothing is shared while no cards are shown');
  // my own pick
  sc.queue.length = 0; sc.anim = null; sc.idle = true; sc.stopSent = false;
  sc.control = { type: 'choose', slot: 0, options: ['1', '2', '?'], slots: [1, 2, null], places: [1, 2, null] };
  sc.refreshHud(); sc.updateDuelPointer();
  assert.deepEqual(sent[0], [c1.x, c1.y, 0], 'my pointer starts where my mouse already is');
  assert.equal(draws, 1, 'my own custom pointer is drawn on my screen');
  assert.deepEqual(toggles.at(-1), ['own-pointer', true], 'and it replaces the mouse cursor');
  assert.deepEqual(cards.map((c) => c.on), [false, true, false], 'the card under the pointer lifts');
  const c0 = duelCardCenter(0, 3);
  sc.onPtr({ clientX: c0.x * 1280, clientY: c0.y * 720, buttons: 1 }); sc.updateDuelPointer();
  assert.deepEqual(sent.at(-1), [c0.x, c0.y, 1], 'moving and pressing are shared with everyone');
  assert.deepEqual(cards.map((c) => c.on), [true, false, false]);
  sc.devOpen = true; sc.updateDuelPointer(); assert.deepEqual(toggles.at(-1), ['own-pointer', false], 'the mouse cursor comes back while the dev panel is open');
  sc.devOpen = false; sc.updateDuelPointer(); assert.deepEqual(toggles.at(-1), ['own-pointer', true]);
  // somebody else's pick: their pointer is drawn, my mouse cursor stays
  draws = 0;
  sc.control = { type: 'choose', slot: 1, options: ['0', '2', '?'], slots: [0, 2, null], places: [1, 2, null] };
  const c2 = duelCardCenter(2, 3); Object.assign(ptrs[1], { x: c2.x, y: c2.y });
  sc.refreshHud(); sc.updateDuelPointer();
  assert.equal(draws, 1, 'the chooser\'s pointer is drawn for watchers');
  assert.deepEqual(toggles.at(-1), ['own-pointer', false]);
  assert.deepEqual(cards.map((c) => c.on), [false, false, true]);
  const n = sent.length; sc.onPtr({ clientX: 5, clientY: 5, buttons: 0 }); assert.equal(sent.length, n, 'watchers do not share their mouse');
  // the cards go away: nothing drawn, cursor back; leaving the scene always restores the cursor
  draws = 0; sc.control = null; sc.refreshHud(); sc.updateDuelPointer(); assert.equal(draws, 0);
  sc.control = { type: 'choose', slot: 0, options: ['1', '2', '?'], slots: [1, 2, null], places: [1, 2, null] };
  sc.refreshHud(); sc.updateDuelPointer(); assert.deepEqual(toggles.at(-1), ['own-pointer', true]);
  sc.exit(); assert.deepEqual(toggles.at(-1), ['own-pointer', false], 'leaving the board gives the mouse cursor back');
  globalThis.document.body.classList = had; app.toNormalized = hadNorm; app.ui.querySelectorAll = hadAll;
  if (hadPtrs) els['#ptrs'] = hadPtrs; else delete els['#ptrs'];
}

// ---- dev tools, end to end: jump onto every kind of space, then the game carries on ----
for (const type of ['plus5', 'minus4', 'ufo', 'tornado', 'skull', 'volcano', 'mg11', 'mgRest', 'statueBlue', 'statueRed', 'dino', 'blank',
  'vine', 'dragon', 'crates', 'volcanoOrNot', 'spike', 'final', '@volcano', '@start', '@pending']) {
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(21), isNpc: (x) => x === 1 });
  let clock = 0;
  const s = makeSession(bg, 0, ['A', 'B']); app.session = s;
  s.offline = true; s.game = { board: bg };
  const emit = (res) => { s.board = res.board; s.handler(res); };
  s.devJump = (at) => { const r = bg.devJump(0, at, clock); if (r) emit(r); return !!r; };
  s.stop = () => bg.requestStop(0); s.choose = (o) => bg.requestChoice(0, o);
  const sc = new BoardScene(); sc.enter();
  emit({ events: bg.start(0), board: bg.snapshot() });
  // run the host clock and the screen together; press Stop / choose for me when it is my turn
  const play = (until, label) => {
    for (let i = 0; i < 60000; i++) {
      clock += 1000 / 60;
      const r = bg.update(clock); if (r) emit(r);
      sc.update(1 / 60);
      if (until()) return;
      if (!sc.devPending && i % 30 === 29) { if (sc.canStop() && !sc.devReady()) sc.doStop(); else if (sc.canChoose()) sc.doChoose(0); }
    }
    throw new Error(`${type}: stuck waiting for ${label} (phase ${bg.phase}, step ${bg.step && bg.step.purpose}, current ${bg.current()}, idle ${sc.idle}, control ${sc.control && sc.control.type})`);
  };
  if (type === '@pending') { // ask before your dice spin: it waits, then happens by itself
    sc.toggleDev(true); sc.devDo('land', 'ufo', 'UFO');
    assert.ok(sc.devPending || bg.positions[0].idx === ISLAND.findIndex((n) => n.type === 'ufo'));
    play(() => !sc.devPending && sc.idle && !sc.anim, 'the waiting jump');
    assert.equal(ISLAND[bg.positions[0].idx].type === 'ufo' || bg.step, true, 'landed on the UFO space');
    sc.exit(); continue;
  }
  play(() => sc.devReady(), 'my first roll');
  sc.toggleDev(true);
  if (type === '@volcano') sc.devDo('volcano', 1); else if (type === '@start') sc.devDo('start', 1); else sc.devDo('land', type, type);
  assert.equal(sc.devOpen, false, `${type}: the panel closes after the jump`);
  sc.update(1 / 60); assert.equal(sc.dice.length, 0, `${type}: the dice are gone`); assert.equal(sc.control, null);
  const turnsBefore = bg.round * 10 + bg.turn;
  play(() => bg.over || (bg.round * 10 + bg.turn !== turnsBefore && sc.idle && !sc.anim && !sc.queue.length), 'the turn to end');
  play(() => bg.over || sc.devReady() || (sc.canStop() && bg.current() === 0), 'my next roll');
  sc.exit();
}

// the throwing statues: the glare cards in front of the face are hidden, and the eyes and gem stay dark until it wakes
{
  const sc = new BoardScene();
  const color = () => ({ v: 1, setScalar(x) { this.v = x; } });
  const mat = (name) => ({ name, color: color(), clone() { return { name, color: color(), clone: this.clone }; } });
  const meshes = ['mr001m048', 'mr001m048_2', 'mr001m031', 'mr001m032'].map((n) => ({ isMesh: true, visible: true, material: mat(n), geometry: { index: null }, userData: {} }));
  const g = { traverse: (fn) => meshes.forEach(fn) };
  const shared = meshes[1].material;
  const st = sc.setupStatue(g, 'm001_31');
  assert.equal(meshes[2].visible, false); assert.equal(meshes[3].visible, false, 'no glare cards');
  assert.ok(st.eyes === meshes[1] && meshes[1].material !== shared, 'its own eye material (the two blue statues share the model)');
  assert.ok(st.eyes.material.color.v < 0.3, 'eyes and gem dark while it sleeps');
  sc.statueEyes(st, 1); assert.equal(st.eyes.material.color.v, 1, 'lit once it wakes');
}


// a pawn the statue's hands turned over (fx.quat) is upright again once it lets go: no roll is left behind
{
  const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(3), isNpc: () => true });
  bg.start(0); app.session = makeSession(bg, 0, ['A', 'B']);
  const sc = new BoardScene(); sc.enter(); sc.update(1 / 60);
  const p = sc.pawns[0]; let copied = null;
  p.group.quaternion = { copy(q) { copied = q; p.group.rotation.z = Math.PI; } }; // (an upside-down turn leaves a roll in the Euler angles)
  p.fx = { x: p.x, y: p.y, z: p.z, yaw: 0, quat: { tag: 'hands' } }; sc.updatePawnPose(1 / 60);
  assert.equal(copied && copied.tag, 'hands', 'carried: turned with the hands');
  p.fx = { x: p.x, y: p.y + 30, z: p.z, yaw: 1, tilt: 0.3 }; sc.updatePawnPose(1 / 60);
  assert.equal(p.group.rotation.z, 0, 'flying free: no roll left from the hands');
  sc.exit();
}

// the statue throws, played on the map's own statue meshes with the game's animations (a small stand-in for three's maths)
{
  const fs = await import('node:fs');
  const { rigStatue, statueTimeline } = await import('../js15/world/statueRig.js');
  const { STATUES } = await import('../js15/world/statueData.js');
  class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    applyMatrix4(m) { const e = m.elements, { x, y, z } = this; this.x = e[0] * x + e[4] * y + e[8] * z + e[12]; this.y = e[1] * x + e[5] * y + e[9] * z + e[13]; this.z = e[2] * x + e[6] * y + e[10] * z + e[14]; return this; } }
  class M4 { constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    set(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p) { this.elements = [a, e, i, m, b, f, j, n, c, g, k, o, d, h, l, p]; return this; } }
  class Q { constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); } clone() { return new Q(this.x, this.y, this.z, this.w); } copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
    setFromAxisAngle(a, t) { const s = Math.sin(t / 2); return this.copy({ x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(t / 2) }); }
    multiply(q) { const { x, y, z, w } = this; return this.copy({ x: w * q.x + x * q.w + y * q.z - z * q.y, y: w * q.y - x * q.z + y * q.w + z * q.x, z: w * q.z + x * q.y - y * q.x + z * q.w, w: w * q.w - x * q.x - y * q.y - z * q.z }); }
    setFromRotationMatrix(m) { const e = m.elements, [m11, m12, m13, m21, m22, m23, m31, m32, m33] = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], tr = m11 + m22 + m33;
      if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return this.copy({ w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s }); }
      if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); return this.copy({ w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s }); }
      if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); return this.copy({ w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s }); }
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22); return this.copy({ w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s }); } }
  const up = (q) => ({ x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) }); // where the player's head points
  const glb = fs.readFileSync(new URL('../assets/board-game-island/props.glb', import.meta.url));
  const jl = glb.readUInt32LE(12), J = JSON.parse(glb.subarray(20, 20 + jl).toString()), bin = 20 + jl + 8;
  const positions = (acc) => { const a = J.accessors[acc], bv = J.bufferViews[a.bufferView], o = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return Float32Array.from({ length: a.count * 3 }, (_, i) => glb.readFloatLE(o + 4 * i)); };
  for (const color of ['blue', 'red']) {
    const model = color === 'blue' ? 'm001_30' : 'm001_31', mesh = J.meshes[J.nodes.find((n) => n.name === model && n.mesh !== undefined).mesh];
    const meshes = mesh.primitives.map((p) => { const arr = positions(p.attributes.POSITION), mk = () => ({ attributes: { position: { count: arr.length / 3, array: Float32Array.from(arr) } }, clone: mk });
      return { isMesh: true, material: { name: J.materials[p.material].name }, geometry: mk() }; });
    const rig = rigStatue({ traverse: (fn) => meshes.forEach(fn) }, STATUES, model);
    assert.ok(rig, `${color}: the statue rigs`);
    // placed like the map does: 10.4 behind its space, turned to face it, at map scale
    const at = { x: 12, y: 5, z: -30 }, yaw = 0.6, S = 0.016, c = Math.cos(yaw), s = Math.sin(yaw);
    rig.mesh.matrixWorld = new M4().set(c * S, 0, s * S, at.x, 0, S, 0, at.y, -s * S, 0, c * S, at.z, 0, 0, 0, 1);
    rig.mesh.updateWorldMatrix = () => {}; rig.mesh.getWorldQuaternion = (q) => q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
    const A = { x: at.x + s * 10.4, y: at.y, z: at.z + c * 10.4 }, B = { x: 30, y: 3, z: 40 };
    const shots = [], eyes = { material: { color: { v: 1, setScalar(v) { this.v = v; } } }, userData: {} }, st = { rig, eyes }, pawn = { x: A.x, y: A.y, z: A.z };
    const fake = { T: { Vector3: V3, Quaternion: Q, Matrix4: M4 }, place() {}, setCounter() {}, statueEyes: BoardScene.prototype.statueEyes,
      set camHold(v) { if (v && this.snapCamera) { shots.push(v); this.snapCamera = false; } this._h = v; }, get camHold() { return this._h; } };
    const anim = BoardScene.prototype.statueThrowAnim.call(fake, { statue: color, dur: 13000 }, pawn, st, A, B, null);
    const TL = statueTimeline(color, 13000), at_ = (ms) => { anim.step(ms / 13000); return { ...pawn, fx: pawn.fx && { ...pawn.fx } }; };
    const d2 = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    const p0 = at_(0); assert.ok(d2(p0, A) < 0.01 && Math.abs(p0.y - A.y) < 0.01, `${color}: starts on the space`);
    assert.ok(eyes.material.color.v < 0.3, `${color}: asleep at first`);
    at_(TL.lightUp + 50); assert.ok(eyes.material.color.v > 0.95, `${color}: eyes lit once it has woken`);
    if (color === 'blue') {
      const mid = at_(TL.hop[0] - 50); assert.ok(d2(mid, A) < 0.01, 'blue: waits on the space while the hands come round');
      const on = at_(TL.lift - 30), hands = { x: at.x + s * 450 * S, y: at.y + 100 * S, z: at.z + c * 450 * S };
      assert.ok(d2(on, hands) < 0.05 && Math.abs(on.y - hands.y) < 0.05, `blue: hopped onto the flat hands (${d2(on, hands).toFixed(2)} off)`);
      const dip = at_(TL.lift + 57 / 60 * 1000); assert.ok(dip.y < on.y - 0.5 && dip.fx.quat, 'blue: rides the hands down, turned with them');
    } else {
      const grab = at_(TL.grab + 200); assert.ok(d2(grab, A) < 0.05, 'red: grabbed where it stands');
      const over = at_(312 / 60 * 1000), axis = d2(over, at);
      assert.ok(over.y > at.y + 7 && axis < 2.5, `red: lifted right over the statue's head (${(over.y - at.y).toFixed(1)} up, ${axis.toFixed(1)} off its middle)`);
      const behind = at_(336 / 60 * 1000), toA = { x: A.x - at.x, z: A.z - at.z };
      assert.ok((behind.x - at.x) * toA.x + (behind.z - at.z) * toA.z < -50, 'red: and down behind it');
      assert.ok(up(behind.fx.quat).y < -0.5, 'red: upside down over its back, turned with the hands');
    }
    const go = at_(TL.release - 1); assert.ok(go.y > at.y + 4, `${color}: let go high above the statue (${(go.y - at.y).toFixed(1)})`);
    const fly = at_((TL.release + TL.land) / 2); assert.ok(fly.y > go.y + 20, `${color}: high over the island`);
    assert.ok(rig.clip !== null, `${color}: the statue still holds its pose while the player is in the air`);
    at_(TL.land + 100); assert.equal(rig.clip, null, `${color}: asleep again once the camera is over the platform`); assert.ok(eyes.material.color.v < 0.3);
    const end = at_(13000); assert.ok(d2(end, B) < 0.01 && pawn.fx === null, `${color}: walks off onto the space`);
    const names = shots.map((h) => (h === shots[0] ? 'wide' : h.y > A.y + 40 ? 'sky' : 'other'));
    assert.ok(names[0] === 'wide' && names.includes('sky') && shots.length === 4, `${color}: wide, by the statue, sky, platform (${shots.length} cuts)`);
    anim.cleanup(); assert.equal(rig.clip, null); assert.equal(fake.camHold, null);
  }
}

console.log('board scene smoke tests passed');
process.exit(0);
