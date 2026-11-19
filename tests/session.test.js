// Runs the REAL Session + net code against a fake in-memory PeerJS, so the join /
// room-code / sync / disconnect / rejoin flow is exercised without a browser.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const registry = new Map(); let auto = 0;
class FakeConn extends EventEmitter {
  constructor(peerId) { super(); this.peer = peerId; this.other = null; this.open = false; }
  send(d) { const o = this.other; const copy = JSON.parse(JSON.stringify(d)); setTimeout(() => o.emit('data', copy), 1); }
  close() {
    if (!this.open) return;
    this.open = false; this.emit('close');
    const o = this.other;
    if (o && o.open) { o.open = false; setTimeout(() => o.emit('close'), 1); }
  }
}
class FakePeer extends EventEmitter {
  constructor(a) {
    super(); this.conns = [];
    this.id = typeof a === 'string' ? a : `anon${++auto}`;
    setTimeout(() => {
      if (registry.has(this.id)) { this.emit('error', Object.assign(new Error('taken'), { type: 'unavailable-id' })); return; }
      registry.set(this.id, this); this.emit('open', this.id);
    }, 1);
  }
  off(e, f) { return this.removeListener(e, f); }
  connect(id) {
    const target = registry.get(id), mine = new FakeConn(id);
    this.conns.push(mine);
    setTimeout(() => {
      if (!target) return this.emit('error', Object.assign(new Error('nf'), { type: 'peer-unavailable' }));
      const theirs = new FakeConn(this.id);
      mine.other = theirs; theirs.other = mine; target.conns.push(theirs);
      target.emit('connection', theirs);
      mine.open = theirs.open = true;
      mine.emit('open'); theirs.emit('open');
    }, 2);
    return mine;
  }
  destroy() { registry.delete(this.id); this.conns.forEach((c) => c.close()); }
}
globalThis.Peer = FakePeer;

const { Session } = await import('../js15/session.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const keyA = 'aaaaaaaaaaaaaaaa', keyB = 'bbbbbbbbbbbbbbbb', keyC = 'cccccccccccccccc';

// host creates a room
const host = await Session.createHost({ name: 'Hana', key: keyA });
assert.match(host.code, /^[A-HJ-NP-Z2-9]{5}$/);

const { BUILD } = await import('../js15/config.js');
assert.equal(host.roster.build, BUILD, 'host announces its build');
// bad code
await assert.rejects(Session.join({ code: 'ZZZZZ', name: 'X', key: keyB }), /Room not found/);

// two friends join
const ben = await Session.join({ code: host.code, name: 'Ben', key: keyB });
const cy = await Session.join({ code: host.code, name: 'Cy', key: keyC });
await wait(30);
assert.equal(ben.mySlot, 1); assert.equal(cy.mySlot, 2);
for (const s of [host, ben, cy]) assert.deepEqual(s.roster.players.map((p) => p && p.name), ['Hana', 'Ben', 'Cy', null, null, null]);

// same browser/key joining twice gets its own seat via the in-use retry
const dup = await Session.join({ code: host.code, name: 'BenTab2', key: keyB });
await wait(30);
assert.equal(dup.mySlot, 3);
dup.close(); await wait(30);
assert.equal(host.roster.players[3], null); // lobby: seat frees up

// non-hosts can't run host actions
assert.equal(ben.startGame().ok, false);

// host adds a CPU and starts
host.addNpc();
assert.equal(host.startGame('pointerTest').ok, true);
await wait(60);
assert.equal(ben.roster.scene, 'pointerTest');

// pointer sync: Ben moves, everyone sees it
ben.sendPointer(0.25, 0.75, true);
await wait(150);
ben.update(1);
for (const s of [host, cy]) { s.update?.(1); const p = s.getPointer(1); assert.ok(Math.abs(p.x - 0.25) < 0.02 && Math.abs(p.y - 0.75) < 0.02, `ptr seen by ${s.role}`); assert.equal(p.buttons, 1); }
assert.equal(ben.getPointer(1).x, 0.25); // own pointer is local

// CPU pointer is visible to clients
await wait(150); cy.update(1);
assert.ok(cy.getPointer(3));

// Ben disconnects mid-game: seat becomes a Normal NPC for everyone
ben.close();
await wait(60);
const seat = host.roster.players[1];
assert.deepEqual([seat.kind, seat.difficulty, seat.connected], ['npc', 'Normal', false]);
assert.equal(cy.roster.players[1].kind, 'npc');

// Ben rejoins with the same key: same seat back
const ben2 = await Session.join({ code: host.code, name: 'Ben', key: keyB });
await wait(60);
assert.equal(ben2.mySlot, 1);
assert.equal(host.roster.players[1].kind, 'human');

// a stranger can't join mid-game
await assert.rejects(Session.join({ code: host.code, name: 'Late', key: 'dddddddddddddddd' }), /already started/);

// host returns everyone to the lobby
host.backToLobby(); await wait(60);
assert.equal(cy.roster.scene, 'lobby');

// ---------- board game over the network ----------
const { DUR, TIMING } = await import('../js15/game/boardGame.js');
Object.assign(DUR, { knock: 5, diceStop: 5, walkStep: 2, fastStep: 2, fly: 5, drop: 5, banner: 5, round: 10, turnIntro: 5, moveTail: 2, cross: 2, swing: 2, vinePause: 2, wall: 5, fire: 5, pit: 5, swim: 5, eruption: 5, minigame: 5, flyover: 5, spring: 5, ufo: 5, statueThrow: 5 });
Object.assign(TIMING, { npcRoll: 5, npcChoose: 5, npcDuel: 5, gap: 5 });

const seen = [];
cy.setTurnHandler((m) => seen.push(m));
host.addNpc();                                   // seat 3
assert.equal(host.startGame('board').ok, true);
await wait(60);
assert.equal(cy.roster.scene, 'board');
assert.equal(cy.board.round >= 1, true);
assert.equal(seen[0].events[0].t, 'roundStart', 'clients get the opening events');
assert.ok(cy.board.tiers && Object.values(cy.board.tiers).includes('gold'), 'dice tiers reach clients');

// let the game run: dice spin on their own, humans press Stop on their turn, NPCs stop themselves
const humans = [host, ben2, cy];
const rolledBy = new Set();
for (let i = 0; i < 400 && !host.game.board.over; i++) {
  await wait(8);
  const cur = host.game.board.current();
  for (const h of humans) if (h.mySlot === cur) { h.stop(); h.choose(0); }
  for (const m of seen) for (const e of m.events) if (e.t === 'diceStop') rolledBy.add(e.slot);
  if (rolledBy.size === host.game.board.players.length && host.game.board.round >= 3) break;
}
assert.equal(rolledBy.size, host.game.board.players.length, 'every seat (humans and CPUs) took turns');
await wait(50);
assert.deepEqual(cy.board.positions, host.game.board.snapshot().positions, 'client sees the same board as the host');
assert.deepEqual(ben2.board.positions, cy.board.positions);

// a client who isn't up can't make a roll happen
const notCur = humans.find((h) => h.mySlot !== host.game.board.current());
notCur.stop(); await wait(5);
assert.equal(host.game.board.stopRequested, false, 'Stop out of turn is ignored');

cy.setTurnHandler(null);
host.backToLobby(); await wait(60);
assert.equal(cy.roster.scene, 'lobby');
assert.equal(cy.board, null);

// host closing the room tells clients
let reason = null; cy.onClosed = (r) => { reason = r; };
host.close(); await wait(60);
assert.match(reason, /host closed/);

for (const s of [ben2, cy]) s.close();
console.log('session tests passed');
process.exit(0);
