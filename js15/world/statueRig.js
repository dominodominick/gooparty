// The throwing statues, moved by the game's own animations.
//
// The map's statue meshes (props.glb: m001_30 blue, m001_31 red) are baked stiff in their bind pose, holding every
// piece the game's model has: base and body, head, jaw, the gem on the chest twice (dark and lit), the red one's eyes
// twice, the hands at the sides and a second pair out in front. tools/extract_statues.py wrote js15/world/statueData.js:
// which bone each vertex of the map's mesh is on (each piece is rigid on one bone), and the game's bone tracks and
// show/hide frames for the statue animations:
//   blue  wake    it rattles, the gem lights, the side hands swing round to the front and lie flat, nodding all the while
//         launch  the hands sink with the player on them, then fling them up and over
//   red   throw   it rattles, the gem and eyes light, it opens its mouth, grabs the player, lifts them over its head
//                 (mouth shut) and throws them
// Here the pieces are posed on the CPU (a few hundred vertices): bone matrix x inverse bind; a hidden piece gets an
// all-zero matrix and shrinks to nothing.

export const STATUE_FPS = 60;
const LIGHT_UP = 52;   // the frame the gem (and the red one's eyes) switch on in both statues' first clip
const WAKE_END = 60;   // the "waking up" jiggle of the side hands lasts this long

/** One of a bone's nine numbers (T, R in degrees, S) at frame f: a constant, or [first frame it moves, values every `step` frames]. */
function comp(c, f, step) {
  if (typeof c === 'number') return c;
  const a = c[0], n = c.length - 1;
  if (f <= a) return c[1];
  const x = (f - a) / step, i = Math.floor(x);
  if (i >= n - 1) return c[n];
  return c[1 + i] + (c[2 + i] - c[1 + i]) * (x - i);
}

/** A bone's place in the model at frame f of a clip (null clip = the bind pose): 3x4 row-major, T · Rz·Ry·Rx · S. */
export function boneMatrix(D, M, clip, name, f, out = new Float64Array(12)) {
  const cs = clip && clip.bones[name], r = M.rest[name], v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 9; k++) v[k] = cs ? comp(cs[k], f, D.step) : r[k];
  const d = Math.PI / 180, cx = Math.cos(v[3] * d), sx = Math.sin(v[3] * d), cy = Math.cos(v[4] * d), sy = Math.sin(v[4] * d), cz = Math.cos(v[5] * d), sz = Math.sin(v[5] * d);
  const R = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[4 * row + col] = R[3 * row + col] * v[6 + col];
    out[4 * row + 3] = v[row];
  }
  return out;
}

/** Whether a piece shows at frame f of a clip ([shown at frame 0, frames it flips]; not listed = always shown). */
export function shown(clip, name, f) {
  const s = clip && clip.shows[name];
  if (!s) return true;
  let v = s[0];
  for (let i = 1; i < s.length && s[i] <= Math.floor(f + 1e-6); i++) v ^= 1;
  return v === 1;
}

const mul34 = (A, B, out) => { // (3x4) · (3x4) with the implied bottom row 0 0 0 1
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) out[4 * r + c] = A[4 * r] * B[c] + A[4 * r + 1] * B[4 + c] + A[4 * r + 2] * B[8 + c] + (c === 3 ? A[4 * r + 3] : 0);
  }
  return out;
};

/**
 * The skin matrices of every piece of statue M at frame f of `clipName` (one 3x4 per slot, 12 numbers each).
 * opts.jiggle: the side hands bob and rock a little as the statue wakes (frames 0..60 of its first clip).
 */
export function statueMats(D, M, clipName, f, opts = {}, out = new Float32Array(12 * M.slots.length)) {
  const clip = clipName ? M.clips[clipName] : null, W = new Float64Array(12), S = new Float64Array(12);
  M.slots.forEach((name, i) => {
    if (clip && !shown(clip, name, f)) { out.fill(0, 12 * i, 12 * i + 12); return; }
    boneMatrix(D, M, clip, name, f, W);
    if (opts.jiggle && /^hand_[lr]1$/.test(name) && f < WAKE_END) { // waking up: a little bob and rock in place
      const t = f / STATUE_FPS, fade = Math.min(1, (WAKE_END - f) / 10), roll = Math.sin(t * 15.4) * 0.06 * fade;
      const c = Math.cos(roll), s = Math.sin(roll), R = new Float64Array([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]);
      mul34(new Float64Array(W), R, W); W[7] += Math.abs(Math.sin(t * 12.3)) * 5 * fade;
    }
    mul34(W, M.inv[name], S);
    for (let k = 0; k < 12; k++) out[12 * i + k] = S[k];
  });
  return out;
}

