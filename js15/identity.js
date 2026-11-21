// A random key stored in this browser. The host uses it to recognise a returning player
// and put them back in their old seat after a disconnect.

function randomKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

export function newKey() { return randomKey(); }

export function getKey() {
  try {
    let k = localStorage.getItem('pi.key');
    if (!k) { k = randomKey(); localStorage.setItem('pi.key', k); }
    return k;
  } catch { return randomKey(); }
}

export function getName() {
  try { return localStorage.getItem('pi.name') || ''; } catch { return ''; }
}

export function setName(n) {
  try { localStorage.setItem('pi.name', n); } catch { /* private mode: ignore */ }
}

/** Your Mii, made in the Mii creator: { data (base64 Mii data), face (a picture of it, PNG data URL) } or null. */
export function getMii() {
  try { const m = JSON.parse(localStorage.getItem('pi.mii') || 'null'); return m && typeof m.data === 'string' ? m : null; } catch { return null; }
}

export function setMii(m) {
  try { localStorage.setItem('pi.mii', JSON.stringify(m)); } catch { /* private mode: it lasts until the page closes */ }
  memMii = m;
}
let memMii = null;
export function currentMii() { return getMii() || memMii; }
