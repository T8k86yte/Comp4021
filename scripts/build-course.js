// The authored layout is kept here so lane/route changes regenerate reproducibly.
const fs = require('node:fs');
const path = require('node:path');
const segments = {};
const exits = id => Array.from({ length: 4 }, (_, lane) => [id, lane]);
function segment(id, name, stage, length, progress, next, options = {}) {
  segments[id] = { name, stage, mode: 'ground', laneCount: 4, length, progress,
    ...(next ? { exits: exits(next) } : {}), objects: [], ...options };
}
function objects(id, type, cells, visual) {
  const offset = segments[id].objects.filter(object => object.type === type).length;
  cells.forEach(([distance, lane, altitude], index) => segments[id].objects.push({
    id: id + '-' + type + '-' + (offset + index + 1), type, distance, lane,
    ...(altitude === undefined ? {} : { altitude }), ...(visual ? { visual } : {})
  }));
}

segment('slums-basin', 'Drainage basin', 'slums', 50, [0, 50], 'slums-market');
segment('slums-market', 'Market channel', 'slums', 110, [50, 160], 'slums-gate');
segment('slums-gate', 'Service gate climb', 'slums', 60, [160, 220], 'downtown-plaza', {
  gate: { style: 'slums', kind: 'area', label: 'DOWNTOWN', subtitle: 'SECURITY CHECKPOINT' }
});
segment('downtown-plaza', 'Transit plaza', 'downtown', 45, [220, 265], 'downtown-boulevard');
segment('downtown-boulevard', 'Glass boulevard', 'downtown', 125, [265, 390], 'downtown-access');
segment('downtown-access', 'Spaceport approach', 'downtown', 70, [390, 460], 'spaceport-hangar', {
  gate: { style: 'downtown', kind: 'area', label: 'SPACEPORT', subtitle: 'TRANSIT AIRLOCK' }
});
segment('spaceport-hangar', 'Launch hangar', 'spaceport', 65, [460, 525], 'orbit-launch', {
  gate: { style: 'spaceport', kind: 'launch', label: 'ORBITAL LAUNCH', subtitle: 'SHUTTLE BAY / READY' }
});
segment('orbit-launch', 'Atmospheric ascent', 'spaceport', 105, [525, 630], 'orbit-debris', {
  mode: 'flight', flightPhase: 'atmosphere', transitionLength: 18
});
segment('orbit-debris', 'Debris corridor', 'spaceport', 35, [630, 665], 'orbit-dock', {
  mode: 'flight', flightPhase: 'orbit', arrivalBlend: 8
});
segment('orbit-dock', 'Crystal Palace approach', 'spaceport', 70, [665, 735], null, {
  mode: 'flight', flightPhase: 'orbit',
  gate: { style: 'palace', kind: 'dock', label: 'CRYSTAL PALACE', subtitle: 'ARRIVALS / DOCKING BAY' }
});

// Keep all twenty shared coins at their existing positions, with their IDs.
objects('slums-basin', 'coin', [[14, 1], [25, 2]], 'scrap-token');
objects('slums-market', 'coin', [[22, 2], [52, 1], [86, 3]], 'scrap-token');
objects('slums-gate', 'coin', [[12, 2]], 'scrap-token');
objects('downtown-plaza', 'coin', [[12, 1], [38, 3]], 'city-credit');
objects('downtown-boulevard', 'coin', [[29, 1], [63, 2], [101, 3]], 'city-credit');
objects('downtown-access', 'coin', [[14, 2], [63, 1]], 'city-credit');
objects('spaceport-hangar', 'coin', [[20, 1], [42, 2]], 'crystal-shard');
objects('orbit-launch', 'coin', [[21, 2, 1]], 'crystal-shard');
segments['orbit-launch'].objects.push({ id: 'orbit-debris-coin-1', type: 'coin',
  distance: 67, lane: 1, altitude: 1, visual: 'crystal-shard' });
segments['orbit-debris'].objects.push({ id: 'orbit-debris-coin-2', type: 'coin',
  distance: 4, lane: 3, altitude: 2, visual: 'crystal-shard' });
objects('orbit-dock', 'coin', [[34, 2, 1], [56, 1, 2]], 'crystal-shard');

