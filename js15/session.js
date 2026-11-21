// One object the UI talks to, whether this browser is the host or a client.
// Host: wraps HostGame (the truth) + HostNet. Client: mirrors what the host sends.
import { NET, BUILD } from './config.js';
import { HostGame, HOST_ID, cleanName } from './game/hostGame.js';
import { HostNet, OfflineNet, ClientNet } from './net.js';
import { newKey } from './identity.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export class Session {
  constructor(role) {
    this.role = role;            // 'host' | 'client'
    this.roster = null;          // latest lobby info from the host
    this.board = null;           // latest board snapshot (positions, order, whose turn)
    this._turnHandler = null; this._turnQueue = [];
    this.mySlot = 0;
    this.code = '';
    this.closed = false;
    this.onChange = null;        // roster or scene changed
    this.onClosed = null;        // (reason) connection lost / room closed
    this.localPtr = { x: 0.5, y: 0.5, buttons: 0 };
    this.display = [];           // client: smoothed pointers being drawn
    this.target = [];            // client: latest pointers from host
    this._timers = [];
  }

  // ---------- host ----------
  static async createHost({ name, key, mii = null, offline = false }) {
    const s = new Session('host');
    s.game = new HostGame();
    s.net = offline ? new OfflineNet() : new HostNet();
    s.offline = offline;
    s.paused = false; s.pausedMs = 0; s._pauseAt = null;
    s.code = await s.net.open();
    s.mySlot = s.game.join(HOST_ID, key, name, mii).slot; // host is always slot 0
    s.net.onMessage = (id, msg) => s._hostMessage(id, msg);
    s.net.onLeave = (id) => { if (s.game.leave(id)) s._push(); };

    // Timer (not requestAnimationFrame) so the game keeps running if the host tabs away briefly.
    let last = performance.now(), acc = 0;
    s._timers.push(setInterval(() => {
      const real = performance.now();
      if (s.paused) { s._pauseAt ??= real; last = real; return; } // an offline game on pause: its clock stands still
      if (s._pauseAt != null) { s.pausedMs += real - s._pauseAt; s._pauseAt = null; }
      const now = real - s.pausedMs;
      const dt = Math.min(0.1, (real - last) / 1000); last = real;
      s.game.tick(dt);
      const turn = s.game.tickBoard(now);
      if (turn) s._emitTurn(turn);
      acc += dt;
      if (acc >= 1 / NET.hostBroadcastHz) {
        acc = 0;
        if (s.game.scene === 'pointerTest' || s.game.cardChoice()) s.net.broadcast({ t: 'ptrs', p: s.game.pointers() }); // pointers: the test screen, and the 1v1 cards
      }
    }, 16));
    s.roster = s.game.roster();
    s.roster.build = BUILD;
    return s;
  }

  _push() {
    this.roster = this.game.roster();
    this.roster.build = BUILD;
    this.board = this.roster.board;
    this.net.broadcast({ t: 'roster', roster: this.roster });
    this.onChange?.();
  }

  _hostMessage(id, msg) {
    switch (msg.t) {
      case 'hello': {
        const res = this.game.join(id, msg.key, msg.name, msg.mii);
        if (!res.ok) {
          this.net.send(id, { t: 'rejected', code: res.code, reason: res.reason });
          if (res.code !== 'in-use') setTimeout(() => this.net.kick(id), 300);
          return;
        }
        this.net.send(id, { t: 'welcome', slot: res.slot });
        this._push();
        return;
      }
      case 'ptr': this.game.setPointer(id, msg.x, msg.y, msg.b); return;
      case 'stop': this.game.requestStop(id); return;
      case 'choose': this.game.requestChoice(id, msg.o); return;
      case 'name': if (this.game.setName(id, msg.name)) this._push(); return;
      default: return; // 'ping' etc.
    }
  }

  // ---------- client ----------
  static async join({ code, name, key, mii = null }) {
    const s = new Session('client');
    s.code = code;
    s.net = new ClientNet();
    try {
      await s.net.connect(code);
      s.net.onClose = (reason) => s._closed(reason);
      s.net.onMessage = (msg) => s._clientMessage(msg);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The host did not respond.')), 8000);
        s._welcome = {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: (e) => { clearTimeout(timer); reject(e); },
          retried: false, name, mii,
        };
        s.net.send({ t: 'hello', key, name, mii });
      });
    } catch (e) {
      s.close();
      throw e;
    }
    s._startClientTimers();
    return s;
  }

  _startClientTimers() {
    this._dirty = false;
    this._timers.push(setInterval(() => {
      if (!this._dirty) return;
      this._dirty = false;
      this.net.send({ t: 'ptr', x: r3(this.localPtr.x), y: r3(this.localPtr.y), b: this.localPtr.buttons });
    }, 1000 / NET.clientSendHz));
  }

  _clientMessage(msg) {
    switch (msg.t) {
      case 'welcome': this.mySlot = msg.slot; this._welcome?.resolve(); return;
      case 'rejected': {
        const w = this._welcome;
        // Same browser already seated in this room (e.g. two tabs): retry once as a new player.
        if (msg.code === 'in-use' && w && !w.retried) {
          w.retried = true;
          this.net.send({ t: 'hello', key: newKey(), name: w.name, mii: w.mii });
        } else w?.reject(new Error(msg.reason || 'Could not join.'));
        return;
      }
      case 'roster': this.roster = msg.roster; this.board = msg.roster.board; this.onChange?.(); return;
      case 'turn': this.board = msg.board; this._deliverTurn({ events: msg.events, board: msg.board }); return;
      case 'ptrs':
        this.target = msg.p;
        msg.p.forEach((p, i) => {
          if (p && !this.display[i]) this.display[i] = { x: p[0], y: p[1], buttons: p[2] };
          if (!p) this.display[i] = null;
        });
        return;
      default: return;
    }
  }

  // ---------- shared API ----------
  /** Dev tools (offline games): skip your dice and land straight on a spot. */
  devJump(at) {
    if (this.role !== 'host' || !this.game.board) return false;
    const res = this.game.board.devJump(this.mySlot, at, performance.now() - (this.pausedMs || 0));
    if (res) this._emitTurn(res);
    return !!res;
  }

  /** Pause the game clock. Only an offline game (just you and CPU players) can really be paused. */
  setPaused(on) { if (this.role === 'host' && this.offline) this.paused = !!on; }


  /** Per-frame: smooth other players' pointers on clients. */
  update(dt) {
    if (this.role !== 'client') return;
    const k = 1 - Math.exp(-dt * 20);
    this.target.forEach((t, i) => {
      const d = this.display[i];
      if (!t || !d) return;
      d.x += (t[0] - d.x) * k; d.y += (t[1] - d.y) * k; d.buttons = t[2];
    });
  }

  /** Where to draw a seat's pointer: {x,y,buttons} in 0..1, or null if unknown. */
  getPointer(slot) {
    if (slot === this.mySlot) return this.localPtr;     // your own pointer: no network delay
    if (this.role === 'host') {
      const s = this.game.slots[slot];
      return s ? s.ptr : null;
    }
    return this.display[slot] || null;
  }

  /** buttons: bitmask from a pointer event (1 = left, 2 = right, 4 = middle). */
  sendPointer(x, y, buttons) {
    const b = (buttons | 0) & 7;
    this.localPtr.x = x; this.localPtr.y = y; this.localPtr.buttons = b;
    if (this.role === 'host') this.game.setPointer(HOST_ID, x, y, b);
    else this._dirty = true;
  }

  /** Press Stop on your spinning dice. The host decides the result at that moment. */
  stop() {
    if (this.role === 'host') this.game.requestStop(HOST_ID);
    else this.net.send({ t: 'stop' });
  }

  /** Pick a path at the crates/barrels challenge: 0 or 1. */
  choose(option) {
    if (this.role === 'host') this.game.requestChoice(HOST_ID, option);
    else this.net.send({ t: 'choose', o: option });
  }

  // ----- board turns -----
  // The host resolves a whole turn at once and sends it as a list of events; every screen plays them back.
  _emitTurn(res) {
    this.board = res.board;
    this.net.broadcast({ t: 'turn', events: res.events, board: res.board });
    this._deliverTurn(res);
  }

  _deliverTurn(m) {
    if (this._turnHandler) this._turnHandler(m);
    else this._turnQueue.push(m); // the board scene isn't open yet: hold until it is
  }

  setTurnHandler(fn) {
    this._turnHandler = fn || null;
    if (fn) while (this._turnQueue.length) fn(this._turnQueue.shift());
  }

  setName(name) {
    const n = cleanName(name);
    if (!n) return;
    if (this.role === 'host') { this.game.setName(HOST_ID, n); this._push(); }
    else this.net.send({ t: 'name', name: n });
  }

  startGame(mode = 'board') {
    if (this.role !== 'host') return { ok: false, reason: 'Only the host can do that.' };
    const res = this.game.startGame(mode, performance.now() - (this.pausedMs || 0));
    this._push();
    if (res.ok && res.events) this._emitTurn({ events: res.events, board: this.game.board.snapshot() });
    return res;
  }

  // host-only actions (clients can't trigger these: the host ignores such messages)
  addNpc()                { return this._hostDo(() => this.game.addNpc()); }
  removeNpc(slot)         { return this._hostDo(() => this.game.removeNpc(slot)); }
  setDifficulty(slot, d)  { return this._hostDo(() => this.game.setDifficulty(slot, d)); }
  backToLobby()           { return this._hostDo(() => this.game.backToLobby()); }
  togglePointersInUse()   { return this._hostDo(() => this.game.togglePointersInUse()); }

  _hostDo(fn) {
    if (this.role !== 'host') return { ok: false, reason: 'Only the host can do that.' };
    const res = fn();
    this._push();
    return res;
  }

  _closed(reason) {
    if (this.closed) return;
    this.closed = true;
    this._timers.forEach(clearInterval);
    this.onClosed?.(reason);
  }

  close() {
    this.closed = true;
    this._timers.forEach(clearInterval);
    this.net?.destroy();
  }
}
