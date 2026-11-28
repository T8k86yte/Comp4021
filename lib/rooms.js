'use strict';

// Lobby rooms: creation, joining, ready flags, the three-second countdown and
// the hand-over to the race engine. Everything is kept in memory; a room exists
// only while a server process holds it.
//
// Membership is keyed by account rather than by socket, so a reconnecting
// client returns to the same seat.

const crypto = require('crypto');

const raceBridge = require('./raceBridge');
const socketRegistry = require('./socketRegistry');
const standings = require('./standings');
const { buildResults } = require('./results');
const { EVENTS } = require('./events');

const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CAPACITY = 2;
const COUNTDOWN_MS = 3000;
// Both players disconnected: the room is dropped after this idle period. The
// value is a proposal from the specification and is not settled yet.
const IDLE_TIMEOUT_MS = 30_000;

const rooms = new Map();
const roomByAccount = new Map();

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function makeMember(account) {
  return { account, ready: false, connected: true };
}

function generateCode() {
  let code;
  do {
    code = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

// Room codes are compared without regard to case; the stored form is uppercase.
function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function roomOf(account) {
  return roomByAccount.get(account) || null;
}

function memberOf(room, account) {
  return room.members.find((member) => member.account === account) || null;
}

function snapshot(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    practice: room.practice,
    manualTest: room.manualTest,
    matchId: room.matchId,
    countdownEndsAt: room.countdownEndsAt,
    members: room.members.map((member) => ({
      account: member.account,
      host: member.account === room.host,
      ready: member.ready,
      connected: member.connected,
    })),
    // Set when the engine ends the race, so a page that loads or reconnects
    // after the race can still render the results.
    endedAt: room.endedAt,
    results: room.results,
    // Accounts that asked for another race since the current one ended.
    rematch: { votes: room.rematchVotes.slice() },
  };
}

function broadcast(room) {
  const payload = snapshot(room);
  for (const member of room.members) {
    socketRegistry.emitToAccount(member.account, EVENTS.roomState, payload);
  }
}

function clearIdleTimer(room) {
  if (room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }
}

function destroyRoom(room) {
  clearIdleTimer(room);
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  raceBridge.stopMatch(room);
  rooms.delete(room.code);
  for (const member of room.members) {
    roomByAccount.delete(member.account);
  }
  room.members = [];
  room.phase = 'closed';
  console.log(`[room] closed code=${room.code}`);
}

function scheduleIdleCleanup(room) {
  clearIdleTimer(room);
  if (room.members.some((member) => member.connected)) {
    return;
  }
  room.idleTimer = setTimeout(() => {
    room.idleTimer = null;
    if (!room.members.some((member) => member.connected)) {
      destroyRoom(room);
    }
  }, IDLE_TIMEOUT_MS);
}

function resetReady(room) {
  for (const member of room.members) {
    member.ready = false;
  }
}

function cancelCountdown(room) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.countdownEndsAt = null;
  if (room.phase === 'countdown') {
    room.phase = 'waiting';
  }
}

function nextMatchId(room) {
  return `${room.code}-${Date.now().toString(36)}`;
}

// Called by the race bridge when the engine reports an ended match. The final
// standings are kept on the room, broadcast as room state for a page that
// arrives later, and sent once to both seats as their own event.
function finishRoom(room, update) {
  room.phase = 'finished';
  room.endedAt = Date.now();
  room.results = buildResults({
    matchId: room.matchId,
    snapshot: update && update.snapshot,
    practice: room.practice,
    endedAt: room.endedAt,
  });

  // The overall ranking counts finished races outside practice rooms only.
  standings.record({
    results: room.results.results,
    practice: room.practice,
    endedAt: room.endedAt,
  });

  broadcast(room);
  for (const member of room.members) {
    socketRegistry.emitToAccount(member.account, EVENTS.raceResults, room.results);
  }
  console.log(`[room] finished code=${room.code} match=${room.matchId} reason=${room.results.endReason}`);
}

// Puts a finished room back to the state it had before the countdown, so the
// same two accounts can race again without creating a new room.
function resetForRematch(room) {
  raceBridge.stopMatch(room);
  resetReady(room);
  room.phase = 'waiting';
  room.matchId = null;
  room.endedAt = null;
  room.results = null;
  room.countdownEndsAt = null;
  room.rematchVotes = [];
  console.log(`[room] rematch code=${room.code}`);
  broadcast(room);
}

// One seat asks for another race. The room restarts only when every member has
// asked, so one player cannot start a race the other one does not want.
function requestRematch(account) {
  const room = roomOf(account);
  if (!room) {
    return failure('not_in_room', 'You are not in a room.');
  }
  if (room.phase !== 'finished') {
    return failure('rematch_unavailable', 'Another race can be requested once the current one has ended.');
  }
  if (room.members.length < ROOM_CAPACITY) {
    return failure('waiting_for_opponent', 'A second player is needed for another race.');
  }

  if (!room.rematchVotes.includes(account)) {
    room.rematchVotes.push(account);
  }

  const everyone = room.members.every((member) => room.rematchVotes.includes(member.account));
  if (everyone) {
    resetForRematch(room);
    return { ok: true, room, restarted: true };
  }

  broadcast(room);
  return { ok: true, room, restarted: false };
}

