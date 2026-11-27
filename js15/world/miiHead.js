// Loads FFL, the Mii renderer, from the Mii creator's folder (mii/ffl/, see tools/pack_mii.py) once, when it is first
// wanted. Resolves to the renderer ({ head(bytes, renderer), faceIcon(bytes, size), dispose(head) }), or to null when the
// creator's files are not next to the page (the single-file download) or it fails: then the stand-in heads stay.
import { BUILD } from '../config.js';

export const MII_BASE = 'mii/';

let loading = null;

export function loadMiiRenderer() {
  if (loading) return loading;
  if (typeof document === 'undefined' || !document.head || typeof fetch !== 'function') return (loading = Promise.resolve(null));
  loading = new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(null), 60000); // (never hang the game on it)
    const glue = document.createElement('script');
    glue.src = MII_BASE + 'ffl/ffl-emscripten.js?v=' + BUILD; // (the build in the address: a browser's old copy is never used)
    glue.onerror = () => done(null); // no creator files here
    glue.onload = () => {
      window.__miiFFLReady = (F) => { F.start(MII_BASE).then(() => done(F), () => done(null)); };
      const m = document.createElement('script');
      m.type = 'module';
      m.textContent = `import * as F from './${MII_BASE}ffl/game-ffl.js?v=${BUILD}'; window.__miiFFLReady(F);`;
      document.head.appendChild(m);
    };
    document.head.appendChild(glue);
  });
  return loading;
}

const faces = new Map(); // Mii data -> face picture (data URL), or a promise of one

/** The face picture of a Mii (base64 Mii data): a promise of a PNG data URL, or of null if it can't be drawn here. */
export function miiFace(data, parse) {
  if (!data) return Promise.resolve(null);
  if (faces.has(data)) return Promise.resolve(faces.get(data));
  const p = loadMiiRenderer().then((F) => {
    const m = F && parse(data);
    if (!m) return null;
    try { const url = F.faceIcon(m.ffl, 160); faces.set(data, url); return url; } catch (e) { return null; }
  });
  faces.set(data, p);
  return p;
}
