// The volcano eruption, with the game's own pieces (tools/extract_eruption.py → js15/world/eruptionData.js): the crater
// on top of the volcano rumbles and heaves (m001_40), and volcanic bombs ("meteors", m001_44) fall onto the board.
// The pieces are rigid: each frame is one matrix that moves the piece from where the map has it (its bind pose).
// The fire, smoke and bursts were particle effects in the Wii game; here they are simple glowing sprites.

export const ERUPTION_FPS = 60;
export const METEOR_LAND = 25;   // the frame the meteor reaches the ground
export const METEOR_SIZE = 1.6;  // the game's meteor, a little bigger so it reads from a distance

/** The 12 numbers of frame f of a clip (held at its last frame). */
export function clipFrame(clip, f) { return clip.skin[Math.max(0, Math.min(clip.frames - 1, Math.round(f)))]; }

/** Set a three.js Matrix4 from a 3x4 row-major array. */
export function setMat(m4, s) { m4.set(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], 0, 0, 0, 1); return m4; }

/** Where the meteor is (its centre, map units in its own model) at frame f: the animation applied to its bind centre. */
export function meteorAt(D, f) {
  const s = clipFrame(D.meteor, f), p = [0, 995, -1500]; // (the meteor's bone sits here in the bind pose)
  return { x: s[0] * p[0] + s[1] * p[1] + s[2] * p[2] + s[3], y: s[4] * p[0] + s[5] * p[1] + s[6] * p[2] + s[7], z: s[8] * p[0] + s[9] * p[1] + s[10] * p[2] + s[11] };
}

/** A glowing burst texture (white core, warm rays) for impacts and the crater's blast. */
export function burstCanvas(size = 128) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.25, 'rgba(255,230,140,0.95)'); grd.addColorStop(0.55, 'rgba(255,140,40,0.55)'); grd.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,250,220,0.7)';
  for (let i = 0; i < 10; i++) { // star rays
    const a = (i / 10) * Math.PI * 2, r1 = h * (i % 2 ? 0.75 : 0.98);
    g.beginPath(); g.moveTo(h + Math.cos(a - 0.12) * h * 0.15, h + Math.sin(a - 0.12) * h * 0.15); g.lineTo(h + Math.cos(a) * r1, h + Math.sin(a) * r1); g.lineTo(h + Math.cos(a + 0.12) * h * 0.15, h + Math.sin(a + 0.12) * h * 0.15); g.fill();
  }
  return c;
}

/** A soft grey puff texture for smoke. */
export function smokeCanvas(size = 64) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2, grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, 'rgba(90,80,75,0.85)'); grd.addColorStop(0.6, 'rgba(110,100,95,0.45)'); grd.addColorStop(1, 'rgba(120,110,105,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return c;
}

/**
 * The eruption cutscene's schedule (milliseconds of a `dur` long event): the volcano shot, then one shot per stretch
 * of the island; each special space in a stretch gets a meteor, one after another.
 *   shots: [{ kind: 'volcano', t0, t1 }, { kind: 'stretch', t0, t1, idx: [space indexes hit], hits: [{ idx, t: landing time }] } ...]
 */
export function eruptionSchedule(dur, stretches, isSpecial, ranges) {
  const vol = Math.min(3600, dur * 0.36), each = (dur - vol) / Math.max(1, stretches.length), fall = METEOR_LAND / ERUPTION_FPS * 1000;
  const shots = [{ kind: 'volcano', t0: 0, t1: vol, blow: vol * 0.42 }];
  stretches.forEach((s, k) => {
    const [a, b] = ranges[s], t0 = vol + k * each, t1 = t0 + each, idx = [];
    for (let i = a; i <= b; i++) if (isSpecial(i)) idx.push(i);
    const gap = idx.length > 1 ? Math.min(330, (each - fall - 700) / (idx.length - 1)) : 0;
    shots.push({ kind: 'stretch', stretch: s, from: a, to: b, t0, t1, idx, hits: idx.map((i, j) => ({ idx: i, t: t0 + 350 + fall + j * gap })) });
  });
  return shots;
}
