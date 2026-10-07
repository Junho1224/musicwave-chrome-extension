"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function loadBackground({ failDesktop = false, failRemote = false, failBadge = false } = {}) {
  const root = join(__dirname, "..");
  const local = {};
  const counters = { desktop: 0, remote: 0 };
  const settings = { alertsEnabled: true, ntfyEnabled: true,
    ntfyTopic: `music-wave-${"a1".repeat(24)}` };
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
      storage: {
        sync: { async get(defaults) { return { ...defaults, ...settings }; }, async set() {} },
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
      windows: { onCreated: event(), onRemoved: event() },
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
  return { context, local, counters };
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
