// v78: Miis from the Mii creator (mii/) are the players: their data travels through the lobby, the game reads it, and
// the creator is packed to run from a sub-folder of a published artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMii, readMiic, fromBase64, toBase64, GUEST_MIIS, DEFAULT_MII, FAVORITE_COLORS, MIIC_V4_SIZE } from '../js15/world/miic.js';
import { HostGame, HOST_ID, cleanMii } from '../js15/game/hostGame.js';
import { bodyScale } from '../js15/world/miiPawn.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- reading the creator's Mii data ----
assert.equal(MIIC_V4_SIZE, 126);
const names = GUEST_MIIS.map((g) => parseMii(g).name);
assert.deepEqual(names, ['Guest A', 'Guest B', 'Guest C', 'Guest D', 'Guest E', 'Guest F'], 'the guests read back with their names');
for (const g of [...GUEST_MIIS, DEFAULT_MII]) {
  const m = parseMii(g);
  assert.equal(m.ffl.length, 46, 'turned into StudioData (46 bytes) for the Mii renderer');
  assert.ok(m.favoriteColor >= 0 && m.favoriteColor < 12 && FAVORITE_COLORS[m.favoriteColor]);
  assert.ok(m.height >= 0 && m.height < 128 && m.build >= 0 && m.build < 128);
}
assert.deepEqual(GUEST_MIIS.map((g) => parseMii(g).gender), [0, 0, 0, 1, 1, 1]);
{ // a field in the right place: Guest B's favourite colour is the 6th (blue), and the StudioData has it at byte 21
  const m = parseMii(GUEST_MIIS[1]); assert.equal(m.favoriteColor, 5); assert.equal(m.ffl[21], 5);
}
assert.equal(parseMii('not mii data!'), null);
assert.equal(parseMii(toBase64(new Uint8Array(40))), null);
assert.equal(readMiic(fromBase64(DEFAULT_MII)).nickname, 'Mii');
// v80: a Mii's own height and weight are not used: every player is the same size
for (const hw of [{ height: 0, build: 0 }, { height: 127, build: 127 }, { height: 64, build: 10 }]) assert.deepEqual(bodyScale(hw), { y: 1, xz: 1 });

// ---- through the lobby ----
{
  const K = (n) => `key-${n}-xxxxxxxxxx`, g = new HostGame({ seed: 3 });
  g.join(HOST_ID, K(0), 'Hana', GUEST_MIIS[2]);
  g.join('b', K(1), 'Ben', 'x'.repeat(5)); // (not Mii data: ignored)
  g.addNpc(); g.addNpc();
  const r = g.roster().players;
  assert.equal(r[0].mii, GUEST_MIIS[2], 'your Mii goes to everyone with the roster');
  assert.equal(r[1].mii, null, 'nonsense is not passed on');
  assert.ok(r[2].mii && r[3].mii && r[2].mii !== r[3].mii, 'CPUs wear different guest Miis');
  assert.equal(cleanMii('<script>'), null);
  g.leave('b'); g.join('b2', K(1), 'Ben', DEFAULT_MII); // (still in the lobby: a fresh seat)
  assert.equal(g.roster().players.find((p) => p && p.name === 'Ben').mii, DEFAULT_MII);
}

