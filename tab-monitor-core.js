(function initMusicWaveTabMonitor(root) {
  "use strict";

  function evaluatePresence({
    wasOpen,
    currentCount,
    notificationsEnabled,
    hasBrowserWindow
  }) {
    const isOpen = Number(currentCount) > 0;
    return Object.freeze({
      wasOpen: isOpen,
      shouldNotify: Boolean(
        wasOpen && !isOpen && notificationsEnabled && hasBrowserWindow
      )
    });
  }

  const api = Object.freeze({ evaluatePresence });
  root.MusicWaveTabMonitor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
