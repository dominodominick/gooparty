// The Mii body: the Wii U Mii body the Mii creator uses (world/miiBodyData.js), a skinned mesh on its own skeleton,
// in the Mii's favourite colour (shirt, sleeves and hands) with grey trousers. The game poses it by hand each frame:
// the arms and legs swing from the shoulders and hips (the same angles the game used for its old pawn's limbs), from
// the creator's idle pose (arms down at the sides).
import { MII_BODY } from './miiBodyData.js';

export const BODY_NECK = 10.9;      // the head bone's height in the body's own units (feet at 0)
export const BODY_HEAD_SCALE = 0.1; // FFL heads are ~92 units wide; the body is ~12 tall: the creator puts the head on at a tenth

/**
 * Build a body (three.js `T`): { root (the whole body, feet at the origin, facing +z, body units), bones (by name),
 * meshes, setArm(i, a), setLeg(i, a), head (the head bone, for the head to sit on) }.
 * gender 0 boy, 1 girl. setArm/setLeg turn a limb about the body's left-right axis from its rest pose, in radians,
 * exactly as the old pawn's arm and leg pivots were turned (negative: forward and up).
 */
export function makeBody(T, gender, { shirt = '#d21e14', pants = '#3c4152' } = {}) {
  const D = MII_BODY[gender ? 'F' : 'M'];
  const objs = D.nodes.map(([name, , kind, t, q, s]) => {
    const o = kind === 'bone' ? new T.Bone() : new T.Group();
    o.position.set(t[0], t[1], t[2]); o.quaternion.set(q[0], q[1], q[2], q[3]); o.scale.set(s[0], s[1], s[2]);
    return o;
  });
  const shirtMat = new T.MeshLambertMaterial({ color: shirt }), pantsMat = new T.MeshLambertMaterial({ color: pants });
  const meshes = D.meshes.map((m, k) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(m.pos), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(m.nrm), 3));
    g.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(m.ji), 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(new Float32Array(m.jw), 4));
    g.setIndex(m.idx);
    const mesh = new T.SkinnedMesh(g, k === 0 ? shirtMat : pantsMat);
    mesh.frustumCulled = false;
    objs[m.node] = mesh;
    return { mesh, m };
  });
  // the node tree (meshes in their own places), then bind each mesh to its skeleton
  D.nodes.forEach(([, parent], i) => {
    const o = objs[i], src = D.nodes[i];
    if (o.isSkinnedMesh) { o.position.set(src[3][0], src[3][1], src[3][2]); o.quaternion.set(src[4][0], src[4][1], src[4][2], src[4][3]); o.scale.set(src[5][0], src[5][1], src[5][2]); }
    if (parent >= 0) objs[parent].add(o);
  });
  const root = objs[0];
  root.updateMatrixWorld(true);
  for (const { mesh, m } of meshes) {
    const inv = m.inv.map((a) => new T.Matrix4().fromArray(a));
    mesh.bind(new T.Skeleton(m.bones.map((b) => objs[b]), inv), new T.Matrix4());
  }
  const bones = {}; D.nodes.forEach(([name, , kind], i) => { if (kind === 'bone') bones[name] = objs[i]; }); // (by the data's names: some hosts' stand-ins can't take a .name)
  // the idle pose: arms down
  const rest = {};
  for (const [name, w] of Object.entries(D.wait)) {
    const b = bones[name]; if (!b) continue;
    b.quaternion.set(w[0], w[1], w[2], w[3]); b.position.set(w[4], w[5], w[6]);
    rest[name] = b.quaternion.clone();
  }
  const ax = new T.Vector3(1, 0, 0), qs = new T.Quaternion();
  const turn = (name, a) => { const b = bones[name]; if (!b) return; qs.setFromAxisAngle(ax, a); b.quaternion.copy(qs).multiply(rest[name]); }; // (parents are not turned: the limb's parent frame is the body's)
  return {
    root, bones, meshes: meshes.map((x) => x.mesh), head: bones.head, shirtMat, pantsMat,
    setArm(i, a) { turn(i ? 'arm_l1' : 'arm_r1', a); }, // (i: 0 the pawn's -x side, 1 its +x side, as the old pawn's limbs)
    setLeg(i, a) { turn(i ? 'foot_l1' : 'foot_r1', a); },
  };
}
