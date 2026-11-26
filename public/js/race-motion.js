// Shared deterministic traffic paths: the server and Canvas use the race clock.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RaceMotion = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  function trafficPose(object, elapsedMs, laneCount = 4) {
    if (!object.motion) return { lane: object.lane, direction: 0 };
    const { periodMs, phaseMs = 0 } = object.motion;
    const phase = (((elapsedMs + phaseMs) % periodMs) + periodMs) % periodMs / periodMs;
    const travel = phase < .5 ? phase * 2 : 2 - phase * 2;
    return { lane: -.65 + travel * (laneCount + .3), direction: phase < .5 ? 1 : -1 };
  }
  function occupiesLane(object, lane, elapsedMs, laneCount = 4) {
    return object.motion ? Math.abs(trafficPose(object, elapsedMs, laneCount).lane - lane) <= .48 : object.lane === lane;
  }
  return { trafficPose, occupiesLane };
});
