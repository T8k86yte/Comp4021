// Original synthesized game effects: coin, shield fracture, laser and materials.
// No external samples or audio packages. Rebuild with: node scripts/build-sounds.js
const fs = require('node:fs');
const path = require('node:path');
const sampleRate = 44100;
const directory = path.join(__dirname, '../public/sounds');
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

const TAU = Math.PI * 2;
const envelope = (t, attack, decay) => t < 0 ? 0 : (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
const sweep = (t, from, to, decay) => TAU * (to * t + (from - to) * decay * (1 - Math.exp(-t / decay)));

// Two low-pass stages soften the top end, then a high-pass removes rumble.
// Each layer has its own deterministic noise stream, so rebuilds are identical.
function bandNoise(seed, low, high) {
  let filtered = 0, softened = 0, bass = 0;
  const a = 1 - Math.exp(-TAU * high / sampleRate);
  const b = 1 - Math.exp(-TAU * low / sampleRate);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 0x100000000 * 2 - 1;
    filtered += a * (white - filtered);
    softened += a * (filtered - softened);
    bass += b * (softened - bass);
    return softened - bass;
  };
}

// Remove residual DC, taper the endpoints, and leave substantial mix headroom.
// The existing coin render above is deliberately unchanged, byte for byte.
function writeEffect(name, duration, signal, peak) {
  const count = Math.round(duration * sampleRate);
  const samples = new Float64Array(count);
  const dcRate = 1 - Math.exp(-TAU * 25 / sampleRate);
  let dc = 0, maximum = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const value = signal(t);
    dc += dcRate * (value - dc);
    const taper = Math.min(1, t / .0015) * Math.min(1, (duration - t) / .025);
    samples[i] = (value - dc) * taper;
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  // writeWave provides one final gentle edge ramp and PCM encoding.
  writeWave(name, duration, t => samples[Math.round(t * sampleRate)] * peak / maximum);
}

// Shield: an electrical fracture, collapsing field and cascading glassy shards.
// The fragments are inharmonic and staggered, rather than a single bell or thud.
{
  const crack = bandNoise(40211, 950, 6500);
  const fizz = bandNoise(40212, 1800, 5200);
  const shards = [
    [.012, 1750, .095, .18], [.027, 2940, .12, .14], [.039, 4210, .085, .10],
    [.061, 2380, .13, .16], [.083, 5100, .075, .075], [.103, 3320, .14, .10],
    [.137, 1880, .12, .095], [.166, 3890, .10, .075], [.213, 2750, .09, .055]
  ];
  writeEffect('impact.wav', .68, t => {
    const collapse = sweep(t, 2350, 280, .039);
    let value = .7 * crack() * envelope(t, .0007, .018)
      + .22 * Math.sin(collapse + .7 * Math.sin(collapse * 1.41)) * envelope(t, .001, .065)
      + .10 * fizz() * envelope(t, .004, .105);
    for (const [delay, frequency, decay, gain] of shards) {
      const u = t - delay;
      if (u < 0) continue;
      const phase = TAU * (frequency * u - 90 * u * u);
      value += gain * envelope(u, .001, decay)
        * (Math.sin(phase) + .24 * Math.sin(phase * 1.618))
        * (.78 + .22 * Math.sin(TAU * 38 * u));
    }
    return value;
  }, .49);
}

// Laser: sharp ignition followed by the fast falling, springy pitch of a
// cinematic space blaster. All oscillators are original, with no sampled audio.
{
  const ignition = bandNoise(40221, 600, 5000);
  writeEffect('laser.wav', .29, t => {
    const phase = sweep(t, 2650, 145, .025);
    const body = Math.sin(phase + 1.6 * Math.exp(-t / .045) * Math.sin(phase * 1.49));
    const ring = Math.sin(sweep(t, 3900, 360, .018));
    return .65 * body * envelope(t, .0007, .042)
      + .17 * ring * envelope(t, .0005, .022)
      + .35 * ignition() * envelope(t, .0003, .005);
  }, .43);
}

