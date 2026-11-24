// Wii Party's own Mii body, animated with Wii Party's own Mii animations (tools/extract_wp_mii.py -> wpMiiData.js).
// The body is skinned meshes on the game's Mii skeleton: the outfit (Board Game Island's explorer suit: its picture draws
// the pockets, belt, collar and boots; everywhere else it is the player's colour) and the skin (neck, hands, legs).
// Faces +z, feet at 0, in the game's own units (a Mii is ~106 tall to the neck joint).

export const WP_NECK = 105.13;  // the head bone's height at rest

const d2r = Math.PI / 180;

const pictures = new Map(); // data URL -> Image (loading or loaded)
const outfits = new Map();  // picture + colour -> CanvasTexture
const picture = (url) => { let im = pictures.get(url); if (!im) { im = new Image(); im.src = url; pictures.set(url, im); } return im; };

/**
 * The outfit's picture in a player's colour: `pic` = { rgb, mix } (two opaque PNGs: the picture's colours, and how
 * much of the player's colour shows through, as grey: the Wii picture's alpha). Where mix is white, the colour; where it
 * is black, the picture (as the Wii's colour combiner mixes them). A canvas texture, filled in once both pictures have
 * loaded; null where there is no canvas (tests).
 */
export function outfitTexture(T, pic, color) {
  if (!pic || typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const key = pic.rgb + '|' + color;
  if (outfits.has(key)) return outfits.get(key);
  const cv = document.createElement('canvas'), tex = new T.CanvasTexture(cv);
  tex.flipY = false; if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
  outfits.set(key, tex);
  const rgb = picture(pic.rgb), mix = picture(pic.mix);
  const read = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
  const paint = () => {
    if (!(rgb.complete && rgb.width && mix.complete && mix.width)) return;
    cv.width = rgb.width; cv.height = rgb.height;
    const g = cv.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, cv.width, cv.height);
    const P = read(rgb), A = read(mix), C = g.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < P.length; i += 4) { const a = A[i] / 255; for (let c = 0; c < 3; c++) C.data[i + c] = P[i + c] * (1 - a) + C.data[i + c] * a; C.data[i + 3] = 255; }
    g.putImageData(C, 0, 0); tex.needsUpdate = true;
  };
  rgb.addEventListener('load', paint); mix.addEventListener('load', paint); paint();
  return tex;
}

/**
 * Build a body (three.js `T`, data `D` = WP_MII): { root, bones (by name), meshes, pose(clipName, frame), rest() }.
 * pose() sets every bone a clip moves to that frame (looping clips wrap; others hold their last frame).
 */
export function makeWpBody(T, D, { shirt = '#d21e14', pants = '#3c4152', skin = '#ffd3ad' } = {}) {
  const bones = D.skel.map((b) => new T.Bone());
  const byName = {}, index = {};
  const restQ = [], restT = [];
  D.skel.forEach((b, i) => {
    const o = bones[i];
    o.position.set(b.t[0], b.t[1], b.t[2]);
    o.quaternion.setFromEuler(new T.Euler(b.r[0] * d2r, b.r[1] * d2r, b.r[2] * d2r, 'ZYX')); // (Wii: Rz . Ry . Rx)
    o.scale.set(b.s[0], b.s[1], b.s[2]);
    restQ.push(o.quaternion.clone()); restT.push(o.position.clone());
    byName[b.name] = o; index[b.name] = i;
    if (b.parent >= 0) bones[b.parent].add(o);
  });
  const root = new T.Group();
  root.add(bones[0]);
  const inv = D.skel.map((b) => { const m = b.inv; return new T.Matrix4().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1); });
  const side = T.DoubleSide; // (a few of the body's triangles face the other way)
  const tex = D.tex && D.tex.wear00 ? outfitTexture(T, D.tex.wear00, shirt) : null;
  const mats = { wear00: tex ? new T.MeshLambertMaterial({ map: tex, side }) : new T.MeshLambertMaterial({ color: shirt, side }), pants: new T.MeshLambertMaterial({ color: pants, side }), skin00: new T.MeshLambertMaterial({ color: skin, side }) };
  root.updateMatrixWorld(true);
  const meshes = D.meshes.map((m) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(m.pos), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(m.nrm), 3));
    if (m.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(m.uv), 2));
    const ji = new Uint16Array((m.ji.length / 2) * 4), jw = new Float32Array((m.jw.length / 2) * 4);
    for (let i = 0; i < m.ji.length / 2; i++) { ji[4 * i] = m.ji[2 * i]; ji[4 * i + 1] = m.ji[2 * i + 1]; jw[4 * i] = m.jw[2 * i]; jw[4 * i + 1] = m.jw[2 * i + 1]; }
    g.setAttribute('skinIndex', new T.BufferAttribute(ji, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(jw, 4));
    g.setIndex(m.idx);
    const mesh = new T.SkinnedMesh(g, mats[m.mat] || mats.wear00);
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(new T.Skeleton(bones, inv), new T.Matrix4());
    return mesh;
  });
  const q0 = new T.Quaternion(), q1 = new T.Quaternion();
  const out = {
    root, bones: byName, meshes, mats,
    /** Every bone back to the body's rest pose (the T-pose). */
    rest() { bones.forEach((o, i) => { o.quaternion.copy(restQ[i]); o.position.copy(restT[i]); }); },
    /** Frame f (in the clip's 60fps frames) of a clip. `weight` < 1 blends it over whatever pose the bones are in. */
    pose(name, f, weight = 1) {
      const C = D.clips[name]; if (!C) return;
      const step = D.step, last = C.frames - 1;
      let x = C.loop ? ((f % C.frames) + C.frames) % C.frames : Math.max(0, Math.min(last, f));
      for (const [bn, frames] of Object.entries(C.bones)) {
        const o = byName[bn]; if (!o) continue;
        const k = x / step, i = Math.min(frames.length - 1, Math.floor(k)), j = Math.min(frames.length - 1, i + 1), t = Math.min(1, k - i);
        const a = frames[i], b = frames[j];
        q0.set(a[0], a[1], a[2], a[3]); q1.set(b[0], b[1], b[2], b[3]); q0.slerp(q1, t).normalize();
        if (weight >= 1) o.quaternion.copy(q0); else o.quaternion.slerp(q0, weight);
        { // (only bones that move have places; the others are at their rest place)
          const r = restT[index[bn]], x1 = a.length > 4 ? a[4] + (b[4] - a[4]) * t : r.x, y1 = a.length > 4 ? a[5] + (b[5] - a[5]) * t : r.y, z1 = a.length > 4 ? a[6] + (b[6] - a[6]) * t : r.z;
          if (weight >= 1) o.position.set(x1, y1, z1); else o.position.set(o.position.x + (x1 - o.position.x) * weight, o.position.y + (y1 - o.position.y) * weight, o.position.z + (z1 - o.position.z) * weight);
        }
      }
    },
    frames: (name) => (D.clips[name] ? D.clips[name].frames : 0),
  };
  return out;
}
