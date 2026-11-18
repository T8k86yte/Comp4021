# Comp4021
HTML Multiplayer Platform Game
Title: Edgerunner: Race to the Crystal Palace  

Home Page: The home page introduces the game and its controls. Players can register or sign in, create a room or join one with a room code, and ready up in the lobby. The race begins after both players are ready.  

Gameplay: Two players race through a cyberpunk course from the Slums through Downtown and the Spaceport toward the Crystal Palace. Players move between lanes and routes, collect coins, avoid or fight hazards, and use gadgets. The game runs in a browser and uses a Node.js server with WebSocket communication to synchronize the match between players.  

Controls: A/D or the left/right arrow keys change lanes. W/S or the up/down arrow keys change altitude during the orbital section. Left click fires; E activates a gadget; Q discards a module.  

Scoring and Results: The first player to reach the Crystal Palace wins. If neither player finishes before the three-minute time limit, the player with greater course progress wins; if progress is tied, the score decides the winner. The end page shows each player’s rank, finish time or Did Not Finish status, collected items, score breakdown, stuns, and gadgets used. Players can request a rematch or return to the signed-in lobby.  

Cheat Mode: During the race, either player can press C to toggle the cheat on or off. When active, it increases forward speed and grants immunity to hits, gadgets, and debris. The HUD indicates its status, and the results show who used it. Cheats reset to off at the start of every race.

## Requirements

Node.js 18 or later with npm.

## Installation

```
npm install
```

A single `npm install` installs every dependency listed in `package.json`.

## Running

```
node server.js
```

Then open `http://localhost:8000` in a browser.

The server reads `PORT` and `SESSION_SECRET` from a file named `.env` in the project root. Copy `.env.example` to `.env` and set a secret before running. When `.env` is absent, a development default is used, which is not suitable for anything other than running the game locally.

## Test accounts

Two demonstration accounts are created from the seed data in `data/accounts.json`:

| Username | Password |
| --- | --- |
| `player1` | `player1pass` |
| `player2` | `player2pass` |

One account holds a single session at a time, so a two-player match needs both accounts, opened in two separate browsers.

The seeding script and the sign-in feature arrive with the account module. Until then the accounts above do not exist yet; see Known issues.

## Project structure

```
server.js   entry point: Express, session handling, Socket.IO
public/     pages and client scripts served to the browser
data/       local development data, such as the account store
docs/       meeting minutes and design notes
```

## Known issues

- This revision contains the server skeleton only. Registration, sign-in, rooms, the race and the results page are not implemented yet.
- Practice Room is not part of this release.
- Match history is not part of this release.
- Reconnection relies on the default behaviour of the Socket.IO client; a player who is disconnected keeps the seat and is frozen until the client reconnects.
