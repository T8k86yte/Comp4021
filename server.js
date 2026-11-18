'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');
const accountStore = require('./lib/accountStore');
const authRoutes = require('./routes/auth');

const PORT = Number(process.env.PORT) || 8000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-before-deploy';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SEVEN_DAYS_MS,
  },
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);

// Every route answers in JSON, so unexpected failures do the same instead of
// returning the default HTML error page.
// eslint-disable-next-line no-unused-vars
app.use((error, request, response, next) => {
  console.error('[server] request failed', error);
  if (response.headersSent) {
    return;
  }
  // Body parsers report their own client errors, such as a malformed JSON body.
  const status = Number(error.status || error.statusCode) || 500;
  if (status < 500) {
    return response.status(status).json({
      ok: false,
      errors: [{ field: null, code: 'invalid_body', message: 'The request body could not be read.' }],
    });
  }
  return response.status(500).json({
    ok: false,
    errors: [{ field: null, code: 'server_error', message: 'The server could not handle the request.' }],
  });
});

// The same session instance is used for HTTP requests and for the Socket.IO
// handshake, so a socket can be identified by account instead of by socket id.
io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  const account = socket.request.session && socket.request.session.account;
  console.log(`[socket] connected id=${socket.id} account=${account || 'anonymous'}`);

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected id=${socket.id} reason=${reason}`);
  });
});

// The account store is loaded (or seeded) before the port is opened, so no
// registration can arrive while the store is still empty.
accountStore.init()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Edgerunner server listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('[startup] failed to initialise the account store', error);
    process.exit(1);
  });
