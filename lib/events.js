'use strict';

// Event names exchanged over Socket.IO. Client to server names are listened for
// in lib/roomSocket.js; server to client names are emitted from there and from
// lib/raceBridge.js. Both pages and the server import this object, so a rename
// happens in one place.

const EVENTS = {
  // Client to server.
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  setReady: 'room:ready',
  raceInput: 'race:input',

  // Server to client.
  roomState: 'room:state',
  roomError: 'room:error',
  raceStart: 'race:start',
  raceBootstrap: 'race:bootstrap',
  raceUpdate: 'race:update',
};

module.exports = { EVENTS };
