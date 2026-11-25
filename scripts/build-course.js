// The authored layout is kept here so lane/route changes regenerate reproducibly.
const fs = require('node:fs');
const path = require('node:path');
const segments = {};
const exits = (id, lanes = 4) => Array.from({ length: lanes }, (_, lane) => [id, Math.min(lane, 3)]);
function segment(id, name, stage, length, progress, next, options = {}) {
  segments[id] = { name, stage, mode: 'ground', laneCount: 4, length, progress,
    ...(next ? { exits: exits(next) } : {}), objects: [], ...options };
}
function objects(id, type, cells, visual) {
  cells.forEach(([distance, lane, altitude], index) => segments[id].objects.push({
    id: `${id}-${type}-${index + 1}`, type, distance, lane,
    ...(altitude === undefined ? {} : { altitude }), ...(visual ? { visual } : {})
  }));
}

segment('slums-basin', 'Drainage basin', 'slums', 50, [0, 50], null, {
  sign: 'LEFT: scaffold shortcut / THROUGH: market channel',
  exits: [['slums-scaffold', 1], ['slums-market', 1], ['slums-market', 2], ['slums-market', 3]]
});
segment('slums-market', 'Market channel', 'slums', 110, [50, 160], 'slums-gate');
segment('slums-scaffold', 'Scaffold shortcut', 'slums', 100, [50, 160], 'slums-gate', {
  laneCount: 3, exits: [['slums-gate', 0], ['slums-gate', 0], ['slums-gate', 0]], sign: 'MERGE: service gate'
});
segment('slums-gate', 'Service gate climb', 'slums', 60, [160, 220], 'downtown-plaza', { sign: 'DOWNTOWN: security gate' });
objects('slums-basin', 'coin', [[14, 1], [25, 2]], 'scrap-token');
objects('slums-basin', 'crate', [[36, 1]], 'scrap-crate');
objects('slums-basin', 'barrier', [[44, 3]], 'pipe');
objects('slums-market', 'coin', [[22, 2], [52, 1], [86, 3]], 'scrap-token');
objects('slums-market', 'crate', [[33, 2], [64, 1], [98, 3]], 'scrap-crate');
objects('slums-market', 'barrier', [[44, 3], [77, 2], [98, 0]], 'pipe');
objects('slums-scaffold', 'coin', [[58, 1]], 'scrap-token');
objects('slums-scaffold', 'crate', [[24, 1], [68, 2], [88, 0]], 'scrap-crate');
objects('slums-scaffold', 'barrier', [[44, 0], [78, 1]], 'pipe');
objects('slums-gate', 'barrier', [[20, 1], [38, 2], [50, 0]], 'pipe');
objects('slums-gate', 'crate', [[30, 3], [45, 1]], 'scrap-crate');

segment('downtown-plaza', 'Transit plaza', 'downtown', 45, [220, 265], null, {
  sign: 'LEFT: service shortcut / RIGHT: coin terraces',
  exits: [['downtown-service', 1], ['downtown-boulevard', 1], ['downtown-boulevard', 2], ['downtown-terrace', 1]]
});
segment('downtown-boulevard', 'Glass boulevard', 'downtown', 125, [265, 390], 'downtown-access');
segment('downtown-service', 'Glass service corridor', 'downtown', 105, [265, 390], 'downtown-access', {
  laneCount: 3, exits: [['downtown-access', 0], ['downtown-access', 0], ['downtown-access', 0]]
});
segment('downtown-terrace', 'Garden terraces', 'downtown', 140, [265, 390], 'downtown-access', {
  laneCount: 3, exits: [['downtown-access', 3], ['downtown-access', 3], ['downtown-access', 3]]
});
segment('downtown-access', 'Spaceport approach', 'downtown', 70, [390, 460], 'spaceport-hangar', { sign: 'SPACEPORT: access hatch' });
objects('downtown-plaza', 'barrier', [[21, 2]], 'car');
objects('downtown-plaza', 'crate', [[30, 1]], 'glass');
objects('downtown-boulevard', 'coin', [[29, 1], [63, 2], [101, 3]], 'city-credit');
objects('downtown-boulevard', 'barrier', [[18, 0], [45, 2], [79, 1], [110, 3]], 'car');
objects('downtown-boulevard', 'crate', [[54, 1], [90, 0], [116, 2]], 'glass');
objects('downtown-service', 'coin', [[61, 1]], 'city-credit');
objects('downtown-service', 'crate', [[21, 0], [21, 1], [21, 2], [74, 1], [91, 2]], 'glass');
objects('downtown-service', 'barrier', [[46, 2], [85, 0]], 'wall');
objects('downtown-terrace', 'coin', [[30, 0], [66, 2], [107, 1]], 'city-credit');
objects('downtown-terrace', 'barrier', [[46, 1], [86, 0], [120, 2]], 'planter');
objects('downtown-terrace', 'crate', [[56, 2], [94, 1]], 'glass');
objects('downtown-access', 'barrier', [[21, 1], [46, 2], [60, 3]], 'car');
objects('downtown-access', 'crate', [[35, 3], [55, 0]], 'glass');

