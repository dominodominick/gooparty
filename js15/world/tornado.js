// The tornado of the board's tornado space: the game's own model (op001_tornado) and its three animations, read by
// tools/extract_tornado.py into js15/world/tornadoData.js.
//   form  it forms round the player and lifts them up (121 frames)
//   spin  it spins, carrying them (120 frames, loops)
//   fade  it dies away (31 frames)
// Every piece is rigid on one bone, so each piece is a mesh whose matrix is its bone's place: no skinning. The layers'
// see-through-ness (alpha) and the streak texture's scroll up the funnel are animated too.

export const TORNADO_FPS = 60;
// Drawn with ordinary see-through blending the game's own alpha values (layers at 0.3, vertex fades up to 0.36) come out
// as a faint wisp; the Wii's colour combiner made them read as a solid white swirl. Stronger here, capped at 1.
export const TORNADO_ALPHA = 2.4;

/** One animated number: a constant, or [first frame it changes, then a value every `step` frames, held after]. */
export function track(c, f, step = 2) {
  if (typeof c === 'number') return c;
  const a = c[0], n = c.length - 1;
  if (f <= a) return c[1];
  const x = (f - a) / step, i = Math.floor(x);
  if (i >= n - 1) return c[n];
  return c[1 + i] + (c[2 + i] - c[1 + i]) * (x - i);
}

const shownAt = (clip, name, f) => {
  const s = clip.shows[name]; if (!s) return true;
  let v = s[0];
  for (let i = 1; i < s.length && s[i] <= Math.floor(f + 1e-6); i++) v ^= 1;
  return v === 1;
};

/** Every bone's place in the tornado's space at frame f of a clip: name -> 3x4 row-major (T · Rz·Ry·Rx · S, parent first). */
export function tornadoBones(D, clipName, f) {
  const clip = D.clips[clipName], out = {}, d = Math.PI / 180;
  for (const b of D.bones) { // (parents come before their children)
    const cs = clip.bones[b.name], v = [];
    for (let k = 0; k < 9; k++) v.push(cs ? track(cs[k], f, D.step) : b.rest[k]);
    const cx = Math.cos(v[3] * d), sx = Math.sin(v[3] * d), cy = Math.cos(v[4] * d), sy = Math.sin(v[4] * d), cz = Math.cos(v[5] * d), sz = Math.sin(v[5] * d);
    const Rm = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
    const L = new Array(12);
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) L[4 * r + c] = Rm[3 * r + c] * v[6 + c]; L[4 * r + 3] = v[r]; }
    const P = b.parent >= 0 ? out[D.bones[b.parent].name] : null;
    if (!P) { out[b.name] = L; continue; }
    const W = new Array(12);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) W[4 * r + c] = P[4 * r] * L[c] + P[4 * r + 1] * L[4 + c] + P[4 * r + 2] * L[8 + c] + (c === 3 ? P[4 * r + 3] : 0);
    out[b.name] = W;
  }
  return out;
}

/** Where the carried player is (the game's hook_player bone) at frame f, in the tornado's space. */
export function tornadoHook(D, clipName, f) {
  const W = tornadoBones(D, clipName, f).hook_player;
  return { x: W[3], y: W[7], z: W[11] };
}

/**
 * Build the tornado (three.js `T`): returns { group, pose(clip, f), hook(clip, f) }. `group` is in map units (scale it
 * with the board); pose() places every piece, shows/hides them and sets each layer's alpha and texture scroll.
 */
export function makeTornado(T, D) {
  const group = new T.Group(), textures = {}, loader = new T.TextureLoader();
  const tex = (name) => {
    if (!textures[name]) {
      const t = loader.load(D.textures[name]);
      t.flipY = false; t.wrapS = t.wrapT = T.RepeatWrapping; if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
      textures[name] = t;
    }
    return textures[name];
  };
  const mats = {};
  const material = (name) => {
    if (!mats[name]) {
      const map = tex(D.matTex[name]).clone(); map.needsUpdate = true; // each layer scrolls on its own
      mats[name] = new T.MeshBasicMaterial({ name, map, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false });
    }
    return mats[name];
  };
  const pieces = D.pieces.map((p) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(p.pos), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(p.uv), 2));
    const m = material(p.mat);
    if (p.col) { const c = Float32Array.from(p.col); for (let i = 3; i < c.length; i += 4) c[i] = Math.min(1, c[i] * TORNADO_ALPHA); g.setAttribute('color', new T.BufferAttribute(c, 4)); }
    g.setIndex(p.idx);
    let mat = m;
    if (p.col) { if (!m.userData.vc) { m.userData.vc = m.clone(); m.userData.vc.vertexColors = true; } mat = m.userData.vc; } // (the layers that fade by vertex)
    const mesh = new T.Mesh(g, mat);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 3;
    group.add(mesh);
    return { mesh, bone: p.bone, mat: p.mat };
  });
  const out = {
    group,
    pose(clipName, f) {
      const clip = D.clips[clipName], B = tornadoBones(D, clipName, f);
      for (const p of pieces) {
        const W = B[p.bone];
        p.mesh.matrix.set(W[0], W[1], W[2], W[3], W[4], W[5], W[6], W[7], W[8], W[9], W[10], W[11], 0, 0, 0, 1);
        p.mesh.matrixWorldNeedsUpdate = true;
        p.mesh.visible = shownAt(clip, p.bone, f);
        const a = clip.alpha[p.mat], m = p.mesh.material;
        m.opacity = a === undefined ? 1 : Math.min(1, track(a, f, D.step) * TORNADO_ALPHA);
        const s = clip.scroll[p.mat];
        if (s && m.map) m.map.offset.set(-track(s.u, f, D.step), -track(s.v, f, D.step));
      }
    },
    hook: (clipName, f) => tornadoHook(D, clipName, f),
  };
  out.pose('form', 0);
  return out;
}
