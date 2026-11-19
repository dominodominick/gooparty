// The water: its blue texture has no dark specks, and every layer slides the right way (down the waterfalls).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WATER_BLUE, WATER_FLOW, recolourWater, WaterFlow } from '../js15/world/water.js';

// ---- the blue water texture ----
{
  const { lo, hi } = WATER_BLUE;
  assert.deepEqual([...recolourWater(new Uint8ClampedArray([0, 0, 0, 0]))], [...lo, 255], 'the darkest ripple becomes the deeper blue, not black');
  assert.deepEqual([...recolourWater(new Uint8ClampedArray([255, 255, 255, 255]))], [...hi, 255], 'the brightest ripple becomes the lighter blue');
  assert.equal(recolourWater(new Uint8ClampedArray([90, 90, 90, 200]), 128)[3], 128, 'the sea layer gets the alpha it is given');
  // every possible pixel: blue, never darker than the deeper blue, and brighter ripples never come out darker
  let last = -1;
  for (let v = 0; v <= 255; v++) {
    for (const a of [0, 60, 128, 200, 255]) {
      const [r, g, b] = recolourWater(new Uint8ClampedArray([v, v, v, a]));
      assert.ok(r >= lo[0] && r <= hi[0] && g >= lo[1] && g <= hi[1] && b >= lo[2] && b <= hi[2], `pixel ${v}/${a} is between the two blues`);
      assert.ok(b > g && g > r, 'and it is blue');
    }
    const b = recolourWater(new Uint8ClampedArray([v, v, v, v]))[2];
    assert.ok(b >= last, 'brighter in, never darker out'); last = b;
  }
  assert.ok(lo[2] > 150 && lo[1] > 80, 'even the deeper blue is nowhere near black');
}

// ---- sliding ----
{
  const tex = { offset: { x: 0, y: 0 } }, f = new WaterFlow();
  assert.equal(f.add(tex, 0.5, -1), tex); f.add(tex, 9, 9); f.add(null, 1, 1); f.add({}, 1, 1);
  assert.equal(f.items.length, 1, 'a texture shared by several materials is only moved once');
  f.update(0.1);
  assert.ok(Math.abs(tex.offset.x - 0.05) < 1e-12 && Math.abs(tex.offset.y + 0.1) < 1e-12);
  f.update(0); f.update(-1); f.update(NaN);
  assert.ok(Math.abs(tex.offset.x - 0.05) < 1e-12, 'no time, no movement');
  for (let i = 0; i < 1000; i++) f.update(0.25);
  assert.ok(Math.abs(tex.offset.x) < 2 && Math.abs(tex.offset.y) < 2, 'offsets stay small however long the game runs');
}

// ---- the map: which way is "down the falls" for each layer's texture? ----
{
  const d = fs.readFileSync(new URL('../assets/board-game-island/island.glb', import.meta.url)), n = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + n).toString('utf8')), bin = 20 + n + 8;
  const read = (ai) => {
    const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const [bytes, get] = { 5126: [4, 'readFloatLE'], 5125: [4, 'readUInt32LE'], 5123: [2, 'readUInt16LE'], 5121: [1, 'readUInt8'] }[a.componentType];
    const stride = bv.byteStride || size * bytes, off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: size }, (_, k) => d[get](off + i * stride + k * bytes)));
  };
  /** Over the steep (waterfall) triangles of a material: how much u and v grow per map unit going DOWN, weighted by area. */
  const downhill = (material) => {
    let su = 0, sv = 0, area = 0;
    for (const x of j.nodes) if (x.mesh != null) for (const p of j.meshes[x.mesh].primitives) {
      if (j.materials[p.material].name !== material) continue;
      const P = read(p.attributes.POSITION), U = read(p.attributes.TEXCOORD_0), I = read(p.indices).map((q) => q[0]);
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]], e1 = P[b].map((v, k) => v - P[a][k]), e2 = P[c].map((v, k) => v - P[a][k]);
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], len = Math.hypot(nx, ny, nz);
        if (len < 1 || Math.abs(ny / len) > 0.6) continue; // flat water: no "down"
        // "down" within the triangle = -Y with the part along the normal taken out, written as s*e1 + t*e2
        const dn = [(ny / len) * (nx / len), -1 + (ny / len) * (ny / len), (ny / len) * (nz / len)];
        const d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], d22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
        const b1 = dn[0] * e1[0] + dn[1] * e1[1] + dn[2] * e1[2], b2 = dn[0] * e2[0] + dn[1] * e2[1] + dn[2] * e2[2], det = d11 * d22 - d12 * d12;
        const s = (b1 * d22 - b2 * d12) / det, tt = (b2 * d11 - b1 * d12) / det;
        su += (s * (U[b][0] - U[a][0]) + tt * (U[c][0] - U[a][0])) * len; sv += (s * (U[b][1] - U[a][1]) + tt * (U[c][1] - U[a][1])) * len; area += len;
      }
    }
    assert.ok(area > 0, `${material} has waterfalls`);
    return [su / area, sv / area];
  };
  // a texture's pattern moves against its offset; speed down the falls (map units per second) = -(offset rate) / (texture lengths per unit going down)
  const speedDown = (material, flow) => { const [du, dv] = downhill(material), k = Math.abs(du) > Math.abs(dv) ? 0 : 1; return -flow[k] / [du, dv][k]; };
  const surface = speedDown('mr001m004', WATER_FLOW.surface), waves = speedDown('mr001m008', WATER_FLOW.waves);
  assert.ok(surface > 150 && surface < 1500, `the water surface runs down the falls (${surface.toFixed(0)} units a second)`);
  assert.ok(waves > 300 && waves < 1500, `the wave lines run down the falls (${waves.toFixed(0)} units a second)`);
  assert.ok(waves > surface, 'the wave lines run faster than the surface under them');
  if (process.argv.includes('--speeds')) console.log(`surface ${surface.toFixed(0)}, wave lines ${waves.toFixed(0)} map units a second down the falls`);
}
console.log('water tests passed');
