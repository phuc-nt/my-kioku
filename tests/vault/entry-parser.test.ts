import { test, expect } from "bun:test";
import {
  parseEntries,
  parseMoodValue,
} from "../../src/vault/entry-parser.ts";

test("parseMoodValue with intensity", () => {
  expect(parseMoodValue("happy/4")).toEqual({ mood: "happy", intensity: 4 });
});

test("parseMoodValue without intensity", () => {
  expect(parseMoodValue("tired")).toEqual({ mood: "tired" });
});

test("parseMoodValue rejects non-field shapes (returns null)", () => {
  expect(parseMoodValue("so/so")).toBeNull(); // non-numeric intensity
  expect(parseMoodValue("this is my actual diary text")).toBeNull(); // has spaces
  expect(parseMoodValue("happy/9")).toBeNull(); // intensity out of 1..5
  expect(parseMoodValue("happy/0")).toBeNull();
  expect(parseMoodValue("happy/")).toBeNull(); // trailing slash, no number
});

test("parse single entry with mood", () => {
  const body = "# 2026-06-12\n\n## 21:30\nmood:: happy/4\nĂn tối với [[Hùng]].";
  const entries = parseEntries(body);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    time: "21:30",
    ordinal: 0,
    mood: "happy",
    intensity: 4,
    text: "Ăn tối với [[Hùng]].",
  });
});

test("parse entry without mood", () => {
  const body = "## 09:00\nĐi chạy bộ buổi sáng";
  const entries = parseEntries(body);
  expect(entries[0]!.mood).toBeUndefined();
  expect(entries[0]!.text).toBe("Đi chạy bộ buổi sáng");
});

test("multiple entries keep document order; same time disambiguated by ordinal", () => {
  const body =
    "## 21:30\nfirst\n\n## 21:30\nsecond\n\n## 22:00\nthird";
  const entries = parseEntries(body);
  expect(entries.map((e) => e.ordinal)).toEqual([0, 1, 2]);
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third"]);
});

test("multi-line text with level-3 heading preserved verbatim", () => {
  const body = "## 10:00\nmood:: calm\nLine 1\n### sub\nLine 2";
  const entries = parseEntries(body);
  expect(entries[0]!.text).toBe("Line 1\n### sub\nLine 2");
  expect(entries[0]!.mood).toBe("calm");
});

test("text before first heading is ignored (title line)", () => {
  const body = "# 2026-06-12\nstray text\n\n## 08:00\nreal entry";
  const entries = parseEntries(body);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe("real entry");
});

// --- C1 fix: entry prose containing a heading-shaped line is NOT split ---
test("prose containing a ## HH:MM line (not blank-preceded) stays in one entry", () => {
  // appendEntry emits `\n## 21:30\n<text>`; the inner "## 10:00" line directly
  // follows prose (no preceding blank line) → must remain part of the entry text.
  const body = "\n## 21:30\nTalked about my schedule:\n## 10:00 standup time\nthen lunch";
  const entries = parseEntries(body);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe(
    "Talked about my schedule:\n## 10:00 standup time\nthen lunch",
  );
});

// --- C2 fix: entry prose starting with "mood::" but not a strict field ---
test("prose starting with mood:: free text is kept verbatim, not consumed", () => {
  const body = "\n## 09:00\nmood:: today I want to talk about my mood swings";
  const entries = parseEntries(body);
  expect(entries[0]!.mood).toBeUndefined();
  expect(entries[0]!.text).toBe(
    "mood:: today I want to talk about my mood swings",
  );
});
