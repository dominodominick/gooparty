// The real Board Game Island's own timings, read off a trace of the real game (the owner's Wii Party recomp: every clip
// a Mii or a map model played, every face, and the camera, each with its time; see the project notes). Seconds, from
// the start of each set piece. The set pieces (boardScene.js, challengeFx.js) and the host's durations (boardGame.js)
// are built from these, so a Mii's clips, the models and the camera happen when they do in the real game.

/** The springs. Flight time goes with the distance: about 0.18 s a space forward, 0.2 s back. The spring itself is the
 * game's own model and animation (world/spring.js): it fires `wind` s after its animation starts. */
export const SPRING = {
  // +4/+5/+6 (blue) and the green one after winning a minigame: the spring pops up (pm001_15), they wind up on it
  // (pm001_08), fly (pm001_09), land and cheer (pm001_10), pump a fist with a smile (pm001_06), stand (pm011_08)
  fwd: { rise: 0.30, wind: 1.10, perSpace: 0.179, cheer: 1.19, pump: 1.40, rest: 1.18 },
  // back: the -4 spring (the red one) and the one after losing a 1 vs 1: up (pm001_15), wind up (pm001_08), flung back
  // (pm001_11), land (pm001_12), get up (pm206_03), hang their head with sorrow (pm001_07), stand
  back: { rise: 0.33, wind: 1.21, perSpace: 0.203, land: 0.57, getUp: 0.62, letdown: 1.48, rest: 1.19 },
  // the skull space's red spring (the map's own m001_81, not the -4 one): it pops up under them and they are startled
  // (pm001_15 with Surprise) while it winds itself up, then flung (pm001_11), land (pm001_12), get up (pm206_03), and the
  // rest as the one back. (Not used yet: the skull drops them into the volcano its own way.)
  red: { rise: 1.90, wind: 0, perSpace: 0.200, land: 0.70, getUp: 0.67, letdown: 1.55, rest: 1.20 },
};
/** A spring's whole length (s) for a flight of n spaces. */
export function springSecs(kind, n) {
  const S = SPRING[kind], fly = Math.max(1, n) * S.perSpace;
  return kind === 'fwd' ? S.rise + S.wind + fly + S.cheer + S.pump + S.rest : S.rise + S.wind + fly + S.land + S.getUp + S.letdown + S.rest;
}

/**
 * The statues. Blue: it wakes (its clip at 1.2x), its flat hands come round and wait while the Mii hops on (pm405_02)
 * and stands (pm011_08); the throw starts, the Mii is flung (pm405_09, smiling), lands on the platform (pm001_09),
 * cheers (pm001_10), runs down onto the space (pm000_04, pm000_03) and pumps a fist (pm001_06).
 * Red: it wakes and its hands close round the Mii (pm001_03 with Surprise, pm001_02), carry them over its head and
 * throw them (pm001_01); they land on their bottom (pm001_05), get up (pm206_03), walk down and hang their head (pm001_07).
 */
export const STATUE = {
  blue: { speed: 1.2, launchAt: 4.421, hop: [4.438, 4.687], launchGo: 6.258, release: 7.392, land: 10.894, walk: 12.397, walkEnd: 13.063, end: 16.116 },
  red: { speed: 1.2, release: 4.837, land: 8.358, getUp: 9.859, walk: 11.026, walkEnd: 11.693, end: 14.830 },
};

/**
 * Smashing the dragon wall and the summit gate: each blow's clip and when it starts (pm301_04 kick, pm301_02 / 03 punches,
 * pm301_05 the big kick), the stance (pm301_01), when the wall or gate breaks (the map model's break clip), when the
 * camera cuts to the way on, the fist pump (dragon), and the end.
 */
export const SMASH_REAL = {
  dragon: { blows: [[0, 'pm301_04'], [0.534, 'pm301_02'], [0.934, 'pm301_03'], [1.334, 'pm301_04']], stance: 1.869, breakAt: 2.386, idle: 4.388, cut: 4.455, cheer: 4.759, rest: 6.154, end: 7.391 },
  final: { blows: [[0, 'pm301_02'], [0.402, 'pm301_03'], [0.802, 'pm301_04'], [1.336, 'pm301_05'], [1.870, 'pm301_02'], [2.269, 'pm301_04']], stance: 2.817, breakAt: 3.338, idle: 5.372, cut: 5.476, cheer: null, rest: null, end: 5.476 },
};

/** The dragon's fireball: they look round (pm001_02), it spits (the wall's clip at 0.86 s) and hits them at 1.39 s; they
 * are flung back (pm001_11, Surprise), land (pm001_12) and sit dazed (pm001_05) until it ends. */
