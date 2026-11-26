// Turn-by-turn Board Game Island rules. Pure logic: only the host runs it.
// A step of a turn is resolved all at once into a list of "events" that every screen plays back.
//
// A turn is a little state machine:
//   waiting  -> (animations finish) -> rolling | choosing -> (player presses Stop / picks) -> resolve -> waiting ...
// One turn can contain several rolls: the main roll, then e.g. a challenge roll, then a final-challenge roll.
import {
  ISLAND, VOLCANO, FINAL_IDX, FINISH_IDX, VOLCANO_SPACE_IDX, VOLCANO_CHALLENGE_IDX, SPIKE_IDX,
  EXIT_POS, isChallenge, nodeAt, trackNodes, gapBetween, CROSSING_KINDS,
} from './boardData.js';

// ---- tunables --------------------------------------------------------------------------
// Dice curve (design doc): everyone except last place gets a 2nd die that leans slightly toward 6.
// 1st place leans the most, each rank after leans less. CURVE_MAX is the lean for 1st place:
// 0 = fair die. At 0.12 a 6 comes up ~18.7% of the time instead of 16.7%.
export const CURVE_MAX = 0.12;
// The 2nd die's material, by minigame rank. Last place gets no 2nd die.
export const TIERS = ['gold', 'platinum', 'silver', 'copper', 'wood'];
export const WIN_ROLL = 6;        // final challenge: needs this or more
export const DRAGON_NEEDS = 4;    // wiki: Dragon Wall needs 4+
export const VOLCANO_NEEDS = 3;   // wiki: Volcano or Not needs 3+
export const SPIKE_START = 5;     // wiki: Spike Ball needs 5+, then 4, 3, 2 after each failure
export const SPIKE_MIN = 2;      // and it stops at 2, as in the game
export const SPIKE_RUNBACK = 11;  // spaces the failing player runs back
export const TORNADO_BACK = [4, 5, 6];  // wiki: the tornado's number die
export const REST_WIN_MOVE = 10;  // wiki: solo player wins the 1vRest minigame -> +10
export const DUEL_MOVE = 7;       // wiki: 1v1 winner +7, loser -7
export const ERUPTION_TURNS = 3;  // wiki: eruption lasts three turns, and stacks
export const LAVA_BACK = 4;       // each active eruption turns spaces into -4
// The eruption cutscene shows meteors hitting three stretches of the island: always the stretch past the volcano-or-not
// pit along the cliff (the one the Wii game shows), and two others picked at random. Island space ranges, first..last.
export const ERUPTION_STRETCHES = [[50, 60], [8, 17], [17, 27], [27, 35], [36, 48], [62, 77]];
const LAVA_SAFE = new Set(['blank', 'start', 'volcano', 'vine', 'dragon', 'crates', 'volcanoOrNot', 'spike', 'final', 'finish']);
// moveTail: after the last step the counter sits at its final number for a moment.
// turnIntro: black fade out, the player's name on black, fade back in (then the dice start).
/**
 * The challenges' set pieces, in frames (60 a second) of the Mii clips and the game's own wall animations, so the host's
 * timing and the scene's agree. Each punch (pm301_03) and kick (pm301_05) is 31 frames with the fist / foot out at
 * frame 4 (the glint, and the wall's jolt); a wall's jolt is 31 frames and its break 101; pm301_01 (stance) 75,
 * pm001_06 (cheer) 71, pm001_07 (let down) 76, pm001_03 (shock) 41; the spike ball shatters over 61.
 */
export const SMASH = {
  swing: 31, impact: 4, punches: 4, kicks: 6, stance: 75, jolt: 31, breakUp: 101, cheer: 71, idle: 48, letdown: 76, shock: 41, shatter: 61,
  beat: 12,     // a short pause around a cut
  rumble: 60,   // the spike statue rumbles before its ball shatters
};
const F = (n) => Math.round(n * 1000 / 60);
/** The dragon wall: 4 punches, the stance (the wall blows apart meanwhile), a cut to the way on, a moment standing, a cheer. */
export const DRAGON_SMASH = { punches: SMASH.punches * SMASH.swing, stance: SMASH.stance, idle: SMASH.idle, cheer: SMASH.cheer };
/** The summit gate: 6 kicks; the last one blows it apart (they stand and watch it go), a cut to the opening, a cheer. */
export const GATE_SMASH = { kicks: SMASH.kicks * SMASH.swing, watch: (SMASH.kicks - 1) * SMASH.swing + SMASH.impact + SMASH.breakUp - SMASH.kicks * SMASH.swing, beat: SMASH.beat, cheer: SMASH.cheer };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export const DUR = {
  diceStop: 3600, wonder: 2000, walkStep: 185, fastStep: 140, moveTail: 350, fly: 2600, drop: 0, banner: 1100, round: 2600, turnIntro: 2000, flyover: 7000, eruption: 10000, meteorHit: 2200, minigame: 2200,
  cross: 1500,   // extra time for a step that crosses a gap (a jump over the pit, over the creek...)
  swing: 2400,   // the vine swing
  vinePause: 1000, // standing on the landing spot after the vine, before walking the rest
  wall: F(sum(DRAGON_SMASH)), // punching the dragon wall to pieces, then a cheer (see DRAGON_SMASH)
  gate: F(sum(GATE_SMASH)),     // kicking the summit gate to pieces, then a cheer (see GATE_SMASH)
  finalFail: F(SMASH.beat + SMASH.letdown + SMASH.beat), // the gate stays shut: they turn to the camera, let down
  shock: F(SMASH.beat + SMASH.shock + SMASH.beat),       // everyone on the spike ball's stretch jumps as it is spat out
  spikeBreak: F(SMASH.beat * 2 + SMASH.rumble + SMASH.shatter + SMASH.beat * 3), // later: the statue rumbles and its ball shatters
  fire: 1700,    // the dragon spits the fireball in its mouth at the player
  knock: 2200,   // ...and they are blown back onto the space behind them in one arc, sit there dazed, and get up
  pit: 1800,     // the statue opens its jaws and spits the spike ball out at a player who failed
  spikeCount: 2600, // then the camera pans to the number beside the statue and it fades to the next one down
  swim: 3000,    // a crate breaks and the player swims across
  statueThrow: 13000, // a statue's hands wake up, it throws the player high over the island, they walk off its platform
  tornado: 7000, // the tornado forms round the player, carries them back along the path, dies away and drops them
  ufo: 2600,     // one beam-up or drop-off of the UFO swap (there are four)
  spring: 2400,  // a big spring pops up and bounces the player forward or back in one jump
};
// Falling into / climbing out of the volcano: shrink, the camera STAYS for a few seconds, black fade,
// reappear at the destination, then hold so you can see where you are. These add up to DUR.drop.
export const DROP = { shrink: 600, hold: 2500, fadeOut: 450, black: 250, fadeIn: 450, tail: 1650 };
DUR.drop = Object.values(DROP).reduce((a, b) => a + b, 0);
export const TIMING = {
  npcRoll: 1300,     // a CPU lets the dice spin this long before stopping them
  npcChoose: 1000,
  npcDuel: 2400,     // a CPU picking a 1v1 opponent: long enough to watch its pointer go to a card and click it
  autoStop: 20000,   // if a human never presses Stop, the dice stop themselves
  gap: 600,
};

