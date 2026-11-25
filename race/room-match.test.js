const assert = require("node:assert/strict");
const test = require("node:test");
const { createRoomMatch } = require("./room-match");

function socketFor(account, sessionId = account) {
    return {
        connected: true,
        data: { account },
        request: { session: { account, id: sessionId } }
    };
}

function setup() {
    const sessions = new Map([["Cyan", "cyan-session"], ["Magenta", "magenta-session"], ["Observer", "observer"]]);
    const match = createRoomMatch({
        matchId: "round-2",
        accounts: ["Cyan", "Magenta"],
        isSignedIn: session => sessions.get(session.account) === session.id,
        practice: true
    });
    return {
        match, sessions,
        cyan: socketFor("Cyan", "cyan-session"),
        magenta: socketFor("Magenta", "magenta-session")
    };
}

function advance(match) {
    const deliveries = new Map();
    const update = match.step((socket, payload) => deliveries.set(socket, payload));
    return { update, deliveries };
}

test("an authenticated seat uses its own account and the current match ID", () => {
    const { match, cyan, magenta } = setup();
    assert.equal(match.attachSocket(socketFor("Observer")), null);
    assert.equal(match.attachSocket(socketFor("Cyan", "old-session")), null);
    const impersonator = socketFor("Magenta", "magenta-session");
    impersonator.data.account = "Cyan";
    assert.equal(match.attachSocket(impersonator), null);

    const start = match.attachSocket(cyan);
    assert.equal(start.matchId, "round-2");
    assert.equal(start.track.id, start.snapshot.trackId);
    assert.equal(start.track.id, "city-to-crystal-palace");
    assert.deepEqual(start.snapshot.players.map(player => [player.id, player.connected]), [
        ["Cyan", true], ["Magenta", false]
    ]);
    assert.ok(match.attachSocket(magenta));
    assert.equal(match.acceptInput(cyan, { matchId: "round-1", action: "left" }), false);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "left", playerId: "Magenta" }), true);
    assert.equal(match.acceptInput(cyan, null), false);

    const { update, deliveries } = advance(match);
    assert.deepEqual(update.snapshot.players.map(player => [player.id, player.lane]), [["Cyan", 0], ["Magenta", 2]]);
    assert.strictEqual(deliveries.get(cyan), deliveries.get(magenta));
    assert.equal(deliveries.size, 2);
});

test("disconnect freezes one runner and reconnect resumes the same seat without queued actions", () => {
    const { match, cyan, magenta } = setup();
    match.attachSocket(cyan);
    match.attachSocket(magenta);
    advance(match);
    match.acceptInput(cyan, { matchId: "round-2", action: "left" });
    match.acceptInput(cyan, { matchId: "round-2", action: "toggleCheat" });
    assert.equal(match.detachSocket(cyan), true);

    const paused = advance(match);
    assert.equal(paused.update.snapshot.elapsedMs, 100);
    assert.deepEqual(paused.update.snapshot.players.map(player => [player.connected, player.distance]), [
        [false, 0.25], [true, 0.5]
    ]);
    assert.equal(paused.deliveries.has(cyan), false);

    const reconnected = socketFor("Cyan", "cyan-session");
    const bootstrap = match.attachSocket(reconnected);
    assert.equal(bootstrap.snapshot.players[0].distance, 0.25);
    assert.equal(bootstrap.snapshot.players[0].connected, true);
    assert.deepEqual(bootstrap.snapshot.events, []);
    assert.equal(match.detachSocket(cyan), false);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "left" }), false);
    const resumed = advance(match).update.snapshot.players[0];
    assert.equal(resumed.distance, 0.5);
    assert.equal(resumed.cheatActive, false);
    assert.equal(resumed.lane, 1);
});

test("a replaced session loses input and updates before the socket closes", () => {
    const { match, sessions, cyan, magenta } = setup();
    match.attachSocket(cyan);
    match.attachSocket(magenta);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "left" }), true);
    sessions.set("Cyan", "new-session");
    const replaced = advance(match);
    assert.equal(cyan.connected, true);
    assert.equal(replaced.deliveries.has(cyan), false);
    assert.equal(replaced.update.snapshot.players[0].connected, false);
    assert.equal(replaced.update.snapshot.players[0].distance, 0);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "right" }), false);
    assert.equal(match.attachSocket(cyan), null);

    const replacement = socketFor("Cyan", "new-session");
    assert.ok(match.attachSocket(replacement));
    const resumed = advance(match);
    assert.equal(resumed.update.snapshot.players[0].lane, 1);
    assert.equal(resumed.deliveries.has(replacement), true);
});

test("replacing a socket in the same session clears its queued controls", () => {
    const { match, cyan } = setup();
    match.attachSocket(cyan);
    match.acceptInput(cyan, { matchId: "round-2", action: "left" });
    const latest = socketFor("Cyan", "cyan-session");
    assert.ok(match.attachSocket(latest));
    assert.equal(match.detachSocket(cyan), false);
    const { update, deliveries } = advance(match);
    assert.equal(update.snapshot.players[0].lane, 1);
    assert.equal(deliveries.has(cyan), false);
    assert.equal(deliveries.has(latest), true);
});

test("gun state and shared projectiles survive a reconnect without replaying shot events", () => {
    const { match, cyan, magenta } = setup();
    match.attachSocket(cyan);
    match.attachSocket(magenta);
    assert.equal(match.acceptInput(cyan, { matchId: "round-1", action: "fire" }), false);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "fire" }), true);
    const fired = advance(match);
    assert.equal(fired.update.snapshot.players[0].ammo, 2);
    assert.equal(fired.deliveries.get(magenta).snapshot.projectiles[0].playerId, "Cyan");
    assert.equal(match.detachSocket(cyan), true);
    advance(match);
    const replacement = socketFor("Cyan", "cyan-session");
    const bootstrap = match.attachSocket(replacement);
    assert.equal(bootstrap.snapshot.players[0].ammo, 2);
    assert.equal(bootstrap.snapshot.players[0].ammoRefillMs, 950);
    assert.equal(bootstrap.snapshot.projectiles[0].distance, 1.5);
    assert.deepEqual(bootstrap.snapshot.events, []);
    bootstrap.snapshot.projectiles[0].distance = 999;
    const resumed = advance(match);
    assert.equal(resumed.update.snapshot.projectiles[0].distance, 2.25);
    assert.equal(resumed.deliveries.has(replacement), true);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "fire" }), false);
});
