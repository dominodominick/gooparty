// Loads the real Board Game Island map (assets/board-game-island) with its own loader, wiiBoard.js, which applies the
// baked lightmaps and the glow blending. Only the page's entry point imports this file: it needs the real three.js.
import * as THREE from 'three';
import { loadBoardGameIsland, makeLoader } from './wiiBoard.js';
import { MAP_SCALE } from '../game/boardLayout.js';
import { waterCanvas, WaterFlow, WATER_FLOW } from './water.js';
import { addWatasy } from './watasy.js';
import { WATASY } from './watasyModel.js';
import { addBirds } from './birds.js';
import { addSignDecals } from './signs.js';
import { SIGN_DECALS } from './signDecals.js';
import { BIRDS } from './birdsData.js';

const FILES = ['island.glb', 'volcano.glb', 'sky.glb', 'props.glb', 'board.json'];
let promise = null;

/**
 * The water surface is a grey ripple pattern that the game coloured blue at run time, with ripple and foam layers added
 * on top. Converted, it all comes out as grey noise: give the surface a blue water texture made from that pattern (see
 * water.js), turn the added layers down, and set every layer sliding. `board.tick(dt)` moves the water; scenes call it each frame.
 */
function calmWater(board) {
  const seen = new Set();
  // soft round shadows (under the UFOs and the like): the game subtracted this dark gradient; drawn plain it is a black slab
  let shadow = null;
  const shadowTex = () => {
    if (shadow) return shadow;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); shadow = new THREE.CanvasTexture(c); shadow.colorSpace = THREE.SRGBColorSpace; return shadow;
  };
  for (const root of [board.island, ...board.props.values()]) root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (/^mr001m032/.test(m.name || '') && !seen.has(m)) {
      seen.add(m); m.map = shadowTex(); m.color.setRGB(1, 1, 1); m.transparent = true; m.depthWrite = false; m.alphaTest = 0; m.needsUpdate = true;
    }
  });
  // the space tiles sit right on the path: nudge them forward in depth so the ground never shows through them
  for (const area of ['island', 'volcano']) for (const mesh of board.spaceMeshes[area].values()) {
    mesh.material = mesh.material.clone(); mesh.material.polygonOffset = true; mesh.material.polygonOffsetFactor = -2; mesh.material.polygonOffsetUnits = -6;
  }
  const flow = new WaterFlow(), blue = {};
  let swim = null;
  try { swim = addWatasy(THREE, board.island, WATASY); } catch (e) { swim = null; } // the dinosaur in the pool by the bridge
  board.watasy = swim;
  let birds = null;
  try { birds = addBirds(THREE, board.island, BIRDS); } catch (e) { birds = null; } // the birds fly their own paths
  board.birds = birds;
  try { board.signs = addSignDecals(THREE, board.island, SIGN_DECALS); } catch (e) { board.signs = {}; } // the arrow, the 4 and the 3 on the wooden signs
  board.tick = (dt) => { flow.update(dt); if (swim) swim(dt); if (birds) birds(dt); };
  // the blue water texture, made once for the river (solid) and once for the sea layer (half see-through, over the sea-floor colours)
  const blueWater = (m, kind) => {
    if (!blue[kind]) {
      const t = new THREE.CanvasTexture(waterCanvas(m.map.image, kind === 'sea' ? 128 : 255));
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; t.anisotropy = m.map.anisotropy;
      blue[kind] = flow.add(t, ...WATER_FLOW[kind]);
    }
    m.map = blue[kind]; m.color.setRGB(1, 1, 1); m.needsUpdate = true;
  };
  board.island.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const layer = /^mr001m(008|009|051)/.exec(m.name || '');
      if (layer) { // ripple and foam layers: a soft shimmer, sliding along
        m.color.setRGB(0.16, 0.22, 0.25);
        if (m.map) flow.add(m.map, ...WATER_FLOW[{ '008': 'waves', '009': 'caustics', '051': 'foam' }[layer[1]]]);
      } else if (/^mr001m004/.test(m.name || '')) { // the water surface itself
        const river = m.name === 'mr001m004';
        try { blueWater(m, river ? 'surface' : 'sea'); } catch (e) {
          m.color.setRGB(0.36, 0.8, 1.45); // could not make the texture: the old look, the grey pattern tinted blue
          if (m.map) flow.add(m.map, ...WATER_FLOW[river ? 'surface' : 'sea']);
        }
        // the plain water stays solid (there is nothing under it to see); only its soft edge layer stays see-through
        if (river) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
      }
    }
  });
}

/**
 * Returns a promise for the loaded board (the same one every time).
 * `embedded`: optional { 'island.glb': base64, ..., 'board.json': text } when the files are packed into the page itself.
 */
export function loadBoard(base, embedded) {
  if (promise) return promise;
  let loader, restoreFetch = null;
  if (embedded) {
    const urls = {};
    for (const f of FILES) {
      if (f.endsWith('.json')) continue;
      const bin = atob(embedded[f]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      urls[f] = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
    }
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((u) => urls[u.split('/').pop()] || u);
    loader = makeLoader(manager);
    // wiiBoard.js fetches board.json itself: answer that one request from the packed copy
    const realFetch = window.fetch.bind(window);
    window.fetch = (u, ...rest) => (String(u).endsWith('board.json') ? Promise.resolve(new Response(embedded['board.json'], { headers: { 'Content-Type': 'application/json' } })) : realFetch(u, ...rest));
    restoreFetch = () => { window.fetch = realFetch; };
  }
  promise = loadBoardGameIsland(base, { scale: MAP_SCALE, loader }).then((board) => { if (restoreFetch) restoreFetch(); calmWater(board); return board; },
    (e) => { if (restoreFetch) restoreFetch(); promise = null; throw e; });
  return promise;
}
