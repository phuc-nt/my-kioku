import { test, expect } from "bun:test";
import { rewriteWikilinks } from "../../src/lib/link-rewriter.ts";

test("rewrites exact target", () => {
  const { text, count } = rewriteWikilinks("gặp [[B]] hôm nay", "B", "A");
  expect(text).toBe("gặp [[A]] hôm nay");
  expect(count).toBe(1);
});

test("preserves display alias", () => {
  const { text } = rewriteWikilinks("gặp [[B|bạn ấy]]", "B", "A");
  expect(text).toBe("gặp [[A|bạn ấy]]");
});

test("only rewrites exact match, not substrings", () => {
  const { text, count } = rewriteWikilinks("[[B]] and [[Bob]]", "B", "A");
  expect(text).toBe("[[A]] and [[Bob]]");
  expect(count).toBe(1);
});

test("does not touch links inside code fences", () => {
  const input = "real [[B]]\n```\nexample [[B]]\n```\nmore [[B]]";
  const { text, count } = rewriteWikilinks(input, "B", "A");
  expect(count).toBe(2); // both real ones, not the fenced one
  expect(text).toContain("```\nexample [[B]]\n```");
  expect(text).toContain("real [[A]]");
  expect(text).toContain("more [[A]]");
});

test("Vietnamese names with spaces and diacritics", () => {
  const { text, count } = rewriteWikilinks(
    "ở [[bạn Hùng]] và [[bạn Hùng|anh ấy]]",
    "bạn Hùng",
    "Hùng",
  );
  expect(text).toBe("ở [[Hùng]] và [[Hùng|anh ấy]]");
  expect(count).toBe(2);
});

test("no match leaves text unchanged", () => {
  const { text, count } = rewriteWikilinks("[[X]] [[Y]]", "Z", "A");
  expect(text).toBe("[[X]] [[Y]]");
  expect(count).toBe(0);
});
