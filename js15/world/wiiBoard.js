// Board Game Island loader for three.js
// ------------------------------------------------------------
// Usage:
//   import { loadBoardGameIsland } from './wiiBoard.js';
//   const board = await loadBoardGameIsland('/assets/board-game-island/', { scale: 0.01 });
//   scene.add(board.island, board.sky);          // board.volcano is a separate area
//   const p = board.spacePosition('island', 1);  // THREE.Vector3 of space 1
//   board.setSpaceTexture('island', 12, myPlusSpaceTexture);
//
// Requires three r152+ (texture .channel support). Works with r160+.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// three r155+ divides MeshBasicMaterial lightmaps by PI; compensate so the
// baked Wii lighting keeps its brightness. Set to 1 on older versions.
export const LIGHTMAP_SCALE = parseInt(THREE.REVISION, 10) >= 155 ? Math.PI : 1;

/** GLTFLoader plugin: applies the Wii render state stored in material.extras.wii */
export class WiiMaterialsPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = 'WII_render_state';
  }

  async afterRoot(result) {
    const jobs = [];
    const seen = new Set();
    result.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        const wii = mat.userData.wii;
        if (!wii) continue;

        // Baked lightmap (shadow + fill) on the second UV set
        if (wii.lightMap !== undefined) {
          jobs.push(this.parser.getDependency('texture', wii.lightMap).then((tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.channel = 1;
            mat.lightMap = tex;
            mat.lightMapIntensity = (wii.lightMapIntensity ?? 1) * LIGHTMAP_SCALE;
            mat.needsUpdate = true;
          }));
        }
        // Glow effects (light rays, lava glow, sparkles): black = invisible
        if (wii.blend === 'additive') {
          mat.blending = THREE.AdditiveBlending;
          mat.transparent = true;
          mat.depthWrite = false;
        } else if (wii.blend === 'subtractive') {
          mat.blending = THREE.SubtractiveBlending;
          mat.transparent = true;
          mat.depthWrite = false;
        }
        // Board spaces sit on the path: avoid z-fighting
        if (wii.space) {
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = -1;
          mat.polygonOffsetUnits = -4;
        }
        if (mat.transparent && !wii.blend) mat.depthWrite = false;
      }
    });
    await Promise.all(jobs);
  }
}

export function makeLoader(manager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new WiiMaterialsPlugin(parser));
  return loader;
}

/**
 * Load island, volcano, sky, props and board data.
 * @param {string} base  folder URL ending in '/'
 * @param {{scale?: number, loader?: GLTFLoader}} opts  scale 0.01 turns Wii units into ~metres
 */
export async function loadBoardGameIsland(base, opts = {}) {
  const scale = opts.scale ?? 0.01;
  const loader = opts.loader ?? makeLoader();
  const [island, volcano, sky, props, data] = await Promise.all([
    loader.loadAsync(base + 'island.glb'),
    loader.loadAsync(base + 'volcano.glb'),
    loader.loadAsync(base + 'sky.glb'),
    loader.loadAsync(base + 'props.glb'),
    fetch(base + 'board.json').then((r) => r.json()),
  ]);
  for (const g of [island, volcano, sky, props]) g.scene.scale.setScalar(scale);
  // the sky dome is huge and should never be culled or write depth
  sky.scene.traverse((o) => {
    if (o.isMesh) { o.frustumCulled = false; o.renderOrder = -1; o.material.depthWrite = false; }
  });

  // id -> space mesh
  const spaceMeshes = { island: new Map(), volcano: new Map() };
  for (const [area, g] of [['island', island], ['volcano', volcano]]) {
    g.scene.traverse((o) => {
      const m = /^space_(\d+)$/.exec(o.name);
      if (m) spaceMeshes[area].set(parseInt(m[1], 10), o);
    });
  }

  const propTemplates = new Map();
  props.scene.traverse((o) => { if (/^m001_\d+\w*$/.test(o.name) && o.parent === props.scene) propTemplates.set(o.name, o); });

  return {
    data,
    scale,
    island: island.scene,
    volcano: volcano.scene,
    sky: sky.scene,
    props: propTemplates,      // name -> Object3D (authored at origin; clone and place at a hook)
    spaceMeshes,

    /** World-space position of a board space (area: 'island' | 'volcano') */
    spacePosition(area, id, target = new THREE.Vector3()) {
      const s = data[area].spaces.find((x) => x.id === id);
      return s ? target.fromArray(s.position).multiplyScalar(scale) : null;
    },
    /** Ordered list of space ids along the path */
    path(area) { return data[area].path; },
    /** World-space position of a named hook, e.g. 'hook_start1', 'hook_bridge1' */
    hookPosition(area, name, target = new THREE.Vector3()) {
      const h = data[area].hooks[name];
      return h ? target.fromArray(h).multiplyScalar(scale) : null;
    },
    /** Swap the icon on one space (plus, minus, event...). glTF textures use flipY = false. */
    setSpaceTexture(area, id, texture) {
      const mesh = spaceMeshes[area].get(id);
      if (!mesh) return false;
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      mesh.material = mesh.material.clone(); // (keeps the polygon offset the loader gave it)
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
      return true;
    },
  };
}
