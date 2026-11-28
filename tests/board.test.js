import assert from 'node:assert/strict';
import {
  ISLAND, VOLCANO, FINAL_IDX, FINISH_IDX, VOLCANO_SPACE_IDX, VOLCANO_CHALLENGE_IDX, SPIKE_IDX, isChallenge,
} from '../js15/game/boardData.js';
import { islandPositions, volcanoPositions } from '../js15/game/boardLayout.js';
import { GAPS } from '../js15/game/boardData.js';
import {
  BoardGame, walkForward, walkBack, spacesToGo, rollDie, CURVE_MAX, TIERS, DUR, DROP, TIMING, SPIKE_START,
} from '../js15/game/boardGame.js';
import { mulberry32 } from '../js15/util/rng.js';

// ---------- data matches the wiki ----------
assert.equal(ISLAND.length, 80);
assert.equal(ISLAND[0].type, 'start'); assert.equal(FINAL_IDX, 78); assert.equal(FINISH_IDX, 79);
assert.deepEqual(ISLAND.map((n, i) => (isChallenge(n.type) ? i : -1)).filter((i) => i >= 0), [7, 24, 42, 49, 61]);
assert.equal(ISLAND[VOLCANO_SPACE_IDX].type, 'volcano');
assert.equal(VOLCANO.length, 10); assert.equal(VOLCANO[9].type, 'exit');
assert.equal(SPIKE_IDX - VOLCANO_CHALLENGE_IDX - 1, 11, 'run-back of 11 lands right after the volcano challenge');

// ---------- movement rules ----------
const I = (idx) => ({ track: 'island', idx });
assert.equal(walkBack(I(45), 18).end.idx, 26, 'red statue lands on the tile the wiki names');
assert.equal(walkForward(I(28), 18).end.idx, 47, 'blue statue #1');
assert.equal(walkForward(I(30), 16).end.idx, 47, 'blue statue #2 (16 spaces)');
assert.equal(walkForward(I(6), 3).end.idx, 10, 'effect moves pass challenge spaces freely');
const stopped = walkForward(I(6), 3, { stopAtChallenges: true });
assert.deepEqual([stopped.end.idx, stopped.challenge, stopped.remaining], [7, 'vine', 3], 'dice moves stop ON a challenge');
assert.equal(walkForward(I(77), 9).end.idx, FINAL_IDX, "can't pass the final challenge");
assert.equal(walkBack(I(2), 9).end.idx, 0, 'stops at start');
const ve = walkForward({ track: 'volcano', idx: 6 }, 6);
assert.equal(ve.exited, true); assert.equal(ve.end.idx, 9);
assert.equal(spacesToGo(I(FINAL_IDX)), 0);
assert.ok(spacesToGo(I(0)) > spacesToGo(I(40)));
assert.equal(spacesToGo({ track: 'volcano', idx: 9 }), spacesToGo(I(47)), 'the volcano lets you out at the map\'s space 44');

// ---------- dice ----------
const rng = mulberry32(7);
let sum0 = 0, sumC = 0, n = 200000;
for (let i = 0; i < n; i++) { sum0 += rollDie(rng, 0); sumC += rollDie(rng, CURVE_MAX); }
assert.ok(Math.abs(sum0 / n - 3.5) < 0.02, 'fair die averages 3.5');
assert.ok(sumC / n > 3.55 && sumC / n < 3.8, 'curved die leans (slightly) high');

// ---------- test driver ----------
const dieR = (v) => (v - 0.5) / 6; // rng value that makes a fair die show v
function scripted(...vals) { let i = 0; return () => (i < vals.length ? vals[i++] : 0.5); }
function game(slots = [0, 1], tiers = false) {
  const g = new BoardGame({ slots, rng: mulberry32(1), isNpc: () => false });
  g.start(0);
  g.order = [...slots]; g.turn = 0; g.step = null;
  g.curves = Object.fromEntries(slots.map((s) => [s, null]));
  g.tiers = Object.fromEntries(slots.map((s) => [s, null]));
  if (tiers) { g.tiers[slots[0]] = 'gold'; g.curves[slots[0]] = 0.1; }
  return g;
}
/** Dice spin (diceStart), the player presses Stop, the dice land (diceStop + whatever follows). */
function roll(g, ...vals) {
  const start = g.update(g.readyAt + 1);
  assert.ok(start && start.events.some((e) => e.t === 'diceStart'), 'dice start spinning on their own');
  assert.equal(g.update(g.readyAt + 2), null, 'nothing happens until Stop');
  g.rng = scripted(...vals.map(dieR));
  assert.equal(g.requestStop(g.current()), true);
  return g.update(g.readyAt + 3);
}
const kinds = (r) => r.events.map((e) => e.t);
const ev1 = (r, t) => r.events.find((e) => e.t === t);

// ---------- basic turns ----------
let g = game();
let r = roll(g, 1);                                   // start -> 1 (+5) -> 6
assert.deepEqual(g.positions[0], I(6));
assert.deepEqual(kinds(r), ['diceStop', 'move', 'space', 'move']);
assert.equal(g.current(), 1, 'turn passes on');

g = game(); g.positions[0] = I(43); roll(g, 2);       // 44,45 = red statue -> back 18 -> 26
assert.deepEqual(g.positions[0], I(26));

g = game(); g.positions[0] = I(27); r = roll(g, 2);   // 28,29 = skull -> volcano
assert.deepEqual(g.positions[0], { track: 'volcano', idx: 0 });
assert.ok(r.events.some((e) => e.t === 'move' && e.mode === 'drop'));

assert.deepEqual(g.volcanoReturn[0], I(29), 'a skull lets you back out on that skull');
g = game(); g.positions[0] = { track: 'volcano', idx: 0 }; g.volcanoReturn[0] = I(29); roll(g, 4); // shout -> back where they went in
assert.deepEqual(g.positions[0], I(29));
assert.equal(g.volcanoReturn[0], undefined);
g = game(); g.positions[0] = { track: 'volcano', idx: 6 }; g.volcanoReturn[0] = I(29); roll(g, 3); // 7, 8, out: nothing left
assert.deepEqual(g.positions[0], I(29), 'out exactly: on the spot they went in');
g = game(); g.positions[0] = { track: 'volcano', idx: 6 }; g.volcanoReturn[0] = I(29); r = roll(g, 5); // 7, 8, out, then 2 more
assert.deepEqual(g.positions[0], I(31), 'the rest of the roll is walked after coming out');
{ const mv = r.events.filter((e) => e.t === 'move'); assert.deepEqual(mv.map((e) => e.mode), ['walk', 'drop', 'walk']); assert.deepEqual(mv[2].count, { total: 2, dir: 'fwd' }); }
g = game(); g.positions[0] = { track: 'volcano', idx: 8 }; roll(g, 1); // nobody recorded (older saves): the old way out
assert.deepEqual(g.positions[0], I(47));
g = game(); g.positions[0] = { track: 'volcano', idx: 8 }; g.volcanoReturn[0] = I(47); roll(g, 4); // 48, then stops at the volcano-or-not star
assert.equal(g.step.purpose, 'volcanoOrNot', 'the walk after the volcano stops at challenges like any roll');
g = game(); roll(g, 2);                                // blank
assert.deepEqual(g.positions[0], I(2));
g = game(); g.positions[0] = I(8); roll(g, 2);         // +6 at 10 -> 16 (ufo): no chaining
assert.deepEqual(g.positions[0], I(16));

