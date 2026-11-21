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

/** A Mii head (THREE.Group of FFL's meshes, about 92 units wide, origin at the neck, facing +z) from Mii bytes FFL takes. */
export function head(bytes, renderer) {
  if (!mod) throw new Error('FFL not started');
  const cm = createCharModel(bytes, null, FFLShaderMaterial, mod);
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

/** Free a head's FFL memory and textures. */
export function dispose(g) { try { g.userData.charModel && g.userData.charModel.dispose(); } catch (e) { /* already gone */ } }

export { THREE };
