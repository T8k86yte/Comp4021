const test = require('node:test');
const assert = require('node:assert/strict');
const { createRace } = require('./');
const course = require('./full-course.json');
const players = [{ id: 'cyan' }, { id: 'magenta' }];
const advance = (race, count) => { for (let i = 0; i < count; i++) race.step(); return race.getSnapshot(); };
function straight(objects = [], mode = 'ground', length = 80) {
  return { id: 'combat', startSegmentId: 'road', segments: {
    road: { stage: 'slums', mode, length, laneCount: 4, progress: [0, length], objects }
  } };
}

test('all authored routes converge, have 20 coins, and leave time for the finish window under three minutes', () => {
  const counts = {};
  for (const segment of Object.values(course.segments)) {
    counts[segment.stage] = (counts[segment.stage] || 0) + segment.objects.filter(o => o.type === 'coin').length;
    assert.ok(segment.objects.every(o => o.distance >= 6), 'provide approach time');
  }
  assert.deepEqual(counts, { slums: 6, downtown: 7, spaceport: 7 });
  const lengths = [];
  const reached = new Set();
  function walk(id, distance, route) {
    assert.ok(!route.includes(id), 'no track cycle');
    reached.add(id);
    const segment = course.segments[id];
    const total = distance + segment.length;
    if (!segment.exits) { lengths.push(total); assert.equal(id, 'orbit-dock'); return; }
    for (const next of new Set(segment.exits.map(e => e[0]))) walk(next, total, [...route, id]);
  }
  walk(course.startSegmentId, 0, []);
  assert.equal(reached.size, Object.keys(course.segments).length);
  assert.equal(Math.min(...lengths) / 5, 141);
  assert.equal(Math.max(...lengths) / 5, 153);
  assert.equal(course.pacing.cleanRouteSeconds.shortest, Math.min(...lengths) / 5);
  assert.equal(course.pacing.cleanRouteSeconds.longest, Math.max(...lengths) / 5);
  assert.ok(Math.max(...lengths) / 5 + 15 < course.pacing.roundLimitSeconds);
  // Actually drive every fork combination through the engine, with hazards removed.
  for (const slumsLane of [0, 1]) for (const cityLane of [0, 1, 3]) for (const orbitLane of [0, 1]) {
    const clear = structuredClone(course);
    Object.values(clear.segments).forEach(s => { s.objects = []; });
    const race = createRace({ players, track: clear });
    const stageSeconds = {};
    let currentStage = 'slums';
    let stageStartedAt = 0;
    let state;
    for (let tick = 0; tick < 3600; tick++) {
      for (const player of race.getSnapshot().players) {
        const target = ({ 'slums-basin': slumsLane, 'downtown-plaza': cityLane, 'orbit-launch': orbitLane })[player.segmentId];
        if (target !== undefined && target !== player.lane) race.applyInput(player.id, target < player.lane ? 'left' : 'right');
      }
      state = race.step();
      if (state.players[0].stage !== currentStage) {
        stageSeconds[currentStage] = (state.elapsedMs - stageStartedAt) / 1000;
        currentStage = state.players[0].stage;
        stageStartedAt = state.elapsedMs;
      }
      if (state.status === 'ended') break;
    }
    const expected = (slumsLane === 0 ? 210 : 220) + (cityLane === 0 ? 220 : cityLane === 3 ? 255 : 240) + (orbitLane === 0 ? 290 : 275);
    assert.deepEqual(state.players.map(p => p.finishTimeMs), [expected * 200, expected * 200]);
    assert.ok(state.players.every(p => p.mode === 'flight' && p.progress === course.finishProgress));
    stageSeconds[currentStage] = (state.elapsedMs - stageStartedAt) / 1000;
    assert.deepEqual(stageSeconds, { slums: slumsLane === 0 ? 42 : 44,
      downtown: cityLane === 0 ? 44 : cityLane === 3 ? 51 : 48,
      spaceport: orbitLane === 0 ? 58 : 55 });
    if (slumsLane === 1 && cityLane === 1 && orbitLane === 1) {
      assert.equal(state.elapsedMs / 1000, course.pacing.cleanRouteSeconds.main);
    }
  }
});

test('the basic gun fires along its lane, clears one crate, and cannot hurt the rival or collect coins', () => {
  const race = createRace({ players, track: straight([
    { id: 'coin', type: 'coin', lane: 1, distance: 1 },
    { id: 'box', type: 'crate', lane: 1, distance: 3 },
    { id: 'second', type: 'crate', lane: 1, distance: 5 }
  ]) });
  race.applyInput('magenta', 'left');
  assert.equal(race.applyInput('cyan', 'fire'), true);
  assert.equal(race.applyInput('cyan', 'fire'), false);
  const fired = race.step();
  assert.equal(fired.players[0].ammo, 2);
  assert.equal(fired.players[0].ammoRefillMs, 1000);
  assert.equal(fired.projectiles.length, 1);
  fired.projectiles[0].lane = 99;
  assert.equal(race.getSnapshot().projectiles[0].lane, 1);
  const hit = advance(race, 3);
  assert.ok(hit.removedObjectIds.includes('box'));
  assert.ok(!hit.removedObjectIds.includes('second'));
  assert.deepEqual(hit.players.map(p => p.shield), [3, 3]);
  assert.equal(hit.players.reduce((n, p) => n + p.coins, 0), 1);
  assert.equal(hit.projectiles.length, 0);
});

