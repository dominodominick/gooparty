// Every moment the board plays (a set piece: a space's note, a move, a smash, the UFO, a turn starting...), by key. The
// sequence studio (js15/scenes/studioScene.js) lets each one be re-timed: which Mii animation plays when, where the
// camera is, what else happens. The sequences themselves are in sequences.js; the director (js15/scenes/director.js)
// plays them over the game's own set pieces.
//
// A key is worked out from the event the host sent and, for a space's note, the kind of space the player is on, so each
// kind of space can have its own: 'note@plus4', 'note@ufo', 'note.fireball', 'move.spring.blue', 'smash.dragon'...

import { LABELS } from './boardData.js';

const SPOTS = {
  start: 'Start', blank: 'Blank space', plus4: '+4 (blue spring)', plus5: '+5 (blue spring)', plus6: '+6 (blue spring)', minus4: '-4 (red spring)',
  tornado: 'Tornado', ufo: 'UFO', mgRest: '1 vs Rest minigame', mg11: '1 vs 1 minigame', dino: 'Dinosaur', statueBlue: 'Blue statue', statueRed: 'Red statue',
  skull: 'Skull (into the volcano)', shout: '! (out of the volcano)', volcano: 'Volcano', vine: 'Vine challenge', dragon: 'Dragon wall challenge',
  crates: 'Crates & barrels challenge', volcanoOrNot: 'Volcano-or-not challenge', spike: 'Spike ball challenge', final: 'Final challenge', finish: 'The summit', exit: 'Volcano exit',
};

/** The moment a scene event is, as a key ('' for none: a die appearing, a choice). spot: the kind of space they are on. */
export function momentKey(ev, spot = null) {
  if (!ev) return '';
  if (ev.moment) return ev.moment; // (an event can name its moment: the 1 vs 1 challenge, its result)
  switch (ev.t) {
    case 'space': return ev.fx ? `note.${ev.fx}` : `note@${spot || 'blank'}`;
    case 'move': {
      const m = ev.mode;
      if (m === 'spring') return `move.spring.${ev.spring || 'blue'}${ev.spring === 'green' && ev.count && ev.count.dir === 'back' ? '.back' : ''}`; // (green: after a minigame, forward for the winner, back for the loser)
      if (m === 'fly') return ev.meteor ? 'move.fly.meteor' : ev.tornado ? 'move.fly.tornado' : ev.statue ? `move.fly.statue.${ev.statue}` : 'move.fly';
      if (ev.swim) return 'move.swim';
      if (ev.swing) return 'move.swing';
      return `move.${m}`; // walk, fast, knock, drop
    }
    case 'broken': return ev.challenge === 'spike' ? (ev.later ? 'smash.spike' : 'smash.spike.now') : `smash.${ev.challenge}`;
    case 'spikeShock': return 'spike.shock';
    case 'turnStart': return 'turn.start';
    case 'roundStart': return 'round.start';
    case 'diceStop': return 'dice.land';
    case 'ufo': return `ufo.${ev.phase === 'down' ? 'down' : 'up'}`; // (beamed up, beamed down: one event each)
    case 'minigame': return ev.kind === 'duel' ? 'minigame.duel' : 'minigame.rest'; // (the 1 vs 1 and 1 vs Rest spaces: before the minigame)
    case 'eruption': return ev.dur ? 'eruption' : ''; // (only the volcano space's cutscene; not an eruption wearing off)
    case 'win': case 'flyover': return ev.t;
    default: return '';
  }
}

/**
 * Who is in a moment, in order: the Miis its tracks are for (Mii 1 is always the one whose moment it is). In a game,
 * Mii 1 is the event's player, then the others the event names (the opponent, the swapped player...), then everyone
 * else by player number. A sequence can have more Mii tracks than this (anyone else on the board).
 */
