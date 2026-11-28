'use strict';

// HTTP route for the overall ranking. Mounted at /api/standings by server.js.

const express = require('express');
const standings = require('../lib/standings');

const router = express.Router();

// GET /api/standings?limit=20
// The ranking is public: it holds account names and race totals only, which the
// results page already shows to both players.
router.get('/', (request, response) => {
  const limit = Number(request.query.limit) || 20;
  return response.json({
    ok: true,
    standings: standings.list(limit),
    scope: {
      practiceExcluded: true,
      storage: 'memory',
      order: 'total score, then wins',
    },
  });
});

module.exports = router;
