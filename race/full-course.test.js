const test = require('node:test');
const assert = require('node:assert/strict');
const { createRace } = require('./');
const course = require('./full-course.json');
const { occupiesLane } = require('../public/js/race-motion');
const players = [{ id: 'cyan' }, { id: 'magenta' }];
const advance = (race, count) => { for (let i = 0; i < count; i++) race.step(); return race.getSnapshot(); };
function straight(objects = [], mode = 'ground', length = 80) {
  return { id: 'combat', startSegmentId: 'road', segments: {
    road: { stage: 'slums', mode, length, laneCount: 4, progress: [0, length], objects }
  } };
}

test('the full course has one continuous four-lane route, twenty coins and 73.5-second pacing', () => {
  let id=course.startSegmentId, distance=0; const visited=new Set(), counts={};
  while(id){
    assert.ok(!visited.has(id));visited.add(id);const segment=course.segments[id];
    assert.equal(segment.laneCount,4);distance+=segment.length;
    counts[segment.stage]=(counts[segment.stage]||0)+segment.objects.filter(o=>o.type==='coin').length;
    if(!segment.exits){assert.equal(id,'orbit-dock');break;}
    assert.equal(new Set(segment.exits.map(exit=>exit[0])).size,1);
    segment.exits.forEach((exit,lane)=>assert.equal(exit[1],lane));id=segment.exits[0][0];
  }
  assert.equal(visited.size,Object.keys(course.segments).length);
  assert.equal(course.cruiseSpeed,10);
  assert.deepEqual(counts,{slums:6,downtown:7,spaceport:7});assert.equal(distance/course.cruiseSpeed,73.5);
  const clear=structuredClone(course);Object.values(clear.segments).forEach(s=>s.objects=[]);
  const race=createRace({players,track:clear});let state;
  for(let i=0;i<3600;i++){state=race.step();if(state.status==='ended')break;}
  assert.deepEqual(state.players.map(p=>p.finishTimeMs),[73500,73500]);
  assert.ok(state.players.every(p=>p.mode==='flight'&&p.progress===735));
});

test('sparse encounters leave wide escape corridors and at least 1.6 seconds between rows', () => {
  const rows = new Map();
  let count = 0;
  for (const segment of Object.values(course.segments)) {
    for (const object of segment.objects.filter(o => o.type !== 'coin')) {
      count++;
      const progress = segment.progress[0] + object.distance;
      if (!rows.has(progress)) rows.set(progress, { segment, objects: [] });
      rows.get(progress).objects.push(object);
      if (segment.mode === 'flight') assert.equal(object.type, segment.flightPhase === 'atmosphere' ? 'barrier' : 'crate');
    }
  }
  assert.equal(count, 56, 'sparse layout replaces the previous 129 obstacles');
  let previous = -Infinity;
  for (const [progress, { segment, objects }] of [...rows].sort((a, b) => a[0] - b[0])) {
    assert.ok((progress - previous) / course.cruiseSpeed >= 1.6, 'reaction gap also spans segment boundaries');
    previous = progress;
    assert.ok(objects.length <= 2, 'at most two props in an encounter');
    assert.ok(objects.filter(o => o.type === 'barrier').length <= 1, 'never stack unbreakable walls or ships');
    if (segment.flightPhase === 'atmosphere') {
      assert.equal(objects.length, 1);
      const hull = objects[0];
      // Cover every point in the moving hull cycle, including turnaround.
      for (let ms = 0; ms <= hull.motion.periodMs; ms += 25) {
        assert.ok([0, 1, 2, 3].filter(lane => occupiesLane(hull, lane, ms)).length <= 1);
      }
      continue;
    }
    const levels = segment.mode === 'flight' ? [0, 1, 2] : [0];
    for (const altitude of levels) {
      const blocked = new Set(objects.filter(o => (o.altitude ?? 0) === altitude).map(o => o.lane));
      assert.ok([0, 1, 2].some(lane => !blocked.has(lane) && !blocked.has(lane + 1)),
        'two adjacent lanes stay open at every altitude, even without breaking crates');
    }
    if (segment.mode === 'flight') {
      assert.ok(levels.some(altitude => objects.every(o => o.altitude !== altitude)), 'one whole altitude stays empty');
    }
  }
});

