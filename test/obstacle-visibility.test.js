const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRace } = require('../race');
const course = require('../race/full-course.json');
const root = path.resolve(__dirname, '..');

// Record the real renderer's atlas draws, including its world-to-screen
// transforms, without relying on private visibility helpers.
function renderer() {
  const props = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const noop = () => {};
  const ctx = new Proxy({
    save() { stack.push([...transform]); }, restore() { transform = stack.pop(); },
    translate(x, y) { transform[4] += transform[0]*x + transform[2]*y; transform[5] += transform[1]*x + transform[3]*y; },
    scale(x, y) { transform[0]*=x; transform[1]*=x; transform[2]*=y; transform[3]*=y; },
    rotate(a) {
      const [x,y,u,v] = transform, c=Math.cos(a), s=Math.sin(a);
      transform[0]=x*c+u*s; transform[1]=y*c+v*s;
      transform[2]=u*c-x*s; transform[3]=v*c-y*s;
    },
    drawImage(image, ...args) {
      if (image.src === '/assets/obstacles.png') props.push({ args, x: transform[4], y: transform[5], scale: Math.hypot(transform[0], transform[1]) });
    },
    createLinearGradient: () => ({ addColorStop: noop })
  }, { get: (object, name) => object[name] ?? noop });
  class Image {
    complete = true; naturalWidth = 1024; naturalHeight = 1024;
    addEventListener() {} getAttribute(name) { return this[name]; }
  }
  const context = vm.createContext({ window: { RaceMotion: require('../public/js/race-motion') }, Image,
    document: { createElement: () => ({ getContext: () => ctx }) }, performance: { now: () => 100 } });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/race-renderer.js'), 'utf8'), context);
  const render = context.window.createRaceRenderer({ width: 1100, height: 650, getContext: () => ctx });
  return { draw(track, snapshot) { props.length=0; render.draw(track,snapshot,'cyan',100,false); return [...props]; } };
}

function at(track, id, distance) {
  const snapshot = createRace({ players: [{id:'cyan'},{id:'magenta'}], track: {...track, startSegmentId:id} }).getSnapshot();
  Object.assign(snapshot.players[0], { distance, progress: (track.segments[id].progress?.[0] || 0) + distance });
  snapshot.players[1].connected=false;
  return snapshot;
}
function propAt(props, object, z, segment) {
  const scale = 14/(14+z), altitude=segment.mode==='flight'?(object.altitude??1):0;
  const x = 550+(object.lane-(segment.laneCount-1)/2)*190*scale;
  const y = 180+(395-altitude*160)*scale;
  return props.find(p=>Math.abs(p.x-x)<.001 && Math.abs(p.y-y)<.001 && Math.abs(p.scale-scale)<.001);
}

test('ground hazards are visible across every continuous section join before entering the next section', () => {
  const view = renderer();
  for (const [from,to] of [['slums-basin','slums-market'],['slums-market','slums-gate'],
    ['downtown-plaza','downtown-boulevard'],['downtown-boulevard','downtown-access']]) {
    const section=course.segments[from], next=course.segments[to];
    const target=next.objects.find(o=>o.type==='crate');
    const state=at(course,from,section.length-30);
    const before=JSON.stringify(state);
    assert.ok(propAt(view.draw(course,state),target,30+target.distance,next), from+' previews its next encounter at full view distance');
    assert.equal(JSON.stringify(state),before,'rendering leaves gameplay unchanged');
    const left=propAt(view.draw(course,at(course,from,section.length-.05)),target,target.distance+.05,next);
    const right=propAt(view.draw(course,at(course,to,.05)),target,target.distance-.05,next);
    assert.ok(left && right, 'the same prop stays visible on both sides of '+to);
    assert.ok(Math.abs(left.y-right.y)<1.5 && Math.abs(left.x-right.x)<1.5,'only the expected 0.1-cell camera movement at the boundary');
    state.removedObjectIds=[target.id];
    assert.ok(!propAt(view.draw(course,state),target,30+target.distance,next),'destroyed objects do not reappear in lookahead');
  }
});

test('continuous lookahead spans short sections and keeps far-to-near ordering without guessing branches', () => {
  const exits=id=>Array.from({length:4},(_,lane)=>[id,lane]);
  const track={ id:'visibility', stages:course.stages, startSegmentId:'a', segments:{} };
  for (const [index,id] of ['a','b','c','d'].entries()) {
    track.segments[id]={stage:'slums',mode:'ground',laneCount:4,length:12,progress:[index*12,(index+1)*12],
      objects: index ? [{id, type:'crate',visual:'scrap-crate',lane:index-1,distance:4}] : [],
      ...(index<3?{exits:exits(['b','c','d'][index])}:{})};
  }
  const view=renderer(),state=at(track,'a',2),draw=view.draw(track,state);
  assert.equal(draw.length,3,'all three connected sections are visible within 45 cells');
  assert.ok(draw.every((p,i)=>i===0 || p.scale>=draw[i-1].scale),'near props paint over distant props');
  track.segments.a.exits[3]=['c',3];
  assert.equal(view.draw(track,state).length,0,'do not draw an arbitrary branch before choosing it');
  track.segments.a.exits=exits('b');track.segments.b.exits=exits('a');
  assert.equal(view.draw(track,state).length,1,'a malformed loop cannot repeat hazards or hang rendering');
});

test('area gates and launch retain their transitions while flight lookahead keeps every orbital altitude visible', () => {
  const view=renderer();
  for (const from of ['slums-gate','downtown-access','spaceport-hangar']) {
    const section=course.segments[from],next=course.segments[section.exits[0][0]];
    const target=next.objects.find(o=>o.type!=='coin');
    const state=at(course,from,section.length-4);
    assert.ok(!propAt(view.draw(course,state),target,4+target.distance,next),'no objects drawn over an opaque area gate');
  }
  for (const from of ['orbit-launch','orbit-debris']) {
    const section=course.segments[from],next=course.segments[section.exits[0][0]];
    const state=at(course,from,section.length-.01),draw=view.draw(course,state);
    for (const target of next.objects.filter(o=>o.type!=='coin' && o.distance<44)) {
      // At the ascent edge the grids are fully unfolded to numerical precision.
      assert.ok(propAt(draw,target,target.distance+.01,next),from+' previews altitude '+target.altitude);
    }
  }
});

test('new area encounters leave reaction time after the arrival blackout, at normal and boosted speeds', () => {
  for (const id of ['downtown-plaza','spaceport-hangar']) {
    const first=Math.min(...course.segments[id].objects.filter(o=>o.type!=='coin').map(o=>o.distance));
    const revealedDistance=first-3.6;
    assert.ok(revealedDistance/course.cruiseSpeed>=1.6,id+' gives at least 1.6 seconds after reveal');
    assert.ok(revealedDistance/(course.cruiseSpeed*1.5)>=1,id+' gives at least one second with acceleration');
  }
});
