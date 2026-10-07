"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

async function loadContent({ text = "", bodyText = text, settings = {}, respond,
  autoButton = true, buttonDisabled = false, clickThrows = false,
  hidesOnClick = true, captcha = false, runtimeValid = true,
  reloadResponse = { reloaded: true }, useDefaultAutoContinueSettings = false } = {}) {
  let now = 100000;
  let messageListener;
  let settingsListener;
  let toastCount = 0;
  let clicks = 0;
  const local = {};
  const messages = [];
  const reloadRequests = [];
  const media = { currentTime: 10, paused: false, ended: false, seeking: false };
  class Element {
    constructor() { this.style = {}; this.innerText = text; this.textContent = text; this.visible = true; }
    getBoundingClientRect() { return { width: this.visible ? 300 : 0, height: this.visible ? 200 : 0 }; }
    querySelector() { return null; }
    closest() { return null; }
    append() {}
    setAttribute() {}
    addEventListener() {}
    remove() {}
    attachShadow() { toastCount++; return new Element(); }
  }
  const modal = new Element();
  const button = new Element();
  button.textContent = "확인";
  button.disabled = buttonDisabled;
  button.getAttribute = () => null;
  button.click = () => {
    clicks++;
    if (clickThrows) throw new Error("click-failed");
    if (hidesOnClick) {
      modal.visible = false;
      media.paused = false;
      media.currentTime += 1;
    }
  };
  modal.querySelector = (selector) => selector === "button.btn-submit"
    ? (autoButton ? button : null) : selector.includes("captcha") && captcha ? new Element() : null;
  const currentSettings = { alertsEnabled: false, ntfyEnabled: true,
    soundEnabled: false, titleFlashEnabled: false,
    ...(!useDefaultAutoContinueSettings ? { autoConfirmContinueEnabled: false } : {}), ...settings };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    HTMLElement: Element,
    MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    document: {
      body: { innerText: bodyText }, documentElement: new Element(),
      querySelector(selector) { return selector.startsWith("#alertButton")
        ? (text ? modal : null) : selector.includes("audio") ? media : null; },
      querySelectorAll() { return []; },
      getElementById() { return null; }, createElement() { return new Element(); },
      addEventListener() {}
    },
    chrome: {
      runtime: {
        id: runtimeValid ? "test-extension" : undefined,
        async sendMessage(message) {
          if (message.type === "MUSIC_WAVE_AUTO_RELOAD_CONTINUE") {
            reloadRequests.push(message);
            return typeof reloadResponse === "function" ? reloadResponse() : reloadResponse;
          }
          if (message.signal) {
            messages.push(message);
            return respond ? respond(message, messages.length) : { remote: { delivered: true } };
          }
          return { registered: true };
        },
        onMessage: { addListener(listener) { messageListener = listener; } }
      },
      storage: {
        local: { async set(values) { Object.assign(local, values); } },
        sync: { async get(defaults) { return { ...defaults, ...currentSettings }; } },
        onChanged: { addListener(listener) { settingsListener = listener; } }
      }
    }
  });
  const window = { setTimeout() { return 1; }, clearTimeout() {},
    setInterval() { return 2; }, clearInterval() {}, addEventListener() {} };
  window.top = window;
  context.window = window;
  for (const file of ["detector-core.js", "playback-monitor-core.js", "content.js"]) {
    vm.runInContext(readFileSync(join(__dirname, "..", file), "utf8"), context);
  }
  const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  await flush();
  return {
    messages, reloadRequests, media, local,
    get clicks() { return clicks; },
    showModal(value = text) { modal.innerText = value; modal.textContent = value; modal.visible = true; },
    advance(ms) { now += ms; },
    async scan() {
      let status;
      messageListener({ type: "MUSIC_WAVE_SCAN_NOW" }, {}, (value) => { status = value; });
      await flush();
      return status;
    },
    async reloadFailed() {
      messageListener({ type: "MUSIC_WAVE_AUTO_RELOAD_FAILED" }, {}, () => {});
      await flush();
    },
    updateSettings(values) {
      Object.assign(currentSettings, values);
      settingsListener(Object.fromEntries(Object.entries(values).map(([key, newValue]) =>
        [key, { newValue }])), "sync");
    },
    get toastCount() { return toastCount; }
  };
}

