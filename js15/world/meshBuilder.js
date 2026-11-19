// A small triangle-soup builder: positions, normals and vertex colors in plain arrays (no Three.js),
// so whole sets of props can be merged into ONE mesh, and so the shapes can be tested and previewed.
export function rgb(hex) {
  if (Array.isArray(hex)) return hex;
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mix = (a, b, t) => { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
export const shade = (c, k) => { c = rgb(c); return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; };

/** Transform from options {x,y,z, sx,sy,sz (or s), rx,ry,rz (Three's YXZ order)}. */
function makeXf(o = {}) {
  const s = o.s ?? 1, sx = o.sx ?? s, sy = o.sy ?? s, sz = o.sz ?? s;
  const tx = o.x || 0, ty = o.y || 0, tz = o.z || 0;
  const rx = o.rx || 0, ry = o.ry || 0, rz = o.rz || 0;
  const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
  const rot = (x, y, z) => {
    const x1 = x * cz - y * szn, y1 = x * szn + y * cz;
    const y2 = y1 * cx - z * sxn, z2 = y1 * sxn + z * cx;
    return [x1 * cy + z2 * syn, y2, -x1 * syn + z2 * cy];
  };
  return {
    p: (v) => { const r = rot(v[0] * sx, v[1] * sy, v[2] * sz); return [r[0] + tx, r[1] + ty, r[2] + tz]; },
    n: (v) => { const r = rot(v[0] / sx, v[1] / sy, v[2] / sz), l = Math.hypot(r[0], r[1], r[2]) || 1; return [r[0] / l, r[1] / l, r[2] / l]; },
  };
}

export class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  get triCount() { return this.pos.length / 9; }

  /** One triangle. Winding is fixed up so the face points the way its normals do (needed for two-sided lighting). */
  tri(a, b, c, na, nb, nc, color) {
    const col = rgb(color);
    if (!na) { // flat
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) return;
      n = [n[0] / l, n[1] / l, n[2] / l]; na = nb = nc = n;
    } else {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const gx = u[1] * v[2] - u[2] * v[1], gy = u[2] * v[0] - u[0] * v[2], gz = u[0] * v[1] - u[1] * v[0];
      if (Math.hypot(gx, gy, gz) < 1e-9) return;
      if (gx * (na[0] + nb[0] + nc[0]) + gy * (na[1] + nb[1] + nc[1]) + gz * (na[2] + nb[2] + nc[2]) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nor.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    for (let i = 0; i < 3; i++) this.col.push(col[0], col[1], col[2]);
  }
  /** Flat quad a,b,c,d (in order around the face). */
  quad(a, b, c, d, color) { this.tri(a, b, c, null, null, null, color); this.tri(a, c, d, null, null, null, color); }

  /** Solid of revolution. profile = [[radius, y, colorOrUndefined], ...] bottom to top. smooth: share normals between rings. */
  lathe(profile, seg, color, o = {}, smooth = false) {
    const X = makeXf(o), cols = profile.map((p) => rgb(p[2] || color));
    const ring = (j, k) => { const a = (k / seg) * Math.PI * 2; return [profile[j][0] * Math.cos(a), profile[j][1], profile[j][0] * Math.sin(a)]; };
    const segN = (j) => { // outward normal of profile segment j -> j+1 (rotated around by angle a)
      const dr = profile[j + 1][0] - profile[j][0], dy = profile[j + 1][1] - profile[j][1], l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l]; // (radial, y)
    };
    const vertN = (j) => {
      if (!smooth) return null;
      const a = j > 0 ? segN(j - 1) : segN(j), b = j < profile.length - 1 ? segN(j) : segN(j - 1);
      const r = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(r, y) || 1;
      return [r / l, y / l];
    };
    for (let j = 0; j < profile.length - 1; j++) {
      if (profile[j][0] < 1e-6 && profile[j + 1][0] < 1e-6) continue;
      const sn = segN(j), n0 = vertN(j) || sn, n1 = vertN(j + 1) || sn;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
        const nrm = (n, a) => X.n([n[0] * Math.cos(a), n[1], n[0] * Math.sin(a)]);
        const p00 = X.p(ring(j, k)), p01 = X.p(ring(j, k + 1)), p10 = X.p(ring(j + 1, k)), p11 = X.p(ring(j + 1, k + 1));
        const c0 = cols[j], c1 = cols[j + 1], cm = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
        const useGrad = profile[j][2] || profile[j + 1][2];
        if (smooth) { // each corner has its own normal; colour is per face so gradients stay cheap
          this.tri(p00, p01, p11, nrm(n0, a0), nrm(n0, a1), nrm(n1, a1), useGrad ? cm : cols[j]);
          this.tri(p00, p11, p10, nrm(n0, a0), nrm(n1, a1), nrm(n1, a0), useGrad ? cm : cols[j]);
        } else {
          const nm = nrm(sn, am);
          this.tri(p00, p01, p11, nm, nm, nm, useGrad ? cm : cols[j]);
          this.tri(p00, p11, p10, nm, nm, nm, useGrad ? cm : cols[j]);
        }
      }
    }
  }
  /** Cylinder / cone / frustum standing on y=0, with caps. */
  cyl(r0, r1, h, seg, color, o = {}) {
    const prof = [[0, 0], [r0, 0], [r1, h]];
    if (r1 > 1e-6) prof.push([0, h]);
    this.lathe(prof, seg, color, o);
  }
  /** Sphere (or ellipsoid via sx/sy/sz) centred on its origin. */
  sphere(r, color, o = {}, seg = 10, rings = 7) {
    const prof = [];
    for (let i = 0; i <= rings; i++) { const a = (i / rings) * Math.PI; prof.push([Math.sin(a) * r, -Math.cos(a) * r]); }
    this.lathe(prof, seg, color, o, true);
  }
  /** Upright box standing on y=0, w (x) by d (z), h tall. Different colour on top via topColor. */
  box(w, h, d, color, o = {}, topColor) {
    const X = makeXf(o), hw = w / 2, hd = d / 2;
    const P = (x, y, z) => X.p([x, y, z]);
    const f = (a, b, c, e, col) => this.quad(P(...a), P(...b), P(...c), P(...e), col);
    f([-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd], color);
    f([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], color);
    f([hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd], color);
    f([-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], color);
    f([-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd], topColor || color);
    f([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], color);
  }
  /** Lumpy rock / bush / cloud puff: a jittered sphere with flat faces. rng() gives 0..1. */
  blob(r, color, o, rng, jit = 0.28, seg = 7, rings = 5, colorTop) {
    const X = makeXf(o), pts = [];
    for (let i = 0; i <= rings; i++) {
      const a = (i / rings) * Math.PI, row = [];
      for (let k = 0; k < seg; k++) {
        const b = (k / seg) * Math.PI * 2, j = i === 0 || i === rings ? 1 : 1 + (rng() - 0.5) * 2 * jit;
        row.push(X.p([Math.sin(a) * Math.cos(b) * r * j, -Math.cos(a) * r * j * (i === 0 || i === rings ? 1 : 1 + (rng() - 0.5) * jit), Math.sin(a) * Math.sin(b) * r * j]));
      }
      pts.push(row);
    }
    for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg, a = pts[i][k], b = pts[i][k1], c = pts[i + 1][k1], d = pts[i + 1][k];
      const col = colorTop ? mix(color, colorTop, (i + 0.5) / rings) : color;
      this.tri(a, b, c, null, null, null, col); this.tri(a, c, d, null, null, null, col);
    }
  }
  /** Flat prism from a 2D outline (x,z points, convex or star-shaped around the origin) with thickness along y. */
  prism(outline, h, color, o = {}, topColor) {
    const X = makeXf(o), n = outline.length;
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      this.quad(X.p([a[0], 0, a[1]]), X.p([b[0], 0, b[1]]), X.p([b[0], h, b[1]]), X.p([a[0], h, a[1]]), color);
      this.tri(X.p([0, h, 0]), X.p([b[0], h, b[1]]), X.p([a[0], h, a[1]]), null, null, null, topColor || color);
      this.tri(X.p([0, 0, 0]), X.p([a[0], 0, a[1]]), X.p([b[0], 0, b[1]]), null, null, null, color);
    }
  }
  /** Append another builder's triangles, moved by o. */
  add(other, o = {}) {
    const X = makeXf(o);
    for (let i = 0; i < other.pos.length; i += 3) {
      const p = X.p([other.pos[i], other.pos[i + 1], other.pos[i + 2]]), n = X.n([other.nor[i], other.nor[i + 1], other.nor[i + 2]]);
      this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(other.col[i], other.col[i + 1], other.col[i + 2]);
    }
  }
  /** Three.js BufferGeometry from the arrays. */
  toGeometry(T) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.nor), 3));
    // colours are written as ordinary (sRGB) values; newer three.js wants vertex colours in linear light
    const col = new Float32Array(this.col);
    if (T.SRGBColorSpace) for (let i = 0; i < col.length; i++) { const c = col[i]; col[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  }
}

/** A seeded pseudo-random generator for scenery placement. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
