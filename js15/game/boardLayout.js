// Where everything is on the real Board Game Island map (assets/board-game-island). Pure maths, no Three.js.
// The numbers come from boardMap.js, which tools/gen_board_map.py generates from board.json and island.glb.
// World units: Wii units x MAP_SCALE, Y up. The volcano's inside is its own model; it is parked far to the side.
import { BOARD_MAP } from './boardMap.js';
import { GAPS } from './boardData.js';

export const MAP_SCALE = 0.016;                          // one space step is about 4.5 world units
export const VOLCANO_OFFSET = { x: 700, y: 0, z: 0 };    // where the volcano interior model is put in the scene
export const VOLCANO_CENTER = { x: VOLCANO_OFFSET.x, z: VOLCANO_OFFSET.z };
export const ISLAND_CENTER = { x: 0, z: 0 };
export const BRIDGE_AFTER = 16;                          // the rope bridge lies between the map's spaces 15 and 16 (stops 16 and 17)

const S = MAP_SCALE;
/** The rope bridge's planks: world position and facing of each. */
export const BRIDGE_PLANKS = (BOARD_MAP.bridge || []).map((q) => ({ x: q.p[0] * S, y: q.p[1] * S, z: q.p[2] * S, yaw: q.yaw }));
const sc = (p, off) => ({ x: p[0] * S + (off ? off.x : 0), y: p[1] * S + (off ? off.y : 0), z: p[2] * S + (off ? off.z : 0) });

/** Builds one track: its nodes (with facing), and the waypoints between neighbours. */
function buildTrack(raw, viaRaw, off) {
  const pts = raw.map((p) => sc(p, off));
  const via = pts.map((_, i) => (viaRaw[i] || []).map((p) => sc(p, off)));   // via[i]: between node i and node i+1
  const nodes = pts.map((p, i) => {
    const next = i < pts.length - 1 ? (via[i][0] || pts[i + 1]) : null;
    const prev = i > 0 ? (via[i - 1][via[i - 1].length - 1] || pts[i - 1]) : null;
    // facing: toward the next thing on the route (the last node keeps the direction it was reached from)
    let dx = next ? next.x - p.x : p.x - prev.x, dz = next ? next.z - p.z : p.z - prev.z;
    if (next && prev && via[i].length === 0 && via[i - 1].length === 0) { dx = next.x - prev.x; dz = next.z - prev.z; }
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x, y: p.y, z: p.z, dir: { x: dx / l, z: dz / l }, yaw: Math.atan2(-dx, -dz), pitch: 0 };
  });
  // a dense polyline along the whole route, for "what is the nearest bit of path"
  const samples = []; let s = 0;
  for (let i = 0; i < pts.length; i++) {
    nodes[i].s = s;
    if (i === pts.length - 1) { samples.push({ ...pts[i], s, i }); break; }
    const chain = [pts[i], ...via[i], pts[i + 1]];
    for (let k = 0; k < chain.length - 1; k++) {
      const a = chain[k], b = chain[k + 1], len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(len / 1.2));
      for (let q = 0; q < n; q++) { const t = q / n; samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, s: s + len * t, i: i + (k + t) / (chain.length - 1) }); }
      s += len;
    }
  }
  return { nodes, via, samples };
}

let _w = null;
function world() {
  if (_w) return _w;
  const isl = buildTrack(BOARD_MAP.island, BOARD_MAP.via, null), vol = buildTrack(BOARD_MAP.volcano, BOARD_MAP.vvia, VOLCANO_OFFSET);
  const hooks = {}; for (const [k, v] of Object.entries(BOARD_MAP.hooks)) hooks[k] = sc(v);
  const vhooks = {}; for (const [k, v] of Object.entries(BOARD_MAP.vhooks)) vhooks[k] = sc(v, VOLCANO_OFFSET);
  const aux = {}; for (const [k, v] of Object.entries(BOARD_MAP.aux)) aux[k] = sc(v);
  // the places where the route is interrupted: where they start and end, which way they run, and the waypoints across
  const gaps = GAPS.map((g) => {
    const a = isl.nodes[g.after], b = isl.nodes[g.after + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    return { ...g, a: g.after, b: g.after + 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, dir: { x: dx / len, z: dz / len }, len, yaw: Math.atan2(-dx, -dz), via: isl.via[g.after] };
  });
  // height map
  const h = BOARD_MAP.height, bin = typeof atob === 'function' ? atob(h.data) : Buffer.from(h.data, 'base64').toString('binary');
  const H = new Float32Array(h.nx * h.nz);
  for (let i = 0; i < H.length; i++) H[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 10 * S;
  const fin = isl.nodes[isl.nodes.length - 1];
  _w = { nodes: isl.nodes, via: isl.via, samples: isl.samples, vnodes: vol.nodes, vvia: vol.via, vsamples: vol.samples, hooks, vhooks, aux, gaps, H, hm: h,
    temple: { x: fin.x, y: fin.y, z: fin.z, yaw: fin.yaw }, start: isl.nodes[0] };
  return _w;
}

// ---------- public: the spaces ----------
/** For each island stop: the number of the map's space tile there (null for the start, the stars and the summit). */
export const SPACE_IDS = BOARD_MAP.spaceIds;
/** The island stop where the map's space `id` is. */
export const stopOfSpace = (id) => BOARD_MAP.spaceIds.indexOf(id);

export function islandPositions() { return world().nodes.map((p) => ({ ...p, dir: { ...p.dir } })); }
export function volcanoPositions() { return world().vnodes.map((p) => ({ ...p, dir: { ...p.dir } })); }

/** The waypoints to walk through when going from node `a` to its neighbour `b` on a track (not including a and b). */
export function legVia(track, a, b) {
  const w = world(), via = track === 'island' ? w.via : w.vvia;
  if (b === a + 1) return via[a] || [];
  if (b === a - 1) return (via[b] || []).slice().reverse();
  return [];
}

/** How high the island (ground, rocks, treetops, buildings) reaches at a spot. Sea level is 0. */
export function terrainHeight(x, z) {
  const w = world(), h = w.hm, fx = (x / S - h.x0) / h.cell - 0.5, fz = (z / S - h.z0) / h.cell - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= h.nx - 1 || iz >= h.nz - 1) return 0;
  const tx = fx - ix, tz = fz - iz, at = (i, j) => w.H[j * h.nx + i];
  return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
}

/** The nearest point of the island route: {d (flat distance), x, y, z, s (distance along the route), i (node index, fractional)}. */
export function nearestPath(x, z, nearY = null) {
  const w = world(); let best = Infinity, p = null;
  for (const q of w.samples) {
    let d = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
    if (nearY !== null) d += (q.y - nearY) * (q.y - nearY) * 4; // the route passes over itself: prefer the level we are on
    if (d < best) { best = d; p = q; }
  }
  return p ? { d: Math.hypot(p.x - x, p.z - z), y: p.y, x: p.x, z: p.z, s: p.s, i: p.i } : null;
}

/** Everything the scene needs to know about the island. */
export function islandWorld() {
  const w = world();
  return { nodes: w.nodes, vnodes: w.vnodes, gaps: w.gaps, hooks: w.hooks, vhooks: w.vhooks, aux: w.aux, temple: w.temple, start: w.start };
}