test('both seats can dodge every obstacle without shooting or cheats, with at most two inputs per second', () => {
  const hazards = Object.values(course.segments).flatMap(segment => segment.objects
    .filter(o => o.type !== 'coin').map(object => ({ object, segment, progress: segment.progress[0] + object.distance })))
    .sort((a, b) => a.progress - b.progress);
  for (const seat of [0, 1]) {
    // Delayed starts vary traffic arrival across a full 6-second hull cycle.
    for (let delayMs = 0; delayMs < 6000; delayMs += 250) {
      const race = createRace({ players, track: course });
      players.forEach(p => race.setConnected(p.id, false));
      advance(race, delayMs / 50);
      const id = players[seat].id;
      race.setConnected(id, true); // Rival cannot destroy obstacles for this run.
      let state = race.getSnapshot(), impacts = 0;
      for (let tick = 0; tick < 1600 && state.players[seat].finishTimeMs === null; tick++) {
        const player = state.players[seat];
        if (tick % 10 === 0) {
          const ahead = hazards.filter(h => h.progress >= player.progress && h.progress - player.progress <= 14);
          // Look into the next segment as the renderer does. Launch enters MID.
          const blocked = lane => ahead.some(({ object, segment, progress }) => {
            const altitude = segment.mode !== 'flight' ? 0 : player.mode === 'ground' ? 1 : player.altitude;
            const at = state.elapsedMs + (progress - player.progress) / course.cruiseSpeed * 1000;
            return (object.altitude ?? 0) === altitude && occupiesLane(object, lane, at, segment.laneCount);
          });
          if (blocked(player.lane)) {
            const free = [0, 1, 2, 3].filter(lane => !blocked(lane))
              .sort((a, b) => Math.abs(a - player.lane) - Math.abs(b - player.lane));
            assert.ok(free.length, 'a visible escape lane exists');
            race.applyInput(id, free[0] < player.lane ? 'left' : 'right');
          }
        }
        state = race.step();
        impacts += state.events.filter(e => e.type === 'impact' && e.playerId === id).length;
      }
      assert.equal(impacts, 0, `seat ${seat}, delay ${delayMs} has a reachable damage-free route`);
      assert.equal(state.players[seat].finishTimeMs, delayMs + 73500);
      assert.equal(state.players[seat].usedCheat, false);
      assert.equal(state.players[seat].ammo, 3);
      assert.ok(hazards.every(h => !state.removedObjectIds.includes(h.object.id)), 'all obstacles stayed intact');
    }
  }
});

test('gate passages have clear blackout space and preserve a lead across each independent transition', () => {
  const gates=Object.entries(course.segments).filter(([,segment])=>segment.gate);
  assert.equal(gates.length,4);
  for(const [id,segment] of gates){
    const clearEnd=segment.gate.kind==='dock'?8:1.6;
    assert.ok(segment.objects.every(o=>o.distance<segment.length-clearEnd),id+' has a clear passage');
    if(!segment.exits)continue;
    const destination=segment.exits[0][0];
    assert.ok(course.segments[destination].objects.every(o=>o.distance>3.6),'arrival fade ends before any objects');
    const clear=structuredClone(course);clear.startSegmentId=id;
    Object.values(clear.segments).forEach(s=>s.objects=[]);
    const race=createRace({players,track:clear});
    race.setConnected('magenta',false);advance(race,24);race.setConnected('magenta',true);
    const gap=course.cruiseSpeed*24*.05;let mixed=false,state;
    for(let n=0;n<500;n++){
      state=race.step();
      assert.equal(state.players[0].progress-state.players[1].progress,gap,'gate never teleports or waits for the other player');
      mixed ||= state.players[0].segmentId===destination && state.players[1].segmentId===id;
      if(state.players[1].segmentId===destination)break;
    }
    assert.ok(mixed,id+' lets the leader enter while the other player is still outside');
    assert.ok(state.players.every(p=>p.segmentId===destination));
  }
});

