# Edgerunner map and gameplay handoff

Prepared 25 November 2026 for the group from local branch `feature/race-continuation`. Based on `main` commit `3666871` (merged race engine and matchmaking). This note accompanies the map, art and gameplay upload.

## Upload list

Use the files in the `Comp4021` checkout. Paths below are relative to the GitHub repository root. Preserve the directory structure: upload the contents of this checkout into the repository, rather than adding a nested `Comp4021/` folder. The complete change set contains **23 files: 7 replacements and 16 new files**, including this note.

| Path | Action | Purpose |
| --- | --- | --- |
| `README.md` | Replace | Run instructions, new course timings and integration links |
| `package.json` | Replace | Adds `preview` and `build:course` scripts; dependencies unchanged |
| `server.js` | Replace | Serves the browser engine for the local playtest |
| `race/index.js` | Replace | Basic firing/reload, flight altitude, launch and orbital shield behavior |
| `race/room-match.js` | Replace | Makes the full course the default for server room matches |
| `race/room-match.test.js` | Replace | Full-course adapter and gun/reconnect checks |
| `docs/protocol.md` | Replace | Updated actions, events and snapshot fields |
| `race/full-course.json` | Add | Generated three-stage course, branches and object placements |
| `race/full-course.test.js` | Add | All route combinations, stage timings, combat and flight tests |
| `scripts/build-course.js` | Add | Editable source for the course layout |
| `lib/raceClient.js` | Add | Exposes the same engine and course to the playtest browser |
| `preview/server.js` | Add | Standalone local playtest server |
| `public/playtest.html` | Add | Playtest page, stage selector and art gallery |
| `public/playtest.css` | Add | Responsive playtest styling |
| `public/playtest.js` | Add | Local race, scripted rival, Canvas rendering, controls and results |
| `public/assets/slums.png` | Add | Slums environment art |
| `public/assets/downtown.png` | Add | Downtown environment art |
| `public/assets/spaceport.png` | Add | Hangar and orbital environment art |
| `public/assets/racers.png` | Add | Transparent cyan/magenta runner and shuttle atlas |
| `public/assets/character-design.png` | Add | Runner and spaceship model reference |
| `docs/maps-and-art.md` | Add | Route layouts, rules, asset specifications and integration details |
| `docs/art-prompts.json` | Add | Exact prompts used with the built-in image generator |
| `docs/handoff.md` | Add | This upload list and team handoff |

The existing `package-lock.json`, `.gitignore`, account routes, lobby modules, `race/race.test.js` and `race/prototype-track.json` stay in the repository. They have no changes to upload for this pass. The original prototype JSON is still required by the direct engine default and browser bundle.

Exclude `node_modules/`, `.env`, generated account data (`data/accounts.json` and its temporary file), logs and `.git/`. The sibling `edgerunner/`, `GameRoom/`, `poker_game/` and concept-art folders outside this checkout are older local material and are not part of this upload.

Merge these files together. In particular, the updated room adapter requires `race/full-course.json`, and the updated server requires `lib/raceClient.js`. If teammates have newer edits to shared files, reconcile those edits before replacing their versions. A pull request from the feature branch keeps this change set reviewable before it reaches `main`.

## Team handoff note

The map and basic gameplay pass is ready for integration. The race now runs through the Slums, Downtown, and the Spaceport into orbit, with branch choices, shared coins and breakable terrain. Each player changes stage and launches independently. Ground branches have three lanes; main ground routes and flight routes have four lanes, with three altitude levels in flight.

The main route takes about **2:27 before collisions**: Slums 44 seconds, Downtown 48 seconds, Spaceport/orbit 55 seconds. Route choices range from **2:21 to 2:33**. The match clock retains its **180-second hard cap**, and the first finish starts the existing fifteen-second window for the rival. The longest clean route leaves 27 seconds for that window and collision delays. Twenty shared coins remain distributed across all branches.

Players have the basic gun and shield. The gun holds three rounds and reloads one round per second. Shots clear crates, glass and orbital debris, and solid obstacles block them. Basic shots do not damage the rival. The ground shield has three gauges; launch gives the shuttle 100 shield HP. A broken orbital shield stops the ship for 2.5 seconds, restores it to 100 HP, then grants one second of immunity. Gadgets remain deferred.