test("detects the verified modal even when body text misses its warning", async () => {
  const { messages } = await loadContent({
    text: "지금 듣고계신 음악을 계속 들으시겠습니까?", bodyText: ""
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].signal.kind, "continue");
});

test("retries a failed desktop message without repeating the page alert", async () => {
  const content = await loadContent({
    text: "계속 들으시겠습니까?", settings: { alertsEnabled: true, ntfyEnabled: false },
    respond: (_message, attempt) => {
      if (attempt === 1) throw new Error("receiver-unavailable");
      return { notified: true, desktop: { delivered: true } };
    }
  });
  content.advance(16000);
  await content.scan();
  await content.scan();
  assert.equal(content.messages.length, 2);
  assert.equal(content.toastCount, 1);
});

test("retries only the phone after a successful PC delivery", async () => {
  const content = await loadContent({
    text: "기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다.",
    settings: { alertsEnabled: true },
    respond: (_message, attempt) => ({ notified: true, remote: { delivered: attempt > 1 } })
  });
  assert.equal(content.messages[0].type, "MUSIC_WAVE_ALERT");
  content.advance(16000);
  await content.scan();
  assert.equal(content.messages[1].type, "MUSIC_WAVE_ALERT_RETRY_REMOTE");
  assert.equal(content.toastCount, 1);
});

test("delivers an existing warning when notifications are enabled", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?",
    settings: { alertsEnabled: false, ntfyEnabled: false } });
  assert.equal(content.messages.length, 0);
  content.updateSettings({ ntfyEnabled: true });
  await content.scan();
  assert.equal(content.messages.length, 1);
});

test("a silent playback stop sends one alert and rearms after resume", async () => {
  const content = await loadContent();
  content.media.paused = true;
  content.advance(16000);
  const status = await content.scan();
  assert.equal(status.activeSignals[0], "playbackStopped");
  assert.equal(content.messages[0].signal.kind, "playbackStopped");
  await content.scan();
  assert.equal(content.messages.length, 1);
  content.media.paused = false;
  content.media.currentTime = 11;
  await content.scan();
  content.media.paused = true;
  content.advance(16000);
  await content.scan();
  assert.equal(content.messages.length, 2);
});

test("a visible confirmation sends its own alert instead of a duplicate stop alert", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?" });
  content.media.paused = true;
  content.advance(16000);
  await content.scan();
  assert.deepEqual(content.messages.map((message) => message.signal.kind), ["continue"]);
});

test("a saved disabled confirmation setting leaves the warning for notification", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?" });
  assert.equal(content.clicks, 0);
  assert.equal(content.messages[0].signal.kind, "continue");
});

test("fresh defaults automatically confirm a continue dialog", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?",
    useDefaultAutoContinueSettings: true });
  assert.equal(content.clicks, 1);
  assert.equal(content.reloadRequests.length, 0);
  assert.equal(content.messages.length, 0);
});

test("automatically confirms the user's spaced continue prompt", async () => {
  const content = await loadContent({ text: "지금 듣고 계신 음악을 계속 들으 시겠습니까?",
    useDefaultAutoContinueSettings: true });
  assert.equal(content.clicks, 1);
  assert.equal(content.messages.length, 0);
});

test("clicks a known confirmation once and rearms for a later popup", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?",
    settings: { autoConfirmContinueEnabled: true } });
  assert.equal(content.clicks, 1);
  assert.equal(content.messages.length, 0);
  await content.scan();
  assert.equal(content.clicks, 1);
  content.showModal();
  await content.scan();
  assert.equal(content.clicks, 2);
  assert.equal(content.local.lastAutoContinue.outcome, "clicked");
});

test("never clicks a mechanical warning or mixed authentication warning", async () => {
  for (const text of [
    "기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다.",
    "계속 들으시겠습니까? 기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다."
  ]) {
    const content = await loadContent({ text, settings: { autoConfirmContinueEnabled: true } });
    assert.equal(content.clicks, 0);
    assert.ok(content.messages.some((message) => message.signal.kind === "mechanical"));
  }
});

