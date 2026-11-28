const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRace, TICK_MS } = require('../race');
const root = path.resolve(__dirname, '..');

async function preview(track) {
  const html = fs.readFileSync(path.join(root, 'public/playtest.html'), 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    value: id === 'course' ? 'full' : '', style: {}, listeners: {}, attributes: {},
    addEventListener(event, callback) { this.listeners[event] = callback; }, focus() {},
    setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; }
  }]));
  const played = [], requested = [];
  let frame;
  class AudioContext {
    state = 'suspended';
    currentTime = 10;
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(data) { return Promise.resolve(data); }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start() { played.push(this.buffer.url); } };
    }
  }
  const context = vm.createContext({
    structuredClone,
    document: {
      getElementById: id => { assert.ok(elements.has(id), id); return elements.get(id); },
      querySelectorAll: () => [], addEventListener() {}
    },
    window: {
      AudioContext, previewRace: { createRace, TICK_MS, track },
      RaceMotion: require('../public/js/race-motion'), addEventListener() {},
      createRaceRenderer: () => ({ draw() {} })
    },
    fetch: async url => {
      const pathname = new URL(url, 'http://local').pathname;
      requested.push(pathname);
      return { ok: fs.existsSync(path.join(root, 'public', pathname)), arrayBuffer: async () => ({ url: pathname }) };
    },
    requestAnimationFrame: callback => { frame = callback; }
  });
  // Load in the same order as the page, including its real audio controller.
  for (const [, src] of html.matchAll(/<script src="([^"?]+)[^"]*"/g)) {
    if (src === '/js/race-audio.js' || src === '/playtest.js') {
      vm.runInContext(fs.readFileSync(path.join(root, 'public', src), 'utf8'), context);
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  return { elements, played, requested, frame: time => frame(time) };
}

function emptyCourse(startSegmentId = 'slums-basin') {
  const track = structuredClone(require('../race/full-course.json'));
  Object.values(track.segments).forEach(segment => { segment.objects = []; });
  track.startSegmentId = startSegmentId;
  return track;
}

test('preview Start and Restart enable coin and shield effects without background music', async () => {
  const track = emptyCourse();
  track.segments[track.startSegmentId].objects = [
    { id: 'sound-coin', type: 'coin', distance: 2, lane: 1 },
    { id: 'sound-barrier', type: 'barrier', distance: 4, lane: 1 }
  ];
  const { elements, played, requested, frame } = await preview(track);
  assert.deepEqual(played, [], 'loading the preview is silent');
  assert.equal(elements.has('music-toggle'), false);
  assert.ok(requested.length > 0 && requested.every(url => url.endsWith('.wav')), 'only sound effects load');
  elements.get('start').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  for (let time = TICK_MS; time <= 600; time += TICK_MS) frame(time);
  assert.deepEqual(played, ['/sounds/coin.wav', '/sounds/impact.wav']);
  assert.equal(elements.get('cyan-coins').textContent, '1 coins');
  elements.get('restart').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  for (let time = 650; time <= 1200; time += TICK_MS) frame(time);
  assert.deepEqual(played, ['/sounds/coin.wav', '/sounds/impact.wav', '/sounds/coin.wav', '/sounds/impact.wav']);
});

test('preview plays confirmed lasers and material destruction but stays silent on empty fire and solid hits', async () => {
  for (const [segmentId, visual, material] of [
    ['slums-basin', 'scrap-crate', 'wood'], ['downtown-plaza', 'glass', 'glass'],
    ['spaceport-hangar', 'cargo', 'cargo'], ['orbit-debris', 'debris', 'debris'],
    ['orbit-debris', 'satellite-hull', 'satellite']
  ]) {
    const track = emptyCourse(segmentId);
    track.cruiseSpeed = 1;
    const height = track.segments[segmentId].mode === 'flight' ? { altitude: 1 } : {};
    track.segments[segmentId].objects = [
      { id: 'breakable', type: 'crate', distance: 4, lane: 1, visual, ...height },
      { id: 'solid', type: 'barrier', distance: 8, lane: 1, ...height }
    ];
    const { elements, played, frame } = await preview(track);
    elements.get('start').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    for (let time = TICK_MS; time <= 900; time += TICK_MS) {
      elements.get('track').listeners.pointerdown();
      frame(time);
    }
    assert.equal(played.filter(url => url === '/sounds/laser.wav').length, 3, 'only three available rounds sound');
    assert.equal(played.filter(url => url === `/sounds/${material}-break.wav`).length, 1, segmentId + ' destruction');
    assert.equal(played.length, 4, 'solid hit, rejected cooldown shots and empty fire add no sound');
  }
});
