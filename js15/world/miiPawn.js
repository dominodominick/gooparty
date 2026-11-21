// A player on the board: their Mii. The head is the real Mii head, drawn by FFL (the Mii renderer the Mii creator
// uses, loaded from mii/ffl/ when the creator's files are there; see miiHead.js); until it has loaded, or when it
// can't (the single-file download has no creator files), a simple head stands in. The body is the game's own
// (it swings its arms and legs from the shoulders and hips), in the Mii's favourite colour, as tall and as wide as
// the Mii is.
import { buildMii, HAIR, SKINS, MII_NECK, LEG_PIVOT, ARM_PIVOT } from './miis.js';
import { builderMesh } from './worldBuild.js';
import { FAVORITE_COLORS, SKIN_COLORS } from './miic.js';

export const MII_PANTS = '#3c4152';          // Mii trousers: the same dark grey-blue for everyone, as on the Wii
// The FFL head is in the Mii renderer's units (about 92 wide); this makes it the size of the game's head.
export const FFL_HEAD_SCALE = 0.0185;
export const FFL_HEAD_LIFT = 0.16;           // its origin (the neck joint) a little above the shoulders

/** How tall and how wide a Mii stands (height and build are 0..127; 64 is the middle). Kept gentle, so every player still fits a space. */
export function bodyScale(mii) {
  const h = mii && mii.height != null ? mii.height / 127 : 0.5, b = mii && mii.build != null ? mii.build / 127 : 0.5;
  return { y: 0.84 + 0.32 * h, xz: 0.84 + 0.34 * b };
}

/**
 * The figure: { group, head (the neck pivot), legs, arms }. `mii` is a parsed Mii (miic.parseMii) or null (then the
 * slot's own stand-in look). The arms and legs hang from pivots inside `fig`, which carries the height and build.
 */
export function makeFigure(T, slot, mii) {
  const shirt = mii ? FAVORITE_COLORS[mii.favoriteColor] : null, skin = mii ? SKIN_COLORS[mii.skin] || SKINS[0] : SKINS[slot % SKINS.length];
  const { body, head, legs, arms } = buildMii({ shirt: shirt || '#2f6fed', pants: MII_PANTS, hair: HAIR[slot % HAIR.length], skin, parts: true });
  const g = new T.Group(), fig = new T.Group(), sc = bodyScale(mii);
  fig.scale.set(sc.xz, sc.y, sc.xz);
  g.add(fig);
  fig.add(builderMesh(T, body));
  const L = [], A = [];
  [-1, 1].forEach((sgn, i) => {
    const lg = new T.Group(); lg.position.set(sgn * LEG_PIVOT.x, LEG_PIVOT.y, 0); lg.add(builderMesh(T, legs[i])); fig.add(lg); L.push(lg);
    const ag = new T.Group(); ag.position.set(sgn * ARM_PIVOT.x, ARM_PIVOT.y, 0); ag.add(builderMesh(T, arms[i])); fig.add(ag); A.push(ag);
  });
  const headGroup = new T.Group(); // tips up to look at the camera while rolling; pivots at the neck (not scaled with the body: Mii heads are all one size)
  headGroup.position.set(0, MII_NECK * sc.y, 0);
  const stand = builderMesh(T, head); stand.userData.standIn = true;
  headGroup.add(stand);
  g.add(headGroup);
  return { group: g, fig, head: headGroup, legs: L, arms: A, standIn: stand };
}

/** Put a real Mii head (FFL's CharModel meshes) on a figure's neck, in place of the stand-in. */
export function fitFFLHead(headGroup, meshes) {
  for (const c of headGroup.children) if (c.userData && c.userData.standIn) c.visible = false;
  const old = headGroup.children.find((c) => c.userData && c.userData.ffl);
  if (old) headGroup.remove(old);
  const holder = meshes;
  holder.userData.ffl = true;
  holder.scale.setScalar(FFL_HEAD_SCALE);
  holder.position.set(0, FFL_HEAD_LIFT, 0);
  headGroup.add(holder);
  return holder;
}
