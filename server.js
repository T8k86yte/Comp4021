'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

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

httpServer.listen(PORT, () => {
  console.log(`Edgerunner server listening on http://localhost:${PORT}`);
});