test('timely dodging and shooting clears the course faster than coasting from either seat', () => {
  for (const seat of [0, 1]) {
    const race = createRace({ players, track: course });
    let state = race.getSnapshot(), carefulImpacts = 0;
    for (let tick = 0; tick < 3600 && state.status !== 'ended'; tick++) {
      const player = state.players[seat], segment = course.segments[player.segmentId];
      const removed = new Set(state.removedObjectIds);
      const hazards = segment.objects.filter(object => object.type !== 'coin' && !removed.has(object.id) &&
        object.distance >= player.distance && object.distance - player.distance < 4 &&
        (player.mode !== 'flight' || object.altitude === player.altitude)).sort((a,b) => a.distance-b.distance);
      const blocksLane = (object,lane) => occupiesLane(object,lane,state.elapsedMs + (object.distance-player.distance)/course.cruiseSpeed*1000,segment.laneCount);
      const threat = hazards.find(object => blocksLane(object,player.lane));
      if (threat && !(threat.type === 'crate' && race.applyInput(player.id, 'fire'))) {
        const free = [0,1,2,3].filter(lane => !hazards.some(object => blocksLane(object,lane) && object.distance <= threat.distance))
          .sort((a,b) => Math.abs(a-player.lane)-Math.abs(b-player.lane));
        if (free.length) {
          const direction = Math.sign(free[0] - player.lane);
          // Reaching a distant escape lane still crosses the adjacent lane:
          // wait for its near obstacle to pass before beginning that dodge.
          const blocked = hazards.some(object => blocksLane(object,player.lane + direction) &&
            object.distance <= player.distance + course.cruiseSpeed * .05);
          if (!blocked) race.applyInput(player.id, direction < 0 ? 'left' : 'right');
        }
      }
      state = race.step();
      carefulImpacts += state.events.filter(event => event.type === 'impact' && event.playerId === player.id).length;
    }
    assert.equal(carefulImpacts, 0, 'there is a reachable, damage-free path without cheats');
    assert.equal(state.players[seat].finishTimeMs, 73500);
    const coastingFinish = state.players[1-seat].finishTimeMs;
    assert.ok(coastingFinish === null || coastingFinish > state.players[seat].finishTimeMs);
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
  const split = advance(launch, 65 / (clear.cruiseSpeed * 2) * 20);
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
  const distant = createRace({ players, track: straight([{ id: 'far', type: 'crate', lane: 1, distance: 73 }], 'ground', 120) });
  distant.applyInput('cyan', 'fire');
  const visible = advance(distant, 24);
  assert.ok(visible.projectiles[0].distance-visible.players[0].distance>=45, 'laser reaches the visible horizon');
  const expired = advance(distant, 8);
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

test('derelict satellites are ordinary breakable terrain on every orbital segment', () => {
  const satellites = Object.values(course.segments).flatMap(segment => segment.objects)
    .filter(object => object.visual === 'satellite-hull');
  assert.equal(satellites.length, 2);
  for (const satellite of satellites) {
    assert.equal(satellite.type, 'crate');
    const obstacle = { ...satellite, lane: 1, altitude: 1, distance: 3 };
    const shooting = createRace({ players, track: straight([obstacle], 'flight') });
    shooting.applyInput('cyan', 'fire');
    const hit = advance(shooting, 5);
    assert.deepEqual(hit.removedObjectIds, [satellite.id]);
    assert.equal(hit.projectiles.length, 0);
    const contact = createRace({ players, track: straight([obstacle], 'flight') });
    const collided = advance(contact, 12);
    assert.deepEqual(collided.removedObjectIds, [satellite.id]);
    assert.equal(collided.players[0].shield, 90);
    assert.equal(collided.players[0].phaseRemainingMs, 0);
  }
});
