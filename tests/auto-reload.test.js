"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const HOME = "https://musicwave.melon.com/musicwave.htm";
const sender = { tab: { id: 41, url: HOME }, frameId: 0, url: HOME };

function loadBackground({ session = {}, settings = {}, url = HOME,
  inspection = true, reloadError = false } = {}) {
  const root = join(__dirname, "..");
  const local = {};
  const responses = [];
  const calls = [];
  let now = 100000;
  let listener;
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    chrome: {
      runtime: { onInstalled: event(), onStartup: event(),
        onMessage: { addListener(value) { listener = value; } } },
      storage: {
        sync: { async get(defaults) {
          return { ...defaults, autoReloadContinueEnabled: true, ntfyEnabled: false, ...settings };
        } },
        session: { async get(defaults) { return { ...defaults, ...session }; },
          async set(values) { Object.assign(session, values); } },
        local: { async get(defaults) { return { ...defaults, ...local }; },
          async set(values) { Object.assign(local, values); } }
      },
      notifications: { async create() { calls.push("notify"); },
        onClicked: event(), onButtonClicked: event() },
      action: { async setBadgeBackgroundColor() {}, async setBadgeText() {} },
      tabs: { async query() { return []; }, async get(id) { return { id, url }; },
        async reload(id) {
          assert.equal(id, 41);
          assert.equal(responses.at(-1)?.reloaded, true, "acknowledge before navigation");
          calls.push("reload");
          if (reloadError) throw new Error("reload-api-failed");
        },
        async sendMessage(id, message) { calls.push(message.type); },
        onCreated: event(), onRemoved: event(), onUpdated: event(), onActivated: event() },
      windows: { onCreated: event(), onRemoved: event() },
      alarms: { async get() { return {}; }, onAlarm: event() },
      scripting: { async executeScript(options) {
        assert.equal(options.target.tabId, 41);
        assert.equal(options.func.name, "canAutoReloadContinuePage");
        calls.push("inspect");
        return [{ result: inspection }];
      } }
    }
  });
  context.importScripts = (...files) => files.forEach((file) =>
    vm.runInContext(readFileSync(join(root, file), "utf8"), context));
  vm.runInContext(readFileSync(join(root, "background.js"), "utf8"), context);
  return { context, local, calls, session, responses,
    advance(ms) { now += ms; },
    async request(from = sender) {
      await context.autoReloadContinueTab(from, (response) => responses.push(response));
      return responses.at(-1);
    },
    dispatch(from = sender) {
      return listener({ type: "MUSIC_WAVE_AUTO_RELOAD_CONTINUE" }, from,
        (response) => responses.push(response));
    }
  };
}

test("reloads only the requesting tab and records the acknowledged action", async () => {
  const background = loadBackground();
  assert.equal((await background.request()).reloaded, true);
  assert.deepEqual(background.calls, ["inspect", "reload"]);
  assert.equal(background.local.lastAutoContinue.outcome, "reloaded");
  assert.equal(background.local.lastAutoContinue.action, "reload");
  assert.equal(background.session["musicWaveContinueReloadAt:41"], 100000);
});

test("rejects unrelated tabs, subframes, and missing sender IDs", async () => {
  const background = loadBackground();
  for (const from of [
    { ...sender, url: "https://musicwave.melon.com.evil.example/" },
    { ...sender, frameId: 1 },
    { url: HOME, frameId: 0 }
  ]) assert.equal((await background.request(from)).reason, "invalid-sender");
  assert.deepEqual(background.calls, []);
});

test("rechecks the saved option and current tab URL before navigation", async () => {
  for (const options of [{ settings: { autoReloadContinueEnabled: false } },
    { url: "https://www.melon.com/" }]) {
    const background = loadBackground(options);
    assert.equal((await background.request()).reason, "disabled-or-navigated");
    assert.deepEqual(background.calls, []);
  }
});

test("a changed or authentication dialog blocks reload during the page recheck", async () => {
  const background = loadBackground({ inspection: false });
  assert.equal((await background.request()).reason, "not-plain-continue-dialog");
  assert.deepEqual(background.calls, ["inspect"]);
  assert.equal(background.local.lastAutoContinue, undefined);
});

test("reload cooldown survives navigation and a restarted service worker", async () => {
  const session = {};
  const original = loadBackground({ session });
  await original.request();
  const restarted = loadBackground({ session });
  assert.equal((await restarted.request()).reason, "cooldown");
  assert.deepEqual(restarted.calls, []);
  restarted.advance(60000);
  assert.equal((await restarted.request()).reloaded, true);
  assert.deepEqual(restarted.calls, ["inspect", "reload"]);
});

test("overlapping reload requests cannot reload twice", async () => {
  const background = loadBackground();
  await Promise.all([background.request(), background.request()]);
  assert.equal(background.calls.filter((call) => call === "reload").length, 1);
  assert.ok(background.responses.some((response) => response.reason === "in-progress"));
});

test("a failed reload alerts immediately and keeps the cooldown", async () => {
  const background = loadBackground({ reloadError: true });
  await background.request();
  assert.deepEqual(background.calls, ["inspect", "reload", "MUSIC_WAVE_AUTO_RELOAD_FAILED", "notify"]);
  assert.equal(background.local.lastAutoContinue.outcome, "failed");
  assert.equal(background.local.lastAutoContinue.reason, "reload-api-failed");
  assert.equal((await background.request()).reason, "cooldown");
});

test("runtime message handler keeps the asynchronous response channel open", async () => {
  const background = loadBackground();
  assert.equal(background.dispatch(), true);
  for (let index = 0; index < 20; index++) await Promise.resolve();
  assert.equal(background.responses[0].reloaded, true);
  assert.ok(background.calls.includes("reload"));
});

test("in-page guard permits only a visible ordinary continue dialog", () => {
  const { context } = loadBackground();
  const detector = require("../detector-core.js");
  const makeElement = (text, visible = true, captcha = false) => ({
    innerText: text, textContent: text,
    getBoundingClientRect() { return { width: visible ? 300 : 0, height: visible ? 200 : 0 }; },
    querySelector() { return captcha ? {} : null; }
  });
  const continuation = "계속 들으시겠습니까?";
  const mechanical = "기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다.";
  context.MusicWaveDetector = detector;
  context.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  for (const [modal, others, allowed] of [
    [makeElement(continuation), [], true],
    [null, [], false],
    [makeElement(continuation, false), [], false],
    [makeElement(continuation, true, true), [], false],
    [makeElement(mechanical), [], false],
    [makeElement(`${continuation} ${mechanical}`), [], false],
    [makeElement(continuation), [makeElement(mechanical)], false],
    [makeElement(continuation), [makeElement(mechanical, false)], true]
  ]) {
    context.document = { querySelector() { return modal; }, querySelectorAll() { return others; } };
    assert.equal(context.canAutoReloadContinuePage(), allowed);
  }
  delete context.MusicWaveDetector;
  assert.equal(context.canAutoReloadContinuePage(), false);
});
