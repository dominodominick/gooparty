// The Mii creator (mii/, the open-source Mii Maker remake), opened full screen over the game. It opens straight into the
// editor with your Mii; when you finish (save or quit) it sends the Mii back and closes.
import { MII_BASE } from './world/miiHead.js';

/** Is the creator next to this page? (The single-file download does not carry it.) */
export async function creatorAvailable() {
  try { const r = await fetch(MII_BASE + 'CREDITS.txt', { cache: 'no-store' }); return r.ok; } catch (e) { return false; }
}

/**
 * Open the creator on `data` (base64 Mii data). Resolves to { data, name } when the Mii was saved, null when the
 * player left without saving, or { error } when the creator could not be opened.
 */
export function openMiiCreator(data) {
  return new Promise((resolve) => {
    creatorAvailable().then((ok) => {
      if (!ok) { resolve({ error: 'The Mii creator is not included in this copy of the game. Open the published game to make your Mii.' }); return; }
      const wrap = document.createElement('div');
      wrap.className = 'mii-overlay';
      const frame = document.createElement('iframe');
      frame.title = 'Mii creator';
      frame.allow = 'autoplay; fullscreen';
      const origin = location.origin && location.origin !== 'null' ? location.origin : '*';
      frame.src = `${MII_BASE}index.html?data=${encodeURIComponent(data)}&renderTypes=headshot&origin=${encodeURIComponent(origin)}`;
      const close = document.createElement('button');
      close.className = 'mii-close'; close.type = 'button'; close.textContent = 'Close'; close.title = 'Close without saving';
      wrap.append(frame, close);
      document.body.appendChild(wrap);
      const finish = (v) => { removeEventListener('message', onMsg); wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 350); resolve(v); };
      const onMsg = (e) => {
        if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'miic-data-finalize') return;
        finish(e.data.properSave && typeof e.data.data === 'string' ? { data: e.data.data, name: e.data.name || '' } : null);
      };
      addEventListener('message', onMsg);
      close.onclick = () => finish(null);
    });
  });
}
