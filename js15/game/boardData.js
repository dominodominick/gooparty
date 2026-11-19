// Board Game Island, straight from the wiki's "Order of Spaces".
// Space types: start plus4 plus5 plus6 minus4 blank tornado ufo mgRest (1vRest minigame: one player against everyone else) mg11 (1v1 minigame)
//   challenges: vine dragon crates volcanoOrNot spike | final finish
//   specials:   dino:<spaces back on T-Rex> statueBlue:<spaces forward> statueRed:<spaces back> volcano skull
// Volcano track: start plus4 blank plus4 shout blank blank blank blank exit

const parse = (s) => {
  const [type, arg] = s.split(':');
  return { type, arg: arg === undefined ? undefined : Number(arg) };
};

// Index 0 is the start area and 79 is the summit. The other stops are the map's 72 spaces, in order, plus the six
// challenge stars between them (vine 7, dragon 24, crates 42, volcano-or-not 49, spike ball 61, final 78). A star is
// where the challenge is faced; it does not count as a space when walking.
export const ISLAND = (
  'start plus5 blank blank blank blank blank vine blank blank plus6 blank plus4 mgRest blank blank ufo plus4 ' +
  'blank blank blank tornado minus4 blank dragon blank blank mgRest statueBlue:18 skull statueBlue:16 blank blank ' +
  'dino:9 plus5 volcano tornado blank plus6 mg11 ufo blank crates blank plus5 statueRed:18 dino:4 blank mgRest ' +
  'volcanoOrNot blank plus6 mg11 blank plus5 blank plus4 ufo blank blank blank spike plus6 mg11 blank blank ' +
  'plus4 blank tornado minus4 blank skull tornado blank blank blank ufo minus4 final finish'
).split(' ').map(parse);

export const VOLCANO = 'start plus4 blank plus4 shout blank blank blank blank exit'.split(' ').map(parse);

// Challenge spaces don't count as a step when moving (wiki: "does not count as a space").
const CHALLENGES = new Set(['vine', 'dragon', 'crates', 'volcanoOrNot', 'spike']);
export const isChallenge = (type) => CHALLENGES.has(type);

export const FINAL_IDX = ISLAND.findIndex((n) => n.type === 'final');
export const FINISH_IDX = ISLAND.findIndex((n) => n.type === 'finish');
export const VOLCANO_SPACE_IDX = ISLAND.findIndex((n) => n.type === 'volcano');
export const VOLCANO_CHALLENGE_IDX = ISLAND.findIndex((n) => n.type === 'volcanoOrNot');
export const SPIKE_IDX = ISLAND.findIndex((n) => n.type === 'spike');
export const EXIT_POS = { track: 'island', idx: 47 }; // fallback way out of the volcano (the map's space 44); players normally come out where they went in

export const trackNodes = (track) => (track === 'island' ? ISLAND : VOLCANO);
export const nodeAt = (pos) => trackNodes(pos.track)[pos.idx];

// Text/emoji drawn on each tile, and tile colors.
export const LABELS = {
  start: 'GO', plus4: '+4', plus5: '+5', plus6: '+6', minus4: '-4', blank: '',
  tornado: '\u{1F32A}', ufo: '\u{1F6F8}', mgRest: '1vRest', mg11: '1v1',
  vine: '\u2605', dragon: '\u2605', crates: '\u2605', volcanoOrNot: '\u2605', spike: '\u2605',
  final: '\u{1F3C1}', finish: '\u{1F3C6}', dino: '\u{1F996}', statueBlue: '\u{1F5FF}', statueRed: '\u{1F5FF}',
  volcano: '\u{1F30B}', skull: '\u2620', shout: '!', exit: '',
};
export const TILE_COLORS = {
  start: '#e9f5ff', blank: '#f4efe0', plus4: '#8ec5ff', plus5: '#6aaeff', plus6: '#4796ff', minus4: '#ff9a9a',
  tornado: '#ffe27a', ufo: '#ffe27a', dino: '#ffe27a', volcano: '#ff9a6a', skull: '#7a3fb8',
  statueBlue: '#8ec5ff', statueRed: '#ff9a9a', mgRest: '#9fe6a8', mg11: '#9fe6a8',
  vine: '#ffb3d6', dragon: '#ffb3d6', crates: '#ffb3d6', volcanoOrNot: '#ffb3d6', spike: '#ffb3d6',
  final: '#ffd84a', finish: '#ffd84a', shout: '#9fe6a8', exit: '#9fe6a8',
};

// Places where the path is interrupted and the players have to get across some other way.
const idxOfType = (t) => ISLAND.findIndex((n) => n.type === t);
export const GAPS = [
  { after: 0, kind: 'walk' },                       // from the start area, through the gate, to the first space
  { after: idxOfType('vine'), kind: 'swing' },     // the river gorge, crossed by swinging on the vine
  { after: 16, kind: 'bridge' },                    // the rope bridge (between the map's spaces 15 and 16)
  { after: idxOfType('dragon'), kind: 'wall' },     // the dragon wall blocks the way
  { after: idxOfType('crates'), kind: 'crates' },   // the waterfall pool, with floating crates and barrels to hop across
  { after: idxOfType('volcanoOrNot'), kind: 'tunnel' }, // the cave tunnel (walked through)
  { after: idxOfType('spike'), kind: 'pit' },       // the ledge with the spike ball
  { after: 70, kind: 'stairs' }, { after: 74, kind: 'stairs' }, { after: 78, kind: 'stairs' }, // steps up the temple
];
export const CROSSING_KINDS = new Set(['swing', 'crates', 'pit']); // gaps that are crossed by jumping/swinging, not walking
/** The gap between space i and i+1 (or i-1 and i) on the island, if there is one. */
export const gapBetween = (a, b) => (Math.abs(a - b) === 1 ? GAPS.find((g) => g.after === Math.min(a, b)) || null : null);
