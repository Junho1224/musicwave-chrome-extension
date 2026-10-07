"use strict";

importScripts("notification-providers.js", "tab-monitor-core.js");

const DEFAULT_SETTINGS = Object.freeze({
  alertsEnabled: true,
  soundEnabled: true,
  titleFlashEnabled: true,
  tabCloseAlertEnabled: true,
  playbackAlertEnabled: true,
  autoConfirmContinueEnabled: false,
  autoReloadContinueEnabled: false,
  ntfyEnabled: false,
  ntfyTopic: ""
});
const MUSIC_WAVE_HOME = "https://musicwave.melon.com/";
const MUSIC_WAVE_MATCH = "https://musicwave.melon.com/*";
const TAB_PRESENCE_KEY = "musicWaveTabWasOpen";
const TRACKED_TAB_IDS_KEY = "musicWaveTrackedTabIds";
const TAB_CHECK_DELAY_MS = 1200;
const TAB_WATCH_ALARM = "music-wave-tab-watch";
const TAB_WATCH_PERIOD_MINUTES = 0.5;
const ALERT_DEFINITIONS = Object.freeze({
  continue: Object.freeze({
    kind: "continue",
    severity: "warning",
    title: "계속 재생 확인 필요",
    message: "MUSIC WAVE에 계속 듣기 확인 창이 나타났습니다."
  }),
  mechanical: Object.freeze({
    kind: "mechanical",
    severity: "critical",
    title: "기계적 스트리밍 감지",
    message: "MUSIC WAVE에 스트리밍 감지 경고가 나타났습니다. 탭을 직접 확인하세요."
  }),
  tabClosed: Object.freeze({
    kind: "tabClosed",
    severity: "critical",
    title: "MUSIC WAVE 탭 종료",
    message: "MUSIC WAVE 탭이 닫혔습니다. 다시 열어 감시를 계속하세요."
  }),
  playbackStopped: Object.freeze({
    kind: "playbackStopped",
    severity: "critical",
    title: "MUSIC WAVE 재생 중단",
    message: "음악 재생이 15초 이상 멈췄습니다. MUSIC WAVE 탭을 확인하세요."
  }),
  test: Object.freeze({
    kind: "test",
    severity: "warning",
    title: "테스트 알림",
    message: "Music Wave Alert가 정상적으로 동작하고 있습니다."
  })
});
const NOTIFICATION_ICON = "icons/notification.png";
const recentAlerts = new Map();
const pendingDeliveries = new Map();
const pendingContinueReloads = new Set();
const AUTO_CONTINUE_RELOAD_COOLDOWN_MS = 60000;
let tabPresenceTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
  await checkMusicWaveTabPresence({ notify: false });
  await ensureTabWatchAlarm();
  await injectWatcherIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  checkMusicWaveTabPresence({ notify: false }).catch(() => {});
  ensureTabWatchAlarm().catch(() => {});
  injectWatcherIntoOpenTabs().catch(() => {});
});

// 열린 탭이 있을 때만 상태를 보강한다. 탭 종료 이벤트로 서비스 워커가
// 깨어난 경우 직전의 열림 상태를 지우면 종료 전환을 감지할 수 없다.

function notificationId(kind, tabId) {
  return `music-wave:${kind}:${Number.isInteger(tabId) ? tabId : "unknown"}`;
}

function tabIdFromNotificationId(id) {
  const value = Number.parseInt(id.split(":").at(-1), 10);
  return Number.isInteger(value) ? value : null;
}

function kindFromNotificationId(id) {
  return id.split(":")[1] || null;
}

async function focusAlertTab(id) {
  const tabId = tabIdFromNotificationId(id);
  if (tabId === null) return;

  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch (_error) {
    // 이미 닫힌 탭이면 별도 동작이 필요 없다.
  }
}

async function openMusicWaveTab() {
  const [existing] = await chrome.tabs.query({ url: MUSIC_WAVE_MATCH });
  if (existing?.id) {
    const tab = await chrome.tabs.update(existing.id, { active: true });
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: MUSIC_WAVE_HOME });
}

