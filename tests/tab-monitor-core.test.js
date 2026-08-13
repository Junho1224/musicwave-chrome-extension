"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePresence } = require("../tab-monitor-core.js");

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
