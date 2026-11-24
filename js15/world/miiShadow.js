// A Mii's shadow in the Mii's own shape: every part of the figure (body, limbs, head) drawn a second time, flattened
// along the sun's light onto the ground under the player, in see-through black. (The map is drawn with its own baked
// light and can't take real shadows; this lays one on it, as the old round shadow was laid: see boardScene.placeShadow.)
// The flattened copies are children of the parts they copy, so they move, pose and hide with them. The stencil keeps
// the copies of one Mii from darkening each other where they overlap (the arm over the body): one even shadow.

/**
 * The shadow for one figure: { material, set(point, normal, light, opacity), rebuild(root) }. `root` is the figure (the
 * body's root: its parts, and the head once it is on). `ref` (1-255) keeps each player's stencil apart.
 */
export function makeShadowCaster(T, root, ref = 1) {
  const U = {
    uShadowP: { value: new T.Vector3() },             // a point on the ground under the player
    uShadowN: { value: new T.Vector3(0, 1, 0) },      // the ground's up
    uShadowL: { value: new T.Vector3(-0.5, -0.8, -0.3).normalize() }, // which way the light goes (down, from the sun)
  };
  const material = new T.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  if (T.NotEqualStencilFunc !== undefined) {
    Object.assign(material, { stencilWrite: true, stencilRef: ref, stencilFunc: T.NotEqualStencilFunc, stencilZPass: T.ReplaceStencilOp, stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp });
  }
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform vec3 uShadowP;\nuniform vec3 uShadowN;\nuniform vec3 uShadowL;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 wpos = modelMatrix * vec4( transformed, 1.0 );
      float above = max( dot( wpos.xyz - uShadowP, uShadowN ), 0.0 );
      wpos.xyz += uShadowL * ( above / max( -dot( uShadowL, uShadowN ), 0.2 ) ); // along the light, down onto the ground
      vec4 mvPosition = viewMatrix * wpos;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'mii-shadow';

  const twins = [];
  const out = {
    material, twins,
    /** Where the shadow falls: the ground (a point and its up), the light's direction (down), and how dark. */
    set(p, n, l, opacity) {
      U.uShadowP.value.set(p.x, p.y, p.z); U.uShadowN.value.set(n.x, n.y, n.z).normalize(); U.uShadowL.value.set(l.x, l.y, l.z).normalize();
      material.opacity = opacity;
    },
    /** Make the flattened copies of every part of the figure (again: call it when the head changes). */
    rebuild(r = root) {
      for (const t of twins.splice(0)) if (t.parent) t.parent.remove(t);
      const parts = [];
      r.traverse((o) => {
        if (!o.isMesh || o.isSprite || o.userData.shadowTwin || o.userData.noShadow || !o.geometry) return;
        const mats = [].concat(o.material);
        if (mats.every((m) => m && m.transparent && !(m.uniforms && m.uniforms.u_light_dir))) return; // (see-through glow, decals)
        if (mats.some((m) => m && m.uniforms && m.uniforms.u_mode && m.uniforms.u_mode.value !== 0 && m.transparent)) return; // (FFL's face mask: a flat picture)
        parts.push(o);
      });
      for (const o of parts) {
        let t;
        if (o.isSkinnedMesh) { t = new T.SkinnedMesh(o.geometry, material); t.bind(o.skeleton, o.bindMatrix); }
        else t = new T.Mesh(o.geometry, material);
        t.userData.shadowTwin = true; t.frustumCulled = false; t.renderOrder = 2;
        o.add(t); twins.push(t);
      }
      return twins.length;
    },
  };
  out.rebuild();
  return out;
}
