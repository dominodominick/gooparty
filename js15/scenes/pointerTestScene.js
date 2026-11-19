import { app } from '../app.js';
import { VIRTUAL, PLAYER_COLORS } from '../config.js';
import { drawPointer } from '../draw.js';

// Placeholder "minigame": proves everyone sees the same screen and every pointer.
// Real minigames will follow this same shape: enter / exit / update / draw / onRoster.
export class PointerTestScene {
  constructor() { this.fixedStage = true; }

  enter() {
    const s = app.session, host = s.role === 'host';
    app.ui.className = 'ui-hud';
    app.ui.innerHTML = `
      <div class="bar hud-bar">
        <strong>Pointer test</strong>
        ${host ? '<button class="btn small ghost" data-act="toggle">Pointers: in use</button>' : ''}
        ${host ? '<button class="btn small ghost" data-act="lobby">Back to lobby</button>' : ''}
        <button class="btn small ghost" data-act="leave">Leave</button>
      </div>`;
    app.ui.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'toggle') s.togglePointersInUse();
      else if (act === 'lobby') s.backToLobby();
      else if (act === 'leave') app.leave();
    };

    const c = app.canvas;
    c.style.cursor = 'none';
    // e.buttons is the live bitmask (1 left, 2 right, 4 middle), so left/right/both are all tracked.
    this.move = (e) => { const p = app.toNormalized(e.clientX, e.clientY); s.sendPointer(p.x, p.y, e.buttons); };
    this.press = this.move; this.release = this.move;
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerdown', this.press);
    c.addEventListener('pointerup', this.release);
    c.addEventListener('pointercancel', this.release);
    this.onRoster();
  }

  exit() {
    const c = app.canvas;
    c.removeEventListener('pointermove', this.move);
    c.removeEventListener('pointerdown', this.press);
    c.removeEventListener('pointerup', this.release);
    c.removeEventListener('pointercancel', this.release);
    c.style.cursor = 'default';
    app.ui.onclick = null;
  }

  onRoster() {
    const t = app.ui.querySelector('[data-act="toggle"]');
    if (t) t.textContent = `Pointers: ${app.session.roster.settings.pointersInUse ? 'in use' : 'idle'}`;
  }

  draw(g) {
    const s = app.session, r = s.roster;
    g.fillStyle = 'rgba(22,50,79,0.35)';
    g.font = 'bold 34px "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.fillText('Move your pointer. Left click = ring, right click = diamond.', VIRTUAL.w / 2, VIRTUAL.h / 2);

    // Your own pointer last, so it's always on top.
    const order = r.players.map((_, i) => i).filter((i) => r.players[i]);
    order.sort((a, b) => (a === s.mySlot) - (b === s.mySlot));
    for (const i of order) {
      const p = s.getPointer(i);
      if (!p) continue;
      const col = PLAYER_COLORS[i], who = r.players[i];
      // Non-host pointers fade out while no minigame is using them.
      const alpha = i === 0 || r.settings.pointersInUse ? 1 : 0.25;
      drawPointer(g, p.x * VIRTUAL.w, p.y * VIRTUAL.h, {
        color: col.hex, ink: col.ink, number: i + 1, alpha, buttons: p.buttons, label: who.name,
      });
    }
  }
}
