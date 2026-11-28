'use strict';

// Overall ranking across races.
//
// The totals live in server memory, so they last as long as the process and
// restart from zero. One entry per account is kept, updated once per finished
// race. Practice rooms are excluded, because the speed cheat is allowed there
// and a practice result would not be comparable with a normal one.

const MAX_ENTRIES = 100;

const totals = new Map();

function emptyEntry(account) {
  return {
    account,
    races: 0,
    wins: 0,
    totalScore: 0,
    bestScore: 0,
    bestRank: null,
    coins: 0,
    lastRacedAt: null,
  };
}

function copy(entry) {
  return { ...entry };
}

// Adds one finished race to the totals. Returns the entries it changed.
function record({ results, practice, endedAt }) {
  if (practice === true || !Array.isArray(results)) {
    return [];
  }

  const changed = [];
  for (const result of results) {
    if (!result || typeof result.account !== 'string' || !result.account) {
      continue;
    }
    const entry = totals.get(result.account) || emptyEntry(result.account);
    const score = Number(result.score) || 0;

    entry.races += 1;
    if (result.rank === 1) {
      entry.wins += 1;
    }
    entry.totalScore += score;
    entry.bestScore = Math.max(entry.bestScore, score);
    entry.bestRank = entry.bestRank === null || result.rank < entry.bestRank
      ? result.rank
      : entry.bestRank;
    entry.coins += Number(result.coins) || 0;
    entry.lastRacedAt = endedAt || null;

    totals.set(result.account, entry);
    changed.push(copy(entry));
  }
  return changed;
}

// Highest total score first; wins break a tie, then the name for a stable order.
function list(limit = 20) {
  const size = Math.max(1, Math.min(MAX_ENTRIES, Number(limit) || 20));
  return [...totals.values()]
    .map(copy)
    .sort((a, b) => b.totalScore - a.totalScore
      || b.wins - a.wins
      || a.account.localeCompare(b.account))
    .slice(0, size)
    .map((entry, index) => ({ position: index + 1, ...entry }));
}

function entryOf(account) {
  const entry = totals.get(account);
  return entry ? copy(entry) : null;
}

function reset() {
  totals.clear();
}

module.exports = {
  record,
  list,
  entryOf,
  reset,
  MAX_ENTRIES,
};
