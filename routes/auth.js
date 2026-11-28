'use strict';

// HTTP routes for account handling. Mounted at /api by server.js.
// UC-01 (register), UC-02 (sign in) and UC-03 (sign out) live here.

const express = require('express');
const bcrypt = require('bcryptjs');
const accountStore = require('../lib/accountStore');
const { COOKIE_NAME, isSignedIn } = require('../lib/sessionGuard');
const socketRegistry = require('../lib/socketRegistry');
const rooms = require('../lib/rooms');
const { MESSAGES, validateLogin, validateRegistration } = require('../lib/validation');

const BCRYPT_ROUNDS = 10;

// Compared against when the username does not exist, so a failed sign in spends
// roughly the same time either way and the response does not hint at which of
// the two conditions failed (UC-02 A1).
const DUMMY_HASH = bcrypt.hashSync('placeholder-for-timing-only', BCRYPT_ROUNDS);

const router = express.Router();

function sendErrors(response, status, errors) {
  return response.status(status).json({ ok: false, errors });
}

function signedInPayload(account, extra = {}) {
  return {
    ok: true,
    account: { username: account.username },
    redirect: '/lobby.html',
    ...extra,
  };
}

// Starts a fresh session for the account and records its identifier as the only
// valid one for that account, which ends any session held elsewhere (UC-02
// step 6). The callback receives an error or nothing.
function startSession(request, username, done) {
  request.session.regenerate((regenerateError) => {
    if (regenerateError) {
      return done(regenerateError);
    }
    request.session.account = username;
    accountStore.setSessionId(username, request.session.id);
    return request.session.save((saveError) => done(saveError || null));
  });
}

// GET /api/session
// Tells the page whether a valid session exists, so the sign-in form can be
// skipped (UC-02 A3).
router.get('/session', (request, response) => {
  const signedIn = isSignedIn(request.session);
  return response.json({
    ok: true,
    signedIn,
    account: signedIn ? { username: request.session.account } : null,
  });
});

// POST /api/register
// Body: username, password, confirmPassword (JSON or form encoded).
// 201 on success, together with the session that signed the new account in.
// 400 with a list of { field, code, message } when the input is rejected.
router.post('/register', (request, response, next) => {
  if (request.session && request.session.account) {
    return sendErrors(response, 409, [{
      field: null,
      code: 'already_signed_in',
      message: `Already signed in as ${request.session.account}.`,
    }]);
  }

  const body = request.body || {};
  const result = validateRegistration(
    {
      username: body.username,
      password: body.password,
      confirmPassword: body.confirmPassword,
    },
    { isUsernameTaken: accountStore.isUsernameTaken },
  );

  if (!result.valid) {
    return sendErrors(response, 400, result.errors);
  }

  // Hashing is asynchronous so the request does not block the event loop.
  // Nothing is written to the store before every check has passed, which keeps
  // the store unchanged when validation fails.
  return bcrypt.hash(body.password, BCRYPT_ROUNDS)
    .then((passwordHash) => {
      const account = accountStore.createAccount({
        username: result.username,
        passwordHash,
      });

      // Lost a race against another registration for the same name.
      if (!account) {
        return sendErrors(response, 400, [{
          field: 'username',
          code: 'username_taken',
          message: MESSAGES.usernameTaken,
        }]);
      }

      return startSession(request, account.username, (error) => {
        if (error) {
          return next(error);
        }
        console.log(`[auth] registered account=${account.username}`);
        return response.status(201).json(signedInPayload(account));
      });
    })
    .catch(next);
});

// POST /api/login
// Body: username, password (JSON or form encoded).
// 200 on success with the session that signed the account in.
// 400 with a list of { field, code, message } when the input is rejected.
// A1: a missing account and a wrong password share one message.
router.post('/login', (request, response, next) => {
  // A3: an existing valid session skips the form.
  if (isSignedIn(request.session)) {
    const account = accountStore.findByUsername(request.session.account);
    if (account) {
      return response.json(signedInPayload(account, { alreadySignedIn: true }));
    }
  }

  const body = request.body || {};
  const result = validateLogin({ username: body.username, password: body.password });

  if (!result.valid) {
    return sendErrors(response, 400, result.errors);
  }

  const account = accountStore.findByUsername(result.username);
  const passwordHash = account ? account.passwordHash : DUMMY_HASH;

  return bcrypt.compare(result.password, passwordHash)
    .then((matches) => {
      if (!account || !matches) {
        return sendErrors(response, 400, [{
          field: null,
          code: 'invalid_credentials',
          message: MESSAGES.invalidCredentials,
        }]);
      }

      return startSession(request, account.username, (error) => {
        if (error) {
          return next(error);
        }
        // Any session this account held elsewhere is over from here on, so its
        // seat is released and its sockets are closed. Without this the account
        // would keep a seat that no session can act for (UC-02 step 6).
        const left = rooms.leaveRoom(account.username, 'takeover');
        const closed = socketRegistry.disconnectAccount(account.username);
        console.log(
          `[auth] signed in account=${account.username} sockets=${closed} room=${left.room ? left.room.code : 'none'}`,
        );
        return response.json(signedInPayload(account));
      });
    })
    .catch(next);
});

// POST /api/logout
// Ends the current session, clears the cookie and closes the sockets of the
// account, so the account holds neither a session nor a seat (UC-03).
// Answers the same way when there is nothing to end, so the page can always
// call it.
router.post('/logout', (request, response, next) => {
  const session = request.session;
  const account = session && session.account && isSignedIn(session) ? session.account : null;

  if (!account) {
    response.clearCookie(COOKIE_NAME);
    return response.json({ ok: true, signedIn: false, redirect: '/' });
  }

  const sessionId = session.id;
  return session.destroy((error) => {
    if (error) {
      return next(error);
    }
    accountStore.clearSessionId(account, sessionId);
    response.clearCookie(COOKIE_NAME);
    // The seat is released before the sockets close, so the other player sees a
    // room without this account instead of a seat that only turned stale
    // (UC-03 step 5). leaveRoom broadcasts to the remaining members itself.
    const left = rooms.leaveRoom(account, 'signout');
    const closed = socketRegistry.disconnectAccount(account);
    console.log(
      `[auth] signed out account=${account} sockets=${closed} room=${left.room ? left.room.code : 'none'}`,
    );
    return response.json({ ok: true, signedIn: false, redirect: '/' });
  });
});

module.exports = router;
