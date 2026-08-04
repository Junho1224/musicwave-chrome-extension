"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../notification-providers.js");

test("accepts only generated music-wave ntfy topics", () => {
  const topic = `music-wave-${"a1".repeat(24)}`;
  assert.equal(providers.ntfy.isValidTopic(topic), true);
  assert.equal(providers.ntfy.isValidTopic("music-wave-public"), false);
  assert.equal(providers.ntfy.isValidTopic("other-a1".repeat(24)), false);
});

test("maps mechanical alerts to urgent generic ntfy payloads", () => {
  const payload = providers.ntfy.buildPayload({
    title: "기계적 스트리밍 감지",
    message: "MUSIC WAVE 경고를 확인하세요.",
    severity: "critical"
  });
  assert.equal(payload.priority, 5);
  assert.deepEqual(payload.tags, ["rotating_light"]);
  assert.doesNotMatch(JSON.stringify(payload), /채팅|사용자|계정/);
});
