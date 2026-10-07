(function initMusicWaveDetector(root) {
  "use strict";

  const RULES = Object.freeze([
    Object.freeze({
      kind: "continue",
      severity: "warning",
      title: "계속 재생 확인 필요",
      message: "MUSIC WAVE에 계속 듣기 확인 창이 나타났습니다.",
      patterns: Object.freeze([
        /계속\s*(?:음악을\s*)?들으\s*시겠\s*습니까/i,
        /계속\s*(?:음악을\s*)?재생하시겠습니까/i,
        /계속\s*(?:음악을\s*)?청취하시겠습니까/i,
        /재생을\s*계속하시겠습니까/i
      ])
    }),
    Object.freeze({
      kind: "mechanical",
      severity: "critical",
      title: "기계적 스트리밍 감지",
      message: "MUSIC WAVE에 스트리밍 감지 경고가 나타났습니다. 탭을 직접 확인하세요.",
      patterns: Object.freeze([
        /기계적(?:인)?\s*(?:음원\s*)?스트리밍(?:\s*패턴)?(?:이)?\s*(?:감지|확인)(?:되었|됐|되어)?(?:습니다)?/i,
        /기계적\s*(?:음원\s*)?스트리밍\s*(?:감지|확인)/i,
        /비정상\s*(?:음원\s*)?스트리밍(?:이|이\s*)?\s*(?:감지|확인)/i
      ])
    })
  ]);

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectSignals(value) {
    const text = normalizeText(value);
    if (!text) {
      return [];
    }

    return RULES
      .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
      .map(({ patterns: _patterns, ...signal }) => ({ ...signal }));
  }

  const api = Object.freeze({ RULES, normalizeText, detectSignals });
  root.MusicWaveDetector = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
