// Runs the real game page in a real (headless) browser, with Three.js and the map replaced by stand-ins.
// The node tests cannot see CSS or the DOM, so this is where "can I actually click it / do I actually see it" is checked:
//   - the Stop button and the 1v1 cards really receive mouse clicks (an invisible layer once swallowed them);
//   - on the 1v1 card screen the chooser sees their own custom pointer where their mouse is, instead of the mouse cursor;
//   - when a CPU chooses, everyone sees its pointer go to a card and click it, and that card is the opponent it challenges;
//   - the blue water texture really gets made from the map's grey ripple texture in a browser canvas, with no dark specks.
// Needs Playwright with Chromium. If that is not installed the test is skipped (it prints why and passes).
// Screenshots are written to tests/shots/ so a person can look at them.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'tests', 'shots');
const skip = (why) => { console.log(`hud browser tests skipped (${why})`); process.exit(0); };

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { skip('Playwright is not installed'); }
let browser;
try { browser = await chromium.launch(); } catch (e) { skip(`Chromium did not start: ${String(e.message).split('\n')[0]}`); }

// ---- a tiny web server for the project folder ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
/** The map's grey ripple texture (the water surface's own texture), cut out of island.glb as a PNG. */
function rippleTexture() {
  const d = fs.readFileSync(path.join(root, 'assets', 'board-game-island', 'island.glb')), n = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + n).toString('utf8'));
  const m = j.materials.find((x) => x.name === 'mr001m004'), img = j.images[j.textures[m.pbrMetallicRoughness.baseColorTexture.index].source], bv = j.bufferViews[img.bufferView];
  return d.subarray(20 + n + 8 + (bv.byteOffset || 0), 20 + n + 8 + (bv.byteOffset || 0) + bv.byteLength);
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/mii/')) { res.writeHead(404); res.end(); return; } // (the Mii creator and renderer need the real Three.js; these tests use a stand-in)
  if (req.url === '/__ripple.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(rippleTexture()); return; }
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- stand-ins, set up before the page's own scripts run ----
function standIns() {
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
  const three = stub();
  Object.defineProperty(window, 'THREE', { get: () => three, set() {}, configurable: true }); // the page's own "window.THREE = ..." is ignored
  const props = ['m001_20', 'm001_22', 'm001_26', 'm001_27', 'm001_28', 'm001_29', 'm001_30', 'm001_31', 'm001_35', 'm001_35l', 'm001_60', 'm001_62', 'm001_70'];
  window.__PARTY_TEST = { board: { scale: 0.016, island: stub(), volcano: stub(), sky: stub(), painted: [], props: new Map(props.map((n) => [n, stub()])),
    spaceMeshes: { island: { get: () => ({ set visible(v) {} }) }, volcano: { get: () => null } }, setSpaceTexture() { return true; } } };
  window.__errors = [];
  addEventListener('error', (e) => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
}
const THREE_MODULE = `const T = window.THREE;
export const AdditiveBlending = 2, SubtractiveBlending = 3, ClampToEdgeWrapping = 1001, SRGBColorSpace = 'srgb', REVISION = '160';
export const CanvasTexture = T.CanvasTexture, LoadingManager = T.LoadingManager, Vector3 = T.Vector3;`;

async function openGame(viewport) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.addInitScript(standIns);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => { // nothing leaves this machine: the libraries are stand-ins
    const url = route.request().url();
    if (url.includes('three.module.js')) return route.fulfill({ contentType: 'text/javascript', body: THREE_MODULE });
    if (url.includes('GLTFLoader')) return route.fulfill({ contentType: 'text/javascript', body: 'export class GLTFLoader { register() {} load() {} parse() {} }' });
    if (url.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.fulfill({ contentType: 'text/css', body: '' });
  });
  await page.goto(`${base}/index.html`);
  // quick turns, but the real thinking time for a CPU's 1v1 pick
  await page.evaluate(async () => {
    const m = await import('/js15/game/boardGame.js');
    for (const k of Object.keys(m.DUR)) m.DUR[k] = Math.min(m.DUR[k], k === 'walkStep' || k === 'fastStep' ? 30 : 150);
    Object.assign(m.TIMING, { npcRoll: 150, npcChoose: 150, gap: 60 });
    // my own turns play themselves where the test says so: 'steps' = everything except my normal dice roll, 'all' = that too
    window.__auto = null;
    setInterval(() => {
      const sc = window.__PARTY_TEST.app.scene, mode = window.__auto;
      if (!mode || !sc || !sc.canStop) return;
      if (sc.canStop()) { if (mode === 'all' || !sc.devReady()) sc.doStop(); } else if (sc.canChoose()) sc.doChoose(0);
    }, 40);
  });
  // the start menu: a small link back to the main website, top left, clickable
  const home = await page.locator('a.home-link').boundingBox();
  assert.ok(home && home.x < 60 && home.y < 60, 'the back link sits in the top left');
  assert.equal(await page.getAttribute('a.home-link', 'href'), 'https://dominodominick.com');
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('a.home-link'), { x: home.x + home.width / 2, y: home.y + home.height / 2 }), true, 'nothing lies over it');
  if (!fs.existsSync(path.join(shots, 'menu.png'))) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'menu.png') }); }
  await page.click('[data-act=play]');
  await page.click('[data-act=offline]');
  await page.click('[data-act=add-npc]');
  await page.click('[data-act=add-npc]');
  await page.click('[data-act=start]');
  await page.waitForFunction(() => window.__PARTY_TEST.app.sceneName === 'board' && !!window.__PARTY_TEST.app.session.game.board, null, { timeout: 15000 });
  return { page, problems };
}

