'use strict';

// Lookup of live Socket.IO connections by account. Account routes use it to end
// the sockets of an account that signs out, and room handling will use it to
// find the seat of a player who leaves.

let io = null;

// Called once at startup with the Socket.IO server instance.
function attach(server) {
  io = server;
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
  disconnectAccount,
};
