"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluatePresence,
  evaluateTrackedRemoval
} = require("../tab-monitor-core.js");

test("notifies when the last MUSIC WAVE tab closes", () => {
  assert.deepEqual(
    evaluatePresence({
      wasOpen: true,
      currentCount: 0,
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { wasOpen: false, shouldNotify: true }
  );
});

test("does not notify while another MUSIC WAVE tab remains", () => {
  assert.deepEqual(
    evaluatePresence({
      wasOpen: true,
      currentCount: 1,
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { wasOpen: true, shouldNotify: false }
  );
});

test("does not notify when Chrome itself is closing", () => {
  assert.deepEqual(
    evaluatePresence({
      wasOpen: true,
      currentCount: 0,
      notificationsEnabled: true,
      hasBrowserWindow: false
    }),
    { wasOpen: false, shouldNotify: false }
  );
});

test("continues tracking while close notifications are disabled", () => {
  assert.deepEqual(
    evaluatePresence({
      wasOpen: false,
      currentCount: 1,
      notificationsEnabled: false,
      hasBrowserWindow: true
    }),
    { wasOpen: true, shouldNotify: false }
  );
});

test("directly detects removal of the tracked last tab", () => {
  assert.deepEqual(
    evaluateTrackedRemoval({
      trackedTabIds: [41],
      removedTabId: 41,
      remainingTabIds: [],
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { wasTracked: true, trackedTabIds: [], shouldNotify: true }
  );
});

test("ignores removal of an unrelated tab", () => {
  assert.deepEqual(
    evaluateTrackedRemoval({
      trackedTabIds: [41],
      removedTabId: 99,
      remainingTabIds: [41],
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { wasTracked: false, trackedTabIds: [41], shouldNotify: false }
  );
});
