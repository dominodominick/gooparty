// The pictures on the wooden signs: the arrow at the start, the blue 4, the blue 3 at the volcano push. The game draws
// them as a second layer of the sign material (mr001m023) through each sign's second UV set; the converted map kept only
// the wood. Here each sign gets a copy of itself that draws just the picture, over the wood (see tools/extract_sign_decals.py).

/** Add the pictures to the signs in `island`. Returns the picture meshes, by sign. */
export function addSignDecals(THREE, island, data) {
  const tex = new THREE.TextureLoader().load(data.texture);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; // (the map's UVs run top-down, like the game's)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.channel = 1;
  const out = {};
  island.traverse((m) => {
    if (!m.isMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || mat.name !== 'mr001m023') return;
    // which sign: the mesh's own name, or its parent's (a mesh with several materials is split into parts named
    // m001_00a1_1, m001_00a1_2, … under a group named m001_00a1)
    let key = null;
    for (let o = m; o && !key; o = o.parent) for (const k of Object.keys(data.uv1)) if (o.name === k || (o.name || '').startsWith(k + '_')) { key = k; break; }
    if (!key || out[key]) return;
    const uv1 = data.uv1[key];
    if (m.geometry.attributes.position.count * 2 !== uv1.length) return; // not the sign we know
    m.geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    const pic = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.04, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }));
    pic.name = key + '_picture'; pic.renderOrder = 1;
    m.add(pic); out[key] = pic;
  });
  return out;
}
