# Protocol

Last updated: 2026-11-26

This document is the contract between the browser pages and the Node.js server. It covers the HTTP endpoints used for account handling, the Socket.IO events used by the lobby, and the hand-over to the race engine. Code that follows a different shape is out of date with this document.

Status: accounts (UC-01 to UC-03), the lobby (UC-04 to UC-06), and the authoritative race engine are implemented. Room matches use the full Slums, Downtown and Spaceport/orbit course. See [maps and art](maps-and-art.md) for gameplay and Canvas fields.

## 1. Conventions

- HTTP endpoints live under `/api`. Pages are files served from `public/`.
- Request bodies are JSON with `Content-Type: application/json`. Form-encoded bodies are accepted as well.
- Every response is JSON, including failures raised by the server itself.
- A successful response is `{"ok": true, ...}`.
- A rejected request is `{"ok": false, "errors": [...]}`.
- Each entry in `errors` is `{"field": ..., "code": ..., "message": ...}`:
  - `field` is the form field to highlight: `username`, `password`, `confirmPassword`, or `null` when the failure is not tied to one field.
  - `code` is stable and meant for branching in code.
  - `message` is English text that can be shown to the player as is.
- A successful account response carries `redirect`, the page to open next.
- A request may report more than one error at once, for example one per empty field. The page shows every entry rather than only the first.

## 2. Sessions

- The session identifier travels in the cookie `connect.sid`. It is `HttpOnly` and `SameSite=Lax`, and it expires after seven days. The cookie carries the identifier only; the state stays on the server.
- One account holds one session at a time. Signing in replaces the identifier recorded for the account, and the earlier session stops working at its next request.
- Signing in also releases the seat the account held. The earlier client is removed from its room, the remaining member is told, and its sockets are closed. One account therefore never occupies two seats.
- A session that has been replaced is answered with HTTP 401 and the error code `session_terminated`. The cookie is cleared at the same time. The page should send the player back to the home page.
- The session secret is read from `SESSION_SECRET` in `.env`. A development default is used when the file is absent.

## 3. POST /api/register

Creates an account and signs it in. UC-01.

Request body:

| Field | Type | Rule |
| --- | --- | --- |
| `username` | string | 3 to 16 characters, letters, digits and underscores only, not already taken |
| `password` | string | at least 8 characters, contains at least one letter and one digit |
| `confirmPassword` | string | identical to `password` |

Responses:

| Status | Body | When |
| --- | --- | --- |
| 201 | `{"ok": true, "account": {"username": "..."}, "redirect": "/lobby.html"}` | the account was created and signed in |
| 400 | `{"ok": false, "errors": [...]}` | the input was rejected |
| 409 | `{"ok": false, "errors": [{"field": null, "code": "already_signed_in", ...}]}` | the browser already holds a valid session |

Usernames are compared without regard to case, so `Player1` and `player1` are the same account. The spelling used at registration is kept for display.

Error codes:

| Code | `field` | Meaning |
| --- | --- | --- |
| `missing_username` | `username` | the username is empty |
| `missing_password` | `password` | the password is empty |
| `missing_confirm_password` | `confirmPassword` | the confirmation is empty |
| `invalid_username` | `username` | length or character rule broken |
| `username_taken` | `username` | the name belongs to an existing account |
| `weak_password` | `password` | length or composition rule broken |
| `password_mismatch` | `confirmPassword` | the two passwords differ |

A rejected request never changes the account store.

## 4. POST /api/login

Signs an existing account in. UC-02.

Request body:

| Field | Type | Rule |
| --- | --- | --- |
| `username` | string | the account name |
| `password` | string | the account password |

Responses:

| Status | Body | When |
| --- | --- | --- |
| 200 | `{"ok": true, "account": {"username": "..."}, "redirect": "/lobby.html"}` | the credentials matched |
| 200 | same body plus `"alreadySignedIn": true` | a valid session already existed, so the form was skipped (UC-02 A3) |
| 400 | `{"ok": false, "errors": [...]}` | the input was rejected |

Error codes:

| Code | `field` | Meaning |
| --- | --- | --- |
| `missing_username` | `username` | the username is empty |
| `missing_password` | `password` | the password is empty |
| `invalid_credentials` | `null` | the account does not exist or the password is wrong; both cases give this one message |

