"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function loadBackground({ failDesktop = false, failRemote = false, failBadge = false,
  savedSettings = {}, state = {} } = {}) {
  const root = join(__dirname, "..");
  const local = state;
  let installedListener;
  const counters = { desktop: 0, remote: 0 };
  const settings = { alertsEnabled: true, ntfyEnabled: true,
    ntfyTopic: `music-wave-${"a1".repeat(24)}`, ...savedSettings };
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener(listener) { installedListener = listener; } },
        onStartup: event(), onMessage: event() },
      storage: {
        sync: { async get(defaults) { return { ...defaults, ...settings }; },
          async set(values) { Object.assign(settings, values); } },
        local: { async get(defaults) { return { ...defaults, ...local }; },
          async set(values) { Object.assign(local, values); } }
      },
      permissions: { async contains() { return true; } },
      notifications: {
        async create() {
          counters.desktop++;
          if (failDesktop) throw new Error("notification-api-failed");
        },
        onClicked: event(), onButtonClicked: event()
      },
      action: {
        async setBadgeBackgroundColor() { if (failBadge) throw new Error("tab-closed"); },
        async setBadgeText() {}
      },
      tabs: { async query() { return []; }, onCreated: event(), onRemoved: event(),
        onUpdated: event(), onActivated: event() },
      windows: { async getAll() { return [{ id: 1, type: "normal" }]; },
        onCreated: event(), onRemoved: event() },
      alarms: { async get() { return {}; }, onAlarm: event() },
      scripting: { async executeScript() {} }
    },
    async fetch() {
      counters.remote++;
      return { ok: !failRemote, status: failRemote ? 503 : 200 };
    }
  });
  context.importScripts = (...files) => files.forEach((file) =>
    vm.runInContext(readFileSync(join(root, file), "utf8"), context));
  vm.runInContext(readFileSync(join(root, "background.js"), "utf8"), context);
  return { context, local, counters, settings, async installed() { await installedListener(); } };
}

test("a desktop API failure does not block phone delivery or hide detection", async () => {
  const { context, local, counters } = loadBackground({ failDesktop: true });
  const result = await vm.runInContext('createAlert("continue", 41)', context);
  assert.equal(result.notified, false);
  assert.equal(result.desktop.reason, "notification-api-failed");
  assert.equal(result.remote.delivered, true);
  assert.equal(local.lastAlert.kind, "continue");
  assert.equal(local.lastDesktopDelivery.delivered, false);
  assert.deepEqual(counters, { desktop: 1, remote: 1 });
});

test("failed channels can retry immediately without repeating delivered channels", async () => {
  const { context, counters } = loadBackground({ failDesktop: true });
  await vm.runInContext('createAlert("mechanical", 41)', context);
  await vm.runInContext('createAlert("mechanical", 41)', context);
  assert.deepEqual(counters, { desktop: 2, remote: 1 });
});

test("phone failure does not block PC delivery and can retry independently", async () => {
  const { context, counters } = loadBackground({ failRemote: true });
  const result = await vm.runInContext('createAlert("playbackStopped", 41)', context);
  assert.equal(result.notified, true);
  assert.equal(result.remote.reason, "http-503");
  await vm.runInContext('createAlert("playbackStopped", 41)', context);
  assert.deepEqual(counters, { desktop: 1, remote: 2 });
});

test("a disappearing tab badge does not invalidate a delivered notification", async () => {
  const { context } = loadBackground({ failBadge: true });
  const result = await vm.runInContext('createAlert("continue", 41)', context);
  assert.equal(result.notified, true);
  assert.equal(result.remote.delivered, true);
});

test("overlapping alerts share in-flight deliveries", async () => {
  const { context, counters } = loadBackground();
  await vm.runInContext('Promise.all([createAlert("continue", 41), createAlert("continue", 41)])', context);
  assert.deepEqual(counters, { desktop: 1, remote: 1 });
});

test("a fresh installation enables automatic confirmation by default", async () => {
  const background = loadBackground();
  await background.installed();
  assert.equal(background.settings.autoConfirmContinueEnabled, true);
  assert.equal(background.settings.autoReloadContinueEnabled, false);
  assert.equal(background.local.musicWaveAutoContinueDefaultsVersion, 1);
});

test("upgrading the former disabled defaults enables confirmation once", async () => {
  const background = loadBackground({ savedSettings: {
    autoConfirmContinueEnabled: false, autoReloadContinueEnabled: false
  } });
  await background.installed();
  assert.equal(background.settings.autoConfirmContinueEnabled, true);
  background.settings.autoConfirmContinueEnabled = false;
  await background.installed();
  assert.equal(background.settings.autoConfirmContinueEnabled, false);
});

test("an existing automatic reload choice is retained during upgrade", async () => {
  const background = loadBackground({ savedSettings: {
    autoConfirmContinueEnabled: false, autoReloadContinueEnabled: true
  } });
  await background.installed();
  assert.equal(background.settings.autoConfirmContinueEnabled, false);
  assert.equal(background.settings.autoReloadContinueEnabled, true);
});

test("a restarted worker preserves a later opt-out on subsequent extension reload", async () => {
  const state = {};
  const original = loadBackground({ state, savedSettings: {
    autoConfirmContinueEnabled: false, autoReloadContinueEnabled: false
  } });
  await original.installed();
  const restarted = loadBackground({ state, savedSettings: {
    autoConfirmContinueEnabled: false, autoReloadContinueEnabled: false
  } });
  await restarted.installed();
  assert.equal(restarted.settings.autoConfirmContinueEnabled, false);
  assert.equal(restarted.settings.autoReloadContinueEnabled, false);
});
