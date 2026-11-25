# Edgerunner

The latest map build adds a continuous Slums → Downtown → Spaceport/orbit course, basic guns and shields, and cyan/magenta runner and shuttle art.

The main route takes about 2:27 before collisions: 44 seconds in the Slums, 48 seconds Downtown, and 55 seconds through the Spaceport and orbit. Route choices range from 2:21 to 2:33. Every round retains the three-minute hard limit.

## Play the map preview

Run `npm run preview` from this repository, then open [localhost:8010](http://127.0.0.1:8010). This local playtest runs against a scripted rival and includes a selector for each stage plus an art gallery. It uses Node.js built-ins and needs no dependency installation.

Controls: A/D or Left/Right to steer, W/S or Up/Down for orbital altitude, click or Space to fire, C for the practice cheat. Run `npm test` for engine and adapter tests.

[Full map and art design](docs/maps-and-art.md) covers the routes, encounters, gun/shield rules and asset handoff. Edit `scripts/build-course.js` and run `npm run build:course` to regenerate the map. Art lives in `public/assets/`.

## Run the multiplayer server

Run `npm ci`, then `npm start`, and open [localhost:8000](http://localhost:8000). The account seed provides `player1` / `player1pass` and `player2` / `player2pass`. Existing home and lobby pages are placeholders. The room adapter uses `race/full-course.json`; the short map remains available as `race/prototype-track.json` for regression checks. [Account and room protocol](docs/protocol.md)

## Engine handoff

The engine keeps one state per match. Room matches default to the full course; direct `createRace()` calls retain the prototype unless a track is supplied. Use the existing `race:input`, `race:bootstrap`, and `race:update` events. New `fire`, `up`, and `down` actions and snapshot fields are documented in [the map handoff](docs/maps-and-art.md#playtest-and-integration).

The client selects its player by authenticated username. Render the local segment and mode independently, compare rivals through normalized progress, and restore coins, removed terrain and active shots from reconnect snapshots. The server owns collision, ammunition, shields and scoring.