Signing in ends any session the account held elsewhere and releases the seat that client held; see section 2.

## 5. POST /api/logout

Ends the current session. UC-03. No request body.

Response, HTTP 200:

```json
{ "ok": true, "signedIn": false, "redirect": "/" }
```

The session is destroyed, the account forgets its recorded session identifier, the cookie is cleared and every socket of the account is closed. Calling it without a session is harmless and answers the same way. The only exception is a session that was replaced elsewhere: that request is answered with 401 `session_terminated` (section 2) and the session is already gone.

Signing out also removes the player from the room it sat in, before the sockets are closed, and the remaining member receives a new `room:state` without that account. When the account was the last member the room is destroyed and its code released. The same happens when the account is signed in somewhere else (section 2). Such a player is not first marked `connected: false`: the seat is gone.

## 6. GET /api/session

Tells the page who is signed in. Use it on load to decide between the lobby and the sign-in form (UC-02 A3). No request body.

Signed in:

```json
{ "ok": true, "signedIn": true, "account": { "username": "player1" } }
```

Not signed in:

```json
{ "ok": true, "signedIn": false, "account": null }
```

A session that has been replaced elsewhere is not reported here as signed in; such a request is answered with 401 `session_terminated` as described in section 2.

## 7. Socket.IO

- The client connects to the same origin the page was served from. Engine.IO version 4, so `socket.io-client` 4.x.
- The handshake reuses the session cookie, so the server knows the account without the client sending any name. Nothing in a client payload is trusted as an identity.
- A handshake without a valid session is refused. `connect_error` reaches the client with the message `not signed in`. The page should treat that as "signed out" and go back to the home page.
- After a successful handshake, the server holds the account of the socket. A newer connection of the same account closes the older socket, because an account holds one seat.
- When the account signs out, its sockets are closed by the server.

## 8. Lobby events

A room holds at most two accounts. Membership is keyed by account, so a reconnecting client returns to the same seat. Rooms live in server memory; restarting the server drops them.

### 8.1 Client to server

| Event | Payload | Effect |
| --- | --- | --- |
| `room:create` | `{ "practice": false, "manualTest": false }`, both fields are optional | Creates a room, the sender becomes its host. manualTest allows either game window to relay the two keyboard schemes; both accounts still sign in and join normally. A player who was in another room leaves it first. |
| `room:join` | `{ "code": "ABC123" }`, case-insensitive | Adds the sender as the second member. Joining the room the player already sits in returns that room again. |
| `room:leave` | none | Removes the sender from the room. |
| `room:ready` | `{ "ready": true }` | Sets the ready flag. Only allowed in the waiting phase with two members. |
| `room:rematch` | none | Asks for another race in the same room. Only allowed in the finished phase with two members; the room restarts when every member has asked. |
| `race:input` | `{ "matchId": "...", "action": "left" }` | Forwards one action to the race engine, see section 9. |

Every event accepts an acknowledgement callback. When the client passes one it receives `{ "ok": true }` or `{ "ok": false, "error": { "code": ..., "message": ... } }`; without a callback a rejection arrives as a `room:error` event with the same `error` object.

`room:rematch` adds one field to the success acknowledgement: `{ "ok": true, "restarted": false }` means the vote was recorded and the other seat still has to agree, `true` means this vote put the room back to `waiting`. The new room state always arrives as its own `room:state`.

### 8.2 Server to client

| Event | Payload |
| --- | --- |
| `room:state` | The whole room, see 8.3. Sent to both members whenever anything changes, and to a client that reconnects into a room. |
| `room:error` | `{ "code": ..., "message": ... }`, only when no acknowledgement callback was passed |
| `race:start` | `{ "matchId": "...", "startedAt": 1700000000000, "practice": false }` |
| `race:bootstrap` | The initial race state for one seat, see section 9 |
| `race:update` | One snapshot per server tick, see section 9 |
| `race:results` | The final standings once the engine ends the race, see 9.1 |

### 8.3 Room state

```json
{
  "code": "ABC123",
  "host": "player1",
  "phase": "waiting",
  "practice": false,
  "manualTest": false,
  "matchId": null,
  "countdownEndsAt": null,
  "members": [
    { "account": "player1", "host": true, "ready": false, "connected": true },
    { "account": "player2", "host": false, "ready": true, "connected": true }
  ],
  "endedAt": null,
  "results": null,
  "rematch": { "votes": [] }
}
```

