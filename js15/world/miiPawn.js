// A player on the board: their Mii. The head is the real Mii head, drawn by FFL (the Mii renderer the Mii creator
// uses, loaded from mii/ffl/ when the creator's files are there; see miiHead.js); until it has loaded, or when it
// can't (the single-file download has no creator files), a simple head stands in. The body is Wii Party's own Mii
// body in Board Game Island's explorer suit, played with Wii Party's own Mii animations (wpMii.js), the suit in the player's colour, the hands, legs and neck in
// the Mii's skin colour. Every player is the same height and build.
import { buildMii, HAIR, SKINS, MII_NECK } from './miis.js';
import { makeWpBody, WP_NECK } from './wpMii.js';
import { WP_MII } from './wpMiiData.js';
import { PLAYER_COLORS } from '../config.js';
import { builderMesh } from './worldBuild.js';
import { FAVORITE_COLORS, SKIN_COLORS } from './miic.js';

export const MII_PANTS = '#3c4152';          // Mii trousers: the same dark grey-blue for everyone, as on the Wii

/**
 * How tall and how wide a Mii stands on the board: always the same. A Mii's own height and weight (from the creator)
 * are not used in the game; every player is the same size, as in Wii Party.
 */
export function bodyScale() { return { y: 1, xz: 1 }; }

/**
 * The figure: { group, body (the Wii Party body: pose(clip, frame)), head (the neck pivot, which tips to look up) }.
 * `mii` is a parsed Mii (miic.parseMii) or null (then the slot's own stand-in look). The body is scaled so its neck is
 * where the old pawn's was.
 */
export function makeFigure(T, slot, mii) {
  const shirt = PLAYER_COLORS[slot % PLAYER_COLORS.length].hex; // the player's colour (player 1 blue, 2 red, ...), whatever the Mii's favourite colour, as in Wii Party
  const skin = mii ? SKIN_COLORS[mii.skin] || SKINS[0] : SKINS[slot % SKINS.length];
  const body = makeWpBody(T, WP_MII, { shirt, pants: MII_PANTS, skin });
  const g = new T.Group(), k = MII_NECK / WP_NECK; // (Wii Party's units -> the game's)
  body.root.scale.setScalar(k);
  g.add(body.root);
  body.pose('idle', 0);
  const headGroup = new T.Group(); // tips up to look at the camera while rolling; pivots at the neck
  body.bones.hook_head.add(headGroup);
  // until the real head has loaded (or without the Mii renderer): a simple head, in the old pawn's units
  const { head } = buildMii({ shirt, pants: MII_PANTS, hair: HAIR[slot % HAIR.length], skin, parts: true });
  const stand = builderMesh(T, head); stand.userData.standIn = true; stand.scale.setScalar(1 / k); stand.position.y = -0.1 / k;
  headGroup.add(stand);
  return { group: g, body, head: headGroup, standIn: stand };
}

/** Put a real Mii head (FFL's CharModel meshes) on a figure's neck, in place of the stand-in. */
export function fitFFLHead(headGroup, meshes) {
  for (const c of headGroup.children) if (c.userData && c.userData.standIn) c.visible = false;
  const old = headGroup.children.find((c) => c.userData && c.userData.ffl);
  if (old) headGroup.remove(old);
  const holder = meshes;
  holder.userData.ffl = true;
  holder.scale.setScalar(1); // (FFL's units are Wii Party's: the head fits the body as it is)
  holder.position.set(0, 0, 0);
  headGroup.add(holder);
  return holder;
}
