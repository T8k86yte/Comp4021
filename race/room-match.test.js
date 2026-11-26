const assert = require("node:assert/strict");
const test = require("node:test");
const { createRoomMatch } = require("./room-match");
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('new rooms read the rebuilt course while existing rooms keep their original map', () => {
    const current = require('./full-course.json');
    const legacy = structuredClone(current);
    Object.values(legacy.segments).forEach(segment => delete segment.gate);
    let disk = JSON.stringify(legacy);
    const module = { exports: {} };
    // Load the real adapter once, then emulate a course file rebuild underneath
    // that same server process. Existing matches must remain immutable.
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'room-match.js'), 'utf8'), {
        module, __dirname, structuredClone,
        require(name) {
            if (name === './index') return require('./index');
            if (name === './full-course.json') return JSON.parse(disk);
            if (name === 'node:fs') return { readFileSync: () => disk };
            if (name === 'node:path') return path;
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    const make = matchId => module.exports.createRoomMatch({ matchId, accounts: ['Cyan', 'Magenta'], isSignedIn: () => true });
    const oldRoom = make('before-rebuild');
    const cyan = socketFor('Cyan');
    assert.equal(oldRoom.attachSocket(cyan).track.segments['slums-gate'].gate, undefined);
    disk = JSON.stringify(current);
    const newRoom = make('after-rebuild');
    const bootstrap = newRoom.attachSocket(socketFor('Cyan'));
    assert.equal(bootstrap.track.segments['slums-gate'].gate.kind, 'area');
    assert.equal(bootstrap.track.segments['orbit-dock'].gate.kind, 'dock');
    assert.equal(oldRoom.attachSocket(cyan).track.segments['slums-gate'].gate, undefined, 'running matches are not rewritten');
});

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
        [false, 0.5], [true, 1]
    ]);
    assert.equal(paused.deliveries.has(cyan), false);

    const reconnected = socketFor("Cyan", "cyan-session");
    const bootstrap = match.attachSocket(reconnected);
    assert.equal(bootstrap.snapshot.players[0].distance, 0.5);
    assert.equal(bootstrap.snapshot.players[0].connected, true);
    assert.deepEqual(bootstrap.snapshot.events, []);
    assert.equal(match.detachSocket(cyan), false);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "left" }), false);
    const resumed = advance(match).update.snapshot.players[0];
    assert.equal(resumed.distance, 1);
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
    assert.equal(bootstrap.snapshot.projectiles[0].distance, 4.5);
    assert.deepEqual(bootstrap.snapshot.events, []);
    bootstrap.snapshot.projectiles[0].distance = 999;
    const resumed = advance(match);
    assert.equal(resumed.update.snapshot.projectiles[0].distance, 6.75);
    assert.equal(resumed.deliveries.has(replacement), true);
    assert.equal(match.acceptInput(cyan, { matchId: "round-2", action: "fire" }), false);
});

test('both room seats receive one traffic clock and reconnect keeps the ascent altitude lock', () => {
    const track = structuredClone(require('./full-course.json'));
    track.startSegmentId = 'orbit-launch';
    const match = createRoomMatch({matchId:'ascent',accounts:['Cyan','Magenta'],track,isSignedIn:()=>true});
    const cyan=socketFor('Cyan'),magenta=socketFor('Magenta');
    match.attachSocket(cyan);match.attachSocket(magenta);
    assert.equal(match.acceptInput(cyan,{matchId:'ascent',action:'up'}),false);
    for(let i=0;i<30;i++)advance(match);
    const live=advance(match);
    assert.deepEqual(live.deliveries.get(cyan).snapshot,live.deliveries.get(magenta).snapshot);
    match.detachSocket(cyan);advance(match);
    const replacement=socketFor('Cyan'),resumed=match.attachSocket(replacement);
    assert.equal(resumed.snapshot.elapsedMs,1600);
    assert.equal(resumed.snapshot.players[0].altitude,1);
    assert.equal(resumed.track.segments['orbit-launch'].objects.filter(o=>o.motion).length,3);
    assert.equal(match.acceptInput(replacement,{matchId:'ascent',action:'down'}),false);
    assert.equal(match.acceptInput(replacement,{matchId:'ascent',action:'right'}),true);
});