- `phase` is one of `waiting`, `countdown`, `racing`, `finished`. `closed` is only used internally when a room is destroyed.
- `countdownEndsAt` is a server timestamp in milliseconds, set while `phase` is `countdown` and cleared afterwards.
- `matchId` is set when the countdown ends and is kept for the rest of the room's life.
- `members` is ordered with the host first while the host is present. `connected` follows the account, not the socket.
- Cheat state is not part of the room. It belongs to each runner and travels in the race snapshots (9.3).
- `endedAt` is a server timestamp in milliseconds, set when the engine ends the race, and cleared when a new match starts.
- `results` holds the standings of the finished match in the shape of 9.1, or `null` before the first race ends. A page that loads or reconnects after a race reads them from here instead of waiting for `race:results`.
- `rematch.votes` lists the accounts that asked for another race since the current one ended. It is cleared when the room restarts, when a member joins or leaves, and when a new race starts.

### 8.4 Refusals

| Code | Meaning |
| --- | --- |
| `room_not_found` | No room uses that code, including a code that is not six letters or digits |
| `room_full` | The room already holds two players |
| `room_already_started` | The room left the waiting phase |
| `not_in_room` | The account sits in no room |
| `ready_locked` | Ready is disabled once the countdown has started |
| `waiting_for_opponent` | A second player has to join before the race can start |
| `rematch_unavailable` | The room has not reached the finished phase, so there is nothing to replay |

Leaving during the countdown cancels it and returns the room to `waiting`. A disconnect during the countdown does not cancel it: the countdown finishes and the missing player keeps the seat, marked `connected: false`.

## 9. Race handoff

When the countdown ends the server sets `phase` to `racing`, assigns `matchId`, sends `race:start` to both seats and hands the room to the race engine.

- `race:bootstrap` is the state of one seat at the moment its socket is attached: `{ "matchId", "controls", "track", "snapshot" }`, where `snapshot` is the engine's current state. A client that reconnects during a race receives this event again.
- `race:update` is `{ "matchId", "snapshot" }`, sent once per engine tick to every connected seat.
- `race:input` carries `{ "matchId", "action", "controlSeat"? }`. Bootstrap controls contains `{ owner, guest, manualTest }`; controlSeat 0 maps to owner, 1 to guest. Cross-seat movement/firing is allowed only in manualTest rooms with both sessions valid and connected. Cheat actions always require the sender’s own seat. The action names and the snapshot fields belong to the race engine.
- The engine reads the account from the socket, checks the match id and the session, and rejects invalid or unauthorized controlSeat values.

The race engine lives in `race/`, with `room-match.js` adapting the authenticated sockets. The adapter defaults to `full-course.json`. Direct engine callers can still choose `prototype-track.json`.

Inputs are `left`, `right`, `fire`, `up`, `down`, `enableImmunity`, `boostStart`, `boostEnd`, and `toggleCheat` (legacy practice only). Up/down applies only in orbital flight, not atmospheric ascent. The owner uses WASD/F, the guest arrows/Enter. L enables immunity in any room, clears stun/slow effects, restores the shield and marks usedCheat; hold Space for 1.5× normal speed. Release, blur and disconnect cancel acceleration. L supersedes the legacy 2× cheat. Each tick accepts at most one horizontal change, one altitude change, one shot request and one cheat toggle per runner; ammunition and the firing interval also limit shots. No client-supplied position, damage or identity is trusted.

Player snapshots add `mode` (`ground`/`flight`), `altitude` (0 on ground; 0–2 in flight), `maxShield`, `ammo`, `maxAmmo`, and `ammoRefillMs`. Existing shield, score, phase, stun, recovery and finish fields remain. `projectiles` contains active `{ id, playerId, segmentId, lane, altitude, distance }` shots. `removedObjectIds` includes terrain destroyed by shots. New tick events are `shotFired`, `shotHit`, `stageChanged`, and `launched`. Bootstrap has the same full state and suppresses replay of old tick events.

When `snapshot.status` is `ended`, `snapshot.results` contains the ordered standings. Per-player `immunityActive`, `boostActive`, `cheatActive` and `usedCheat` are authoritative.

### 9.1 Results payload

