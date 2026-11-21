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
// the body follows the Mii's height and build, gently
assert.deepEqual(bodyScale({ height: 64, build: 64 }), bodyScale(null) && { y: 0.84 + 0.32 * 64 / 127, xz: 0.84 + 0.34 * 64 / 127 });
assert.ok(bodyScale({ height: 127, build: 0 }).y > bodyScale({ height: 0, build: 0 }).y);

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
console.log('mii tests passed');
