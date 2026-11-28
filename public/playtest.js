'use strict';
const { createRace, TICK_MS, track: fullCourse } = window.previewRace;
const $ = id => document.getElementById(id);
const canvas = $('track');
const renderer = window.createRaceRenderer(canvas);
const raceAudio = window.createRaceAudio();
let track, race, state, running = false, lastTime = 0, lag = 0, resultsPending = false;

function selectedTrack() {
  const result = structuredClone(fullCourse);
  const selection = $('course').value;
  if (selection === 'full') return result;
  result.startSegmentId = ({ slums: 'slums-basin', downtown: 'downtown-plaza', spaceport: 'spaceport-hangar', orbit: 'orbit-debris', atmosphere: 'orbit-launch' })[selection];
  const include = segment => selection === 'orbit' ? segment.flightPhase === 'orbit' : selection === 'atmosphere' ? segment.mode === 'flight' : segment.stage === selection;
  result.segments = Object.fromEntries(Object.entries(result.segments).filter(([, segment]) => include(segment)));
  for (const segment of Object.values(result.segments)) {
    if (segment.exits?.some(([id]) => !result.segments[id])) { delete segment.exits; segment.sign = 'STAGE FINISH'; }
  }
  result.finishProgress = Math.max(...Object.values(result.segments).map(s => s.progress[1]));
  return result;
}
function reset() {
  resultsPending=false;
  track = selectedTrack();
  race = createRace({ players: [{ id: 'cyan', name: 'You' }, { id: 'magenta', name: 'Rival' }], track, practice: true });
  state = race.getSnapshot(); lag = 0;
  $('results').hidden = true;
  const { shortest, longest } = track.pacing.cleanRouteSeconds;
  $('course-info').textContent = $('course').value === 'full'
    ? `20 shared coins · ${shortest} seconds before impacts` : 'Stage practice · fresh gun and shield';
  $('message').textContent = 'Ready. Steer around obstacles and fire to clear crates.';
  updateHud();
}
function render(time) { renderer.draw(track, state, 'cyan', time, running); }
function updateHud() {
  const me = state.players[0]; const base = track.segments[track.startSegmentId].progress[0];
  for (const player of state.players) {
    $(player.id + '-coins').textContent = `${player.coins} coins`;
    $(player.id + '-shield').textContent = `Shield ${player.shield} / ${player.maxShield}`;
    $(player.id + '-ammo').textContent = `Ammo ${player.ammo} / 3${player.ammoRefillMs === null ? '' : ' · ' + (player.ammoRefillMs / 1000).toFixed(1) + 's'}`;
    $(player.id + '-progress').style.width = `${Math.min(100, (player.progress - base) / (track.finishProgress - base) * 100)}%`;
    $(player.id + '-state').textContent = `${track.segments[player.segmentId].name} · lane ${player.lane + 1}${player.mode === 'flight' ? (track.segments[player.segmentId].flightPhase === 'atmosphere' ? ' · ascending' : ' · ' + ['low', 'middle', 'high'][player.altitude]) : ''}${player.immunityActive ? (player.boostActive ? ' · IMMUNE / 1.5×' : ' · IMMUNE') : ''}${player.stunRemainingMs ? ' · recovering' : ''}`;
  }
  document.querySelectorAll('[data-action]').forEach(button => { if (['up','down'].includes(button.dataset.action)) button.disabled = me.mode !== 'flight' || track.segments[me.segmentId].flightPhase === 'atmosphere'; });
  $('route').textContent = track.segments[me.segmentId].name;
  const seconds = Math.ceil(state.remainingMs / 1000); $('clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('cheat').disabled = me.immunityActive;
  $('cheat').textContent = me.cheatActive ? 'Cheat on' : 'Cheat off';
  document.querySelectorAll('[data-stage]').forEach(el => el.classList.toggle('active', el.dataset.stage === me.stage));
}
function botInput() {
  const bot = state.players[1]; const segment = track.segments[bot.segmentId]; const removed = new Set(state.removedObjectIds);
  const ahead = segment.objects.filter(o => !removed.has(o.id) && o.distance > bot.distance && o.distance - bot.distance < 9).sort((a, b) => a.distance - b.distance);
  const hazard = ahead.find(o => o.type === 'barrier' && window.RaceMotion.occupiesLane(o, bot.lane, state.elapsedMs + (o.distance-bot.distance)/track.cruiseSpeed*1000, segment.laneCount) && (bot.mode !== 'flight' || (o.altitude ?? 1) === bot.altitude) && o.distance - bot.distance < 4);
  const coin = ahead.find(o => o.type === 'coin');
  let targetLane = coin ? coin.lane : Math.min(2, segment.laneCount - 1);
  if (hazard) targetLane = bot.lane === 0 ? 1 : bot.lane - 1;
  if (targetLane !== bot.lane) race.applyInput(bot.id, targetLane > bot.lane ? 'right' : 'left');
  if (coin && bot.mode === 'flight' && segment.flightPhase !== 'atmosphere' && coin.altitude !== bot.altitude) race.applyInput(bot.id, coin.altitude > bot.altitude ? 'up' : 'down');
  if (ahead.some(o => o.type === 'crate' && o.lane === bot.lane && (bot.mode !== 'flight' || o.altitude === bot.altitude))) race.applyInput(bot.id, 'fire');
}
function finish() {
  running = false; resultsPending=true; $('course').disabled = true; $('overlay').hidden = true;
  $('overlay-title').textContent = state.results[0].rank === state.results[1].rank ? 'A shared finish.' : state.results[0].id === 'cyan' ? 'You take the race.' : 'The rival takes the race.';
  $('overlay-copy').textContent = 'Finishers rank first. Coins plus the six-point first-finish bonus decide the winner.';
  $('results').replaceChildren();
  for (const result of state.results) { const row = document.createElement('div'); row.textContent = `${result.rank}. ${result.name} · ${result.score} points · ${result.finishTimeMs === null ? 'DNF' : (result.finishTimeMs / 1000).toFixed(1) + 's'}${result.usedCheat ? ' · used cheat' : ''}`; $('results').append(row); }
  $('results').hidden = false; $('start').textContent = 'Race again ↗';
  $('message').textContent = 'Race complete. Choose another stage or race again.';
}
function tick() {
  botInput(); state = race.step();
  raceAudio.playEvents(state.events, 'cyan', track);
  for (const event of state.events.filter(e => e.playerId === 'cyan')) {
    if (event.type === 'impact') $('message').textContent = event.stunned ? 'Shield broken. Recovering…' : 'Shield absorbed an impact.';
    if (event.type === 'coinCollected') $('message').textContent = 'Coin claimed. Your rival cannot collect it now.';
    if (event.type === 'stageChanged') $('message').textContent = `Entering ${fullCourse.stages[event.stage].name}.`;
    if (event.type === 'orbitEntered') $('message').textContent = 'Orbit reached. W/S altitude unlocked; you enter on MID. A/D keeps steering.';
    if (event.type === 'launched') $('message').textContent = 'Launched into atmosphere. A/D dodges crossing ships; W/S unlocks on reaching orbit.';
  }
  updateHud(); if (state.status === 'ended') finish();
}
function start() { raceAudio.unlock(); reset(); running = true; $('overlay').hidden = true; $('course').disabled = true; $('message').textContent = 'Race started. Stay alert for obstacles ahead.'; canvas.focus(); }
function input(action) { raceAudio.unlock(); if (running) race.applyInput('cyan', action); }
$('start').addEventListener('click', start); $('restart').addEventListener('click', start);
$('course').addEventListener('change', () => {
  reset(); $('overlay-title').textContent = 'Ready for the next stage.';
  $('overlay-copy').textContent = 'Choose your lanes, clear breakable obstacles and collect coins.';
  $('start').textContent = 'Start race ↗';
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  input(button.dataset.action); canvas.focus();
}));
canvas.addEventListener('pointerdown', () => { input('fire'); canvas.focus(); });
const keys = { a: 'left', d: 'right', w: 'up', s: 'down', c: 'toggleCheat', f: 'fire', l: 'enableImmunity', ' ': 'boostStart' };
window.addEventListener('keydown', event => {
  if (['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  const action = keys[event.key.toLowerCase()]; if (!running || !action) return;
  event.preventDefault(); if (!event.repeat) input(action);
});
window.addEventListener('keyup', event => { if(event.key===' '){event.preventDefault();input('boostEnd');} });
window.addEventListener('blur', () => input('boostEnd'));
document.addEventListener('visibilitychange', () => { if(document.hidden)input('boostEnd'); });
function frame(time) {
  if (running) { lag += Math.min(time - lastTime, 250); while (running && lag >= TICK_MS) { tick(); lag -= TICK_MS; } }
  lastTime = time; render(time);
  if(resultsPending && !renderer.isDocking(time)){resultsPending=false;$('course').disabled=false;$('overlay').hidden=false;}
  requestAnimationFrame(frame);
}
reset(); requestAnimationFrame(frame);
