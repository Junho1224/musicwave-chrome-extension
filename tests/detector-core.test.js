"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectSignals, normalizeText } = require("../detector-core.js");

test("normalizes whitespace and invisible characters", () => {
  assert.equal(normalizeText("  계속\u200B   들으시겠습니까?  "), "계속 들으시겠습니까?");
});

test("detects continue-listening prompts", () => {
  assert.deepEqual(
    detectSignals("지금 듣고계신 음악을 계속 들으시겠습니까?").map(
      (signal) => signal.kind
    ),
    ["continue"]
  );
  assert.deepEqual(
    detectSignals("음악을 계속 들으시겠습니까? 확인").map((signal) => signal.kind),
    ["continue"]
  );
  assert.deepEqual(
    detectSignals("재생을 계속하시겠습니까").map((signal) => signal.kind),
    ["continue"]
  );
});

test("detects mechanical streaming warnings", () => {
  assert.deepEqual(
    detectSignals("기계적인 스트리밍 패턴이 감지되어\n인증을 진행합니다.").map(
      (signal) => signal.kind
    ),
    ["mechanical"]
  );
  assert.deepEqual(
    detectSignals("기계적 스트리밍이 감지되었습니다.").map((signal) => signal.kind),
    ["mechanical"]
  );
  assert.deepEqual(
    detectSignals("비정상 음원 스트리밍 감지").map((signal) => signal.kind),
    ["mechanical"]
  );
});

test("does not flag ordinary music wave text", () => {
  assert.deepEqual(detectSignals("하얀 그리움 프로미스나인 437명 참여중"), []);
});