export function castOf(key) {
  const C = {
    'minigame.duel': ['Challenger', 'Opponent'],
    'minigame.rest': ['Solo player', 'The rest: 1', 'The rest: 2', 'The rest: 3'],
    'note@mg11': ['Challenger', 'Opponent'],
    'duel.challenge': ['Challenger', 'Opponent'],
    'duel.result': ['Winner', 'Loser'],
    'note@mgRest': ['Solo player', 'The rest: 1', 'The rest: 2', 'The rest: 3'],
    'ufo.up': ['Beamed up', 'Swapping with'], 'ufo.down': ['Put down', 'Swapping with'], 'note@ufo': ['Lands on the UFO', 'Swapping with'],
    'eruption': ['Landed on the volcano', 'Another Mii', 'Another Mii', 'Another Mii'],
    'note@volcano': ['Landed on the volcano'],
    'note@tornado': ['Lands on the tornado', 'Blown back'], 'move.fly.tornado': ['Blown back'],
    'spike.shock': ['Rolled', 'On the stretch', 'On the stretch', 'On the stretch'],
    'round.start': ['Goes 1st', 'Goes 2nd', 'Goes 3rd', 'Goes 4th'],
    'game.start': ['Goes 1st', 'Goes 2nd', 'Goes 3rd', 'Goes 4th'],
    'rest.win': ['Solo player'], 'rest.lose': ['Solo player'],
    'win': ['Winner', 'Another Mii', 'Another Mii', 'Another Mii'],
  };
  return C[key] || ['Player'];
}

/** Every moment, for the editor's list: { key, title, group }. */
export function allMoments() {
  const out = [];
  const add = (group, key, title) => out.push({ key, title, group });
  add('Special spaces', 'duel.challenge', '1 vs 1 space: the challenge (fighting pose)');
  add('Special spaces', 'minigame.duel', '1 vs 1 space: before the minigame');
  add('Special spaces', 'duel.result', '1 vs 1: who won (after the minigame)');
  add('Special spaces', 'minigame.rest', '1 vs Rest space: before the minigame');
  add('Special spaces', 'rest.win', '1 vs Rest: the solo player won (after the minigame)');
  add('Special spaces', 'rest.lose', '1 vs Rest: the rest won (after the minigame)');
  add('Special spaces', 'eruption', 'Volcano space: the eruption');
  add('Special spaces', 'ufo.up', 'UFO space: beamed up');
  add('Special spaces', 'ufo.down', 'UFO space: put down in the other place');
  add('Special spaces', 'move.fly.tornado', 'Tornado space: blown back');
  add('Special spaces', 'move.fly.statue.blue', 'Blue statue: thrown ahead');
  add('Special spaces', 'move.fly.statue.red', 'Red statue: thrown back');
  add('Special spaces', 'move.spring.blue', 'Blue spring (+4 / +5 / +6)');
  add('Special spaces', 'move.spring.red', 'Red spring (-4)');
  add('Special spaces', 'move.drop', 'Skull / volcano-or-not: into the volcano');
  add('Turns', 'game.start', 'The game starts (everyone cheers at the start)');
  add('Turns', 'round.start', 'A round starts (the order)');
  add('Turns', 'turn.start', "Someone's turn starts");
  add('Turns', 'dice.land', 'The die lands (the number)');
  add('Turns', 'flyover', 'The flyover between rounds');
  add('Turns', 'win', 'Someone wins');
  for (const [k, t] of Object.entries(SPOTS)) add('Landing on a space (its caption)', `note@${k}`, `${t}${LABELS[k] && !/^[★]/.test(LABELS[k]) ? ` (${LABELS[k]})` : ''}`);
  add('Moves', 'move.walk', 'Walking');
  add('Moves', 'move.fast', 'Running (pushed back by the spike ball)');
  add('Moves', 'move.swing', 'The vine swing');
  add('Moves', 'move.swim', 'Swimming (crates: wrong pick)');
  add('Moves', 'move.spring.green', 'Green spring forward (won a minigame)');
  add('Moves', 'move.spring.green.back', 'Green spring back (lost a 1 vs 1)');
  add('Moves', 'move.knock', "Knocked back (the dragon's fireball)");
  add('Moves', 'move.fly.meteor', 'Hit by a meteor (eruption)');
  add('Moves', 'move.fly', 'Flying (the dinosaur, other)');
  add('Challenges', 'note.fireball', "Dragon wall: missed (the fireball)");
  add('Challenges', 'smash.dragon', 'Dragon wall: smashed');
  add('Challenges', 'note.crates', 'Crates & barrels: the pick');
  add('Challenges', 'note.pit', 'Spike ball: spat out');
  add('Challenges', 'spike.shock', 'Spike ball: everyone on the stretch jumps');
  add('Challenges', 'note.spikeCount', 'Spike ball: the number goes down');
  add('Challenges', 'smash.spike', 'Spike statue: breaks (end of the turn)');
  add('Challenges', 'pass.volcanoOrNot', 'Volcano or not: dodged it');
  add('Challenges', 'pass.spike', 'Spike ball: got past it');
  add('Challenges', 'smash.final', 'Final challenge: gate kicked open');
  add('Challenges', 'note.finalFail', 'Final challenge: missed');
  return out;
}