`race:results` is sent once to every remaining seat when the engine ends a match, and the same object is stored in the room state as `results` (8.3). No request is needed and no acknowledgement is expected.

```json
{
  "matchId": "ABC123-m1",
  "endedAt": 1700000000000,
  "practice": false,
  "endReason": "bothFinished",
  "trackId": "slums-prototype",
  "raceDurationMs": 138000,
  "results": [
    {
      "rank": 1,
      "account": "player1",
      "name": "player1",
      "finished": true,
      "finishTimeMs": 132150,
      "progress": 1,
      "coins": 9,
      "finishBonus": 6,
      "score": 15,
      "stuns": 1,
      "usedCheat": false
    }
  ]
}
```

- `results` is ordered by `rank`. The engine can award the same rank twice, and the repeated value is passed through unchanged.
- `finishTimeMs` is `null` and `finished` is `false` for a player who did not finish.
- `endReason` is one of `bothFinished`, `finishWindow`, `timeLimit`, or `null`.
- `usedCheat` reports whether that player used the cheat, which the results page is expected to show.
- The page-side field list is not settled with the gameplay owner yet. Engine fields are passed through rather than renamed, so a later agreement adds to this shape instead of replacing it.

### 9.2 A player who stops racing

A closed socket and an account that leaves, signs out or is signed in elsewhere are handled the same way by the running race: that runner stops taking input and freezes at its current position, and the remaining player keeps racing until the engine ends the match, which happens when both runners finish, when the finish window closes after the first finish, or at the three-minute limit. The race is never cut short by one player stopping.

The two cases differ in the room, not in the race:

- A closed socket keeps the seat, marked `connected: false` in the room state. The same account can reconnect and resume from the same position.
- An explicit `room:leave`, a sign-out or a sign-in elsewhere removes the seat (section 5), so that account cannot return to the match. The runner it left behind stays frozen until the match ends.

The room itself is not destroyed while a race is running, even when only one seat remains. It closes when the last member leaves.

### 9.3 Cheat mode

Cheat is a per-runner state owned by the race engine. The room holds no cheat flag.

- In a practice room (`practice: true` on `room:create`), `race:input` with `action: "toggleCheat"` toggles a 2× forward-speed cheat for the sender's own runner. Outside practice rooms the engine rejects that action and the flag stays off.
- `action: "enableImmunity"` (the `L` key) works in ordinary and practice rooms. It clears stun and slow effects, restores the shield, and marks that runner as having used the cheat. Holding `Space` then gives 1.5× speed while held, and releasing it restores normal speed.
- Immunity replaces the practice cheat: once a runner has enabled immunity, `toggleCheat` is no longer accepted for that runner.
- Both flags reset when a race starts, so nothing carries into the next race.
- Every snapshot reports `cheatActive`, `immunityActive`, `boostActive` and `usedCheat` per runner. The page renders its own HUD from those fields, and `usedCheat` reaches the results payload of 9.1, so the results page can show who used it.
- The server trusts no client-supplied effect: an action only asks for a change, and the engine applies it. A runner can only change its own state; cross-seat control exists only for movement and firing in `manualTest` rooms (section 9).

## 10. GET /api/standings

Returns the overall ranking, ordered by total score, then wins, then account name. No request body and no session are needed: the payload holds account names and race totals only, which the results page already shows to both players.

Query: `?limit=20`, optional, clamped to 1 to 100.

```json
{
  "ok": true,
  "standings": [
    {
      "position": 1,
      "account": "player1",
      "races": 3,
      "wins": 2,
      "totalScore": 31,
      "bestScore": 15,
      "bestRank": 1,
      "coins": 21,
      "lastRacedAt": 1700000000000
    }
  ],
  "scope": {
    "practiceExcluded": true,
    "storage": "memory",
    "order": "total score, then wins"
  }
}
```

- One entry per account, updated once per finished race with the results of 9.1.
- Practice rooms are left out, because the speed cheat is allowed there.
- The totals live in server memory. A restart clears them and nothing is written to `data/`.
- A race that ends after a seat was removed still counts for the players named in its results.

## 11. Not implemented yet

- An overall ranking that survives a restart. The in-memory totals of section 10 are the current state.
- Any per-room cheat setting. 9.3 fixes cheat as a per-runner state, so a room cannot enable or forbid it beyond choosing practice or ordinary.
