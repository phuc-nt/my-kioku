import { test, expect } from "bun:test";
import { sanitizeFtsQuery } from "../../src/search/fts-search.ts";

test("sanitizes FTS operator characters into quoted tokens", () => {
  // None of these should survive as operators.
  expect(sanitizeFtsQuery('phở*')).toBe('"phở"');
  expect(sanitizeFtsQuery('a OR b')).toBe('"a" "OR" "b"'); // OR becomes a literal token
  expect(sanitizeFtsQuery('"quote" ^caret')).toBe('"quote" "caret"');
});

test("handles dirty punctuation without producing operators", () => {
  expect(sanitizeFtsQuery('hello, (world)!')).toBe('"hello" "world"');
  expect(sanitizeFtsQuery('foo: bar; baz')).toBe('"foo" "bar" "baz"');
});

test("Vietnamese question stays intact as tokens", () => {
  expect(sanitizeFtsQuery("Mình đã ăn gì hôm qua?")).toBe(
    '"Mình" "đã" "ăn" "gì" "hôm" "qua"',
  );
});

test("empty / pure-symbol query yields empty match", () => {
  expect(sanitizeFtsQuery("")).toBe("");
  expect(sanitizeFtsQuery("***")).toBe("");
  expect(sanitizeFtsQuery("   ")).toBe("");
});