segment('spaceport-hangar', 'Hangar break-in', 'spaceport', 65, [460, 525], 'orbit-launch', { sign: 'LAUNCH: shuttle assigned to every lane' });
segment('orbit-launch', 'Launch corridor', 'spaceport', 30, [525, 555], null, {
  mode: 'flight', sign: 'LEFT: outer drift / THROUGH: debris corridor',
  exits: [['orbit-drift', 0], ['orbit-debris', 1], ['orbit-debris', 2], ['orbit-debris', 3]]
});
segment('orbit-debris', 'Debris corridor', 'spaceport', 110, [555, 665], 'orbit-dock', { mode: 'flight' });
segment('orbit-drift', 'Outer drift', 'spaceport', 125, [555, 665], 'orbit-dock', { mode: 'flight' });
segment('orbit-dock', 'Crystal Palace approach', 'spaceport', 70, [665, 735], null, { mode: 'flight', sign: 'CRYSTAL PALACE: all lanes and altitudes dock' });
objects('spaceport-hangar', 'coin', [[20, 1], [42, 2]], 'crystal-shard');
objects('spaceport-hangar', 'crate', [[29, 2], [47, 0]], 'cargo');
objects('spaceport-hangar', 'barrier', [[36, 1], [52, 3]], 'cargo-wall');
objects('orbit-launch', 'coin', [[21, 2, 2]], 'crystal-shard');
objects('orbit-debris', 'coin', [[37, 1, 0], [79, 3, 2]], 'crystal-shard');
objects('orbit-debris', 'crate', [[18, 1, 1], [33, 2, 2], [53, 3, 1], [70, 1, 0], [88, 2, 1], [101, 0, 2]], 'debris');
objects('orbit-debris', 'barrier', [[44, 0, 1], [62, 2, 1], [95, 3, 0]], 'satellite-hull');
objects('orbit-drift', 'coin', [[67, 0, 2]], 'crystal-shard');
objects('orbit-drift', 'crate', [[37, 1, 1], [92, 2, 0], [111, 3, 2]], 'debris');
objects('orbit-dock', 'coin', [[34, 2, 1]], 'crystal-shard');
objects('orbit-dock', 'crate', [[17, 1, 1], [42, 3, 2]], 'debris');
objects('orbit-dock', 'barrier', [[28, 0, 0]], 'satellite-hull');

const course = { id: 'city-to-crystal-palace', name: 'City to the Crystal Palace',
  startSegmentId: 'slums-basin', finishProgress: 735,
  pacing: { cleanRouteSeconds: { shortest: 141, main: 147, longest: 153 }, roundLimitSeconds: 180 },
  stages: {
    slums: { name: 'The Slums', art: '/assets/slums.png', color: '#f4ad62', coins: 6 },
    downtown: { name: 'Downtown', art: '/assets/downtown.png', color: '#a6ecf5', coins: 7 },
    spaceport: { name: 'Spaceport and orbit', art: '/assets/spaceport.png', color: '#b6b7ff', coins: 7 }
  }, segments };
fs.writeFileSync(path.join(__dirname, '../race/full-course.json'), `${JSON.stringify(course, null, 2)}\n`);
