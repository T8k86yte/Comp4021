const test=require('node:test');
const assert=require('node:assert/strict');
const {createRace}=require('./');
const {createRoomMatch}=require('./room-match');
const players=[{id:'owner'},{id:'guest'}];
function track(mode='ground',objects=[]){return {id:'manual',cruiseSpeed:10,startSegmentId:'road',segments:{
  road:{stage:'test',mode,laneCount:4,length:80,progress:[0,80],objects}
}};}
const socket=id=>({connected:true,data:{account:id},request:{session:{account:id}}});

test('L immunity works in ordinary rooms; Space gives exactly 1.5x only while held',()=>{
  const race=createRace({players,track:track()});
  assert.equal(race.applyInput('owner','boostStart'),false);
  assert.equal(race.step().players[0].distance,.5);
  race.applyInput('owner','enableImmunity');
  assert.equal(race.step().players[0].distance,1,'immunity alone does not accelerate');
  race.applyInput('owner','boostStart');
  let state=race.step();assert.equal(state.players[0].distance,1.75);
  assert.equal(state.players[1].distance,1.5,'the other player stays at normal speed');
  assert.equal(state.players[0].ammo,3,'Space does not fire');
  assert.equal(state.players[0].usedCheat,true);
  race.applyInput('owner','boostEnd');state=race.step();assert.equal(state.players[0].distance,2.25);
  assert.equal(state.players[0].immunityActive,true);assert.equal(state.players[0].boostActive,false);
  race.applyInput('owner','boostStart');race.setConnected('owner',false);race.setConnected('owner',true);
  state=race.step();assert.equal(state.players[0].distance,2.75,'reconnect does not resume a held boost');
});

test('immunity prevents all terrain damage and stun in ground, orbit and crossing traffic while coins still work',()=>{
  for(const mode of ['ground','flight','atmosphere']){
    const map=track(mode==='ground'?'ground':'flight',[
      {id:'wall',type:'barrier',lane:1,distance:1},
      {id:'box',type:'crate',lane:1,distance:2},
      {id:'coin',type:'coin',lane:1,distance:3}
    ]);
    if(mode==='atmosphere'){
      map.segments.road.flightPhase='atmosphere';
      map.segments.road.objects[0].motion={kind:'crossing',periodMs:4800,phaseMs:850};
    }
    const race=createRace({players,track:map});race.applyInput('owner','enableImmunity');race.applyInput('owner','boostStart');
    let state;for(let i=0;i<6;i++)state=race.step();
    const p=state.players[0];assert.equal(p.shield,p.maxShield);assert.equal(p.coins,1);
    assert.equal(p.stuns,0);assert.equal(p.phaseRemainingMs,0);assert.equal(p.distance,4.5);
    assert.deepEqual(state.removedObjectIds,['coin']);
  }
});

test('L immediately clears an existing shield-break stun and immunity survives launch',()=>{
  const map=track('ground',[1,2,3].map(distance=>({id:'box'+distance,type:'crate',lane:1,distance})));
  const race=createRace({players,track:map});let state;for(let i=0;i<6;i++)state=race.step();
  assert.ok(state.players[0].stunRemainingMs>0);
  race.applyInput('owner','enableImmunity');state=race.step();
  assert.equal(state.players[0].stunRemainingMs,0);assert.equal(state.players[0].shield,3);
  assert.ok(state.players[0].distance>3);
  const full=structuredClone(require('./full-course.json'));full.startSegmentId='spaceport-hangar';
  const launch=createRace({players,track:full});launch.applyInput('owner','enableImmunity');launch.applyInput('owner','boostStart');
  for(let i=0;i<90;i++)state=launch.step();
  assert.equal(state.players[0].mode,'flight');assert.equal(state.players[0].immunityActive,true);assert.equal(state.players[0].boostActive,true);
});

test('L supersedes the legacy 2x practice cheat instead of stacking acceleration',()=>{
  const race=createRace({players,track:track(),practice:true});
  race.applyInput('owner','toggleCheat');assert.equal(race.step().players[0].distance,1);
  race.applyInput('owner','enableImmunity');assert.equal(race.applyInput('owner','toggleCheat'),false);
  const normal=race.step().players[0];assert.equal(normal.distance,1.5);assert.equal(normal.cheatActive,false);
  race.applyInput('owner','boostStart');assert.equal(race.step().players[0].distance,2.25);
});

test('manual-test room relays only movement/fire to an authenticated connected peer, from either window',()=>{
  for(const manualTest of [false,true]){
    const match=createRoomMatch({matchId:'m',accounts:['owner','guest'],manualTest,track:track(),isSignedIn:()=>true});
    const owner=socket('owner'),guest=socket('guest');
    const initial=match.attachSocket(owner);match.attachSocket(guest);
    assert.equal(initial.controls.manualTest,manualTest);
    assert.equal(match.acceptInput(owner,{matchId:'m',controlSeat:1,action:'left'}),manualTest);
    assert.equal(match.acceptInput(guest,{matchId:'m',controlSeat:0,action:'left'}),manualTest);
    const state=match.step(()=>{}).snapshot;
    assert.deepEqual(state.players.map(p=>p.lane),manualTest?[0,1]:[1,2]);
    assert.equal(match.acceptInput(owner,{matchId:'m',controlSeat:1,action:'enableImmunity'}),false);
    assert.equal(match.acceptInput(owner,{matchId:'m',controlSeat:1,action:'boostStart'}),false);
    assert.equal(match.acceptInput(owner,{matchId:'old',controlSeat:1,action:'right'}),false);
    assert.equal(match.acceptInput(owner,{matchId:'m',controlSeat:99,action:'right'}),false);
    match.detachSocket(guest);
    assert.equal(match.acceptInput(owner,{matchId:'m',controlSeat:1,action:'right'}),false);
  }
});

test('owner control assignment follows the actual room owner, not the caller account ordering',()=>{
  const match=createRoomMatch({matchId:'m',accounts:['guest','owner'],hostAccount:'owner',manualTest:true,track:track(),isSignedIn:()=>true});
  const result=match.attachSocket(socket('owner'));
  assert.deepEqual(result.snapshot.players.map(p=>p.id),['owner','guest']);
  assert.equal(result.controls.owner,'owner');assert.equal(result.controls.guest,'guest');
});
