// Smashing a challenge the way the game does: the dragon wall jolts each time it is hit and is blown to pieces, the summit
// gate likewise, and the spike ball in the statue's mouth shatters. The game's own animations, sampled by
// tools/extract_breaks.py into breakData.js: for each model, its pieces' points (in the model's own space) and the bones
// they follow, and per frame one 3x4 matrix per moving bone, relative to the rest pose (a hidden piece's is all zeros).
//
// The map's meshes are the converted rest pose, with a model's pieces merged into a few meshes, so each vertex is matched
// to the game's points by position. Pieces that touch share positions, so a whole triangle goes with the piece that all
// three of its corners belong to. Then the vertices are posed on the CPU, a few thousand at most.

/** The matrices of a clip at frame f (60 a second; between samples they are blended; held at the last frame). */
export function breakMats(B, clip, f, out) {
  const C = B.clips[clip], S = C.samples, n = B.movers.length * 12;
  const ff = Math.max(0, Math.min(C.frames - 1, f));
  let i = 0; while (i < S.length - 2 && S[i + 1] <= ff) i++;
  const t = S[i + 1] > S[i] ? Math.min(1, Math.max(0, (ff - S[i]) / (S[i + 1] - S[i]))) : 0;
  const a = C.mats[i], b = C.mats[Math.min(S.length - 1, i + 1)];
  for (let k = 0; k < n; k++) out[12 + k] = a[k] + (b[k] - a[k]) * t;
  out[0] = out[5] = out[10] = 1; out[1] = out[2] = out[3] = out[4] = out[6] = out[7] = out[8] = out[9] = out[11] = 0; // matrix 0: stays put
  return out;
}

/**
 * A mesh's shape before anything moved it. The map's meshes are shared (each copy of a prop draws the same geometry), so
 * the first rig keeps the pristine shape on the geometry itself: a smash cut short somewhere else cannot leave it broken.
 */
export function pristine(mesh) {
  const g = mesh.geometry;
  return (g.userData.breakRest ||= Float32Array.from(g.attributes.position.array));
}

/** Put meshes back to their pristine shape (when a board is set up again). */
export function restorePristine(obj) {
  if (!obj || !obj.traverse) return;
  obj.traverse((m) => { const g = m.isMesh && m.geometry; if (g && g.userData && g.userData.breakRest) { g.attributes.position.array.set(g.userData.breakRest); g.attributes.position.needsUpdate = true; } });
}

/** For each vertex of each mesh: the point of the game's model it is (index), or -1. Whole triangles go to one piece. */
export function matchPieces(meshes, B, off = [0, 0, 0], tol = 0.15) {
  const P = B.points, n = P.length / 3, cell = tol * 2, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let k = 0; k < n; k++) {
    const x = P[3 * k] - off[0], y = P[3 * k + 1] - off[1], z = P[3 * k + 2] - off[2], kk = key(x, y, z);
    if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k);
  }
  const piece = (k) => B.joints[4 * k] * 1000 + (B.weights[4 * k] < 0.999 ? 500 : 0); // (the dragon's skinned head counts as one piece)
  const near = (x, y, z) => {
    const out = [], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) {
      const g = grid.get(`${cx + i},${cy + j},${cz + l}`); if (!g) continue;
      for (const k of g) { const dx = P[3 * k] - off[0] - x, dy = P[3 * k + 1] - off[1] - y, dz = P[3 * k + 2] - off[2] - z; if (dx * dx + dy * dy + dz * dz <= tol * tol) out.push(k); }
    }
    return out;
  };
  let matched = 0, total = 0;
  const result = meshes.map((mesh) => {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index, nv = pos.count, nt = (idx ? idx.count : nv) / 3, rp = pristine(mesh);
    const cand = new Array(nv), own = new Int32Array(nv).fill(-1);
    for (let v = 0; v < nv; v++) cand[v] = near(rp[3 * v], rp[3 * v + 1], rp[3 * v + 2]);
    for (let t = 0; t < nt; t++) {
      const vs = [0, 1, 2].map((c) => (idx ? idx.getX(3 * t + c) : 3 * t + c));
      const votes = new Map();
      for (const v of vs) for (const pc of new Set(cand[v].map(piece))) votes.set(pc, (votes.get(pc) || 0) + 1);
      let best = null, bv = 0; for (const [pc, c] of votes) if (c > bv) { best = pc; bv = c; }
      if (best == null) continue;
      for (const v of vs) {
        if (own[v] >= 0) continue;
        const ks = cand[v].filter((k) => piece(k) === best);
        if (ks.length) own[v] = ks[0]; else if (cand[v].length) own[v] = cand[v][0];
      }
    }
    for (let v = 0; v < nv; v++) { total++; if (own[v] >= 0) matched++; }
    return own;
  });
  return { own: result, matched, total };
}

