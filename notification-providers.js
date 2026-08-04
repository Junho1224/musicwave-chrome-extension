(function initMusicWaveNotificationProviders(root) {
  "use strict";

  const NTFY_ORIGIN = "https://ntfy.sh";
  const TOPIC_PATTERN = /^music-wave-[a-f0-9]{48}$/;

  function isValidNtfyTopic(value) {
    return TOPIC_PATTERN.test(String(value || ""));
  }

  function buildNtfyPayload(signal) {
    return {
      title: `[MUSIC WAVE] ${signal.title}`,
      message: signal.message,
      priority: signal.severity === "critical" ? 5 : 4,
      tags: [signal.severity === "critical" ? "rotating_light" : "bell"]
    };
  }

  const api = Object.freeze({
    ntfy: Object.freeze({
      id: "ntfy",
      origin: NTFY_ORIGIN,
      permissionOrigin: `${NTFY_ORIGIN}/*`,
      endpoint: `${NTFY_ORIGIN}/`,
      isValidTopic: isValidNtfyTopic,
      buildPayload: buildNtfyPayload
    })
  });

  root.MusicWaveNotificationProviders = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