export const FIREBALL = { spit: 0.859, hit: 1.393, air: 0.602, land: 0.518, sit: 3.318 };

/** The real board camera's reaction close-up: in 0.23 s after the reaction clip starts, held 2.42 s (boardCamera.js). */
export const REACT_CAM = { at: 0.23, hold: 2.42 };
export const STATUE_FLIGHT = { // the flight, 15 samples a second from the release to the landing (world units): where the real camera looked, less 1.76 (it looks at the Mii's middle)
  blue: [[-2.32, 20.81, -64.28], [-1.92, 26.91, -63.4], [-0.38, 35.38, -60.03], [0.89, 42.04, -57.27], [2.14, 48.62, -54.51], [3.4, 55.11, -51.77], [4.65, 61.48, -49.04], [5.89, 67.71, -46.32], [7.12, 73.77, -43.62], [8.35, 79.64, -40.94], [9.56, 85.31, -38.29], [10.76, 90.75, -35.66], [11.95, 95.94, -33.05], [13.13, 100.87, -30.48], [14.29, 105.51, -27.93], [15.44, 109.86, -25.42], [16.57, 113.88, -22.95], [17.69, 117.58, -20.51], [18.78, 120.94, -18.12], [19.85, 123.94, -15.76], [20.91, 126.57, -13.46], [21.94, 128.84, -11.2], [22.95, 130.72, -8.98], [23.94, 132.21, -6.82], [24.91, 133.3, -4.72], [25.84, 134.0, -2.66], [26.76, 134.3, -0.66], [27.42, 134.25, 0.8], [28.29, 133.85, 2.69], [29.33, 132.78, 4.97], [29.94, 131.84, 6.29], [30.91, 129.78, 8.41], [31.65, 127.7, 10.04], [32.36, 125.25, 11.59], [32.87, 123.16, 12.71], [33.68, 119.24, 14.49], [34.15, 116.62, 15.5], [34.74, 112.84, 16.79], [35.29, 108.73, 18.01], [35.81, 104.32, 19.14], [36.3, 99.6, 20.21], [36.75, 94.62, 21.2], [37.16, 89.37, 22.1], [37.54, 83.89, 22.93], [37.97, 76.72, 23.86], [38.19, 72.27, 24.35], [38.46, 66.19, 24.94], [38.69, 59.95, 25.45], [38.89, 53.57, 25.88], [39.08, 45.45, 26.3], [39.17, 40.51, 26.48], [39.25, 33.87, 26.66], [39.29, 27.19, 26.76], [39.3, 25.51, 26.77]],
  red: [[49.96, 24.5, 23.21], [49.17, 30.82, 22.09], [47.24, 37.23, 19.34], [45.28, 43.59, 16.55], [43.33, 49.88, 13.77], [41.39, 56.07, 11.0], [39.45, 62.15, 8.25], [37.53, 68.08, 5.5], [35.62, 73.85, 2.78], [33.72, 79.43, 0.08], [31.84, 84.82, -2.6], [29.98, 89.97, -5.26], [28.59, 93.68, -7.23], [26.31, 99.53, -10.49], [24.95, 102.83, -12.42], [22.73, 107.97, -15.59], [21.41, 110.82, -17.47], [19.25, 115.17, -20.55], [17.98, 117.52, -22.36], [16.3, 120.36, -24.75], [14.26, 123.4, -27.67], [12.65, 125.42, -29.95], [11.48, 126.68, -31.63], [9.56, 128.31, -34.36], [8.06, 129.18, -36.49], [6.97, 129.58, -38.05], [5.55, 129.75, -40.08], [4.5, 129.63, -41.56], [2.82, 128.93, -43.96], [1.84, 128.21, -45.36], [0.58, 126.91, -47.16], [-0.64, 125.23, -48.9], [-2.1, 122.59, -50.98], [-2.94, 120.72, -52.17], [-4.02, 117.92, -53.71], [-5.29, 113.91, -55.52], [-6.02, 111.25, -56.56], [-6.94, 107.41, -57.88], [-7.82, 103.25, -59.13], [-8.64, 98.78, -60.29], [-9.4, 94.03, -61.38], [-10.12, 89.0, -62.4], [-10.77, 83.72, -63.34], [-11.38, 78.2, -64.19], [-11.92, 72.46, -64.97], [-12.41, 66.53, -65.67], [-12.84, 60.42, -66.28], [-13.22, 54.16, -66.82], [-13.53, 47.77, -67.27], [-13.79, 41.27, -67.63], [-13.99, 34.68, -67.92], [-14.13, 28.03, -68.12], [-14.22, 21.34, -68.24], [-14.23, 17.99, -68.27]],
};
