"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");

test("prioritizes the verified MUSIC WAVE modal selector", () => {
  const content = readFileSync(join(root, "content.js"), "utf8");
  assert.match(content, /#alertButton\.melon-modal\.d_modal_confirm/);
  assert.match(content, /knownAlert\.innerText/);
});

test("retries remote delivery without repeating the desktop alert", () => {
  const content = readFileSync(join(root, "content.js"), "utf8");
  const background = readFileSync(join(root, "background.js"), "utf8");
  assert.match(content, /MUSIC_WAVE_ALERT_RETRY_REMOTE/);
  assert.match(content, /REMOTE_RETRY_LIMIT = 3/);
  assert.match(background, /MUSIC_WAVE_ALERT_RETRY_REMOTE/);
  assert.match(background, /remoteOnly: true/);
});

test("monitors the last MUSIC WAVE tab and exposes a close-alert setting", () => {
  const background = readFileSync(join(root, "background.js"), "utf8");
  const content = readFileSync(join(root, "content.js"), "utf8");
  const manifest = readFileSync(join(root, "manifest.json"), "utf8");
  const popup = readFileSync(join(root, "popup.html"), "utf8");
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(background, /checkMusicWaveTabPresence/);
  assert.match(background, /primeMusicWaveTabPresence/);
  assert.match(background, /TRACKED_TAB_IDS_KEY/);
  assert.match(background, /createAlert\("tabClosed"/);
  assert.match(background, /handleMusicWaveTabRemoved/);
  assert.match(background, /handleMusicWavePageLeaving/);
  assert.match(content, /MUSIC_WAVE_TAB_PRESENT/);
  assert.match(content, /MUSIC_WAVE_TAB_LEAVING/);
  assert.match(content, /TAB_HEARTBEAT_MS/);
  assert.match(content, /sendRuntimeMessage/);
  assert.match(content, /__musicWaveAlertWatcherStarted/);
  assert.match(background, /chrome\.alarms\.onAlarm\.addListener/);
  assert.match(background, /TAB_WATCH_PERIOD_MINUTES = 0\.5/);
  assert.match(background, /injectWatcherIntoOpenTabs/);
  assert.match(background, /chrome\.scripting/);
  assert.match(background, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(background, /MUSIC_WAVE_TAB_MONITOR_STATUS/);
  assert.match(background, /recordTabMonitorError/);
  assert.match(manifest, /"alarms"/);
  assert.match(manifest, /"scripting"/);
  assert.match(popup, /tab-close-alert-enabled/);
  assert.match(popup, /tab-monitor-status/);
});
