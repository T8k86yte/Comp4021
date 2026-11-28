// Shared by multiplayer and the solo preview. Browsers enable Web Audio
// after a gameplay key press or click on this page.
window.createRaceAudio = function createRaceAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = AudioContext ? new AudioContext() : null;
  const buffers = new Map();
  const objectSounds = new Map();
  const materials = {
    'scrap-crate': 'wood-break', glass: 'glass-break', cargo: 'cargo-break',
    debris: 'debris-break', 'satellite-hull': 'satellite-break'
  };
  let indexedTrack = null;

  if (context) {
    for (const name of ['coin', 'impact', 'laser', 'wood-break', 'metal-break',
      'glass-break', 'cargo-break', 'debris-break', 'satellite-break']) {
      fetch(`/sounds/${name}.wav`, { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`Sound unavailable: ${name}`);
          return response.arrayBuffer();
        })
        .then(data => context.decodeAudioData(data))
        .then(buffer => buffers.set(name, buffer))
        .catch(() => {}); // Missing audio must not interrupt the race.
    }
  }

  function unlock() {
    if (context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().catch(() => {});
    }
  }

  function materialSound(object, segment) {
    if (materials[object?.visual]) return materials[object.visual];
    // Older courses may omit visual metadata; keep their stage-appropriate sound.
    if (segment?.stage === 'slums') return 'wood-break';
    if (segment?.stage === 'downtown') return 'glass-break';
    if (segment?.stage === 'spaceport') return segment.mode === 'flight' ? 'debris-break' : 'cargo-break';
    return 'metal-break';
  }

  function destructionSound(event, track) {
    if (indexedTrack !== track) {
      indexedTrack = track;
      objectSounds.clear();
      for (const segment of Object.values(track?.segments || {})) {
        for (const object of segment.objects || []) objectSounds.set(object.id, materialSound(object, segment));
      }
    }
    // A projectile can cross a segment boundary before hitting its target.
    // Use the destroyed object's location, not the shooter's current stage.
    return objectSounds.get(event.objectId) || materialSound(null,
      track?.segments[event.segmentId] || { stage: event.stage });
  }

  function playEvents(events, playerId, track) {
    // Don't queue old effects to burst out when audio is enabled later.
    if (!context || context.state !== 'running') return;
    for (const event of events) {
      if (event.playerId !== playerId) continue;
      let name;
      if (event.type === 'coinCollected') name = 'coin';
      else if (event.type === 'impact') name = 'impact';
      else if (event.type === 'shotFired') name = 'laser';
      else if (event.type === 'crateBroken' && event.source === 'shot') name = destructionSound(event, track);
      const buffer = buffers.get(name);
      if (!buffer) continue;
      // Colliding with a crate already emits impact; shotHit accompanies
      // crateBroken. Neither should add a second destruction/impact sound.
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => source.disconnect();
      source.start();
    }
  }

  return { unlock, playEvents };
};
