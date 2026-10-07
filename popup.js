"use strict";

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
const NTFY_PERMISSION = "https://ntfy.sh/*";
const CONNECTION_HUB_URL = "https://music-wave-alert-connect.ho1.chatgpt.site/";

const controls = {
  alertsEnabled: document.getElementById("alerts-enabled"),
  soundEnabled: document.getElementById("sound-enabled"),
  titleFlashEnabled: document.getElementById("title-flash-enabled"),
  tabCloseAlertEnabled: document.getElementById("tab-close-alert-enabled"),
  playbackAlertEnabled: document.getElementById("playback-alert-enabled"),
  autoConfirmContinueEnabled: document.getElementById("auto-confirm-continue-enabled"),
  autoReloadContinueEnabled: document.getElementById("auto-reload-continue-enabled")
};
const ntfyToggle = document.getElementById("ntfy-enabled");
const pageStatus = document.getElementById("page-status");
const tabMonitorStatus = document.getElementById("tab-monitor-status");
const mobileStatus = document.getElementById("mobile-status");
const mobileTopic = document.getElementById("mobile-topic");
const lastAlert = document.getElementById("last-alert");
const deliveryStatus = document.getElementById("delivery-status");
const autoContinueStatus = document.getElementById("auto-continue-status");
const testButton = document.getElementById("test-alert");
const connectButton = document.getElementById("connect-mobile");
const testMobileButton = document.getElementById("test-mobile");

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function generateTopic() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `music-wave-${hex}`;
}

async function ensureNtfyPermission() {
  const hasPermission = await chrome.permissions.contains({ origins: [NTFY_PERMISSION] });
  if (hasPermission) return true;
  return chrome.permissions.request({ origins: [NTFY_PERMISSION] });
}

function updateMobileUi(settings) {
  ntfyToggle.checked = Boolean(settings.ntfyEnabled);
  if (settings.ntfyTopic) {
    mobileStatus.textContent = settings.ntfyEnabled ? "휴대폰 알림 사용 중" : "채널 준비됨 · 알림 꺼짐";
    mobileTopic.textContent = `${settings.ntfyTopic.slice(0, 18)}…`;
    connectButton.textContent = "연결 화면 열기";
  } else {
    mobileStatus.textContent = "연결되지 않음";
    mobileTopic.textContent = "채널 없음";
    connectButton.textContent = "휴대폰 연결 만들기";
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (settings.autoReloadContinueEnabled && settings.autoConfirmContinueEnabled) {
    settings.autoConfirmContinueEnabled = false;
    await chrome.storage.sync.set({ autoConfirmContinueEnabled: false });
  }
  for (const [key, control] of Object.entries(controls)) {
    control.checked = Boolean(settings[key]);
    control.addEventListener("change", () => {
      const updates = { [key]: control.checked };
      const otherAction = key === "autoReloadContinueEnabled" ? "autoConfirmContinueEnabled"
        : key === "autoConfirmContinueEnabled" ? "autoReloadContinueEnabled" : null;
      if (control.checked && otherAction) {
        controls[otherAction].checked = false;
        updates[otherAction] = false;
      }
      return chrome.storage.sync.set(updates);
    });
  }
  updateMobileUi(settings);

  ntfyToggle.addEventListener("change", async () => {
    if (!ntfyToggle.checked) {
      await chrome.storage.sync.set({ ntfyEnabled: false });
      updateMobileUi({ ...settings, ntfyEnabled: false });
      return;
    }

    const allowed = await ensureNtfyPermission();
    if (!allowed) {
      ntfyToggle.checked = false;
      mobileStatus.textContent = "네트워크 권한이 필요합니다";
      return;
    }

    const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const ntfyTopic = current.ntfyTopic || generateTopic();
    await chrome.storage.sync.set({ ntfyEnabled: true, ntfyTopic });
    updateMobileUi({ ...current, ntfyEnabled: true, ntfyTopic });
  });
}

async function loadPageStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://musicwave.melon.com/")) {
    pageStatus.textContent = "MUSIC WAVE 탭에서 동작합니다.";
  } else {
    await chrome.runtime.sendMessage({
      type: "MUSIC_WAVE_REGISTER_TAB",
      tabId: tab.id
    });
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "MUSIC_WAVE_GET_STATUS" });
      if (response?.activeSignals?.includes("mechanical")) {
        pageStatus.textContent = "기계 감지 팝업을 감지했습니다.";
      } else if (response?.autoConfirmPending) {
        pageStatus.textContent = response.autoContinueAction === "reload"
          ? "계속 듣기 자동 새로고침 중…" : "계속 듣기 자동 확인 중…";
      } else if (response?.activeSignals?.includes("continue")) {
        pageStatus.textContent = "계속 듣기 팝업을 감지했습니다.";
      } else if (response?.activeSignals?.includes("playbackStopped")) {
        pageStatus.textContent = "재생 중단을 감지했습니다.";
      } else {
        pageStatus.textContent = response?.watching
          ? response.playback?.state === "playing"
            ? "현재 탭 감시 중 · 음악 재생 중"
            : "현재 탭 감시 중 · 재생 상태 확인 중"
          : "페이지를 새로고침해 주세요.";
      }
    } catch (_error) {
      pageStatus.textContent = "확장 설치 후 페이지를 새로고침해 주세요.";
    }
  }

  const monitor = await chrome.runtime.sendMessage({
    type: "MUSIC_WAVE_TAB_MONITOR_STATUS"
  });
  if (monitor?.error) {
    tabMonitorStatus.textContent = `탭 감시 오류 · ${monitor.error}`;
    return;
  }
  if (monitor?.lastMonitor?.error) {
    tabMonitorStatus.textContent = `탭 감시 오류 · ${monitor.lastMonitor.error}`;
    return;
  }
  const count = Math.max(monitor?.queriedTabCount || 0, monitor?.trackedTabCount || 0);
  const alarm = monitor?.alarmActive ? "주기 확인 사용 중" : "주기 확인 중지됨";
  tabMonitorStatus.textContent = count > 0
    ? `탭 감시 등록됨 · ${count}개 · ${alarm}`
    : `탭 감시 미등록 · ${alarm}`;
}

