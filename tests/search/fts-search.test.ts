import { test, expect } from "bun:test";
import { sanitizeFtsQuery, foldedPhrase } from "../../src/search/fts-search.ts";

// Tokens are joined with OR (not implicit AND): an enriched/longer query then recalls
// MORE, not fewer, entries; bm25 ranks higher-coverage hits up and the coverage gate
// (ftsSearch) drops single-incidental-token noise. The folding / last-token-prefix
// logic is unchanged — only the joiner is OR.
test("sanitizes FTS operators; last token (≥4) gets a prefix *", () => {
  // None of these should survive as operators; tokens are folded (lowercase + đ→d).
  // The user's own * is stripped (anti-injection); a controlled * is re-added only
  // when the folded last token is ≥4 chars.
  expect(sanitizeFtsQuery("deadline*")).toBe('"deadline"*'); // user * stripped, re-added (8)
  expect(sanitizeFtsQuery("a OR b")).toBe('"a" OR "or" OR "b"'); // last token "b" is 1 char → no *
  expect(sanitizeFtsQuery('"quote" ^caret')).toBe('"quote" OR "caret"*'); // "caret" (5)
});

test("prefix on last token enables search-as-you-type (≥4 chars)", () => {
  expect(sanitizeFtsQuery("deadl")).toBe('"deadl"*'); // 5 chars → matches "deadline"
  expect(sanitizeFtsQuery("gia dinh")).toBe('"gia" OR "dinh"*'); // "dinh" (4) → "đình"
});

test("a short last token (<4 chars) matches exactly, no prefix * (avoid floods)", () => {
  expect(sanitizeFtsQuery("phở")).toBe('"pho"'); // "pho" (3) → exact, not pho*→phòng
  expect(sanitizeFtsQuery("phở Quảng An")).toBe('"pho" OR "quang" OR "an"'); // "an" (2) no *
  expect(sanitizeFtsQuery("gia o")).toBe('"gia" OR "o"'); // "o" too short for *
});

test("handles dirty punctuation without producing operators", () => {
  expect(sanitizeFtsQuery("hello, (world)!")).toBe('"hello" OR "world"*'); // "world" (5)
  expect(sanitizeFtsQuery("foo: bar; baz")).toBe('"foo" OR "bar" OR "baz"'); // "baz" (3) no *
});

test("Vietnamese query is folded (diacritics + đ→d); ≥4-char last token prefixed", () => {
  expect(sanitizeFtsQuery("Mình đã ăn gì hôm qua?")).toBe(
    '"minh" OR "da" OR "an" OR "gi" OR "hom" OR "qua"', // "qua" (3) → exact, no *
  );
  // The whole point: đ-words fold so a no-accent query matches. "dinh" (4) → prefix.
  expect(sanitizeFtsQuery("gia đình")).toBe('"gia" OR "dinh"*');
  expect(sanitizeFtsQuery("gia dinh")).toBe('"gia" OR "dinh"*'); // same as accented
});

test("empty / pure-symbol query yields empty match", () => {
  expect(sanitizeFtsQuery("")).toBe("");
  expect(sanitizeFtsQuery("***")).toBe("");
  expect(sanitizeFtsQuery("   ")).toBe("");
});

test("foldedPhrase builds a contiguous folded phrase (>=2 tokens)", () => {
  expect(foldedPhrase("phở Quảng An")).toBe('"pho quang an"');
  expect(foldedPhrase("gia đình")).toBe('"gia dinh"');
  // NFC vs NFD produce the same phrase (no mid-syllable split).
  expect(foldedPhrase("gia đình".normalize("NFD"))).toBe('"gia dinh"');
});

test("foldedPhrase is empty for <2 tokens (nothing to boost)", () => {
  expect(foldedPhrase("phở")).toBe("");
  expect(foldedPhrase("")).toBe("");
  expect(foldedPhrase("!!!")).toBe("");
});
