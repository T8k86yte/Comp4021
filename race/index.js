const prototypeTrack = require("./prototype-track.json");
const { occupiesLane } = require('../public/js/race-motion');

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
const MAX_AMMO = 3;
const RELOAD_MS = 1_000;
const SHOT_COOLDOWN_MS = 200;
const SHOT_STEP = STEP_DISTANCE * 9;
// 72 world units lets a shot reach the 45-unit visible horizon, even while its owner runs.
const SHOT_RANGE = 72;
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
            (segment.mode !== undefined && segment.mode !== "ground" && segment.mode !== "flight") ||
            (segment.flightPhase !== undefined && (!['atmosphere', 'orbit'].includes(segment.flightPhase) || segment.mode !== 'flight')) ||
            !Number.isInteger(segment.laneCount) || segment.laneCount < 1 ||
            !Number.isInteger(segment.length) || segment.length < 1 ||
            !Array.isArray(segment.progress) || segment.progress.length !== 2 ||
            !segment.progress.every(Number.isFinite) || segment.progress[1] <= segment.progress[0] ||
            !Array.isArray(segment.objects)) {
            throw new TypeError(`Invalid segment: ${id}`);
        }

        const objectsByCell = new Map();
        for (const object of segment.objects) {
            const cell = object && `${object.distance}:${object.lane}:${segment.mode === "flight" ? object.altitude ?? 1 : 1}`;
            if (!object || typeof object.id !== "string" || !object.id || objectIds.has(object.id) ||
                !OBJECT_TYPES.has(object.type) || !Number.isInteger(object.distance) ||
                object.distance < 1 || object.distance >= segment.length ||
                !Number.isInteger(object.lane) || object.lane < 0 || object.lane >= segment.laneCount ||
                (object.altitude !== undefined && (!Number.isInteger(object.altitude) || object.altitude < 0 ||
                    object.altitude >= (segment.mode === "flight" ? 3 : 1))) || objectsByCell.has(cell) ||
                (segment.flightPhase === 'atmosphere' && (object.altitude ?? 1) !== 1) ||
                (object.motion && (segment.flightPhase !== 'atmosphere' || object.type !== 'barrier' ||
                    object.motion.kind !== 'crossing' || !Number.isFinite(object.motion.periodMs) ||
                    object.motion.periodMs < 3000 || !Number.isFinite(object.motion.phaseMs)))) {
                throw new TypeError(`Invalid or duplicate object in segment: ${id}`);
            }
            objectIds.add(object.id);
            objectsByCell.set(cell, object);
        }
        segment.objectsByCell = objectsByCell;
        segment.traffic = segment.objects.filter(object => object.motion);

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
    // Course tuning is shared by the authoritative server and local preview.
    // Keep the prototype's original speed. Faster courses split movement into
    // small collision steps while retaining the 50 ms network/projectile tick.
    const cruiseSpeed = course.cruiseSpeed ?? STEP_DISTANCE * 1000 / TICK_MS;
    if (!Number.isFinite(cruiseSpeed) || cruiseSpeed <= 0 || cruiseSpeed > 25) {
        throw new TypeError('Cruise speed must be greater than 0 and at most 25 cells per second');
    }
    const movementStep = cruiseSpeed * TICK_MS / 1000;
    // Strictly less than one cell, including the 2x cheat and a lane change at
    // an integer boundary, so every crossed row is checked for both players.
    const movementSlices = Math.floor(movementStep * 2) + 1;
    const segments = indexTrack(course);
    const start = segments.get(course.startSegmentId);
    const players = entrants.map(({ id, name }, seat) => ({
        id,
        name: typeof name === "string" ? name : id,
        seat,
        connected: true,
        altitude: start.mode === "flight" ? 1 : 0,
        segmentId: course.startSegmentId,
        // Start in the two middle lanes on the four-lane prototype.
        lane: Math.floor((start.laneCount - 1) / 2) + (start.laneCount > 1 ? seat : 0),
        distance: 0,
        coins: 0,
        shield: start.mode === "flight" ? 100 : MAX_SHIELD,
        ammo: MAX_AMMO,
        reloadAt: null,
        fireAt: 0,
        fireInput: false,
        altitudeInput: 0,
        refillAt: null,
        slowUntil: 0,
        phaseUntil: 0,
        stunUntil: 0,
        recoveryUntil: 0,
        stuns: 0,
        laneInput: 0,
        toggleCheat: false,
        cheatActive: false,
        immunityActive: false,
        boostActive: false,
        usedCheat: false,
        finishTimeMs: null
    }));
    const removedObjects = new Set();
    let projectiles = [];
    let nextProjectileId = 1;
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

        if (action === 'enableImmunity') {
            player.immunityActive = true;
            player.cheatActive = player.toggleCheat = false;
            player.usedCheat = true;
            player.slowUntil = player.phaseUntil = player.stunUntil = player.recoveryUntil = 0;
            player.shield = segments.get(player.segmentId).mode === 'flight' ? 100 : MAX_SHIELD;
            player.refillAt = null;
            return true;
        }
        if (action === 'boostEnd') { player.boostActive = false; return true; }
        if (action === 'boostStart' && player.immunityActive) { player.boostActive = true; return true; }

        if (action === "toggleCheat" && practice === true && !player.immunityActive && !player.toggleCheat) {
            player.toggleCheat = true;
            return true;
        }
        if (action === "fire" && !player.fireInput && player.ammo > 0 && elapsedMs >= player.fireAt &&
            elapsedMs >= player.stunUntil && elapsedMs >= player.phaseUntil) {
            player.fireInput = true;
            return true;
        }
        if ((action === "up" || action === "down") && !player.altitudeInput &&
            segments.get(player.segmentId).mode === "flight" &&
            segments.get(player.segmentId).flightPhase !== 'atmosphere' && elapsedMs >= player.stunUntil) {
            player.altitudeInput = action === "up" ? 1 : -1;
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
            player.fireInput = false;
            player.altitudeInput = 0;
            player.boostActive = false;
        }
        return true;
    }

    function planMovement(player, tickStartMs, slice) {
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
        if (player.reloadAt !== null && elapsedMs >= player.reloadAt) {
            player.ammo += 1;
            player.reloadAt = player.ammo < MAX_AMMO ? player.reloadAt + RELOAD_MS : null;
        }
        if (segments.get(player.segmentId).mode === "flight" && player.shield === 0 && elapsedMs >= player.stunUntil) {
            player.shield = 100;
        }
        if (!player.connected || tickStartMs < player.stunUntil) return null;

        const segment = segments.get(player.segmentId);
        const lane = Math.max(0, Math.min(segment.laneCount - 1, player.lane + player.laneInput));
        const changedLane = lane !== player.lane;
        player.lane = lane;
        player.laneInput = 0;
        const oldAltitude = player.altitude;
        player.altitude = segment.mode === "flight"
            ? segment.flightPhase === 'atmosphere' ? 1 : Math.max(0, Math.min(2, oldAltitude + player.altitudeInput)) : 0;
        player.altitudeInput = 0;
        if (player.fireInput) {
            player.fireInput = false;
            if (tickStartMs >= player.phaseUntil && tickStartMs >= player.fireAt && player.ammo > 0) {
                player.ammo -= 1;
                player.reloadAt ??= elapsedMs + RELOAD_MS;
                player.fireAt = elapsedMs + SHOT_COOLDOWN_MS;
                const shot = { id: `shot-${nextProjectileId++}`, playerId: player.id, segmentId: player.segmentId,
                    lane, altitude: player.altitude, distance: player.distance, remaining: SHOT_RANGE };
                projectiles.push(shot);
                events.push({ type: "shotFired", playerId: player.id, projectileId: shot.id });
            }
        }

        const distance = player.distance;
        let movement = movementStep / movementSlices;
        if (player.immunityActive) movement *= player.boostActive ? 1.5 : 1;
        else if (player.cheatActive) movement *= 2;
        else if (tickStartMs < player.slowUntil) movement /= 2;
        const nextDistance = distance + movement;
        // Each movement slice covers less than one cell.
        const row = changedLane || oldAltitude !== player.altitude ? Math.ceil(distance) : Math.floor(distance) + 1;
        let object = row <= nextDistance ? segment.objectsByCell.get(`${row}:${lane}:${segment.mode === "flight" ? player.altitude : 1}`) : undefined;
        // Moving hulls use their continuous lateral position at the exact row
        // crossing, including boosted movement and shots between server ticks.
        if (object?.motion) object = undefined;
        if (row <= nextDistance) {
            const at = tickStartMs + (slice + Math.max(0, (row - distance) / movement)) * TICK_MS / movementSlices;
            object ??= segment.traffic.find(hull => hull.distance === row && occupiesLane(hull, lane, at, segment.laneCount));
        }
        if (object && (removedObjects.has(object.id) || tickStartMs < player.phaseUntil ||
            (object.type !== "coin" && (player.immunityActive || player.cheatActive || tickStartMs < player.recoveryUntil)))) {
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
        const flight = segments.get(player.segmentId).mode === "flight";
        if (player.shield > 0) {
            player.shield = Math.max(0, player.shield - (flight ? (object.type === "crate" ? 10 : 25) : 1));
            player.refillAt = !flight && player.shield > 0 ? player.refillAt ?? elapsedMs + REFILL_MS : null;
        }
        const stunned = player.shield === 0;
        if (stunned) {
            player.stuns += 1;
            player.stunUntil = elapsedMs + (flight ? 2_500 : STUN_MS);
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
            const destination = segments.get(nextSegmentId);
            if (destination.mode === "flight" && segment.mode !== "flight") {
                player.altitude = 1;
                player.shield = 100;
                player.refillAt = null;
                player.phaseUntil = player.slowUntil = player.stunUntil = player.recoveryUntil = 0;
                player.ammo = MAX_AMMO;
                player.reloadAt = null;
                events.push({ type: "launched", playerId: player.id });
            } else if (destination.mode !== "flight") player.altitude = 0;
            if (segment.flightPhase === 'atmosphere' && destination.flightPhase === 'orbit') {
                player.altitude = 1;
                player.altitudeInput = 0;
                events.push({ type: 'orbitEntered', playerId: player.id });
            }
            if (destination.stage !== segment.stage) {
                events.push({ type: "stageChanged", playerId: player.id, stage: destination.stage });
            }
            return;
        }
        player.distance = segment.length;
        player.finishTimeMs = elapsedMs;
        firstFinishMs ??= elapsedMs;
        events.push({ type: "runnerFinished", playerId: player.id });
    }

    function advanceProjectiles() {
        projectiles = projectiles.filter(shot => {
            let travel = Math.min(SHOT_STEP, shot.remaining);
            let travelled = 0;
            shot.remaining -= travel;
            while (travel > 0) {
                const segment = segments.get(shot.segmentId);
                const end = Math.min(segment.length, shot.distance + travel);
                const target = segment.objects.filter(object => object.type !== "coin" &&
                    occupiesLane(object, shot.lane, elapsedMs - TICK_MS +
                        (travelled + object.distance - shot.distance) / SHOT_STEP * TICK_MS, segment.laneCount) &&
                    (segment.mode !== "flight" || (object.altitude ?? 1) === shot.altitude) &&
                    object.distance > shot.distance && object.distance <= end && !removedObjects.has(object.id))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (target) {
                    if (target.type === "crate") {
                        removedObjects.add(target.id);
                        events.push({ type: "crateBroken", playerId: shot.playerId, objectId: target.id, source: "shot" });
                    }
                    events.push({ type: "shotHit", playerId: shot.playerId, objectId: target.id, projectileId: shot.id });
                    return false;
                }
                travelled += end - shot.distance;
                travel -= end - shot.distance;
                shot.distance = end;
                if (end === segment.length) {
                    if (!segment.exits) return false;
                    const [nextId, nextLane] = segment.exits[shot.lane];
                    const next = segments.get(nextId);
                    if (next.stage !== segment.stage || (next.mode === "flight") !== (segment.mode === "flight")) return false;
                    shot.segmentId = nextId;
                    shot.lane = nextLane;
                    shot.distance = 0;
                }
            }
            return shot.remaining > 0;
        });
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
            mode: segment.mode === "flight" ? "flight" : "ground",
            altitude: player.altitude,
            lane: player.lane,
            distance: player.distance,
            progress: from + (to - from) * player.distance / segment.length,
            coins: player.coins,
            shield: player.shield,
            maxShield: segment.mode === "flight" ? 100 : MAX_SHIELD,
            ammo: player.ammo,
            maxAmmo: MAX_AMMO,
            ammoRefillMs: player.reloadAt === null ? null : Math.max(0, player.reloadAt - elapsedMs),
            shieldRefillMs: player.refillAt === null ? null : player.refillAt - elapsedMs,
            phaseRemainingMs: Math.max(0, player.phaseUntil - elapsedMs),
            stunRemainingMs,
            recoveryRemainingMs: stunRemainingMs ? 0 : Math.max(0, player.recoveryUntil - elapsedMs),
            stuns: player.stuns,
            finishTimeMs: player.finishTimeMs,
            finishBonus,
            score: player.coins + finishBonus,
            cheatActive: player.cheatActive,
            immunityActive: player.immunityActive,
            boostActive: player.boostActive,
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
            projectiles: projectiles.map(({ remaining, ...shot }) => ({ ...shot })),
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
        for (let slice = 0; slice < movementSlices; slice++) {
            const moves = players.map(player => planMovement(player, tickStartMs, slice)).filter(Boolean);
            // Shots clear breakable terrain before this tick's runner contacts.
            if (slice === 0) advanceProjectiles();
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
        }

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