The five art assets cover all three environments and both player identities. Cyan uses parallel stripes and a swept silhouette; Magenta uses a diagonal stripe and a broader silhouette. The transparent atlas is a 2×2 sheet in reading order: cyan runner, magenta runner, cyan shuttle, magenta shuttle. Use nearest-neighbor sampling. It currently supplies one pose per entity, with motion bobbing in the preview; the model board's alternate views are reference art rather than animation frames.

### Run and edit

From the repository root:

```sh
npm run preview
```

Open `http://127.0.0.1:8010`. The preview uses the real race engine with a scripted rival. The stage selector allows individual maps to be tested. Controls are A/D or Left/Right to steer, W/S or Up/Down for orbital altitude, click or Space to fire, and C for the practice cheat. Restart begins a fresh race.

For the existing account/room server, run `npm ci`, then `npm start`, and open `http://localhost:8000`. The same preview is also available there at `/playtest.html`. The account and lobby pages remain placeholders; the local preview does not connect to Socket.IO or prove an end-to-end two-browser match.

Edit `scripts/build-course.js`, then run `npm run build:course` to regenerate `race/full-course.json`. Keep both files together in future changes. Room matches default to the full course. Direct `createRace()` calls still default to the short prototype unless a track is supplied.

### Canvas and network integration

Keep the existing `race:input` envelope, `{ matchId, action }`. New actions are `fire`, `up`, and `down`, alongside `left`, `right`, and practice-only `toggleCheat`. Identity comes from the authenticated socket.

Listen for `race:bootstrap` (`{ matchId, track, snapshot }`) and `race:update` (`{ matchId, snapshot }`). In the current lobby bridge, the initial bootstrap is emitted before `race:start`, so initialize from bootstrap without assuming start arrives first. Ignore messages for an obsolete match ID.

Read the local player by authenticated username in `players[].id`. The preview's hardcoded `cyan` and `magenta` IDs are for its local match; assign multiplayer art by player seat. Use each player's `segmentId`, `lane`, `distance`, `mode` and `altitude` to render their own view. Compare separate branches using normalized `progress`, ending at `track.finishProgress` (735 for this course).

Added player fields are `mode`, `altitude`, `maxShield`, `ammo`, `maxAmmo`, and `ammoRefillMs`. Ground altitude is 0; flight starts at 1. Render active shots from `snapshot.projectiles`. New transient events are `shotFired`, `shotHit`, `stageChanged`, and `launched`. Shared destroyed/collected objects are in `removedObjectIds`. Reconnect bootstrap restores current state without replaying past tick events.

Use `snapshot.results` when `status` is `ended`; standings already include ranks, points, finish times, stuns and cheat usage. The engine owns movement, collision, ammo, shields and scoring. The lobby owns the fixed 50 ms scheduler, room lifecycle and future rematch agreement.

### Validation and remaining work

All **21 Node tests pass**. Checks cover every one of the twelve branch combinations, per-stage travel times, coin counts, gun/reload behavior, orbital controls/recovery, session guards and reconnecting with active shots. A separate simulation of all twelve routes with collisions and no firing finished between 141.5 and 154 seconds. Course generation reproduces the saved JSON. Browser checks covered controls, loaded art, responsive layout, results and restart. A main-server smoke check verified the preview, browser engine, five assets and session endpoint.

Remaining integration work:

- Connect the teammate's multiplayer Canvas and results pages to these snapshots and inputs. Complete the home and lobby UI.
- Finish the lobby lifecycle: detach a race socket when its account explicitly leaves, restore final results on finished-room reconnect, and define two-player rematch consent.
- Enforce the wall-clock budget during server stalls if required: the existing bridge advances one 50 ms step per interval callback, so its 180-second match-clock cap can take longer in real time under sustained event-loop lag. The standalone preview also slows when a browser tab is throttled.
- Add full sprite animation and stage audio in a later polish pass. Current environmental key art and single-pose atlas are ready to use.

Full layouts and exact rules: [maps and art](maps-and-art.md). Network contract: [protocol](protocol.md).
