// Thin wrappers around PeerJS. Nothing else in the project touches PeerJS directly,
// so swapping it for Trystero / a WebSocket server later only means editing this file.
import { PEER_OPTIONS, ROOM_PREFIX, ROOM_CODE_LENGTH, NET } from './config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CONN_OPTS = { reliable: true, serialization: 'json' };
// Note: "reliable" is simplest. If pointers feel laggy on bad connections, add a second,
// unreliable channel for the 20-30Hz pointer stream.

export function makeRoomCode() {
  let c = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

const noPeerJs = () => new Error('The networking library (PeerJS) did not load. Check your internet connection.');

/** "Play offline": the same surface as HostNet, with nobody on the other end (the other seats are CPU players). */
export class OfflineNet {
  constructor() { this.code = 'SOLO'; this.onMessage = null; this.onLeave = null; this.onError = null; }
  async open() { return this.code; }
  broadcast() {} send() {} sendTo() {} kick() {} close() {} destroy() {}
}

export class HostNet {
  constructor() {
    this.peer = null; this.code = '';
    this.conns = new Map(); this.seen = new Map();
    this.onMessage = null; this.onLeave = null; this.onError = null;
    this._watch = null;
  }

  async open() {
    for (let i = 0; i < 6; i++) {
      const code = makeRoomCode();
      try {
        await this._tryOpen(code);
        this.code = code; this._start();
        return code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') continue; // someone already uses that code: roll a new one
        throw e;
      }
    }
    throw new Error('Could not reserve a room code. Try again.');
  }

  _tryOpen(code) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(noPeerJs());
      const peer = new Peer(ROOM_PREFIX + code, PEER_OPTIONS);
      const fail = (e) => { clearTimeout(timer); try { peer.destroy(); } catch {} reject(e); };
      const timer = setTimeout(() => fail(Object.assign(
        new Error('Could not reach the PeerJS signaling server. Check your connection and try again.'),
        { type: 'timeout' })), 10000);
      peer.once('open', () => { clearTimeout(timer); peer.off('error', fail); this.peer = peer; resolve(); });
      peer.once('error', fail);
    });
  }

  _start() {
    const peer = this.peer;
    peer.on('error', (e) => this.onError?.(e));
    // If we lose the signaling broker, reconnect so new friends can still find the room.
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('connection', (conn) => {
      conn.on('open', () => { this.conns.set(conn.peer, conn); this.seen.set(conn.peer, Date.now()); });
      conn.on('data', (d) => {
        this.seen.set(conn.peer, Date.now());
        if (d && typeof d === 'object') this.onMessage?.(conn.peer, d);
      });
      const gone = () => {
        if (this.conns.get(conn.peer) === conn) {
          this.conns.delete(conn.peer); this.seen.delete(conn.peer);
          this.onLeave?.(conn.peer);
        }
      };
      conn.on('close', gone); conn.on('error', gone);
    });
    // Drop clients that went silent (closed laptop, lost wifi) even if no "close" event arrives.
    this._watch = setInterval(() => {
      const now = Date.now();
      for (const [id, t] of this.seen) if (now - t > NET.dropAfterMs) this.conns.get(id)?.close();
    }, 2000);
  }

  send(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  kick(id) { this.conns.get(id)?.close(); }

  destroy() {
    clearInterval(this._watch);
    try { this.peer?.destroy(); } catch {}
  }
}

export class ClientNet {
  constructor() {
    this.peer = null; this.conn = null;
    this.onMessage = null; this.onClose = null;
    this._ping = null;
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(noPeerJs());
      const peer = new Peer(PEER_OPTIONS);
      this.peer = peer;
      let settled = false, timer = null;
      const fail = (msg) => {
        if (settled) return; settled = true; clearTimeout(timer);
        try { peer.destroy(); } catch {}
        reject(new Error(msg));
      };
      peer.on('error', (e) => {
        if (!settled) fail(e.type === 'peer-unavailable' ? 'Room not found. Check the code.' : `Connection error (${e.type}).`);
        else this.onClose?.(`Connection error (${e.type}).`);
      });
      peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code, CONN_OPTS);
        this.conn = conn;
        timer = setTimeout(() => fail('Could not connect to the room (timed out). A firewall may be blocking direct connections.'), 12000);
        conn.on('open', () => {
          if (settled) return; settled = true; clearTimeout(timer);
          this._ping = setInterval(() => this.send({ t: 'ping' }), NET.pingEveryMs);
          resolve();
        });
        conn.on('data', (d) => { if (d && typeof d === 'object') this.onMessage?.(d); });
        conn.on('close', () => {
          clearInterval(this._ping);
          if (settled) this.onClose?.('The host closed the room or the connection dropped.');
        });
      });
    });
  }

  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }

  destroy() {
    clearInterval(this._ping);
    try { this.peer?.destroy(); } catch {}
  }
}
