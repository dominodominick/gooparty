// Shared app object. main.js fills in the methods; scenes import this so that
// scenes never need to import each other (keeps every scene independent).
export const app = {
  session: null,
  ui: null,
  canvas: null,     // 2D canvas (menus backdrop, pointer minigames)
  canvas3d: null,   // WebGL canvas (the 3D board)
  renderer: null,   // shared Three.js renderer, created the first time the board opens
  view: { scale: 1, ox: 0, oy: 0, dpr: 1 },
  scene: null,
  sceneName: '',
  scenes: {},
  go() {},
  setSession() {},
  syncScene() {},
  leave() {},
  layout() {},
  toNormalized() { return { x: 0.5, y: 0.5 }; },
};
