const test = require('node:test');
const assert = require('node:assert/strict');
const { createRace } = require('./');
const { trafficPose } = require('../public/js/race-motion');
const course = require('./full-course.json');
const players = [{ id: 'a' }, { id: 'b' }];
const advance = (race,n) => { let s; for(let i=0;i<n;i++)s=race.step(); return s; };
function trafficTrack(phaseMs=0, distance=1) {
  return {id:'traffic-test',cruiseSpeed:12.5,startSegmentId:'ascent',segments:{ascent:{
    stage:'spaceport',mode:'flight',flightPhase:'atmosphere',laneCount:4,length:120,progress:[0,120],
    objects:[{id:'hull',type:'barrier',lane:0,altitude:1,distance,
      motion:{kind:'crossing',periodMs:4800,phaseMs}}]
  }}};
}

test('flight halves preserve coins and docking, with clear space around altitude unlock', () => {
  const ascent=course.segments['orbit-launch'];
  assert.equal(ascent.length,105);
  assert.equal(course.segments['orbit-debris'].length+course.segments['orbit-dock'].length,105);
  assert.equal(ascent.objects.filter(o=>o.motion).length,3);
  assert.ok(ascent.objects.every(o=>o.altitude===1 && o.distance<ascent.length-ascent.transitionLength));
  assert.equal(ascent.objects.filter(o=>o.type==='coin').length,2);
  const orbital=Object.values(course.segments).filter(s=>s.flightPhase==='orbit');
  assert.ok(course.segments['orbit-debris'].objects.filter(o=>o.type!=='coin').every(o=>o.distance>=12),
    'new altitude controls have 1.2 seconds of clear approach');
  assert.equal(orbital.flatMap(s=>s.objects).filter(o=>o.visual==='satellite-hull').length,2);
  const coins=Object.values(course.segments).flatMap(s=>s.mode==='flight' ? s.objects
    .filter(o=>o.type==='coin').map(o=>[o.id,s.progress[0]+o.distance,o.lane,o.altitude]) : []);
  assert.deepEqual(coins,[['orbit-launch-coin-1',546,2,1],['orbit-debris-coin-1',592,1,1],
    ['orbit-debris-coin-2',634,3,2],['orbit-dock-coin-1',699,2,1],['orbit-dock-coin-2',721,1,2]]);
  assert.equal(course.segments['orbit-dock'].gate.kind,'dock');
});

test('atmosphere locks altitude, then unlocks independently on MID without resetting shields, ammo or gap', () => {
  const track=structuredClone(course);track.startSegmentId='orbit-launch';
  Object.values(track.segments).forEach(s=>s.objects=[]);
  const race=createRace({players,track});
  const ticksToOrbit=track.segments['orbit-launch'].length/(track.cruiseSpeed*.05);
  race.setConnected('b',false);advance(race,20);race.setConnected('b',true);
  assert.equal(race.applyInput('a','up'),false);
  assert.equal(race.applyInput('a','down'),false);
  advance(race,ticksToOrbit-22); // Two ticks before entry, with a ten-cell lead.
  race.applyInput('a','fire');
  const before=race.step().players[0];
  const state=race.step(),[leader,trailer]=state.players;
  assert.equal(leader.segmentId,'orbit-debris');assert.equal(trailer.segmentId,'orbit-launch');
  assert.equal(leader.progress-trailer.progress,10);
  assert.equal(leader.lane,before.lane);assert.equal(leader.altitude,1);
  assert.equal(leader.shield,before.shield);assert.equal(leader.ammo,before.ammo);
  assert.equal(state.events.filter(e=>e.type==='orbitEntered').length,1);
  assert.equal(race.applyInput('a','up'),true);assert.equal(race.applyInput('b','up'),false);
  assert.equal(race.step().players[0].altitude,2);
});

test('crossing traffic collision follows its continuous position, not its authored placeholder lane', () => {
  // At 80ms the hull is precisely at lane 1, despite its authored lane being 0.
  const phase=1.65/4.3*2400-80;
  const track=trafficTrack(phase);
  const hit=createRace({players,track});
  const state=advance(hit,2);
  assert.equal(state.players[0].shield,75);assert.equal(state.players[1].shield,100);
  assert.equal(state.players[0].phaseRemainingMs,500);
  assert.deepEqual(state.removedObjectIds,[],'traffic is solid and shared');
  const miss=createRace({players,track:trafficTrack(2300)});
  assert.equal(advance(miss,2).players[0].shield,100,'the same row is safe after traffic moves away');
  // Boosted racers cross the row at 40ms inside the very first network tick.
  const boosted=createRace({players,track:trafficTrack(1.65/4.3*2400-40),practice:true});
  boosted.applyInput('a','toggleCheat');
  assert.equal(boosted.step().players[0].shield,100,'practice immunity still applies');
});

test('shots hit crossing hulls at the projectile arrival time without destroying civilian traffic', () => {
  const hitTime=1/45*1000;
  const race=createRace({players,track:trafficTrack(1.65/4.3*2400-hitTime)});
  race.applyInput('a','fire');const state=race.step();
  assert.ok(state.events.some(e=>e.type==='shotHit' && e.objectId==='hull'));
  assert.equal(state.projectiles.length,0);assert.deepEqual(state.removedObjectIds,[]);
  const miss=createRace({players,track:trafficTrack(2300)});
  miss.applyInput('a','fire');assert.equal(miss.step().projectiles.length,1);
});

test('traffic has one shared clock through disconnects and traverses all four lanes smoothly', () => {
  const track=trafficTrack(350,80),a=createRace({players,track}),b=createRace({players,track});
  b.setConnected('a',false);
  advance(a,37);advance(b,37);b.setConnected('a',true);
  const hull=track.segments.ascent.objects[0];
  assert.deepEqual(trafficPose(hull,a.getSnapshot().elapsedMs),trafficPose(hull,b.getSnapshot().elapsedMs));
  const seen=new Set();let previous;
  for(let time=0;time<=4800;time+=25){
    const pose=trafficPose(hull,time);if(pose.lane>=0 && pose.lane<=3)seen.add(Math.round(pose.lane));
    if(previous!==undefined)assert.ok(Math.abs(pose.lane-previous)<.05,'no lane teleport at the turnaround');
    previous=pose.lane;
  }
  assert.equal(seen.size,4);
  assert.deepEqual(trafficPose(hull,0),trafficPose(hull,4800));
});

test('invalid traffic paths and unreachable ascent objects are rejected', () => {
  for(const mutation of [
    s=>s.objects[0].motion.periodMs=0,
    s=>s.objects[0].motion.phaseMs=NaN,
    s=>s.objects[0].altitude=2,
    s=>s.flightPhase='orbit'
  ]){
    const track=trafficTrack();mutation(track.segments.ascent);
    assert.throws(()=>createRace({players,track}),TypeError);
  }
});