// Each encounter is [distance, breakable lane, solid lane]; null omits a prop.
// Alternate pairs and single walls, leaving two adjacent lanes clear. A 16-cell
// gap gives 1.6 seconds at normal speed, including across segment boundaries.
// Single rows bridge the openings as they move gradually across the road.
const groundEncounters = {
  'slums-basin': [[18, 0, 3], [34, null, 1]],
  'slums-market': [[12, 0, 1], [28, null, 3], [44, 2, 3], [60, null, 0], [76, 0, 3], [92, null, 1]],
  'slums-gate': [[8, 0, 1], [24, null, 3], [40, 2, 3]],
  // Area-entry fades finish at 3.6 cells. Give the newly revealed lanes at
  // least 16 clear cells before a hazard (also >1 second at 1.5x speed).
  'downtown-plaza': [[20, 2, 3], [36, null, 0]],
  'downtown-boulevard': [[12, 0, 3], [28, null, 1], [44, 0, 1], [60, null, 3], [76, 2, 3], [92, null, 0], [108, 0, 3]],
  'downtown-access': [[10, 0, 3], [26, null, 1], [42, 0, 1], [58, null, 3]],
  'spaceport-hangar': [[20, 2, 3], [36, null, 0], [52, 0, 3]]
};
const groundArt = { slums: ['scrap-crate', 'pipe'], downtown: ['glass', 'car'], spaceport: ['cargo', 'cargo-wall'] };
for (const [id, rows] of Object.entries(groundEncounters)) {
  const [crateArt, wallArt] = groundArt[segments[id].stage];
  for (const [distance, crateLane, wallLane] of rows) {
    if (crateLane !== null) objects(id, 'crate', [[distance, crateLane]], crateArt);
    if (wallLane !== null) objects(id, 'barrier', [[distance, wallLane]], wallArt);
  }
}

// Three independently timed civilian hulls. Only one can occupy an encounter;
// each sweeps a single lane at a time and reverses outside the corridor edges.
// The final 35 ascent cells remain empty for the unfolding altitude guides.
for (const [index, distance] of [[0, 16], [2, 42], [4, 70]]) {
  segments['orbit-launch'].objects.push({ id: 'atmosphere-traffic-' + (index + 1), type: 'barrier',
    visual: 'crossing-ship', sprite: index % 4, distance, lane: index % 4, altitude: 1,
    motion: { kind: 'crossing', periodMs: 4800 + index % 3 * 600, phaseMs: 850 + index * 730 } });
}

// At most two pieces per orbital encounter, never covering all three levels.
// Leave the first 12 orbital cells clear of hazards after altitude unlock.
// Both satellites remain ordinary breakable wreckage; no enemies or gadgets.
objects('orbit-debris', 'crate', [[12, 2, 0], [12, 1, 2], [28, 0, 1]], 'debris');
objects('orbit-debris', 'crate', [[28, 3, 0]], 'satellite-hull');
objects('orbit-dock', 'crate', [[12, 2, 1], [12, 0, 2], [44, 3, 2], [44, 1, 1], [60, 3, 0], [60, 0, 2]], 'debris');
objects('orbit-dock', 'crate', [[28, 0, 0]], 'satellite-hull');

for (const section of Object.values(segments)) {
  section.objects.sort((a, b) => a.distance - b.distance || a.lane - b.lane || (a.altitude ?? 0) - (b.altitude ?? 0));
}

const cruiseSpeed = 10; // 0.8 times the preceding 12.5-cell/second pace.
const cleanSeconds = 735 / cruiseSpeed;
const course = { id: 'city-to-crystal-palace', name: 'City to the Crystal Palace',
  startSegmentId: 'slums-basin', finishProgress: 735, cruiseSpeed,
  pacing: { cleanRouteSeconds: { shortest: cleanSeconds, main: cleanSeconds, longest: cleanSeconds }, roundLimitSeconds: 180 },
  stages: {
    slums: { name: 'The Slums', art: '/assets/slums.png', color: '#f4ad62', coins: 6 },
    downtown: { name: 'Downtown', art: '/assets/downtown.png', color: '#a6ecf5', coins: 7 },
    spaceport: { name: 'Spaceport and orbit', art: '/assets/spaceport.png', color: '#b6b7ff', coins: 7 }
  }, segments };
fs.writeFileSync(path.join(__dirname, '../race/full-course.json'), JSON.stringify(course, null, 2) + '\n');
