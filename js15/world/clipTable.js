// Every Mii clip a sequence can use, by name: the game's own names ('idle', 'punch'...), and every Wii Party clip by its
// code ('pm001_06', 'pm301_03'...). pm000 and pm001 are in the page; the rest (other boards' and the minigames') are in
// mii/clips/more-clips.json, loaded the first time one is needed. The board's pawns pose from this table.
import { WP_MII } from './wpMiiData.js';
import { ALL_CLIPS } from './wpMiiAllClips.js';
import { BOARD_CLIPS } from './boardClips.js';
import { MII_BASE } from './miiHead.js';

export const CLIP_TABLE = { ...ALL_CLIPS, ...BOARD_CLIPS, ...WP_MII.clips };
for (const [name, code] of Object.entries(WP_MII.source || {})) if (!CLIP_TABLE[code]) CLIP_TABLE[code] = WP_MII.clips[name]; // (the game's named clips, by code too)

let more = null;
/** Load the rest of the clips (once); resolves to whether they are in. */
export function loadMoreClips() {
  if (!more) more = typeof fetch !== 'function' ? Promise.resolve(false)
    : fetch(`${MII_BASE}clips/more-clips.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.clips) { for (const [k, v] of Object.entries(j.clips)) if (!CLIP_TABLE[k]) CLIP_TABLE[k] = v; return true; } return false; }).catch(() => false);
  return more;
}
/** A clip's length in frames (0 if it is not in, yet: then it is asked for). */
export function clipLength(name) {
  const C = CLIP_TABLE[name];
  if (!C && /^pm\d{3}_\d{2}$/.test(name || '')) loadMoreClips();
  return C ? C.frames : 0;
}
/** The game's name for a clip code, if it has one ('pm301_03' -> 'punch'). */
export const nameOfCode = Object.fromEntries(Object.entries(WP_MII.source || {}).map(([n, c]) => [c, n]));
