const canvas = document.querySelector('#race-canvas');
const renderer = window.createRaceRenderer(canvas);
const socket = io();
const statusLine = document.querySelector('#game-status');
const gameMessage = document.querySelector('#game-message');
const waitingOverlay = document.querySelector('#waiting-overlay');
const raceAudio = window.createRaceAudio();

let account = null;
let matchId = null;
let track = null;
let snapshot = null;
let lastEventTick = -1;
let resultsPending = false;
let controls = null;
let boostHeld = false;


async function loadSession() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Session request failed');
  const result = await response.json();
  if (!result.signedIn) return window.location.replace('/');
  account = result.account.username;
  updateHud();
  draw();
}

function controlAccounts() { return [controls?.owner || snapshot?.players[0]?.id, controls?.guest || snapshot?.players[1]?.id]; }
function localControlSeat() { return controlAccounts().indexOf(account); }
function sendAction(action, controlSeat = localControlSeat()) {
  if (!matchId || !snapshot || snapshot.status === 'ended' || !getLocalPlayer()) return;
  if (controlSeat !== localControlSeat() && !controls?.manualTest) return;
  const player = snapshot.players.find(p => p.id === controlAccounts()[controlSeat]);
  if (!player || !player.connected || player.finishTimeMs !== null) return;
  if (action === 'toggleCheat' && (!snapshot.practice || player.immunityActive)) return;
  if ((action === 'up' || action === 'down') && (player.mode !== 'flight' || track.segments[player.segmentId].flightPhase === 'atmosphere')) return;
  socket.emit('race:input', { matchId, action, controlSeat });
}

window.addEventListener('keydown', (event) => {
  raceAudio.unlock();
  if (event.repeat || event.target.matches('input,button,select,textarea')) return;
  const key = event.key.toLowerCase();
  const owner = { a:'left', d:'right', w:'up', s:'down', f:'fire' }[key];
  const guest = { arrowleft:'left', arrowright:'right', arrowup:'up', arrowdown:'down', enter:'fire' }[key];
  if (owner || guest) { event.preventDefault(); sendAction(owner || guest, owner ? 0 : 1); }
  if (key === 'l') { event.preventDefault(); sendAction('enableImmunity'); }
  if (key === 'c') { event.preventDefault(); sendAction('toggleCheat'); }
  if (key === ' ') { event.preventDefault(); boostHeld = true; sendAction('boostStart'); }
});
function releaseBoost() { if (boostHeld) { sendAction('boostEnd'); boostHeld = false; } }
window.addEventListener('keyup', event => { if (event.key === ' ') { event.preventDefault(); releaseBoost(); } });
window.addEventListener('blur', releaseBoost);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseBoost(); });

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => { raceAudio.unlock(); sendAction(button.dataset.action); canvas.focus(); });
});
canvas.addEventListener('pointerdown', () => { raceAudio.unlock(); sendAction('fire'); canvas.focus(); });

socket.on('connect', () => {
  statusLine.textContent = 'Connected · waiting for the room race snapshot…';
  if (snapshot) document.querySelector('#race-state').textContent = 'Connection restored · race updates are live.';
});
socket.on('disconnect', () => {
  boostHeld = false;
  statusLine.textContent = 'Connection lost · trying to reconnect…';
  if (snapshot) {
    document.querySelector('#race-state').textContent = 'Connection lost · trying to reconnect…';
    gameMessage.textContent = 'Your browser is reconnecting to the race server.';
  }
});
socket.on('connect_error', () => {
  statusLine.textContent = 'Could not connect to the race server. Check that the server is running.';
  if (snapshot) document.querySelector('#race-state').textContent = 'Race server connection failed.';
});

