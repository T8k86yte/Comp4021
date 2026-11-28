const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));

function audioClient({ failFirstResume = false, unavailable = null } = {}) {
  const played = [], requested = [];
  let releaseSounds, resumes = 0;
  const pendingSounds = new Promise(resolve => { releaseSounds = resolve; });
  class AudioContext {
    state = 'suspended';
    destination = {};
    resume() {
      if (failFirstResume && ++resumes === 1) return Promise.reject(new Error('Gesture not accepted'));
      this.state = 'running';
      return Promise.resolve();
    }
    decodeAudioData(data) { return Promise.resolve(data); }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start() { played.push(this.buffer.url); } };
    }
  }
  const context = vm.createContext({
    window: { AudioContext },
    fetch: async url => {
      const pathname = new URL(url, 'http://local').pathname;
      requested.push(pathname);
      await pendingSounds;
      return { ok: pathname !== unavailable, arrayBuffer: async () => ({ url: pathname }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/race-audio.js'), 'utf8'), context);
  return { controller: context.window.createRaceAudio(), played, requested, releaseSounds };
}

test('late effect decoding never replays past collisions or shots', async () => {
  const { controller, played, requested, releaseSounds } = audioClient();
  controller.unlock();
  controller.playEvents([{ type: 'impact', playerId: 'me' }, { type: 'shotFired', playerId: 'me' }], 'me');
  releaseSounds();
  await flush();
  assert.deepEqual(played, [], 'old effects are discarded while assets load');
  assert.ok(requested.every(url => url.endsWith('.wav')), 'background music is never requested');
  controller.playEvents([{ type: 'impact', playerId: 'me' }, { type: 'shotFired', playerId: 'me' }], 'me');
  assert.deepEqual(played, ['/sounds/impact.wav', '/sounds/laser.wav']);
});

test('a blocked first gesture can retry without a burst of queued effects', async () => {
  const { controller, played, releaseSounds } = audioClient({ failFirstResume: true });
  releaseSounds();
  await flush();
  controller.unlock();
  await flush();
  controller.playEvents([{ type: 'shotFired', playerId: 'me' }], 'me');
  assert.deepEqual(played, [], 'failed autoplay stays silent');
  controller.unlock();
  await flush();
  assert.deepEqual(played, [], 'unlock does not replay the old laser');
  controller.playEvents([{ type: 'shotFired', playerId: 'me' }], 'me');
  assert.deepEqual(played, ['/sounds/laser.wav']);
});

test('one unavailable effect does not prevent the remaining effects from playing', async () => {
  const { controller, played, releaseSounds } = audioClient({ unavailable: '/sounds/impact.wav' });
  releaseSounds();
  await flush();
  controller.unlock();
  controller.playEvents([
    { type: 'impact', playerId: 'me' }, { type: 'coinCollected', playerId: 'me' }, { type: 'shotFired', playerId: 'me' }
  ], 'me');
  assert.deepEqual(played, ['/sounds/coin.wav', '/sounds/laser.wav']);
});
