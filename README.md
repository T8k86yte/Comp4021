# Edgerunner race engine

The engine runs one authoritative two-player race. It uses plain Node.js and keeps each match's state inside its own instance.

## Run the prototype checks

From the `edgerunner` folder, run `npm test`. The tests exercise the default course and the room adapter. A runner can finish four seconds earlier via the shortcut and still lose to a rival who collects nine coins.

The default course represents a short Slums playtest. The approach has four lanes and the leftmost lane leads to a three-lane shortcut. The routes merge before the finish. At cruise speed the shortcut takes 18 seconds and the main route takes 22 seconds, before collision penalties. The pistol, stage gadgets, and orbital flight are later gameplay work.

## Lobby server handoff

The adapter follows the collaborator backend's account protocol. The Socket.IO handshake sets `socket.data.account` to the canonical username. Pass the same usernames in room seat order and use `isSignedIn` from the server's session guard. [Account and Socket.IO protocol](https://github.com/T8k86yte/Comp4021/blob/29717458702bcdb8ae278a13e110b61098ff1914/docs/protocol.md)

```js
const { TICK_MS } = require("./race");
const { createRoomMatch } = require("./race/room-match");
const { isSignedIn } = require("./lib/sessionGuard");

// Create one match per round at the end of the room countdown.
const match = createRoomMatch({
    matchId,
    accounts: [firstUsername, secondUsername],
    isSignedIn,
    practice: room.practice
});

// Call for the seated sockets at GO and for each reconnect.
const bootstrap = match.attachSocket(socket);
if (bootstrap) socket.emit(events.bootstrap, bootstrap);

// Call from the room's existing input handler with { matchId, action }.
match.acceptInput(socket, input);

// Call once per TICK_MS and stop when snapshot.status is "ended".
const { snapshot } = match.step((recipient, update) => recipient.emit(events.update, update));
```

- Use `left`, `right`, and `toggleCheat` as actions. `acceptInput` returns whether the action was queued. It checks the match ID and the current account session and resolves the runner from the attached socket. Each runner can queue one lane change and one practice cheat toggle per tick.
- Use the adapter's publish callback to send race updates to the current authenticated sockets. It checks the session on each tick as well as on input, so a replaced session loses race access immediately. Use the event names agreed with the lobby and Canvas owners.
- On socket disconnect, call `match.detachSocket(socket)`. The runner holds position and keeps the seat, the other runner keeps moving, and the match clock and shield timers continue. Attaching a current socket for the same account resumes that runner and returns their current state. The newest attached socket controls the seat.
- The lobby owns the **50 ms** tick scheduler, room state, countdown, and rematch consent. Use a fresh match ID and engine for a rematch. The room decides how to handle someone who explicitly leaves or signs out.

## Canvas and results handoff

The start or reconnect payload is `{ matchId, track, snapshot }`. Subsequent updates are `{ matchId, snapshot }`. Use the match ID to ignore late updates from a previous round and find the local camera by matching the signed-in username to `players[].id`. `segmentId`, `lane`, and `distance` locate each runner. Draw the rival when they are visible and use `progress` for the meter when paths diverge. The client can interpolate movement between snapshots. Lanes are zero-based from left to right.

| Snapshot field | What the client can use it for |
| --- | --- |
| `tick`, `elapsedMs`, `remainingMs` | Order updates and show the timer. After the first finish, the timer reflects the earlier of the 15-second finish window and the three-minute cap. |
| `players` | Show position, coins, score, shield, and remaining phase, stun, and recovery times. Use `connected` to indicate a frozen runner. A null `finishTimeMs` means the runner is still racing, or did not finish if the match has ended. |
| `removedObjectIds` | Remove collected coins and broken crates from both views. This list reflects the whole race so a reconnect can restore the scene. |
| `events` | Animate and play sounds for `coinCollected`, `crateBroken`, `impact`, and `runnerFinished`. Events belong to one tick. Each has a `playerId`, object events have an `objectId`, and impacts include `stunned`. |
| `status`, `endReason`, `results` | Switch to the results screen when ended. Results arrive in rank order with finish time, coins, bonus, score, stuns, and cheat usage. End reasons are `bothFinished`, `finishWindow`, and `timeLimit`. |

Map A/D and Left/Right to lane changes and C to the cheat toggle in practice rooms. Ignore key repeat for these actions. To meet the project brief, animate runners, coins, and breakable crates in Canvas and play separate coin and impact sound files. The engine supplies the events to trigger them.

## Edit the track

- A track has an `id`, a `startSegmentId`, and a `segments` object keyed by segment ID.
- Each segment has a `stage`, a `laneCount`, a whole-grid `length`, and a `progress` interval. Physical length controls travel time. Give parallel routes the same progress endpoints so the HUD can compare racers on different paths.
- `exits` lists one `[destinationSegmentId, destinationLane]` pair per lane in order. The end progress of the source segment must match the start progress of its destination. Omit `exits` on a finish segment.
- Each object has a track-wide unique `id`, a `type` (`coin`, `crate`, or `barrier`), a `lane`, and an integer `distance` from 1 through `length - 1`. Place at most one object per cell.
- Coins award one point and disappear for both players. The first contact wins, with alternating seat priority on exact shared-object ties. Crates break on contact and cost one shield gauge. A barrier consumes one gauge and briefly slows and phases the runner if their shield still has a gauge. Spending the last gauge causes a stun. The prototype's barrier slowdown is half speed for the 0.5-second phase.
