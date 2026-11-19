// The dragon on the dragon wall, made to move the way the game moves it: it rears its head back, opens its jaws, and
// the fireball it holds in its mouth rises and is spat out. The wall itself never moves.
//
// The map's dragon mesh (props.glb, m001_35) is the rest pose baked stiff. tools/extract_dragon.py read the game's own
// model and its shooting animation (m001_35_4) into js15/world/dragonData.js: points of the head and the two fireballs
// in the model's space, which bones each point follows and how much, and the bones' skin matrices frame by frame.
// Here each vertex of the map's own mesh is matched to those points by position (so the map's materials, textures and
// UVs stay as they are), and posed on the CPU: a few hundred vertices.
//
// Matrices: 0 = does not move (the stone under the head); 1..5 = joint1..joint5 (head, upper jaw, lower jaw);
// 6 = kazandan (the ball held in the mouth); 7 = kazandan1 (the ball that is spat).

export const DRAGON_FPS = 40;      // the game's 51 frames, played a little slower than 60 so the jaws read
const BALL_IN_MOUTH = 6, BALL_SPAT = 7;

/** For each vertex of `rest` (x,y,z,...), the matrices it follows and their weights (4 each); unmatched vertices stay put. */
export function bindDragon(rest, D, tol = 0.1) {
  const n = rest.length / 3, m = D.points.length / 3, joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
  let matched = 0;
  for (let i = 0; i < n; i++) {
    const x = rest[3 * i], y = rest[3 * i + 1], z = rest[3 * i + 2];
    let best = -1, bd = tol * tol;
    for (let k = 0; k < m; k++) {
      const dx = D.points[3 * k] - x, dy = D.points[3 * k + 1] - y, dz = D.points[3 * k + 2] - z, dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = k; }
    }
    if (best < 0) { weights[4 * i] = 1; continue; } // matrix 0, weight 1: stays where it is
    matched++;
    let sum = 0; for (let j = 0; j < 4; j++) sum += D.weights[4 * best + j];
    for (let j = 0; j < 4; j++) { joints[4 * i + j] = D.joints[4 * best + j]; weights[4 * i + j] = D.weights[4 * best + j] / sum; } // (stored rounded)
  }
  return { joints, weights, matched };
}

/**
 * The eight 3x4 matrices (row-major, 12 numbers each) for frame `f` (fractional; held at the last frame).
 * ball: optional { at: [x,y,z] model space, scale } puts the spat ball there instead of on its own path; { hide: true } hides it.
 */
export function dragonMats(D, f, ball = null, out = new Float32Array(96)) {
  const last = D.frames - 1, ff = Math.max(0, Math.min(last, f)), i0 = Math.floor(ff), i1 = Math.min(last, i0 + 1), t = ff - i0;
  out.fill(0); out[0] = out[5] = out[10] = 1;
  const a = D.skin[i0], b = D.skin[i1];
  for (let k = 0; k < 84; k++) out[12 + k] = a[k] + (b[k] - a[k]) * t;
  const shown = (name) => D.show[name][Math.round(ff)] === 1;
  if (!shown('kazandan')) out.fill(0, 12 * BALL_IN_MOUTH, 12 * BALL_IN_MOUTH + 12); // all zeros: the ball shrinks to nothing
  if (ball && ball.hide) out.fill(0, 12 * BALL_SPAT, 12 * BALL_SPAT + 12);
  else if (ball && ball.at) { // the ball's own turn and size from the animation, at the given place: [R*s | at] * inverse bind
    const W = D.ballWorld[Math.round(ff)], s = ball.scale ?? 1, inv = D.ballInv;
    const R = [W[0] * s, W[1] * s, W[2] * s, ball.at[0], W[4] * s, W[5] * s, W[6] * s, ball.at[1], W[8] * s, W[9] * s, W[10] * s, ball.at[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      out[12 * BALL_SPAT + 4 * r + c] = R[4 * r] * inv[c] + R[4 * r + 1] * inv[4 + c] + R[4 * r + 2] * inv[8 + c] + (c === 3 ? R[4 * r + 3] : 0);
    }
  } else if (!shown('kazandan1')) out.fill(0, 12 * BALL_SPAT, 12 * BALL_SPAT + 12);
  return out;
}

/** Where the spat ball's bone is at frame f, in the model's space (its centre). */
export function spatBallAt(D, f) {
  const W = D.ballWorld[Math.max(0, Math.min(D.frames - 1, Math.round(f)))];
  return [W[3], W[7], W[11]];
}

/** Pose `rest` into `out` with matrices `M` (from dragonMats). */
export function skinDragon(out, rest, bind, M) {
  const n = rest.length / 3, { joints, weights } = bind;
  for (let i = 0; i < n; i++) {
    const x = rest[3 * i], y = rest[3 * i + 1], z = rest[3 * i + 2];
    let px = 0, py = 0, pz = 0;
    for (let j = 0; j < 4; j++) {
      const w = weights[4 * i + j]; if (!w) continue;
      const o = 12 * joints[4 * i + j];
      px += w * (M[o] * x + M[o + 1] * y + M[o + 2] * z + M[o + 3]);
      py += w * (M[o + 4] * x + M[o + 5] * y + M[o + 6] * z + M[o + 7]);
      pz += w * (M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11]);
    }
    out[3 * i] = px; out[3 * i + 1] = py; out[3 * i + 2] = pz;
  }
  return out;
}

const matName = (m) => (Array.isArray(m.material) ? m.material[0] : m.material)?.name || '';

/**
 * Rig a clone of the map's dragon (m001_35) under `root`: the head and the two fireballs pose with the animation, and the
 * clone's own copy of the wall is hidden (the resting dragon, m001_35l, keeps showing the wall the whole time).
 * Returns { pose(f, ball), ballToLocal(v) } or null when the mesh is not there.
 */
export function rigDragon(root, D) {
  const parts = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    const name = matName(m);
    if (/^mr001m068/.test(name)) { m.visible = false; return; } // the wall: shown by the resting model instead
    if (!/^mr001m067|^mr001m011_3$/.test(name)) return;
    m.geometry = m.geometry.clone(); // our own copy: the template stays at rest
    const attr = m.geometry.attributes.position, rest = Float32Array.from(attr.array);
    parts.push({ mesh: m, attr, rest, bind: bindDragon(rest, D) });
    m.frustumCulled = false; // the ball flies well outside the resting bounds
  });
  if (!parts.length || !parts.some((p) => p.bind.matched)) return null;
  const M = new Float32Array(96);
  return {
    parts,
    pose(f, ball = null) {
      dragonMats(D, f, ball, M);
      for (const p of parts) { skinDragon(p.attr.array, p.rest, p.bind, M); p.attr.needsUpdate = true; }
    },
  };
}