// fly/drop animations are long enough to see where you landed
assert.ok(DUR.fly >= 2400 && DUR.drop >= 1800);

// ---------- dice: rank tiers, doubles ----------
g = new BoardGame({ slots: [0, 1, 2, 3, 4, 5], rng: mulberry32(3) }); g.start(0);
assert.deepEqual(g.order.map((s) => g.tiers[s]), [...TIERS, null], '1st gold, 2nd platinum, 3rd silver, 4th copper, 5th wood, last none');
g = new BoardGame({ slots: [0, 1, 2, 3], rng: mulberry32(3) }); g.start(0);
assert.deepEqual(g.order.map((s) => g.tiers[s]), ['gold', 'platinum', 'silver', null]);
const cv = g.order.map((s) => g.curves[s]);
assert.ok(cv[0] > cv[1] && cv[1] > cv[2] && cv[2] > 0 && cv[3] === null && cv[0] === CURVE_MAX);

g = game([0, 1], true);                               // gold die for player 0
g.rng = scripted(dieR(3), 0.5);
const first = g.update(g.readyAt + 1);
assert.deepEqual(ev1(first, 'diceStart').dice.map((d) => [d.kind, d.tier]), [['base', undefined], ['bonus', 'gold']]);
g.requestStop(0);
r = g.update(g.readyAt + 2);
const dice = r.events[0].dice;
assert.equal(dice[0].kind, 'base'); assert.equal(dice[1].tier, 'gold');
if (dice[0].v === dice[1].v) { assert.equal(r.events[0].doubles, true); assert.equal(dice.length, 3); assert.equal(dice[2].kind, 'extra'); }
assert.ok(!game().update(1) || true);
g = game(); const only = g.update(g.readyAt + 1);
assert.equal(ev1(only, 'diceStart').dice.length, 1, 'last place: a single die');

// ---------- challenges ----------
// Vine swing: never fails; the roll is bonus spaces on top of what was left
g = game(); g.positions[0] = I(5); r = roll(g, 2);     // 6, then vine(7) with 1 left
assert.deepEqual(g.positions[0], I(7)); assert.equal(g.step.purpose, 'vine'); assert.equal(g.current(), 0, 'same player continues');
r = roll(g, 3);                                        // +3 bonus -> 4 spaces from 7: 8,9,10,11
assert.deepEqual(g.positions[0], I(11)); assert.equal(g.current(), 1);

// Dragon wall: needs 4+; fail = back one space
g = game(); g.positions[0] = I(22); roll(g, 2);        // 23, dragon(24)
assert.equal(g.step.purpose, 'dragon');
r = roll(g, 3);
assert.deepEqual(g.positions[0], I(23), 'fireball pushes back a space'); assert.equal(g.current(), 1);
{ const evs = r.events, fi = evs.findIndex((e) => e.fx === 'fireball'), mv = evs.filter((e) => e.t === 'move');
  assert.ok(fi >= 0, 'the dragon spits its fireball');
  assert.equal(mv.length, 1, 'one move after it: no walking about');
  assert.equal(mv[0].mode, 'knock'); assert.deepEqual(mv[0].path, [I(23)], 'blown straight back onto the space behind');
  assert.ok(evs.indexOf(mv[0]) > fi, 'after the fireball hits'); assert.equal(mv[0].dur, DUR.knock); }
g = game(); g.positions[0] = I(22); roll(g, 2); roll(g, 4);
assert.deepEqual(g.positions[0], I(25), 'pass: continue with the 1 space left');

// Volcano or Not: needs 3+; fail = into the volcano
g = game(); g.positions[0] = I(47); roll(g, 3);        // 48, volcano challenge(49) with 2 left
assert.equal(g.step.purpose, 'volcanoOrNot');
roll(g, 2);
assert.deepEqual(g.positions[0], { track: 'volcano', idx: 0 });
assert.deepEqual(g.volcanoReturn[0], { ...I(VOLCANO_CHALLENGE_IDX), across: true }, 'pushed into the pit: they come back out past it, on the spot short of the next space');
assert.equal(spacesToGo(g.positions[0], g.volcanoReturn[0]), spacesToGo(I(VOLCANO_CHALLENGE_IDX + 1)) + 1 + 9, 'that spot is not a space: the space after it is still to go');
g = game(); g.positions[0] = I(47); roll(g, 3); roll(g, 3);
assert.ok(g.positions[0].track === 'island' && g.positions[0].idx > 49, 'pass: keep going');

// Crates or barrels: a choice, 50/50, fail = swim across with no spaces left
g = game(); g.positions[0] = I(40); roll(g, 3);        // 41, crates(42) with 2 left
assert.equal(g.step.purpose, 'crates');
let begin = g.update(g.readyAt + 1);
assert.ok(ev1(begin, 'choiceStart'));
assert.equal(g.update(g.readyAt + 2), null, 'waits for the player to pick');
assert.equal(g.requestChoice(1, 0), false, 'only the current player can pick');
assert.equal(g.requestChoice(0, 0), true);
g.rng = scripted(0.1);                                 // safe path = 0 -> picked right
r = g.update(g.readyAt + 3);
assert.ok(g.positions[0].idx > 43, 'safe: crossed and kept moving');
g = game(); g.positions[0] = I(40); roll(g, 3); g.update(g.readyAt + 1);
g.requestChoice(0, 0); g.rng = scripted(0.9);          // safe path = 1 -> picked wrong
g.update(g.readyAt + 2);
assert.deepEqual(g.positions[0], { ...I(42), across: true }, 'broke: swims to the far bank and stands there, short of the next space; the rest is wasted');
{ const h = game(); h.positions[0] = I(40); roll(h, 3); h.update(h.readyAt + 1); h.requestChoice(0, 0); h.rng = scripted(0.9);
    const res = h.update(h.readyAt + 2), mv = res.events.find((e) => e.t === 'move' && e.slot === 0);
    assert.ok(mv && mv.swim && mv.stopShort && mv.path.length === 1 && mv.path[0].idx === 43 && mv.to.idx === 42 && mv.to.across && !mv.count, 'the swim heads for the next space but stops on the bank; no space is counted');
    // next turn: the first step is the space after the pool, and it counts
    const w = walkForward(h.positions[0], 1); assert.equal(w.end.idx, 43, 'one step from the bank is the next space'); }
assert.equal(g.current(), 1);

{ // which crate (or barrel) breaks on a wrong pick is random: every one of the three comes up
  const seen = new Set();
  for (let seed = 1; seed < 80; seed++) { const h = game(); h.positions[0] = I(40); roll(h, 3); h.update(h.readyAt + 1); h.requestChoice(0, 0); h.rng = mulberry32(seed);
    const res = h.update(h.readyAt + 2), n = res && res.events.find((e) => e.fx === 'crates' && !e.safe); if (n) seen.add(n.hit); }
  assert.deepEqual([...seen].sort(), [0, 1, 2], 'any of the three can be the one that breaks');
}