/** Wait (in the page) until fn() is truthy; CPUs play on by themselves meanwhile. */
const until = (page, fn, what, arg) => page.waitForFunction(fn, arg, { timeout: 60000, polling: 30 }).catch(() => { throw new Error(`timed out waiting for ${what}`); }); // (60 s: the real game's timings are slow: a vine crossing alone takes 7 s)
const myDice = () => { const a = window.__PARTY_TEST.app; return a.scene.devReady && a.scene.devReady(); };
/** How much of the pointer layer is painted near a stage point (0..1 coordinates): the custom pointer's arrow and badge. */
const paintedAt = (page, p) => page.evaluate(({ x, y }) => {
  const cv = document.querySelector('#ptrs'), d = cv.getContext('2d').getImageData(Math.round(x * 1280) - 4, Math.round(y * 720) - 4, 56, 70).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}, p);
const center = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
fs.mkdirSync(shots, { recursive: true });

try {
  // =============== 1. a window that is not 16:9: the stage is scaled and letterboxed ===============
  const { page, problems } = await openGame({ width: 1100, height: 800 });

  // ---- the Stop button really gets the click ----
  await page.evaluate(() => { window.__auto = 'steps'; });
  await until(page, myDice, 'my dice to spin');
  const stop = await center(page, '#stop');
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, stop), 'stop', 'nothing invisible lies over the Stop button');
  const pauseBtn = await center(page, '[data-act=pause]');
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-act=pause]'), pauseBtn), true, 'the pause button can be clicked');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#stop')).cursor), 'pointer', 'the mouse cursor is normal outside the 1v1 cards');
  await page.mouse.click(stop.x, stop.y);
  await until(page, () => window.__PARTY_TEST.app.scene.stopSent || !window.__PARTY_TEST.app.scene.canStop(), 'the Stop click to register');

  // ---- my own 1v1 pick: my custom pointer is drawn where my mouse is, and replaces the mouse cursor ----
  await until(page, myDice, 'my next roll');
  await page.evaluate(() => { window.__auto = null; }); // from here on I do my own clicking
  await page.mouse.move(300, 250); // the mouse is somewhere on the stage before the cards come up
  await page.evaluate(() => window.__PARTY_TEST.app.scene.devDo('land', 'mg11', '1 vs 1'));
  await until(page, () => { const a = window.__PARTY_TEST.app, c = a.scene.duelShown; return !!c && c.slot === a.session.mySlot; }, 'my 1v1 cards');
  await page.waitForTimeout(120);
  const mine = await page.evaluate(() => { const a = window.__PARTY_TEST.app; return { ptr: { ...a.session.getPointer(a.session.mySlot) }, norm: a.toNormalized(300, 250), own: document.body.classList.contains('own-pointer'),
    cardCursor: getComputedStyle(document.querySelector('#duel .pbox')).cursor, bodyCursor: getComputedStyle(document.body).cursor, cards: document.querySelectorAll('#duel .pbox').length, rowMine: !!document.querySelector('#duel .duel-row.mine') }; });
  assert.equal(mine.cards, 3, 'two opponents and the ? card');
  assert.ok(mine.rowMine, 'the cards are mine to click');
  assert.ok(Math.abs(mine.ptr.x - mine.norm.x) < 1e-6 && Math.abs(mine.ptr.y - mine.norm.y) < 1e-6, 'my pointer starts where my mouse already was');
  assert.ok(await paintedAt(page, mine.ptr) > 300, 'my own custom pointer is drawn on my screen');
  assert.equal(mine.own, true); assert.equal(mine.cardCursor, 'none', 'the mouse cursor is hidden over the cards'); assert.equal(mine.bodyCursor, 'none');
  // move onto the second card: the pointer follows the mouse exactly (in a scaled, letterboxed window too) and that card lifts
  const card1 = await center(page, '#duel .pbox[data-card="1"]');
  await page.mouse.move(card1.x, card1.y, { steps: 6 });
  await page.waitForTimeout(120);
  const over = await page.evaluate(({ x, y }) => { const a = window.__PARTY_TEST.app; return { ptr: { ...a.session.getPointer(a.session.mySlot) }, norm: a.toNormalized(x, y),
    lifted: [...document.querySelectorAll('#duel .pbox')].map((el) => el.classList.contains('hover')), under: document.elementFromPoint(x, y)?.closest('.pbox')?.dataset.card }; }, card1);
  assert.ok(Math.abs(over.ptr.x - over.norm.x) < 1e-6 && Math.abs(over.ptr.y - over.norm.y) < 1e-6, 'the pointer is exactly under the mouse');
  assert.deepEqual(over.lifted, [false, true, false], 'the card under my pointer lifts');
  assert.equal(over.under, '1', 'and it is the card a click will hit');
  assert.ok(await paintedAt(page, over.ptr) > 300, 'the pointer is drawn at the mouse');
  assert.equal(await paintedAt(page, mine.ptr), 0, 'and no longer where it was');
  await page.screenshot({ path: path.join(shots, 'duel-my-pick.png') });
  // pressing shows the ring; releasing on the card picks that opponent
  await page.evaluate(() => { const b = window.__PARTY_TEST.app.session.game.board, d = b._duel.bind(b); window.__duel = null; b._duel = (slot, opp, ev) => { window.__duel = { slot, opp }; return d(slot, opp, ev); }; });
  const want = await page.evaluate(() => window.__PARTY_TEST.app.scene.duelShown.slots[1]);
  await page.mouse.down();
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(() => window.__PARTY_TEST.app.session.getPointer(window.__PARTY_TEST.app.session.mySlot).buttons), 1, 'pressing shows on the pointer');
  await page.mouse.up();
  await until(page, () => !!window.__duel, 'my pick to count');
  assert.deepEqual(await page.evaluate(() => window.__duel), { slot: 0, opp: want }, 'clicking a card challenges that player');
  await until(page, () => !window.__PARTY_TEST.app.scene.duelShown, 'the cards to go away');
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(() => document.body.classList.contains('own-pointer')), false, 'the mouse cursor comes back afterwards');
  assert.deepEqual(await page.evaluate(() => window.__errors), [], 'no errors on the page'); assert.deepEqual(problems, []);
  await page.close();

  // =============== 2. a CPU picks: everyone watches its pointer choose ===============
  const g2 = await openGame({ width: 1280, height: 720 });
  const p2 = g2.page;
  // the next CPU to roll is put one space before a 1v1 space and rolls a 1
  await p2.evaluate(() => { window.__auto = 'all'; });
  await until(p2, () => { const a = window.__PARTY_TEST.app, b = a.session.game.board; return b.phase === 'rolling' && !b.step && b.current() !== a.session.mySlot && a.scene.control && a.scene.idle; }, 'a CPU to roll');
  const cpu = await p2.evaluate(async () => {
    const a = window.__PARTY_TEST.app, b = a.session.game.board, { ISLAND } = await import('/js15/game/boardData.js');
    const slot = b.current(), at = ISLAND.findIndex((n) => n.type === 'mg11');
    b.positions[slot] = { track: 'island', idx: at - 1 }; b.rigNext = 1;
    const d = b._duel.bind(b); window.__duel = null; b._duel = (s, opp, ev) => { window.__duel = { slot: s, opp }; return d(s, opp, ev); };
    return slot;
  });
  await until(p2, (slot) => { const c = window.__PARTY_TEST.app.scene.duelShown; return !!c && c.slot === slot; }, 'the CPU\'s 1v1 cards', cpu);
  const t0 = Date.now();
  const look = async () => p2.evaluate(async (slot) => {
    const a = window.__PARTY_TEST.app, { duelCardAt } = await import('/js15/game/duelLayout.js'), c = a.scene.duelShown, p = a.session.getPointer(slot);
    return c ? { ptr: { ...p }, on: duelCardAt(p.x, p.y, c.slots.length), n: c.slots.length, slots: c.slots, pick: a.session.game.board.npcPick,
      lifted: [...document.querySelectorAll('#duel .pbox')].map((el) => el.classList.contains('hover')), watching: !!document.querySelector('#duel .duel-row.watching'),
      own: document.body.classList.contains('own-pointer'), title: document.querySelector('#duel .duel-title')?.textContent } : null;
  }, cpu);
  await p2.waitForTimeout(450);
  const early = await look();
  assert.ok(early, 'the cards stay up while the CPU thinks'); assert.ok(early.watching, 'I can only watch'); assert.equal(early.own, false, 'my mouse cursor stays');
  assert.ok(/picking/.test(early.title), early.title);
  assert.ok(await paintedAt(p2, early.ptr) > 300, 'the CPU\'s pointer is drawn on my screen');
  await p2.screenshot({ path: path.join(shots, 'duel-cpu-looking.png') });
  await p2.waitForTimeout(Math.max(0, 2150 - (Date.now() - t0)));
  const late = await look();
  assert.ok(late, 'still choosing after 2 seconds');
  assert.ok(late.pick >= 0 && late.pick < late.n - 1, 'it picks a real opponent, not the ? card');
  assert.equal(late.on, late.pick, 'the pointer is on the card the CPU picks');
  assert.equal(late.ptr.buttons, 1, 'and shows the click');
  assert.deepEqual(late.lifted, late.slots.map((_, i) => i === late.pick), 'that card is lifted');
  assert.ok(await paintedAt(p2, late.ptr) > 300);
  await p2.screenshot({ path: path.join(shots, 'duel-cpu-clicking.png') });
  await until(p2, () => !!window.__duel, 'the CPU\'s pick');
  assert.ok(Date.now() - t0 >= 2200, 'the cards were up long enough to watch');
  assert.deepEqual(await p2.evaluate(() => window.__duel), { slot: cpu, opp: late.slots[late.pick] }, 'it challenges the player whose card it clicked');
  assert.deepEqual(await p2.evaluate(() => window.__errors), [], 'no errors on the page'); assert.deepEqual(g2.problems, []);

  // =============== 3. the water texture, made in a real canvas from the map's real ripple texture ===============
  const water = await p2.evaluate(async () => {
    const { waterCanvas, WATER_BLUE } = await import('/js15/world/water.js');
    const bitmap = await createImageBitmap(await (await fetch('/__ripple.png')).blob(), { premultiplyAlpha: 'none' }); // how the map loader gets it
    const stats = (c) => { const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
      for (let i = 0; i < px.length; i++) { lo[i % 4] = Math.min(lo[i % 4], px[i]); hi[i % 4] = Math.max(hi[i % 4], px[i]); } return { w: c.width, h: c.height, lo, hi }; };
    const river = waterCanvas(bitmap), sea = waterCanvas(bitmap, 128);
    // shown big on the page, tiled, for the screenshot
    const show = document.createElement('canvas'); show.width = 512; show.height = 256; show.style.cssText = 'position:fixed;left:0;top:0;z-index:99';
    const g = show.getContext('2d'); g.imageSmoothingEnabled = false;
    for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) g.drawImage(river, x * 128, y * 128);
    document.body.appendChild(show);
    return { blue: WATER_BLUE, size: [bitmap.width, bitmap.height], river: stats(river), sea: stats(sea) };
  });
  assert.deepEqual([water.river.w, water.river.h], water.size, 'the water texture is the size of the ripple texture');
  for (let k = 0; k < 3; k++) {
    assert.ok(water.river.lo[k] >= water.blue.lo[k] && water.river.hi[k] <= water.blue.hi[k], 'every pixel is between the two blues: no dark specks');
    assert.ok(water.river.hi[k] - water.river.lo[k] > 20, 'and the ripples are still there, in light and deeper blue');
    assert.ok(water.sea.lo[k] >= water.blue.lo[k] - 2 && water.sea.hi[k] <= water.blue.hi[k] + 2, 'the sea layer has the same blues');
  }
  assert.deepEqual([water.river.lo[3], water.river.hi[3]], [255, 255], 'the river is solid');
  assert.deepEqual([water.sea.lo[3], water.sea.hi[3]], [128, 128], 'the sea layer is half see-through');
  await p2.screenshot({ path: path.join(shots, 'water-texture.png'), clip: { x: 0, y: 0, width: 512, height: 256 } });
  await p2.close();
  console.log('hud browser tests passed');
} finally {
  await browser.close();
  server.close();
}
