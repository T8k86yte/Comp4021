'use strict';
const { createRace, TICK_MS, track: fullCourse } = window.previewRace;
const $ = id => document.getElementById(id);
const canvas = $('track');
const ctx = canvas.getContext('2d');
const art = {};
for (const [stage, info] of Object.entries(fullCourse.stages)) { art[stage] = new Image(); art[stage].src = info.art; }
const sprites = new Image(); sprites.src = '/assets/racers.png';
const colors = { cyan: '#65eff1', magenta: '#ff79d2' };
let track, race, state, running = false, lastTime = 0, lag = 0;

function selectedTrack() {
  const result = structuredClone(fullCourse);
  const selection = $('course').value;
  if (selection === 'full') return result;
  result.startSegmentId = ({ slums: 'slums-basin', downtown: 'downtown-plaza', spaceport: 'spaceport-hangar', orbit: 'orbit-launch' })[selection];
  const include = segment => selection === 'orbit' ? segment.mode === 'flight' : segment.stage === selection;
  result.segments = Object.fromEntries(Object.entries(result.segments).filter(([, segment]) => include(segment)));
  for (const segment of Object.values(result.segments)) {
    if (segment.exits?.some(([id]) => !result.segments[id])) { delete segment.exits; segment.sign = 'STAGE FINISH'; }
  }
  result.finishProgress = Math.max(...Object.values(result.segments).map(s => s.progress[1]));
  return result;
}
function reset() {
  track = selectedTrack();
  race = createRace({ players: [{ id: 'cyan', name: 'You' }, { id: 'magenta', name: 'Rival' }], track, practice: true });
  state = race.getSnapshot(); lag = 0;
  $('results').hidden = true;
  const { shortest, longest } = track.pacing.cleanRouteSeconds;
  $('course-info').textContent = $('course').value === 'full'
    ? `20 shared coins · ${shortest}–${longest} seconds before impacts` : 'Stage practice · fresh gun and shield';
  $('message').textContent = 'Ready. Choose a lane before the route gate.';
  updateHud();
}
function point(lateral, distance, altitude = 0) {
  const scale = 14 / (14 + Math.max(-2, distance));
  return [550 + lateral * 190 * scale, 180 + 395 * scale - altitude * 88 * scale, scale];
}
function polygon(points, color) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function line(from, to, z, color, altitude = 0) {
  polygon([point(from, z, altitude), point(to, z, altitude), point(to, z + .12, altitude), point(from, z + .12, altitude)], color);
}
function textAt(text, x, y, size = 15, color = '#e5f2ff') {
  ctx.font = `600 ${size}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = color;
  ctx.shadowColor = '#07101c'; ctx.shadowBlur = 7; ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}
function drawScenery(segment, me) {
  if (segment.mode === 'flight') return;
  const scaffold = me.segmentId === 'slums-scaffold';
  const glass = me.segmentId === 'downtown-service';
  const garden = me.segmentId === 'downtown-terrace';
  const hangar = me.segmentId === 'spaceport-hangar';
  if (!scaffold && !glass && !garden && !hangar) return;
  const edge = segment.laneCount / 2;
  for (let row = Math.ceil(me.distance / 4) * 4 + 40; row >= me.distance; row -= 4) {
    const z = row - me.distance;
    for (const side of [-1, 1]) {
      const [x, y, scale] = point(side * (edge + .15), z);
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      if (glass) {
        ctx.fillStyle = '#a4f2ff20'; ctx.fillRect(-10, -145, 20, 145);
        ctx.strokeStyle = '#bcf5ff77'; ctx.lineWidth = 3; ctx.strokeRect(-10, -145, 20, 145);
      } else if (scaffold) {
        ctx.fillStyle = '#ca8451'; ctx.fillRect(-4, -60, 8, 60);
        ctx.fillStyle = '#f4bd72'; ctx.fillRect(-9, -61, 18, 6);
      } else if (garden) {
        ctx.fillStyle = '#d8dddd'; ctx.fillRect(-28, -22, 56, 22);
        ctx.fillStyle = '#416a5e'; ctx.beginPath(); ctx.ellipse(0, -33, 28, 21, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8a5d3'; ctx.fillRect(-12, -45, 7, 7); ctx.fillRect(9, -38, 7, 7);
      } else {
        ctx.fillStyle = '#5b6473'; ctx.fillRect(-7, -34, 14, 34);
        ctx.fillStyle = '#ff795d'; ctx.fillRect(-9, -40, 18, 9);
      }
      ctx.restore();
    }
    if (scaffold) line(-edge, edge, z, '#bf855a44');
  }
}
function drawObject(object, z, segment, time) {
  const altitude = segment.mode === 'flight' ? object.altitude ?? 1 : 0;
  const [x, y, scale] = point(object.lane - (segment.laneCount - 1) / 2, z, altitude);
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  if (segment.mode === 'flight') {
    ctx.strokeStyle = '#dbe8ff44'; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, altitude * 88); ctx.stroke(); ctx.setLineDash([]);
  }
  if (object.type === 'coin') {
    const tone = segment.stage === 'slums' ? '#e9a56a' : segment.stage === 'downtown' ? '#ffda73' : '#bbf4ff';
    ctx.fillStyle = tone; ctx.strokeStyle = '#fff4d8'; ctx.lineWidth = 3;
    const spin = 5 + 13 * Math.abs(Math.cos(time / 260));
    if (segment.stage === 'spaceport') {
      polygon([[0, -51], [spin, -26], [0, 0], [-spin, -26]], tone);
      polygon([[0, -51], [0, 0], [-spin, -26]], '#619bac');
    } else {
      ctx.beginPath(); ctx.ellipse(0, -25, spin, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#183348'; ctx.fillRect(-3, -31, 6, 12);
    }
  } else if (object.visual === 'glass') {
    polygon([[-44, 0], [-44, -72], [44, -72], [44, 0]], '#a5ecf257');
    ctx.strokeStyle = '#d0ffff'; ctx.lineWidth = 4; ctx.strokeRect(-44, -72, 88, 72);
    ctx.beginPath(); ctx.moveTo(-26, -8); ctx.lineTo(-3, -35); ctx.lineTo(-14, -42); ctx.lineTo(24, -65); ctx.stroke();
  } else if (object.visual === 'car') {
    polygon([[-59, -8], [-59, -35], [-40, -64], [31, -64], [55, -35], [55, -8]], '#e3e8e9');
    ctx.fillStyle = '#31556c'; ctx.fillRect(-31, -56, 56, 22);
    ctx.fillStyle = '#ef895d'; ctx.fillRect(-53, -23, 18, 7); ctx.fillRect(31, -23, 18, 7);
    ctx.fillStyle = '#192335'; ctx.fillRect(-48, -8, 18, 11); ctx.fillRect(28, -8, 18, 11);
  } else if (object.visual === 'satellite-hull') {
    ctx.fillStyle = '#3a4e79'; ctx.fillRect(-72, -39, 46, 26); ctx.fillRect(26, -39, 46, 26);
    ctx.strokeStyle = '#99a9d3'; ctx.lineWidth = 2; ctx.strokeRect(-72, -39, 46, 26); ctx.strokeRect(26, -39, 46, 26);
    ctx.fillStyle = '#c7cdd5'; ctx.fillRect(-23, -51, 46, 50); ctx.fillStyle = '#ffba68'; ctx.fillRect(-12, -38, 24, 16);
  } else if (object.visual === 'pipe') {
    ctx.fillStyle = '#684f45'; ctx.fillRect(-49, -34, 98, 32);
    ctx.fillStyle = '#ad8163'; ctx.fillRect(-49, -32, 98, 7);
    ctx.fillStyle = '#342e30'; ctx.fillRect(-39, -38, 11, 40); ctx.fillRect(28, -38, 11, 40);
    ctx.strokeStyle = '#efb77b'; ctx.lineWidth = 3; ctx.strokeRect(-49, -34, 98, 32);
  } else if (object.visual === 'planter') {
    ctx.fillStyle = '#bdcbd1'; ctx.fillRect(-46, -35, 92, 35);
    polygon([[-40, -35], [-32, -62], [30, -60], [42, -35]], '#3b6658');
    ctx.fillStyle = '#e99ec6'; ctx.fillRect(-20, -56, 9, 8); ctx.fillRect(12, -49, 8, 8);
  } else if (object.visual === 'wall' || object.visual === 'cargo-wall') {
    const cargo = object.visual === 'cargo-wall';
    ctx.fillStyle = cargo ? '#485567' : '#bccbd0'; ctx.fillRect(-48, -69, 96, 69);
    ctx.fillStyle = cargo ? '#283646' : '#728e9d'; ctx.fillRect(-40, -61, 80, 47);
    ctx.fillStyle = '#ffc56c'; ctx.fillRect(-48, -13, 96, 9);
    for (let x = -40; x < 45; x += 22) polygon([[x, -13], [x + 10, -13], [x + 17, -4], [x + 7, -4]], '#222e3c');
  } else if (object.visual === 'debris') {
    const tumble = Math.sin(time / 600 + object.distance) * .15;
    ctx.rotate(tumble);
    polygon([[-42, -20], [-22, -58], [12, -66], [41, -33], [30, -4], [-7, 4]], '#61758b');
    polygon([[-22, -58], [12, -66], [41, -33], [0, -25]], '#9caeb7');
    ctx.strokeStyle = '#d4edff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-19, -15); ctx.lineTo(0, -25); ctx.lineTo(-3, -43); ctx.stroke();
  } else {
    const crate = object.type === 'crate'; const orbital = segment.mode === 'flight';
    const base = crate ? orbital ? '#526a85' : '#83583c' : '#374a5d';
    polygon([[-42, -8], [-42, -57], [28, -57], [44, -42], [44, -8]], base);
    polygon([[-42, -57], [-26, -70], [44, -55], [28, -57]], '#a5b1b6');
    ctx.strokeStyle = crate ? '#f2c28a' : '#f7bd53'; ctx.lineWidth = 4; ctx.strokeRect(-40, -55, 80, 46);
    ctx.beginPath(); ctx.moveTo(-32, -47); ctx.lineTo(32, -17); if (crate) { ctx.moveTo(32, -47); ctx.lineTo(-32, -17); } ctx.stroke();
  }
  if (segment.mode === 'flight' && z < 15) textAt(['LOW', 'MID', 'HIGH'][altitude], 0, 18, 12, '#c8d7eb');
  ctx.restore();
}
function drawPlayer(player, z, segment, time) {
  const flight = player.mode === 'flight';
  const [x, y, scale] = point(player.lane - (segment.laneCount - 1) / 2, z, flight ? player.altitude : 0);
  const bob = running && player.connected && !player.stunRemainingMs ? Math.sin(time / (flight ? 220 : 75)) * (flight ? 3 : 4) : 0;
  ctx.save(); ctx.translate(x, y + bob); ctx.scale(scale, scale);
  ctx.globalAlpha = player.phaseRemainingMs ? .38 : player.recoveryRemainingMs ? .65 : 1;
  if (!flight) { ctx.fillStyle = '#02091588'; ctx.beginPath(); ctx.ellipse(0, -3, 33, 9, 0, 0, Math.PI * 2); ctx.fill(); }
  if (sprites.complete && sprites.naturalWidth) {
    const sw = sprites.naturalWidth / 2, sh = sprites.naturalHeight / 2;
    const width = flight ? 160 : 145, height = flight ? 150 : 165;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprites, player.id === 'cyan' ? 0 : sw, flight ? sh : 0, sw, sh, -width / 2, -height, width, height);
  }
  if (player.shield > 0) {
    ctx.strokeStyle = colors[player.id] + '88'; ctx.lineWidth = 2;
    const gauges = flight ? Math.ceil(player.shield / 100 * 3) : player.shield;
    for (let i = 0; i < gauges; i++) { ctx.beginPath(); ctx.ellipse(0, -75, flight ? 80 : 60, flight ? 70 : 90, 0, .2 + i * 2.1, 1.9 + i * 2.1); ctx.stroke(); }
  }
  textAt(player.id === 'cyan' ? 'YOU' : 'RIVAL', 0, -177, 14, colors[player.id]);
  if (player.stunRemainingMs) textAt(flight ? 'REBOOT' : 'STUNNED', 0, -195, 12, '#ffc573');
  ctx.restore();
}
function render(time) {
  const [me, rival] = state.players;
  const segment = track.segments[me.segmentId]; const flight = me.mode === 'flight'; const half = segment.laneCount / 2;
  ctx.fillStyle = '#0b1523'; ctx.fillRect(0, 0, 1100, 650);
  const backdrop = art[segment.stage];
  if (backdrop.complete && backdrop.naturalWidth) {
    if (flight) ctx.drawImage(backdrop, backdrop.naturalWidth * .19, backdrop.naturalHeight * .05,
      backdrop.naturalWidth * .62, backdrop.naturalHeight * .73, 0, 0, 1100, 650);
    else ctx.drawImage(backdrop, 0, 0, 1100, 650);
  }
  const fade = ctx.createLinearGradient(0, 100, 0, 650); fade.addColorStop(0, '#08101c10'); fade.addColorStop(1, flight ? '#050c1d44' : '#08101cb8');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, 1100, 650);
  if (!flight) {
    polygon([point(-half, 45), point(half, 45), point(half, -2), point(-half, -2)], segment.stage === 'downtown' ? '#344858ec' : '#182637ed');
    for (const edge of [-half, half]) polygon([point(edge - .025, 45), point(edge + .025, 45), point(edge + .025, -2), point(edge - .025, -2)], '#c7ab6f');
  }
  for (let d = Math.ceil(me.distance / 3) * 3; d < me.distance + 45; d += 3) {
    const z = d - me.distance;
    for (let lane = 1; lane < segment.laneCount; lane++) line(lane - half - .013, lane - half + .013, z, flight ? '#b1c9ff22' : '#a7b8c177');
    if (flight) for (let level = 0; level < 3; level++) {
      line(-half, -half + .12, z, '#bacbff66', level); line(half - .12, half, z, '#bacbff66', level);
    }
  }
  drawScenery(segment, me);
  const end = segment.length - me.distance;
  if (end < 35) {
    line(-half, half, end, segment.exits ? '#ffb761' : '#a1ffdf');
    const [x, y] = point(0, Math.max(1, end));
    textAt(segment.sign || (segment.exits ? 'ROUTES MERGE AHEAD' : 'FINISH'), x, y - 100, 15, '#ffdda3');
  }
  if (flight) { for (let level = 0; level < 3; level++) { const [x, y] = point(-2.4, 0, level); textAt(['LOW', 'MID', 'HIGH'][level], x, y - 25, 12, me.altitude === level ? '#fff2c7' : '#8093b1'); } }
  const removed = new Set(state.removedObjectIds);
  const visible = segment.objects.filter(o => o.distance >= me.distance && o.distance < me.distance + 45 && !removed.has(o.id)).map(object => ({ object, z: object.distance - me.distance }));
  if (rival.segmentId === me.segmentId && rival.distance - me.distance > -2 && rival.distance - me.distance < 45) visible.push({ player: rival, z: rival.distance - me.distance });
  visible.push({ player: me, z: 0 });
  visible.sort((a, b) => b.z - a.z);
  for (const item of visible) item.player ? drawPlayer(item.player, item.z, segment, time) : drawObject(item.object, item.z, segment, time);
  for (const shot of state.projectiles) {
    const z = shot.distance - me.distance;
    if (shot.segmentId !== me.segmentId || z < 0 || z > 45) continue;
    const [x, y, size] = point(shot.lane - (segment.laneCount - 1) / 2, z, flight ? shot.altitude : 0);
    ctx.fillStyle = '#fff7b4'; ctx.fillRect(x - 2 * size, y - 43 * size, 4 * size, 21 * size);
  }
}
function updateHud() {
  const me = state.players[0]; const base = track.segments[track.startSegmentId].progress[0];
  for (const player of state.players) {
    $(player.id + '-coins').textContent = `${player.coins} coins`;
    $(player.id + '-shield').textContent = `Shield ${player.shield} / ${player.maxShield}`;
    $(player.id + '-ammo').textContent = `Ammo ${player.ammo} / 3${player.ammoRefillMs === null ? '' : ' · ' + (player.ammoRefillMs / 1000).toFixed(1) + 's'}`;
    $(player.id + '-progress').style.width = `${Math.min(100, (player.progress - base) / (track.finishProgress - base) * 100)}%`;
    $(player.id + '-state').textContent = `${track.segments[player.segmentId].name} · lane ${player.lane + 1}${player.mode === 'flight' ? ' · ' + ['low', 'middle', 'high'][player.altitude] : ''}${player.stunRemainingMs ? ' · recovering' : ''}`;
  }
  $('route').textContent = track.segments[me.segmentId].name;
  const seconds = Math.ceil(state.remainingMs / 1000); $('clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('cheat').textContent = me.cheatActive ? 'Cheat on' : 'Cheat off';
  const segment = track.segments[me.segmentId];
  const choices = new Map();
  segment.exits?.forEach(([id], lane) => {
    if (!choices.has(id)) choices.set(id, []);
    choices.get(id).push(lane);
  });
  $('route-guide').replaceChildren();
  if (choices.size > 1 && segment.length - me.distance < 35) {
    for (const [id, lanes] of choices) {
      const choice = document.createElement('span');
      choice.classList.toggle('chosen', lanes.includes(me.lane));
      const label = lanes.map(lane => lane + 1).join('/');
      choice.textContent = `Lane ${label}: ${track.segments[id].name}`;
      $('route-guide').append(choice);
    }
  }
  document.querySelectorAll('[data-stage]').forEach(el => el.classList.toggle('active', el.dataset.stage === me.stage));
}
function botInput() {
  const bot = state.players[1]; const segment = track.segments[bot.segmentId]; const removed = new Set(state.removedObjectIds);
  const ahead = segment.objects.filter(o => !removed.has(o.id) && o.distance > bot.distance && o.distance - bot.distance < 9).sort((a, b) => a.distance - b.distance);
  const hazard = ahead.find(o => o.type === 'barrier' && o.lane === bot.lane && (bot.mode !== 'flight' || (o.altitude ?? 1) === bot.altitude) && o.distance - bot.distance < 4);
  const coin = ahead.find(o => o.type === 'coin');
  let targetLane = coin ? coin.lane : Math.min(2, segment.laneCount - 1);
  if (hazard) targetLane = bot.lane === 0 ? 1 : bot.lane - 1;
  if (targetLane !== bot.lane) race.applyInput(bot.id, targetLane > bot.lane ? 'right' : 'left');
  if (coin && bot.mode === 'flight' && coin.altitude !== bot.altitude) race.applyInput(bot.id, coin.altitude > bot.altitude ? 'up' : 'down');
  if (ahead.some(o => o.type === 'crate' && o.lane === bot.lane && (bot.mode !== 'flight' || o.altitude === bot.altitude))) race.applyInput(bot.id, 'fire');
}
function finish() {
  running = false; $('course').disabled = false; $('overlay').hidden = false;
  $('overlay-title').textContent = state.results[0].rank === state.results[1].rank ? 'A shared finish.' : state.results[0].id === 'cyan' ? 'You take the race.' : 'The rival takes the race.';
  $('overlay-copy').textContent = 'Finishers rank first. Coins plus the six-point first-finish bonus decide the winner.';
  $('results').replaceChildren();
  for (const result of state.results) { const row = document.createElement('div'); row.textContent = `${result.rank}. ${result.name} · ${result.score} points · ${result.finishTimeMs === null ? 'DNF' : (result.finishTimeMs / 1000).toFixed(1) + 's'}${result.usedCheat ? ' · used cheat' : ''}`; $('results').append(row); }
  $('results').hidden = false; $('start').textContent = 'Race again ↗';
  $('message').textContent = 'Race complete. Choose another stage or race again.';
}
function tick() {
  botInput(); state = race.step();
  for (const event of state.events.filter(e => e.playerId === 'cyan')) {
    if (event.type === 'impact') $('message').textContent = event.stunned ? 'Shield broken. Recovering…' : 'Shield absorbed an impact.';
    if (event.type === 'coinCollected') $('message').textContent = 'Coin claimed. Your rival cannot collect it now.';
    if (event.type === 'stageChanged') $('message').textContent = `Entering ${fullCourse.stages[event.stage].name}.`;
    if (event.type === 'launched') $('message').textContent = 'Launched. W/S changes altitude. Your shuttle has a fresh shield and basic gun.';
  }
  updateHud(); if (state.status === 'ended') finish();
}
function start() { reset(); running = true; $('overlay').hidden = true; $('course').disabled = true; $('message').textContent = 'Race started. Look for route signs before each gate.'; canvas.focus(); }
function input(action) { if (running) race.applyInput('cyan', action); }
$('start').addEventListener('click', start); $('restart').addEventListener('click', start);
$('course').addEventListener('change', () => {
  reset(); $('overlay-title').textContent = 'Ready for the next route.';
  $('overlay-copy').textContent = 'Choose your lanes, clear breakable obstacles and collect coins.';
  $('start').textContent = 'Start race ↗';
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  input(button.dataset.action); canvas.focus();
}));
canvas.addEventListener('pointerdown', () => { input('fire'); canvas.focus(); });
const keys = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', c: 'toggleCheat', ' ': 'fire' };
window.addEventListener('keydown', event => {
  if (['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  const action = keys[event.key.toLowerCase()]; if (!running || !action) return;
  event.preventDefault(); if (!event.repeat) input(action);
});
function frame(time) {
  if (running) { lag += Math.min(time - lastTime, 250); while (running && lag >= TICK_MS) { tick(); lag -= TICK_MS; } }
  lastTime = time; render(time); requestAnimationFrame(frame);
}
reset(); requestAnimationFrame(frame);
