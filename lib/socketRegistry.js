'use strict';

// Lookup of live Socket.IO connections by account. Account routes use it to end
// the sockets of an account that signs out, and room handling will use it to
// find the seat of a player who leaves.

let io = null;

// Called once at startup with the Socket.IO server instance.
function attach(server) {
  io = server;
}

// All live sockets of an account. Usually zero or one, because a new sign in
// drops the sockets of the older session.
function socketsOfAccount(account) {
  if (!io || !account) {
    return [];
  }
  const found = [];
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.account === account) {
      found.push(socket);
    }
  }
  return found;
}

// Sends one event to every live socket of an account.
function emitToAccount(account, event, payload) {
  for (const socket of socketsOfAccount(account)) {
    socket.emit(event, payload);
  }
}

// Closes the other sockets of an account, keeping the one passed in. An account
// holds one seat, so a newer connection takes over from an older one that was
// left open, for example a second tab or a connection the server never saw
// close. Returns how many were closed.
function disconnectOthers(account, keepSocket) {
  let closed = 0;
  for (const socket of socketsOfAccount(account)) {
    if (socket.id !== keepSocket.id) {
      socket.disconnect(true);
      closed += 1;
    }
  }
  return closed;
}

// Closes every socket that was opened by the given account and returns how many
// were closed. Sockets carry the account resolved at handshake, so this needs
// no input from the client.
function disconnectAccount(account) {
  if (!io || !account) {
    return 0;
  }
  let closed = 0;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.account === account) {
      socket.disconnect(true);
      closed += 1;
    }
  }
  return closed;
}

module.exports = {
  attach,
  socketsOfAccount,
  emitToAccount,
  disconnectOthers,
  disconnectAccount,
};
