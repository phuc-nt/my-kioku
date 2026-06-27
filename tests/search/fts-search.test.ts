import { test, expect } from "bun:test";
import { sanitizeFtsQuery } from "../../src/search/fts-search.ts";

test("sanitizes FTS operator characters into quoted tokens (folded)", () => {
  // None of these should survive as operators; tokens are folded (lowercase + đ→d).
  expect(sanitizeFtsQuery('phở*')).toBe('"pho"');
  expect(sanitizeFtsQuery('a OR b')).toBe('"a" "or" "b"'); // OR becomes a literal token
  expect(sanitizeFtsQuery('"quote" ^caret')).toBe('"quote" "caret"');
});

test("handles dirty punctuation without producing operators", () => {
  expect(sanitizeFtsQuery('hello, (world)!')).toBe('"hello" "world"');
  expect(sanitizeFtsQuery('foo: bar; baz')).toBe('"foo" "bar" "baz"');
});

test("Vietnamese query is folded (diacritics + đ→d) to match the folded index", () => {
  expect(sanitizeFtsQuery("Mình đã ăn gì hôm qua?")).toBe(
    '"minh" "da" "an" "gi" "hom" "qua"',
  );
  // The whole point: đ-words fold so a no-accent query matches.
  expect(sanitizeFtsQuery("gia đình")).toBe('"gia" "dinh"');
  expect(sanitizeFtsQuery("gia dinh")).toBe('"gia" "dinh"'); // same as accented
});

test("empty / pure-symbol query yields empty match", () => {
  expect(sanitizeFtsQuery("")).toBe("");
  expect(sanitizeFtsQuery("***")).toBe("");
  expect(sanitizeFtsQuery("   ")).toBe("");
});
