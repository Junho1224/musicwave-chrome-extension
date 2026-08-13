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

  function evaluateTrackedRemoval({
    trackedTabIds,
    removedTabId,
    remainingTabIds,
    notificationsEnabled,
    hasBrowserWindow
  }) {
    const tracked = new Set(trackedTabIds.filter(Number.isInteger));
    const remaining = [...new Set(remainingTabIds.filter(Number.isInteger))];
    const wasTracked = tracked.has(removedTabId);
    return Object.freeze({
      wasTracked,
      trackedTabIds: Object.freeze(remaining),
      shouldNotify: Boolean(
        wasTracked &&
          remaining.length === 0 &&
          notificationsEnabled &&
          hasBrowserWindow
      )
    });
  }

  const api = Object.freeze({ evaluatePresence, evaluateTrackedRemoval });
  root.MusicWaveTabMonitor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