// Spike ball: needs 5+ first, then easier; failing sends the roller AND everyone below back
g = game([0, 1, 2]); g.positions[0] = I(59); g.positions[1] = I(55); g.positions[2] = I(70);
roll(g, 3);                                            // 60, spike(61) with 2 left
assert.equal(g.step.purpose, 'spike'); assert.equal(g.spikeNeeds, SPIKE_START);
r = roll(g, 4);                                        // 4 < 5: fail
assert.deepEqual(g.positions[0], { ...I(VOLCANO_CHALLENGE_IDX), across: true }, 'chased back to the spot past the volcano pit, short of the space after it');
assert.deepEqual(g.positions[1], { ...I(VOLCANO_CHALLENGE_IDX), across: true }, 'a player in the ball’s path runs back too');
for (const sl of [0, 1]) { const mv = r.events.find((e) => e.t === 'move' && e.slot === sl);
  assert.ok(mv.stopShort && mv.to.across && mv.path[mv.path.length - 1].idx === VOLCANO_CHALLENGE_IDX + 1, 'the run goes past that space and stops on the spot'); }
assert.equal(walkForward(g.positions[0], 1).end.idx, VOLCANO_CHALLENGE_IDX + 1, 'the next roll counts that space first');
{ // and that walk is an ordinary one: no extra time for the tunnel it has already come through
  const h = game(); h.positions[0] = { ...I(VOLCANO_CHALLENGE_IDX), across: true }; const res = roll(h, 2), mv = res.events.find((e) => e.t === 'move' && e.slot === 0);
  assert.equal(mv.dur, 2 * DUR.walkStep + DUR.moveTail, 'two plain steps from the spot past the pit'); }
assert.deepEqual(g.positions[2], I(70), 'players already past it are safe');
assert.equal(g.spikeNeeds, SPIKE_START - 1);
assert.ok(r.events.some((e) => e.t === 'move' && e.slot === 1 && e.with === true), 'they run at the same time as the roller');
{ const evs = r.events, mv0 = evs.findIndex((e) => e.t === 'move' && e.slot === 0), mv1 = evs.findIndex((e) => e.t === 'move' && e.slot === 1), cnt = evs.findIndex((e) => e.fx === 'spikeCount');
  assert.ok(mv1 === mv0 + 1, 'right after the roller\'s run (so they play together)');
  assert.ok(cnt > mv1 && evs[cnt].from === SPIKE_START && evs[cnt].to === SPIKE_START - 1 && evs[cnt].dur === DUR.spikeCount, 'then the number beside the statue counts down'); }
g = game(); g.spikeNeeds = 2; g.positions[0] = I(59); roll(g, 3); roll(g, 2);
assert.ok(g.positions[0].idx > 61, 'needs only 2+ after enough failures');
g = game(); for (let i = 0; i < SPIKE_START - 1; i++) { g.positions[0] = I(59); g.turn = 0; g.step = null; roll(g, 3); r = roll(g, 1); }
assert.equal(g.spikeNeeds, 2, 'down to 2+ after three failures, and no lower');
assert.ok(r.events.every((e) => e.fx !== 'spikeCount'), 'at 2 the number stays: no count-down');
g.positions[0] = I(59); g.turn = 0; g.step = null; roll(g, 3); r = roll(g, 2);
assert.ok(g.positions[0].idx > 61 || g.broken.spike, 'a 2 gets through then');

// ---------- final challenge ----------
// arriving: one immediate single die; a 6 wins
g = game(); g.positions[0] = I(76); r = roll(g, 2);    // 77, 78 = final
assert.deepEqual(g.positions[0], I(FINAL_IDX));
assert.equal(g.step.purpose, 'final'); assert.equal(g.current(), 0, 'rolls right away');
const lab = g.update(g.readyAt + 1);
assert.equal(ev1(lab, 'diceStart').dice.length, 1, 'one die, even with a rank die');
g.requestStop(0); g.rng = scripted(dieR(6)); r = g.update(g.readyAt + 2);
assert.equal(g.over, true); assert.equal(g.winner, 0);
assert.ok(kinds(r).includes('win'));

// missing it: stay put until next round, then the full dice count
g = game([0, 1], true); g.positions[0] = I(76); roll(g, 1);   // gold player: 1 + gold die
if (g.positions[0].idx !== FINAL_IDX) { g.positions[0] = I(FINAL_IDX); g.step = { kind: 'single', purpose: 'final' }; g.turn = 0; }
roll(g, 5);                                           // single die: 5 -> not enough
assert.equal(g.over, false); assert.deepEqual(g.positions[0], I(FINAL_IDX));
assert.equal(g.current(), 1, 'turn moves on');
g = game([0, 1], true); g.positions[0] = I(FINAL_IDX);  // next round: already waiting at final
const attempt = g.update(g.readyAt + 1);
assert.equal(ev1(attempt, 'diceStart').dice.length, 2, 'now both dice');
g.rng = scripted(dieR(2), 0.99); g.requestStop(0);      // 2 + high gold die >= 6
r = g.update(g.readyAt + 2);
assert.equal(g.over, true, 'two dice win it');


// ---------- new in this round ----------
// a new turn starts with a fade + name; later steps of the same turn don't
g = game(); let st = g.update(g.readyAt + 1);
assert.deepEqual(kinds(st), ['turnStart', 'diceStart']);
g.requestStop(0); g.update(g.readyAt + 2);
g.positions[1] = I(22); g.requestStop(1);
// dragon wall breaks for everyone once one player breaks it
g = game(); g.positions[0] = I(22); roll(g, 2); r = roll(g, 4);
assert.equal(ev1(r, 'broken').slot, 0, 'the smash says who does it (so everyone sees them do it)');
assert.equal(g.broken.dragon, true); assert.equal(g.snapshot().broken.dragon, true);
g.positions[1] = I(22); g.turn = 1; g.step = null;
r = roll(g, 3);                                       // 23, 24 (broken dragon: free), 25, 26
assert.equal(g.step, null, 'no challenge any more'); assert.deepEqual(g.positions[1], I(26));
assert.ok(!kinds(r).includes('broken'));
// the other walls are not affected
assert.equal(g.broken.spike, undefined);
assert.equal(walkForward(I(22), 3, { stopAtChallenges: true, broken: { dragon: true } }).end.idx, 26);

// doubles: the bonus die is its own Stop
g = game([0, 1], true);
g.update(g.readyAt + 1); g.rng = scripted(dieR(3), 0.4167); g.requestStop(0);   // base 3, gold lands on 3 too
r = g.update(g.readyAt + 2);
const first2 = ev1(r, 'diceStop');
if (first2.dice[0].v === first2.dice[1].v) {
  assert.equal(first2.partial, true); assert.equal(g.current(), 0, 'same player');
  assert.deepEqual(g.positions[0], I(0), 'no movement yet');
  const again = g.update(g.readyAt + 1);
  const ds = ev1(again, 'diceStart');
  assert.deepEqual([ds.add, ds.dice.map((d) => d.kind), ds.landed.length], [true, ['extra'], 2], 'a single bonus die joins the two that landed');
  assert.equal(g.update(g.readyAt + 2), null, 'waits for Stop');
  g.rng = scripted(dieR(4)); g.requestStop(0);
  r = g.update(g.readyAt + 3);
  const ex = ev1(r, 'diceStop');
  assert.deepEqual([ex.add, ex.dice.length, ex.total], [true, 1, first2.total + 4]);
  assert.equal(g.positions[0].idx > 0, true, 'moves only after the 3rd die');
} else assert.fail('script should have produced doubles');

