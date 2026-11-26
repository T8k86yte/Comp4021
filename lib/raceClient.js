// The local playtest runs the same deterministic engine as server matches.
const fs = require('node:fs');
const path = require('node:path');
function raceClientSource() {
  const read = file => fs.readFileSync(path.join(__dirname, '../race', file), 'utf8');
  return `window.previewRace = (() => {
    const module = { exports: {} };
    const motionModule = { exports: {} };
    ((module) => { ${read('../public/js/race-motion.js')} })(motionModule);
    const require = id => id === '../public/js/race-motion' ? motionModule.exports : (${read('prototype-track.json')});
    ${read('index.js')}
    return { ...module.exports, track: ${read('full-course.json')} };
  })();`;
}
module.exports = { raceClientSource };
