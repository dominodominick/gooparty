// Every moment the board plays (a set piece: a space's note, a move, a smash, the UFO, a turn starting...), by key. The
// sequence editor (js15/scenes/seqEditor.js) lets each one be re-timed: which Mii animation plays when, where the
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
  switch (ev.t) {
    case 'space': return ev.fx ? `note.${ev.fx}` : `note@${spot || 'blank'}`;
    case 'move': {
      const m = ev.mode;
      if (m === 'spring') return `move.spring.${ev.spring || 'blue'}`;
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
    case 'ufo': case 'eruption': case 'win': case 'minigame': case 'flyover': return ev.t;
    default: return '';
  }
}

/** Every moment, for the editor's list: { key, title, group }. */
export function allMoments() {
  const out = [];
  const add = (group, key, title) => out.push({ key, title, group });
  add('Turns', 'round.start', 'A round starts (the order)');
  add('Turns', 'turn.start', "Someone's turn starts");
  add('Turns', 'dice.land', 'The die lands (the number)');
  add('Turns', 'minigame', 'A minigame');
  add('Turns', 'flyover', 'The flyover between rounds');
  add('Turns', 'win', 'Someone wins');
  for (const [k, t] of Object.entries(SPOTS)) add('Landing on a space', `note@${k}`, `${t}${LABELS[k] && !/^[★]/.test(LABELS[k]) ? ` (${LABELS[k]})` : ''}`);
  add('Moves', 'move.walk', 'Walking');
  add('Moves', 'move.fast', 'Running (pushed back by the spike ball)');
  add('Moves', 'move.swing', 'The vine swing');
  add('Moves', 'move.swim', 'Swimming (crates: wrong pick)');
  add('Moves', 'move.spring.blue', 'Blue spring');
  add('Moves', 'move.spring.red', 'Red spring');
  add('Moves', 'move.spring.green', 'Green spring (after a minigame)');
  add('Moves', 'move.knock', "Knocked back (the dragon's fireball)");
  add('Moves', 'move.drop', 'Pushed into the volcano');
  add('Moves', 'move.fly.tornado', 'Carried back by the tornado');
  add('Moves', 'move.fly.meteor', 'Hit by a meteor (eruption)');
  add('Moves', 'move.fly.statue.blue', 'Thrown by a blue statue');
  add('Moves', 'move.fly.statue.red', 'Thrown by the red statue');
  add('Moves', 'move.fly', 'Flying (other)');
  add('Challenges', 'note.fireball', "Dragon wall: missed (the fireball)");
  add('Challenges', 'smash.dragon', 'Dragon wall: smashed');
  add('Challenges', 'note.crates', 'Crates & barrels: the pick');
  add('Challenges', 'note.pit', 'Spike ball: spat out');
  add('Challenges', 'spike.shock', 'Spike ball: everyone on the stretch jumps');
  add('Challenges', 'note.spikeCount', 'Spike ball: the number goes down');
  add('Challenges', 'smash.spike', 'Spike statue: breaks (end of the turn)');
  add('Challenges', 'smash.final', 'Final challenge: gate kicked open');
  add('Challenges', 'note.finalFail', 'Final challenge: missed');
  add('Events', 'ufo', 'The UFO swap');
  add('Events', 'eruption', 'The volcano erupts');
  return out;
}

/** A sequence's length in frames (60 a second): where its last block ends, or the game's own length. */
export function sequenceFrames(seq, builtinFrames = 0) {
  let end = 0, hasBuiltin = false;
  for (const b of (seq && seq.blocks) || []) {
    if (b.rec) continue; // (recorded from the game: shown, not played)
    if (b.track === 'builtin') hasBuiltin = true;
    end = Math.max(end, (b.at || 0) + (b.len || 0));
  }
  return Math.max(end, hasBuiltin ? 0 : builtinFrames);
}