// Slums debris: hollow wooden body, dry snapping grain and scattered splinters.
{
  const snap = bandNoise(40231, 450, 4500);
  const splinterNoise = bandNoise(40232, 800, 3800);
  const pieces = [
    [.013, 710, .018, .42], [.029, 1180, .012, .32], [.052, 440, .026, .24],
    [.076, 1630, .017, .21], [.112, 920, .024, .17], [.157, 570, .031, .12],
    [.214, 1340, .019, .08], [.278, 670, .026, .045]
  ];
  writeEffect('wood-break.wav', .50, t => {
    const grain = splinterNoise();
    let value = 1.3 * snap() * envelope(t, .0004, .012)
      + (.35 * Math.sin(TAU * 165 * t) + .21 * Math.sin(TAU * 317 * t)
        + .12 * Math.sin(TAU * 493 * t)) * envelope(t, .001, .026);
    for (const [delay, frequency, decay, gain] of pieces) {
      const u = t - delay;
      if (u < 0) continue;
      value += gain * envelope(u, .0006, decay)
        * (1.8 * grain + .35 * Math.sin(TAU * frequency * u));
    }
    return value;
  }, .47);
}

// Generic metal fallback: a hard metallic rupture with inharmonic panel
// resonances and small pieces rattling away. Short rings leave room for shots.
{
  const smash = bandNoise(40241, 550, 6500);
  const scatter = bandNoise(40242, 1200, 5800);
  const modes = [[363, .11, .28], [782, .15, .23], [1287, .12, .19],
    [2073, .18, .13], [3191, .105, .085], [4567, .07, .05]];
  const pieces = [[.033, 2440, .11, .17], [.071, 1730, .13, .13],
    [.125, 3710, .085, .10], [.192, 2860, .09, .075], [.284, 1940, .08, .045]];
  writeEffect('metal-break.wav', .72, t => {
    let value = .9 * smash() * envelope(t, .0004, .022);
    const noise = scatter();
    for (const [frequency, decay, gain] of modes) {
      value += gain * envelope(t, .0008, decay)
        * Math.sin(TAU * frequency * t + .22 * Math.sin(TAU * 23 * t));
    }
    for (const [delay, frequency, decay, gain] of pieces) {
      const u = t - delay;
      if (u < 0) continue;
      value += gain * envelope(u, .0005, decay)
        * (Math.sin(TAU * frequency * u) + .3 * Math.sin(TAU * frequency * 1.43 * u) + .8 * noise);
    }
    return value;
  }, .46);
}

// Downtown glass: a broad pane snaps first, followed by many small, bright
// pieces hitting and skittering away. No electrical sweep: the shield effect
// remains a different sound with a collapsing energy field.
{
  const fracture = bandNoise(40311, 1400, 8000);
  const grains = bandNoise(40312, 2600, 7200);
  const shards = [
    [.012, 3610, .040, .17], [.027, 5270, .052, .15], [.044, 2460, .055, .18],
    [.068, 6810, .034, .11], [.095, 4320, .061, .14], [.127, 3140, .073, .13],
    [.166, 5790, .042, .11], [.205, 2280, .067, .10], [.247, 4910, .050, .085],
    [.298, 3770, .059, .075], [.354, 6230, .041, .055], [.414, 2830, .065, .045],
    [.486, 4510, .046, .034], [.562, 3340, .054, .023]
  ];
  writeEffect('glass-break.wav', .86, t => {
    const grain = grains();
    let value = 1.65 * fracture() * envelope(t, .0004, .019)
      + .15 * Math.sin(TAU * 830 * t) * envelope(t, .0008, .015);
    for (const [delay, frequency, decay, gain] of shards) {
      const u = t - delay;
      if (u < 0) continue;
      value += gain * envelope(u, .0004, decay)
        * (Math.sin(TAU * frequency * u) + .28 * Math.sin(TAU * frequency * 1.287 * u)
          + .85 * grain * Math.exp(-u / .009));
    }
    return value;
  }, .46);
}

