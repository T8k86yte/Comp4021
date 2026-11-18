'use strict';

// HTTP routes for account handling. Mounted at /api by server.js.
// UC-01 (register) lives here; sign in and sign out will join it later.

const express = require('express');
const bcrypt = require('bcryptjs');
const accountStore = require('../lib/accountStore');
const { MESSAGES, validateRegistration } = require('../lib/validation');

const BCRYPT_ROUNDS = 10;

const router = express.Router();

function sendErrors(response, status, errors) {
  return response.status(status).json({ ok: false, errors });
}

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

      // A brand new session id is issued before the account name is stored, so
      // a session id that existed before registration cannot be reused as the
      // signed-in session.
      return request.session.regenerate((regenerateError) => {
        if (regenerateError) {
          return next(regenerateError);
        }
        request.session.account = account.username;
        return request.session.save((saveError) => {
          if (saveError) {
            return next(saveError);
          }
          console.log(`[auth] registered account=${account.username}`);
          return response.status(201).json({
            ok: true,
            account: { username: account.username },
            redirect: '/lobby.html',
          });
        });
      });
    })
    .catch(next);
});

module.exports = router;
