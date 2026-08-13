"use strict";

importScripts("notification-providers.js", "tab-monitor-core.js");

const DEFAULT_SETTINGS = Object.freeze({
  alertsEnabled: true,
  soundEnabled: true,
  titleFlashEnabled: true,
  tabCloseAlertEnabled: true,
  ntfyEnabled: false,
  ntfyTopic: ""
});
const MUSIC_WAVE_HOME = "https://musicwave.melon.com/";
const MUSIC_WAVE_MATCH = "https://musicwave.melon.com/*";
const TAB_PRESENCE_KEY = "musicWaveTabWasOpen";
const TRACKED_TAB_IDS_KEY = "musicWaveTrackedTabIds";
const TAB_CHECK_DELAY_MS = 1200;
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
  test: Object.freeze({
    kind: "test",
    severity: "warning",
    title: "테스트 알림",
    message: "Music Wave Alert가 정상적으로 동작하고 있습니다."
  })
});
const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlJ4AAAAASUVORK5CYII=";
const recentAlerts = new Map();
let tabPresenceTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
  await checkMusicWaveTabPresence({ notify: false });
});

chrome.runtime.onStartup.addListener(() => {
  checkMusicWaveTabPresence({ notify: false }).catch(() => {});
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
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: signal.severity === "critical" ? "#B42318" : "#F79009"
    });
    await chrome.action.setBadgeText({ tabId, text: "!" });
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
  if (!options.ignoreCooldown && now - (recentAlerts.get(id) || 0) < 10000) {
    return { notified: false, reason: "cooldown" };
  }
  recentAlerts.set(id, now);

  let desktop = { delivered: false };
  let remote = { delivered: false, reason: "disabled" };

  if (desktopEnabled) {
    await createDesktopAlert(signal, tabId);
    desktop = { delivered: true };
  }

  if (remoteEnabled) {
    try {
      remote = await sendNtfyAlert(signal, settings.ntfyTopic);
    } catch (_error) {
      remote = { delivered: false, reason: "network-error" };
    }
  }

  await chrome.storage.local.set({
    lastAlert: {
      kind: signal.kind,
      title: signal.title,
      severity: signal.severity,
      timestamp: now
    },
    lastRemoteDelivery: {
      delivered: remote.delivered,
      reason: remote.reason || null,
      timestamp: now
    }
  });

  return { notified: desktop.delivered, remote };
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
    await createAlert("tabClosed", null, { ignoreCooldown: true });
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
    hasBrowserWindow: windows.length > 0
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
    await createAlert("tabClosed", null, { ignoreCooldown: true });
  }
}

function scheduleTabPresenceCheck() {
  if (tabPresenceTimer !== null) clearTimeout(tabPresenceTimer);
  tabPresenceTimer = setTimeout(() => {
    tabPresenceTimer = null;
    checkMusicWaveTabPresence().catch(() => {});
  }, TAB_CHECK_DELAY_MS);
}

chrome.tabs.onCreated.addListener(scheduleTabPresenceCheck);
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleMusicWaveTabRemoved(tabId, removeInfo).catch(() => {});
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    scheduleTabPresenceCheck();
  }
});
chrome.windows.onCreated.addListener(scheduleTabPresenceCheck);
chrome.windows.onRemoved.addListener(scheduleTabPresenceCheck);

primeMusicWaveTabPresence().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MUSIC_WAVE_TAB_PRESENT") {
    registerMusicWaveTab(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ registered: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_TAB_LEAVING") {
    scheduleTabPresenceCheck();
    sendResponse({ scheduled: true });
    return undefined;
  }

  if (message?.type === "MUSIC_WAVE_ALERT") {
    createAlert(message.signal?.kind, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ notified: false, reason: error.message }));
    return true;
  }

  if (message?.type === "MUSIC_WAVE_ALERT_RETRY_REMOTE") {
    createAlert(message.signal?.kind, sender.tab?.id, {
      remoteOnly: true,
      ignoreCooldown: true
    })
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ remote: { delivered: false, reason: error.message } })
      );
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