test('ammo refills one round per second without restarting the existing timer', () => {
  const race = createRace({ players, track: straight() });
  race.applyInput('cyan', 'fire'); race.step();
  assert.equal(race.applyInput('cyan', 'fire'), false);
  advance(race, 4);
  race.applyInput('cyan', 'fire'); race.step();
  advance(race, 4);
  race.applyInput('cyan', 'fire'); race.step();
  assert.equal(race.getSnapshot().players[0].ammo, 0);
  assert.equal(race.applyInput('cyan', 'fire'), false);
  assert.equal(advance(race, 9).players[0].ammo, 0);
  assert.equal(race.step().players[0].ammo, 1);
  assert.equal(advance(race, 20).players[0].ammo, 2);
  assert.equal(advance(race, 20).players[0].ammo, 3);
  assert.equal(race.getSnapshot().players[0].ammoRefillMs, null);
});

test('walls block shots; phase and disconnect clear or reject firing', () => {
  const race = createRace({ players, track: straight([
    { id: 'wall', type: 'barrier', lane: 1, distance: 1 },
    { id: 'box', type: 'crate', lane: 1, distance: 2 }
  ]) });
  race.applyInput('cyan', 'fire');
  const hit = advance(race, 4);
  assert.equal(hit.players[0].phaseRemainingMs, 500);
  assert.equal(race.applyInput('cyan', 'fire'), false);
  assert.deepEqual(hit.removedObjectIds, []);
  const fresh = createRace({ players, track: straight() });
  fresh.applyInput('cyan', 'fire'); fresh.setConnected('cyan', false); fresh.setConnected('cyan', true);
  assert.equal(fresh.step().players[0].ammo, 3);
});

test('flight altitude selects collisions and shots, and launches happen independently', () => {
  const race = createRace({ players, track: straight([
    { id: 'middle', type: 'crate', lane: 1, distance: 2, altitude: 1 },
    { id: 'top', type: 'crate', lane: 1, distance: 3, altitude: 2 }
  ], 'flight') });
  assert.equal(race.applyInput('cyan', 'up'), true);
  race.applyInput('cyan', 'fire');
  const state = advance(race, 8);
  assert.equal(state.players[0].altitude, 2);
  assert.equal(state.players[0].shield, 100);
  assert.deepEqual(state.removedObjectIds, ['top']);
  const clear = structuredClone(course);
  clear.startSegmentId = 'spaceport-hangar';
  Object.values(clear.segments).forEach(s => { s.objects = []; });
  const launch = createRace({ players, track: clear, practice: true });
  assert.equal(launch.applyInput('cyan', 'up'), false);
  launch.applyInput('cyan', 'toggleCheat');
  const split = advance(launch, 130);
  assert.deepEqual(split.players.map(p => p.mode), ['flight', 'ground']);
  assert.deepEqual(split.players.map(p => p.maxShield), [100, 3]);
  assert.ok(split.events.some(e => e.type === 'launched'));
});

test('a broken orbital shield stops for 2.5 seconds and fully restores with recovery immunity', () => {
  const race = createRace({ players, track: straight([3, 9, 15, 21, 22].map((distance, index) => ({
    id: `hull-${index}`, type: 'barrier', distance, lane: 1, altitude: 1
  })), 'flight') });
  let hit;
  for (let i = 0; i < 300; i++) { hit = race.step(); if (hit.players[0].shield === 0) break; }
  assert.equal(hit.players[0].stunRemainingMs, 2500);
  assert.equal(hit.players[0].distance, 21);
  assert.equal(race.applyInput('cyan', 'up'), false);
  assert.equal(race.applyInput('cyan', 'fire'), false);
  assert.equal(advance(race, 49).players[0].shield, 0);
  const restored = race.step().players[0];
  assert.equal(restored.shield, 100);
  assert.equal(restored.distance, 21);
  assert.equal(restored.recoveryRemainingMs, 1000);
  assert.equal(advance(race, 8).players[0].shield, 100);
});

test('shots expire at their range and cannot cross a stage or launch boundary', () => {
  const distant = createRace({ players, track: straight([{ id: 'far', type: 'crate', lane: 1, distance: 13 }]) });
  distant.applyInput('cyan', 'fire');
  const expired = advance(distant, 16);
  assert.equal(expired.projectiles.length, 0);
  assert.deepEqual(expired.removedObjectIds, []);
  for (const destination of [{ stage: 'downtown', mode: 'ground' }, { stage: 'slums', mode: 'flight' }]) {
    const map = straight([], 'ground', 2);
    map.segments.road.exits = [0, 1, 2, 3].map(lane => ['next', lane]);
    map.segments.next = { ...destination, length: 20, laneCount: 4, progress: [2, 22],
      objects: [{ id: 'next-box', type: 'crate', lane: 1, distance: 1 }] };
    const race = createRace({ players, track: map });
    race.applyInput('cyan', 'fire');
    const boundary = advance(race, 4);
    assert.equal(boundary.projectiles.length, 0);
    assert.deepEqual(boundary.removedObjectIds, []);
  }
});

test('shots take the firing lane exit and destroy terrain on that route only', () => {
  const map = straight([], 'ground', 2);
  map.segments.road.exits = [['left', 0], ['right', 0], ['right', 0], ['right', 0]];
  for (const id of ['left', 'right']) map.segments[id] = { stage: 'slums', mode: 'ground', laneCount: 1,
    length: 20, progress: [2, 22], objects: [{ id: `${id}-box`, type: 'crate', lane: 0, distance: 1 }] };
  const race = createRace({ players, track: map });
  race.applyInput('cyan', 'left'); race.applyInput('cyan', 'fire');
  const state = advance(race, 4);
  assert.deepEqual(state.removedObjectIds, ['left-box']);
});