// ---- dice ------------------------------------------------------------------------------
/** One die. curve > 0 leans toward 6 (weights run from 1-curve up to 1+curve). */
export function rollDie(rng, curve = 0) {
  const w = [1, 2, 3, 4, 5, 6].map((f) => 1 + curve * (f - 3.5) / 2.5);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < 6; i++) { r -= w[i]; if (r < 0) return i + 1; }
  return 6;
}

// ---- movement --------------------------------------------------------------------------
// Challenge spaces never count as a step. With stopAtChallenges (dice-driven movement) a walk
// stops ON the first challenge it reaches while steps remain; otherwise they are passed freely.
// Nobody can pass the final challenge.
export function walkForward(pos, n, { stopAtChallenges = false, broken = null } = {}) {
  const nodes = trackNodes(pos.track);
  let idx = pos.idx, counted = 0, exited = false, challenge = null;
  const path = [];
  while (counted < n) {
    if (pos.track === 'island' && idx >= FINAL_IDX) break;
    if (idx >= nodes.length - 1) break;
    idx++;
    path.push({ track: pos.track, idx });
    const type = nodes[idx].type;
    if (type === 'exit') { exited = true; break; }
    if (isChallenge(type)) {
      if (stopAtChallenges && !(broken && broken[type])) { challenge = type; break; } // a broken wall is just a free space
    } else counted++;
  }
  return { path, end: { track: pos.track, idx }, exited, challenge, remaining: n - counted };
}

export function walkBack(pos, n) {
  const nodes = trackNodes(pos.track);
  let idx = pos.idx, counted = 0;
  const path = [];
  while (counted < n && idx > 0) {
    idx--;
    path.push({ track: pos.track, idx });
    if (!isChallenge(nodes[idx].type)) counted++;
  }
  return { path, end: { track: pos.track, idx } };
}

/** Spaces left until the final challenge (what the round-end screen will show). */
export function spacesToGo(pos, returnTo = null) {
  let extra = 0, p = pos;
  if (p.track === 'volcano') { extra = VOLCANO.length - 1 - p.idx; p = returnTo || EXIT_POS; }
  let n = 0;
  for (let i = p.idx + 1; i <= FINAL_IDX; i++) if (!isChallenge(ISLAND[i].type)) n++;
  return n + extra;
}

// count = { total, dir }: the number shown at the top while the player travels ("9", then 8, 7...).
const crossings = (start, path) => { // how many steps cross a gap (they are long: a bridge, a gorge, a tunnel, stairs)
  let n = 0, prev = start && start.across ? null : start; // (from a spot past a challenge the gap is already crossed)
  for (const p of path) { if (prev && prev.track === 'island' && p.track === 'island') { const g = gapBetween(prev.idx, p.idx); if (g) n++; } prev = p; }
  return n;
};
const move = (slot, mode, path, count, follow = false, start = null) => {
  const dur = mode === 'walk' ? path.length * DUR.walkStep + DUR.moveTail + crossings(start, path) * DUR.cross
    : mode === 'fast' ? path.length * DUR.fastStep + DUR.moveTail + crossings(start, path) * DUR.cross
    : mode === 'fly' ? DUR.fly : mode === 'spring' ? DUR.spring : mode === 'knock' ? DUR.knock : DUR.drop;
  const ev = { t: 'move', slot, mode, path, dur };
  if (count && mode !== 'drop') ev.count = count;
  if (follow) ev.follow = true; // the camera pans to this player (it is someone else's pawn moving)
  return ev;
};
const FWD = (total) => ({ total, dir: 'fwd' });
const BACK = (total) => ({ total, dir: 'back' });
// extra.wonder: the players who look around ("what is about to happen?", Wii Party's pm001_02) while the banner shows,
// until something happens to them (the UFO, a blue spring, the dragon's fireball, the skull, the ! space, a tornado)
const note = (slot, text, extra = {}) => ({ t: 'space', slot, text, dur: extra.wonder ? DUR.wonder : DUR.banner, ...extra }); // (a look around takes a little longer than a banner)

