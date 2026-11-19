// Canvas art for the board spaces and signs (rounded, glossy tiles with bold icons).
const FONT = '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif';

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tint = (h, k) => { const [r, gg, b] = hexToRgb(h); const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k))); return `rgb(${f(r)},${f(gg)},${f(b)})`; };
function star(g, cx, cy, R, r) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, k = i % 2 ? r : R; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * k, cy + Math.sin(a) * k); } g.closePath(); }
function outlined(g, text, x, y, size, fill, line) {
  g.font = `900 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = size * 0.16; g.strokeStyle = line; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}

/** The top face of a space. type: board space type; text: what it shows (label or "-4"); hex: its colour. */
export function tileCanvas(type, text, hex, erupt = false) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const base = erupt ? '#ff4a24' : hex, light = ['blank', 'start'].includes(type) && !erupt;
  // soft drop shadow ring so the tile reads against any ground
  rr(g, 6, 6, S - 12, S - 12, 46); g.fillStyle = tint(base, 0.55); g.fill();
  const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, tint(base, 1.25)); grad.addColorStop(0.5, tint(base, 1)); grad.addColorStop(1, tint(base, 0.88));
  rr(g, 14, 14, S - 28, S - 28, 38); g.fillStyle = grad; g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.75)'; rr(g, 24, 24, S - 48, S - 48, 30); g.stroke();
  const ink = light ? '#3a5a78' : '#ffffff', edge = light ? '#ffffff' : tint(base, 0.45);
  const cx = S / 2, cy = S / 2 + 4;
  if (erupt) { // lava tile: glowing -4 with embers
    g.fillStyle = 'rgba(255,214,90,0.55)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(30 + (i * 53) % 200, 40 + (i * 97) % 180, 7 + (i % 3) * 3, 0, 6.283); g.fill(); }
    outlined(g, text, cx, cy, text.length > 3 ? 92 : 128, '#fff3c4', '#8a1c0a');
  } else if (type === 'tornado') { // a spiral funnel
    g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.lineCap = 'round';
    for (let i = 0; i < 5; i++) { const w = 80 - i * 13, y = 60 + i * 34; g.beginPath(); g.ellipse(cx, y, w, 12, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
    g.strokeStyle = '#6b7a8a'; g.lineWidth = 5; for (let i = 0; i < 5; i++) { const w = 80 - i * 13, y = 60 + i * 34; g.beginPath(); g.ellipse(cx, y, w, 12, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  } else if (type === 'ufo') {
    g.fillStyle = '#a8f0ff'; g.beginPath(); g.ellipse(cx, cy - 22, 44, 40, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#c6ced8'; g.strokeStyle = '#4a5666'; g.lineWidth = 8; g.beginPath(); g.ellipse(cx, cy + 10, 88, 28, 0, 0, 6.283); g.fill(); g.stroke();
    g.fillStyle = '#ffd84a'; for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(cx + i * 34, cy + 14, 7, 0, 6.283); g.fill(); }
  } else if (['vine', 'dragon', 'crates', 'volcanoOrNot', 'spike'].includes(type)) {
    star(g, cx, cy, 92, 40); g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#c9487f'; g.lineJoin = 'round'; g.stroke();
  } else if (type === 'skull') { // the volcano space: a white skull (drawn, so it never depends on an emoji font)
    g.fillStyle = '#fbf6ff'; g.strokeStyle = '#2a0f45'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy - 16, 64, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(cx + 40, cy + 52); g.lineTo(cx - 40, cy + 52); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#2a0f45';
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 26, cy - 14, 18, 22, 0, 0, 6.283); g.fill(); }
    g.beginPath(); g.moveTo(cx, cy + 4); g.lineTo(cx - 10, cy + 22); g.lineTo(cx + 10, cy + 22); g.closePath(); g.fill();
    g.lineWidth = 6; for (const x of [-22, 0, 22]) { g.beginPath(); g.moveTo(cx + x, cy + 34); g.lineTo(cx + x, cy + 52); g.stroke(); }
  } else if (type === 'final') { // chequered flag
    g.save(); g.translate(cx, cy); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#1c1c1c' : '#ffffff'; g.fillRect(-72 + x * 36, -72 + y * 36, 36, 36); } g.lineWidth = 8; g.strokeStyle = '#8a6a10'; g.strokeRect(-72, -72, 144, 144); g.restore();
  } else if (type === 'finish') { // pink crown circle, like the treasure room's floor
    g.fillStyle = '#ff6fae'; g.beginPath(); g.arc(cx, cy, 86, 0, 6.283); g.fill(); g.lineWidth = 9; g.strokeStyle = '#fff3c4'; g.stroke();
    g.fillStyle = '#ffd84a'; g.beginPath(); g.moveTo(cx - 52, cy + 34); g.lineTo(cx - 60, cy - 36); g.lineTo(cx - 26, cy - 4); g.lineTo(cx, cy - 50); g.lineTo(cx + 26, cy - 4); g.lineTo(cx + 60, cy - 36); g.lineTo(cx + 52, cy + 34); g.closePath(); g.fill(); g.lineWidth = 6; g.strokeStyle = '#a8741a'; g.stroke();
  } else if (text) {
    const long = text.length > 4, mid = text.length > 2;
    outlined(g, text, cx, cy, long ? 74 : mid ? 104 : 136, ink, edge);
  } else if (type === 'blank') { // plain, with a faint diamond
    g.fillStyle = 'rgba(120,150,180,0.16)'; g.beginPath(); g.moveTo(cx, cy - 56); g.lineTo(cx + 56, cy); g.lineTo(cx, cy + 56); g.lineTo(cx - 56, cy); g.closePath(); g.fill();
  }
  return c;
}

/** A hanging sign: rounded plaque with big text. */
export function signCanvas(text, { bg = '#d9402f', fg = '#fff6d6', w = 512, h = 128, edge = '#6a1d12' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  rr(g, 4, 4, w - 8, h - 8, h * 0.3); g.fillStyle = edge; g.fill();
  rr(g, 12, 12, w - 24, h - 24, h * 0.24); g.fillStyle = bg; g.fill();
  outlined(g, text, w / 2, h / 2 + 4, h * 0.58, fg, edge);
  return c;
}

/** The golden shield with a 6 for the temple door. */
export function doorSixCanvas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.beginPath(); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI * 2; g[i ? 'lineTo' : 'moveTo'](S / 2 + Math.cos(a) * 118, S / 2 + Math.sin(a) * 118); } g.closePath();
  g.fillStyle = '#7a3d22'; g.fill(); g.lineWidth = 12; g.strokeStyle = '#f4cd55'; g.stroke();
  outlined(g, '6', S / 2, S / 2 + 6, 170, '#ffe27a', '#4a2412');
  return c;
}