/**
 * A sequence (version 2, as the studio makes it):
 *   { key, v: 2, len?, builtin: [blocks], miis: [{ anim: [blocks], face: [blocks] }, ...], camera: [keys], fx: [blocks] }
 * `len` (frames) is how long it lasts when set; otherwise until its last block (or the game's own set piece) ends.
 * An older sequence (one list of blocks, each with a track) is turned into this by upgradeSequence.
 */
export function upgradeSequence(seq) {
  if (!seq) return null;
  if (seq.v === 2) return seq;
  const out = { key: seq.key, v: 2, builtin: [], miis: [{ anim: [], face: [] }], camera: [], fx: [] };
  for (const b0 of seq.blocks || []) {
    const { track, ...b } = b0;
    if ((track === 'player' || track === 'others') && 'face' in b) { b.facing = b.face; delete b.face; } // (the old 'face' was which way they face)
    if (track === 'builtin') out.builtin.push(b);
    else if (track === 'fx') out.fx.push(b);
    else if (track === 'player') out.miis[0].anim.push(b);
    else if (track === 'others') { out.miis[1] ||= { anim: [], face: [] }; out.miis[1].anim.push(b); }
    else if (track === 'camera') {
      if (b.mode === 'builtin') out.camera.push({ at: b.at || 0, kind: 'own' });
      else if (b.mode === 'game') out.camera.push({ at: b.at || 0, kind: 'normal' });
      else if (b.shot) out.camera.push({ at: (b.at || 0) + (b.mode === 'glide' ? b.len || 0 : 0), kind: 'shot', shot: b.shot, ease: b.mode === 'glide' ? 'smooth' : 'cut', follow: b.follow ? 0 : null });
    }
  }
  out.camera.sort((a, b) => a.at - b.at);
  return out;
}

/** Every timed thing of a sequence (blocks and camera keys), for working out how long it is. */
function allBlocks(seq) {
  const s = upgradeSequence(seq);
  if (!s) return [];
  return [...(s.builtin || []), ...(s.fx || []), ...(s.miis || []).flatMap((m) => [...(m.anim || []), ...(m.face || [])]), ...(s.camera || []).map((k) => ({ at: k.at, len: 0 }))];
}

/** A sequence's length in frames (60 a second): its own length if set, else where its last block ends, or the game's own length. */
export function sequenceFrames(seq, builtinFrames = 0) {
  const s = upgradeSequence(seq);
  if (s && s.len > 0) return s.len;
  let end = 0;
  for (const b of allBlocks(s)) if (!b.rec) end = Math.max(end, (b.at || 0) + (b.len || 0));
  const hasBuiltin = !!(s && (s.builtin || []).some((b) => !b.rec));
  return Math.max(end, hasBuiltin ? 0 : builtinFrames);
}

/** Does a sequence change anything (anything not just recorded from the game)? */
export function sequenceIsEmpty(seq) {
  return !allBlocks(seq).some((b) => !b.rec) && !(seq && seq.len > 0);
}