// choice buttons are cleared when the choice resolves
g = game(); g.positions[0] = I(40); roll(g, 3); g.update(g.readyAt + 1); g.requestChoice(0, 0);
r = g.update(g.readyAt + 2);
assert.ok(ev1(r, 'choiceStop'), 'screens are told to remove the Crates/Barrels buttons');

// movement counters: total + direction, for dice moves, space effects and run-backs
g = game(); g.positions[0] = I(8); r = roll(g, 2);
let mv = r.events.filter((e) => e.t === 'move');
assert.deepEqual(mv[0].count, { total: 2, dir: 'fwd' });
assert.deepEqual(mv[1].count, { total: 6, dir: 'fwd' }, '+6 space');
g = game(); g.positions[0] = I(59); roll(g, 3); r = roll(g, 1);                   // spike fail
assert.deepEqual(r.events.find((e) => e.t === 'move').count, { total: 11, dir: 'back' });
g = game(); g.positions[0] = I(27); r = roll(g, 2);
assert.equal(r.events.find((e) => e.mode === 'drop').count, undefined, 'drops show no counter');

// the volcano drop leaves the camera a few seconds before the black fade
assert.ok(DROP.hold >= 2000, 'camera stays put for a couple of seconds');
assert.equal(DUR.drop, Object.values(DROP).reduce((a, b) => a + b, 0));

// ---------- full simulated games: NPCs only, must finish ----------
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const sim = new BoardGame({ slots: [0, 1, 2, 3, 4, 5], rng: mulberry32(seed), isNpc: () => true });
  let now = 0; sim.start(now);
  let results = 0; const seen = new Set();
  while (!sim.over && results < 60000) {
    now += 1e7;
    const res = sim.update(now);
    if (!res) continue;
    results++;
    for (const e of res.events) {
      seen.add(e.t);
      if (e.t === 'move') for (const p of e.path) assert.ok(p.idx >= 0 && p.idx < (p.track === 'island' ? 80 : 10), 'path inside board');
    }
  }
  assert.ok(sim.over, `game ${seed} finished`);
  assert.ok(sim.round >= 3, 'takes several rounds');
  for (const k of ['flyover', 'roundStart', 'diceStart', 'diceStop', 'move', 'win']) assert.ok(seen.has(k), k);
}

// ---------- humans wait for the animation; NPCs think, then stop ----------
const tg = new BoardGame({ slots: [0, 1], rng: mulberry32(9), isNpc: (s) => s === 1 });
tg.start(0); tg.order = [0, 1]; tg.turn = 0;
assert.equal(tg.update(DUR.round - 1), null, 'still animating the round start');
assert.ok(ev1(tg.update(tg.readyAt), 'diceStart'));
assert.equal(tg.requestStop(1), false, 'not your turn');
tg.requestStop(0); tg.rng = scripted(dieR(2)); // lands on a plain space, so the turn passes on
assert.ok(tg.update(tg.readyAt + 1).events.some((e) => e.t === 'diceStop'));
const t0 = tg.readyAt;
assert.ok(ev1(tg.update(t0), 'diceStart'));
const dd = DUR.turnIntro;
assert.equal(tg.update(t0 + dd + TIMING.npcRoll - 5), null, 'CPU lets the dice spin a moment (after the fade intro)');
assert.ok(tg.update(t0 + dd + TIMING.npcRoll + 5).events.some((e) => e.t === 'diceStop'), 'then stops them');
// a human who walks away does not freeze the game
const afk = new BoardGame({ slots: [0, 1], rng: mulberry32(2), isNpc: () => false });
afk.start(0); afk.order = [0, 1]; afk.turn = 0;
const a0 = afk.readyAt; afk.update(a0);
assert.ok(afk.update(a0 + DUR.turnIntro + TIMING.autoStop + 1).events.some((e) => e.t === 'diceStop'));
// a stop pressed outside a roll is ignored (can't pre-stop the next dice)
assert.equal(afk.requestStop(afk.current()), false);

// ---------- snapshot lets a returning player catch up ----------
g = game(); g.update(g.readyAt + 1);
const sc = g.snapshot().control;
assert.equal(sc.type, 'roll'); assert.equal(sc.slot, 0);

// ---------- 3D layout sanity ----------
const P = islandPositions();
let min = 1e9, max = 0;
for (let i = 1; i < P.length; i++) {
  const d = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y, P[i].z - P[i - 1].z);
  if (GAPS.some((g) => i === g.after + 1)) { assert.ok(d > 11 && d < 45, `a gap (${d.toFixed(2)})`); continue; } // the real map's gorge, bridge, pool, tunnel, stairs
  if (isChallenge(ISLAND[i].type) || ISLAND[i].type === 'final') { assert.ok(d < 20, `walk up to challenge ${i} (${d.toFixed(2)})`); continue; } // the stars sit off the line of tiles
  min = Math.min(min, d); max = Math.max(max, d);
}
assert.ok(min > 3.4 && max < 5.6, `spacing even (${min.toFixed(2)}..${max.toFixed(2)})`);
const V = volcanoPositions();
for (let i = 1; i < V.length; i++) {
  const d = Math.hypot(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y, V[i].z - V[i - 1].z);
  assert.ok(d > 3 && d < 32, `volcano spacing ${d.toFixed(2)}`);
}

