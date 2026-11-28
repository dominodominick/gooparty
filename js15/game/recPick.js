// Which recording of the real game a moment plays (js15/scenes/replay.js), and how long it is: the host times the
// moment by it (the index is bundled with the game; the recordings themselves are fetched).
import { REC_INDEX } from './recIndex.js';

const num = (s) => (s ? Number(s.slice(1)) : NaN);
/**
 * The best recording of `key` for a moment from space `from` to `to` ('I12', 'V3'; to may be null), and, when it has
 * another Mii in it (the UFO), where that one starts: the same spaces first, then the same start, then the same end, then
 * the nearest distance. -1 if there is none. The same answer everywhere (the host and every screen).
 */
export function pickRecording(key, from, to = null, otherFrom = null) {
  const L = REC_INDEX[key];
  if (!L || !L.length) return -1;
  let best = -1, bs = Infinity;
  L.forEach((e, i) => {
    let s = (e[0] === from ? 0 : 4) + (to == null || e[1] === to ? 0 : 2) + (otherFrom == null || e[3] === otherFrom ? 0 : 1);
    if (from && to && e[0] && e[1] && from[0] === e[0][0]) s += Math.abs((num(to) - num(from)) - (num(e[1]) - num(e[0]))) * 0.25;
    if (!e[0]) s += 0.5; // (a recording whose start was not on a space: last)
    if (s < bs) { bs = s; best = i; }
  });
  return best;
}
/** The length (ms) of the recording a moment plays, or `fallback` if there is none. */
export function recordingMs(key, from, to, fallback, otherFrom = null) {
  const i = pickRecording(key, from, to, otherFrom);
  return i < 0 ? fallback : Math.round(REC_INDEX[key][i][2] * 1000);
}