async function reloadContinueTab(id) {
  const tabId = tabIdFromNotificationId(id);
  if (tabId === null || kindFromNotificationId(id) !== "continue") return;

  try {
    await chrome.tabs.reload(tabId);
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.notifications.clear(id);
  } catch (_error) {
    // 이미 닫힌 탭이면 별도 동작이 필요 없다.
  }
}

// Runs in the extension's isolated world inside the target page.
function canAutoReloadContinuePage() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") !== 0 && rect.width > 0 && rect.height > 0;
  };
  const detector = globalThis.MusicWaveDetector;
  const modal = document.querySelector("#alertButton.melon-modal.d_modal_confirm");
  if (!detector || !visible(modal)) return false;
  const signals = detector.detectSignals(modal.innerText || modal.textContent || "");
  if (signals.length !== 1 || signals[0].kind !== "continue") return false;
  if (modal.querySelector('iframe, input, .g-recaptcha, .h-captcha, [class*="captcha"], [id*="captcha"]')) {
    return false;
  }
  return ![...document.querySelectorAll('.melon-modal, [role="dialog"], [role="alertdialog"], [role="alert"]')]
    .some((element) => visible(element) && detector.detectSignals(element.innerText || element.textContent || "")
      .some((signal) => signal.kind === "mechanical"));
}

async function autoReloadContinueTab(sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || sender.frameId !== 0 ||
      !(sender.url || sender.tab?.url || "").startsWith(MUSIC_WAVE_HOME)) {
    sendResponse({ reloaded: false, reason: "invalid-sender" });
    return;
  }
  if (pendingContinueReloads.has(tabId)) {
    sendResponse({ reloaded: false, reason: "in-progress" });
    return;
  }
  pendingContinueReloads.add(tabId);
  const cooldownKey = `musicWaveContinueReloadAt:${tabId}`;
  let responded = false;
  try {
    const [settings, tab, state] = await Promise.all([
      chrome.storage.sync.get(DEFAULT_SETTINGS),
      chrome.tabs.get(tabId),
      chrome.storage.session.get({ [cooldownKey]: 0 })
    ]);
    if (!settings.autoReloadContinueEnabled || !tab.url?.startsWith(MUSIC_WAVE_HOME)) {
      sendResponse({ reloaded: false, reason: "disabled-or-navigated" });
      return;
    }
    if (state[cooldownKey] > 0 && Date.now() - state[cooldownKey] < AUTO_CONTINUE_RELOAD_COOLDOWN_MS) {
      sendResponse({ reloaded: false, reason: "cooldown" });
      return;
    }
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId }, func: canAutoReloadContinuePage
    });
    if (inspection?.result !== true) {
      sendResponse({ reloaded: false, reason: "not-plain-continue-dialog" });
      return;
    }
    const timestamp = Date.now();
    await chrome.storage.session.set({ [cooldownKey]: timestamp });
    await chrome.storage.local.set({
      lastAutoContinue: { timestamp, action: "reload", outcome: "reload-pending" }
    });
    // Reply before navigating so the content script does not lose its acknowledgement.
    sendResponse({ reloaded: true });
    responded = true;
    await chrome.tabs.reload(tabId);
    await chrome.storage.local.set({
      lastAutoContinue: { timestamp, action: "reload", outcome: "reloaded" }
    });
  } catch (error) {
    await chrome.storage.local.set({
      lastAutoContinue: { timestamp: Date.now(), action: "reload", outcome: "failed",
        reason: String(error?.message || "reload-failed") }
    }).catch(() => {});
    if (!responded) sendResponse({ reloaded: false, reason: "reload-failed" });
    if (responded) {
      await chrome.tabs.sendMessage(tabId, { type: "MUSIC_WAVE_AUTO_RELOAD_FAILED" }).catch(() => {});
      await createAlert("continue", tabId).catch(() => {});
    }
  } finally {
    pendingContinueReloads.delete(tabId);
  }
}

