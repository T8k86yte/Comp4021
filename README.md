# Edgerunner

## Quick start

Requires Node.js 18 or later. From this folder:

```sh
npm install
node server.js
```

Open http://localhost:8000. Use separate browser sessions for the two accounts. The server creates its local account store on first start. Keep `.env`, `data/accounts.json` and `node_modules/` out of Git; `.env.example` and `.gitignore` are included. Run `npm test` to verify the game.

The latest map build adds a continuous Slums → Downtown → Spaceport/orbit course, basic guns and shields, and cyan/magenta runner and shuttle art.

The main route takes 73.5 seconds before collisions at 10 cells per second. It now has 56 obstacles (down from 129), with encounters at least 16 cells / 1.6 seconds apart. Ground encounters leave two adjacent lanes open; orbital encounters leave a whole altitude clear. Each encounter has at most one unbreakable obstacle, including the three separate atmospheric crossings. All twenty coins retain their positions. Every round retains the three-minute simulation limit.

Obstacles are drawn up to 45 cells ahead across continuous road sections, so crossing a section boundary does not suddenly reveal an encounter. Area gates still hide the next district during their transition. The first Downtown and Spaceport hazards are now 20 cells after entry, leaving 1.64 seconds at normal speed (1.09 seconds with Space acceleration) once the arrival fade clears. Start a new room to use these updated encounter positions; existing matches keep their original map.

Orbital LOW/MID/HIGH levels have separate colored guides and obstacle labels. Rivals fade out at a 12-cell gap in either direction; a nearby rival behind the camera has a rear indicator. Ground runners aim their pistols forward.

The ground race moves through a city built in perspective: textured shopfronts, sidewalks, side streets, lamps and overhead structures pass beside the players. The Slums has worn brown roads and rusty buildings; Downtown has white pavement, clean glass facades and planted sidewalks. Low kerbs join the lanes to the surrounding ground. The spaceport is a clean, enclosed spacecraft hangar with white bulkheads and ceiling lights.

Animated gates open between areas, followed by a brief blackout and reveal. Each player transitions independently, preserving the race gap. At the Crystal Palace, the final hangar opens and the shuttle flies away into the bay before results appear. These presentation effects do not pause the simulation or change finish times.

## Play the map preview

Run `npm run preview` from this repository, then open [localhost:8010](http://127.0.0.1:8010). This local playtest runs against a scripted rival and includes a selector for each stage plus an art gallery. It uses Node.js built-ins and needs no dependency installation.

Flight now has two equal halves: four-lane atmospheric ascent, then the original three-altitude orbital finish. The LOW/HIGH guides unfold around MID before orbital entry, where W/S unlocks independently for each player.

Preview controls: A/D steer, W/S changes orbital altitude, F or click fires. L enables immunity for the rest of the race; hold Space for 1.5× speed, release for normal speed. C retains the older practice-only 2× cheat until L is enabled. Run `npm test` for engine and adapter tests.

[Full map and art design](docs/maps-and-art.md) covers the routes, encounters, gun/shield rules and asset handoff. Edit `scripts/build-course.js` and run `npm run build:course` to regenerate the map. Art lives in `public/assets/`.

## Run the multiplayer server

Run `npm ci`, then `npm start`, and open [localhost:8000](http://localhost:8000). The account seed provides `player1` / `player1pass` and `player2` / `player2pass`. Use separate browser sessions, create/join a room, and ready both players. The multiplayer screen and solo preview share the full-course renderer, including Downtown scenery, shuttle sprites, orbital altitude, projectiles, ammunition and shield HUDs. The room owner uses WASD and F to fire; the guest uses arrow keys and Enter to fire. L and Space always affect the account signed into the focused window. The room adapter uses `race/full-course.json`; the short map remains available as `race/prototype-track.json` for regression checks. [Account and room protocol](docs/protocol.md)

## Manual testing on one device

Use two separate browser sessions (for example Chrome and Edge, or a normal and a private window). Check **Same-device manual test** before creating the room; join with the other account and ready both players. Keep both game windows open and connected. Either focused game window sends WASD/F to the room owner and arrows/Enter to the guest, without sharing or combining their views. Normal rooms restrict each window to its own player.

Press L in a player’s window to enable immunity and clear existing stun/slow effects. Hold Space in that window for exactly 1.5× normal speed (15 cells/second); releasing it or losing focus restores 10 cells/second. Immunity persists until the next race and is marked in results. Disconnects clear held acceleration. L is available in ordinary and practice rooms and supersedes the older C cheat.

## Engine handoff

The engine keeps one state per match. Room matches default to the full course; direct `createRace()` calls retain the prototype unless a track is supplied. Use the existing `race:input`, `race:bootstrap`, and `race:update` events. New `fire`, `up`, and `down` actions and snapshot fields are documented in [the map handoff](docs/maps-and-art.md#playtest-and-integration).

The client selects its player by authenticated username. Render the local segment and mode independently, compare rivals through normalized progress, and restore coins, removed terrain and active shots from reconnect snapshots. The server owns collision, ammunition, shields and scoring.

## Included sound effects

Multiplayer and the solo preview use the same effects, with no background music. Each window plays only its own runner's confirmed gameplay events. Audio starts after a gameplay key press or click; the preview's Start race button also enables it.

- `coin.wav`: the original pickup chime.
- `impact.wav`: an electrical crack and crystalline shield shatter when an obstacle hits your shield.
- `laser.wav`: a punchy, pitch-dropping sci-fi blaster for each shot actually fired; empty-ammo or rejected inputs stay silent.
- `wood-break.wav`: dry cracks and splinters when your shot destroys an object in the Slums.
- `glass-break.wav`: a sharp pane fracture and light tinkling shards for Downtown glass panels.
- `cargo-break.wav`: a heavy hollow buckle, metal tear and panel rattle for Spaceport containers.
- `debris-break.wav`: short brittle cracks and small scrap fragments for orbital debris.
- `satellite-break.wav`: a larger hull rupture, electronic power-down and ringing parts for derelict satellites.
- `metal-break.wav`: a generic fallback for breakables in older/custom courses without material or stage metadata.

Destruction sounds follow the target object's material, including shots that cross a stage boundary. Hitting an unbreakable wall does not play a destruction effect. Colliding with a breakable object plays the shield effect once.

These are original synthesized effects, with no external samples. Rebuild the files in `public/sounds/` with `node scripts/build-sounds.js`.
