// Mii-style little people, built from simple shapes. Facing +z. The head is a separate piece so it can tip up
// to look at the camera.
import { MeshBuilder, mix, shade } from './meshBuilder.js';

export const SKINS = ['#ffd9b8', '#f4c49a', '#e0a878', '#ffe3c8', '#c98a5e', '#f7cfa6'];
// one look per player slot (hair colour, style) so the six players are easy to tell apart
export const HAIR = [
  { c: '#6b4226', style: 'short' }, { c: '#1f1a17', style: 'spiky' }, { c: '#e8c24a', style: 'long' },
  { c: '#a0442a', style: 'bun' }, { c: '#2a2a35', style: 'long' }, { c: '#8d8d96', style: 'short' },
];
export const MII_HEIGHT = 3.35;
// How big the players stand on the board: matched to the Wii game, where a Mii is a little under two-thirds of the way
// from one space's centre to the next. Build 82: 0.66 with Wii Party's own body (the head about a sixth of a space wide).
export const PAWN_SCALE = 0.76; // the Miis as big, next to a space, as in Wii Party (measured against the gameplay video: a Mii stands about 0.55 of a space's width tall)
export const MII_NECK = 1.85; // head pivot height

export const LEG_PIVOT = { x: 0.27, y: 0.9, z: 0 };   // hips (x is mirrored)
export const ARM_PIVOT = { x: 0.6, y: 1.62, z: 0 };   // shoulders (x is mirrored)

/**
 * {body, head, legs, arms}. head is built around its own origin = the neck. Legs and arms are built around their own
 * joints (hip, shoulder) so a pawn can swing them; with `parts: false` they are merged into `body` in a fixed pose.
 */
export function buildMii({ shirt = '#2f6fed', pants = '#35508f', hair = HAIR[0], skin = SKINS[0], cheer = false, parts = false } = {}, rng = Math.random) {
  const body = new MeshBuilder(), head = new MeshBuilder();
  const dark = '#1b1414', skinD = shade(skin, 0.86);
  const legs = [], arms = [];
  for (const s of [-1, 1]) { // legs and shoes, hanging from the hip
    const l = new MeshBuilder();
    l.lathe([[0.2, -0.7], [0.23, 0.02]], 8, pants);
    l.sphere(0.25, pants, { y: 0.0 }, 8, 5);
    l.sphere(0.27, '#3a2a22', { y: -0.7, z: 0.1, sx: 1, sy: 0.7, sz: 1.35 }, 8, 5);
    legs.push(l);
  }
  // torso: a soft barrel in the shirt colour, a lighter collar band
  body.lathe([[0.0, 0.8], [0.52, 0.82], [0.62, 1.15], [0.55, 1.65], [0.34, 1.85], [0.0, 1.88]], 12, shirt, {}, true);
  body.lathe([[0.36, 1.83], [0.3, 1.9]], 10, shade(shirt, 1.25));
  // arms: hanging at the sides, or both thrown up when cheering. Each has a round shoulder so the joint is closed.
  for (const s of [-1, 1]) {
    const ang = cheer ? 2.75 : 0.22, dx = s * Math.sin(ang), dy = -Math.cos(ang), a = new MeshBuilder();
    a.sphere(0.27, shirt, { x: -s * 0.04 }, 9, 6);
    a.lathe([[0.17, 0], [0.2, 0.78]], 7, shirt, { rz: Math.PI + s * ang });
    a.sphere(0.21, skin, { x: dx * 0.8, y: dy * 0.8, z: 0 }, 8, 6);
    arms.push(a);
  }
  if (!parts) {
    [-1, 1].forEach((s, i) => {
      body.add(legs[i], { x: s * LEG_PIVOT.x, y: LEG_PIVOT.y });
      body.add(arms[i], { x: s * ARM_PIVOT.x, y: ARM_PIVOT.y });
    });
  }
  // head (around the neck pivot)
  const hy = 0.72;
  head.sphere(0.78, skin, { y: hy, sx: 1.08, sy: 1.0, sz: 1.0 }, 14, 10);
  for (const s of [-1, 1]) {
    head.sphere(0.13, skinD, { x: s * 0.82, y: hy - 0.02, z: 0, sx: 0.6 }, 6, 5); // ears
    head.sphere(0.075, dark, { x: s * 0.27, y: hy + 0.06, z: 0.73, sx: 0.85, sy: 1.7, sz: 0.5 }, 7, 5); // eyes
    head.box(0.28, 0.05, 0.05, shade(hair.c, 0.8), { x: s * 0.27, y: hy + 0.3, z: 0.7, rz: s * -0.12 }); // brows
  }
  head.sphere(0.09, skinD, { y: hy - 0.1, z: 0.8, sx: 1, sy: 0.8, sz: 0.8 }, 6, 5); // nose
  head.box(0.3, 0.05, 0.05, '#7a2f2f', { y: hy - 0.36, z: 0.7 }); // smile
  head.box(0.09, 0.05, 0.05, '#7a2f2f', { x: -0.17, y: hy - 0.32, z: 0.7, rz: 0.6 });
  head.box(0.09, 0.05, 0.05, '#7a2f2f', { x: 0.17, y: hy - 0.32, z: 0.7, rz: -0.6 });
  // hair
  const hc = hair.c;
  head.sphere(0.83, hc, { y: hy + 0.18, z: -0.1, sx: 1.08, sy: 0.78, sz: 1.0 }, 12, 8);          // cap of hair over the top/back
  if (hair.style === 'spiky') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; head.cyl(0.2, 0, 0.55, 6, hc, { x: Math.cos(a) * 0.45, y: hy + 0.72, z: Math.sin(a) * 0.45 - 0.05, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }); }
  if (hair.style === 'long') { head.sphere(0.72, hc, { y: hy - 0.25, z: -0.38, sx: 1.12, sy: 1.15, sz: 0.55 }, 10, 7); }
  if (hair.style === 'bun') head.sphere(0.3, hc, { y: hy + 0.98, z: -0.05 }, 8, 6);
  if (hair.style === 'short') head.sphere(0.42, hc, { y: hy + 0.5, z: 0.4, sx: 1.4, sy: 0.55, sz: 0.8 }, 8, 5); // fringe
  return { body, head, legs, arms };
}

/** One merged builder with a whole standing Mii (for the crowd). */
export function addMii(builder, o, look, rng) {
  const { body, head } = buildMii(look, rng);
  builder.add(body, o);
  const ry = o.ry || 0, s = o.s ?? 1;
  builder.add(head, { ...o, y: (o.y || 0) + MII_NECK * s, ry });
}