// ---------- v13: tornado, UFO, 1vRest, 1v1, volcano eruption ----------
{
  const at = (type, nth = 0) => ISLAND.map((n, i) => (n.type === type ? i : -1)).filter((i) => i >= 0)[nth];
  const make = (n = 4, seed = 1) => {
    const bg = new BoardGame({ slots: [...Array(n).keys()], rng: mulberry32(seed), isNpc: () => true });
    bg.start(0); bg.order = [...bg.players]; bg.turn = 0; return bg;
  };
  const evs = (bg, slot, idx) => { const e = []; const r = bg._landing(slot, I(idx), e); return { e, r }; };
  assert.equal(ISLAND.some((n) => n.type === 'mg13'), false, 'no more 1v3');
  assert.equal(ISLAND.filter((n) => n.type === 'mgRest').length, 3);

  // run a pending wheel/choice step: the player presses Stop / picks
  const stop = (bg, slot = 0) => { bg.phase = 'rolling'; bg.turn = slot; return bg._resolveRoll(0).events; };

  // tornado: a wheel (a slice per eligible player) plus a red die; both stop together
  for (let seed = 1; seed < 40; seed++) {
    const bg = make(4, seed);
    const t = at('tornado');
    bg.positions[0] = I(t); bg.positions[1] = I(t - 2); bg.positions[2] = { track: 'volcano', idx: 3 }; bg.positions[3] = I(0);
    const { r } = evs(bg, 0, t);
    assert.equal(r, true, 'the player has to stop the wheel first');
    assert.equal(bg.step.kind, 'wheel'); assert.deepEqual(bg.step.pool, [1], 'not the roller (you cannot blow yourself back); volcano and start-space players are not on the wheel');
    bg.phase = 'rolling';
    const ctl = bg._control();
    assert.deepEqual(ctl.wheel, { purpose: 'tornado', slots: [1] }); assert.deepEqual(ctl.dice, [{ kind: 'tornado' }]);
    assert.equal(bg.positions[1].idx, t - 2, 'nobody moves until Stop is pressed');
    const e = stop(bg, 0);
    const ds = e.find((x) => x.t === 'diceStop'), mv = e.find((x) => x.t === 'move');
    assert.ok(ds && ds.wheel && ds.wheel.target === 1 && ds.total >= 4 && ds.total <= 6 && ds.dice[0].kind === 'tornado', 'wheel and die land together');
    assert.ok(mv && mv.mode === 'fly' && mv.slot === ds.wheel.target && mv.tornado === true && mv.dur >= 6000 && mv.dur <= 10000, 'the chosen player is carried back by the tornado (as long as the real one: its recording)');
    assert.equal(bg.positions[2].track, 'volcano'); assert.deepEqual(bg.positions[3], I(0));
    const before = t - 2; assert.deepEqual(bg.positions[0], I(t), 'the roller stays put');
    assert.equal(before - bg.positions[mv.slot].idx, ds.total, 'moves back exactly the number on the die');
    assert.equal(!!mv.follow, true, 'the camera follows the player who is hit');
  }
  { const seenN = new Set();
    for (let seed = 1; seed < 60; seed++) { const bg = make(2, seed), t = at('tornado'); bg.positions[0] = I(t); bg.positions[1] = I(t - 1);
      evs(bg, 0, t); seenN.add(stop(bg).find((x) => x.t === 'diceStop').total); }
    assert.deepEqual([...seenN].sort(), [4, 5, 6], 'the die shows 4, 5 and 6'); }
  { const bg = make(2, 3), t = at('tornado'); bg.positions[0] = I(t); bg.positions[1] = I(2); // short run to the start: stops at the start
    for (let i = 0; i < 20; i++) { bg.positions[1] = I(2); evs(bg, 0, t); stop(bg); assert.ok(bg.positions[1].idx >= 0); bg.step = null; } }

  { const bg = make(2, 4), t = at('tornado'); bg.positions[0] = I(t); bg.positions[1] = { track: 'volcano', idx: 2 }; // nobody else on the island
    const { r } = evs(bg, 0, t); assert.ok(!r && !bg.step, 'a tornado with nobody to blow back: no wheel, nobody moves'); assert.deepEqual(bg.positions[0], I(t)); }

  // UFO: a wheel of the players it can swap with
  { const bg = make(4, 2), u = at('ufo');
    bg.positions[0] = I(u); bg.positions[1] = I(u); bg.positions[2] = { track: 'volcano', idx: 2 }; bg.positions[3] = I(u + 5);
    const { r } = evs(bg, 0, u);
    assert.equal(r, true); assert.deepEqual(bg.step.pool, [3], 'same-space and volcano players are not on the wheel');
    bg.phase = 'rolling'; assert.deepEqual(bg._control().dice, [], 'the UFO has no dice'); assert.deepEqual(bg._control().wheel.slots, [3]);
    assert.deepEqual(bg.positions[0], I(u), 'nothing happens until Stop');
    const e = stop(bg, 0);
    assert.equal(e.find((x) => x.t === 'diceStop').wheel.target, 3);
    assert.deepEqual(bg.positions[0], I(u + 5)); assert.deepEqual(bg.positions[3], I(u), 'the two players trade places');
    assert.deepEqual(bg.positions[1], I(u)); assert.equal(bg.positions[2].track, 'volcano');
    const ufo = e.filter((x) => x.t === 'ufo');
    assert.deepEqual(ufo.map((x) => [x.phase, x.slot]), [['up', 0], ['up', 3], ['down', 3], ['down', 0]], 'beam up the roller, then the other player, drop the other player, then the roller');
    assert.deepEqual(ufo[2].to, I(u)); assert.deepEqual(ufo[3].to, I(u + 5)); assert.ok([0, 2, 3].every((i) => ufo[i].dur > 1000) && ufo[1].dur === 0, 'each as long as its stretch of the real recording (the other is never seen going up)');
    assert.equal(e.some((x) => x.t === 'move'), false);
  }
  { const bg = make(3, 2), u = at('ufo'); bg.positions[0] = I(u); bg.positions[1] = I(u); bg.positions[2] = { track: 'volcano', idx: 2 };
    const { e, r } = evs(bg, 0, u); assert.equal(r, false); assert.equal(e.some((x) => x.t === 'move'), false, 'nobody to swap with: no wheel, nothing moves'); }

  // 1vRest: placeholder minigame, solo win = +10, otherwise nothing
  { let won = 0, lost = 0;
    for (let seed = 1; seed < 200; seed++) { const bg = make(4, seed), m = at('mgRest'); bg.positions[0] = I(m);
      const { e, r } = evs(bg, 0, m); assert.equal(r, false); assert.ok(e.some((x) => x.t === 'minigame' && x.kind === 'rest'));
      if (bg.positions[0].idx !== m) { won++; assert.ok(bg.positions[0].idx > m); } else lost++; }
    assert.ok(won > 20 && lost > won, `solo wins about 1 in 4 (${won}/${lost})`); }

  // 1v1: boxes sorted by place + a "?" box
  { const bg = make(4, 5), m = at('mg11'); bg.positions[0] = I(m); bg.positions[1] = I(m + 3); bg.positions[2] = I(m - 4); bg.positions[3] = { track: 'volcano', idx: 1 };
    const { r } = evs(bg, 0, m);
    assert.equal(r, true, 'asks the player to choose');
    assert.deepEqual(bg.step.options, [1, 2], 'sorted by place (1 is closest to the goal); volcano players cannot be challenged');
    bg.phase = 'choosing'; bg.turn = 0;
    const ctl = bg._control();
    assert.deepEqual(ctl.slots, [1, 2, null], 'the last box is the random one');
    assert.deepEqual(ctl.places.slice(0, 2), [1, 3].map((x, i) => ctl.places[i]), 'places are listed');
    assert.ok(ctl.places[0] < ctl.places[1] && ctl.places[2] === null);
    assert.equal(bg.requestChoice(0, 3), false, 'only the boxes shown are valid');
    assert.equal(bg.requestChoice(0, 2), true, 'the ? box is valid');
    const res = bg._resolveChoice(0);
    assert.ok(res.events.some((x) => x.t === 'choiceStop') && res.events.some((x) => x.t === 'minigame' && x.kind === 'duel'));
    assert.ok(res.events.some((x) => x.t === 'space' && /game picks/.test(x.text)), 'says the game picked');
    assert.equal(bg.step, null);
  }
  { const bg = make(4, 5), m = at('mg11'); bg.positions[0] = I(m); bg.positions[1] = I(m + 3); bg.positions[2] = I(m - 4);
    evs(bg, 0, m); bg.phase = 'choosing'; bg.turn = 0; assert.equal(bg.requestChoice(0, 1), true);
    const res = bg._resolveChoice(0);
    assert.ok(res.events.some((x) => x.t === 'minigame' && x.opp === 2), 'picking a box challenges exactly that player');
    assert.ok(!res.events.some((x) => x.t === 'space' && /game picks/.test(x.text))); }
  { // the winner moves 7 and the loser goes back 7 (some seed has a win and some a loss)
    const seen = new Set();
    for (let seed = 1; seed < 80; seed++) { const bg = make(3, seed), m = at('mg11'); bg.positions[0] = I(m); bg.positions[1] = I(m + 3); bg.positions[2] = { track: 'volcano', idx: 1 };
      evs(bg, 0, m); bg.phase = 'choosing'; bg.turn = 0; bg.requestChoice(0, 0); bg._resolveChoice(0);
      const a = bg.positions[0].idx, b = bg.positions[1].idx;
      if (a > m) { assert.equal(b, m + 3 - 7); seen.add('win'); } else { assert.equal(b, m + 3); seen.add('nothing'); } }
    assert.ok(seen.has('win') && seen.has('nothing')); }
  { const bg = make(2, 1), m = at('mg11'); bg.positions[0] = I(m); bg.positions[1] = { track: 'volcano', idx: 1 };
    const { e, r } = evs(bg, 0, m); assert.equal(r, false); assert.equal(e.some((x) => x.t === 'minigame'), false, 'nobody to challenge'); }

  // dev tools: the next roll can be set (offline games)
  { const bg = make(2, 1), p5 = at('plus5', 1); bg.positions[0] = I(p5 - 1); bg.rigNext = 1;
    const { e } = evs(bg, 0, p5 - 1); void e;
    bg.rigNext = 3; bg.positions[1] = I(30); bg.turn = bg.order.indexOf(1); bg.phase = 'rolling'; bg.step = null;
    const r = bg._resolveRoll(0); const ds = r.events.find((x) => x.t === 'diceStop');
    assert.equal(ds.total, 3); assert.equal(bg.rigNext, null, 'used once'); }

  // statues: a slow throw of its own, blue forward and red back
  for (const [type, color, dir] of [['statueBlue', 'blue', 'fwd'], ['statueRed', 'red', 'back']]) {
    const bg = make(2, 1), sIdx = at(type); bg.positions[0] = I(sIdx);
    const { e } = evs(bg, 0, sIdx), mv = e.find((x) => x.t === 'move');
    assert.equal(mv.mode, 'fly'); assert.equal(mv.statue, color); assert.equal(mv.count.dir, dir); assert.equal(mv.dur, color === 'blue' ? 16116 : 14830); // (the real game's: realTimings.js)
    assert.deepEqual(bg.positions[0], (dir === 'fwd' ? walkForward : walkBack)(I(sIdx), ISLAND[sIdx].arg).end);
  }

  // springs: blue on +, red on -, green for minigame winners and the 1v1 loser
  { const bg = make(2, 1), p5 = at('plus5', 1); bg.positions[0] = I(p5);
    const { e } = evs(bg, 0, p5), mv = e.find((x) => x.t === 'move');
    assert.equal(mv.mode, 'spring'); assert.equal(mv.spring, 'blue'); assert.equal(bg.positions[0].idx, p5 + 5); assert.ok(mv.dur > 0); }
  { const bg = make(2, 1), m4 = at('minus4'); bg.positions[0] = I(m4);
    const { e } = evs(bg, 0, m4), mv = e.find((x) => x.t === 'move');
    assert.equal(mv.mode, 'spring'); assert.equal(mv.spring, 'red'); assert.equal(mv.count.dir, 'back'); assert.equal(bg.positions[0].idx, m4 - 4); }
  { let checked = false;
    for (let seed = 1; seed < 200 && !checked; seed++) { const bg = make(4, seed), m = at('mgRest'); bg.positions[0] = I(m);
      const { e } = evs(bg, 0, m); const mv = e.find((x) => x.t === 'move');
      if (mv) { assert.equal(mv.mode, 'spring'); assert.equal(mv.spring, 'green'); assert.equal(e.filter((x) => x.t === 'move').length, 1, 'nobody else moves'); checked = true; } }
    assert.ok(checked); }
  { let checked = false;
    for (let seed = 1; seed < 80 && !checked; seed++) { const bg = make(3, seed), m = at('mg11'); bg.positions[0] = I(m); bg.positions[1] = I(m + 3); bg.positions[2] = { track: 'volcano', idx: 1 };
      evs(bg, 0, m); bg.phase = 'choosing'; bg.turn = 0; bg.requestChoice(0, 0); const res = bg._resolveChoice(0);
      const mv = res.events.filter((x) => x.t === 'move');
      if (mv.length) { assert.deepEqual(mv.map((x) => [x.slot, x.mode, x.spring, x.count.dir]), [[0, 'spring', 'green', 'fwd'], [1, 'spring', 'green', 'back']]); checked = true; } }
    assert.ok(checked, 'a 1v1 win: green springs for both'); }

  // volcano eruption: -4 on special spaces for three turns, stacking
  { const bg = make(4, 1), v = at('volcano'), p5 = at('plus5', 1), blank = ISLAND.findIndex((n, i) => n.type === 'blank' && i > 5);
    let { e } = evs(bg, 0, v);
    assert.ok(e.some((x) => x.t === 'eruption' && x.active === 1 && x.dur > 0));
    { const er = e.find((x) => x.t === 'eruption'); assert.equal(er.stretches.length, 3); assert.equal(er.stretches[0], 0, 'always the stretch the Wii game shows');
      assert.equal(new Set(er.stretches).size, 3, 'three different stretches'); }
    assert.equal(bg.snapshot().eruptions, 1);
    bg.positions[1] = I(p5); e = []; bg._landing(1, I(p5), e);
    // a +5 is now a -4; four back is a statue (also lava now), so a second meteor knocks them back again, onto a blank
    assert.equal(ISLAND[p5 - 4].type, 'statueBlue'); assert.equal(ISLAND[p5 - 8].type, 'blank');
    assert.equal(bg.positions[1].idx, p5 - 8, 'a +5 is now a -4, and they chain until they land somewhere safe');
    const hits = e.filter((x) => x.t === 'move' && x.slot === 1);
    assert.deepEqual(hits.map((x) => [x.mode, x.meteor, x.path[x.path.length - 1].idx]), [['fly', true, p5 - 4], ['fly', true, p5 - 8]], 'each knock-back is a meteor, not a spring');
    assert.ok(hits.every((x) => x.dur === DUR.meteorHit));
    bg.positions[1] = I(blank); e = []; bg._landing(1, I(blank), e); assert.equal(bg.positions[1].idx, blank, 'blank spaces are unaffected');
    evs(bg, 0, v); // second eruption stacks
    bg.positions[1] = I(p5); e = []; bg._landing(1, I(p5), e); assert.equal(bg.positions[1].idx, p5 - 8, 'two eruptions: -8');
    // wears off: three other turns after the eruption, per eruption
    const bg2 = make(4, 1); bg2.positions[0] = I(v); evs(bg2, 0, v);
    const gone = [];
    for (let t = 0; t < 5; t++) { const ev = []; bg2.turn = t % 4; bg2._commit(0, ev, true); gone.push(bg2.eruptions.length); if (ev.some((x) => x.t === 'eruption' && x.active === 0)) break; }
    assert.deepEqual(gone, [1, 1, 1, 0], 'active for the next three turns, then gone'); }
}