// Spaceport cargo: a heavy hollow container buckles, tears at the seams, then
// its wide panels clatter. Low resonances give it more weight than loose debris.
{
  const buckle = bandNoise(40321, 140, 3300);
  const tear = bandNoise(40322, 650, 4700);
  const modes = [[108, .090, .40], [227, .13, .30], [419, .10, .21],
    [737, .15, .13], [1219, .11, .09]];
  const panels = [[.036, 173, .10, .22], [.089, 346, .13, .20],
    [.153, 593, .10, .16], [.239, 281, .11, .11], [.348, 847, .09, .07]];
  writeEffect('cargo-break.wav', .84, t => {
    const scrape = tear();
    let value = 1.15 * buckle() * envelope(t, .0008, .034)
      + .50 * scrape * envelope(t - .026, .006, .075)
        * (.55 + .45 * Math.sin(TAU * 61 * t) ** 2);
    for (const [frequency, decay, gain] of modes) {
      value += gain * envelope(t, .001, decay) * Math.sin(TAU * frequency * t);
    }
    for (const [delay, frequency, decay, gain] of panels) {
      const u = t - delay;
      if (u < 0) continue;
      value += gain * envelope(u, .0007, decay)
        * (Math.sin(TAU * frequency * u) + .30 * Math.sin(TAU * frequency * 2.37 * u)
          + .65 * scrape * Math.exp(-u / .020));
    }
    return value;
  }, .48);
}

// Small orbital debris: a short brittle crunch and quick, irregular chips.
// These are close mechanical feedback sounds, not an atmospheric explosion.
{
  const crunch = bandNoise(40331, 950, 5800);
  const grit = bandNoise(40332, 1600, 6800);
  const chips = [[.009, 1850, .018, .24], [.024, 3090, .024, .20],
    [.048, 1280, .022, .15], [.077, 4370, .016, .12], [.119, 2640, .028, .09],
    [.173, 1530, .023, .065], [.229, 3520, .019, .04]];
  writeEffect('debris-break.wav', .46, t => {
    const grain = grit();
    let value = 1.55 * crunch() * envelope(t, .0005, .019)
      + .21 * Math.sin(TAU * 580 * t) * envelope(t, .0007, .015);
    for (const [delay, frequency, decay, gain] of chips) {
      const u = t - delay;
      if (u < 0) continue;
      value += gain * envelope(u, .0004, decay)
        * (1.5 * grain + .6 * Math.sin(TAU * frequency * u)
          + .18 * Math.sin(TAU * frequency * 1.73 * u));
    }
    return value;
  }, .44);
}

// Satellite hull: a larger machine ruptures, its electronics sputter down,
// and larger structural parts ring away. The slow falling whine distinguishes
// it from both the dry debris crack and the short, fast laser shot.
{
  const rupture = bandNoise(40341, 200, 4100);
  const staticNoise = bandNoise(40342, 1600, 6200);
  const modes = [[153, .13, .30], [331, .18, .23], [617, .22, .18],
    [1083, .19, .11], [1861, .16, .08]];
  const panels = [[.054, 467, .14, .17], [.133, 1310, .19, .12],
    [.251, 873, .15, .095], [.382, 2117, .12, .065], [.517, 719, .11, .040]];
  writeEffect('satellite-break.wav', 1.02, t => {
    const sparks = staticNoise();
    let value = 1.20 * rupture() * envelope(t, .0007, .026);
    for (const [frequency, decay, gain] of modes) {
      value += gain * envelope(t, .001, decay) * Math.sin(TAU * frequency * t);
    }
    const u = t - .045;
    if (u >= 0) {
      const powerDown = sweep(u, 1780, 180, .16);
      const flicker = .48 + .52 * Math.sin(TAU * (14 * u + 26 * u * u)) ** 2;
      value += .16 * envelope(u, .006, .15) * flicker
        * (Math.sin(powerDown) + .35 * Math.sin(powerDown * 1.501))
        + .24 * sparks * envelope(u, .003, .12) * flicker;
    }
    for (const [delay, frequency, decay, gain] of panels) {
      const v = t - delay;
      if (v < 0) continue;
      value += gain * envelope(v, .0008, decay)
        * (Math.sin(TAU * frequency * v) + .27 * Math.sin(TAU * frequency * 1.93 * v));
    }
    return value;
  }, .49);
}
