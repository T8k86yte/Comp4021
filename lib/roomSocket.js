'use strict';

// Socket.IO handlers for the lobby: create, join, leave, ready, and the input
// uplink once a race is running. Every refusal carries a code and a message the
// page can show.

const rooms = require('./rooms');
const raceBridge = require('./raceBridge');
const socketRegistry = require('./socketRegistry');
const { EVENTS } = require('./events');

// Calls the acknowledgement callback when the client sent one, otherwise emits
// the error to the same socket.
function reply(socket, acknowledge, result) {
  if (typeof acknowledge === 'function') {
    return acknowledge(result.ok ? { ok: true } : result);
  }
  if (!result.ok) {
    socket.emit(EVENTS.roomError, result.error);
  }
  return undefined;
}

function registerRoomHandlers(io) {
  io.on('connection', (socket) => {
    const account = socket.data.account;

    // One account holds one seat, so a newer connection replaces any socket of
    // the same account that was still open.
    const replaced = socketRegistry.disconnectOthers(account, socket);
    if (replaced > 0) {
      console.log(`[room] replaced ${replaced} older socket(s) of account=${account}`);
    }

    const room = rooms.roomOf(account);

    // A reconnecting client returns to its seat: the room is marked connected
    // again, and a running race sends the current state as a bootstrap.
    if (room) {
      rooms.setConnected(account, true);
      if (room.phase === 'racing') {
        raceBridge.attachSocket(room, socket);
      }
    }

    socket.on(EVENTS.createRoom, (payload, acknowledge) => {
      const result = rooms.createRoom(account, {
        practice: payload && payload.practice === true,
        manualTest: payload && payload.manualTest === true,
      });
      reply(socket, acknowledge, result);
    });

    socket.on(EVENTS.joinRoom, (payload, acknowledge) => {
      const result = rooms.joinRoom(account, payload && payload.code);
      reply(socket, acknowledge, result);
      if (result.ok && result.alreadyMember) {
        socket.emit(EVENTS.roomState, rooms.snapshot(result.room));
      }
    });

    socket.on(EVENTS.leaveRoom, (payload, acknowledge) => {
      reply(socket, acknowledge, rooms.leaveRoom(account, 'leave'));
    });

    socket.on(EVENTS.setReady, (payload, acknowledge) => {
      const value = payload && typeof payload.ready === 'boolean' ? payload.ready : true;
      reply(socket, acknowledge, rooms.setReady(account, value));
    });

    socket.on(EVENTS.raceInput, (payload) => {
      const current = rooms.roomOf(account);
      if (current) {
        raceBridge.handleInput(current, socket, payload);
      }
    });

    socket.on('disconnect', () => {
      const current = rooms.roomOf(account);
      if (!current) {
        return;
      }
      if (current.phase === 'racing') {
        raceBridge.detachSocket(current, socket);
      }
      // Another socket of the same account may still be alive; the seat counts
      // as connected while at least one remains.
      const remaining = socketRegistry
        .socketsOfAccount(account)
        .filter((entry) => entry.id !== socket.id);
      console.log(`[room] socket gone account=${account} phase=${current.phase} remaining=${remaining.length}`);
      rooms.setConnected(account, remaining.length > 0);
    });
  });
}

module.exports = { registerRoomHandlers };
