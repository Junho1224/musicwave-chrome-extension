(function initMusicWavePlaybackMonitor(root) {
  "use strict";

  function createMonitor({ stopDelayMs = 15000 } = {}) {
    let hasPlayed = false;
    let lastTime = null;
    let lastProgressAt = null;

    function sample({ available = true, currentTime = 0, paused = true,
      ended = false, seeking = false, now = Date.now() } = {}) {
      const time = Number.isFinite(currentTime) ? currentTime : 0;
      const playing = available && !paused && !ended && !seeking;
      // An already paused player with elapsed time also needs monitoring after reload.
      if (available && time > 0 && !hasPlayed) {
        hasPlayed = true;
        lastProgressAt = now;
      }
      if (playing && lastTime !== null && Math.abs(time - lastTime) > 0.05) {
        hasPlayed = true;
        lastProgressAt = now;
      }
      lastTime = available ? time : null;

      const stopped = hasPlayed && now - lastProgressAt >= stopDelayMs;
      const state = stopped ? "stopped" : !hasPlayed
        ? (available ? "idle" : "unavailable")
        : playing && now === lastProgressAt ? "playing" : "waiting";
      return { state, stopped, hasPlayed };
    }

    return Object.freeze({ sample });
  }

  const api = Object.freeze({ createMonitor });
  root.MusicWavePlaybackMonitor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