// ---------- 1v1: a CPU picks the card its pointer went to (npcPick), and takes long enough to watch ----------
{ const mk = () => { const g = game([0, 1, 2]); g.phase = 'choosing'; g.turn = g.order.indexOf(1); g.step = { kind: 'choice', purpose: 'duel', options: [0, 2] }; g.phaseAt = 1000; return g; };
  for (const want of [0, 1]) { const g = mk(); g.npcPick = want;
    const r = g._resolveChoice(0);
    assert.equal(r.events.find((e) => e.t === 'choiceStop').picked, want, 'the CPU challenges the card its pointer chose');
    assert.equal(g.npcPick, null, 'the hint is used once'); }
  { const g = mk(); g.npcPick = 0; g.choice = 1; // a real pick always wins over a stale hint
    assert.equal(g._resolveChoice(0).events.find((e) => e.t === 'choiceStop').picked, 1); }
  { const g = mk(); g.npcPick = 7; assert.ok([0, 1].includes(g._resolveChoice(0).events.find((e) => e.t === 'choiceStop').picked), 'a bad hint is ignored'); }
  assert.ok(TIMING.npcDuel > TIMING.npcChoose, 'a CPU takes longer over the 1v1 cards than over crates/barrels');
  { const g = new BoardGame({ slots: [0, 1, 2], rng: mulberry32(4), isNpc: () => true }); g.start(0);
    g.phase = 'choosing'; g.step = { kind: 'choice', purpose: 'duel', options: g.players.filter((x) => x !== g.current()) }; g.phaseAt = 1000;
    assert.equal(g.update(1000 + TIMING.npcDuel - 5), null, 'still looking at the cards');
    assert.ok(g.update(1000 + TIMING.npcDuel + 5).events.some((e) => e.t === 'choiceStop'), 'then it picks'); }
}

