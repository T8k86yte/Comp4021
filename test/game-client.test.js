const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRace } = require('../race');
const course = require('../race/full-course.json');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Run the actual browser scripts against recorded Canvas calls and socket events.
async function client(username = 'player1') {
  const html = read('public/game.html');
  const images = [], text = [], rectangles = [], strokes = [], sent = [], handlers = {}, windowHandlers = {};
  let now=100,animationFrame;
  function element(dataset = {}) {
    return { dataset, style: {}, attributes: {}, children: [], listeners: {}, textContent: '', hidden: true,
      classList: { add() {} }, matches() { return false; }, focus() {}, scrollIntoView() {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      removeAttribute(name) { delete this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      play() { return Promise.resolve(); } };
  }
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => ['#' + id, element()]));
  elements.set('.runner-you', element()); elements.set('.runner-rival', element());
  const buttons = [...html.matchAll(/<button[^>]*data-action="([^"]+)"[^>]*>/g)].map(([tag, action]) => {
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    const button = id ? elements.get('#' + id) : element();
    button.dataset.action = action; return button;
  });
  const stages = [...html.matchAll(/<span data-stage="([^"]+)"/g)].map(([, stage]) => element({ stage }));
  const context2d = new Proxy({
    stroke() { strokes.push(this.strokeStyle); },
    drawImage(...args) { images.push(args); }, fillText(...args) { text.push(args); },
    fillRect(...args) { rectangles.push({ color: this.fillStyle, alpha: this.globalAlpha, args }); },
    createLinearGradient() { return { addColorStop() {} }; }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = elements.get('#race-canvas');
  Object.assign(canvas, { width: 1100, height: 650, getContext: () => context2d });
  class Image {
    complete = true; naturalWidth = 1024; naturalHeight = 1024;
    addEventListener() {}
    getAttribute(name) { return this[name]; }
  }
  const document = {
    addEventListener(event, callback) { windowHandlers[event]=callback; },
    querySelector(selector) { assert.ok(elements.has(selector), 'Unknown element: ' + selector); return elements.get(selector); },
    querySelectorAll(selector) {
      if (selector === '[data-action]') return buttons;
      if (selector === '.track-steps [data-stage]') return stages;
      return [];
    }, createElement: tag => tag === 'canvas'
      ? { width: 0, height: 0, getContext: () => new Proxy({}, { get: (target,key) => target[key] ?? (() => {}) }) }
      : element()
  };
  const window = { addEventListener(event, callback) { windowHandlers[event] = callback; }, requestAnimationFrame(callback) { animationFrame=callback; }, location: { replace() {} } };
  const context = vm.createContext({ window, document, Image, performance: { now: () => now },
    io: () => ({ on(event, callback) { handlers[event] = callback; }, emit(event, payload) { sent.push({ event, ...payload }); } }),
    fetch: async () => ({ ok: true, json: async () => ({ signedIn: true, account: { username } }) }) });
  vm.runInContext(read('public/js/race-motion.js'), context);
  vm.runInContext(read('public/js/race-renderer.js'), context);
  vm.runInContext(read('public/js/game.js'), context);
  await new Promise(resolve => setImmediate(resolve));
  const drawFrame=vm.runInContext('(time,moving) => renderer.draw(track,snapshot,account,time,moving)',context);
  return { elements, stages, images, text, rectangles, strokes, sent, handlers,
    frame(time, moving = true) { drawFrame(time,moving); },
    appFrame(time) { now=time;animationFrame(time); },
    bootstrap(snapshot, matchId = 'test-match', track = course, controls) { handlers['race:bootstrap']({ matchId, track, snapshot, controls }); },
    key(key, repeat = false) { windowHandlers.keydown({ key, repeat, target: element(), preventDefault() {} }); },
    keyup(key) { windowHandlers.keyup({key,preventDefault(){}}); },
    blur() { windowHandlers.blur(); },
    click(action) { buttons.find(button => button.dataset.action === action).listeners.click(); },
    pointer() { canvas.listeners.pointerdown(); } };
}

function raceAt(segmentId, practice = false) {
  return createRace({ players: [{ id: 'player1' }, { id: 'player2' }],
    track: { ...course, startSegmentId: segmentId }, practice });
}

test('multiplayer renders every course segment with its stage artwork and runner or shuttle sprites', async () => {
  const browser = await client('player2');
  for (const [id, segment] of Object.entries(course.segments)) {
    browser.images.length = 0;
    browser.bootstrap(raceAt(id).getSnapshot());
    assert.ok(browser.images.some(([image]) => image.src === course.stages[segment.stage].art), id + ' background');
    const localSprite = browser.images.filter(([image]) => image.src === (segment.mode === 'flight' ? '/assets/racers.png' : '/assets/racers-forward.png')).at(-1);
    assert.equal(localSprite[1], 512, id + ' preserves player two identity');
    assert.equal(localSprite[2], segment.mode === 'flight' ? 512 : 0, id + ' sprite row');
    assert.equal(browser.stages.find(step => step.attributes['aria-current'] === 'step').dataset.stage, segment.stage);
    assert.ok(browser.elements.get('#route-label').textContent.includes(segment.name));
    assert.equal(browser.elements.get('.runner-you').style.color, '#ff79d2');
    assert.equal(browser.elements.get('.runner-rival').style.color, '#65eff1');
  }
});

test('street facades move with distance, remain continuous across segments and stay out of orbit', async () => {
  const browser=await client();
  const snapshot=raceAt('slums-basin').getSnapshot();
  const facades=()=>browser.images.filter(([image])=>image.src==='/assets/city-facades.png').map(call=>call.slice(1));
  const draw=()=>{browser.images.length=0;browser.bootstrap(snapshot);return facades();};
  const start=draw();assert.ok(start.length>0,'ground scenery uses the facade atlas');
  snapshot.players[0].distance=9;
  const advanced=draw();assert.notDeepEqual(advanced,start,'buildings pass the camera as the player advances');
  browser.images.length=0;browser.frame(900);
  assert.deepEqual(facades(),advanced,'the city does not move on its own when no movement is observed');
  snapshot.players[0].distance=course.segments['slums-basin'].length;
  const atBoundary=draw();
  Object.assign(snapshot.players[0],{segmentId:'slums-market',distance:0});
  assert.deepEqual(draw(),atBoundary,'same-stage segment changes do not reset buildings');
  browser.images.length=0;browser.bootstrap(raceAt('orbit-launch').getSnapshot());
  assert.equal(facades().length,0,'orbital flight has no ground buildings');
});

test('street camera smooths one tick without drifting while paused, stunned, disconnected or finished', async () => {
  const browser=await client(),race=raceAt('slums-basin');
  browser.bootstrap(race.getSnapshot());
  const snapshot=race.step();browser.bootstrap(snapshot);
  const capture=(time,moving=true)=>{
    browser.images.length=0;browser.frame(time,moving);
    return browser.images.filter(([image])=>image.src==='/assets/city-facades.png').map(call=>call.slice(1));
  };
  const exact=capture(100);
  assert.notDeepEqual(capture(125),exact,'render frames between snapshots advance the scene');
  assert.deepEqual(capture(150),capture(900),'extrapolation stops after one server tick');
  assert.deepEqual(capture(900,false),exact,'paused preview stays at the snapshot');
  for(const field of ['stunRemainingMs','connected','finishTimeMs']){
    const previous=snapshot.players[0][field];
    snapshot.players[0][field]=field==='stunRemainingMs'?1000:field==='connected'?false:50;
    assert.deepEqual(capture(900),exact,field+' stops the visual camera');
    snapshot.players[0][field]=previous;
  }
  snapshot.status='ended';
  assert.deepEqual(capture(900),exact,'ended games stop the visual camera');
  assert.equal(snapshot.players[0].distance,.5,'rendering never mutates the server position');
});

test('the spaceport uses clean aerospace wall textures and sliding doors retract as players approach', async () => {
  const browser=await client(),snapshot=raceAt('spaceport-hangar').getSnapshot();
  const capture=distance=>{
    snapshot.players.forEach(p=>{p.distance=distance;p.progress=460+distance;});
    browser.images.length=0;browser.bootstrap(snapshot);
    return browser.images.filter(([image])=>image.src==='/assets/spaceport-architecture.png');
  };
  const closed=capture(35);
  assert.ok(closed.some(call=>call[2]===0),'new top-row wall modules are rendered');
  assert.ok(!browser.images.some(([image])=>image.src==='/assets/city-facades.png'),'no Slums facades in the hangar');
  const leaves=calls=>calls.filter(call=>call[2]===512 && call[3]===128 && call[4]===512).map(call=>call.slice(1));
  const shut=leaves(closed),open=leaves(capture(60));
  assert.equal(shut.length,2);assert.equal(open.length,2);
  assert.ok(open[0][4]<shut[0][4],'left leaf retracts left');
  assert.ok(open[1][4]>shut[1][4],'right leaf retracts right');
});

test('gate blackouts are local to each runner and reveal the next area before its first hazards', async () => {
  const first=await client('player1'),second=await client('player2');
  const snapshot=raceAt('slums-gate').getSnapshot();
  Object.assign(snapshot.players[0],{segmentId:'downtown-plaza',stage:'downtown',distance:0,progress:220});
  Object.assign(snapshot.players[1],{distance:52.5,progress:212.5});
  const before=JSON.stringify(snapshot);
  const blackout=browser=>browser.rectangles.filter(r=>r.color==='#000000' && r.args[2]===1100 && r.args[3]===650).at(-1)?.alpha||0;
  first.bootstrap(snapshot);second.bootstrap(snapshot);
  assert.equal(blackout(first),1,'leader is inside the dark passage');
  assert.equal(blackout(second),0,'trailing player still sees the Slums and gate');
  assert.ok(first.images.some(([image])=>image.src==='/assets/downtown.png'));
  assert.ok(second.images.some(([image])=>image.src==='/assets/slums.png'));
  assert.equal(JSON.stringify(snapshot),before,'transitions never alter authoritative positions');
  snapshot.players[0].distance=2.5;first.rectangles.length=0;first.bootstrap(snapshot);
  assert.ok(blackout(first)>0 && blackout(first)<1,'new district fades in');
  snapshot.players[0].distance=3.6;first.rectangles.length=0;first.bootstrap(snapshot);
  assert.equal(blackout(first),0,'the view is clear before the first hazard');
});

test('pre-update room maps still render all area gates, arrival fades and the final docking sequence', async () => {
  const legacy=structuredClone(course),browser=await client();
  Object.values(legacy.segments).forEach(segment=>delete segment.gate);
  const original=JSON.stringify(legacy);
  for(const [id,segment] of Object.entries(course.segments).filter(([,s])=>s.gate)){
    const snapshot=raceAt(id).getSnapshot();
    snapshot.players.forEach(p=>{p.distance=segment.length-12;p.progress=segment.progress[1]-12;});
    browser.text.length=0;browser.bootstrap(snapshot,'legacy',legacy);
    assert.ok(browser.text.some(([text])=>text===segment.gate.label),id+' recovers its gate');
    if(segment.exits){
      const next=segment.exits[0][0],destination=course.segments[next];
      Object.assign(snapshot.players[0],{segmentId:next,stage:destination.stage,mode:destination.mode,distance:.5,progress:destination.progress[0]+.5});
      browser.rectangles.length=0;browser.bootstrap(snapshot,'legacy',legacy);
      assert.ok(browser.rectangles.some(r=>r.color==='#000000' && r.alpha===1 && r.args[2]===1100),'arrival blackout also works with old map data');
    }
  }
  const finish=raceAt('orbit-dock').getSnapshot();
  finish.elapsedMs=1000;
  finish.players.forEach(p=>Object.assign(p,{distance:70,progress:735,finishTimeMs:1000}));
  browser.bootstrap(finish,'legacy',legacy);browser.text.length=0;browser.frame(1800);
  assert.ok(browser.text.some(([text])=>text==='DOCKING COMPLETE'),'legacy final hangar completes the fly-away');
  assert.equal(JSON.stringify(legacy),original,'compatibility rendering leaves the server course untouched');
  const disabled=structuredClone(legacy);disabled.segments['slums-gate'].gate=null;
  const snapshot=raceAt('slums-gate').getSnapshot();snapshot.players[0].distance=48;
  browser.text.length=0;browser.bootstrap(snapshot,'explicit-disable',disabled);
  assert.ok(!browser.text.some(([text])=>text==='DOWNTOWN'),'an explicit gate override is respected');
});

test('a finished shuttle departs into the hangar before results appear, while a DNF has no docking animation', async () => {
  const browser=await client('player2'),clear=structuredClone(course);
  clear.startSegmentId='orbit-dock';Object.values(clear.segments).forEach(s=>s.objects=[]);
  const race=createRace({players:[{id:'player1'},{id:'player2'}],track:clear});
  let snapshot;do{snapshot=race.step();}while(snapshot.status!=='ended');
  browser.bootstrap(snapshot);
  assert.equal(browser.elements.get('#results-panel').hidden,true,'results wait for the local arrival');
  browser.images.length=0;browser.appFrame(500);
  const shuttle=browser.images.find(([image])=>image.src==='/assets/racers.png');
  assert.ok(shuttle,'shuttle is visible while accelerating into the bay');
  assert.equal(shuttle[1],512,'player two retains their own shuttle');
  browser.images.length=0;browser.appFrame(1800);
  assert.ok(!browser.images.some(([image])=>image.src==='/assets/racers.png'),'shuttle has zoomed out of view');
  assert.equal(browser.elements.get('#results-panel').hidden,true);
  browser.appFrame(2400);
  assert.equal(browser.elements.get('#results-panel').hidden,false);
  assert.equal(browser.elements.get('#results-body').children.length,2);
  assert.ok(browser.text.some(([text])=>text==='DOCKING COMPLETE'));
  const dnf=raceAt('slums-basin').getSnapshot();dnf.status='ended';dnf.results=[];
  browser.bootstrap(dnf,'dnf');
  assert.equal(browser.elements.get('#results-panel').hidden,false,'time-limit results do not wait for a fake arrival');
});

test('the client follows each authenticated player through a complete race, including independent launches', async () => {
  const first = await client('player1'), second = await client('player2');
  const race = raceAt(course.startSegmentId, true);
  first.bootstrap(race.getSnapshot()); second.bootstrap(race.getSnapshot());
  race.applyInput('player1', 'toggleCheat');
  const seen = [new Set(), new Set()]; let mixedFlight = false, snapshot;
  for (let tick = 0; tick < 3600; tick++) {
    if (tick === 200) race.applyInput('player1', 'toggleCheat');
    snapshot = race.step();
    mixedFlight ||= snapshot.players[0].mode !== snapshot.players[1].mode;
    for (const [seat, browser] of [first, second].entries()) {
      const player = snapshot.players[seat], phase = player.stage + '/' + player.mode;
      if (seen[seat].has(phase) && snapshot.status !== 'ended') continue;
      seen[seat].add(phase); browser.images.length = 0;
      browser.handlers['race:update']({ matchId: 'test-match', snapshot });
      assert.ok(browser.images.some(([image]) => image.src === course.stages[player.stage].art));
      assert.equal(browser.elements.get('#you-shield').textContent, `Shield ${player.shield} / ${player.maxShield}`);
      assert.equal(browser.elements.get('.runner-you').style.color, seat === 0 ? '#65eff1' : '#ff79d2');
    }
    if (snapshot.status === 'ended') break;
  }
  for (const phases of seen) assert.deepEqual([...phases], ['slums/ground', 'downtown/ground', 'spaceport/ground', 'spaceport/flight']);
  assert.ok(mixedFlight, 'each player launches at their own stage boundary');
  assert.equal(snapshot.status, 'ended');
  assert.equal(second.elements.get('#results-body').children.length, 2);
});

test('flight controls reach the server, ammo and shield update, and reconnect restores active projectiles', async () => {
  const browser = await client('player2');
  const race = raceAt('orbit-debris', true);
  browser.bootstrap(race.getSnapshot());
  browser.key('w'); browser.key('s'); browser.key('ArrowUp'); browser.key('ArrowDown');
  browser.key('Enter'); browser.pointer(); browser.click('fire'); browser.click('up'); browser.click('down'); browser.key('c');
  browser.key(' ', true);
  assert.deepEqual(browser.sent.map(message => message.action), ['up', 'down', 'fire', 'fire', 'fire', 'up', 'down', 'toggleCheat']);
  assert.ok(browser.sent.every(message => message.event === 'race:input' && message.matchId === 'test-match'));
  race.applyInput('player2', 'fire'); race.applyInput('player2', 'up');
  const snapshot = race.step();
  browser.rectangles.length = 0;
  browser.bootstrap(snapshot);
  assert.match(browser.elements.get('#you-ammo').textContent, /^Ammo 2 \/ 3/);
  assert.equal(browser.elements.get('#you-shield').textContent, 'Shield 100 / 100');
  assert.match(browser.elements.get('#you-state').textContent, /high/);
  assert.ok(browser.strokes.includes('#ff79d2'), 'restored projectile is drawn');
  assert.equal(browser.sent.length, 8, 'bootstrap does not replay input');
});

test('ground altitude and competitive legacy cheats are blocked; obsolete match updates are ignored', async () => {
  const browser = await client();
  const race = raceAt(course.startSegmentId);
  browser.bootstrap(race.getSnapshot());
  browser.key('w'); browser.key('s'); browser.key('c'); browser.key('a'); browser.key('d'); browser.key('f');
  assert.deepEqual(browser.sent.map(message => message.action), ['left', 'right', 'fire']);
  const route = browser.elements.get('#route-label').textContent;
  browser.handlers['race:update']({ matchId: 'obsolete', snapshot: raceAt('orbit-launch').getSnapshot() });
  assert.equal(browser.elements.get('#route-label').textContent, route);
});

test('both laser colors remain visible across a continuous segment boundary and fade beyond the horizon', async () => {
  const browser = await client();
  const snapshot = raceAt('slums-basin').getSnapshot();
  snapshot.players[0].distance = 48;
  for (const [owner, color] of [['player1', '#65eff1'], ['player2', '#ff79d2']]) {
    snapshot.projectiles = [{ id: 'laser', playerId: owner, segmentId: 'slums-market', lane: 1, altitude: 0, distance: 10 }];
    browser.strokes.length = 0;
    browser.bootstrap(snapshot);
    assert.ok(browser.strokes.includes(color), 'laser in the next segment stays visible');
    snapshot.projectiles[0].distance = 44;
    browser.strokes.length = 0;
    browser.bootstrap(snapshot);
    assert.ok(!browser.strokes.includes(color), 'laser beyond the visible road is culled');
  }
});

test('rival visibility has the same 12-cell cutoff for both seats and across segment boundaries', async () => {
  const browsers = [await client('player1'), await client('player2')];
  const snapshot = raceAt('slums-market').getSnapshot();
  const render = () => browsers.map(browser => {
    browser.images.length = browser.text.length = 0;
    browser.bootstrap(snapshot);
    return {
      sprites: browser.images.filter(([image]) => image.src === '/assets/racers-forward.png').length,
      rear: browser.text.some(([text]) => text.startsWith('RIVAL BEHIND'))
    };
  });
  for (const leader of [0, 1]) {
    const follower = 1 - leader;
    snapshot.players.forEach(player => Object.assign(player, { segmentId: 'slums-market', distance: 20 }));
    snapshot.players[leader].distance = 31;
    let views = render();
    assert.equal(views[follower].sprites, 2, 'nearby leader is visible');
    assert.equal(views[leader].rear, true, 'leader can locate a nearby trailing rival');
    for (const gap of [12, 20, 44]) {
      snapshot.players[leader].distance = 20 + gap;
      views = render();
      assert.deepEqual(views, [{ sprites: 1, rear: false }, { sprites: 1, rear: false }]);
    }
    Object.assign(snapshot.players[follower], { segmentId: 'slums-basin', distance: 49 });
    Object.assign(snapshot.players[leader], { segmentId: 'slums-market', distance: 10 });
    views = render();
    assert.equal(views[follower].sprites, 2, 'continuous segment edge does not hide a nearby rival');
    assert.equal(views[leader].rear, true);
    snapshot.players[leader].distance = 11;
    assert.deepEqual(render(), [{ sprites: 1, rear: false }, { sprites: 1, rear: false }]);
  }
});

test('orbital hazards have distinct height markers and only the matching lane and altitude warns', async () => {
  const browser = await client();
  const track = structuredClone(course);
  track.segments['orbit-debris'].objects = [0, 1, 2].map(altitude => ({
    id: `level-${altitude}`, type: 'crate', visual: 'debris', distance: 10, lane: 1, altitude
  }));
  const snapshot = raceAt('orbit-debris').getSnapshot();
  for (let altitude = 0; altitude < 3; altitude++) {
    snapshot.players[0].altitude = altitude;
    browser.text.length = 0;
    browser.bootstrap(snapshot, 'test-match', track);
    const labels = ['LOW', 'MID', 'HIGH'].map(level => browser.text.find(([text]) => text === `${level} · L2`));
    assert.ok(labels.every(Boolean), 'every height is labeled at a readable distance');
    assert.ok(labels[0][2] - labels[1][2] > 90 && labels[1][2] - labels[2][2] > 90);
    assert.equal(browser.text.filter(([text]) => text === 'ON COURSE').length, 1);
  }
});

test('ascent renders moving spacecraft and unfolds altitude guides without a blackout or queued controls', async () => {
  const browser=await client(),snapshot=raceAt('orbit-launch').getSnapshot();
  const render=distance=>{
    snapshot.players[0].distance=distance;
    browser.text.length=browser.rectangles.length=browser.images.length=0;
    browser.bootstrap(snapshot);
  };
  render(8);
  assert.ok(browser.images.some(([im])=>im.src==='/assets/atmosphere.png'));
  assert.ok(browser.images.some(([im])=>im.src==='/assets/atmosphere-traffic.png'));
  assert.ok(browser.text.some(([t])=>t==='ASCENT'));
  assert.ok(!browser.text.some(([t])=>t==='LOW' || t==='HIGH'));
  browser.key('w');browser.click('down');assert.equal(browser.sent.length,0);
  render(99);
  assert.ok(browser.text.some(([t])=>t==='ATMOSPHERIC BREAKTHROUGH'));
  assert.ok(browser.text.some(([t])=>t==='LOW'));
  assert.ok(browser.text.some(([t])=>t==='HIGH'));
  assert.ok(!browser.rectangles.some(r=>r.color==='#000000' && r.args[2]===1100));
  const saved=JSON.stringify(snapshot);browser.frame(140);assert.equal(JSON.stringify(snapshot),saved);
  Object.assign(snapshot.players[0],{segmentId:'orbit-debris',distance:0,progress:630});
  browser.bootstrap(snapshot);browser.key('w');
  assert.equal(browser.sent.at(-1).action,'up');
  assert.ok(browser.text.some(([t])=>t==='ORBIT REACHED'));
});

test('mandatory owner/guest keys relay to both seats only in manual-test rooms', async()=>{
  for(const username of ['player1','player2'])for(const manualTest of [false,true]){
    const browser=await client(username),snapshot=raceAt('orbit-debris').getSnapshot();
    browser.bootstrap(snapshot,'test-match',course,{owner:'player1',guest:'player2',manualTest});
    for(const key of ['a','w','f','ArrowRight','ArrowUp','Enter'])browser.key(key);
    const expected=manualTest?[[0,'left'],[0,'up'],[0,'fire'],[1,'right'],[1,'up'],[1,'fire']]
      :username==='player1'?[[0,'left'],[0,'up'],[0,'fire']]:[[1,'right'],[1,'up'],[1,'fire']];
    assert.deepEqual(browser.sent.map(p=>[p.controlSeat,p.action]),expected);
    browser.sent.length=0;
    browser.key('l');browser.key(' ');browser.keyup(' ');browser.key(' ');browser.blur();
    assert.deepEqual(browser.sent.map(p=>p.action),['enableImmunity','boostStart','boostEnd','boostStart','boostEnd']);
    assert.ok(browser.sent.every(p=>p.controlSeat===(username==='player1'?0:1)),'L/Space always belong to the focused signed-in player');
  }
});