/** Each vertex's piece, from the data's letters (one per vertex of the map's mesh for that material). */
export function bindStatue(letters) {
  const out = new Uint8Array(letters.length);
  for (let i = 0; i < letters.length; i++) out[i] = parseInt(letters[i], 32);
  return out;
}

/** Pose `rest` (x,y,z,...) into `out`: each vertex by its own piece's matrix. */
export function skinStatue(out, rest, slot, mats) {
  for (let i = 0; i < slot.length; i++) {
    const o = 12 * slot[i], x = rest[3 * i], y = rest[3 * i + 1], z = rest[3 * i + 2];
    out[3 * i] = mats[o] * x + mats[o + 1] * y + mats[o + 2] * z + mats[o + 3];
    out[3 * i + 1] = mats[o + 4] * x + mats[o + 5] * y + mats[o + 6] * z + mats[o + 7];
    out[3 * i + 2] = mats[o + 8] * x + mats[o + 9] * y + mats[o + 10] * z + mats[o + 11];
  }
  return out;
}

const matName = (m) => (Array.isArray(m.material) ? m.material[0] : m.material)?.name || '';

/**
 * Rig a placed copy of statue `model` ('m001_30' or 'm001_31'): each of its meshes gets its own geometry (the two blue
 * statues share the map's template) and is posed with the game's animation.
 * Returns { model, first, pose(clip, f, opts), hook(clip, f) } or null when the mesh is not the one the data knows.
 * `pose(null)` is the statue asleep: the first frame of its first clip (dark gem, front hands hidden).
 */
export function rigStatue(root, D, model) {
  const M = D[model]; if (!M) return null;
  const parts = [];
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
    const letters = M.bind[matName(m)]; if (!letters) return;
    if (m.geometry.attributes.position.count !== letters.length) return;
    m.geometry = m.geometry.clone();
    const attr = m.geometry.attributes.position;
    parts.push({ mesh: m, attr, rest: Float32Array.from(attr.array), slot: bindStatue(letters) });
    m.frustumCulled = false; // the hands swing well outside the resting bounds
  });
  if (parts.length !== Object.keys(M.bind).length) return null;
  const first = model === 'm001_30' ? 'wake' : 'throw', mats = new Float32Array(12 * M.slots.length);
  const rig = {
    model, first, data: M, parts, mesh: parts[0].mesh,
    clip: null, frame: 0,
    pose(clip, f = 0, opts = {}) {
      const c = clip || first, ff = clip ? f : 0;
      statueMats(D, M, c, ff, opts, mats);
      for (const p of parts) { skinStatue(p.attr.array, p.rest, p.slot, mats); p.attr.needsUpdate = true; }
      rig.clip = clip; rig.frame = ff;
    },
    /** Where the player is carried (the game's hook_player bone) at frame f: 3x4 in the model's space. */
    hook(clip, f) { return boneMatrix(D, M, M.clips[clip], 'hook_player', f); },
    frames(clip) { return M.clips[clip].frames; },
  };
  rig.pose(null);
  return rig;
}

/**
 * The timeline of a statue throw, in milliseconds of a move lasting `dur` (13 s in the game's own pace; a shorter or
 * longer move is the same, scaled). The statue plays the game's clips at 60 frames a second; the player lets go at
 * `release`, flies to the statue's platform until `land`, stands there until `walk`, then walks off onto the space.
 *  blue: wake 0-300 (the player hops from the space onto its hands over frames 262-288, when the nodding stops),
 *        launch 0-100 (the player rides the hands down and up and lets go at frame 66);
 *  red:  throw 0-390 (it grabs the player at 258, starts lifting at 288, throws at 352).
 */
export const STATUE_DUR = 13000;
export function statueTimeline(color, dur = STATUE_DUR) {
  const k = dur / STATUE_DUR, ms = (frames) => frames / STATUE_FPS * 1000 * k;
  const red = color === 'red';
  const clips = red ? [{ name: 'throw', at: 0, frames: 391 }] : [{ name: 'wake', at: 0, frames: 301 }, { name: 'launch', at: ms(300), frames: 101 }];
  const release = red ? ms(352) : ms(300 + 66), after = dur - release;
  const T = {
    red, clips, release, ms,
    land: release + after * 0.51, walk: release + after * 0.72, dur,
    hop: red ? null : [ms(262), ms(288)],   // blue: from the space onto the flat hands
    grab: red ? ms(258) : null,             // red: the hands close round the player
    lift: red ? ms(288) : ms(300),          // the player starts moving with the hands
    lightUp: ms(LIGHT_UP),
  };
  /** The statue's clip and frame at time t (ms); after the last clip it holds that clip's last frame. */
  T.at = (t) => {
    let c = clips[0];
    for (const x of clips) if (t >= x.at) c = x;
    return { clip: c.name, f: Math.min(c.frames - 1, Math.max(0, (t - c.at) / (1000 * k) * STATUE_FPS)) };
  };
  return T;
}
