// A player on the board: their Mii. The head is the real Mii head, drawn by FFL (the Mii renderer the Mii creator
// uses, loaded from mii/ffl/ when the creator's files are there; see miiHead.js); until it has loaded, or when it
// can't (the single-file download has no creator files), a simple head stands in. The body is the creator's Wii U
// Mii body (miiBody.js), in the Mii's favourite colour. Every player is the same height and build.
import { buildMii, HAIR, SKINS, MII_NECK } from './miis.js';
import { makeBody, BODY_NECK, BODY_HEAD_SCALE } from './miiBody.js';
import { builderMesh } from './worldBuild.js';
import { FAVORITE_COLORS, SKIN_COLORS } from './miic.js';

export const MII_PANTS = '#3c4152';          // Mii trousers: the same dark grey-blue for everyone, as on the Wii

/**
 * How tall and how wide a Mii stands on the board: always the same. A Mii's own height and weight (from the creator)
 * are not used in the game; every player is the same size, as in Wii Party.
 */
export function bodyScale() { return { y: 1, xz: 1 }; }

/**
 * The figure: { group, head (the neck pivot, which tips to look up), legs, arms }. `mii` is a parsed Mii
 * (miic.parseMii) or null (then the slot's own stand-in look). The body is the creator's Wii U Mii body (miiBody.js),
 * scaled so its neck is where the old pawn's was; arms and legs are turned through `rotation.x`, as the old pivots were.
 */
export function makeFigure(T, slot, mii) {
  const shirt = mii ? FAVORITE_COLORS[mii.favoriteColor] : ['#2f6fed', '#e23b3b', '#2fb34a', '#f2b81d', '#9a4fd6', '#ff8a1f'][slot % 6];
  const body = makeBody(T, mii ? mii.gender : slot % 2, { shirt, pants: MII_PANTS });
  const g = new T.Group(), sc = bodyScale(mii), k = MII_NECK / BODY_NECK; // (body units -> the game's)
  body.root.scale.set(k * sc.xz, k * sc.y, k * sc.xz);
  g.add(body.root);
  const limb = (fn, i) => { let x = 0; return { rotation: { get x() { return x; }, set x(v) { if (v !== x) { x = v; fn(i, v); } } } }; };
  const L = [limb(body.setLeg, 0), limb(body.setLeg, 1)], A = [limb(body.setArm, 0), limb(body.setArm, 1)];
  const headGroup = new T.Group(); // tips up to look at the camera while rolling; pivots at the neck. Mii heads are all one size: undo the body's height and build
  headGroup.scale.set(1 / sc.xz, 1 / sc.y, 1 / sc.xz);
  body.head.add(headGroup);
  // until the real head has loaded (or without the Mii renderer): a simple head, in the old pawn's units
  const { head } = buildMii({ shirt, pants: MII_PANTS, hair: HAIR[slot % HAIR.length], skin: mii ? SKIN_COLORS[mii.skin] || SKINS[0] : SKINS[slot % SKINS.length], parts: true });
  const stand = builderMesh(T, head); stand.userData.standIn = true; stand.scale.setScalar(1 / k); stand.position.y = -0.1 / k;
  headGroup.add(stand);
  return { group: g, body, head: headGroup, legs: L, arms: A, standIn: stand };
}

/** Put a real Mii head (FFL's CharModel meshes) on a figure's neck, in place of the stand-in. */
export function fitFFLHead(headGroup, meshes) {
  for (const c of headGroup.children) if (c.userData && c.userData.standIn) c.visible = false;
  const old = headGroup.children.find((c) => c.userData && c.userData.ffl);
  if (old) headGroup.remove(old);
  const holder = meshes;
  holder.userData.ffl = true;
  holder.scale.setScalar(BODY_HEAD_SCALE); // (in the body's units, as the creator puts it on)
  holder.position.set(0, 0, 0);
  headGroup.add(holder);
  return holder;
}
