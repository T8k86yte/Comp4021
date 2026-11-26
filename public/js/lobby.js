const socket = io();
const message = document.querySelector('#lobby-message');
const roomPanel = document.querySelector('#room-panel');
const memberList = document.querySelector('#member-list');
let currentRoom = null;
let accountName = null;

function ask(eventName, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(eventName, payload, (timeoutError, result) => {
      if (timeoutError) return resolve({ ok: false, error: { message: 'Server timed out.' } });
      resolve(result || { ok: false, error: { message: 'No server response.' } });
    });
  });
}

function showError(result) {
  message.textContent = result.ok ? '' : (result.error && result.error.message) || 'That action failed.';
}

function renderRoom(room) {
  currentRoom = room;
  roomPanel.hidden = false;
  document.querySelector('#create-room').hidden = true;
  document.querySelector('#join-form').hidden = true;
  document.querySelector('#room-code-display').textContent = room.code;
  const phaseText = {
    waiting: 'Waiting for both players to be ready.',
    countdown: 'Race starts soon…',
    racing: 'Race in progress…',
    finished: 'Race finished. Leave to start a new room.',
  };
  document.querySelector('#room-phase').textContent = phaseText[room.phase] || room.phase;
  memberList.replaceChildren();
  room.members.forEach((member) => {
    const item = document.createElement('li');
    item.textContent = member.account + (member.host ? ' · host' : '') +
      ' · ' + (member.connected ? 'connected' : 'reconnecting') +
      ' · ' + (member.ready ? 'ready' : 'not ready');
    memberList.append(item);
  });
  const mine = room.members.find((member) => member.account === accountName);
  const readyButton = document.querySelector('#ready-button');
  readyButton.disabled = room.phase !== 'waiting' || room.members.length !== 2;
  readyButton.textContent = mine && mine.ready ? 'Cancel ready' : 'Ready';
}

async function checkSession() {
  const response = await fetch('/api/session');
  const session = await response.json();
  if (!session.signedIn) return window.location.replace('/');
  accountName = session.account.username;
  document.querySelector('#welcome').textContent = 'Signed in as ' + accountName + '.';
  if (currentRoom) renderRoom(currentRoom);
}

socket.on('connect_error', () => window.location.replace('/'));
socket.on('room:state', (room) => {
  renderRoom(room);
  if (room.phase === 'racing') window.location.assign('/game.html');
});
socket.on('room:error', (error) => { message.textContent = error.message; });
socket.on('race:start', () => window.location.assign('/game.html'));
socket.on('race:bootstrap', () => window.location.assign('/game.html'));

document.querySelector('#create-room').addEventListener('click', async () => {
  const result = await ask('room:create', { practice: document.querySelector('#practice').checked });
  showError(result);
});
document.querySelector('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.querySelector('#room-code').value.trim().toUpperCase();
  showError(await ask('room:join', { code }));
});
document.querySelector('#ready-button').addEventListener('click', async () => {
  const mine = currentRoom && currentRoom.members.find((member) => member.account === accountName);
  showError(await ask('room:ready', { ready: !(mine && mine.ready) }));
});
document.querySelector('#leave-room').addEventListener('click', async () => {
  const result = await ask('room:leave');
  showError(result);
  if (result.ok) window.location.reload();
});
document.querySelector('#sign-out').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/');
});
checkSession().catch(() => { message.textContent = 'The server could not be reached.'; });