"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitor } = require("../playback-monitor-core.js");

test("ignores a player that has never started", () => {
  const monitor = createMonitor();
  monitor.sample({ now: 0 });
  assert.equal(monitor.sample({ now: 60000 }).stopped, false);
});

test("detects a pause only after the grace period", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 10, paused: false, now: 0 });
  assert.equal(monitor.sample({ currentTime: 10, now: 14999 }).stopped, false);
  assert.equal(monitor.sample({ currentTime: 10, now: 15000 }).stopped, true);
});

test("detects frozen playback even when paused is false", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 10, paused: false, now: 0 });
  assert.equal(monitor.sample({ currentTime: 10, paused: false, now: 15000 }).stopped, true);
});

test("a seek that never finishes cannot suppress a stop indefinitely", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 10, paused: false, now: 0 });
  monitor.sample({ currentTime: 20, paused: false, seeking: true, now: 1000 });
  assert.equal(monitor.sample({ currentTime: 20, paused: false, seeking: true, now: 15000 }).stopped, true);
});

test("recovers after resume and tolerates a normal song transition", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 149, paused: false, now: 0 });
  monitor.sample({ currentTime: 149, ended: true, now: 4000 });
  assert.equal(monitor.sample({ currentTime: 0.5, paused: false, now: 8000 }).stopped, false);
  assert.equal(monitor.sample({ currentTime: 0.5, paused: true, now: 24000 }).stopped, true);
  assert.equal(monitor.sample({ currentTime: 1, paused: false, now: 25000 }).state, "playing");
});

test("detects a player already paused when the extension starts", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 60, paused: true, now: 0 });
  assert.equal(monitor.sample({ currentTime: 60, paused: true, now: 15000 }).stopped, true);
});

test("detects disappearance of a player that was playing", () => {
  const monitor = createMonitor();
  monitor.sample({ currentTime: 10, paused: false, now: 0 });
  assert.equal(monitor.sample({ available: false, now: 15000 }).stopped, true);
});