// ---------- dev tools: skip the dice and land on a spot ----------
{ const { ISLAND: IS } = await import('../js15/game/boardData.js');
  const dg = game([0, 1]);
  assert.equal(dg.devJump(0, { track: 'island', idx: 5 }, 0), null, 'only while your dice spin');
  dg.update(dg.readyAt + 1);                                      // dice start spinning
  assert.equal(dg.devJump(1, { track: 'island', idx: 5 }, 0), null, 'not on someone else\'s roll');
  const plus = IS.findIndex((n) => n.type === 'plus5');
  const r = dg.devJump(0, { track: 'island', idx: plus }, dg.readyAt + 2);
  assert.ok(r && r.events[0].t === 'devJump', 'the jump comes first');
  assert.ok(r.events.some((e) => e.t === 'move' && e.mode === 'spring'), 'the + space works as normal');
  const cg = game([0, 1]); cg.update(cg.readyAt + 1);
  const star = IS.findIndex((n) => n.type === 'dragon');
  cg.devJump(0, { track: 'island', idx: star }, cg.readyAt + 2);
  assert.equal(cg.step && cg.step.purpose, 'dragon', 'a challenge star starts its challenge');
  const vg = game([0, 1]); vg.update(vg.readyAt + 1);
  vg.devJump(0, { track: 'volcano', idx: 0 }, vg.readyAt + 2);
  assert.equal(vg.positions[0].track, 'volcano'); }

