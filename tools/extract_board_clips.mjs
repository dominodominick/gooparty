// The Wii Party clips Board Game Island uses that are not among the page's own (pm000, pm001 and the game's named
// ones): the board idles, the 1 vs 1 pose, the vine, the punches and kicks, the summit's victory... copied out of
// mii/clips/more-clips.json into js15/world/boardClips.js so the board has them without the 6 MB file.
//   node tools/extract_board_clips.mjs
import fs from 'node:fs';
const more = JSON.parse(fs.readFileSync(new URL('../mii/clips/more-clips.json', import.meta.url), 'utf8')).clips;
const NEED = ['pm011_08', 'pm011_06', 'pm011_12', 'pm405_01', 'pm405_02', 'pm405_04', 'pm405_09', 'pm434_01', 'pm434_02', 'pm301_02', 'pm301_04', 'pm441_03', 'pm441_04'];
const out = Object.fromEntries(NEED.map((n) => { if (!more[n]) throw new Error(`no ${n}`); return [n, more[n]]; }));
fs.writeFileSync(new URL('../js15/world/boardClips.js', import.meta.url),
  `// Made by tools/extract_board_clips.mjs from mii/clips/more-clips.json: the clips Board Game Island uses that the page\n// would not have otherwise (see the trace of the real game: tools/trace_to_sequences.mjs).\nexport const BOARD_CLIPS = ${JSON.stringify(out)};\n`);
console.log(Object.keys(out).length, 'clips');
