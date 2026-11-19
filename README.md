# Party Island (working title)

Online party game for 1-6 players (humans + CPUs) with a 3D board. Plain JavaScript modules,
PeerJS for room codes, Three.js for the board. No build step, no server of your own.

## Run it

Serve the folder (browsers block ES modules from `file://`):

    python3 -m http.server 8080      # then open http://localhost:8080

or use VS Code "Live Server". For friends, drag the folder onto Netlify Drop (or GitHub /
Cloudflare Pages) and share the lobby's "Copy invite link". You must be online: PeerJS and
Three.js load from CDNs (pinned versions) in `index.html`.

## v15: new board look (Wii Party style)

The whole board was rebuilt to resemble Wii Party's Board Game Island: a round island with beach, palms,
grass hills and a spiral orange dirt path climbing to a volcano-top temple (treasure room, cheering crowd),
a river with a rope bridge and a sea monster, textured picture tiles (blue/red/star/special), red -4 eruption
tiles, landmark props (statues, UFO, tornado, dino, skull, vine, dragon, crates, volcano), Mii-style pawns,
a lava cave with floating slabs for the volcano area, sky/sea/clouds, a path-following chase camera and a
new minimap. Game rules and HUD are unchanged. Geometry is generated in code (js15/world/*), no assets needed.

## What works now

- Start menu, create/join with a room code, lobby with 6 colored seats, CPUs with a difficulty.
- **3D Board Game Island** with the wiki's real 80-space layout, a separate volcano area, pawns,
  a follow camera, a map showing everyone's position (Leave is bottom-left, banners are at the top), and "spaces to go" per player.
- **Fixed 16:9 stage.** In game scenes everyone sees exactly the same 16:9 view (same field of view,
  same HUD layout), scaled to fit the window with dark bars. Menus stay fluid.
- **3D dice.** On your turn the dice start spinning on their own; press **Stop** (or Space) and they
  bounce, tumble into place and settle. The host picks the result at the moment you press Stop.
  Everyone watches. A CPU stops after a moment; a human who walks away is auto-stopped after 20s.
- **Rank dice**, per the design doc: a standard (white) die on the left, and everyone except last place
  also gets a die on the right: 1st gold, 2nd platinum, 3rd silver, 4th copper, 5th wood. It leans toward 6
  (1st most, each rank less; tune `CURVE_MAX` in `src/game/boardGame.js`). Last place: one die.
  Doubles on the two dice add a third, fair die.
- **All six challenges** (from the wiki):
  - Vine swing: roll, those are bonus spaces, no penalty.
  - Dragon wall: 4+ to pass, otherwise fireball: back 1 space.
  - Crates or barrels: you pick, 50/50; if it breaks you swim across and the leftover spaces are lost.
  - Volcano or Not: 3+ or you're thrown into the volcano.
  - Spike ball: 5+ (then 4, 3, 2 after each failure anywhere); fail = run back 11 spaces, and everyone in
    the ball's path runs back to the space after the volcano challenge.
  - Final challenge: reaching it gives one immediate single-die roll (6 wins). Miss it and you wait there;
    on later rounds your full dice count (total of 6+ wins).
  A dice move stops on a challenge; pass and you continue with the spaces you had left. Challenge spaces
  never count as a step. Moves from special spaces (+4, statues...) pass over them.
- **Turn changes** use a black fade: the screen fades out, shows the next player's name, and fades in on the
  dice. The camera only moves while the screen is black, never mid-turn.
- **Space counter** at the top while a player travels (counts down on each step; shows a minus and turns red for
  moves backwards). Challenge spaces don't count.
- **Doubles:** the two dice land and stay on the table, then the 3rd (white) die spins by itself and has its own Stop.
- **Broken walls:** once the dragon wall (or the spike-ball statue) is broken, it disappears for everyone.
- Volcano trips (in and out): the pawn shrinks, the camera stays a few seconds, then a black fade to the new place.
  Timings are in `DROP` in `src/game/boardGame.js`.
- Throws (statues, dino) last longer: the pawn flies, then holds at its destination while
  the camera catches up, before the next player's turn.
- Spaces implemented: +4/+5/+6, -4, blue/red statues, dinosaur, skull, volcano shout/exit, plus the above.
  Effects never chain, as on the wiki.
- Disconnect = Normal CPU takes the seat; rejoining puts the player back where the CPU left off (even
  mid-roll: the dice are already spinning when they return).
- Right-click doesn't open the browser menu; pointers report a buttons bitmask (1 left, 2 right, 4 middle).
- Lobby has a "Pointer test" button (the networking test screen).

## Not built yet (shown on the board but do nothing)

- The **minigame before every round**. For now the order is random and says so on screen.
  Ties/roll-offs and the round-end screen hang off this.
- Real minigames: the 1vRest and 1v1 spaces use a random placeholder result until they exist. The tornado and UFO use a stop-the-wheel spinner.
- Pause menu, NPC AI per minigame, profile pictures, music, other boards and game modes.

## Assumptions I made (change if wrong)

- Dino: 50/50 between pterodactyl (+10) and T-Rex (back 9 or 4).
- Leaving the volcano (Shout space, or running off the end) puts you on the island's Volcano space.
- Skull / volcano / statue throws are "fly" or "drop" animations; spaces reached by those never trigger.
- Final challenge: the arrival roll is one standard die (6 wins); later rounds use your whole roll, 6+ total.
- Vine swing's roll is *extra* spaces on top of the spaces you had left.
- Spike ball's difficulty is shared by everyone (it eases after any player's failure), per the wiki.
- Dice spin automatically on your turn (no separate "Roll" button first); change in `BoardGame._begin` if you want one.
- Mid-game, nobody new can join except a returning player reclaiming their seat.

## Layout of the code

- `src/game/boardData.js`: the spaces (edit here to change the board). `boardLayout.js`: 3D positions.
- `src/game/boardGame.js`: all board rules. The host resolves a turn into events; screens only play them back.
- `src/scenes/boardScene.js`: the 3D scene + HUD. Art is placeholder low-poly shapes made in code.
- `src/net.js` (PeerJS only), `src/session.js`, `src/game/hostGame.js`: networking and room state.
- Scenes never import each other; `src/main.js` registers them.

## Tests

    npm test

Host rules, board rules (wiki statue distances, every challenge, final-challenge flow, rank dice), 6 full simulated 6-player games, the real
network code over a fake PeerJS (including board turns), and the 3D scene run against a stand-in
for Three.js. **None of this can show how the 3D board looks.** Only a real browser can.

## Known limits

- Host's tab should stay in the foreground; if the host leaves, the room closes.
- If friends can't connect, add a TURN server in `src/config.js`.
- Remote pointers are a bit jittery for non-hosts (they're smoothed from 20 updates per second). Acceptable for now.

## Build 16
- Vine swing: a real tree and rope over a creek; the swing runs until the roll, then swings that many spaces, then walks the rest.
- Dragon wall: a real block wall. Fail = fireball knocks you back; 3+ = three hits and the wall breaks into pieces for everyone.
- Crates/barrels floating on a river; a wrong pick breaks a random one.
- Spiked wall and a real pit: fail and the wall pushes you in; succeed and you cross. Cameras hold during the crossing.
- First six spaces run straight out of the start before the spiral; start gate ahead of the players, who wait in one row.
- Rope bridge between spaces 15 and 16 with no spaces on it; round temple finish; walking limb animation; filled shoulders;
  shadow stays on the ground in the sky; camera cuts instead of spinning when moving backwards.

## Build 17 (fixes to 16)
- Wider creek for the vine swing (longer rope, higher limb); the pawn now really swings and flies across instead of snapping to the landing space.
- The dragon wall (and the spiked wall) go to pieces for real: blocks and head are blasted out, bounce on the ground and fade out slowly.
- The main river no longer reaches inland over the spaces near the temple.
- New crate model; the camera for the crates/barrels picks a bank and height with a clear view.
- Stony ground from the crates river to the last volcano space (the volcano-or-not challenge); paved tiles from there to the temple.


## Build 18: the real Board Game Island map
The hand-built island is gone. The game now runs on the converted Wii Party map in `assets/board-game-island/`
(island.glb, volcano.glb, sky.glb, props.glb, board.json), loaded with `loadBoardGameIsland()` from `wiiBoard.js`
(copied to `js15/world/wiiBoard.js`; `js15/world/islandLoader.js` wraps it).

- **three.js r160** (ES module, from jsDelivr) replaces r128. The page puts it on `window.THREE`.
- **Board**: index 0 is the start area, 1-72 are the map's 72 spaces (same numbers as the map), 73 is the summit.
  The volcano has its 8 spaces (101-108) between the landing spot and the way out; it lets you out at space 44, like the map.
- **Layout data** is generated: `python3 tools/gen_board_map.py` writes `js15/game/boardMap.js` (space positions,
  the waypoints between spaces, hooks, and a coarse height map for the camera) from board.json and island.glb.
- **Challenges** sit where the real path is interrupted: the vine over the gorge (after 6), the stone guardian (after 22),
  the waterfall pool with crates and barrels (after 39), the cave tunnel (after 45), the spiked boulder (after 56).
  They use the map's own props. The rope bridge is between 15 and 16; stairs are walked through the map's waypoints.
- **Single file**: `node tools/bundle.mjs` packs the models into `party-island.html` (about 7 MB), so it still runs from
  a double-click. It needs the internet for three.js and PeerJS. `index.html` (unbundled) needs a web server.
- **Play offline (CPU players)** on the Play screen starts a game without the network.
  In an offline game, while it is your roll: keys 1-6 put you right before the vine, guardian, pool, cave, boulder and
  summit, and 0 steps the camera through each of those places (for trying things out).
- Water: the converted water surface is a grey ripple texture the game tinted at run time; the loader tints it blue.

## Build 19
- Challenge spots are the map's small stars (the tile under each is hidden); stars added at the dragon wall and spike ball.
- The white path markers and the black slabs (unblended soft shadows) are gone.
- The rope bridge has its wooden planks, and players walk across them.
- No extra UFO/whirlwind models beside those spaces.
- Blue statues stand at both blue statue spaces, the red statue at the red one.
- The volcano-teleport tiles (spaces 27 and 66) show a skull; the map draws them as a separate mesh (space 121).
- The dragon wall is the map's dragon prop; the spike statue has its dragon head; the loose spike balls are hidden and the
  one floating by the statue is the one that rolls down and chases players.
- The sky is four times bigger, so the clouds no longer sit over the island; the overview camera flies lower.

## Build 20
- Back to 80 stops: all 72 of the map's tiles are spaces again, and each challenge is its own stop on the map's small
  star between two spaces (vine 7, dragon 24, crates 42, volcano-or-not 49, spike ball 61, final 78). Stars don't count
  as spaces. The space types are the 80-stop layout from build 15, which lines up with the map's statues and teleports.
- The volcano (eruption) space is back at stop 35; there is none before the 1v-Rest by the statues.
- Dragon wall: m001_35l at rest; m001_35 (fire in its mouth) only while it shoots.
- The red statue stands further back so its hands stop short of its space.
- The spike statue no longer wears the dragon head.
- The final challenge is faced from the star in front of the summit gate (m001_60, showing the 6 you need). When someone
  wins, the gate opens and the summit's light rays come on; until then the rays are off.
- The volcano's way-out glow only lights while a player leaves the volcano.
- Only the area the camera is in is drawn, so the volcano's inside no longer shows on the island's horizon.

## Build 21
- Spike ball statue: prop m001_62 stands over the map's number plate (the map only has the plate). Beating it breaks it for good.
- Statues: the big pair of hands lying in front is split off the model and hidden; when a statue throws a player it swings
  up under them.
- Water: the plain water surface is solid again (it was see-through, showing the sky under the map).
- Space tiles are nudged forward in depth so the ground underneath never pokes through.
- Volcano or not, failed: the stone block beside the star (map node m001_36) slides out and shoves the player into the pit;
  they then come falling down into the volcano. (Falling into the volcano from a skull space shows the fall too.)
- Pool: three crates and three barrels, all whole again for every player.
- Spike ball: after chasing players back it rolls on past them (they hop aside) and drops into the pit, then returns to its
  perch. A challenge ending no longer stops it half-way.

## Build 22
- Island viewer: "Island viewer" on the main menu (or open the page with #viewer). It is the game's own board scene with
  nobody playing: free camera (drag to turn, scroll to zoom, right/shift-drag to slide), buttons to jump to every place,
  and buttons that play each set piece (vine swing, dragon fireball and smash, statue throws, volcano push, spike ball
  chase and smash, summit opening). "Reset everything" puts it all back.
- Fixed: returning to the lobby and starting again made the sky grow and broke the spike ball (the board is attached again).

## Build 23
- Spike ball statue: its head is the mossy block inside prop m001_62 (that model's other parts are not used). It now sits
  on top of the map's statue body, facing the star. It goes when the statue is broken.

## Build 24
- Spike ball statue, done properly: the statue is part of the map itself (node m001_50). Its mossy monster head shares a
  mesh with the stone block it sits on, and the converted map had left the head at the island's centre, under the
  ground. The game now splits the head off and puts it back on its block (x -1400, z 0, 175 up), mouth toward the path.
  The spike ball sits inside its jaws, so only a few spikes show through the mouth; the chase rolls it out of the mouth.
  The number plate in front is the map's. Prop m001_62 is no longer used. The head goes when the statue is broken.
- Island viewer: new "Spike statue" close-up; a link ending in #spike-statue (or any place name) opens at that place.

## Build 25
- Leaving the volcano puts you back where you went in: on the skull space you landed on, or, if the stone block pushed
  you into the pit at the volcano-or-not star, on the space just past the pit. (The map's space 44 is only a fallback.)
- The way out of the volcano counts as one step, and the rest of the roll is walked on the island after you come out,
  stopping at challenges as usual and taking the effect of the space you end on. Coming out exactly gives no effect.
  A space effect that carries you out (the +4s inside) carries on the same way.
- "To go" counts and places use the spot you will come out at.

## Build 26
- New HUD in the Wii Party style:
  - Top left: "Left: NN" in the colour of the player the camera is on (spaces to the final challenge).
  - Top right: the turn order as coloured balls, sized to the number of players; the player who is moving shows
    their Mii face, the rest are their colour.
  - Bottom right: the course drawn as a pale line seen from above, starting at the bottom, with a ball per player.
    Players on the same spot share one ball whose colour takes turns. Players in the volcano stay on this map,
    faded, at the spot they will come back out at. While the camera is on someone in the volcano the map shows
    the volcano's path instead.
  - Bottom left: a pause button (or Esc). The menu shows the round, every player's spaces left and die, and
    Resume / Back to lobby / Leave game. Offline the game really stops; online it keeps going for everyone else.
  - The move counter sits at the top centre in big blue numbers (red when going back) and counts down each step.
  - The old player list and the round/leave bar are gone (they are in the pause menu now).

## Build 27
- The move counter is fixed at the top centre of the screen (not over the player) and counts down each step.
  Messages drop below it while it is showing.

## Build 28
- Vine swing redone. The player now stands on the vine star while the vine die rolls (no more hanging on the vine
  during the roll). Then, in one unbroken movement: run to the edge while the vine is drawn back, leap and catch it at
  the top of its swing, swing across like a pendulum, let go while still moving forward and fly through the air to
  land exactly the rolled number of spaces past the star; then walk the spaces that were left. Example: 3 left at
  the star, rolls 6 on the vine: flies 6 spaces, walks 3.
- The counter shows the vine roll plus what was left, ticks down through the flight, then through the walk.
- After the player lets go the vine keeps swinging by itself and slowly settles (no snapping back).
- The camera eases from the gorge view to the player during the flight instead of cutting.
- The Stop button and "Press Stop" message now disappear the moment the dice land.
- Island viewer: the vine demo shows a roll of 4 on the vine with 2 spaces left to walk.

## Build 29
- Back to swinging on the vine while the vine die rolls (the player leaps onto it as the challenge starts).
  When the roll lands, the same swing simply carries on (same rhythm, getting a little higher) until the next forward
  swing; the player lets go on the way up and flies the rolled spaces, then walks the rest. Nothing restarts, so the
  vine no longer jumps backwards first.

## Build 30
- The vine has its own counter: it starts at the vine roll and counts down through the flight. The player then
  stands on the landing spot for about a second, the spaces still left from the dice take the counter's place, and
  the player runs them.
- The "Left" banner counts down on every space the player reaches while moving, not only at the end of the turn.

## Build 31
- Volcano or not: the stone block now slides straight out of the rock face (along its own front face, worked out
  from the map's geometry) instead of diagonally, and shoves the player straight off the ledge into the pit in front.
- Volcano or not: while the die rolls and during the push, the camera stands well back facing the rock face, so the
  block, the number sign and the player in front of it are all in view (as in the Wii game). Once the player has
  dodged or fallen, the camera goes back to normal.

## Build 32
- Island viewer: fixed a start-up crash (the first frame could get a negative time step when the viewer opens
  straight away, which broke the path map's colour cycling and stopped the page). The map dots are guarded too.
- The spike statue's head (and the number plate) are put back whenever the map is attached, so smashing the statue
  in one game or in the viewer's demo no longer leaves it missing afterwards ("Reset everything" brings it back).
- Island viewer: the "Spike statue" close-up looks straight at the head's open mouth.
- Session test: the vine pause is shortened like the other durations (it made the timed test flaky).

## Build 33
- Spike ball chase redone, following the map's own spare copies of the ball (which mark where it goes in the Wii game):
  - The ball rattles in the statue's mouth, shoots out and bounces onto the ledge in front of the statue.
  - It then rolls down the whole stretch, along the path, without ever stopping, behind the player running back.
  - At the bottom the players duck into the tunnel mouth beside the last space; the ball rolls past them, straight
    on over the edge at the end of the ledge and falls away. The players then step back out onto the space.
  - Anyone else on the stretch hops aside as it passes. The ball goes back into the statue's mouth afterwards.

## Build 34
- Spike ball chase: the run back now ends with the player ducking into the tunnel mouth, before the ball arrives
  (the ball's speed is set so it reaches the bottom only after that). The ball rolls past and over the edge.
- The player stays in the tunnel mouth after the ball has gone, and is put back on their space only once the camera
  is on someone else, so you never see them walking back. Anyone already standing on that space ducks in as well.
- Session test: the eruption, minigame and flyover pauses are shortened too (they made the timed test fail now and then).

## Build 35
- Springs: a big spring pops out of the ground under the player, squashes, and bounces them the whole way in one
  jump, then sinks back into the ground. The counter counts down during the jump.
  - + spaces: a blue spring, forward that many spaces.
  - - spaces: a red spring, backward that many spaces.
  - 1v1: if the challenger wins, a green spring bounces them forward and another bounces the opponent backward.
    If the challenger loses (or it is a tie), nothing happens.
  - 1 vs Rest: if the challenger wins, a green spring bounces them forward; nobody else moves. Otherwise nothing.
  - Lava (the eruption's -4) is not a space effect and stays a run back.
- Island viewer: demos for the blue, red and green springs.

## Build 36
- UFO space, using the map's own UFO model (m001_82) and its striped tractor beam (m001_83):
  1. The player stops the UFO wheel; the UFO flies in over them, the beam comes on and they float up into it.
  2. The camera cuts to the player they swap with, and the UFO beams them up too.
  3. The camera cuts to the first player's spot, where the UFO drops the second player off.
  4. The camera cuts to the second player's old spot, where it drops the first player off.
- Island viewer: a "UFO space" place and a "UFO swap" demo; the viewer camera now follows whichever player a demo
  is showing (and cuts when the game cuts).

## Build 37
- Dice: each die now turns to look straight at the camera, so the face it lands on is seen square-on (no top or side
  faces showing). The tornado's red die shows pips (4, 5, 6, 4, 5, 6) instead of numbers.
- After the vine: the player no longer runs with their arms up (a leftover "in the air" state from the leap), and
  the leap itself is higher so it reads as a jump. The long wait after the run is gone: the game was timing the
  flown spaces as if they were walked, plus a gorge crossing.
- The player the camera is on always stands in the middle of their space; anyone sharing it steps aside.
- The camera stands much further back while a player rolls.

## Build 38
- Players walk down the middle of every space and stop in the middle (before, each player had their own spot on the
  side of every space, walked along that line, and then slid to the middle). Players only stand off-centre when
  they share a space, and then whoever the camera is on keeps the middle.

## Build 39
- Statue throws are their own, slower move (about 8 seconds):
  - Blue: the big hands lying in front of the statue wake up with a shiver, rise and come round palms up; the player
    hops on; the hands dip and fling them.
  - Red: the hands wake up, snap shut round the player, shake them and hurl them.
  - The player flies high over the island (about 25+ units up), spinning, slowly enough for the camera to follow,
    and lands on the statue's own platform (the blue / red patterned stone next to the landing space), then walks
    to its edge, steps down and walks onto the space.
- Island viewer: the blue and red statue demos use the real throw.

## Build 40
- Statue throws use the statues' own side hands; the big extra pair of hands lying in front of each statue is taken
  out of the model, so every statue has just the one pair.
  - Blue: the side hands wake up (a shiver), lift off and fly over in front of the player, side by side; the player
    hops up on top of them; they dip and fling the player up, then fly back to the statue's sides.
  - Red: the side hands wake up, fly at the player, clamp them between them, shake them and hurl them, then go back.

## Build 41
- Statue throws remade after the Wii game's (about 13 seconds), with their own cameras:
  1. A wide shot from the path: the player in front, the statue behind them. The statue's side hands wake up, fly
     up out of its sides tumbling, and come down at the player. Blue: they land flat, side by side, in front of the
     player, who steps up onto them. Red: they land either side of the player, clamp them, and lift them up high,
     shaking them.
  2. A cut to a low camera beside the statue as the hands fling the player up.
  3. A cut to a camera high over the island that turns to follow the player across the sky (a much higher arc).
  4. A cut to a camera over the statue's platform: the player lands with a thump, stands a moment, and walks off
     onto the space. The hands go back to the statue's sides.
- Island viewer: set pieces with their own cameras (the statue throws) use them.

## Build 42
- Player shadows lie on whatever is really under the player (a space tile, a slope, a step, a statue's platform,
  the cave floor) and tilt to match its slope: five short rays straight down find the surface. Before, the shadow
  was a flat disc at a fixed height under the feet, so it sank into raised tiles and slopes. It also no longer leans
  with the player, and in the air it falls on the real ground below.

## Build 43
- Smashing the dragon wall (and the spike statue) now plays the real animation in the game, the same as the
  island viewer's demo: the player runs up, hits it three times while it shakes, and it bursts into chips and
  sinks away. The game's "broken" message did not say who broke it, so the scene had no player to animate and
  only waited, then hid the wall.

## Build 59

- Spike statue: it opens its jaws to spit the spike ball and shuts them once the ball has gone, with the game's own jaw
  skeleton and animation (`m001_50_1.branm`, read by `tools/extract_spike_head.py` into `js15/world/spikeHeadData.js`,
  posed by `js15/world/spikeHead.js`). The head now sits exactly where the game's animation puts it (x -1375).
- Map extractors: a vertex drawn with a single bone's own matrix is stored in that bone's space (the statue's upper jaw).
- The spike ball rolls the way it is going all the way down (it turns about the level axis across its path), and it stays
  right behind the hindmost player running from it, then rolls on at full speed once they are out of its way.
- Everyone on the stretch below the statue runs from the ball at the same time (move events marked `with: true` play
  alongside the one before them), and each gets their own spot in the tunnel mouth.
- After a failed roll, the camera pans to the number beside the statue and it fades into the next one down. It now goes
  down to 1 (the map has panels for 5 to 2; the 1 is painted from the 2's picture).
- Viewer: "Second player on the spike stretch" toggle; the spike demo uses the game's camera and shows the number going down.

## Build 58

- Fix: the stray spike balls are gone again (one floating over the pit, one on the path in front of the spike statue).
  Build 57's dragon change dropped the line in `ChallengeFX.attach()` that sets up the spike ball (`mapBall`), which also
  hides the loose copies of the ball the converted map leaves along its old course. New tests in `challengeFx.test.js`
  and the board scene smoke test catch it if it goes missing again.

## Build 57

- Dragon wall: the wall no longer tips. Only the dragon moves, with the game's own skeleton and its own shooting animation
  (`m001_35_4.branm`, read by `tools/extract_dragon.py` into `js15/world/dragonData.js`): the head rears back, the jaws open,
  the fireball in its mouth rises, and it is spat at the player. `js15/world/dragon.js` fits the skeleton onto the map's own
  dragon mesh by vertex position (the map's textures stay) and poses it on the CPU. The resting model keeps showing the wall.
- Viewer: a "Slow motion" toggle under Play (the camera stays where you put it while it is on).
- Tests: `tests/dragon.test.js`.

## Build 56

- Dragon wall: the dragon now spits the fireball that sits in its own mouth (`mr001m011_3` inside `m001_35`) instead of spawning a new orange ball. The ball flies to the player, bursts, and goes back in the mouth.
- The player is knocked back in one arc onto the previous space (`mode: 'knock'`, `DUR.knock`), with no extra hops or walking.

## Build 55

- The birds over the island fly. The converted map had all 30 frozen in mid-air; now they fly the game's own animation,
  `files/mr001/map/motion/m001_08.branm.lz` (6000 frames, looping every 100 seconds, about 400,000 keys).
  - Each bird is two flat wing cards on their own bones (`wing_l_N`, `wing_r_N`) that share a position; birds come in four
    sizes (0.6, 0.85, 1 and 1.2), as in the game.
  - `tools/extract_birds.py` samples the animation 30 times a second (every bird's position, every wing's rotation as a
    quaternion), packs it as gzipped 16-bit deltas and writes `js15/world/birdsData.js` (about 760 KB).
  - `js15/world/birds.js` unpacks it in the browser and plays it on two instanced meshes (left wings, right wings).
    Until it is unpacked, or if it cannot be, the frozen birds stay where they are.
- Tests: `tests/birds.test.js`. Frame 0 matches the map's frozen birds to within 3 map units, and the birds really fly
  (no jumps, wings flap, the loop joins up).

## Build 54

- The long-necked dinosaur is back in the pool by the rope bridge, with its ring of ripples moving with it.
  - The model is the game's own: it is not in the converted map but in the disc's NPC file
    `files/mr001/npc/mr001_03.brres.lz` ("watasy"). `tools/extract_watasy.py` reads it (LZ, BRRES, MDL0, TEX0 readers in
    `tools/wii/`) and writes `js15/world/watasyModel.js`: 346 vertices, 550 triangles and its 128x128 body texture.
  - The motion is the map's own animation, `files/mr001/map/motion/m001_09.branm`, read key by key. It is exact simple
    curves: a circle of radius 550 map units round the pool, one lap every 2000 frames (33 s at 60 frames a second),
    always facing along the circle, bobbing 50 units down and up every 100 frames. `js15/world/watasy.js` plays it.
  - The ripple ring (m001_09, already in the map, frozen where the lap starts) now rides along with it.
  - The game draws it rigid too: its own animation file targets neck bones this model does not have.
  - It is lit by the scene's lights like the players. It stops while an offline game is paused.
- Tests: `tests/watasy.test.js` (the model data, the path, and that the ring in the map sits where the path starts).

## Build 53

- Even faster, even longer strides: 185 ms a space when walking (was 250), 140 ms when hurrying (was 170), one full
  stride every ~5.7 units (was 4.3), with a wider leg and arm swing and more spring.

## Build 52

- Players walk faster and take longer strides: a space now takes 250 ms when walking (was 340) and 170 ms when hurrying
  (was 190). One full stride covers about 4.3 units (was 3), with a bigger leg and arm swing and a little more spring.

## Build 51

- The start menu has a small "← dominodominick.com" button in the top left, back to the main website.

## Build 50

- The water moves, and the black specks are gone. On the Wii the water surface's texture is not a picture of water: it
  holds two grey ripple patterns that the console used to bend other textures, and the blue came from the material. The
  game here drew that texture as it was, tinted blue, so the river, pools, falls and sea were speckled with black.
  - `js15/world/water.js` turns the ripple pattern into a blue water texture (two blues sampled from the real game, nothing
    dark), once for the river and once, half see-through, for the sea round the island.
  - Every water layer now slides: the surface, the light wavy lines, the net of light on the pools and the shore foam. The
    map's UVs run along the flow, so the water runs down the waterfalls (about 410 map units a second for the surface and
    590 for the wave lines) and along the river. The sea drifts slowly. Speeds are in `WATER_FLOW`.
  - The map loader sets it up and gives the map a `tick(dt)`; the board scene and the viewer call it every frame (not
    while an offline game is paused). If the texture cannot be made, the old tinted look is kept and still slides.
- Fixed the floor panel under the star at the summit. Like the crates, its texture is a quarter of the carving, meant to be
  mirrored about the star, and the converted map had lost the matrix (`uv' = (2u - 1, 2v)`), so one corner of the carving
  was stretched over the whole panel. `tools/fix_map_uvs.py` (the crate tool, renamed, now with this rule) bakes it in.
- Tests: `tests/water.test.js` (colours, sliding, and that both moving layers really run DOWN the falls, worked out from
  the map), the panel in `tests/world.test.js`, the scene ticking the map in the smoke test, and the water texture made in
  a real browser canvas from the map's real ripple texture in `tests/hud.browser.test.mjs`.

## Build 49

- Fixed the crate and barrel textures. Their texture is one quarter of a crate face / barrel pattern, meant to be mirrored
  four ways, but the converted map files had lost the texture matrix that does that (double the UVs, shift by one). So each
  face showed the quarter once, stretched: frame and metal corner on one side only, no hoops on the barrels, and the chains
  and their plates in wood colours. `tools/fix_map_uvs.py` (called `fix_crate_uvs.py` in build 49) bakes the matrix into the stored UVs of `props.glb` (crates
  m001_26/27, barrels m001_28/29) and `island.glb` (the chain anchors by the pool). Now crates have frame bars and metal
  corners all round, barrels have metal hoops and rims, and chains and plates are grey metal.
- The tool edits the numbers in place and is safe to run twice. `tests/world.test.js` checks the result.

## Build 48

- The 1v1 card screen now shows the custom pointer (the coloured arrow with your number and name from the
  pointer test) to everyone, the chooser included. Before, the chooser's own screen drew no pointer at all.
  While you pick, it replaces the mouse cursor and starts where your mouse already is; pressing shows the ring.
- The card under the pointer lifts on every screen, the chooser's too.
- A CPU picking a 1v1 opponent now takes about 2.4 seconds (was 1): its pointer looks at one card, moves to
  the card it picks, shows the click ring, and that card is the opponent it challenges. Before, the pointer
  wandered for a second and the pick had nothing to do with where it was.

- New real-browser test, `tests/hud.browser.test.mjs` (`npm run test:browser`, also the last step of `npm test`): it opens the
  real page in headless Chromium with Three.js and the map replaced by stand-ins, and checks what the node tests cannot see:
  that the Stop button, pause button and 1v1 cards really receive mouse clicks, that your own pointer is drawn under your mouse
  on the 1v1 screen (in a scaled, letterboxed window too) and the mouse cursor is hidden there, and that a CPU's pointer ends on
  the card it picks. It saves screenshots to `tests/shots/`. It needs Playwright with Chromium and is skipped when that is missing.
- `main.js` has a small hook for that test (`window.__PARTY_TEST`); nothing sets it in a real game.

## Build 47

- Fix: mouse clicks were blocked during play by the invisible 1v1 cursor layer (added in build 44). The
  catch-all `#ui > * { pointer-events: auto }` rule outranked the layer's `pointer-events: none`, so the
  layer covered the screen and ate clicks on Stop, the UFO/tornado wheel's Stop, the 1v1 cards and the
  pause button (the Space key still worked, which hid it on normal rolls). The catch-all now has no
  specificity (`:where(...)`), so any overlay marked `pointer-events: none` lets clicks through.
- The dev tools panel now stays above the black fade between turns.

## Build 46

- Dev tools fix: the space and challenge buttons were greyed out unless the panel was opened while your
  dice were already spinning, and the panel never updated, so it looked frozen. Now every button can
  always be clicked. While your dice spin, you jump right away; otherwise the panel says it is waiting and
  you jump the moment your dice start spinning on your turn (the chosen button is outlined, with a Cancel).
- New end-to-end test: jumps onto every kind of space and challenge, then plays on to the next turn.

## Build 45

- Dev tools are simpler: press a button while your dice are spinning on your turn and the dice go
  away, you land right on that spot, and the spot does what it normally does (a + space springs you,
  a challenge star starts its challenge, a 1 vs 1 space starts the duel...). The panel closes after a jump.
- Spaces jump to the next one of that kind ahead of you. "Set the next roll" still works as before.

## Build 44
- 1v1 opponent cards: everyone sees the cards now, not only the player choosing. Everyone else sees the chooser's
  pointer (the custom one from the pointer test, in their colour, with their number and name) moving over the
  cards, and the card it is over lifts up. The chooser uses their normal mouse pointer and does not see their own
  custom one. A CPU choosing moves its pointer from card to card before it picks. The cards sit at the same place
  on every screen (js15/game/duelLayout.js), so the pointer is over the same card for everyone.
- Dev tools (offline games only): press ` (or F2), or "Dev tools" in the pause menu.
  - Next roll: set the next die to 1-12 (or random).
  - Land on a space: puts you one space before the next + / - / UFO / tornado / skull / volcano / 1 vs 1 /
    1 vs Rest / blue statue / red statue / dino space and sets your roll to 1.
  - Before a challenge: vine, dragon wall, crates, volcano or not, spike ball, summit.
  - Into the volcano (you come back out where you were), back to the start.
  Placing works during your own roll (dice spinning); then press Stop.