// ---------- v91: who looks around ("what is about to happen?", pm001_02) before what ----------
{
  const at = (type, nth = 0) => ISLAND.map((n, i) => (n.type === type ? i : -1)).filter((i) => i >= 0)[nth];
  const make = (n = 4, seed = 1) => { const bg = new BoardGame({ slots: [...Array(n).keys()], rng: mulberry32(seed), isNpc: () => true }); bg.start(0); bg.order = [...bg.players]; bg.turn = 0; return bg; };
  const wonders = (e) => e.filter((x) => x.t === 'space' && x.wonder).map((x) => x.wonder);
  const land = (bg, slot, pos) => { const e = []; bg.positions[slot] = { ...pos }; bg._landing(slot, pos, e); return e; };
  const stop = (bg, slot = 0) => { bg.phase = 'rolling'; bg.turn = slot; return bg._resolveRoll(0).events; };
  let bg = make(); assert.deepEqual(wonders(land(bg, 0, I(at('plus4')))), [[0]], 'a blue spring: they look around first');
  bg = make(); assert.deepEqual(wonders(land(bg, 0, I(at('minus4')))), [], 'not before a red spring');
  bg = make(); assert.deepEqual(wonders(land(bg, 0, I(at('skull')))), [[0]], 'the skull (into the volcano)');
  bg = make(); assert.deepEqual(wonders(land(bg, 0, { track: 'volcano', idx: VOLCANO.findIndex((n) => n.type === 'shout') })), [[0]], 'the ! space (out of the volcano)');
  bg = make(); bg.positions[1] = I(at('ufo') + 6); land(bg, 0, I(at('ufo'))); { const e = stop(bg), w = wonders(e), up = e.filter((x) => x.t === 'ufo' && x.phase === 'up').map((x) => x.slot); assert.ok(w.length === 1 && w[0].length === 2 && w[0][0] === 0 && w[0][1] !== 0, 'the UFO: both of them'); assert.deepEqual(up, w[0], 'both, before each is beamed up'); }
  bg = make(); bg.positions[1] = I(at('tornado') + 3); bg.positions[2] = { track: 'volcano', idx: 2 }; bg.positions[3] = { track: 'volcano', idx: 2 };
  land(bg, 0, I(at('tornado'))); assert.deepEqual(wonders(stop(bg)), [[1]], 'the tornado: the one it sweeps back');
  bg = make(); { const d = at('dragon'); bg.positions[0] = I(d); bg.step = { kind: 'single', purpose: 'dragon', remaining: 0 }; bg.rigNext = 1; const e = []; bg._resolveSingle(0, e); assert.deepEqual(wonders(e), [[0]], 'the dragon wall: before the fireball'); }
}
// ---------- v95: the challenges' set pieces ----------
{
  const { DUR: D, SMASH, DRAGON_SMASH, GATE_SMASH } = await import('../js15/game/boardGame.js');
  const at = (type, nth = 0) => ISLAND.map((n, i) => (n.type === type ? i : -1)).filter((i) => i >= 0)[nth];
  const make = (n = 4, seed = 1) => { const bg = new BoardGame({ slots: [...Array(n).keys()], rng: mulberry32(seed), isNpc: () => true }); bg.start(0); bg.order = [...bg.players]; bg.turn = 0; return bg; };
  const single = (bg, slot, purpose, d, remaining = 0) => { bg.step = { kind: 'single', purpose, remaining }; bg.rigNext = d; const e = []; const done = bg._resolveSingle(slot, e); return { e, done }; };
  const F = (n) => Math.round(n * 1000 / 60);
  // the timings are the clips' and the walls' own frames
  assert.equal(D.wall, 7391, 'the dragon wall: the real game\'s 7.39 s (build 103, realTimings.js)');
  assert.equal(D.gate, 5476, 'the summit gate: the real game\'s 5.48 s');
  assert.ok(GATE_SMASH.watch > 0 && SMASH.punches === 4 && SMASH.kicks === 6 && DRAGON_SMASH.stance === 75);
  // the dragon wall, passed: the note, the smash (who does it), then they walk on
  let bg = make(); { const d = at('dragon'); bg.positions[0] = I(d); const { e } = single(bg, 0, 'dragon', 5, 2); const t = e.map((x) => x.t);
    assert.deepEqual(t.slice(0, 3), ['diceStop', 'space', 'broken']); assert.equal(e[2].dur, D.wall); assert.equal(e[2].slot, 0); assert.ok(t.indexOf('move') > 2, 'then on'); }
  // the spike statue, passed: on at once; it breaks once the turn has played out (after the space they land on)
  bg = make(); { const s = at('spike'); bg.positions[0] = I(s); bg.phase = 'rolling';
    const { e, done } = single(bg, 0, 'spike', 6, 3);
    assert.equal(bg.broken.spike, true, 'passable for everyone from now on');
    assert.ok(!e.some((x) => x.t === 'broken'), 'not smashed before they go on'); assert.ok(e.some((x) => x.t === 'move' && x.slot === 0));
    const r = bg._commit(0, e, done); const k = r.events.findIndex((x) => x.t === 'broken');
    assert.ok(k > r.events.findIndex((x) => x.t === 'move'), 'it breaks after they have gone on');
    assert.equal(r.events[k].later, true); assert.equal(r.events[k].challenge, 'spike'); assert.equal(r.events[k].dur, D.spikeBreak);
    assert.equal(bg.pendingBreak, null); }
  // ... and with a 1v1 to pick first: not until the turn is over
  bg = make(); { const s = at('spike'), mg = at('mg11'); bg.positions[0] = I(s); bg.phase = 'rolling';
    if (mg > s) { const { e, done } = single(bg, 0, 'spike', 6, mg - s); const r = bg._commit(0, e, done);
      if (!done) { assert.ok(!r.events.some((x) => x.t === 'broken'), 'still choosing: not yet'); assert.ok(bg.pendingBreak); } } }
  // the spike ball, missed: everyone on the stretch jumps together, then they run
  bg = make(); { const s = at('spike'), safe = at('volcanoOrNot') + 1; bg.positions[0] = I(s); bg.positions[1] = I(s - 3); bg.positions[2] = I(safe - 2); bg.positions[3] = I(s);
    const { e } = single(bg, 0, 'spike', 1); const k = e.findIndex((x) => x.t === 'spikeShock');
    assert.ok(k > e.findIndex((x) => x.fx === 'pit'), 'after the ball is spat out'); assert.ok(k < e.findIndex((x) => x.t === 'move'), 'before anyone runs');
    assert.deepEqual([...e[k].slots].sort(), [0, 1], 'the roller and whoever is on the stretch (not below it, not beside them on the star)'); assert.equal(e[k].dur, D.shock); }
  // the summit: kicked open before the walk up and the win; a miss is shown
  bg = make(); { bg.positions[0] = I(FINAL_IDX); const { e } = single(bg, 0, 'final', 6); const t = e.map((x) => x.t);
    assert.ok(t.indexOf('broken') >= 0 && t.indexOf('broken') < t.indexOf('move') && t.indexOf('move') < t.indexOf('win'), 'kick, walk up, win');
    assert.equal(e[t.indexOf('broken')].challenge, 'final'); assert.equal(e[t.indexOf('broken')].dur, D.gate); }
  bg = make(); { bg.positions[0] = I(FINAL_IDX); const { e } = single(bg, 0, 'final', 3); const n = e.find((x) => x.t === 'space');
    assert.equal(n.fx, 'finalFail'); assert.equal(n.dur, D.finalFail); assert.ok(!e.some((x) => x.t === 'broken')); }
}
// ---------- v96: a moment the sequence editor made longer: the host waits for it
{
  const { SEQUENCES } = await import('../js15/game/sequences.js');
  const make = () => { const bg = new BoardGame({ slots: [0, 1], rng: mulberry32(3), isNpc: () => true }); bg.start(0); bg.order = [...bg.players]; bg.turn = 0; return bg; };
  const d = ISLAND.findIndex((n) => n.type === 'dragon');
  const run = () => { const bg = make(); bg.positions[0] = I(d); bg.step = { kind: 'single', purpose: 'dragon', remaining: 0 }; bg.rigNext = 6; const e = []; const done = bg._resolveSingle(0, e); const r = bg._commit(1000, e, done); return { bg, ev: r.events.find((x) => x.t === 'broken') }; };
  const shipped = SEQUENCES['smash.dragon']; delete SEQUENCES['smash.dragon']; // (the game's own, from the trace: set aside for this)
  const before = run();
  SEQUENCES['smash.dragon'] = { blocks: [{ track: 'builtin', at: 0, len: 600, from: 0, speed: 0.5 }] }; // ten seconds
  const after = run();
  if (shipped) SEQUENCES['smash.dragon'] = shipped; else delete SEQUENCES['smash.dragon'];
  assert.equal(before.ev.hold || 0, 0);
  assert.equal(after.ev.hold, 10000 - after.ev.dur, 'held for the sequence');
  assert.equal(after.bg.readyAt - before.bg.readyAt, after.ev.hold, 'and the next turn waits for it');
}
// ---------- v100: the sequences taken from the real game (a trace of the recomp): each is sound
{
  const { SEQUENCES } = await import('../js15/game/sequences.js');
  const { CLIP_TABLE } = await import('../js15/world/clipTable.js');
  const { allMoments } = await import('../js15/game/moments.js');
  const keys = new Set(allMoments().map((m) => m.key));
  for (const [k, q] of Object.entries(SEQUENCES)) {
    assert.ok(keys.has(k), `${k} is a moment`);
    assert.equal(q.v, 2, k);
    for (const m of q.miis) { for (const b of m.anim) assert.ok(CLIP_TABLE[b.clip], `${k}: ${b.clip} is in the page`); for (const b of m.face) assert.ok(b.face >= 0 && b.face <= 6, k); }
    for (const c of q.camera) assert.ok(c.kind !== 'shot' || ['x', 'y', 'z', 'tx', 'ty', 'tz'].every((a) => Number.isFinite(c.shot[a])), `${k}: camera`);
  }
  for (const k of ['smash.dragon', 'smash.final', 'spike.shock', 'move.fly.statue.blue', 'duel.challenge', 'duel.result', 'win']) assert.ok(SEQUENCES[k], k);
  for (const k of ['move.spring.blue', 'move.spring.red', 'ufo.up']) assert.ok(!SEQUENCES[k], k + ': the set piece itself plays the real clips, faces and timings (build 103)');
  // the 1 vs 1: its challenge and its result are their own moments (not the space's caption)
  const { momentKey } = await import('../js15/game/moments.js');
  assert.equal(momentKey({ t: 'space', moment: 'duel.challenge', slot: 0 }, 'mg11'), 'duel.challenge');
  assert.equal(momentKey({ t: 'move', mode: 'spring', spring: 'green', count: { dir: 'back' } }), 'move.spring.green.back');
}
console.log('board tests passed');
