const prototypeTrack = require("./prototype-track.json");

const TICK_MS = 50;
const RACE_LIMIT_MS = 180_000;
const FINISH_WINDOW_MS = 15_000;
const FIRST_FINISH_BONUS = 6;
const MAX_SHIELD = 3;
const REFILL_MS = 2_000;
const IMPACT_MS = 500;
const STUN_MS = 1_500;
const RECOVERY_MS = 1_000;
const STEP_DISTANCE = 0.25;
const OBJECT_TYPES = new Set(["coin", "crate", "barrier"]);

function indexTrack(track) {
    if (typeof track?.id !== "string" || !track.id ||
        !track.segments || !Object.hasOwn(track.segments, track.startSegmentId)) {
        throw new TypeError("Track must define an ID and a start segment");
    }

    const segments = new Map(Object.entries(track.segments));
    const objectIds = new Set();
    for (const [id, segment] of segments) {
        if (!segment || typeof segment.stage !== "string" || !segment.stage ||
            !Number.isInteger(segment.laneCount) || segment.laneCount < 1 ||
            !Number.isInteger(segment.length) || segment.length < 1 ||
            !Array.isArray(segment.progress) || segment.progress.length !== 2 ||
            !segment.progress.every(Number.isFinite) || segment.progress[1] <= segment.progress[0] ||
            !Array.isArray(segment.objects)) {
            throw new TypeError(`Invalid segment: ${id}`);
        }

        const objectsByCell = new Map();
        for (const object of segment.objects) {
            const cell = object && `${object.distance}:${object.lane}`;
            if (!object || typeof object.id !== "string" || !object.id || objectIds.has(object.id) ||
                !OBJECT_TYPES.has(object.type) || !Number.isInteger(object.distance) ||
                object.distance < 1 || object.distance >= segment.length ||
                !Number.isInteger(object.lane) || object.lane < 0 || object.lane >= segment.laneCount ||
                objectsByCell.has(cell)) {
                throw new TypeError(`Invalid or duplicate object in segment: ${id}`);
            }
            objectIds.add(object.id);
            objectsByCell.set(cell, object);
        }
        segment.objectsByCell = objectsByCell;

        if (segment.exits === undefined) continue;
        if (!Array.isArray(segment.exits) || segment.exits.length !== segment.laneCount) {
            throw new TypeError(`Provide one exit per lane in segment: ${id}`);
        }
        for (const exit of segment.exits) {
            const destination = Array.isArray(exit) && segments.get(exit[0]);
            const lane = exit?.[1];
            if (!destination || exit.length !== 2 || !Number.isInteger(lane) ||
                lane < 0 || lane >= destination.laneCount || segment.progress[1] !== destination.progress?.[0]) {
                throw new TypeError(`Invalid exit in segment: ${id}`);
            }
        }
    }
    return segments;
}