async function sendNtfyAlert(signal, topic) {
  const provider = MusicWaveNotificationProviders.ntfy;
  if (!provider.isValidTopic(topic)) {
    return { delivered: false, reason: "invalid-topic" };
  }

  const hasPermission = await chrome.permissions.contains({
    origins: [provider.permissionOrigin]
  });
  if (!hasPermission) {
    return { delivered: false, reason: "permission-required" };
  }

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      ...provider.buildPayload(signal)
    })
  });

  if (!response.ok) {
    return { delivered: false, reason: `http-${response.status}` };
  }
  return { delivered: true };
}

async function createDesktopAlert(signal, tabId) {
  const id = notificationId(signal.kind, tabId);
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: `[MUSIC WAVE] ${signal.title}`,
    message: signal.message,
    priority: signal.severity === "critical" ? 2 : 1,
    requireInteraction: signal.severity === "critical" || signal.kind === "continue",
    buttons:
      signal.kind === "continue"
        ? [{ title: "탭 열기" }, { title: "이 탭 새로고침" }]
        : signal.kind === "tabClosed"
          ? [{ title: "MUSIC WAVE 열기" }]
          : [{ title: "탭 열기" }]
  });

  if (Number.isInteger(tabId)) {
    try {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: signal.severity === "critical" ? "#B42318" : "#F79009"
      });
      await chrome.action.setBadgeText({ tabId, text: "!" });
    } catch (_error) {
      // The alert was delivered even if its tab disappeared before the badge update.
    }
  }
}

async function deliverAlertChannel(key, deliver, { ignoreCooldown = false } = {}) {
  if (pendingDeliveries.has(key)) return pendingDeliveries.get(key);
  const previous = recentAlerts.get(key);
  if (!ignoreCooldown && previous !== undefined && Date.now() - previous < 10000) {
    return { delivered: true, reason: "already-delivered" };
  }
  const pending = (async () => {
    try {
      const result = await deliver();
      if (result.delivered) recentAlerts.set(key, Date.now());
      return result;
    } catch (error) {
      return { delivered: false, reason: String(error?.message || "delivery-failed") };
    }
  })();
  pendingDeliveries.set(key, pending);
  try {
    return await pending;
  } finally {
    pendingDeliveries.delete(key);
  }
}

async function createAlert(kind, tabId, options = {}) {
  const signal = ALERT_DEFINITIONS[kind];
  if (!signal) return { notified: false, reason: "unknown-alert" };

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const desktopEnabled = options.remoteOnly ? false : settings.alertsEnabled;
  const remoteEnabled = options.desktopOnly ? false : settings.ntfyEnabled;
  if (!desktopEnabled && !remoteEnabled) {
    return { notified: false, reason: "disabled" };
  }

  const id = notificationId(signal.kind, tabId);
  const now = Date.now();
  await chrome.storage.local.set({
    lastAlert: {
      kind: signal.kind,
      title: signal.title,
      severity: signal.severity,
      timestamp: now
    }
  });

  // Both channels attempt delivery independently. A PC API error must not stop ntfy.
  const [desktop, remote] = await Promise.all([
    desktopEnabled
      ? deliverAlertChannel(`${id}:desktop`, async () => {
          await createDesktopAlert(signal, tabId);
          return { delivered: true };
        }, options)
      : { delivered: false, reason: "disabled" },
    remoteEnabled
      ? deliverAlertChannel(`${id}:remote`, async () => {
          try {
            return await sendNtfyAlert(signal, settings.ntfyTopic);
          } catch (_error) {
            return { delivered: false, reason: "network-error" };
          }
        }, options)
      : { delivered: false, reason: "disabled" }
  ]);
  const deliveryRecords = {};
  if (desktopEnabled) deliveryRecords.lastDesktopDelivery = { ...desktop, timestamp: now };
  if (remoteEnabled) deliveryRecords.lastRemoteDelivery = {
    delivered: remote.delivered,
    reason: remote.reason || null,
    timestamp: now
  };
  await chrome.storage.local.set(deliveryRecords);

  return { notified: desktop.delivered, desktop, remote };
}