function finishCountdown(room, startedAt) {
  room.countdownTimer = null;
  room.countdownEndsAt = null;
  room.phase = 'racing';
  room.matchId = nextMatchId(room);
  // A new match replaces the standings of the previous one.
  room.endedAt = null;
  room.results = null;
  resetReady(room);

  const startTime = startedAt || Date.now();
  // The engine, when present, builds the initial state and starts its tick.
  // Without it the room still enters the racing phase, and the clients receive
  // the start message without snapshots.
  raceBridge.startMatch({
    room,
    startedAt: startTime,
    onEnded: (update) => finishRoom(room, update),
  });

  broadcast(room);
  const startPayload = {
    matchId: room.matchId,
    startedAt: startTime,
    practice: room.practice,
  };
  for (const member of room.members) {
    socketRegistry.emitToAccount(member.account, EVENTS.raceStart, startPayload);
  }
  console.log(`[room] started code=${room.code} match=${room.matchId} engine=${raceBridge.isAvailable()}`);
}

function startCountdown(room) {
  room.phase = 'countdown';
  room.countdownEndsAt = Date.now() + COUNTDOWN_MS;
  room.countdownTimer = setTimeout(() => finishCountdown(room), COUNTDOWN_MS);
  console.log(`[room] countdown code=${room.code}`);
}

function createRoom(account, options = {}) {
  const previous = roomOf(account);
  if (previous) {
    // The player may hold one room only, so the old one is left first.
    leaveRoom(account, 'create');
  }

  const room = {
    code: generateCode(),
    host: account,
    phase: 'waiting',
    practice: options.practice === true,
    manualTest: options.manualTest === true,
    matchId: null,
    endedAt: null,
    results: null,
    countdownEndsAt: null,
    countdownTimer: null,
    idleTimer: null,
    rematchVotes: [],
    members: [makeMember(account)],
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  roomByAccount.set(account, room);
  console.log(`[room] created code=${room.code} host=${account}`);
  broadcast(room);
  return { ok: true, room };
}

function joinRoom(account, rawCode) {
  const code = normalizeCode(rawCode);
  const room = rooms.get(code);
  if (!room) {
    return failure('room_not_found', 'No room uses that code.');
  }
  if (memberOf(room, account)) {
    // Joining the room the player already sits in just shows it again.
    return { ok: true, room, alreadyMember: true };
  }
  if (room.members.length >= ROOM_CAPACITY) {
    return failure('room_full', 'That room already holds two players.');
  }
  if (room.phase !== 'waiting') {
    return failure('room_already_started', 'That race has already started.');
  }

  const previous = roomOf(account);
  if (previous) {
    leaveRoom(account, 'join');
  }

  room.members.push(makeMember(account));
  roomByAccount.set(account, room);
  // A new member invalidates the ready flags and rematch votes agreed by the
  // previous pair.
  resetReady(room);
  room.rematchVotes = [];
  console.log(`[room] joined code=${room.code} account=${account}`);
  broadcast(room);
  return { ok: true, room };
}

function leaveRoom(account, reason = 'leave') {
  const room = roomOf(account);
  if (!room) {
    return { ok: true, room: null };
  }

  const member = memberOf(room, account);
  if (member) {
    room.members.splice(room.members.indexOf(member), 1);
  }
  roomByAccount.delete(account);

  // A member leaving during the countdown stops it: the race cannot start with
  // a missing player.
  if (room.phase === 'countdown') {
    cancelCountdown(room);
  }
  resetReady(room);
  room.rematchVotes = [];

  if (room.members.length === 0) {
    destroyRoom(room);
    return { ok: true, room: null, closed: true };
  }

  if (room.host === account) {
    // The remaining member hosts the room instead of losing it.
    room.host = room.members[0].account;
  }
  console.log(`[room] left code=${room.code} account=${account} reason=${reason}`);
  broadcast(room);
  return { ok: true, room };
}

function setReady(account, ready) {
  const room = roomOf(account);
  if (!room) {
    return failure('not_in_room', 'You are not in a room.');
  }
  if (room.phase !== 'waiting') {
    return failure('ready_locked', 'Ready is disabled once the countdown has started.');
  }
  if (room.members.length < ROOM_CAPACITY) {
    return failure('waiting_for_opponent', 'A second player has to join before the race can start.');
  }

  const member = memberOf(room, account);
  member.ready = Boolean(ready);
  broadcast(room);

  if (room.members.every((entry) => entry.ready)) {
    startCountdown(room);
    broadcast(room);
  }
  return { ok: true, room };
}

// Marks a seat connected or disconnected. Returns the room the account sits in,
// or null.
function setConnected(account, connected) {
  const room = roomOf(account);
  if (!room) {
    return null;
  }
  const member = memberOf(room, account);
  if (!member) {
    return null;
  }

  member.connected = Boolean(connected);
  if (!member.connected) {
    // A disconnected player cannot stay ready; the room waits for them.
    member.ready = false;
    scheduleIdleCleanup(room);
  } else {
    clearIdleTimer(room);
  }
  broadcast(room);
  return room;
}

function listRooms() {
  return [...rooms.values()];
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  setReady,
  requestRematch,
  setConnected,
  roomOf,
  snapshot,
  listRooms,
  COUNTDOWN_MS,
  IDLE_TIMEOUT_MS,
  ROOM_CAPACITY,
};
