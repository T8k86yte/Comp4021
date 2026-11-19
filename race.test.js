const assert = require("node:assert/strict");
const test = require("node:test");
const { createRace, TICK_MS } = require("./");

const players = [{ id: "cyan", name: "Cyan" }, { id: "magenta", name: "Magenta" }];

function straightTrack(length, objects = []) {
    return {
        id: "test",
        startSegmentId: "straight",
        segments: {
            straight: { stage: "slums", laneCount: 4, length, progress: [0, length], objects }
        }
    };
}

function advance(race, ticks) {
    for (let i = 0; i < ticks; i += 1) race.step();
    return race.getSnapshot();
}

function until(race, condition, maxTicks = 180_000 / TICK_MS) {
    for (let i = 0; i < maxTicks; i += 1) {
        const snapshot = race.step();
        if (condition(snapshot)) return snapshot;
    }
    assert.fail("Race did not reach the expected state");
}

test("the prototype splits and rejoins with comparable progress", () => {
    const race = createRace({ players });
    assert.equal(race.applyInput("cyan", "left"), true);
    assert.equal(race.applyInput("cyan", "left"), false);
    assert.equal(race.applyInput("magenta", "right"), true);
    const fork = advance(race, 120);
    assert.deepEqual(fork.players.map(player => player.segmentId), ["shortcut", "main-route"]);
    assert.deepEqual(fork.players.map(player => player.lane), [1, 3]);
    assert.deepEqual(fork.players.map(player => player.progress), [30, 30]);
    const merge = advance(race, 140);
    assert.equal(merge.players[0].segmentId, "runout");
    assert.equal(merge.players[0].lane, 0);
    assert.equal(merge.players[0].progress, 85);
    assert.ok(merge.removedObjectIds.includes("shortcut-crate"));
    const finish = until(race, state => state.status === "ended");
    assert.equal(finish.endReason, "bothFinished");
    assert.deepEqual(finish.results.map(runner => runner.finishTimeMs), [18_000, 22_000]);
    assert.deepEqual(finish.results.map(runner => runner.finishBonus), [6, 0]);
});

test("a shared coin is awarded once, exact ties alternate, and races have independent state", () => {
    const track = straightTrack(5, [
        { id: "coin-a", type: "coin", lane: 1, distance: 1 },
        { id: "coin-b", type: "coin", lane: 1, distance: 2 },
        { id: "crate", type: "crate", lane: 1, distance: 3 }
    ]);
    const race = createRace({ players, track });
    const otherRoom = createRace({ players, track });
    race.applyInput("magenta", "left");
    const first = advance(race, 4);
    assert.deepEqual(first.events, [{ type: "coinCollected", playerId: "cyan", objectId: "coin-a" }]);
    const second = advance(race, 4);
    assert.deepEqual(second.events, [{ type: "coinCollected", playerId: "magenta", objectId: "coin-b" }]);
    const crate = advance(race, 4);
    assert.equal(crate.events.filter(event => event.type === "crateBroken").length, 1);
    assert.deepEqual(crate.players.map(player => player.shield), [2, 3]);
    assert.deepEqual(otherRoom.getSnapshot().removedObjectIds, []);
    crate.players[0].coins = 500;
    crate.removedObjectIds.length = 0;
    assert.deepEqual(race.getSnapshot().players.map(player => player.coins), [1, 1]);
    assert.deepEqual(race.getSnapshot().removedObjectIds, ["coin-a", "coin-b", "crate"]);
    const finish = until(race, state => state.status === "ended");
    assert.deepEqual(finish.results.map(player => player.rank), [1, 1]);
    assert.deepEqual(finish.results.map(player => player.finishBonus), [6, 6]);
});

test("an earlier contact wins when two runners reach a coin in the same tick", () => {
    const track = straightTrack(6, [{ id: "coin", type: "coin", lane: 1, distance: 3 }]);
    const race = createRace({ players, track, practice: true });
    race.applyInput("magenta", "left");
    race.applyInput("magenta", "toggleCheat");
    race.step();
    race.applyInput("magenta", "toggleCheat");
    advance(race, 9);
    race.applyInput("cyan", "toggleCheat");
    race.applyInput("magenta", "toggleCheat");
    const snapshot = race.step();
    assert.deepEqual(snapshot.players.map(player => player.coins), [0, 1]);
});

