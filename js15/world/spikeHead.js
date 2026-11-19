// The spike statue's jaws: the head opens its mouth to spit the spike ball, holds it open while the ball rolls, and
// shuts it again, the way the game's own animation does (m001_50_1; tools/extract_spike_head.py).
// The map's head mesh is matched to the game's points by position and posed on the CPU, like the dragon (dragon.js).
import { bindDragon, skinDragon } from './dragon.js';

export const JAW_FPS = 60;

/** Matrices (0 = stays, 1..6 = joint1..joint6) for `seq` ('open' | 'close') at frame f (held at its last frame). */
export function jawMats(J, seq, f, out = new Float32Array(84)) {
  const S = J[seq], last = S.length - 1, ff = Math.max(0, Math.min(last, f)), i0 = Math.floor(ff), i1 = Math.min(last, i0 + 1), t = ff - i0;
  out.fill(0); out[0] = out[5] = out[10] = 1;
  const a = S[i0], b = S[i1];
  for (let k = 0; k < 72; k++) out[12 + k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** How long each part lasts, in seconds. */
export const jawSecs = (J, seq) => (J[seq].length - 1) / JAW_FPS;

/** Rig the head mesh: { pose(seq, f), rest() }, or null when the mesh does not match. */
export function rigSpikeHead(mesh, J) {
  const attr = mesh.geometry.attributes.position, rest = Float32Array.from(attr.array), bind = bindDragon(rest, J);
  if (bind.matched < J.points.length / 2) return null;
  const M = new Float32Array(84);
  mesh.frustumCulled = false; // the open jaws reach past the resting bounds
  const rig = {
    bind, state: 'shut',
    pose(seq, f) { jawMats(J, seq, f, M); skinDragon(attr.array, rest, bind, M); attr.needsUpdate = true; },
    rest() { attr.array.set(rest); attr.needsUpdate = true; rig.state = 'shut'; },
  };
  return rig;
}
