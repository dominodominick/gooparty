// The game's door into FFL, the Mii renderer (FFL.js by ariankordi, as the Mii creator ships it). Loaded by the game
// (js15/world/miiHead.js) as a module next to the creator's files, so a game without them still runs.
// FFL's Emscripten glue (ffl-emscripten.js) must already be on the page as a classic script (it defines ModuleFFL).
import * as THREE from 'three';
import { initializeFFL, createCharModel, initCharModelTextures, makeIconFromCharModel } from './ffl.js';
import FFLShaderMaterial from './FFLShaderMaterial.js';

let ready = null, mod = null;

/** Start FFL: its WebAssembly and the Mii parts resource (FFLResHigh, stored as base64 text next to the creator). */
export function start(base) {
  if (ready) return ready;
  ready = (async () => {
    const res = await fetch(base + 'FFLResHigh.dat.b64.txt');
    if (!res.ok) throw new Error('no FFL resource');
    const bin = atob((await res.text()).trim()), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const glue = globalThis.ModuleFFL({ locateFile: (p) => base + 'ffl/' + p });
    const { module } = await initializeFFL(new Response(bytes), glue);
    mod = module;
    return true;
  })();
  return ready;
}

/**
 * A Mii head (THREE.Group of FFL's meshes, about 92 units wide, origin at the neck, facing +z) from Mii bytes FFL takes.
 * `expressions`: the faces it can show (FFL's numbers; Wii Party's seven are 0-6: normal, smile, anger, sorrow, surprise,
 * blink, open mouth), each drawn once here; change between them with setFace(head, n). Without: the normal face only.
 */
export function head(bytes, renderer, expressions = null) {
  if (!mod) throw new Error('FFL not started');
  const cm = createCharModel(bytes, expressions, FFLShaderMaterial, mod);
  initCharModelTextures(cm, renderer);
  const g = cm.meshes;
  g.userData.charModel = cm;
  return g;
}

let iconRenderer = null;
/** A picture of the Mii's face (the Mii Maker's icon view), as a PNG data URL on a see-through background. */
export function faceIcon(bytes, size = 256) {
  if (!mod) throw new Error('FFL not started');
  iconRenderer ||= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  const cm = createCharModel(bytes, null, FFLShaderMaterial, mod);
  try {
    initCharModelTextures(cm, iconRenderer);
    const camera = new THREE.PerspectiveCamera(7.9, 1, 500, 1000); // (the Mii Maker's icon camera, a little closer: the face fills a round frame)
    camera.position.set(0, 33, 600); camera.lookAt(0, 33, 0);
    return makeIconFromCharModel(cm, iconRenderer, { width: size, height: size, camera }).toDataURL('image/png');
  } finally { cm.dispose(); }
}

/** Show one of the faces a head was made with (see head()). False if it wasn't made with that one. */
export function setFace(g, n) {
  const cm = g && g.userData.charModel; if (!cm) return false;
  try { cm.setExpression(n); return true; } catch (e) { return false; }
}

/** Free a head's FFL memory and textures. */
export function dispose(g) { try { g.userData.charModel && g.userData.charModel.dispose(); } catch (e) { /* already gone */ } }

/**
 * A material for Wii Party's Mii body in FFL's own shader (the one the head is drawn with: the same light, the same
 * shine and the same rim light), so the skin and the suit match the face. `color` a '#rrggbb' colour (given to the shader
 * as it is, as FFL gives it the Mii's colours); `map` a picture (in place of the colour); `pants` the trousers' material.
 */
export function bodyMaterial({ color = '#ffffff', map = null, pants = false } = {}) {
  const n = parseInt(String(color).slice(1), 16);
  const c = new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  const m = new FFLShaderMaterial({ modulateMode: map ? 1 : 0, modulateType: pants ? 10 : 9, color: c, side: THREE.DoubleSide });
  if (map) m.map = map;
  return m;
}

export { THREE };