export class BoardGame {
  constructor({ slots, rng, isNpc = () => false }) {
    this.players = [...slots];
    this.rng = rng; this.isNpc = isNpc;
    this.positions = {};
    for (const s of slots) this.positions[s] = { track: 'island', idx: 0 };
    this.round = 0; this.order = []; this.curves = {}; this.tiers = {}; this.turn = 0;
    this.over = false; this.winner = null;
    this.spikeNeeds = SPIKE_START;
    this.eruptions = [];          // active volcano eruptions: { left: turns remaining, fresh }
    this.volcanoReturn = {};      // slot -> the island spot a player in the volcano comes back out at
    this.broken = {};             // walls broken for good: { dragon: true, spike: true }
    this.pendingBreak = null;     // the spike statue, passed this turn: it breaks when the turn is over
    this.phase = 'waiting';       // 'waiting' | 'rolling' | 'choosing'
    this.step = null;             // what the current player must do next (null = a normal main roll)
    this.readyAt = 0; this.phaseAt = 0;
    this.stopRequested = false; this.choice = null;
  }

  current() { return this.order[this.turn]; }

  /** Begin the game. Returns the opening events. */
  start(now) { return this._startRound(now); }

  // Placeholder: the real game runs a 4-player minigame here and ranks by result.
  // For now the ranking is random so the rest of the round can be built and tested.
  _startRound(now) {
    this.round++;
    const order = [...this.players];
    for (let i = order.length - 1; i > 0; i--) { // Fisher-Yates with the host's seeded rng
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.order = order; this.turn = 0; this.curves = {}; this.tiers = {}; this.step = null;
    const n = order.length;
    order.forEach((slot, k) => { // k = 0 for 1st place
      const has = k < n - 1; // last place: one normal die only
      this.curves[slot] = has ? CURVE_MAX * (n - 1 - k) / (n - 1) : null;
      this.tiers[slot] = has ? TIERS[Math.min(k, TIERS.length - 1)] : null;
    });
    this.phase = 'waiting';
    this.readyAt = now + DUR.round + TIMING.gap;
    return [{ t: 'roundStart', round: this.round, order: [...order], curves: { ...this.curves }, tiers: { ...this.tiers }, dur: DUR.round }];
  }

  // ---- what to show the player right now ----
  _diceKinds() {
    const slot = this.current();
    if (this.step?.kind === 'extra') return [{ kind: 'extra' }]; // doubles: the 3rd die spins by itself
    if (this.step?.kind === 'wheel') return this.step.purpose === 'tornado' ? [{ kind: 'tornado' }] : []; // the tornado's red number die; the UFO has only its wheel
    const kinds = [{ kind: 'base' }];
    if (this.step?.kind !== 'single' && this.tiers[slot]) kinds.push({ kind: 'bonus', tier: this.tiers[slot] });
    return kinds;
  }

  _label() {
    const s = this.step;
    if (s?.kind === 'extra') return 'Doubles! Stop the bonus die';
    if (s?.kind === 'wheel') return s.purpose === 'tornado' ? 'Tornado! Stop the wheel and the die' : 'UFO! Stop the wheel';
    if (!s) return this._atFinal(this.current()) ? `Final challenge! Roll ${WIN_ROLL} or more to win` : '';
    switch (s.purpose) {
      case 'final': return `Final challenge! Roll a ${WIN_ROLL} to win`;
      case 'vine': return 'Vine swing! Roll for bonus spaces';
      case 'dragon': return `Dragon wall! Roll ${DRAGON_NEEDS} or more`;
      case 'volcanoOrNot': return `Roll ${VOLCANO_NEEDS} or more to avoid the volcano`;
      case 'spike': return `Spike ball! Roll ${this.spikeNeeds} or more`;
      case 'crates': return 'Crates or barrels? Pick a path';
      case 'duel': return '1 vs 1! Pick who to challenge';
      case 'tornado': return 'Tornado! Stop the wheel and the die';
      case 'ufo': return 'UFO! Stop the wheel';
      default: return '';
    }
  }

  /** Tornado / UFO: the wheel the player must stop. `slots` = a slice per candidate. */
  _wheelInfo() {
    const st = this.step;
    return st?.kind === 'wheel' ? { wheel: { purpose: st.purpose, slots: [...st.pool] } } : {};
  }

  /** 1st, 2nd... by how close each player is to the final challenge (ties share a place). */
  _places() {
    const left = {};
    for (const s of this.players) left[s] = spacesToGo(this.positions[s], this.volcanoReturn[s]);
    const out = {};
    for (const s of this.players) out[s] = 1 + this.players.filter((o) => left[o] < left[s]).length;
    return out;
  }

  /** Crates/barrels, or (1v1 space) the other players to pick from. `slots` maps each button to a player. */
  _choiceOptions() {
    const o = this.step?.options;
    if (!o) return { options: ['Crates', 'Barrels'] };
    const pl = this._places(); // 1v1: boxes sorted by place, then the "?" box that lets the game pick
    return { options: [...o.map(String), '?'], slots: [...o, null], places: [...o.map((q) => pl[q]), null] };
  }

  _atFinal(slot) { const p = this.positions[slot]; return p.track === 'island' && p.idx === FINAL_IDX; }

  /** What the current player's screen should be asking for (also lets a returning player catch up). */
  _control() {
    const slot = this.current();
    if (this.phase === 'rolling') {
      const extra = this.step?.kind === 'extra';
      return { type: 'roll', slot, dice: this._diceKinds(), label: this._label(), add: extra, landed: extra ? this.step.dice : undefined, ...this._wheelInfo() };
    }
    if (this.phase === 'choosing') return { type: 'choose', slot, label: this._label(), ...this._choiceOptions() };
    return null;
  }

  snapshot() {
    const positions = {};
    for (const s of this.players) positions[s] = { ...this.positions[s] };
    return {
      round: this.round, order: [...this.order], curves: { ...this.curves }, tiers: { ...this.tiers }, positions,
      turn: this.turn, current: this.over ? null : this.current(), over: this.over, winner: this.winner,
      phase: this.phase, control: this.over ? null : this._control(), spikeNeeds: this.spikeNeeds, broken: { ...this.broken }, eruptions: this.eruptions.length,
      volcanoReturn: Object.fromEntries(Object.entries(this.volcanoReturn).map(([k, v]) => [k, { ...v }])),
    };
  }

  // ---- input from players ----
  /** A human pressed Stop on the spinning dice. */
  requestStop(slot) {
    if (this.over || this.phase !== 'rolling' || slot !== this.current()) return false;
    this.stopRequested = true;
    return true;
  }

  /** A human picked crates (0) or barrels (1). */
  requestChoice(slot, option) {
    const n = this.step?.purpose === 'duel' ? this.step.options.length + 1 : 2;
    if (this.over || this.phase !== 'choosing' || slot !== this.current() || !Number.isInteger(option) || option < 0 || option >= n) return false;
    this.choice = option;
    return true;
  }

  /** Called ~60x/second by the host. Returns { events, board } when something happened. */
  update(now) {
    if (this.over) return null;
    const cur = this.current(), npc = this.isNpc(cur);
    if (this.phase === 'waiting') return now >= this.readyAt ? this._begin(now) : null;
    if (this.phase === 'rolling') {
      if (this.stopRequested || (npc && now >= this.phaseAt + TIMING.npcRoll) || now >= this.phaseAt + TIMING.autoStop) {
        return this._resolveRoll(now);
      }
    } else if (this.phase === 'choosing') {
      const think = this.step && this.step.purpose === 'duel' ? TIMING.npcDuel : TIMING.npcChoose;
      if (this.choice != null || (npc && now >= this.phaseAt + think) || now >= this.phaseAt + TIMING.autoStop) {
        return this._resolveChoice(now);
      }
    }
    return null;
  }

  /** Dice start spinning (or the crates/barrels choice appears). Nothing is decided yet. */
  _begin(now) {
    const slot = this.current();
    this.stopRequested = false; this.choice = null;
    const events = [];
    this.phaseAt = now;
    if (!this.step) { // a brand-new turn: black fade, the player's name, then the dice
      events.push({ t: 'turnStart', slot, dur: DUR.turnIntro });
      this.phaseAt = now + DUR.turnIntro; // CPU / auto-stop timers count from when the dice appear
    }
    if (this.step?.kind === 'choice') {
      this.phase = 'choosing';
      events.push({ t: 'choiceStart', slot, label: this._label(), ...this._choiceOptions(), dur: 0 });
    } else {
      this.phase = 'rolling';
      const extra = this.step?.kind === 'extra';
      events.push({
        t: 'diceStart', slot, dice: this._diceKinds(), label: this._label(), dur: 0, ...this._wheelInfo(),
        ...(extra ? { add: true, landed: this.step.dice } : {}),
      });
    }
    return { events, board: this.snapshot() };
  }

  _resolveRoll(now) {
    const slot = this.current(), events = [];
    this.stopRequested = false;
    const kind = this.step?.kind;
    const endTurn = kind === 'wheel' ? this._resolveWheel(slot, events)
      : kind === 'single' ? this._resolveSingle(slot, events)
      : kind === 'extra' ? this._resolveExtra(slot, events) : this._resolveMove(slot, events);
    return this._commit(now, events, endTurn);
  }

  _resolveChoice(now) {
    const slot = this.current(), events = [], step = this.step;
    if (step.purpose === 'duel') { // 1v1 space: the opponent was picked
      const random = this.choice === step.options.length; // the "?" box
      // CPUs pick any real opponent: the card their pointer went to (npcPick, set by the host) when there is one
      const hint = this.choice == null && Number.isInteger(this.npcPick) && this.npcPick >= 0 && this.npcPick < step.options.length ? this.npcPick : null;
      const idx = hint != null ? hint : this.choice == null || random ? Math.floor(this.rng() * step.options.length) : this.choice;
      this.choice = null; this.step = null; this.npcPick = null;
      events.push({ t: 'choiceStop', slot, picked: idx, dur: 0 });
      if (random) events.push(note(slot, `The game picks {${step.options[idx]}}!`));
      this._duel(slot, step.options[idx], events);
      return this._commit(now, events, this._afterEffects(slot));
    }
    const picked = this.choice ?? Math.floor(this.rng() * 2);
    this.choice = null;
    const safe = Math.floor(this.rng() * 2); // the safe path is decided only now, so nobody can peek
    const hit = Math.min(2, Math.floor(this.rng() * 3)); // which of the three crates (or barrels) gives way, if it is the wrong path
    events.push({ t: 'choiceStop', slot, picked, dur: 0 }); // screens remove the Crates/Barrels buttons
    let endTurn;
    if (picked === safe) {
      events.push(note(slot, 'Safe! You hop across.', { fx: 'crates', picked, safe: true, hit }));
      endTurn = this._pass(slot, step.remaining, events);
    } else {
      events.push(note(slot, 'Crack! A crate breaks and you swim across.', { fx: 'crates', picked, safe: false, hit }));
      // wiki: leftover spaces become 0. They swim to the far bank and stand there, short of the next space: that spot is
      // not a space and does not count (the next roll's first step is the space after the pool)
      const at = this.positions[slot], next = walkForward(at, 1);
      events.push({ ...move(slot, 'fast', next.path, null, false, { ...at }), dur: DUR.swim, swim: true, stopShort: true, to: { ...at, across: true } });
      this.positions[slot] = { ...at, across: true };
      endTurn = true;
    }
    return this._commit(now, events, endTurn);
  }

  /** Finish this step: either the turn is over (next player / next round) or the same player continues. */
  _commit(now, events, endTurn) {
    if (endTurn && this.pendingBreak) { // the spike statue: once the turn has played out (a minigame and all), it breaks
      events.push({ t: 'broken', slot: this.pendingBreak.slot, challenge: this.pendingBreak.challenge, dur: DUR.spikeBreak, later: true });
      this.pendingBreak = null;
    }
    if (!this.over && endTurn) {
      this.step = null;
      const before = this.eruptions.length; // eruptions wear off after three other turns
      for (const e of this.eruptions) { if (e.fresh) e.fresh = false; else e.left--; }
      this.eruptions = this.eruptions.filter((e) => e.left > 0);
      if (this.eruptions.length !== before) events.push({ t: 'eruption', active: this.eruptions.length, dur: 0 });
      this.turn++;
      if (this.turn >= this.order.length) { // everyone has gone: fly over the map until the (future) minigame, then next round
        events.push({ t: 'flyover', round: this.round, dur: DUR.flyover });
        events.push(...this._startRound(now));
      }
    }
    this.phase = 'waiting';
    this.readyAt = now + events.reduce((a, e) => a + (e.dur || 0), 0) + TIMING.gap;
    return { events, board: this.snapshot() };
  }

  /**
   * Dev tools (offline games): during your own main roll, skip the dice and put you straight on a spot, which then
   * works as if you had landed there (a space's effect, a challenge starting, the summit). Returns a turn result.
   */
  devJump(slot, at, now) {
    if (this.over || this.phase !== 'rolling' || this.current() !== slot || this.step) return null;
    const events = [{ t: 'devJump', slot, to: { ...at }, dur: 700 }];
    const from = { ...this.positions[slot] };
    this.stopRequested = false; this.rigNext = null;
    this.positions[slot] = { ...at };
    let endTurn = true;
    if (at.track === 'volcano') { this.volcanoReturn[slot] = from.track === 'island' ? from : (this.volcanoReturn[slot] || EXIT_POS); }
    else {
      const type = ISLAND[at.idx] && ISLAND[at.idx].type;
      if (isChallenge(type) && !this.broken[type] && type !== 'final') {
        this.step = type === 'crates' ? { kind: 'choice', purpose: 'crates', remaining: 0 } : { kind: 'single', purpose: type, remaining: 0 };
        endTurn = false;
      } else if (at.idx > 0) endTurn = this._after(slot, 'landed', events);
    }
    return this._commit(now, events, endTurn);
  }

  // ---- the main roll (standard die + the rank die). Doubles: a 3rd fair die spins and is stopped separately ----
  _resolveMove(slot, events) {
    const tier = this.tiers[slot], curve = this.curves[slot];
    if (this.rigNext != null) { // dev tools (offline only): the next roll is set; one plain die (or two for more than 6), no doubles
      const n = this.rigNext; this.rigNext = null;
      const dice = n <= 6 ? [{ v: n, kind: 'base' }] : [{ v: 6, kind: 'base' }, { v: n - 6, kind: 'bonus', tier: tier || 'silver' }];
      events.push({ t: 'diceStop', slot, dice, total: n, doubles: false, dur: DUR.diceStop });
      return this._useTotal(slot, n, events);
    }
    const dice = [{ v: rollDie(this.rng, 0), kind: 'base' }];
    if (tier) dice.push({ v: rollDie(this.rng, curve), kind: 'bonus', tier });
    const sum = dice.reduce((a, d) => a + d.v, 0);
    if (dice.length === 2 && dice[0].v === dice[1].v) {
      events.push({ t: 'diceStop', slot, dice, total: sum, doubles: true, partial: true, dur: DUR.diceStop });
      this.step = { kind: 'extra', carried: sum, dice };
      return false; // same player: the bonus die spins next
    }
    events.push({ t: 'diceStop', slot, dice, total: sum, doubles: false, dur: DUR.diceStop });
    return this._useTotal(slot, sum, events);
  }

  _resolveExtra(slot, events) {
    const carried = this.step.carried, d = rollDie(this.rng, 0);
    const total = carried + d;
    events.push({ t: 'diceStop', slot, dice: [{ v: d, kind: 'extra' }], total, doubles: true, add: true, dur: DUR.diceStop });
    this.step = null;
    return this._useTotal(slot, total, events);
  }

  /** The dice are done: spend the total (an attempt at the final challenge, or a walk). */
  _useTotal(slot, total, events) {
    if (this._atFinal(slot)) { // already waiting at the final challenge: these dice are the attempt
      if (total >= WIN_ROLL) this._win(slot, events);
      else events.push(note(slot, `Needs ${WIN_ROLL} or more. Rolled ${total}.`, { fx: 'finalFail', dur: DUR.finalFail }));
      return true;
    }
    return this._after(slot, this._walkMain(slot, total, events), events);
  }

  /** Stop pressed on the tornado / UFO wheel: the wheel (and the tornado's die) land together. */
  _resolveWheel(slot, events) {
    const step = this.step, pool = step.pool;
    this.step = null;
    const victim = pool[Math.floor(this.rng() * pool.length)];
    if (step.purpose === 'tornado') {
      const v = rollDie(this.rng, 0), n = 4 + (v - 1) % 3; // the red die shows 4, 5, 6, 4, 5, 6
      events.push({ t: 'diceStop', slot, dice: [{ v, kind: 'tornado' }], total: n, doubles: false, wheel: { target: victim }, dur: DUR.diceStop });
      events.push(note(slot, `{${victim}} is swept back ${n} spaces!`, { wonder: [victim] }));
      const vp = this.positions[victim], eff = Math.min(n, vp.idx), from = events.length;
      this._moveTo(victim, walkBack(vp, n), 'fly', events, BACK(eff), true);
      const ev = events.slice(from).find((e) => e.t === 'move' && e.slot === victim && e.mode === 'fly');
      if (ev) { ev.tornado = true; ev.dur = DUR.tornado; } // the game's tornado carries them back along the path
    } else {
      events.push({ t: 'diceStop', slot, dice: [], total: 0, doubles: false, wheel: { target: victim }, dur: DUR.diceStop });
      const a = { ...this.positions[slot] }, b = { ...this.positions[victim] };
      events.push(note(slot, `UFO! You swap places with {${victim}}!`, { wonder: [slot, victim] }));
      // the UFO beams up the roller, then the other player, drops the other player on the roller's spot, then the roller
      events.push({ t: 'ufo', phase: 'up', slot, dur: DUR.ufo });
      events.push({ t: 'ufo', phase: 'up', slot: victim, dur: DUR.ufo });
      events.push({ t: 'ufo', phase: 'down', slot: victim, to: a, dur: DUR.ufo });
      events.push({ t: 'ufo', phase: 'down', slot, to: b, dur: DUR.ufo });
      this.positions[slot] = b; this.positions[victim] = a;
    }
    return this._afterEffects(slot);
  }

  // ---- single-die rolls: challenges and the first final-challenge attempt ----
  _resolveSingle(slot, events) {
    const step = this.step, d = this.rigNext != null ? Math.max(1, Math.min(6, this.rigNext)) : rollDie(this.rng, 0);
    this.rigNext = null;
    events.push({ t: 'diceStop', slot, dice: [{ v: d, kind: 'base' }], total: d, doubles: false, dur: DUR.diceStop });
    const pos = this.positions[slot];
    const pass = (text, wall = null) => {
      events.push(note(slot, text));
      if (wall) { // the wall is gone for everyone from now on
        this.broken[wall] = true;
        events.push({ t: 'broken', slot, challenge: wall, dur: DUR.wall }); // slot: who smashes it (the scene plays them doing it)
      }
      return this._pass(slot, step.remaining, events);
    };

    switch (step.purpose) {
      case 'final':
        if (d >= WIN_ROLL) this._win(slot, events);
        else events.push(note(slot, `Needs a ${WIN_ROLL}. Rolled ${d}. Try again next round!`, { fx: 'finalFail', dur: DUR.finalFail }));
        return true;
      case 'vine': // wiki: no penalty; the roll is extra spaces
        events.push(note(slot, `Vine swing! +${d} spaces`));
        { const from = events.length, r = this._pass(slot, step.remaining + d, events), mv = events.slice(from).find((e) => e.t === 'move');
          if (mv) { // the first d spaces are flown on the vine: they take the swing's time, not walking time (and the gorge is flown over)
            mv.swing = Math.min(d, mv.path.length);
            mv.dur += DUR.swing + (mv.path.length > mv.swing ? DUR.vinePause : 0) - mv.swing * DUR.walkStep - DUR.cross;
            mv.dur = Math.max(mv.dur, DUR.swing);
          }
          return r; }
      case 'dragon':
        if (d >= DRAGON_NEEDS) return pass('The dragon wall breaks!', 'dragon');
        events.push(note(slot, 'Fireball! Back one space.', { fx: 'fireball', dur: DUR.fire, wonder: [slot] }));
        this._moveTo(slot, walkBack(pos, 1), 'knock', events, BACK(1));
        return true;
      case 'volcanoOrNot':
        if (d >= VOLCANO_NEEDS) return pass('You dodge the volcano!');
        events.push(note(slot, 'Into the volcano!'));
        this._intoVolcano(slot, { track: 'island', idx: VOLCANO_CHALLENGE_IDX, across: true }, events); // they come back out past the pit, short of the next space (not a space)
        return true;
      case 'spike': {
        if (d >= this.spikeNeeds) { // they go on at once; the statue breaks once everything this turn has played out
          events.push(note(slot, 'You get past the spike ball!'));
          this.broken.spike = true; this.pendingBreak = { challenge: 'spike', slot };
          return this._pass(slot, step.remaining, events);
        }
        const was = this.spikeNeeds;
        this.spikeNeeds = Math.max(SPIKE_MIN, this.spikeNeeds - 1); // easier for the next attempt
        events.push(note(slot, 'The spike ball chases you back!', { fx: 'pit', dur: DUR.pit }));
        { const safe = VOLCANO_CHALLENGE_IDX + 1, on = this.players.filter((o) => o === slot || (this.positions[o].track === 'island' && this.positions[o].idx > safe && this.positions[o].idx < SPIKE_IDX));
          events.push({ t: 'spikeShock', slot, slots: on, dur: DUR.shock }); } // (all of them at once, in one shot of the whole stretch)
        // everyone who runs from it ends past the space after the volcano challenge, on the spot just short of it (not a
        // space: the way on counts that space first)
        const bank = { track: 'island', idx: VOLCANO_CHALLENGE_IDX, across: true };
        this._moveTo(slot, walkBack(pos, SPIKE_RUNBACK), 'fast', events, BACK(SPIKE_RUNBACK));
        { const mv = events[events.length - 1]; if (mv.t === 'move' && mv.slot === slot && this.positions[slot].idx === VOLCANO_CHALLENGE_IDX + 1) { mv.stopShort = true; mv.to = { ...bank }; this.positions[slot] = { ...bank }; } }
        const safeIdx = VOLCANO_CHALLENGE_IDX + 1; // the space right after the volcano challenge
        for (const other of this.players) { // everyone on the stretch below the spike ball runs from it too, at the same time
          const p = this.positions[other];
          if (other === slot || p.track !== 'island' || p.idx <= safeIdx || p.idx >= SPIKE_IDX) continue;
          const path = [];
          for (let i = p.idx - 1; i >= safeIdx; i--) path.push({ track: 'island', idx: i });
          events.push({ ...move(other, 'fast', path, BACK(path.length)), with: true, stopShort: true, to: { ...bank } });
          this.positions[other] = { ...bank };
        }
        if (this.spikeNeeds !== was) events.push(note(slot, `Now roll ${this.spikeNeeds} or more`, { fx: 'spikeCount', from: was, to: this.spikeNeeds, dur: DUR.spikeCount }));
        return true;
      }
      default: return true;
    }
  }

  // ---- shared helpers ----
  _win(slot, events) {
    events.push({ t: 'broken', slot, challenge: 'final', dur: DUR.gate }); // they kick the summit gate to pieces first
    this.positions[slot] = { track: 'island', idx: FINISH_IDX };
    events.push(move(slot, 'walk', [{ track: 'island', idx: FINISH_IDX }]));
    events.push({ t: 'win', slot, dur: DUR.round });
    this.over = true; this.winner = slot;
  }

  /** Dice-driven walk: stops at the first challenge it reaches. Returns 'challenge' | 'exited' | 'landed'. */
  _walkMain(slot, n, events) {
    const w = walkForward(this.positions[slot], n, { stopAtChallenges: true, broken: this.broken });
    this._moveTo(slot, w, 'walk', events, FWD(n), false, true);
    if (w.exited && w.remaining > 1) return this._walkMain(slot, w.remaining - 1, events); // out of the volcano (the way out is one step): the rest of the roll is walked on the island
    if (w.challenge) {
      this.step = w.challenge === 'crates'
        ? { kind: 'choice', purpose: 'crates', remaining: w.remaining }
        : { kind: 'single', purpose: w.challenge, remaining: w.remaining };
      return 'challenge';
    }
    return w.exited ? 'exited' : 'landed';
  }

  /** Passed a challenge: keep walking with the spaces that were left. */
  _pass(slot, n, events) {
    this.step = null;
    return this._after(slot, this._walkMain(slot, n, events), events);
  }

  /** After any walk: apply the landing space, and start the final challenge if we just arrived there.
   *  Returns true if the turn is over, false if the same player keeps going. */
  _after(slot, outcome, events) {
    if (outcome === 'challenge') return false;
    if (outcome === 'landed' && this._landing(slot, { ...this.positions[slot] }, events)) return false; // a choice (1v1 opponent) is pending
    if (!this.over && this._atFinal(slot)) { // arrived: one immediate roll of a single die
      this.step = { kind: 'single', purpose: 'final' };
      return false;
    }
    return true;
  }

  /** Record a finished walk, and handle leaving the volcano. */
  _moveTo(slot, w, mode, events, count, follow = false, dice = false) {
    if (w.path.length) events.push(move(slot, mode, w.path, count, follow, { ...this.positions[slot] }));
    this.positions[slot] = { ...w.end };
    if (w.exited) {
      events.push(note(slot, 'Back to the island!'));
      this._outOfVolcano(slot, events);
      // spaces left over (the way out counts as one): a die roll walks them on (the caller does that, stopping at challenges); a space effect's
      // move (a +4 inside the volcano) carries on past challenges like any effect move, without a new landing
      if (!dice && w.remaining > 1) this._moveTo(slot, walkForward(this.positions[slot], w.remaining - 1), mode, events, FWD(w.remaining - 1), follow);
    }
  }

  /** Down into the volcano; `back` is the island spot they will come back out at. */
  _intoVolcano(slot, back, events) {
    this.volcanoReturn[slot] = { track: 'island', idx: back.idx, ...(back.across ? { across: true } : {}) };
    this._teleport(slot, { track: 'volcano', idx: 0 }, 'drop', events);
  }

  /** Out of the volcano, at the spot they went in (past the pit for the volcano-or-not star). */
  _outOfVolcano(slot, events) {
    const back = this.volcanoReturn[slot] || EXIT_POS;
    delete this.volcanoReturn[slot];
    this._teleport(slot, back, 'drop', events);
  }

  _teleport(slot, dest, mode, events) {
    this.positions[slot] = { ...dest };
    events.push(move(slot, mode, [{ ...dest }]));
  }

  /** The turn's follow-up after an effect that does not need a die: the final challenge may be next. Returns true if the turn is over. */
  _afterEffects(slot) {
    if (!this.over && this._atFinal(slot)) { this.step = { kind: 'single', purpose: 'final' }; return false; }
    return true;
  }

  /** A statue throws the player: its hands wake up, it launches them high over the island onto its platform. */
  _statueThrow(slot, w, color, events, count) {
    const from = events.length;
    this._moveTo(slot, w, 'fly', events, count);
    const ev = events.slice(from).find((e) => e.t === 'move' && e.slot === slot && e.mode === 'fly');
    if (ev) { ev.statue = color; ev.dur = DUR.statueThrow; }
  }

  /** A move made by a big spring that pops out of the ground (blue: + space, red: - space, green: minigame). */
  _spring(slot, w, color, events, count, follow = false) {
    const from = events.length;
    this._moveTo(slot, w, 'spring', events, count, follow);
    const ev = events.slice(from).find((e) => e.t === 'move' && e.slot === slot && e.mode === 'spring');
    if (ev) ev.spring = color;
  }

  /** Placeholder for the 1v1 minigame (none are built yet): 45% win, 45% lose, 10% tie. */
  _duel(slot, opp, events) {
    events.push(note(slot, `1 vs 1! {${slot}} challenges {${opp}}`));
    events.push({ t: 'minigame', kind: 'duel', slot, opp, dur: DUR.minigame });
    const r = this.rng();
    if (r < 0.45) {
      events.push(note(slot, `{${slot}} wins! +${DUEL_MOVE}, and {${opp}} goes back ${DUEL_MOVE}`));
      this._spring(slot, walkForward(this.positions[slot], DUEL_MOVE), 'green', events, FWD(DUEL_MOVE));
      this._spring(opp, walkBack(this.positions[opp], DUEL_MOVE), 'green', events, BACK(DUEL_MOVE), true);
    } else events.push(note(slot, r < 0.9 ? `{${opp}} wins. Nothing happens.` : 'A tie! Nothing happens.'));
  }

  /** What happens when a die roll ends on a space. Effects never chain (wiki: "not cumulative").
   *  Returns true when the space needs the player to choose something first (1v1 opponent). */
  _landing(slot, end, events) {
    const node = nodeAt(end), pos = { ...end };
    const say = (text) => events.push(note(slot, text));
    const fwd = (n, mode) => this._moveTo(slot, walkForward(pos, n), mode, events, FWD(n)); // effect moves pass challenges freely
    const back = (n, mode) => this._moveTo(slot, walkBack(pos, n), mode, events, BACK(n));
    const onIsland = (s) => this.positions[s].track === 'island';

    if (end.track === 'island' && node.type !== 'volcano' && this.eruptions.length && !LAVA_SAFE.has(node.type)) {
      // a meteor knocks them back; landing on another lava space, another one does, until they land somewhere safe
      const n = LAVA_BACK * this.eruptions.length; // every active eruption adds another -4
      let at = pos;
      for (let k = 0; k < 40; k++) {
        say(k ? `Lava again! -${n}` : `Lava! -${n}`);
        this._moveTo(slot, walkBack(at, n), 'fly', events, BACK(n));
        const mv = events[events.length - 1]; if (mv && mv.t === 'move' && mv.slot === slot) { mv.meteor = true; mv.dur = DUR.meteorHit; }
        at = this.positions[slot];
        const nd = nodeAt(at);
        if (at.track !== 'island' || at.idx === pos.idx || nd.type === 'volcano' || LAVA_SAFE.has(nd.type)) break;
      }
      return false;
    }

    switch (node.type) {
      case 'plus4': case 'plus5': case 'plus6': { const n = Number(node.type.slice(4)); events.push(note(slot, `+${n}!`, { wonder: [slot] })); this._spring(slot, walkForward(pos, n), 'blue', events, FWD(n)); break; }
      case 'minus4': say('-4...'); this._spring(slot, walkBack(pos, 4), 'red', events, BACK(4)); break;
      case 'statueBlue': say('The blue statue throws you ahead!'); this._statueThrow(slot, walkForward(pos, node.arg), 'blue', events, FWD(node.arg)); break;
      case 'statueRed': say('The red statue throws you back!'); this._statueThrow(slot, walkBack(pos, node.arg), 'red', events, BACK(node.arg)); break;
      case 'dino':
        // Assumption: the dino die is 50/50 pterodactyl (+10) or T-Rex (back).
        if (this.rng() < 0.5) { say('Pterodactyl! +10'); fwd(10, 'fly'); }
        else { say(`T-Rex! Back ${node.arg}`); back(node.arg, 'fly'); }
        break;
      case 'skull': events.push(note(slot, 'Skull! Down into the volcano...', { wonder: [slot] })); this._intoVolcano(slot, pos, events); break; // they come back out on this skull
      case 'shout': events.push(note(slot, 'Shout! Back to the island!', { wonder: [slot] })); this._outOfVolcano(slot, events); break;
      case 'tornado': { // wiki: a player die and a -4/-5/-6 die. Nobody in the volcano or on the start space is touched.
        const pool = this.players.filter((s) => s !== slot && onIsland(s) && this.positions[s].idx > 0); // never yourself
        if (!pool.length) { say('Tornado! Nobody to blow back.'); break; }
        say('Tornado!');
        this.step = { kind: 'wheel', purpose: 'tornado', pool };
        return true; // the player stops the wheel and the die
      }
      case 'ufo': { // wiki: swap with a random other player. Not the volcano, not the same space.
        const pool = this.players.filter((s) => s !== slot && onIsland(s) && this.positions[s].idx !== end.idx);
        if (!pool.length) { say('UFO! Nobody to swap with.'); break; }
        say('UFO!');
        this.step = { kind: 'wheel', purpose: 'ufo', pool };
        return true;
      }
      case 'volcano': { // wiki: every non-blank space outside the volcano becomes -4 for three turns; eruptions stack
        this.eruptions.push({ left: ERUPTION_TURNS, fresh: true });
        const others = ERUPTION_STRETCHES.map((_, i) => i).slice(1), hit = [0];
        while (hit.length < 3) hit.push(others.splice(Math.floor(this.rng() * others.length) % others.length, 1)[0]);
        events.push({ t: 'eruption', active: this.eruptions.length, dur: DUR.eruption, stretches: hit });
        break;
      }
      case 'mgRest': { // placeholder minigame: the solo player wins with probability 1 / players
        say('1 vs Rest! {' + slot + '} plays alone against everyone else');
        events.push({ t: 'minigame', kind: 'rest', slot, dur: DUR.minigame });
        if (this.rng() < 1 / this.players.length) { say(`{${slot}} wins! +${REST_WIN_MOVE}`); this._spring(slot, walkForward(pos, REST_WIN_MOVE), 'green', events, FWD(REST_WIN_MOVE)); }
        else say('The rest win. Nothing happens.');
        break;
      }
      case 'mg11': { // the roller picks an opponent who is not in the volcano
        const pool = this.players.filter((s) => s !== slot && onIsland(s));
        if (!pool.length) { say('1 vs 1! Nobody to challenge.'); break; }
        const pl = this._places();
        this.step = { kind: 'choice', purpose: 'duel', options: [...pool].sort((x, y) => pl[x] - pl[y] || x - y) };
        return true;
      }
      default: break;
    }
    return false;
  }
}
