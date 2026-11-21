import { duelCardCenter } from './duelLayout.js';
import { MAX_PLAYERS, NPC_DIFFICULTIES } from '../config.js';
import { mulberry32, randomSeed } from '../util/rng.js';
import { BoardGame } from './boardGame.js';
import { GUEST_MIIS } from '../world/miic.js';

export const HOST_ID = 'host';

// Placeholder NPC behaviour: wander and click. Difficulty only changes speed for now.
const NPC_SPEED = { Easy: 0.3, Normal: 0.55, Hard: 0.9 };
// A CPU's 1v1 pick, in seconds: it looks at another card until `look`, then moves to its pick and presses from `click` (TIMING.npcDuel ends it).
const NPC_DUEL = { look: 0.8, click: 1.9 };

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
const round3 = (v) => Math.round(v * 1000) / 1000;

/** Mii data from a player (base64, as the Mii creator gives it): kept only if it looks like it; else null. */
export function cleanMii(m) { return typeof m === 'string' && m.length >= 100 && m.length <= 400 && /^[A-Za-z0-9+/=]+$/.test(m) ? m : null; }

export function cleanName(n) {
  return String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

/**
 * The single source of truth. Only the host's browser runs this.
 * A "seat" is one of 6 slots; slot index = player number - 1 = color.
 */
export class HostGame {
  constructor({ seed = randomSeed() } = {}) {
    this.rng = mulberry32(seed);
    this.slots = Array(MAX_PLAYERS).fill(null);
    this.scene = 'lobby';
    this.settings = { pointersInUse: true };
    this.board = null;
  }

  _newSeat(fields) {
    return {
      kind: 'human', key: null, name: '', difficulty: 'Normal', mii: null,
      connId: null, connected: false, wasHuman: false,
      ptr: { x: 0.5, y: 0.5, buttons: 0 }, // buttons: bitmask, 1 = left, 2 = right, 4 = middle
      npc: { tx: 0.5, ty: 0.5, timer: 0 },
      ...fields,
    };
  }

  /** A human arrives (or returns). */
  join(connId, key, name, mii = null) {
    if (typeof key !== 'string' || key.length < 8) {
      return { ok: false, code: 'bad', reason: 'Invalid join request.' };
    }
    // Returning player: give them their old seat back, wherever their NPC left off.
    const old = this.slots.findIndex((s) => s && s.wasHuman && s.key === key);
    if (old !== -1) {
      const seat = this.slots[old];
      if (seat.connected) return { ok: false, code: 'in-use', reason: 'That player is already connected.' };
      seat.kind = 'human'; seat.connId = connId; seat.connected = true;
      const n = cleanName(name); if (n) seat.name = n;
      if (cleanMii(mii)) seat.mii = cleanMii(mii);
      return { ok: true, slot: old, reclaimed: true };
    }
    if (this.scene !== 'lobby') return { ok: false, code: 'started', reason: 'That game has already started.' };
    const free = this.slots.findIndex((s) => !s);
    if (free === -1) return { ok: false, code: 'full', reason: 'That room is full.' };
    this.slots[free] = this._newSeat({
      kind: 'human', key, name: cleanName(name) || `Player ${free + 1}`, mii: cleanMii(mii),
      connId, connected: true, wasHuman: true,
    });
    return { ok: true, slot: free, reclaimed: false };
  }

  /** A human disconnected. Lobby: seat opens up. In game: an NPC (Normal) takes over. */
  leave(connId) {
    const i = this.slots.findIndex((s) => s && s.connId === connId);
    if (i === -1) return false;
    if (this.scene === 'lobby') {
      this.slots[i] = null;
    } else {
      const s = this.slots[i];
      s.kind = 'npc'; s.difficulty = 'Normal'; s.connected = false; s.connId = null;
      s.npc.timer = 0; s.ptr.buttons = 0;
    }
    return true;
  }

  setName(connId, name) {
    const s = this.slots.find((x) => x && x.connId === connId);
    const n = cleanName(name);
    if (!s || !n) return false;
    s.name = n;
    return true;
  }

  addNpc() {
    if (this.scene !== 'lobby') return { ok: false, reason: 'Can only add CPUs in the lobby.' };
    const free = this.slots.findIndex((s) => !s);
    if (free === -1) return { ok: false, reason: 'The room is full.' };
    const used = new Set(this.slots.filter((x) => x && x.kind === 'npc').map((x) => x.guest)), guest = [0, 1, 2, 3, 4, 5].find((g) => !used.has(g)) ?? free % 6;
    this.slots[free] = this._newSeat({ kind: 'npc', name: `CPU ${free + 1}`, guest, mii: GUEST_MIIS[guest] }); // CPUs wear the creator's guest Miis
    return { ok: true, slot: free };
  }

  removeNpc(slot) {
    const s = this.slots[slot];
    if (this.scene !== 'lobby' || !s || s.kind !== 'npc') return false;
    this.slots[slot] = null;
    return true;
  }

  setDifficulty(slot, difficulty) {
    const s = this.slots[slot];
    if (this.scene !== 'lobby' || !s || s.kind !== 'npc' || !NPC_DIFFICULTIES.includes(difficulty)) return false;
    s.difficulty = difficulty;
    return true;
  }

  togglePointersInUse() {
    this.settings.pointersInUse = !this.settings.pointersInUse;
    return this.settings.pointersInUse;
  }

  /** mode: 'board' (the real game) or 'pointerTest' (networking test screen). */
  startGame(mode = 'board', now = 0) {
    if (this.scene !== 'lobby') return { ok: false, reason: 'Already started.' };
    const seated = this.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (seated.length < 2) return { ok: false, reason: 'Add another player or a CPU first.' };
    for (const s of this.slots) {
      if (!s) continue;
      s.ptr = { x: 0.2 + this.rng() * 0.6, y: 0.2 + this.rng() * 0.6, buttons: 0 };
      s.npc = { tx: s.ptr.x, ty: s.ptr.y, timer: 0 };
    }
    if (mode === 'pointerTest') { this.scene = 'pointerTest'; return { ok: true }; }
    this.scene = 'board';
    this.board = new BoardGame({ slots: seated, rng: this.rng, isNpc: (i) => this.slots[i]?.kind === 'npc' });
    return { ok: true, events: this.board.start(now) };
  }

  backToLobby() { this.scene = 'lobby'; this.board = null; }

  setPointer(connId, x, y, buttons) {
    const s = this.slots.find((q) => q && q.connId === connId && q.kind === 'human');
    if (!s) return;
    s.ptr.x = clamp01(x); s.ptr.y = clamp01(y); s.ptr.buttons = (buttons | 0) & 7;
  }

  _slotOf(connId) { return this.slots.findIndex((s) => s && s.connId === connId); }

  /** The player pressed Stop on their spinning dice. */
  requestStop(connId) {
    const slot = this._slotOf(connId);
    return slot !== -1 && !!this.board && this.board.requestStop(slot);
  }

  /** The player picked crates (0) or barrels (1). */
  requestChoice(connId, option) {
    const slot = this._slotOf(connId);
    return slot !== -1 && !!this.board && this.board.requestChoice(slot, option);
  }

  /** Advance the board game (NPC turns, queued human rolls). Returns a turn result or null. */
  tickBoard(now) { return this.scene === 'board' && this.board ? this.board.update(now) : null; }

  /** The 1v1 card choice on screen right now, if any: { slot (the chooser), n (cards) }. */
  cardChoice() {
    const b = this.scene === 'board' && this.board, c = b && b.phase === 'choosing' ? b._control() : null;
    return c && c.slots ? { slot: c.slot, n: c.slots.length } : null;
  }

  tick(dt) {
    const cards = this.cardChoice();
    if (cards) { // a CPU picking a 1v1 opponent: its pointer looks at one card, then goes to the one it picks and clicks it
      const s = this.slots[cards.slot], b = this.board, n = cards.n;
      if (s && s.kind === 'npc') {
        const key = `${b.phaseAt}:${b.round}:${b.turn}:${n}`;
        if (s.npc.duelKey !== key) { // a new choice: decide now, so the pointer can show it
          s.npc.duelKey = key; s.npc.t = 0;
          s.npc.pick = Math.floor(this.rng() * (n - 1));                                   // a real opponent (the last card is the "?")
          s.npc.look = n > 2 ? (s.npc.pick + 1 + Math.floor(this.rng() * (n - 1))) % n : -1; // some other card to look at first
          s.npc.jx = (this.rng() - 0.5) * 0.04; s.npc.jy = (this.rng() - 0.5) * 0.08;
          b.npcPick = s.npc.pick;
        }
        s.npc.t += dt;
        const c = duelCardCenter(s.npc.look >= 0 && s.npc.t < NPC_DUEL.look ? s.npc.look : s.npc.pick, n);
        s.npc.tx = c.x + s.npc.jx; s.npc.ty = c.y + s.npc.jy;
        const k = 1 - Math.exp(-dt * 6);
        s.ptr.x += (s.npc.tx - s.ptr.x) * k; s.ptr.y += (s.npc.ty - s.ptr.y) * k;
        s.ptr.buttons = s.npc.t >= NPC_DUEL.click ? 1 : 0; // the click ring, just before the pick is made
      }
      return;
    }
    if (this.scene !== 'pointerTest') return;
    for (const s of this.slots) {
      if (!s || s.kind !== 'npc') continue;
      s.npc.timer -= dt;
      if (s.npc.timer <= 0) {
        s.npc.tx = this.rng(); s.npc.ty = this.rng();
        s.npc.timer = 0.6 + this.rng() * 1.2;
        { const r = this.rng(); s.ptr.buttons = r < 0.2 ? 1 : r < 0.3 ? 2 : 0; }
      }
      const speed = NPC_SPEED[s.difficulty] ?? NPC_SPEED.Normal;
      const dx = s.npc.tx - s.ptr.x, dy = s.npc.ty - s.ptr.y;
      const d = Math.hypot(dx, dy), step = speed * dt;
      if (d <= step) { s.ptr.x = s.npc.tx; s.ptr.y = s.npc.ty; }
      else { s.ptr.x += (dx / d) * step; s.ptr.y += (dy / d) * step; }
    }
  }

  /** What every client needs to draw the lobby. Never includes keys. */
  roster() {
    return {
      scene: this.scene,
      board: this.scene === 'board' && this.board ? this.board.snapshot() : null,
      settings: { ...this.settings },
      players: this.slots.map((s, i) => (s ? {
        slot: i, name: s.name, kind: s.kind, difficulty: s.difficulty,
        connected: s.connected, wasHuman: s.wasHuman, mii: s.mii || null,
      } : null)),
    };
  }

  /** Compact pointer list sent ~20x/second: [x, y, buttons] per seat, null for empty seats. */
  pointers() {
    return this.slots.map((s) => (s ? [round3(s.ptr.x), round3(s.ptr.y), s.ptr.buttons] : null));
  }
}
