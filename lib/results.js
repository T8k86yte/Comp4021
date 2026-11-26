'use strict';

// Turns the race engine's final standings into the payload the results page
// renders.
//
// The engine already produces one entry per seat in rank order
// (`race/index.js`, the `results` field of a snapshot whose status is `ended`).
// This module only renames and normalises that list for the page, so the page
// never has to know which engine version produced a match.
//
// The page-side field list is not agreed with the gameplay owner yet, so the
// conversion adds fields instead of dropping any: every engine field survives
// under its own name or under a documented alias.

// A runner without a finish time did not finish, rather than finishing in zero
// milliseconds. The engine uses null for that case.
function toEntry(runner) {
  const finishTimeMs = typeof runner.finishTimeMs === 'number' ? runner.finishTimeMs : null;
  return {
    // Every field the engine reports is kept, including ones added later. The
    // names below are the ones the page reads.
    ...runner,
    account: runner.id,
    name: runner.name || runner.id,
    finished: finishTimeMs !== null,
    finishTimeMs,
    usedCheat: runner.usedCheat === true,
  };
}

// Returns the results payload for one finished match. `snapshot` is the last
// snapshot the engine produced, so a missing or unfinished snapshot yields an
// empty list instead of throwing.
function buildResults({ matchId, snapshot, practice, endedAt }) {
  const standings = snapshot && Array.isArray(snapshot.results) ? snapshot.results : [];
  return {
    matchId,
    endedAt,
    practice: practice === true,
    endReason: (snapshot && snapshot.endReason) || null,
    trackId: (snapshot && snapshot.trackId) || null,
    raceDurationMs: (snapshot && Number(snapshot.elapsedMs)) || 0,
    results: standings.map(toEntry),
  };
}

module.exports = { buildResults };