socket.on('race:bootstrap', (payload) => {
  boostHeld = false;
  resultsPending = false;
  // Bootstrap/reconnect events describe the past; don't replay their sounds.
  lastEventTick = payload.snapshot.tick;
  matchId = payload.matchId;
  track = payload.track;
  snapshot = payload.snapshot;
  controls = payload.controls || { owner: snapshot.players[0]?.id, guest: snapshot.players[1]?.id, manualTest: false };
  waitingOverlay.hidden = true;
  document.querySelector('#results-panel').hidden = true;
  statusLine.textContent = controls.manualTest ? 'Same-device manual test · both keyboard schemes are relayed.' : 'Race live.';
  gameMessage.textContent = 'Owner: WASD and F to fire. Guest: arrows and Enter to fire. L enables immunity; hold Space for 1.5× acceleration.';
  updateHud();
  draw();
  if (snapshot.status === 'ended') showResults();
});

socket.on('race:update', (payload) => {
  if (payload.matchId !== matchId) return; // Ignore late packets from another match.
  snapshot = payload.snapshot;
  updateHud();
  playEvents(snapshot);
  draw();
  if (snapshot.status === 'ended') showResults();
});

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutesText = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secondsText = String(seconds % 60).padStart(2, '0');
  return minutesText + ':' + secondsText;
}

function getLocalPlayer() {
  return snapshot?.players.find((player) => player.id === account) || null;
}

function getOpponent() {
  const mine = getLocalPlayer();
  return snapshot?.players.find((player) => player.id !== mine?.id) || null;
}

function getTrackLength() {
  const segments = Object.values(track?.segments || {});
  return Math.max(1, ...segments.map((segment) => segment.progress?.[1] || 0));
}

function stageName(segmentId) {
  return track?.segments[segmentId]?.name || String(segmentId || 'The Slums').replaceAll('-', ' ');
}

function updateRunnerCard(prefix, player, isLocal) {
  const fallback = isLocal ? 'Waiting for your runner…' : 'Waiting for the other runner…';
  document.querySelector(`#${prefix}-coins`).textContent = player ? `${player.coins} coins` : '— coins';
  document.querySelector(`#${prefix}-shield`).textContent = player ? `Shield ${player.shield} / ${player.maxShield}` : 'Shield —';
  document.querySelector(`#${prefix}-ammo`).textContent = player
    ? `Ammo ${player.ammo} / ${player.maxAmmo}${player.ammoRefillMs === null ? '' : ' · ' + (player.ammoRefillMs / 1000).toFixed(1) + 's'}` : 'Ammo —';
  if (player) document.querySelector(`.runner-${isLocal ? 'you' : 'rival'}`).style.color =
    (player.seat ?? snapshot.players.indexOf(player)) === 0 ? '#65eff1' : '#ff79d2';
  document.querySelector(`#${prefix}-score`).textContent = player ? `Score ${player.score}` : 'Score —';
  document.querySelector(`#${prefix}-progress`).style.width = player
    ? `${Math.max(0, Math.min(100, player.progress / getTrackLength() * 100))}%`
    : '0%';

  let state = fallback;
  if (player) {
    if (!player.connected) state = 'Disconnected';
    else if (player.finishTimeMs !== null) state = 'Finished';
    else if (player.stunRemainingMs > 0) state = 'Stunned';
    else if (player.immunityActive) state = player.boostActive ? 'IMMUNE · SPEED 1.5×' : 'IMMUNE · normal speed';
    else if (player.cheatActive) state = 'PRACTICE CHEAT · SPEED 2×';
    else state = `${stageName(player.segmentId)} · lane ${player.lane + 1}${player.mode === 'flight' ? (track.segments[player.segmentId].flightPhase === 'atmosphere' ? ' · ascending' : ' · ' + ['low', 'middle', 'high'][player.altitude]) : ''}`;
  }
  document.querySelector(`#${prefix}-state`).textContent = state;
}

function updateTrackSteps(player) {
  document.querySelectorAll('.track-steps [data-stage]').forEach((step) => {
    step.removeAttribute('aria-current');
    if (player && step.dataset.stage === track?.segments[player.segmentId]?.stage) step.setAttribute('aria-current', 'step');
  });
}

