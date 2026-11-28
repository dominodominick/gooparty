// The board's big springs: the game's own models (op001_jump1, blue; op001_jump2, red) and their one animation, read by
// tools/extract_spring.py into js15/world/springData.js.
// The animation (91 frames): the plate is pushed down as the player winds up on it (frames 0-41), the game holds it
// there a moment (SPRING_HOLD_AT; the trace of the real game: its speed set to 0 for about 0.27 s), then it shoots up,
// throwing the player (they leave it at about frame SPRING_LAUNCH), and wobbles back to rest, where it stays until the
// bounce is over. The player stands on its bone hook_ch, 139 units up at rest.
// Every piece is rigid on one bone, so each piece is a mesh whose matrix is its bone's place: no skinning.
import { tornadoBones } from './tornado.js';
import { SPRING_MODEL } from './springData.js';

export const SPRING_FPS = 60;
export const SPRING_HOLD_AT = 41; // the frame the game holds it at, pushed right down
export const SPRING_LAUNCH = 50; // the frame the player leaves it
export const SPRING_FRAMES = 91;

const rig = (color) => {
  const M = SPRING_MODEL[color] || SPRING_MODEL.blue;
  return { bones: M.bones, clips: M.clips, step: SPRING_MODEL.step };
};

/**
 * The frame of the spring's animation `t` seconds after it starts, when the game holds it `hold` seconds at
 * SPRING_HOLD_AT (choose the hold so that SPRING_LAUNCH comes when the player takes off).
 */
export function springFrame(t, hold) {
  const f = t * SPRING_FPS;
  if (f <= SPRING_HOLD_AT) return Math.max(0, f);
  const h = hold * SPRING_FPS;
  if (f <= SPRING_HOLD_AT + h) return SPRING_HOLD_AT;
  return Math.min(SPRING_FRAMES, f - h);
}

/** The hold that puts the take-off `secs` seconds after the animation starts. */
export const springHoldFor = (secs) => Math.max(0, secs - SPRING_LAUNCH / SPRING_FPS);

/** Where the player stands (bone hook_ch) at frame f, in the spring's own space (map units, y up). */
export function springHook(color, f) {
  const W = tornadoBones(rig(color), 'jump', f).hook_ch;
  return { x: W[3], y: W[7], z: W[11] };
}

let coilTex = null;
/**
 * Build a spring (three.js `T`, colour 'blue' or 'red'): returns { group, pose(f), hook(f) }. `group` is in map units
 * (scale it with the board; its +z is the way the player faces); pose() places every piece for frame f.
 */
export function makeSpring(T, color) {
  const M = SPRING_MODEL[color] || SPRING_MODEL.blue, R = rig(color);
  const pieces = typeof M.pieces === 'string' ? SPRING_MODEL[M.pieces].pieces : M.pieces;
  const group = new T.Group();
  if (!coilTex) {
    coilTex = new T.TextureLoader().load(SPRING_MODEL.texture);
    coilTex.flipY = false; coilTex.wrapS = coilTex.wrapT = T.RepeatWrapping; if (T.SRGBColorSpace) coilTex.colorSpace = T.SRGBColorSpace;
  }
  const mats = {};
  const material = (name) => {
    if (mats[name]) return mats[name];
    const m = M.mats[name], rgb = m.tev1 || m.mat, c = new T.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    if (T.SRGBColorSpace && c.convertSRGBToLinear) c.convertSRGBToLinear();
    return (mats[name] = new T.MeshLambertMaterial({ name, color: m.tex ? 0xffffff : c, map: m.tex ? coilTex : null }));
  };
  const meshes = pieces.map((p) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(p.pos), 3));
    if (p.nrm) g.setAttribute('normal', new T.BufferAttribute(new Float32Array(p.nrm), 3));
    if (p.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(p.uv), 2));
    g.setIndex(p.idx);
    if (!p.nrm) g.computeVertexNormals();
    const mesh = new T.Mesh(g, material(p.mat));
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.castShadow = false;
    group.add(mesh);
    return { mesh, bone: p.bone };
  });
  const out = {
    group,
    pose(f) {
      const B = tornadoBones(R, 'jump', Math.max(0, Math.min(SPRING_FRAMES, f)));
      for (const p of meshes) {
        const W = B[p.bone];
        p.mesh.matrix.set(W[0], W[1], W[2], W[3], W[4], W[5], W[6], W[7], W[8], W[9], W[10], W[11], 0, 0, 0, 1);
        p.mesh.matrixWorldNeedsUpdate = true;
      }
    },
    hook: (f) => springHook(color, f),
  };
  out.pose(0);
  return out;
}
