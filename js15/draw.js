import { VIRTUAL } from './config.js';

export function drawBackdrop(g) {
  const grad = g.createLinearGradient(0, 0, 0, VIRTUAL.h);
  grad.addColorStop(0, '#bfe3fa');
  grad.addColorStop(1, '#f3fbff');
  g.fillStyle = grad;
  g.fillRect(0, 0, VIRTUAL.w, VIRTUAL.h);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, r] of [[180, 140, 90], [1080, 110, 130], [960, 600, 170], [240, 640, 120]]) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

/** A player's pointer: arrow in their color, with their number in a badge. */
export function drawPointer(g, x, y, { color, ink, number, alpha = 1, buttons = 0, label = '' }) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.lineJoin = 'round';

  if (buttons & 1) { // left button held: round ring around the tip
    g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2);
    g.strokeStyle = color; g.lineWidth = 5; g.stroke();
  }
  if (buttons & 2) { // right button held: diamond around the tip
    g.beginPath(); g.moveTo(0, -24); g.lineTo(24, 0); g.lineTo(0, 24); g.lineTo(-24, 0); g.closePath();
    g.strokeStyle = '#16324f'; g.lineWidth = 5; g.stroke();
    g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
  }

  g.beginPath();
  g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(9, 26); g.lineTo(16, 41); g.lineTo(23, 37); g.lineTo(16, 23); g.lineTo(28, 23);
  g.closePath();
  g.fillStyle = color; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#16324f'; g.stroke();

  g.beginPath(); g.arc(32, 44, 13, 0, Math.PI * 2);
  g.fillStyle = color; g.fill(); g.stroke();
  g.fillStyle = ink; g.font = 'bold 17px "Trebuchet MS", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(number), 32, 45);

  if (label) {
    g.font = 'bold 18px "Trebuchet MS", sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.strokeText(label, 8, 76);
    g.fillStyle = '#16324f'; g.fillText(label, 8, 76);
  }
  g.restore();
}
