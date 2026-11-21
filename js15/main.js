import { app } from './app.js';
import { VIRTUAL, BUILD } from './config.js';
import { drawBackdrop } from './draw.js';
import { MenuScene } from './scenes/menuScene.js';
import { LobbyScene } from './scenes/lobbyScene.js';
import { PointerTestScene } from './scenes/pointerTestScene.js';
import { BoardScene } from './scenes/boardScene.js';
import { ViewerScene } from './scenes/viewerScene.js';
import { loadBoard } from './world/islandLoader.js';
import { BoardGame } from './game/boardGame.js';
import { currentMii } from './identity.js';
import { GUEST_MIIS } from './world/miic.js';

// Scene registry. To add a minigame later: write a scene file, register it here.
// The map: packed into the page (single-file build) or fetched from the assets folder. It starts loading right away.
// Browser tests (tests/hud.browser.test.mjs) hand in a stand-in map and get the app object back. Nothing sets this in a real game.
const TEST = window.__PARTY_TEST || null;
if (TEST) TEST.app = app;
app.loadBoard = () => (TEST && TEST.board ? Promise.resolve(TEST.board) : loadBoard('assets/board-game-island/', window.__BOARD_ASSETS || null));
app.loadBoard().catch(() => {}); // the board scene reports a failure when it needs the map
app.scenes = { menu: MenuScene, lobby: LobbyScene, pointerTest: PointerTestScene, board: BoardScene, viewer: ViewerScene };

app.canvas = document.getElementById('stage');
app.canvas3d = document.getElementById('stage3d');
app.ui = document.getElementById('ui');
const g = app.canvas.getContext('2d');

// Right-click is reserved for gameplay, so never show the browser's context menu
// (except in text boxes, where people expect copy/paste).
addEventListener('contextmenu', (e) => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); });

const LETTERBOX = '#101c2b';

/**
 * Game scenes (fixedStage) always show the same 1280x720 (16:9) stage, scaled to fit the window and
 * centered, so every player sees exactly the same thing. Menus stay fluid so they fit any screen.
 */
function applyLayout() {
  const v = app.view, stage = !!app.scene?.fixedStage, ui = app.ui, c3 = app.canvas3d;
  if (stage) {
    ui.style.cssText = `inset:auto;left:${v.ox}px;top:${v.oy}px;width:${VIRTUAL.w}px;height:${VIRTUAL.h}px;`
      + `transform:scale(${v.scale});transform-origin:0 0;`;
  } else ui.style.cssText = '';
  if (app.scene?.is3d) {
    c3.style.cssText = `display:block;inset:auto;left:${v.ox}px;top:${v.oy}px;`
      + `width:${Math.round(VIRTUAL.w * v.scale)}px;height:${Math.round(VIRTUAL.h * v.scale)}px;`;
  } else c3.style.cssText = 'display:none;';
  app.canvas.style.display = app.scene?.is3d ? 'none' : 'block';
  document.body.style.background = stage ? LETTERBOX : '';
}
app.layout = applyLayout;

app.go = (name, opts) => {
  app.scene?.exit?.();
  app.ui.className = '';
  app.ui.innerHTML = '';
  app.ui.onclick = null; app.ui.onchange = null;
  app.sceneName = name;
  app.scene = new app.scenes[name](opts);
  app.scene.enter?.();
  applyLayout();
  app.scene.onResize?.();
};

app.setSession = (s) => {
  const old = app.session;
  app.session = s;
  old?.close();
  s.onChange = () => app.syncScene();
  s.onClosed = (reason) => {
    if (app.session !== s) return;
    app.session = null;
    app.go('menu', { notice: reason });
  };
  app.syncScene();
};

// The host's roster says which scene everyone should be in.
function showBuildWarning(hostBuild) {
  let el = document.getElementById('buildwarn');
  if (!hostBuild) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'buildwarn';
    el.style.cssText = 'position:fixed;z-index:98;left:0;right:0;top:0;padding:10px 14px;background:#d6455d;color:#fff;text-align:center;font:16px sans-serif';
    document.body.appendChild(el);
  }
  el.textContent = `Version mismatch: you are on build ${BUILD}, the host is on build ${hostBuild}. `
    + 'Everyone must reload the page with Ctrl+Shift+R (or open it in a private window) so the game works the same for all.';
}

app.syncScene = () => {
  const r = app.session?.roster;
  if (!r) return;
  showBuildWarning(app.session.role === 'client' && (r.build || 'older') !== BUILD ? (r.build || 'older') : null);
  if (app.sceneName !== r.scene) app.go(r.scene);
  else app.scene.onRoster?.();
};

app.leave = () => {
  const s = app.session;
  app.session = null;
  s?.close();
  app.go('menu');
};

app.toNormalized = (clientX, clientY) => {
  const v = app.view;
  const x = (clientX - v.ox) / (VIRTUAL.w * v.scale);
  const y = (clientY - v.oy) / (VIRTUAL.h * v.scale);
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
};

function resize() {
  const v = app.view;
  v.dpr = window.devicePixelRatio || 1;
  app.canvas.width = Math.round(innerWidth * v.dpr);
  app.canvas.height = Math.round(innerHeight * v.dpr);
  v.scale = Math.min(innerWidth / VIRTUAL.w, innerHeight / VIRTUAL.h);
  v.ox = (innerWidth - VIRTUAL.w * v.scale) / 2;
  v.oy = (innerHeight - VIRTUAL.h * v.scale) / 2;
}
addEventListener('resize', () => { resize(); applyLayout(); app.scene?.onResize?.(); });
resize();

let last = performance.now();
function frame(now) {
  const dt = last == null || !Number.isFinite(now - last) ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000)); // the first frame has no previous one
  last = now;
  app.session?.update(dt);
  app.scene?.update?.(dt);

  if (app.scene?.is3d) { requestAnimationFrame(frame); return; } // the 3D scene renders itself in update()
  const v = app.view;
  g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  g.fillStyle = app.scene?.fixedStage ? LETTERBOX : '#bfe3fa';
  g.fillRect(0, 0, innerWidth, innerHeight);
  g.save();
  g.translate(v.ox, v.oy);
  g.scale(v.scale, v.scale);
  g.beginPath(); g.rect(0, 0, VIRTUAL.w, VIRTUAL.h); g.clip();
  drawBackdrop(g);
  app.scene?.draw?.(g);
  g.restore();
  requestAnimationFrame(frame);
}

const room = new URLSearchParams(location.search).get('room');
/** The island viewer: the board on its own, with nobody playing (a stand-in session that never changes). */
app.openViewer = () => {
  const bg = new BoardGame({ slots: [0, 1, 2, 3], rng: Math.random, isNpc: () => true }); bg.start(0);
  const names = ['Player 1', 'CPU 2', 'CPU 3', 'CPU 4'];
  app.session = { role: 'host', mySlot: 0, viewer: true, roster: { players: names.map((n, i) => ({ slot: i, name: n, kind: i ? 'npc' : 'human', wasHuman: !i, connected: !i, mii: i ? GUEST_MIIS[i - 1] : (currentMii()?.data || GUEST_MIIS[5]) })) }, // (you are player 1, in your Mii)
    board: bg.snapshot(), update() {}, setTurnHandler() {}, stop() {}, choose() {}, backToLobby() {}, leave() {} };
  app.go('viewer');
};
if (window.__START_VIEWER || location.hash === '#viewer') app.openViewer();
else if (room) app.go('menu', { panel: 'online', code: room.toUpperCase().slice(0, 5) });
else app.go('menu');
requestAnimationFrame(frame);