test("a CAPTCHA in the known modal blocks automatic confirmation", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?", captcha: true,
    settings: { autoConfirmContinueEnabled: true } });
  assert.equal(content.clicks, 0);
  assert.equal(content.messages[0].signal.kind, "continue");
});

test("missing and disabled confirmation buttons fall back to notification", async () => {
  for (const options of [{ autoButton: false }, { buttonDisabled: true }]) {
    const content = await loadContent({ text: "계속 들으시겠습니까?", ...options,
      settings: { autoConfirmContinueEnabled: true } });
    assert.equal(content.clicks, 0);
    assert.equal(content.messages[0].signal.kind, "continue");
  }
});

test("an ignored click alerts after the grace period without repeated clicks", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?", hidesOnClick: false,
    settings: { autoConfirmContinueEnabled: true } });
  assert.equal(content.clicks, 1);
  assert.equal(content.messages.length, 0);
  content.advance(6000);
  await content.scan();
  await content.scan();
  assert.equal(content.clicks, 1);
  assert.equal(content.messages[0].signal.kind, "continue");
});

test("a click error immediately alerts and does not keep clicking", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?", clickThrows: true,
    settings: { autoConfirmContinueEnabled: true } });
  await content.scan();
  assert.equal(content.clicks, 1);
  assert.equal(content.local.lastAutoContinue.outcome, "failed");
  assert.equal(content.messages[0].signal.kind, "continue");
});

test("an invalidated extension context cannot automatically confirm", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?", runtimeValid: false,
    settings: { autoConfirmContinueEnabled: true } });
  assert.equal(content.clicks, 0);
});

test("automatic reload stays off by default", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?" });
  assert.equal(content.reloadRequests.length, 0);
});

test("requests reload once without clicking and reports the pending action", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?", autoButton: false,
    settings: { autoReloadContinueEnabled: true, autoConfirmContinueEnabled: true } });
  const status = await content.scan();
  assert.equal(content.reloadRequests.length, 1);
  assert.equal(content.clicks, 0);
  assert.equal(content.messages.length, 0);
  assert.equal(status.autoConfirmPending, true);
  assert.equal(status.autoContinueAction, "reload");
  content.advance(6000);
  await content.scan();
  await content.scan();
  assert.equal(content.reloadRequests.length, 1);
  assert.equal(content.messages[0].signal.kind, "continue");
});

test("refused or failed reload falls back to a warning without repeated attempts", async () => {
  for (const reloadResponse of [{ reloaded: false, reason: "cooldown" },
    () => { throw new Error("receiver-unavailable"); }]) {
    const content = await loadContent({ text: "계속 들으시겠습니까?", reloadResponse,
      settings: { autoReloadContinueEnabled: true } });
    await content.scan();
    await content.scan();
    assert.equal(content.reloadRequests.length, 1);
    assert.equal(content.messages[0].signal.kind, "continue");
  }
});

test("reload API failure after acknowledgement cancels the grace period", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?",
    settings: { autoReloadContinueEnabled: true } });
  await content.reloadFailed();
  await content.scan();
  assert.equal(content.messages[0].signal.kind, "continue");
  assert.equal(content.reloadRequests.length, 1);
});

test("never requests reload for authentication, CAPTCHA, or invalidated context", async () => {
  for (const options of [
    { text: "기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다." },
    { text: "계속 들으시겠습니까? 기계적인 스트리밍 패턴이 감지되어 인증을 진행합니다." },
    { text: "계속 들으시겠습니까?", captcha: true },
    { text: "계속 들으시겠습니까?", runtimeValid: false }
  ]) {
    const content = await loadContent({ ...options, settings: { autoReloadContinueEnabled: true } });
    assert.equal(content.reloadRequests.length, 0);
    assert.equal(content.clicks, 0);
  }
});

test("reload rearms only after the old warning disappears", async () => {
  const content = await loadContent({ text: "계속 들으시겠습니까?",
    settings: { autoReloadContinueEnabled: true } });
  content.showModal("정상 재생 중");
  await content.scan();
  content.showModal("계속 들으시겠습니까?");
  await content.scan();
  assert.equal(content.reloadRequests.length, 2);
});
