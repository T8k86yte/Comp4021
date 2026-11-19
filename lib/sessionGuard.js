'use strict';

// One account holds one session at a time (UC-02). The account store records
// the identifier of that session; any other session carrying the same account
// name is stale from the moment the newer sign in is recorded.

const accountStore = require('./accountStore');

const COOKIE_NAME = 'connect.sid';

// True only for a session that carries an account and whose identifier is still
// the one recorded in the account store.
function isSignedIn(session) {
  if (!session || !session.account || !session.id) {
    return false;
  }
  return accountStore.isSessionCurrent(session.account, session.id);
}

/**
 * Express middleware: drops a session that has been taken over by a newer sign
 * in. API requests are told why; page requests continue without a session.
 */
function enforceSingleSession(request, response, next) {
  const session = request.session;
  if (!session || !session.account || isSignedIn(session)) {
    return next();
  }

  const account = session.account;
  return session.destroy((error) => {
    if (error) {
      return next(error);
    }
    response.clearCookie(COOKIE_NAME);
    console.log(`[auth] dropped stale session account=${account}`);
    if (request.path.startsWith('/api/')) {
      return response.status(401).json({
        ok: false,
        errors: [{
          field: null,
          code: 'session_terminated',
          message: 'This account signed in somewhere else, so this session has ended. Sign in again to continue.',
        }],
      });
    }
    return next();
  });
}

module.exports = {
  COOKIE_NAME,
  isSignedIn,
  enforceSingleSession,
};