async function checkMusicWaveTabPresence({ notify = true } = {}) {
  const [tabs, presenceState, settings, windows] = await Promise.all([
    chrome.tabs.query({ url: MUSIC_WAVE_MATCH }),
    chrome.storage.local.get({
      [TAB_PRESENCE_KEY]: false,
      [TRACKED_TAB_IDS_KEY]: []
    }),
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.windows.getAll({ windowTypes: ["normal"] })
  ]);
  const currentTabIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  const trackedTabIds = Array.isArray(presenceState[TRACKED_TAB_IDS_KEY])
    ? presenceState[TRACKED_TAB_IDS_KEY]
    : [];
  const result = MusicWaveTabMonitor.evaluatePresence({
    wasOpen: Boolean(presenceState[TAB_PRESENCE_KEY]) || trackedTabIds.length > 0,
    currentCount: currentTabIds.length,
    notificationsEnabled: notify && settings.tabCloseAlertEnabled,
    hasBrowserWindow: windows.length > 0
  });

  await chrome.storage.local.set({
    [TAB_PRESENCE_KEY]: result.wasOpen,
    [TRACKED_TAB_IDS_KEY]: currentTabIds,
    lastTabMonitor: {
      event: "reconcile",
      trackedCount: currentTabIds.length,
      timestamp: Date.now()
    }
  });
  if (result.shouldNotify) {
    await createAlert("tabClosed", null);
  }
  return result;
}

async function registerMusicWaveTab(tabId) {
  if (!Number.isInteger(tabId)) return { registered: false };
  const state = await chrome.storage.local.get({ [TRACKED_TAB_IDS_KEY]: [] });
  const trackedTabIds = Array.isArray(state[TRACKED_TAB_IDS_KEY])
    ? state[TRACKED_TAB_IDS_KEY].filter(Number.isInteger)
    : [];
  const nextTabIds = [...new Set([...trackedTabIds, tabId])];
  await chrome.storage.local.set({
    [TAB_PRESENCE_KEY]: true,
    [TRACKED_TAB_IDS_KEY]: nextTabIds,
    lastTabMonitor: {
      event: "page-present",
      trackedCount: nextTabIds.length,
      timestamp: Date.now()
    }
  });
  return { registered: true };
}

async function registerMusicWaveTabIfMatching(tabId, knownUrl) {
  if (!Number.isInteger(tabId)) return { registered: false };
  const url = knownUrl || (await chrome.tabs.get(tabId)).url || "";
  if (!url.startsWith(MUSIC_WAVE_HOME)) return { registered: false };
  return registerMusicWaveTab(tabId);
}

async function primeMusicWaveTabPresence() {
  const tabs = await chrome.tabs.query({ url: MUSIC_WAVE_MATCH });
  const tabIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  if (tabIds.length > 0) {
    await chrome.storage.local.set({
      [TAB_PRESENCE_KEY]: true,
      [TRACKED_TAB_IDS_KEY]: tabIds
    });
  }
}

async function handleMusicWaveTabRemoved(tabId, removeInfo) {
  const [presenceState, tabs, settings] = await Promise.all([
    chrome.storage.local.get({ [TRACKED_TAB_IDS_KEY]: [] }),
    chrome.tabs.query({ url: MUSIC_WAVE_MATCH }),
    chrome.storage.sync.get(DEFAULT_SETTINGS)
  ]);
  const trackedTabIds = Array.isArray(presenceState[TRACKED_TAB_IDS_KEY])
    ? presenceState[TRACKED_TAB_IDS_KEY]
    : [];
  if (!trackedTabIds.includes(tabId)) {
    scheduleTabPresenceCheck();
    return;
  }

  const remainingTabIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  if (removeInfo?.isWindowClosing) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const result = MusicWaveTabMonitor.evaluateTrackedRemoval({
    trackedTabIds,
    removedTabId: tabId,
    remainingTabIds,
    notificationsEnabled: settings.tabCloseAlertEnabled,
    hasBrowserWindow: removeInfo?.isWindowClosing ? windows.length > 0 : true
  });

  await chrome.storage.local.set({
    [TAB_PRESENCE_KEY]: result.trackedTabIds.length > 0,
    [TRACKED_TAB_IDS_KEY]: result.trackedTabIds,
    lastTabMonitor: {
      event: "tab-removed",
      trackedCount: result.trackedTabIds.length,
      timestamp: Date.now()
    }
  });
  if (result.shouldNotify) {
    await createAlert("tabClosed", null);
  }
}