function updateHud() {
  if (!snapshot) return;
  const mine = getLocalPlayer();
  const rival = getOpponent();
  if (!mine) return;
  const segment = track.segments[mine.segmentId];
  const stage = track.stages?.[segment.stage];
  document.querySelector('#control-role').textContent = localControlSeat() === 0 ? 'YOU ARE THE OWNER · WASD / F' : 'YOU ARE THE GUEST · ARROWS / ENTER';
  document.querySelector('#control-scope').textContent = controls?.manualTest
    ? 'Either focused window steers both players. L and Space affect this window’s signed-in player.'
    : 'This window controls your player. Enable Same-device manual test when creating a room to steer both windows.';
  document.querySelector('#timer').textContent = formatTime(snapshot.remainingMs);
  document.querySelector('#current-stage').textContent = `${stage?.name || segment.stage}${mine.mode === 'flight' ? (segment.flightPhase === 'atmosphere' ? ' · Atmospheric ascent' : ' · Orbital flight') : ''}`;
  document.querySelector('#race-state').textContent = snapshot.status === 'ended'
    ? 'Race complete · final standings below.'
    : `${snapshot.players.filter((player) => player.connected).length} / 2 runners connected`;
  document.querySelector('#route-label').textContent = `${stage?.name || segment.stage} · ${stageName(mine.segmentId)}`;
  document.querySelector('#cheat-button').textContent = mine?.cheatActive ? 'Cheat on' : 'Cheat off';
  document.querySelector('#cheat-button').disabled = !snapshot.practice || snapshot.status === 'ended' || mine.finishTimeMs !== null;
  document.querySelectorAll('[data-action]').forEach((button) => {
    const action = button.dataset.action;
    button.disabled = snapshot.status === 'ended' || mine.finishTimeMs !== null || (action === 'toggleCheat' && !snapshot.practice)
      || (action === 'toggleCheat' && mine.immunityActive)
      || ((action === 'up' || action === 'down') && (mine.mode !== 'flight' || segment.flightPhase === 'atmosphere'));
  });
  updateRunnerCard('you', mine, true);
  updateRunnerCard('rival', rival, false);
  updateTrackSteps(mine);

}

function playEvents(state) {
  if (state.tick <= lastEventTick) return;
  lastEventTick = state.tick;
  raceAudio.playEvents(state.events, account, track);
  state.events.forEach((event) => {
    if (event.playerId !== account) return;
    if (event.type === 'stageChanged') gameMessage.textContent = `Entering ${track.stages[event.stage].name}.`;
    const horizontal = localControlSeat() === 0 ? 'A/D' : 'Left/Right';
    const vertical = localControlSeat() === 0 ? 'W/S' : 'Up/Down';
    if (event.type === 'orbitEntered') gameMessage.textContent = `Orbit reached. ${vertical} changes altitude; ${horizontal} steers. You enter on MID.`;
    if (event.type === 'launched') gameMessage.textContent = `Launched into atmosphere. ${horizontal} dodges traffic. ${vertical} unlocks in orbit.`;
  });
}

function draw(time = performance.now()) { renderer.draw(track, snapshot, account, time); }

function showResults() {
  statusLine.textContent = 'Race finished.';
  gameMessage.textContent = 'Race complete. Review the server-recorded standings below, then return to the lobby to play again.';
  const body = document.querySelector('#results-body');
  body.replaceChildren();
  (snapshot.results || []).forEach((runner) => {
    const row = document.createElement('tr');
    const finish = runner.finishTimeMs === null ? 'Did not finish' : formatTime(runner.finishTimeMs);
    [runner.rank, runner.name, finish, runner.coins, runner.score, runner.stuns,
      runner.usedCheat ? 'Used' : 'No'].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    });
    body.append(row);
  });
  const panel = document.querySelector('#results-panel');
  if(renderer.isDocking()){
    resultsPending=true;panel.hidden=true;
    gameMessage.textContent='Docking at the Crystal Palace…';
    return;
  }
  resultsPending=false;
  const firstShow = panel.hidden;
  panel.hidden = false;
  if (firstShow) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

loadSession().catch(() => {
  statusLine.textContent = 'The server could not be reached. Check that it is running, then refresh this page.';
});

function animate() {
  draw();
  if(resultsPending && !renderer.isDocking())showResults();
  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
