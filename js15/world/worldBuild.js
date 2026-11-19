// Turns the pure geometry of a MeshBuilder (pawns, small effects) into a Three.js mesh.
export function builderMesh(T, b, { basic = false, transparent = false, opacity = 1, fog = true, depthWrite = true } = {}) {
  const geo = b.toGeometry(T);
  const o = { vertexColors: true, side: T.DoubleSide, transparent, opacity, fog, depthWrite };
  return new T.Mesh(geo, basic ? new T.MeshBasicMaterial(o) : new T.MeshLambertMaterial(o));
}