function createRace({ players: entrants, track = prototypeTrack, practice = false }) {
    if (!Array.isArray(entrants) || entrants.length !== 2 ||
        entrants.some(player => typeof player?.id !== "string" || !player.id) ||
        entrants[0].id === entrants[1].id) {
        throw new TypeError("A race needs two distinct player IDs");
    }

    const course = structuredClone(track);
    const segments = indexTrack(course);
    const start = segments.get(course.startSegmentId);
    const players = entrants.map(({ id, name }, seat) => ({
        id,
        name: typeof name === "string" ? name : id,
        seat,
        connected: true,
        segmentId: course.startSegmentId,
        // Start in the two middle lanes on the four-lane prototype.
        lane: Math.floor((start.laneCount - 1) / 2) + (start.laneCount > 1 ? seat : 0),
        distance: 0,
        coins: 0,
        shield: MAX_SHIELD,
        refillAt: null,
        slowUntil: 0,
        phaseUntil: 0,
        stunUntil: 0,
        recoveryUntil: 0,
        stuns: 0,
        laneInput: 0,
        toggleCheat: false,
        cheatActive: false,
        usedCheat: false,
        finishTimeMs: null
    }));
    const removedObjects = new Set();
    let tick = 0;
    let elapsedMs = 0;
    let firstFinishMs = null;
    let endReason = null;
    let results = null;
    let events = [];
    let prioritySeat = 0;

    function applyInput(playerId, action) {
        const player = players.find(candidate => candidate.id === playerId);
        if (!player?.connected || endReason || player.finishTimeMs !== null) return false;

        if (action === "toggleCheat" && practice === true && !player.toggleCheat) {
            player.toggleCheat = true;
            return true;
        }
        if ((action === "left" || action === "right") && !player.laneInput && elapsedMs >= player.stunUntil) {
            player.laneInput = action === "left" ? -1 : 1;
            return true;
        }
        return false;
    }

    function setConnected(playerId, connected) {
        const player = players.find(candidate => candidate.id === playerId);
        if (!player || typeof connected !== "boolean" || endReason) return false;

        player.connected = connected;
        if (!connected) {
            player.laneInput = 0;
            player.toggleCheat = false;
        }
        return true;
    }

    function planMovement(player, tickStartMs) {
        if (player.finishTimeMs !== null) return null;
        if (player.toggleCheat) {
            player.cheatActive = !player.cheatActive;
            player.usedCheat ||= player.cheatActive;
            player.toggleCheat = false;
        }
        if (player.refillAt !== null && elapsedMs >= player.refillAt) {
            player.shield += 1;
            player.refillAt = player.shield < MAX_SHIELD ? player.refillAt + REFILL_MS : null;
        }
        if (!player.connected || tickStartMs < player.stunUntil) return null;

        const segment = segments.get(player.segmentId);
        const lane = Math.max(0, Math.min(segment.laneCount - 1, player.lane + player.laneInput));
        const changedLane = lane !== player.lane;
        player.lane = lane;
        player.laneInput = 0;

        const distance = player.distance;
        let movement = STEP_DISTANCE;
        if (player.cheatActive) movement *= 2;
        else if (tickStartMs < player.slowUntil) movement /= 2;
        const nextDistance = distance + movement;
        // Each tick covers less than one grid, so at most one cell can be entered.
        const row = changedLane ? Math.ceil(distance) : Math.floor(distance) + 1;
        let object = row <= nextDistance ? segment.objectsByCell.get(`${row}:${lane}`) : undefined;
        if (object && (removedObjects.has(object.id) || tickStartMs < player.phaseUntil ||
            (object.type !== "coin" && (player.cheatActive || tickStartMs < player.recoveryUntil)))) {
            object = undefined;
        }
        return {
            player, segment, nextDistance, object,
            contactTime: object ? (row - distance) / movement : Infinity
        };
    }

    function contact(player, object) {
        if (removedObjects.has(object.id)) return false;
        if (object.type === "coin") {
            removedObjects.add(object.id);
            player.coins += 1;
            events.push({ type: "coinCollected", playerId: player.id, objectId: object.id });
            return false;
        }
        if (object.type === "crate") {
            removedObjects.add(object.id);
            events.push({ type: "crateBroken", playerId: player.id, objectId: object.id });
        }
        if (player.shield > 0) {
            player.shield -= 1;
            player.refillAt = player.shield > 0 ? player.refillAt ?? elapsedMs + REFILL_MS : null;
        }
        const stunned = player.shield === 0;
        if (stunned) {
            player.stuns += 1;
            player.stunUntil = elapsedMs + STUN_MS;
            player.recoveryUntil = player.stunUntil + RECOVERY_MS;
        } else if (object.type === "barrier") {
            player.slowUntil = elapsedMs + IMPACT_MS;
            player.phaseUntil = elapsedMs + IMPACT_MS;
        }
        events.push({ type: "impact", playerId: player.id, objectId: object.id, stunned });
        return stunned;
    }

    function move({ player, segment, nextDistance, object }) {
        if (object && contact(player, object)) {
            player.distance = object.distance;
            return;
        }
        player.distance = nextDistance;
        if (player.distance < segment.length) return;

        if (segment.exits) {
            const [nextSegmentId, nextLane] = segment.exits[player.lane];
            player.segmentId = nextSegmentId;
            player.lane = nextLane;
            player.distance -= segment.length;
            return;
        }
        player.distance = segment.length;
        player.finishTimeMs = elapsedMs;
        firstFinishMs ??= elapsedMs;
        events.push({ type: "runnerFinished", playerId: player.id });
    }

    function runnerState(player) {
        const segment = segments.get(player.segmentId);
        const [from, to] = segment.progress;
        const finishBonus = player.finishTimeMs !== null && player.finishTimeMs === firstFinishMs
            ? FIRST_FINISH_BONUS : 0;
        const stunRemainingMs = Math.max(0, player.stunUntil - elapsedMs);
        return {
            id: player.id,
            name: player.name,
            connected: player.connected,
            segmentId: player.segmentId,
            stage: segment.stage,
            lane: player.lane,
            distance: player.distance,
            progress: from + (to - from) * player.distance / segment.length,
            coins: player.coins,
            shield: player.shield,
            shieldRefillMs: player.refillAt === null ? null : player.refillAt - elapsedMs,
            phaseRemainingMs: Math.max(0, player.phaseUntil - elapsedMs),
            stunRemainingMs,
            recoveryRemainingMs: stunRemainingMs ? 0 : Math.max(0, player.recoveryUntil - elapsedMs),
            stuns: player.stuns,
            finishTimeMs: player.finishTimeMs,
            finishBonus,
            score: player.coins + finishBonus,
            cheatActive: player.cheatActive,
            usedCheat: player.usedCheat
        };
    }

    function compareRanks(a, b) {
        const aFinished = a.finishTimeMs !== null;
        const bFinished = b.finishTimeMs !== null;
        if (aFinished !== bFinished) return aFinished ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return aFinished ? a.finishTimeMs - b.finishTimeMs : b.progress - a.progress;
    }

    function getSnapshot() {
        const deadline = Math.min(RACE_LIMIT_MS, firstFinishMs === null
            ? RACE_LIMIT_MS : firstFinishMs + FINISH_WINDOW_MS);
        return {
            status: endReason ? "ended" : "running",
            tick,
            elapsedMs,
            remainingMs: endReason ? 0 : deadline - elapsedMs,
            endReason,
            trackId: course.id,
            practice: practice === true,
            players: players.map(runnerState),
            removedObjectIds: [...removedObjects],
            events: events.map(event => ({ ...event })),
            results: results?.map(result => ({ ...result })) ?? null
        };
    }

    function step() {
        if (endReason) return getSnapshot();

        const tickStartMs = elapsedMs;
        tick += 1;
        elapsedMs += TICK_MS;
        events = [];
        const moves = players.map(player => planMovement(player, tickStartMs)).filter(Boolean);
        // Resolve earlier contacts first. Rotate priority when both reach the same object together.
        const [first, second] = moves;
        const contested = first?.object && first.object === second?.object &&
            first.object.type !== "barrier" && first.contactTime === second.contactTime;
        moves.sort((a, b) => {
            if (a.contactTime !== b.contactTime) return a.contactTime - b.contactTime;
            return Math.abs(a.player.seat - prioritySeat) - Math.abs(b.player.seat - prioritySeat);
        });
        if (contested) prioritySeat = 1 - prioritySeat;
        for (const movement of moves) move(movement);

        if (players.every(player => player.finishTimeMs !== null)) endReason = "bothFinished";
        else if (elapsedMs >= RACE_LIMIT_MS) endReason = "timeLimit";
        else if (firstFinishMs !== null && elapsedMs >= firstFinishMs + FINISH_WINDOW_MS) {
            endReason = "finishWindow";
        }

        if (endReason) {
            const standings = players.map(runnerState).sort(compareRanks);
            results = standings.map((runner, index) => ({
                id: runner.id,
                name: runner.name,
                rank: index > 0 && compareRanks(standings[index - 1], runner) === 0 ? index : index + 1,
                finishTimeMs: runner.finishTimeMs,
                progress: runner.progress,
                coins: runner.coins,
                finishBonus: runner.finishBonus,
                score: runner.score,
                stuns: runner.stuns,
                usedCheat: runner.usedCheat
            }));
        }
        return getSnapshot();
    }

    return { applyInput, setConnected, step, getSnapshot };
}

module.exports = { createRace, TICK_MS };
