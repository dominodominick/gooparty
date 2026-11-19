// The long-necked dinosaur that swims round the pool by the rope bridge, with its ring of ripples.
//
// The model comes from the game's own file (see tools/extract_watasy.py and watasyModel.js). The motion is the map's
// own animation, files/mr001/map/motion/m001_09.branm, read key by key: its curves are exactly
//   - the swimmer (bone watasy_mm) goes round a circle of radius 550 about (-5600, -2100), once every 2000 frames,
//     turning to face along it (-360 degrees of Y per lap, with X and Z held at 180);
//   - the dinosaur (bone hook_watasi, on the swimmer, turned 90 degrees) bobs 50 units down and up every 100 frames.
// At the game's 60 frames a second a lap takes 33 seconds. The ripples (m001_09 in island.glb) ride on the swimmer.
// Map units throughout; the island's own root does the scaling. Nothing in the pure functions needs three.js.

export const WATASY_PATH = { cx: -5600, cz: -2100, r: 550, lapFrames: 2000, bob: 50, bobFrames: 100, fps: 60 };

/** Where the swimmer is at game frame `f`: position and the three angles (degrees) of its bone, as the game stores them. */
export function swimmerAt(f, P = WATASY_PATH) {
  const a = (2 * Math.PI * f) / P.lapFrames;
  return { x: P.cx - P.r * Math.sin(a), y: 0, z: P.cz - P.r * Math.cos(a), rx: 180, ry: (-360 * f) / P.lapFrames, rz: 180 };
}

/** How far the dinosaur has bobbed down at frame `f` (0 at the top, -bob at the bottom). */
export function bobAt(f, P = WATASY_PATH) {
  return -P.bob / 2 + (P.bob / 2) * Math.cos((2 * Math.PI * f) / P.bobFrames);
}

/**
 * Bring the dinosaur into the loaded map and return `tick(dt)` to move it, or null if the map has no ripple ring
 * (an older map file, or a stand-in in tests). The ripple ring is reused, moved along with the dinosaur.
 */
export function addWatasy(THREE, island, model) {
  let ring = null;
  island.traverse((o) => { if (!ring && o.name === 'm001_09') ring = o; });
  if (!ring || !ring.parent) return null;
  const parent = ring.parent;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(model.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(model.normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(model.uv, 2));
  geo.setIndex(model.index);
  const tex = new THREE.TextureLoader().load(model.texture);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  const dino = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  dino.name = 'watasy';
  dino.matrixAutoUpdate = false;
  parent.add(dino);

  // the ring's vertices were baked where the swimmer stands at frame 0: move them by (swimmer now) x (swimmer at 0)^-1
  const restRing = ring.matrix.clone();
  const swim0inv = swimmerMatrix(THREE, swimmerAt(0)).invert();
  ring.matrixAutoUpdate = false;
  const hookTurn = new THREE.Matrix4().makeRotationY(Math.PI / 2), bob = new THREE.Matrix4();
  let frame = 0;
  const place = () => {
    const S = swimmerMatrix(THREE, swimmerAt(frame));
    ring.matrix.copy(S).multiply(swim0inv).multiply(restRing); ring.matrixWorldNeedsUpdate = true;
    bob.makeTranslation(0, bobAt(frame), 0);
    dino.matrix.copy(S).multiply(bob).multiply(hookTurn); dino.matrixWorldNeedsUpdate = true;
  };
  place();
  const tick = (dt) => {
    if (!(dt > 0)) return;
    frame = (frame + dt * WATASY_PATH.fps) % (WATASY_PATH.lapFrames * WATASY_PATH.bobFrames); // a whole number of both
    place();
  };
  tick.dino = dino; tick.ring = ring; tick.frame = () => frame;
  return tick;
}

function swimmerMatrix(THREE, s) {
  const d = Math.PI / 180;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(s.rx * d, s.ry * d, s.rz * d, 'ZYX')); // the Wii turns X, then Y, then Z
  return m.setPosition(s.x, s.y, s.z);
}
