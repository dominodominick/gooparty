// Small seeded random generator. The host owns the only one, so every dice roll and tie-break
// is decided in one place and nobody can disagree about it.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomSeed() { return (Math.random() * 2 ** 32) >>> 0; }