async function loadAutoContinueStatus() {
  const { lastAutoContinue } = await chrome.storage.local.get("lastAutoContinue");
  if (!lastAutoContinue) return;
  const action = lastAutoContinue.action === "reload" ? "자동 새로고침" : "자동 확인";
  const outcome = ["clicked", "reloaded", "reload-pending"].includes(lastAutoContinue.outcome) ? "시도" : "실패";
  autoContinueStatus.textContent = `마지막 ${action} ${outcome} · ${formatTimestamp(lastAutoContinue.timestamp)}`;
}

async function loadLastAlert() {
  const { lastAlert: record, lastDesktopDelivery: desktop, lastRemoteDelivery: remote } =
    await chrome.storage.local.get(["lastAlert", "lastDesktopDelivery", "lastRemoteDelivery"]);
  if (record) lastAlert.textContent = `${record.title} · ${formatTimestamp(record.timestamp)}`;
  const deliveries = [];
  for (const [name, delivery] of [["PC", desktop], ["휴대폰", remote]]) {
    if (!delivery || delivery.timestamp !== record?.timestamp) continue;
    deliveries.push(delivery.delivered ? `${name} 전송 완료` : `${name} 전송 실패 · ${delivery.reason}`);
  }
  deliveryStatus.hidden = deliveries.length === 0;
  deliveryStatus.textContent = deliveries.join(" / ");
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    const allowed = await ensureNtfyPermission();
    if (!allowed) {
      mobileStatus.textContent = "네트워크 권한이 필요합니다";
      return;
    }
    const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const ntfyTopic = current.ntfyTopic || generateTopic();
    await chrome.storage.sync.set({ ntfyEnabled: true, ntfyTopic });
    updateMobileUi({ ...current, ntfyEnabled: true, ntfyTopic });
    const url = new URL(CONNECTION_HUB_URL);
    url.searchParams.set("topic", ntfyTopic);
    await chrome.tabs.create({ url: url.toString() });
  } finally {
    connectButton.disabled = false;
  }
});

testMobileButton.addEventListener("click", async () => {
  testMobileButton.disabled = true;
  mobileStatus.textContent = "휴대폰으로 보내는 중…";
  try {
    const allowed = await ensureNtfyPermission();
    if (!allowed) throw new Error("permission");
      const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      const ntfyTopic = current.ntfyTopic || generateTopic();
      await chrome.storage.sync.set({ ntfyEnabled: true, ntfyTopic });
      updateMobileUi({ ...current, ntfyEnabled: true, ntfyTopic });
      const response = await chrome.runtime.sendMessage({ type: "MUSIC_WAVE_NTFY_TEST" });
      mobileStatus.textContent = response?.remote?.delivered
        ? "휴대폰 테스트 전송 완료"
        : "연결 후 다시 테스트해 주세요";
  } catch (_error) {
    mobileStatus.textContent = "휴대폰 테스트에 실패했습니다";
  } finally {
    testMobileButton.disabled = false;
  }
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  testButton.textContent = "알림 전송 중…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "MUSIC_WAVE_TEST" });
    testButton.textContent = response?.notified ? "알림을 보냈습니다"
      : response?.desktop?.reason ? `PC 알림 실패 · ${response.desktop.reason}`
      : "PC 알림이 꺼져 있습니다";
  } catch (_error) {
    testButton.textContent = "알림 전송에 실패했습니다";
  } finally {
    window.setTimeout(() => {
      testButton.disabled = false;
      testButton.textContent = "PC 테스트 알림 보내기";
    }, 1600);
  }
});

Promise.all([loadSettings(), loadPageStatus(), loadLastAlert(), loadAutoContinueStatus()]).catch(() => {
  pageStatus.textContent = "상태를 불러오지 못했습니다.";
});
