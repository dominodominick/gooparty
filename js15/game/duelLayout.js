// Where the 1v1 opponent cards sit on the 1280x720 stage. Shared by the screens (which draw the cards there) and the
// host (which moves a CPU chooser's pointer over them), so everyone sees the pointer over the same card.
export const DUEL_CARD = { w: 150, h: 216, gap: 24, y: 410 };

/** The middle of card i of n, in 0..1 stage coordinates. */
export function duelCardCenter(i, n) {
  const x = 640 + (i - (n - 1) / 2) * (DUEL_CARD.w + DUEL_CARD.gap);
  return { x: x / 1280, y: DUEL_CARD.y / 720 };
}

/** Which card (0..n-1) a point in 0..1 stage coordinates is over, or -1. */
export function duelCardAt(x, y, n) {
  for (let i = 0; i < n; i++) {
    const c = duelCardCenter(i, n);
    if (Math.abs(x - c.x) * 1280 <= DUEL_CARD.w / 2 && Math.abs(y - c.y) * 720 <= DUEL_CARD.h / 2) return i;
  }
  return -1;
}