async function handleMusicWavePageLeaving(tabId) {
  if (!Number.isInteger(tabId)) return { notified: false, reason: "missing-tab" };
  await registerMusicWaveTab(tabId);
  await new Promise((resolve) => setTimeout(resolve, TAB_CHECK_DELAY_MS));

  const [tabs, settings, windows] = await Promise.all([
    chrome.tabs.query({ url: MUSIC_WAVE_MATCH }),
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.windows.getAll({ windowTypes: ["normal"] })
  ]);
  const currentTabIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  const result = MusicWaveTabMonitor.evaluatePageLeave({
    leavingTabId: tabId,
    currentTabIds,
    notificationsEnabled: settings.tabCloseAlertEnabled,
    hasBrowserWindow: windows.length > 0
  });

  await chrome.storage.local.set({
    [TAB_PRESENCE_KEY]: currentTabIds.length > 0,
    [TRACKED_TAB_IDS_KEY]: currentTabIds,
    lastTabMonitor: {
      event: "page-leaving",
      trackedCount: currentTabIds.length,
      timestamp: Date.now()
    }
  });
  if (result.shouldNotify) {
    return createAlert("tabClosed", null);
  }
  return { notified: false, reason: "tab-still-open" };
}

async function ensureTabWatchAlarm() {
  const existing = await chrome.alarms.get(TAB_WATCH_ALARM);
  if (!existing) {
    await chrome.alarms.create(TAB_WATCH_ALARM, {
      periodInMinutes: TAB_WATCH_PERIOD_MINUTES
    });
  }
}

async function injectWatcherIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: MUSIC_WAVE_MATCH });
  await Promise.all(
    tabs
      .map((tab) => tab.id)
      .filter(Number.isInteger)
      .map((tabId) =>
        chrome.scripting
          .executeScript({
            target: { tabId },
            files: ["detector-core.js", "playback-monitor-core.js", "content.js"]
          })
          .catch(() => undefined)
      )
  );
}

function scheduleTabPresenceCheck() {
  if (tabPresenceTimer !== null) clearTimeout(tabPresenceTimer);
  tabPresenceTimer = setTimeout(() => {
    tabPresenceTimer = null;
    checkMusicWaveTabPresence().catch(() => {});
  }, TAB_CHECK_DELAY_MS);
}

async function scanOpenMusicWaveTabs() {
  const tabs = await chrome.tabs.query({ url: MUSIC_WAVE_MATCH });
  await Promise.all(tabs.filter((tab) => Number.isInteger(tab.id)).map(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "MUSIC_WAVE_SCAN_NOW" });
    } catch (_error) {
      // Recover pages whose content script missed installation or a worker restart.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["detector-core.js", "playback-monitor-core.js", "content.js"]
        });
      } catch (error) {
        await recordTabMonitorError("watcher-injection-error", error);
      }
    }
  }));
}

async function recordTabMonitorError(event, error) {
  await chrome.storage.local.set({
    lastTabMonitor: {
      event,
      error: String(error?.message || error || "unknown-error"),
      timestamp: Date.now()
    }
  });
}

