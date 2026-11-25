const canvas = document.querySelector('#race-canvas');
const ctx = canvas.getContext('2d');
const socket = io();
const statusLine = document.querySelector('#game-status');
const gameMessage = document.querySelector('#game-message');
const waitingOverlay = document.querySelector('#waiting-overlay');
const coinAudio = document.querySelector('#coin-audio');
const impactAudio = document.querySelector('#impact-audio');
const slumsArt = new Image();
const runnerArt = new Image();
slumsArt.src = '/assets/slums.png';
runnerArt.src = '/assets/racers.png';

let account = null;
let matchId = null;
let track = null;
let snapshot = null;
let lastEventTick = -1;

slumsArt.addEventListener('load', draw);
runnerArt.addEventListener('load', draw);

async function loadSession() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Session request failed');
  const result = await response.json();
  if (!result.signedIn) return window.location.replace('/');
  account = result.account.username;
  updateHud();
  draw();
}

function sendAction(action) {
  if (!matchId || !snapshot || snapshot.status === 'ended') return;
  if (action === 'toggleCheat' && !snapshot.practice) return;
  socket.emit('race:input', { matchId, action });
}

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.target.matches('input,button,select,textarea')) return;
  const key = event.key.toLowerCase();
  if (key === 'a' || key === 'arrowleft') { event.preventDefault(); sendAction('left'); }
  if (key === 'd' || key === 'arrowright') { event.preventDefault(); sendAction('right'); }
  if (key === 'c' && snapshot?.practice) sendAction('toggleCheat');
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => sendAction(button.dataset.action));
});

