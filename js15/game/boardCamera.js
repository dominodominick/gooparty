// The real Board Game Island's board camera, measured from a trace of the real game (the owner's Wii Party recomp:
// see tools/trace_to_sequences.mjs and the project notes). It is not a free chase camera: every space has its own
// shot, set by the game's designers, that the camera eases between as a Mii runs along:
//   follow    the space's shot: [distance, pitch, yaw] (game units, degrees; yaw is the way from the target to the
//             camera, atan2(x, z)), looking at a point 160 above the Mii (wherever they are, in the air too)
//   turn      while the die spins: 500 away at 35 degrees, the same way as the space's follow shot
//   react     a Mii landing and reacting (pm001_06 with a smile, pm001_07 with sorrow): cut to 400 away, at the
//             space's pitch, 150 degrees round from the follow shot (a three-quarter view of their face). It cuts in
//             0.23 s after the reaction starts and holds 2.42 s, then cuts back (REACT.at, REACT.hold; 30+ times in the trace)
//   blends    the follow shot moves with the Mii along the path (no lag); turn <-> follow blends in a straight line over 1 s
// Game units are 0.016 of ours (the same map: the start space is (-1500, 30, 6280) there, (-24, 0.48, 100.48) here).

export const GAME_UNIT = 0.016;
export const TARGET_UP = 160;
export const TURN = { d: 500, p: 35 };
export const REACT = { d: 400, turn: -150, at: 0.23, hold: 2.42 };

/** The follow shot of each island space: [distance, pitch, yaw]. (Spaces the trace never settled on are in between their neighbours.) */
export const SPACE_SHOTS = [
  [720, 5, 2],
  [720, 5, 2],
  [720, 5, 2],
  [720, 5, 2],
  [750, 7, -1],
  [780, 9, -4],
  [883, 11, 9],
  [987, 13, 23],
  [1090, 15, 36],
  [1090, 15, 26],
  [1090, 15, 15],
  [1090, 15, 4],
  [1090, 15, -6],
  [1090, 15, -17],
  [980, 15, -28],
  [870, 15, -40],
  [855, 10.5, -34],
  [840, 6, -29],
  [840, 6, -38],
  [840, 6, -46],
  [840, 6, -48],
  [840, 6, -51],
  [885, 10.5, -59],
  [930, 15, -67],
  [855, 12.5, -76],
  [780, 10, -84],
  [780, 10, -86],
  [780, 10, -87],
  [780, 10, -88],
  [780, 10, -90],
  [820, 10, -105],
  [860, 10, -120],
  [940, 10, -137],
  [1020, 16.5, -147],
  [1100, 23, -157],
  [1083, 21.3, -150],
  [1067, 19.7, -143],
  [1050, 18, -136],
  [990, 16, -153],
  [1100, 23, -123],
  [920, 20, 66],
  [953, 23, 91],
  [987, 26, 116],
  [1020, 29, 141],
  [1050, 20, 144],
  [1080, 11, 146],
  [1013, 16.3, 116],
  [947, 21.7, 86],
  [880, 27, 56],
  [840, 35, 34],
  [900, 10, 85],
  [960, 27, 75],
  [1020, 11, 59],
  [1080, 11, 45],
  [1080, 11, 37],
  [1080, 11, 28],
  [1080, 11, -40],
  [1080, 11, 12],
  [1080, 23, 5],
  [1180, 14, -8],
  [1290, 29, -21],
  [1342, 27.5, -35],
  [1395, 26, -50],
  [1448, 24.5, -64],
  [1500, 23, -78],
  [1500, 23, -86],
  [1500, 23, -94],
  [1500, 23, -101],
  [1500, 23, -93],
  [1500, 23, -84],
  [1500, 23, -76],
  [1360, 18.7, -92],
  [1220, 14.3, -107],
  [1080, 10, -123],
  [1080, 10, -182],
  [1080, 10, 119],
  [1080, 10, 103],
  [1080, 10, 87],
  [840, 5, 44],
  [600, 0, 0],
];

const lerpAngle = (a, b, u) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;

/** The follow shot at a place along the island path (index i, and u of the way to the next space). */
export function followAt(i, u = 0) {
  const a = SPACE_SHOTS[Math.max(0, Math.min(SPACE_SHOTS.length - 1, i))], b = SPACE_SHOTS[Math.max(0, Math.min(SPACE_SHOTS.length - 1, i + 1))];
  return { d: a[0] + (b[0] - a[0]) * u, p: a[1] + (b[1] - a[1]) * u, yaw: lerpAngle(a[2], b[2], u) };
}

/** A preset shot ('follow', 'turn' or 'react') at a place along the path. */
export function presetAt(name, i, u = 0) {
  const f = followAt(i, u);
  if (name === 'turn') return { d: TURN.d, p: TURN.p, yaw: f.yaw };
  if (name === 'react') return { d: REACT.d, p: f.p, yaw: f.yaw + REACT.turn };
  return f;
}

/** Camera position and the point it looks at, in our units, for a shot {d, p, yaw} at a Mii standing at (x, y, z). */
export function shotAround(x, y, z, s) {
  const ty = y + TARGET_UP * GAME_UNIT, d = s.d * GAME_UNIT, p = s.p * Math.PI / 180, w = s.yaw * Math.PI / 180;
  return { x: x + d * Math.cos(p) * Math.sin(w), y: ty + d * Math.sin(p), z: z + d * Math.cos(p) * Math.cos(w), tx: x, ty, tz: z };
}

/** Where a point is along the island path: the nearest stretch (i to i + 1) and how far along it (u). */
export function placeOnPath(P, x, z, near = null) {
  let best = { i: 0, u: 0, d: Infinity };
  const from = near == null ? 0 : Math.max(0, near - 3), to = near == null ? P.length - 1 : Math.min(P.length - 1, near + 3);
  for (let i = from; i < to; i++) {
    const a = P[i], b = P[i + 1], vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L)), px = a.x + vx * u, pz = a.z + vz * u, d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best.d) best = { i, u, d };
  }
  return best;
}
