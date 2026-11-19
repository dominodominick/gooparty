import assert from 'node:assert/strict';
import { HostGame, HOST_ID, cleanName } from '../js15/game/hostGame.js';

const K = (n) => `key-${n}-xxxxxxxxxx`;
let g = new HostGame({ seed: 1 });

// join / colors / slots
assert.equal(g.join(HOST_ID, K(0), 'Hana').slot, 0);
assert.equal(g.join('b', K(1), 'Ben').slot, 1);
assert.equal(g.join('c', K(2), '').slot, 2);
assert.equal(g.roster().players[2].name, 'Player 3');
assert.equal(g.join('x', 'short', 'Bad').ok, false);

// room fills up at 6 (humans + NPCs together)
assert.equal(g.addNpc().ok, true); // slot 3
assert.equal(g.addNpc().ok, true); // slot 4
assert.equal(g.addNpc().ok, true); // slot 5
assert.equal(g.addNpc().ok, false);
assert.equal(g.join('z', K(9), 'Zed').code, 'full');

// difficulty only on NPCs, only valid values
assert.equal(g.setDifficulty(3, 'Hard'), true);
assert.equal(g.setDifficulty(3, 'Nightmare'), false);
assert.equal(g.setDifficulty(1, 'Hard'), false);
assert.equal(g.removeNpc(5), true);

// start
assert.equal(g.startGame('pointerTest').ok, true);
assert.equal(g.scene, 'pointerTest');
assert.equal(g.addNpc().ok, false);                    // lobby-only
assert.equal(g.join('late', K(8), 'Late').code, 'started');

// pointers: humans move via input, clamped
g.setPointer('b', 2, -1, true);
assert.deepEqual(g.pointers()[1], [1, 0, 1]);        // left button
g.setPointer('b', 0.5, 0.5, 2 | 1);
assert.equal(g.pointers()[1][2], 3);                  // left + right held together
g.setPointer('b', 2, -1, true);

// NPCs move on tick, humans don't
const before = g.pointers()[3], humanBefore = g.pointers()[1];
for (let i = 0; i < 30; i++) g.tick(0.05);
assert.notDeepEqual(g.pointers()[3], before);
assert.deepEqual(g.pointers()[1], humanBefore);

// disconnect mid-game: NPC (Normal) takes over, seat kept
assert.equal(g.leave('b'), true);
let p = g.roster().players[1];
assert.equal(p.kind, 'npc'); assert.equal(p.difficulty, 'Normal'); assert.equal(p.connected, false); assert.equal(p.wasHuman, true);
assert.equal(g.leave('b'), false); // idempotent

// NPC keeps moving where it was; rejoin takes the same seat back
for (let i = 0; i < 20; i++) g.tick(0.05);
const npcPos = g.pointers()[1];
assert.notDeepEqual(npcPos, [1, 0, 1]);
const back = g.join('b2', K(1), 'Ben');
assert.deepEqual([back.ok, back.slot, back.reclaimed], [true, 1, true]);
assert.equal(g.roster().players[1].kind, 'human');

// same key twice at once -> 'in-use' (client then retries as new player)
assert.equal(g.join('b3', K(1), 'Ben').code, 'in-use');

// lobby: leaving frees the seat
g.backToLobby();
assert.equal(g.leave('c'), true);
assert.equal(g.roster().players[2], null);

// roster never leaks keys
assert.ok(!JSON.stringify(g.roster()).includes('key-'));

// start needs 2+ seats
const solo = new HostGame();
solo.join(HOST_ID, K(0), 'Solo');
assert.equal(solo.startGame().ok, false);

assert.equal(cleanName('  <b>Hi</b>\n  '), 'bHi/b');
assert.equal(cleanName('x'.repeat(40)).length, 12);

// the 1v1 cards: a CPU chooser's pointer moves over the cards (and the cards are where everyone draws them)
{
  const { duelCardCenter, duelCardAt } = await import('../js15/game/duelLayout.js');
  for (let n = 2; n <= 6; n++) for (let i = 0; i < n; i++) { const c = duelCardCenter(i, n); assert.equal(duelCardAt(c.x, c.y, n), i); }
  assert.equal(duelCardAt(0.02, 0.02, 4), -1);
  const h = new HostGame({ seed: 3 }); h.join(HOST_ID, K(0), 'Hana'); h.addNpc(); h.addNpc();
  h.startGame('board');
  const b = h.board, slot = 1, m = b.constructor && 0;
  b.phase = 'choosing'; b.turn = b.order.indexOf(slot); b.step = { kind: 'choice', purpose: 'duel', options: [0, 2] };
  const cc = h.cardChoice();
  assert.ok(cc && cc.slot === slot && cc.n === 3, 'a 1v1 pick is on screen');
  const visited = new Set();
  for (let t = 0; t < 600; t++) { h.tick(1 / 60); const p = h.slots[slot].ptr, k = duelCardAt(p.x, p.y, 3); if (k >= 0) visited.add(k); }
  assert.ok(visited.size >= 2, `the CPU's pointer goes from card to card (${[...visited]})`);
  // ...and it ends on the card it picks (a real opponent, never the "?"), pressing the button; the board is told which one
  const end = h.slots[slot].ptr, on = duelCardAt(end.x, end.y, 3);
  assert.ok(on === 0 || on === 1, `the pointer rests on an opponent's card (${on})`);
  assert.equal(b.npcPick, on, 'the board picks the card under the pointer');
  assert.equal(end.buttons, 1, 'the pointer shows the click');
  // a fresh choice starts over: no click yet
  b.phaseAt = 12345; h.tick(1 / 60);
  assert.equal(h.slots[slot].ptr.buttons, 0);
  // with one opponent there is only one card to go to
  b.step = { kind: 'choice', purpose: 'duel', options: [2] }; b.phaseAt = 777;
  for (let t = 0; t < 150; t++) h.tick(1 / 60);
  assert.equal(duelCardAt(h.slots[slot].ptr.x, h.slots[slot].ptr.y, 2), 0); assert.equal(b.npcPick, 0);
  void m;
}
console.log('hostGame tests passed');
