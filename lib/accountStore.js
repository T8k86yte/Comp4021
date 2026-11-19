'use strict';

// Account store backed by data/accounts.json.
// The file is small, so the whole list is kept in memory and rewritten on every
// change. Each write goes to a temporary file that is then renamed, so a crash
// during a write cannot leave a half-written store behind.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'accounts.json');
const BCRYPT_ROUNDS = 10;

// Inserted only when the store file does not exist yet, so a fresh clone can be
// played without registering first. The plaintext passwords are listed in README.md.
const SEED_ACCOUNTS = [
  { username: 'player1', password: 'player1pass' },
  { username: 'player2', password: 'player2pass' },
];

let accounts = [];

// Usernames are compared without regard to case, so Player1 and player1 are the
// same account. The original spelling is kept for display.
function normalize(username) {
  return String(username).trim().toLowerCase();
}

function persist() {
  const payload = { version: 1, accounts };
  const temporaryFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, STORE_FILE);
}

function load() {
  const raw = fs.readFileSync(STORE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.accounts)) {
    throw new Error(`${STORE_FILE} is not a valid account store`);
  }
  accounts = parsed.accounts;
}

async function seed() {
  const seeded = [];
  for (const entry of SEED_ACCOUNTS) {
    seeded.push({
      username: entry.username,
      passwordHash: await bcrypt.hash(entry.password, BCRYPT_ROUNDS),
      createdAt: new Date().toISOString(),
      sessionId: null,
    });
  }
  accounts = seeded;
  persist();
  console.log(`[store] created ${path.basename(STORE_FILE)} with ${accounts.length} seed accounts`);
}

// Loads the store, creating it with the seed accounts on first start.
async function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    load();
    console.log(`[store] loaded ${accounts.length} accounts from ${path.basename(STORE_FILE)}`);
    return;
  }
  await seed();
}

function findByUsername(username) {
  const key = normalize(username);
  return accounts.find((account) => normalize(account.username) === key) || null;
}

function isUsernameTaken(username) {
  return findByUsername(username) !== null;
}

// Returns the created account, or null when the username was taken in the
// meantime. The check and the push run without an await in between, so two
// concurrent registrations cannot both claim the same name.
function createAccount({ username, passwordHash }) {
  if (isUsernameTaken(username)) {
    return null;
  }
  const account = {
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
    // Session identifier of the single session the account may hold. Written on
    // every registration and sign in, so an older session is invalidated.
    sessionId: null,
  };
  accounts.push(account);
  try {
    persist();
  } catch (error) {
    accounts.pop();
    throw error;
  }
  return account;
}

// Records the session identifier that is currently allowed to act for the
// account, replacing any identifier stored earlier.
function setSessionId(username, sessionId) {
  const account = findByUsername(username);
  if (!account) {
    return false;
  }
  account.sessionId = sessionId || null;
  persist();
  return true;
}

// Forgets the recorded session identifier, but only when it is still the one
// passed in. A sign in elsewhere may have stored a newer identifier by then,
// and that newer session must keep working.
function clearSessionId(username, sessionId) {
  const account = findByUsername(username);
  if (!account || !sessionId || account.sessionId !== sessionId) {
    return false;
  }
  account.sessionId = null;
  persist();
  return true;
}

// True only while the given session identifier is still the one recorded for
// the account. A sign in elsewhere overwrites the record, which turns this
// false for every other session of the same account.
function isSessionCurrent(username, sessionId) {
  const account = findByUsername(username);
  return Boolean(account && account.sessionId && sessionId && account.sessionId === sessionId);
}

function listAccounts() {
  return accounts.slice();
}

module.exports = {
  init,
  findByUsername,
  isUsernameTaken,
  createAccount,
  setSessionId,
  clearSessionId,
  isSessionCurrent,
  listAccounts,
  STORE_FILE,
};