/**
 * Rig the meshes of one model (map prop) to the game's pieces: { pose(clip, frame), rest(), matched, hook(name) }.
 * `off`: where the meshes' own origin is in the model's space (the spike ball's meshes are re-centred on the ball).
 */
export function rigBreak(meshes, B, { off = [0, 0, 0], tol = 0.15, split = false } = {}) {
  // split: each triangle gets its own corners, so no corner is shared by two pieces (one would drag the other's along)
  if (split) for (const m of meshes) if (m.geometry.index && m.geometry.toNonIndexed) { const g = m.geometry.toNonIndexed(); g.userData = {}; m.geometry = g; }
  const { own, matched, total } = matchPieces(meshes, B, off, tol);
  const M = new Float32Array(12 + B.movers.length * 12);
  const parts = meshes.map((mesh, i) => {
    const attr = mesh.geometry.attributes.position, rest = pristine(mesh);
    attr.array.set(rest); attr.needsUpdate = true;
    mesh.frustumCulled = false; // the pieces fly far past the resting bounds
    return { mesh, attr, rest, own: own[i] };
  });
  const rig = {
    matched, total, posed: false,
    pose(clip, f) {
      breakMats(B, clip, f, M);
      for (const p of parts) {
        const a = p.attr.array, r = p.rest;
        for (let v = 0; v < p.own.length; v++) {
          const k = p.own[v], x = r[3 * v] + off[0], y = r[3 * v + 1] + off[1], z = r[3 * v + 2] + off[2];
          if (k < 0) continue;
          let ox = 0, oy = 0, oz = 0;
          for (let j = 0; j < 4; j++) {
            const w = B.weights[4 * k + j]; if (!w) continue;
            const m = 12 * B.joints[4 * k + j];
            ox += w * (M[m] * x + M[m + 1] * y + M[m + 2] * z + M[m + 3]);
            oy += w * (M[m + 4] * x + M[m + 5] * y + M[m + 6] * z + M[m + 7]);
            oz += w * (M[m + 8] * x + M[m + 9] * y + M[m + 10] * z + M[m + 11]);
          }
          a[3 * v] = ox - off[0]; a[3 * v + 1] = oy - off[1]; a[3 * v + 2] = oz - off[2];
        }
        p.attr.needsUpdate = true;
      }
      rig.posed = true;
    },
    rest() { for (const p of parts) { p.attr.array.set(p.rest); p.attr.needsUpdate = true; } rig.posed = false; },
    /** A hit spot (hit1..hit5, break) in the model's own space, or null. */
    hook(name) { const h = B.hooks[name]; return h ? { x: h[0], y: h[1], z: h[2] } : null; },
    frames: (clip) => (B.clips[clip] ? B.clips[clip].frames : 0),
    /** The first frame of a clip at which every piece shows (the spike ball's shards are hidden until it bursts). */
    shownFrom(clip) { const C = B.clips[clip]; if (!C) return 0; const k = C.mats.findIndex((row) => { for (let m = 0; m < B.movers.length; m++) if (row.slice(12 * m, 12 * m + 12).every((v) => v === 0)) return false; return true; }); return k > 0 ? C.samples[k] : 0; },
  };
  return rig;
}