// ---- the creator, packed into mii/ (tools/pack_mii.py) ----
{
  const M = path.join(root, 'mii');
  assert.ok(fs.existsSync(path.join(M, 'index.html')), 'mii/ is there (python3 tools/pack_mii.py <zip>)');
  const idx = fs.readFileSync(path.join(M, 'index.html'), 'utf8'), main = fs.readFileSync(path.join(M, 'dist', 'main.js'), 'utf8');
  assert.ok(idx.includes('.b64.txt') && idx.indexOf('window.fetch =') < idx.indexOf('dist/main.js'), 'the fetch shim runs before the creator');
  assert.ok(!main.includes('"/dist/') && !main.includes('"/FFLResHigh.dat"') && !main.includes('var root = "/";'), 'no paths from the site root');
  assert.ok(main.includes('useSentry: false') && !main.includes('�'), 'no error reports sent off; no replacement characters');
  assert.ok(main.includes('ensureFFLReady().catch(() => {}).then(() => new MiiEditor2('), 'the editor waits for the Mii renderer');
  assert.ok(main.includes('if (mm2.mainGainNode) mm2.mainGainNode.gain'), 'saving sends the Mii back even with the music off');
  for (const f of ['FFLResHigh.dat.b64.txt', 'assets/models/miiBodyM_wiiu.glb.b64.txt', 'assets/models/body_models_bundle.zip.b64.txt', 'ffl/game-ffl.js', 'ffl/ffl.js', 'ffl/ffl-emscripten.wasm'])
    assert.ok(fs.existsSync(path.join(M, f)), f);
  const served = /\.(html|css|js|mjs|wasm|json|txt|md|svg|png|jpg|ico|woff2?|mp3)$/;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const odd = walk(M).filter((f) => !served.test(f)).map((f) => path.relative(M, f));
  assert.deepEqual(odd, [], 'only file types an artifact serves');
  assert.ok(!fs.readFileSync(path.join(M, 'ffl', 'FFLShaderMaterial.js'), 'utf8').includes('PrepareThree'), "FFL's material uses the page's Three.js");
}
// ---- v81: Wii Party's own Mii body and animations, with the real Three.js the creator ships ----
{
  const T = (await import('../mii/dist/three.js')).default;
  const { makeWpBody, WP_NECK } = await import('../js15/world/wpMii.js');
  const { WP_MII } = await import('../js15/world/wpMiiData.js');
  const b = makeWpBody(T, WP_MII), v = new T.Vector3(), at = (n) => { b.root.updateMatrixWorld(true); return b.bones[n].getWorldPosition(v).clone(); };
  assert.equal(b.meshes.length, 2, 'v83: the explorer suit and the skin'); assert.equal(WP_MII.body, 'pl026');
  assert.ok(WP_MII.tex.wear00.rgb.startsWith('data:image/png') && WP_MII.tex.wear00.mix.startsWith('data:image/png') && WP_MII.meshes.find((m) => m.mat === 'wear00').uv, 'the suit has its picture (pockets, belt, boots) and where it goes'); assert.ok(b.meshes.every((m) => m.isSkinnedMesh));
  assert.ok(Math.abs(at('hook_head').y - WP_NECK) < 0.5, 'the neck is at WP_NECK at rest');
  for (const c of ['idle', 'walk', 'run', 'jump', 'fly', 'tumble', 'hang', 'swim', 'scared', 'cheer', 'sad', 'win', 'land', 'knock', 'hit', 'springUp', 'wonder', 'sitStunned'])
    assert.ok(b.frames(c) > 0, `clip ${c}`);
  b.pose('idle', 0); const hand = at('L_hand'); assert.ok(hand.y < 80, 'idle: arms down at the sides');
  b.pose('win', 30); assert.ok(at('L_hand').y > at('hook_head').y, 'win: arms up over the head');
  b.pose('walk', 0); const f0 = at('L_foot1').z; b.pose('walk', 30); assert.ok(Math.abs(at('L_foot1').z - f0) > 5, 'walk: the feet go back and forth');
  assert.ok(b.meshes.every((m) => m.material.side === T.DoubleSide), 'v82: drawn from both sides (some triangles face the other way: the trousers showed through the shirt)');
  { // v82: the shirt's front faces forward (normals worked out from the shape)
    const sh = WP_MII.meshes.find((m) => m.mat === 'wear00'); let best = -1, n = null;
    for (let i = 0; i < sh.pos.length / 3; i++) if (sh.pos[3 * i + 1] > 70 && sh.pos[3 * i + 1] < 90 && sh.pos[3 * i + 2] > best) { best = sh.pos[3 * i + 2]; n = sh.nrm.slice(3 * i, 3 * i + 3); }
    assert.ok(n[2] > 0.8, `the chest's normal points forward (${n})`);
  }
  b.pose('idle', 0); b.pose('win', 30, 0.5); const mid = at('L_hand').y; assert.ok(mid > hand.y && mid < at('hook_head').y + 40, 'a blend is in between');
}
{ // v83: the suit is the player's colour, whatever the Mii's favourite colour
  const T = (await import('../mii/dist/three.js')).default;
  const { makeFigure } = await import('../js15/world/miiPawn.js');
  const { PLAYER_COLORS } = await import('../js15/config.js');
  for (const slot of [0, 1, 2]) {
    const f = makeFigure(T, slot, parseMii(GUEST_MIIS[1])); // (Guest B's favourite colour is blue)
    assert.equal('#' + f.body.mats.wear00.color.getHexString(), PLAYER_COLORS[slot].hex, `player ${slot + 1}'s suit is ${PLAYER_COLORS[slot].name}`);
  }
}
{ // v84: once FFL has loaded, the body is drawn in FFL's shader, as the face is
  const T = (await import('../mii/dist/three.js')).default;
  const { makeFigure } = await import('../js15/world/miiPawn.js');
  const { shadeLikeFace } = await import('../js15/world/wpMii.js');
  const { SKIN_COLORS } = await import('../js15/world/miic.js');
  const { PLAYER_COLORS } = await import('../js15/config.js');
  const asked = [], F = { bodyMaterial: (o) => { asked.push(o); return { ffl: true, ...o }; } };
  const m = parseMii(GUEST_MIIS[1]), f = makeFigure(T, 1, m);
  assert.ok(!shadeLikeFace(T, f.body, null), 'without FFL the body keeps its own materials');
  assert.ok(shadeLikeFace(T, f.body, F) && f.body.meshes.every((x) => x.material.ffl), 'every part of the body in FFL\'s shader');
  assert.equal(f.body.meshes.find((x) => x.userData.mat === 'skin00').material.color, SKIN_COLORS[m.skin], 'the skin in the Mii\'s skin colour');
  assert.equal(f.body.meshes.find((x) => x.userData.mat === 'wear00').material.color, PLAYER_COLORS[1].hex, 'the suit in the player\'s colour (no canvas here: the plain colour)');
  assert.ok(!shadeLikeFace(T, f.body, F), 'only once');
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mii', 'ffl', 'game-ffl.js'), 'utf8');
  assert.ok(/export function bodyMaterial/.test(src) && /modulateType: pants \? 10 : 9/.test(src), "FFL's body material (FFL's own body and trousers light settings)");
}
{ // v85: the suit's canvas is the picture's size from the start (the GPU keeps a texture's first size)
  const { pngSize } = await import('../js15/world/wpMii.js');
  const { WP_MII } = await import('../js15/world/wpMiiData.js');
  const sz = pngSize(WP_MII.tex.wear00.rgb), raw = Buffer.from(WP_MII.tex.wear00.rgb.split(',')[1], 'base64');
  assert.deepEqual(sz, [raw.readUInt32BE(16), raw.readUInt32BE(20)], 'the picture\'s size, from its header');
  assert.ok(sz[0] >= 16 && sz[1] >= 16 && sz[0] <= 2048);
  assert.deepEqual(pngSize(WP_MII.tex.wear00.mix), sz, 'both pictures the same size');
}
{ // v87: the head tips about a point inside it, behind the chin, and the chin sits at the same place on the collar
  const T = (await import('../mii/dist/three.js')).default;
  const { makeFigure, fitFFLHead, HEAD_DROP, HEAD_PIVOT } = await import('../js15/world/miiPawn.js');
  const f = makeFigure(T, 0, null), h = fitFFLHead(f.head, new T.Group());
  assert.ok(HEAD_PIVOT.y > 8 && HEAD_PIVOT.z <= 0, 'the pivot is up inside the head, not at the chin in front of the neck');
  assert.ok(Math.abs(f.head.position.y + h.position.y + HEAD_DROP) < 1e-9 && Math.abs(f.head.position.z + h.position.z) < 1e-9, 'standing, the chin is HEAD_DROP under the neck bone');
}
{ // v88: the shadow is the Mii's own shape: a flattened copy of every part, moving with it
  const T = (await import('../mii/dist/three.js')).default;
  const { makeFigure, fitFFLHead } = await import('../js15/world/miiPawn.js');
  const { makeShadowCaster } = await import('../js15/world/miiShadow.js');
  const f = makeFigure(T, 0, null), c = makeShadowCaster(T, f.body.root, 1);
  assert.ok(c.twins.filter((t) => t.isSkinnedMesh).length === 2 && c.twins.every((t) => t.parent && t.parent.isMesh && t.material === c.material), 'a copy of the suit and the skin, on the parts themselves (so they pose and hide with them)');
  const n = c.twins.length, head = new T.Group(); head.add(new T.Mesh(new T.SphereGeometry(40), new T.MeshBasicMaterial()));
  fitFFLHead(f.head, head); assert.equal(c.rebuild(), n + 1, 'the real head gets its shadow too'); assert.equal(c.rebuild(), n + 1, 'rebuilt, not doubled');
  c.set({ x: 1, y: 2, z: 3 }, { x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 0.25); assert.equal(c.material.opacity, 0.25);
  assert.ok(c.material.stencilWrite && c.material.stencilRef === 1, 'one even shadow (the stencil)');
}
{ // v90: the viewer's animation gallery has every shared and Board Game Island clip, and says which the game uses
  const { ALL_CLIPS } = await import('../js15/world/wpMiiAllClips.js');
  const { WP_MII } = await import('../js15/world/wpMiiData.js');
  const names = Object.keys(ALL_CLIPS);
  assert.ok(names.length >= 60 && names.every((n) => /^pm00[01]_\d\d$/.test(n)), 'pm000 and pm001, all of them');
  const more = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mii', 'clips', 'more-clips.json'), 'utf8')).clips;
  for (const [k, v] of Object.entries(WP_MII.source)) assert.ok(ALL_CLIPS[v] || more[v], `the game's ${k} (${v}) is in the gallery`);
  for (const n of names) assert.ok(ALL_CLIPS[n].frames > 0 && ALL_CLIPS[n].bones && Object.keys(ALL_CLIPS[n].bones).length, n);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js15', 'scenes', 'viewerScene.js'), 'utf8');
  assert.ok(/export function clipUses/.test(src) && /Animation gallery/.test(src), 'the gallery is in the viewer');
}
{ // v92: standing on a spring as it winds up plays pm001_08, all the way through, until it fires
  const { WP_MII } = await import('../js15/world/wpMiiData.js');
  assert.equal(WP_MII.source.springWind, 'pm001_08');
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js15', 'scenes', 'boardScene.js'), 'utf8');
  const m = /const WIND_FRAMES = (\d+)/.exec(src); assert.ok(m && Number(m[1]) === WP_MII.clips.springWind.frames, 'WIND_FRAMES is the clip\'s length');
  assert.ok(/clip: 'springWind', clipF: \(u \/ T2\)/.test(src), 'played over the wind-up, before the launch');
}
{ // v93: knocked down (pm001_04), dazed (pm001_05) and back up (pm206_03); the gallery can load every other clip
  const { WP_MII } = await import('../js15/world/wpMiiData.js');
  assert.equal(WP_MII.source.knock, 'pm001_04'); assert.equal(WP_MII.source.sitStunned, 'pm001_05'); assert.equal(WP_MII.source.getUp, 'pm206_03');
  const C = WP_MII.clips, rootY = (c, i) => { const r = C[c].bones.ske_root; return r[i < 0 ? r.length + i : i][5]; };
  assert.ok(rootY('knock', 0) > 55 && rootY('knock', -1) < 20, 'knock: from standing onto their bottom');
  assert.ok(Math.abs(rootY('sitStunned', 0) - rootY('knock', -1)) < 0.5 && Math.abs(rootY('getUp', 0) - rootY('knock', -1)) < 0.5, 'dazed and getting up start where the fall ends');
  assert.ok(Math.abs(rootY('getUp', -1) - rootY('idle', 0)) < 0.5, 'getting up ends standing');
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js15', 'scenes', 'boardScene.js'), 'utf8');
  const m = /const KNOCK_FRAMES = (\d+), GETUP_FRAMES = (\d+)/.exec(src); assert.ok(m && +m[1] === C.knock.frames && +m[2] === C.getUp.frames, 'the frame counts are the clips\'');
  const more = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mii', 'clips', 'more-clips.json'), 'utf8'));
  const names = Object.keys(more.clips);
  assert.ok(names.length > 400 && names.every((n) => !/^pm00[01]_/.test(n)) && more.clips.pm206_03, 'the other boards\' and minigames\' clips, for the gallery');
  assert.equal(more.step, WP_MII.step);
  const { galleryOrder } = await import('../js15/scenes/viewerScene.js').catch(() => ({}));
  if (galleryOrder) assert.deepEqual(galleryOrder(['pm206_03', 'pm000_01', 'pm001_02', 'pm001_01']), ['pm001_01', 'pm001_02', 'pm000_01', 'pm206_03']);
}
console.log('mii tests passed');