chrome.tabs.onCreated.addListener(scheduleTabPresenceCheck);
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleMusicWaveTabRemoved(tabId, removeInfo).catch((error) =>
    recordTabMonitorError("tab-removed-error", error).catch(() => {})
  );
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || "";
  if (url.startsWith(MUSIC_WAVE_HOME)) {
    registerMusicWaveTab(tabId).catch((error) =>
      recordTabMonitorError("tab-updated-error", error).catch(() => {})
    );
  }
  if (changeInfo.url || changeInfo.status === "complete") {
    scheduleTabPresenceCheck();
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  registerMusicWaveTabIfMatching(tabId).catch((error) =>
    recordTabMonitorError("tab-activated-error", error).catch(() => {})
  );
});
chrome.windows.onCreated.addListener(scheduleTabPresenceCheck);
chrome.windows.onRemoved.addListener(scheduleTabPresenceCheck);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TAB_WATCH_ALARM) {
    checkMusicWaveTabPresence().then(scanOpenMusicWaveTabs).catch((error) =>
      recordTabMonitorError("alarm-error", error).catch(() => {})
    );
  }
});

primeMusicWaveTabPresence().catch(() => {});
ensureTabWatchAlarm().catch(() => {});
injectWatcherIntoOpenTabs().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MUSIC_WAVE_AUTO_RELOAD_CONTINUE") {
    autoReloadContinueTab(sender, sendResponse).catch(() =>
      sendResponse({ reloaded: false, reason: "reload-failed" })
    );
    return true;
  }
  if (message?.type === "MUSIC_WAVE_REGISTER_TAB") {
    registerMusicWaveTabIfMatching(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ registered: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_TAB_MONITOR_STATUS") {
    Promise.all([
      chrome.tabs.query({ url: MUSIC_WAVE_MATCH }),
      chrome.storage.local.get({
        [TAB_PRESENCE_KEY]: false,
        [TRACKED_TAB_IDS_KEY]: [],
        lastTabMonitor: null
      }),
      chrome.storage.sync.get(DEFAULT_SETTINGS),
      chrome.alarms.get(TAB_WATCH_ALARM)
    ])
      .then(([tabs, state, settings, alarm]) =>
        sendResponse({
          queriedTabCount: tabs.length,
          trackedTabCount: Array.isArray(state[TRACKED_TAB_IDS_KEY])
            ? state[TRACKED_TAB_IDS_KEY].length
            : 0,
          wasOpen: Boolean(state[TAB_PRESENCE_KEY]),
          enabled: Boolean(settings.tabCloseAlertEnabled),
          alarmActive: Boolean(alarm),
          lastMonitor: state.lastTabMonitor
        })
      )
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_TAB_PRESENT") {
    registerMusicWaveTab(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ registered: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_TAB_LEAVING") {
    handleMusicWavePageLeaving(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ notified: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_ALERT") {
    createAlert(message.signal?.kind, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ notified: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_ALERT_RETRY_REMOTE") {
    createAlert(message.signal?.kind, sender.tab?.id, {
      remoteOnly: true
    })
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ remote: { delivered: false, reason: error.message } })
      );
    return true;
  }

  if (message?.type === "MUSIC_WAVE_ALERT_RETRY_DESKTOP") {
    createAlert(message.signal?.kind, sender.tab?.id, { desktopOnly: true })
      .then(sendResponse)
      .catch((error) => sendResponse({ notified: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_TEST") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => createAlert("test", tab?.id, { desktopOnly: true, ignoreCooldown: true }))
      .then(sendResponse)
      .catch((error) => sendResponse({ notified: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_NTFY_TEST") {
    createAlert("test", null, { remoteOnly: true, ignoreCooldown: true })
      .then(sendResponse)
      .catch((error) => sendResponse({ remote: { delivered: false, reason: error.message } }));
    return true;
  }

  return undefined;
});

chrome.notifications.onClicked.addListener((id) => {
  if (kindFromNotificationId(id) === "tabClosed") {
    openMusicWaveTab().catch(() => {});
    return;
  }
  focusAlertTab(id);
});

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (kindFromNotificationId(id) === "continue" && buttonIndex === 1) {
    reloadContinueTab(id);
    return;
  }
  if (kindFromNotificationId(id) === "tabClosed") {
    openMusicWaveTab().catch(() => {});
    return;
  }
  focusAlertTab(id);
});
