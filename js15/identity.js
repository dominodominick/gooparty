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
