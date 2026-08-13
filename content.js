(function startMusicWaveWatcher() {
  "use strict";

  if (window.top !== window || !globalThis.MusicWaveDetector) {
    return;
  }

  const DEFAULT_SETTINGS = Object.freeze({
    alertsEnabled: true,
    soundEnabled: true,
    titleFlashEnabled: true,
    ntfyEnabled: false
  });
  const MAX_CANDIDATE_TEXT_LENGTH = 800;
  const SCAN_DEBOUNCE_MS = 450;
  const FALLBACK_SCAN_MS = 4000;
  const REMOTE_RETRY_MS = 12000;
  const REMOTE_RETRY_LIMIT = 3;
  const KNOWN_ALERT_SELECTOR = "#alertButton.melon-modal.d_modal_confirm";

  let settings = { ...DEFAULT_SETTINGS };
  let activeKinds = new Set();
  let scanTimer = null;
  let latestSignals = [];
  let titleFlashToken = 0;
  const remoteRetryTimers = new Map();

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isAlertLike(element, text) {
    const semanticContainer = element.closest(
      '[role="dialog"], [role="alertdialog"], [role="alert"], [aria-modal="true"], dialog'
    );
    if (semanticContainer) {
      return true;
    }

    const classAndId = `${element.className || ""} ${element.id || ""}`;
    if (/modal|popup|pop[-_]?up|layer|alert|confirm|notice|warning/i.test(classAndId)) {
      return true;
    }

    const style = getComputedStyle(element);
    const zIndex = Number.parseInt(style.zIndex, 10);
    const hasAction = Boolean(
      element.querySelector('button, [role="button"], input[type="button"], input[type="submit"], a')
    );
    const compactText = text.length <= MAX_CANDIDATE_TEXT_LENGTH;

    return (
      compactText &&
      hasAction &&
      (style.position === "fixed" ||
        (style.position === "absolute" && Number.isFinite(zIndex) && zIndex >= 10))
    );
  }

  function collectSignals() {
    const found = new Map();
    const pageSignals = globalThis.MusicWaveDetector.detectSignals(
      document.body?.innerText || ""
    );
    if (!pageSignals.length) {
      return [];
    }

    const knownAlert = document.querySelector(KNOWN_ALERT_SELECTOR);
    if (knownAlert && isVisible(knownAlert)) {
      const knownSignals = globalThis.MusicWaveDetector.detectSignals(
        knownAlert.innerText || knownAlert.textContent || ""
      );
      for (const signal of knownSignals) {
        found.set(signal.kind, signal);
      }
    }

    const elements = document.querySelectorAll("body *");

    for (const element of elements) {
      const rawText = element.innerText;
      if (!rawText || rawText.length > MAX_CANDIDATE_TEXT_LENGTH) {
        continue;
      }

      const signals = globalThis.MusicWaveDetector.detectSignals(rawText);
      if (!signals.length || !isVisible(element) || !isAlertLike(element, rawText)) {
        continue;
      }

      for (const signal of signals) {
        found.set(signal.kind, signal);
      }

      if (found.size >= 2) {
        break;
      }
    }

    return [...found.values()];
  }

  function clearRemoteRetry(kind) {
    const retry = remoteRetryTimers.get(kind);
    if (retry) {
      window.clearTimeout(retry.timer);
      remoteRetryTimers.delete(kind);
    }
  }

  function scheduleRemoteRetry(signal, attempt = 1) {
    if (
      !settings.ntfyEnabled ||
      attempt > REMOTE_RETRY_LIMIT ||
      remoteRetryTimers.has(signal.kind)
    ) {
      return;
    }

    const timer = window.setTimeout(async () => {
      remoteRetryTimers.delete(signal.kind);
      if (!settings.ntfyEnabled || !activeKinds.has(signal.kind)) {
        return;
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: "MUSIC_WAVE_ALERT_RETRY_REMOTE",
          signal
        });
        if (!response?.remote?.delivered) {
          scheduleRemoteRetry(signal, attempt + 1);
        }
      } catch (_error) {
        scheduleRemoteRetry(signal, attempt + 1);
      }
    }, REMOTE_RETRY_MS);

    remoteRetryTimers.set(signal.kind, { timer, attempt });
  }

  function playAlertSound(severity) {
    if (!settings.soundEnabled) {
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }

      const context = new AudioContextClass();
      const toneCount = severity === "critical" ? 3 : 2;
      const startAt = context.currentTime;

      for (let index = 0; index < toneCount; index += 1) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = startAt + index * 0.28;
        oscillator.type = severity === "critical" ? "sawtooth" : "sine";
        oscillator.frequency.value = severity === "critical" ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.2);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.22);
      }

      window.setTimeout(() => context.close().catch(() => {}), toneCount * 300 + 300);
    } catch (_error) {
      // 시스템 알림은 계속 동작하므로 오디오 차단 오류는 무시한다.
    }
  }

  function showPageToast(signal) {
    document.getElementById("music-wave-alert-host")?.remove();

    const host = document.createElement("div");
    host.id = "music-wave-alert-host";
    host.style.cssText = [
      "position:fixed",
      "top:20px",
      "right:20px",
      "z-index:2147483647",
      "font-family:Arial,'Noto Sans KR',sans-serif"
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("section");
    panel.setAttribute("role", "alert");
    panel.style.cssText = [
      "width:320px",
      "padding:16px",
      "border-radius:14px",
      "color:#fff",
      `background:${signal.severity === "critical" ? "#b42318" : "#7a271a"}`,
      "box-shadow:0 18px 45px rgba(0,0,0,.38)",
      "border:1px solid rgba(255,255,255,.2)"
    ].join(";");

    const title = document.createElement("strong");
    title.textContent = signal.title;
    title.style.cssText = "display:block;font-size:16px;margin:0 28px 6px 0";

    const message = document.createElement("p");
    message.textContent = signal.message;
    message.style.cssText = "font-size:13px;line-height:1.5;margin:0;opacity:.92";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "알림 닫기");
    close.style.cssText = [
      "position:absolute",
      "top:8px",
      "right:10px",
      "border:0",
      "background:transparent",
      "color:#fff",
      "font-size:24px",
      "cursor:pointer"
    ].join(";");
    close.addEventListener("click", () => host.remove(), { once: true });

    panel.append(title, message, close);
    shadow.append(panel);
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), signal.severity === "critical" ? 20000 : 12000);
  }

  function flashTitle(signal) {
    if (!settings.titleFlashEnabled) {
      return;
    }

    const token = ++titleFlashToken;
    const prefix = signal.severity === "critical" ? "🚨 감지 경고 | " : "🔔 확인 필요 | ";
    const stripAlertPrefix = (value) => value.replace(/^(?:🚨 감지 경고|🔔 확인 필요) \| /, "");
    let visible = false;
    let changes = 0;

    const timer = window.setInterval(() => {
      if (token !== titleFlashToken) {
        window.clearInterval(timer);
        return;
      }

      const baseTitle = stripAlertPrefix(document.title);
      visible = !visible;
      document.title = visible ? `${prefix}${baseTitle}` : baseTitle;
      changes += 1;

      if (changes >= 10) {
        document.title = stripAlertPrefix(document.title);
        window.clearInterval(timer);
      }
    }, 700);
  }

  function announce(signal) {
    if (!settings.alertsEnabled && !settings.ntfyEnabled) {
      return;
    }

    if (settings.alertsEnabled) {
      showPageToast(signal);
      playAlertSound(signal.severity);
      flashTitle(signal);
    }

    chrome.runtime
      .sendMessage({ type: "MUSIC_WAVE_ALERT", signal })
      .then((response) => {
        if (settings.ntfyEnabled && !response?.remote?.delivered) {
          scheduleRemoteRetry(signal);
        }
      })
      .catch(() => {
        if (settings.ntfyEnabled) {
          scheduleRemoteRetry(signal);
        }
      });
  }

  function scanPage() {
    scanTimer = null;
    const signals = collectSignals();
    const nextKinds = new Set(signals.map((signal) => signal.kind));
    latestSignals = signals;

    for (const kind of remoteRetryTimers.keys()) {
      if (!nextKinds.has(kind)) {
        clearRemoteRetry(kind);
      }
    }

    for (const signal of signals) {
      if (!activeKinds.has(signal.kind)) {
        announce(signal);
      }
    }

    activeKinds = nextKinds;
  }

  function scheduleScan() {
    if (scanTimer !== null) {
      return;
    }

    scanTimer = window.setTimeout(scanPage, SCAN_DEBOUNCE_MS);
  }

  function reportTabPresent() {
    return chrome.runtime
      .sendMessage({ type: "MUSIC_WAVE_TAB_PRESENT" })
      .catch(() => undefined);
  }

  function reportTabLeaving() {
    chrome.runtime
      .sendMessage({ type: "MUSIC_WAVE_TAB_LEAVING" })
      .catch(() => {});
  }

  async function initialize() {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.sync.get(DEFAULT_SETTINGS))
    };
    await reportTabPresent();
    window.addEventListener("pagehide", reportTabLeaving, { capture: true });

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "open"]
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (changes[key]) {
          settings[key] = changes[key].newValue;
        }
      }
      if (!settings.ntfyEnabled) {
        for (const kind of remoteRetryTimers.keys()) {
          clearRemoteRetry(kind);
        }
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "MUSIC_WAVE_GET_STATUS") {
        return undefined;
      }

      sendResponse({
        watching: true,
        activeSignals: latestSignals.map((signal) => signal.kind)
      });
      return undefined;
    });

    scanPage();
    window.setInterval(scheduleScan, FALLBACK_SCAN_MS);
  }

  initialize().catch(() => {});
})();
