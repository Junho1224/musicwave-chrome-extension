"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluatePresence,
  evaluateTrackedRemoval,
  evaluatePageLeave
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

test("confirms a direct page-leave signal after the last tab disappears", () => {
  assert.deepEqual(
    evaluatePageLeave({
      leavingTabId: 41,
      currentTabIds: [],
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { leavingTabStillOpen: false, currentTabIds: [], shouldNotify: true }
  );
});

test("treats page reload as still open", () => {
  assert.deepEqual(
    evaluatePageLeave({
      leavingTabId: 41,
      currentTabIds: [41],
      notificationsEnabled: true,
      hasBrowserWindow: true
    }),
    { leavingTabStillOpen: true, currentTabIds: [41], shouldNotify: false }
  );
});
