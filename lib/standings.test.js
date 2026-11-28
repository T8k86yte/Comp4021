'use strict';

const test = require('node:test');
const assert = require('node:assert');

const standings = require('./standings');

const race = (account, rank, score, coins) => ({ account, rank, score, coins });

test.beforeEach(() => standings.reset());

test('a finished race adds to every account it names', () => {
  standings.record({
    practice: false,
    endedAt: 1000,
    results: [race('player1', 1, 12, 6), race('player2', 2, 4, 4)],
  });

  const first = standings.entryOf('player1');
  assert.strictEqual(first.races, 1);
  assert.strictEqual(first.wins, 1);
  assert.strictEqual(first.totalScore, 12);
  assert.strictEqual(first.bestRank, 1);
  assert.strictEqual(standings.entryOf('player2').wins, 0);
});

test('totals accumulate across races and keep the best result', () => {
  standings.record({ practice: false, results: [race('player1', 2, 5, 5)] });
  standings.record({ practice: false, results: [race('player1', 1, 9, 4)] });

  const entry = standings.entryOf('player1');
  assert.strictEqual(entry.races, 2);
  assert.strictEqual(entry.wins, 1);
  assert.strictEqual(entry.totalScore, 14);
  assert.strictEqual(entry.bestScore, 9);
  assert.strictEqual(entry.bestRank, 1);
  assert.strictEqual(entry.coins, 9);
});

test('practice rooms are left out of the totals', () => {
  standings.record({ practice: true, results: [race('player1', 1, 30, 30)] });

  assert.strictEqual(standings.entryOf('player1'), null);
  assert.deepStrictEqual(standings.list(), []);
});

test('the list is ordered by total score, then wins, and is numbered', () => {
  standings.record({
    practice: false,
    results: [race('player1', 2, 8, 2), race('player2', 1, 8, 3), race('player3', 1, 3, 3)],
  });

  const list = standings.list();
  assert.deepStrictEqual(list.map((entry) => entry.account), ['player2', 'player1', 'player3']);
  assert.deepStrictEqual(list.map((entry) => entry.position), [1, 2, 3]);
});

test('a missing or malformed result is ignored instead of throwing', () => {
  standings.record({ practice: false, results: [null, { rank: 1 }, race('player1', 1, 2, 2)] });

  assert.strictEqual(standings.list().length, 1);
  standings.record({ practice: false });
  assert.strictEqual(standings.list().length, 1);
});
