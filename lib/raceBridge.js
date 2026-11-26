'use strict';

// Adapter between a lobby room and the authoritative race engine.
//
// The engine lives in its own module (createRoomMatch from room-match.js, with
// TICK_MS from index.js). It is loaded lazily so the server still starts, and
// the room flow can still be exercised, while the engine is not present in this
// tree. When it is absent, a room reaches the racing phase but no snapshot is
// produced; the log says so once.

const socketRegistry = require('./socketRegistry');
const { isSignedIn } = require('./sessionGuard');
const { EVENTS } = require('./events');

const DEFAULT_TICK_MS = 50;
// The engine has been uploaded at the repository root and, in its own README,
// under a race/ folder; both layouts are tried.
const ENGINE_LOCATIONS = ['../', '../race/'];

const matches = new WeakMap();
let engine;
let engineResolved = false;

function loadEngine() {
  if (engineResolved) {
    return engine;
  }
  engineResolved = true;
  for (const prefix of ENGINE_LOCATIONS) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const roomMatch = require(`${prefix}room-match`);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const race = require(`${prefix}index`);
      engine = {
        createRoomMatch: roomMatch.createRoomMatch,
        tickMs: Number(race.TICK_MS) || DEFAULT_TICK_MS,
      };
      console.log(`[race] engine loaded from ${prefix}`);
      return engine;
    } catch (error) {
      // Try the next location.
    }
  }
  engine = null;
  console.log('[race] engine not installed; rooms stop at the racing phase without snapshots');
  return engine;
}

function isAvailable() {
  return Boolean(loadEngine());
}

// Sends the bootstrap payload to every connected member. Called when a race
// starts and when a player reconnects into a running room.
function attachAll(room, entry) {
  for (const member of room.members) {
    if (!member.connected) {
      continue;
    }
    for (const socket of socketRegistry.socketsOfAccount(member.account)) {
      const bootstrap = entry.match.attachSocket(socket);
      if (bootstrap) {
        socket.emit(EVENTS.raceBootstrap, bootstrap);
      }
    }
  }
}

function startMatch({ room, startedAt, onEnded }) {
  const loaded = loadEngine();
  if (!loaded) {
    return false;
  }

  const accounts = room.members.map((member) => member.account);
  const match = loaded.createRoomMatch({
    matchId: room.matchId,
    accounts,
    isSignedIn,
    practice: room.practice,
    manualTest: room.manualTest,
    hostAccount: room.host,
  });

  const entry = { match, startedAt, timer: null };
  matches.set(room, entry);
  attachAll(room, entry);

  entry.timer = setInterval(() => {
    const update = match.step((socket, payload) => socket.emit(EVENTS.raceUpdate, payload));
    if (update && update.snapshot && update.snapshot.status === 'ended') {
      stopMatch(room);
      if (typeof onEnded === 'function') {
        onEnded(update);
      }
    }
  }, loaded.tickMs);

  return true;
}

// Reconnects a single socket into the running match and returns its bootstrap
// payload, or null when no match is running.
function attachSocket(room, socket) {
  const entry = matches.get(room);
  if (!entry) {
    return null;
  }
  const bootstrap = entry.match.attachSocket(socket);
  if (bootstrap) {
    socket.emit(EVENTS.raceBootstrap, bootstrap);
  }
  return bootstrap;
}

function detachSocket(room, socket) {
  const entry = matches.get(room);
  if (!entry) {
    return false;
  }
  return entry.match.detachSocket(socket);
}

// Returns whether the engine accepted the action.
function handleInput(room, socket, payload) {
  const entry = matches.get(room);
  if (!entry) {
    return false;
  }
  return entry.match.acceptInput(socket, {
    matchId: payload && payload.matchId,
    action: payload && payload.action,
    controlSeat: payload && payload.controlSeat,
  });
}

function stopMatch(room) {
  const entry = matches.get(room);
  if (!entry) {
    return;
  }
  if (entry.timer) {
    clearInterval(entry.timer);
  }
  matches.delete(room);
}

module.exports = {
  isAvailable,
  startMatch,
  attachSocket,
  detachSocket,
  handleInput,
  stopMatch,
};
