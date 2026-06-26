import { test, expect } from "bun:test";
import {
  extractWikilinks,
  normalizeTarget,
} from "../../src/vault/wikilink-parser.ts";

test("extract simple links", () => {
  expect(extractWikilinks("Ăn tối với [[Hùng]] ở [[Quảng An]]")).toEqual([
    "Hùng",
    "Quảng An",
  ]);
});

test("alias form takes target before pipe", () => {
  expect(extractWikilinks("gặp [[Hùng|bạn ấy]] hôm nay")).toEqual(["Hùng"]);
});

test("dedupe repeated links", () => {
  expect(extractWikilinks("[[Mẹ]] rồi [[Mẹ]] nữa")).toEqual(["Mẹ"]);
});

test("ignore links inside fenced code", () => {
  const text = "real [[Hùng]]\n```\nexample [[NotReal]]\n```";
  expect(extractWikilinks(text)).toEqual(["Hùng"]);
});

test("ignore links inside inline code", () => {
  expect(extractWikilinks("use `[[NotReal]]` but [[Real]]")).toEqual(["Real"]);
});

test("normalizeTarget trims and strips display", () => {
  expect(normalizeTarget("  Hùng | bạn  ")).toBe("Hùng");
  expect(normalizeTarget("Mẹ")).toBe("Mẹ");
});

test("no links returns empty", () => {
  expect(extractWikilinks("plain text no links")).toEqual([]);
});
