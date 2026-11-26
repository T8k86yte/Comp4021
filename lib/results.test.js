'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildResults } = require('./results');

const snapshot = {
  status: 'ended',
  endReason: 'bothFinished',
  trackId: 'slums-prototype',
  elapsedMs: 41000,
  results: [
    {
      id: 'player1',
      name: 'player1',
      rank: 1,
      finishTimeMs: 40100,
      progress: 1,
      coins: 5,
      finishBonus: 6,
      score: 11,
      stuns: 1,
      usedCheat: false,
    },
    {
      id: 'player2',
      name: 'player2',
      rank: 2,
      finishTimeMs: null,
      progress: 0.82,
      coins: 2,
      finishBonus: 0,
      score: 2,
      stuns: 3,
      usedCheat: true,
    },
  ],
};

test('a finished runner keeps its rank, score and finish time', () => {
  const payload = buildResults({
    matchId: 'ABC123-m1',
    snapshot,
    practice: false,
    endedAt: 1700000000000,
  });

  assert.strictEqual(payload.matchId, 'ABC123-m1');
  assert.strictEqual(payload.practice, false);
  assert.strictEqual(payload.endReason, 'bothFinished');
  assert.strictEqual(payload.trackId, 'slums-prototype');
  assert.strictEqual(payload.raceDurationMs, 41000);

  const [first] = payload.results;
  assert.strictEqual(first.rank, 1);
  assert.strictEqual(first.account, 'player1');
  assert.strictEqual(first.finished, true);
  assert.strictEqual(first.finishTimeMs, 40100);
  assert.strictEqual(first.score, 11);
  assert.strictEqual(first.usedCheat, false);
});

test('a runner without a finish time is reported as not finished', () => {
  const payload = buildResults({ matchId: 'ABC123-m1', snapshot, endedAt: 1 });
  const second = payload.results[1];

  assert.strictEqual(second.finished, false);
  assert.strictEqual(second.finishTimeMs, null);
  assert.strictEqual(second.progress, 0.82);
  assert.strictEqual(second.usedCheat, true);
});

test('practice is reported as a boolean even when omitted', () => {
  const payload = buildResults({ matchId: 'ABC123-m1', snapshot, endedAt: 1 });
  assert.strictEqual(payload.practice, false);
});

test('a field the engine adds later is passed through unchanged', () => {
  const extended = {
    ...snapshot,
    results: [{ ...snapshot.results[0], ammo: 4, immunityActive: true }],
  };
  const payload = buildResults({ matchId: 'ABC123-m1', snapshot: extended, endedAt: 1 });

  assert.strictEqual(payload.results[0].ammo, 4);
  assert.strictEqual(payload.results[0].immunityActive, true);
  assert.strictEqual(payload.results[0].account, 'player1');
});

test('a missing or unfinished snapshot yields an empty list', () => {
  const payload = buildResults({ matchId: 'ABC123-m1', endedAt: 1 });

  assert.deepStrictEqual(payload.results, []);
  assert.strictEqual(payload.endReason, null);
  assert.strictEqual(payload.raceDurationMs, 0);
});