socket.on('connect', () => {
  statusLine.textContent = 'Connected · waiting for the room race snapshot…';
  if (snapshot) document.querySelector('#race-state').textContent = 'Connection restored · race updates are live.';
});
socket.on('disconnect', () => {
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
  matchId = payload.matchId;
  track = payload.track;
  snapshot = payload.snapshot;
  waitingOverlay.hidden = true;
  statusLine.textContent = snapshot.practice
    ? 'Practice race · cheat mode is available.'
    : 'Race live · cheat mode is disabled.';
  gameMessage.textContent = snapshot.practice
    ? 'Practice mode is on. Press C or use the button to toggle the speed cheat.'
    : 'Race live. Use A / D or ← / → to change lanes.';
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
  return snapshot?.players.find((player) => player.id === account) || snapshot?.players[0] || null;
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
  const names = {
    approach: 'Basin approach',
    'main-route': 'Market route',
    shortcut: 'Scaffold shortcut',
    runout: 'Service gate'
  };
  return names[segmentId] || String(segmentId || 'The Slums').replaceAll('-', ' ');
}

function updateRunnerCard(prefix, player, isLocal) {
  const fallback = isLocal ? 'Waiting for your runner…' : 'Waiting for the other runner…';
  document.querySelector(`#${prefix}-coins`).textContent = player ? `${player.coins} coins` : '— coins';
  document.querySelector(`#${prefix}-shield`).textContent = player ? `Shield ${player.shield} / 3` : 'Shield — / 3';
  document.querySelector(`#${prefix}-score`).textContent = player ? `Score ${player.score}` : 'Score —';
  document.querySelector(`#${prefix}-progress`).style.width = player
    ? `${Math.max(0, Math.min(100, player.progress / getTrackLength() * 100))}%`
    : '0%';

  let state = fallback;
  if (player) {
    if (!player.connected) state = 'Disconnected';
    else if (player.finishTimeMs !== null) state = 'Finished';
    else if (player.stunRemainingMs > 0) state = 'Stunned';
    else if (player.cheatActive) state = 'CHEAT ON';
    else state = stageName(player.segmentId);
  }
  document.querySelector(`#${prefix}-state`).textContent = state;
}

function updateTrackSteps(player) {
  document.querySelectorAll('.track-steps [data-step]').forEach((step) => {
    step.removeAttribute('aria-current');
  });
  if (!player) return;
  const current = player.segmentId === 'approach' ? 'approach'
    : player.segmentId === 'runout' ? 'runout' : 'route';
  document.querySelector(`.track-steps [data-step="${current}"]`)?.setAttribute('aria-current', 'step');
}

function updateRouteGuide(player) {
  const guide = document.querySelector('#route-guide');
  guide.replaceChildren();
  if (!player || !track?.segments?.[player.segmentId]) return;
  const segment = track.segments[player.segmentId];
  if (!Array.isArray(segment.exits)) return;

  const routes = new Map();
  segment.exits.forEach(([nextSegment], lane) => {
    if (!routes.has(nextSegment)) routes.set(nextSegment, []);
    routes.get(nextSegment).push(lane + 1);
  });
  if (routes.size < 2) return;

  routes.forEach((lanes, nextSegment) => {
    const badge = document.createElement('span');
    const laneText = lanes.length === 1 ? `lane ${lanes[0]}` : `lanes ${lanes[0]}–${lanes[lanes.length - 1]}`;
    badge.textContent = `${stageName(nextSegment)} · ${laneText}`;
    if (lanes.includes(player.lane + 1)) badge.classList.add('chosen');
    guide.append(badge);
  });
}

function updateHud() {
  if (!snapshot) return;
  const mine = getLocalPlayer();
  const rival = getOpponent();
  document.querySelector('#timer').textContent = formatTime(snapshot.remainingMs);
  document.querySelector('#current-stage').textContent = stageName(mine?.segmentId || track?.startSegmentId);
  document.querySelector('#race-state').textContent = snapshot.status === 'ended'
    ? 'Race complete · final standings below.'
    : `${snapshot.players.filter((player) => player.connected).length} / 2 runners connected`;
  document.querySelector('#route-label').textContent = `The Slums · ${stageName(mine?.segmentId || track?.startSegmentId)}`;
  document.querySelector('#cheat-button').textContent = mine?.cheatActive ? 'Cheat on' : 'Cheat off';
  document.querySelector('#cheat-button').disabled = !snapshot.practice || snapshot.status === 'ended';
  document.querySelectorAll('[data-action="left"], [data-action="right"]').forEach((button) => {
    button.disabled = snapshot.status === 'ended';
  });
  updateRunnerCard('you', mine, true);
  updateRunnerCard('rival', rival, false);
  updateTrackSteps(mine);
  updateRouteGuide(mine);
}

function playEvents(state) {
  if (state.tick === lastEventTick) return;
  lastEventTick = state.tick;
  state.events.forEach((event) => {
    const sound = event.type === 'coinCollected' ? coinAudio
      : (event.type === 'impact' || event.type === 'crateBroken') ? impactAudio : null;
    if (sound) { sound.currentTime = 0; sound.play().catch(() => {}); }
  });
}

function point(lateral, distance) {
  const scale = 14 / (14 + Math.max(-2, distance));
  return [550 + lateral * 190 * scale, 180 + 395 * scale, scale];
}

function polygon(points, color) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roadStripe(from, to, distance, color) {
  const nextDistance = distance + 0.8;
  polygon([point(from, distance), point(to, distance), point(to, nextDistance), point(from, nextDistance)], color);
}

function drawObject(object, distance, time) {
  const [x, y, scale] = point(object.lane - (currentSegmentLaneCount() - 1) / 2, distance);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = '#020712aa';
  ctx.shadowBlur = 8;
  if (object.type === 'coin') {
    const spin = 7 + 7 * Math.abs(Math.cos(time / 220));
    ctx.fillStyle = '#e9a56a';
    ctx.strokeStyle = '#fff0cb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -24, spin, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#183348';
    ctx.fillRect(-2, -30, 4, 12);
  } else if (object.type === 'crate') {
    ctx.fillStyle = '#a75e3e';
    ctx.fillRect(-23, -47, 46, 46);
    ctx.strokeStyle = '#f0b16b';
    ctx.lineWidth = 4;
    ctx.strokeRect(-23, -47, 46, 46);
    ctx.beginPath();
    ctx.moveTo(-18, -42); ctx.lineTo(18, -6);
    ctx.moveTo(18, -42); ctx.lineTo(-18, -6);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#5a473e';
    ctx.fillRect(-48, -37, 96, 31);
    ctx.fillStyle = '#c18a5e';
    ctx.fillRect(-48, -37, 96, 8);
    ctx.fillStyle = '#332b2b';
    ctx.fillRect(-37, -42, 10, 43);
    ctx.fillRect(27, -42, 10, 43);
    ctx.strokeStyle = '#efb77b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-48, -37, 96, 31);
  }
  ctx.restore();
}

function currentSegmentLaneCount() {
  const mine = getLocalPlayer();
  return track?.segments?.[mine?.segmentId]?.laneCount || 4;
}

function drawRunner(player, isLocal, time) {
  const segment = track.segments[player.segmentId];
  const mine = getLocalPlayer();
  const relativeDistance = player.segmentId === mine?.segmentId ? player.distance - mine.distance : 0;
  const lanes = segment?.laneCount || 4;
  const [x, y, scale] = point(player.lane - (lanes - 1) / 2, relativeDistance);
  const bob = player.connected && !player.stunRemainingMs ? Math.sin(time / 85) * 3 : 0;
  const tint = isLocal ? '#61e6ee' : '#ff79ca';
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(scale, scale);
  ctx.globalAlpha = player.connected ? 1 : 0.45;
  ctx.fillStyle = '#02091599';
  ctx.beginPath();
  ctx.ellipse(0, -3, 36, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  if (runnerArt.complete && runnerArt.naturalWidth) {
    const sourceWidth = runnerArt.naturalWidth / 2;
    const sourceHeight = runnerArt.naturalHeight / 2;
    const sourceX = isLocal ? 0 : sourceWidth;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(runnerArt, sourceX, 0, sourceWidth, sourceHeight, -52, -124, 104, 124);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, -27, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  if (player.shield > 0) {
    ctx.strokeStyle = `${tint}aa`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -61, 55, 69, 0, 0.25, Math.PI * 1.75);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.fillStyle = tint;
  ctx.shadowColor = '#07101c';
  ctx.shadowBlur = 7;
  ctx.fillText(isLocal ? 'YOU' : 'OPPONENT', 0, -132);
  if (player.stunRemainingMs > 0) {
    ctx.fillStyle = '#ffc573';
    ctx.fillText('STUNNED', 0, -149);
  }
  ctx.restore();
}

function draw(time = performance.now()) {
  const width = canvas.width;
  const height = canvas.height;
  if (!snapshot || !track) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b1523';
    ctx.fillRect(0, 0, width, height);
    if (slumsArt.complete && slumsArt.naturalWidth) ctx.drawImage(slumsArt, 0, 0, width, height);
    const waitingFade = ctx.createLinearGradient(0, 80, 0, height);
    waitingFade.addColorStop(0, '#08101c18');
    waitingFade.addColorStop(1, '#050c1d55');
    ctx.fillStyle = waitingFade;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const mine = getLocalPlayer();
  const rival = getOpponent();
  if (!mine) return;
  const segment = track.segments[mine.segmentId];
  if (!segment) return;
  const half = segment.laneCount / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1523';
  ctx.fillRect(0, 0, width, height);
  if (slumsArt.complete && slumsArt.naturalWidth) ctx.drawImage(slumsArt, 0, 0, width, height);

  const fade = ctx.createLinearGradient(0, 90, 0, height);
  fade.addColorStop(0, '#08101c18');
  fade.addColorStop(1, '#050c1d66');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);

  polygon([point(-half, 45), point(half, 45), point(half, -2), point(-half, -2)], '#182637b8');
  for (const edge of [-half, half]) {
    roadStripe(edge - 0.025, edge + 0.025, -2, '#d6b16f');
    roadStripe(edge - 0.025, edge + 0.025, 44, '#d6b16f');
    polygon([point(edge - 0.025, 44), point(edge + 0.025, 44), point(edge + 0.025, -2), point(edge - 0.025, -2)], '#d6b16f88');
  }

  const startRow = Math.ceil(mine.distance / 3) * 3;
  for (let row = startRow; row < mine.distance + 45; row += 3) {
    const distance = row - mine.distance;
    for (let lane = 1; lane < segment.laneCount; lane += 1) {
      const center = lane - half;
      roadStripe(center - 0.016, center + 0.016, distance, '#d4e1edaa');
    }
  }

  const endDistance = segment.length - mine.distance;
  if (endDistance >= 0 && endDistance < 35) {
    const [leftX, lineY] = point(-half, endDistance);
    const [rightX] = point(half, endDistance);
    ctx.strokeStyle = '#ffbd62';
    ctx.lineWidth = Math.max(2, 5 * point(0, endDistance)[2]);
    ctx.beginPath();
    ctx.moveTo(leftX, lineY);
    ctx.lineTo(rightX, lineY);
    ctx.stroke();
    ctx.fillStyle = '#ffdda3';
    ctx.textAlign = 'center';
    ctx.font = '600 14px Consolas, monospace';
    ctx.fillText(segment.exits ? 'ROUTE MERGE AHEAD' : 'FINISH', 550, lineY - 26 * point(0, endDistance)[2]);
  }

  const removed = new Set(snapshot.removedObjectIds);
  const visible = segment.objects
    .filter((object) => object.distance >= mine.distance && object.distance < mine.distance + 45 && !removed.has(object.id))
    .map((object) => ({ object, distance: object.distance - mine.distance }));
  if (rival && rival.segmentId === mine.segmentId && rival.distance - mine.distance > -3 && rival.distance - mine.distance < 45) {
    visible.push({ player: rival, distance: rival.distance - mine.distance });
  }
  visible.push({ player: mine, distance: 0, local: true });
  visible.sort((a, b) => b.distance - a.distance);
  visible.forEach((item) => {
    if (item.player) drawRunner(item.player, item.local === true, time);
    else drawObject(item.object, item.distance, time);
  });
}

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
  const firstShow = panel.hidden;
  panel.hidden = false;
  if (firstShow) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

loadSession().catch(() => {
  statusLine.textContent = 'The server could not be reached. Check that it is running, then refresh this page.';
});

function animate() {
  draw();
  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
