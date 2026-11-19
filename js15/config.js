// Everything tweakable lives here.

export const GAME_TITLE = 'Party Island'; // placeholder name: pick your own

export const BUILD = '50'; // shown in the menu and in games; every player must have the same build

export const MAX_PLAYERS = 6;

// Player 1..6 colors, as in the design doc. `ink` is the readable text color on top of each.
export const PLAYER_COLORS = [
  { name: 'Blue',   hex: '#2f6fed', ink: '#ffffff' },
  { name: 'Red',    hex: '#e5383b', ink: '#ffffff' },
  { name: 'Green',  hex: '#2fb344', ink: '#ffffff' },
  { name: 'Yellow', hex: '#f6c90e', ink: '#1a1a1a' },
  { name: 'Pink',   hex: '#ff6fae', ink: '#1a1a1a' },
  { name: 'White',  hex: '#f7f7f7', ink: '#1a1a1a' },
];

export const NPC_DIFFICULTIES = ['Easy', 'Normal', 'Hard'];

// All game logic uses this fixed 16:9 field; pointers are sent as 0..1 fractions of it,
// so every player sees the same thing at any window size.
export const VIRTUAL = { w: 1280, h: 720 };

export const ROOM_PREFIX = 'partyisland-v1-'; // namespaces our room IDs on the public PeerJS broker
export const ROOM_CODE_LENGTH = 5;

export const NET = {
  clientSendHz: 30,    // how often a client reports its pointer to the host
  hostBroadcastHz: 20, // how often the host sends everyone's pointers
  pingEveryMs: 2000,
  dropAfterMs: 8000,   // host treats a silent client as disconnected
};

// STUN lets most players connect directly. If some friends can't connect (strict networks),
// add a TURN relay here, e.g. { urls: 'turn:YOUR_HOST:3478', username: '...', credential: '...' }
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};