test("barriers phase an intact runner, then a shield break stuns and protects recovery", () => {
    const track = straightTrack(25, [
        ...[1, 3, 5, 6, 12].map(distance => ({ id: `pipe-${distance}`, type: "barrier", lane: 1, distance })),
        { id: "phased-coin", type: "coin", lane: 1, distance: 2 }
    ]);
    const race = createRace({ players, track });
    const hit = advance(race, 4);
    assert.equal(hit.players[0].shield, 2);
    assert.equal(hit.players[0].phaseRemainingMs, 500);
    assert.equal(advance(race, 10).players[0].distance, 2.25);
    assert.equal(race.getSnapshot().removedObjectIds.includes("phased-coin"), false);
    const broken = until(race, state => state.players[0].stuns === 1);
    assert.equal(broken.players[0].distance, 5);
    assert.equal(broken.players[0].stunRemainingMs, 1_500);
    assert.equal(race.applyInput("cyan", "left"), false);
    const recovered = advance(race, 30);
    assert.equal(recovered.players[0].distance, 5);
    assert.equal(recovered.players[0].recoveryRemainingMs, 1_000);
    const cleared = advance(race, 20);
    assert.equal(cleared.players[0].distance, 10);
    assert.equal(cleared.players[0].shield, 0);
    const secondStun = until(race, state => state.players[0].stuns === 2);
    assert.equal(secondStun.players[0].distance, 12);
});

test("an intact shield refills one gauge at a time without delaying the current refill", () => {
    const track = straightTrack(28, [
        { id: "one", type: "crate", lane: 1, distance: 1 },
        { id: "two", type: "crate", lane: 1, distance: 2 }
    ]);
    const race = createRace({ players, track });
    assert.equal(advance(race, 8).players[0].shield, 1);
    assert.equal(advance(race, 35).players[0].shield, 1);
    assert.equal(race.step().players[0].shield, 2);
    assert.equal(advance(race, 40).players[0].shield, 3);
});

test("the prototype's longer route can win on coins", () => {
    const race = createRace({ players });
    race.applyInput("cyan", "left");
    advance(race, 120);
    race.applyInput("magenta", "left");
    advance(race, 60);
    race.applyInput("magenta", "right");
    advance(race, 56);
    race.applyInput("magenta", "right");
    const finish = until(race, state => state.status === "ended");
    assert.deepEqual(finish.results.map(player => [player.id, player.score]), [["magenta", 9], ["cyan", 8]]);
    assert.deepEqual(finish.results.map(player => player.finishTimeMs), [22_000, 18_000]);
});

test("cheat input requires practice mode and ended races stay frozen", () => {
    const regular = createRace({ players });
    assert.equal(regular.applyInput("cyan", "toggleCheat"), false);
    assert.equal(regular.applyInput("spectator", "left"), false);
    const practice = createRace({ players, track: straightTrack(15), practice: true });
    assert.equal(practice.applyInput("cyan", "toggleCheat"), true);
    assert.equal(practice.step().players[0].distance, 0.5);
    practice.applyInput("cyan", "toggleCheat");
    const resumed = practice.step();
    assert.equal(resumed.players[0].distance, 0.75);
    assert.equal(resumed.players[0].cheatActive, false);
    const finish = until(practice, state => state.status === "ended");
    assert.deepEqual(finish.results.map(player => player.usedCheat), [true, false]);
    assert.equal(practice.applyInput("cyan", "right"), false);
    assert.deepEqual(practice.step(), finish);
});

test("the finish window and three-minute limit bound the race", () => {
    const practice = createRace({ players, track: straightTrack(200), practice: true });
    practice.applyInput("cyan", "toggleCheat");
    const first = until(practice, state => state.players[0].finishTimeMs !== null);
    assert.equal(first.remainingMs, 15_000);
    const cutoff = until(practice, state => state.status === "ended");
    assert.equal(cutoff.elapsedMs, 35_000);
    assert.equal(cutoff.endReason, "finishWindow");
    assert.equal(cutoff.results[1].finishTimeMs, null);

    const longTrack = createRace({ players, track: straightTrack(930), practice: true });
    advance(longTrack, 174_000 / TICK_MS);
    longTrack.applyInput("cyan", "toggleCheat");
    const limit = until(longTrack, state => state.status === "ended");
    assert.equal(limit.elapsedMs, 180_000);
    assert.equal(limit.endReason, "timeLimit");
    assert.equal(limit.results[0].finishTimeMs, 180_000);
    assert.equal(limit.results[1].finishTimeMs, null);
});
