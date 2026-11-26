// Original synthesized effects for the existing coin/impact audio hooks.
// No external samples or audio packages. Rebuild with: node scripts/build-sounds.js
const fs = require('node:fs');
const path = require('node:path');
const sampleRate = 44100;
const directory = path.join(__dirname, '../public/assets/sounds');
fs.mkdirSync(directory, { recursive: true });
function writeWave(name, duration, signal) {
  const count = Math.round(duration * sampleRate);
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / .004) * Math.min(1, (duration - t) / .018);
    const sample = Math.max(-1, Math.min(1, envelope * signal(t)));
    data.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(directory, name), data);
}
writeWave('coin.wav', .22, t => {
  const phase = 2 * Math.PI * (900 * t + 1800 * t * t);
  return .26 * Math.exp(-13 * t) * (Math.sin(phase) + .22 * Math.sin(phase * 2));
});
let seed = 4021;
writeWave('impact.wav', .25, t => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const noise = seed / 0x100000000 * 2 - 1;
  return .27 * Math.exp(-18 * t) * (.65 * noise + Math.sin(2 * Math.PI * (100 * t - 90 * t * t)));
});
