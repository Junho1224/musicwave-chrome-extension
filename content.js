(function startMusicWaveWatcher() {
  "use strict";

  if (
    window.top !== window ||
    !globalThis.MusicWaveDetector ||
    !globalThis.MusicWavePlaybackMonitor ||
    globalThis.__musicWaveAlertWatcherStarted
  ) {
    return;
  }
  globalThis.__musicWaveAlertWatcherStarted = true;

  const DEFAULT_SETTINGS = Object.freeze({
    alertsEnabled: true,
    soundEnabled: true,
    titleFlashEnabled: true,
    ntfyEnabled: false,
    playbackAlertEnabled: true,
    autoConfirmContinueEnabled: false,
    autoReloadContinueEnabled: false
  });
  const MAX_CANDIDATE_TEXT_LENGTH = 800;
  const SCAN_DEBOUNCE_MS = 450;
  const FALLBACK_SCAN_MS = 4000;
  const ALERT_RETRY_MS = 12000;
  const TAB_HEARTBEAT_MS = 15000;
  const AUTO_CONFIRM_GRACE_MS = 5000;
  let autoConfirmAttempted = false;
  let lastAutoConfirmAt = null;
  let lastAutoConfirmOutcome = null;
  let lastAutoContinueAction = "confirm";
  const KNOWN_ALERT_SELECTOR = "#alertButton.melon-modal.d_modal_confirm";

  let settings = { ...DEFAULT_SETTINGS };
  let activeKinds = new Set();
  let scanTimer = null;
  let latestSignals = [];
  let titleFlashToken = 0;
  const alertDeliveries = new Map();
  const playbackMonitor = MusicWavePlaybackMonitor.createMonitor();
  let playbackStatus = { state: "unavailable", stopped: false, hasPlayed: false };

  const PLAYBACK_STOPPED_SIGNAL = Object.freeze({
    kind: "playbackStopped",
    severity: "critical",
    title: "MUSIC WAVE 재생 중단",
    message: "음악 재생이 15초 이상 멈췄습니다. MUSIC WAVE 탭을 확인하세요."
  });

  function sendRuntimeMessage(message) {
    try {
      if (!chrome.runtime?.id) {
        return Promise.resolve({ notified: false, reason: "extension-reloaded" });
      }
      return chrome.runtime.sendMessage(message).catch(() => ({
        notified: false, reason: "message-failed"
      }));
    } catch (_error) {
      return Promise.resolve({ notified: false, reason: "extension-reloaded" });
    }
  }

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
    const knownAlert = document.querySelector(KNOWN_ALERT_SELECTOR);
    if (knownAlert && isVisible(knownAlert)) {
      const knownSignals = globalThis.MusicWaveDetector.detectSignals(
        knownAlert.innerText || knownAlert.textContent || ""
      );
      for (const signal of knownSignals) {
        found.set(signal.kind, signal);
      }
    }

    const pageSignals = globalThis.MusicWaveDetector.detectSignals(
      document.body?.innerText || ""
    );
    if (!pageSignals.length) return [...found.values()];

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

  function tryAutoConfirmContinue(signals) {
    const hasContinue = signals.some((signal) => signal.kind === "continue");
    if (!hasContinue) {
      autoConfirmAttempted = false;
      return false;
    }
    if ((!settings.autoConfirmContinueEnabled && !settings.autoReloadContinueEnabled) ||
        signals.some((signal) => signal.kind === "mechanical")) return false;
    try {
      if (!chrome.runtime?.id) return false;
    } catch (_error) {
      return false;
    }
    if (autoConfirmAttempted) {
      return ["clicked", "reload-pending", "reloaded"].includes(lastAutoConfirmOutcome) &&
        Date.now() - lastAutoConfirmAt < AUTO_CONFIRM_GRACE_MS;
    }

    const modal = document.querySelector(KNOWN_ALERT_SELECTOR);
    if (!modal || !isVisible(modal)) return false;
    const kinds = MusicWaveDetector.detectSignals(modal.innerText || modal.textContent || "")
      .map((signal) => signal.kind);
    if (kinds.length !== 1 || kinds[0] !== "continue") return false;
    if (modal.querySelector('iframe, input, .g-recaptcha, .h-captcha, [class*="captcha"], [id*="captcha"]')) {
      return false;
    }
    if (settings.autoReloadContinueEnabled) {
      autoConfirmAttempted = true;
      lastAutoConfirmAt = Date.now();
      lastAutoConfirmOutcome = "reload-pending";
      lastAutoContinueAction = "reload";
      sendRuntimeMessage({ type: "MUSIC_WAVE_AUTO_RELOAD_CONTINUE" }).then((response) => {
        lastAutoConfirmOutcome = response?.reloaded ? "reloaded" : "failed";
        scheduleScan();
      });
      return true;
    }
    const button = modal.querySelector("button.btn-submit");
    if (!button || !isVisible(button) || button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        MusicWaveDetector.normalizeText(button.textContent) !== "확인") return false;

    autoConfirmAttempted = true;
    lastAutoConfirmAt = Date.now();
    lastAutoContinueAction = "confirm";
    try {
      button.click();
      lastAutoConfirmOutcome = "clicked";
    } catch (_error) {
      lastAutoConfirmOutcome = "failed";
    }
    chrome.storage.local.set({
      lastAutoContinue: { timestamp: lastAutoConfirmAt, action: "confirm", outcome: lastAutoConfirmOutcome }
    }).catch(() => {});
    // If the site ignores the click, keep the warning and notify after a short grace.
    return lastAutoConfirmOutcome === "clicked";
  }

  function collectPlaybackSignal() {
    const media = document.querySelector("audio#SOUND") ||
      document.querySelector("audio, video");
    playbackStatus = playbackMonitor.sample({
      available: Boolean(media),
      currentTime: media?.currentTime || 0,
      paused: media?.paused ?? true,
      ended: media?.ended ?? false,
      seeking: media?.seeking ?? false
    });
    return settings.playbackAlertEnabled && playbackStatus.stopped
      ? PLAYBACK_STOPPED_SIGNAL : null;
  }

  async function deliverSignal(signal) {
    let delivery = alertDeliveries.get(signal.kind);
    if (!delivery) {
      delivery = { desktop: false, remote: false, inFlight: false, attempts: 0, retryAt: 0 };
      alertDeliveries.set(signal.kind, delivery);
    }
    const desktop = settings.alertsEnabled && !delivery.desktop;
    const remote = settings.ntfyEnabled && !delivery.remote;
    if ((!desktop && !remote) || delivery.inFlight || Date.now() < delivery.retryAt) return;

    delivery.inFlight = true;
    delivery.retryAt = Date.now() + Math.min(60000, ALERT_RETRY_MS * 2 ** Math.min(delivery.attempts++, 3));
    const type = desktop && remote ? "MUSIC_WAVE_ALERT" : desktop
      ? "MUSIC_WAVE_ALERT_RETRY_DESKTOP" : "MUSIC_WAVE_ALERT_RETRY_REMOTE";
    try {
      const response = await sendRuntimeMessage({ type, signal });
      delivery.desktop ||= Boolean(response?.notified || response?.desktop?.delivered);
      delivery.remote ||= Boolean(response?.remote?.delivered);
    } finally {
      delivery.inFlight = false;
    }
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
  }

  function scanPage() {
    scanTimer = null;
    const detectedSignals = collectSignals();
    const confirming = tryAutoConfirmContinue(detectedSignals);
    const signals = confirming
      ? detectedSignals.filter((signal) => signal.kind !== "continue") : detectedSignals;
    const playbackSignal = collectPlaybackSignal();
    const recovering = ["clicked", "reload-pending", "reloaded"].includes(lastAutoConfirmOutcome) &&
      Date.now() - lastAutoConfirmAt < AUTO_CONFIRM_GRACE_MS;
    // Let a successful confirmation resume playback before reporting a generic stop.
    if (playbackSignal && !detectedSignals.length && !recovering) signals.push(playbackSignal);
    const nextKinds = new Set(signals.map((signal) => signal.kind));
    latestSignals = signals;

    for (const kind of alertDeliveries.keys()) {
      if (!nextKinds.has(kind)) {
        alertDeliveries.delete(kind);
      }
    }

    for (const signal of signals) {
      if (!activeKinds.has(signal.kind)) {
        announce(signal);
      }
      deliverSignal(signal).catch(() => {});
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
    return sendRuntimeMessage({ type: "MUSIC_WAVE_TAB_PRESENT" });
  }

  function reportTabLeaving() {
    sendRuntimeMessage({ type: "MUSIC_WAVE_TAB_LEAVING" });
  }

  async function initialize() {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.sync.get(DEFAULT_SETTINGS))
    };
    await reportTabPresent();
    window.addEventListener("pagehide", reportTabLeaving, { capture: true });
    window.setInterval(reportTabPresent, TAB_HEARTBEAT_MS);

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
      if (changes.autoConfirmContinueEnabled || changes.autoReloadContinueEnabled) autoConfirmAttempted = false;
      if (changes.alertsEnabled || changes.ntfyEnabled) {
        for (const delivery of alertDeliveries.values()) delivery.retryAt = 0;
      }
      scheduleScan();
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "MUSIC_WAVE_AUTO_RELOAD_FAILED") {
        lastAutoConfirmOutcome = "failed";
        scheduleScan();
        sendResponse({ received: true });
        return undefined;
      }
      if (message?.type === "MUSIC_WAVE_SCAN_NOW") scanPage();
      if (!["MUSIC_WAVE_GET_STATUS", "MUSIC_WAVE_SCAN_NOW"].includes(message?.type)) {
        return undefined;
      }

      sendResponse({
        watching: true,
        playback: playbackStatus,
        autoConfirmPending: ["clicked", "reload-pending", "reloaded"].includes(lastAutoConfirmOutcome) &&
          Date.now() - lastAutoConfirmAt < AUTO_CONFIRM_GRACE_MS,
        autoContinueAction: lastAutoContinueAction,
        activeSignals: latestSignals.map((signal) => signal.kind)
      });
      return undefined;
    });

    scanPage();
    for (const event of ["play", "playing", "pause", "ended", "waiting", "stalled", "error"]) {
      document.addEventListener(event, scheduleScan, true);
    }
    document.addEventListener("timeupdate", () => {
      if (collectPlaybackSignal()) scheduleScan();
    }, true);
    window.setInterval(scheduleScan, FALLBACK_SCAN_MS);
  }

  initialize().catch(() => {});
})();
