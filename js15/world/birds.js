// The birds over the island, flying the game's own animation (see tools/extract_birds.py and birdsData.js).
// 30 birds, each two flat wing cards on their own bones. The data holds every bird's position and every wing's rotation
// 30 times a second over the 100-second loop (6000 game frames at 60 a second), as gzipped 16-bit deltas.
// Until it is unpacked, and if it cannot be, the birds simply stay where the map has them.

/** Unpack the motion: gzipped, channel by channel, 16-bit deltas -> Float32Array per channel (running sums). */
export async function unpackMotion(data, inflate = gunzip) {
  const bytes = await inflate(base64Bytes(data.motion));
  const S = data.samples, v = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  const C = v.length / S;
  if (!Number.isInteger(C) || C !== data.birds * 3 + data.wings.length * 4) throw new Error('bird motion has the wrong size');
  const out = new Float32Array(v.length);
  for (let c = 0; c < C; c++) { let s = 0; for (let i = 0; i < S; i++) { s += v[c * S + i]; out[c * S + i] = s; } }
  return { S, C, ch: out };
}

/** Where a wing is at game frame f (looping): position [x,y,z] and quaternion [x,y,z,w], interpolated between samples. */
export function wingAt(data, M, wing, f, outP = [0, 0, 0], outQ = [0, 0, 0, 1]) {
  const S = M.S, step = data.step, w = data.wings[wing];
  const t = ((f % data.frames) + data.frames) % data.frames / step, i = Math.floor(t), j = (i + 1) % S, a = t - i;
  const ch = M.ch;
  for (let k = 0; k < 3; k++) { const c = (w.bird * 3 + k) * S; outP[k] = ch[c + i] + (ch[c + j] - ch[c + i]) * a; }
  const q0 = (data.birds * 3 + wing * 4) * S;
  let dot = 0; for (let k = 0; k < 4; k++) dot += ch[q0 + k * S + i] * ch[q0 + k * S + j];
  const sgn = dot < 0 ? -1 : 1; let n = 0; // the loop's end and start may sit on opposite signs
  for (let k = 0; k < 4; k++) { outQ[k] = ch[q0 + k * S + i] * (1 - a) + sgn * ch[q0 + k * S + j] * a; n += outQ[k] * outQ[k]; }
  n = Math.sqrt(n) || 1; for (let k = 0; k < 4; k++) outQ[k] /= n;
  return [outP, outQ];
}

/** Bring the flying birds into the loaded map; returns tick(dt), or null if the map has no birds. */
export function addBirds(THREE, island, data) {
  let group = null;
  island.traverse((o) => { if (!group && o.name === 'm001_08') group = o; });
  if (!group || !group.parent) return null;
  let srcMat = null;
  group.traverse((o) => { if (!srcMat && o.isMesh) srcMat = o.material; });
  const mat = (Array.isArray(srcMat) ? srcMat[0] : srcMat) || new THREE.MeshBasicMaterial({ color: 0x3366cc });
  mat.side = THREE.DoubleSide;
  const sides = [0, 1].map((side) => {
    const c = data.cards[side], geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(c.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
    geo.setIndex(c.index);
    const wings = data.wings.map((w, i) => (w.side === side ? i : -1)).filter((i) => i >= 0);
    const mesh = new THREE.InstancedMesh(geo, mat, wings.length);
    mesh.name = `birds_${side ? 'right' : 'left'}`; mesh.frustumCulled = false; mesh.visible = false;
    group.parent.add(mesh);
    return { mesh, wings };
  });
  let motion = null, frame = 0;
  const P = [0, 0, 0], Q = [0, 0, 0, 1], m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const place = () => {
    for (const { mesh, wings } of sides) {
      wings.forEach((wi, k) => {
        wingAt(data, motion, wi, frame, P, Q); const sc = data.wings[wi].scale;
        mesh.setMatrixAt(k, m4.compose(v.set(P[0], P[1], P[2]), q.set(Q[0], Q[1], Q[2], Q[3]), s.set(sc, sc, sc)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  unpackMotion(data).then((M) => {
    motion = M; place();
    for (const { mesh } of sides) mesh.visible = true;
    for (const c of group.children) c.visible = false; // the frozen birds give way to the flying ones
  }).catch(() => {}); // keep the frozen birds
  const tick = (dt) => {
    if (!motion || !(dt > 0)) return;
    frame = (frame + dt * 60) % data.frames;
    place();
  };
  tick.ready = () => !!motion; tick.sides = sides; tick.frame = () => frame;
  return tick;
}

function base64Bytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
