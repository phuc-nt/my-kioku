// Grammar table for inline #hashtag extraction (phase-02 / carry-over B).
import { test, expect } from "bun:test";
import { extractInlineHashtags } from "../../src/vault/inline-field-parser.ts";

test("accepts Unicode Vietnamese hashtags", () => {
  expect(extractInlineHashtags("đi #chạy_bộ với #Vy buổi sáng")).toEqual(["chạy_bộ", "Vy"]);
  expect(extractInlineHashtags("#thể_dục mỗi ngày")).toEqual(["thể_dục"]);
  expect(extractInlineHashtags("dự án #work_q3 xong")).toEqual(["work_q3"]);
});

test("rejects non-hashtag # uses (code / heading / URL / word-internal)", () => {
  expect(extractInlineHashtags("viết bằng C# và C++")).toEqual([]); // C# (preceded by letter)
  expect(extractInlineHashtags("## 10:00 standup nhóm")).toEqual([]); // markdown heading
  expect(extractInlineHashtags("xem example.com/#frag nhé")).toEqual([]); // URL fragment
  expect(extractInlineHashtags("a#b c#d")).toEqual([]); // word-internal #
  expect(extractInlineHashtags("issue ##5 trùng")).toEqual([]); // doubled #
});

test("rejects #digit-start (not a date/quantity confusion)", () => {
  expect(extractInlineHashtags("#123 không phải tag")).toEqual([]);
  expect(extractInlineHashtags("#4ever")).toEqual([]); // must start with a letter
});

test("dedupes + preserves order", () => {
  expect(extractInlineHashtags("#a rồi #b rồi #a lại")).toEqual(["a", "b"]);
});

test("hex color #fff is accepted as a (harmless) tag — locked decision", () => {
  expect(extractInlineHashtags("màu nền #fff sáng")).toEqual(["fff"]);
});

test("NFC: composed and decomposed forms yield one tag key", () => {
  const composed = extractInlineHashtags("#thể_dục");
  const decomposed = extractInlineHashtags("#thể_dục".normalize("NFD"));
  expect(decomposed).toEqual(composed);
});

test("never throws on empty / symbol-only text", () => {
  expect(extractInlineHashtags("")).toEqual([]);
  expect(extractInlineHashtags("###")).toEqual([]);
});
