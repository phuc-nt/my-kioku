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

test("parseMoodValue accepts a Vietnamese mood in decomposed (NFD) form", () => {
  // Without NFC the combining mark in "khỏe" (NFD) breaks the \p{L} capture → null.
  expect(parseMoodValue("khỏe".normalize("NFD"))).toEqual({
    mood: "khỏe".normalize("NFC"),
  });
  expect(parseMoodValue("khỏe/4".normalize("NFD"))).toEqual({
    mood: "khỏe".normalize("NFC"),
    intensity: 4,
  });
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

// --- v1.1: leading-field zone (mood + relations + tags) ---
test("parses mood + relations + tags then verbatim text", () => {
  const body =
    "\n## 21:30\nmood:: happy/4\njoy:: [[Chạy bộ]], [[Mẹ]]\ntrigger:: [[Frustration]]\ntags:: career, health\nChạy bộ buổi sáng.";
  const e = parseEntries(body)[0]!;
  expect(e.mood).toBe("happy");
  expect(e.intensity).toBe(4);
  expect(e.relations).toEqual({
    joy: ["Chạy bộ", "Mẹ"],
    trigger: ["Frustration"],
  });
  expect(e.tags).toEqual(["career", "health"]);
  expect(e.text).toBe("Chạy bộ buổi sáng.");
});

test("fields work in any order (relation before mood)", () => {
  const body = "\n## 08:00\njoy:: [[X]]\nmood:: calm/3\nĐi dạo.";
  const e = parseEntries(body)[0]!;
  expect(e.mood).toBe("calm");
  expect(e.relations).toEqual({ joy: ["X"] });
  expect(e.text).toBe("Đi dạo.");
});

test("a v1 entry (mood only) has no relations/tags keys", () => {
  const e = parseEntries("\n## 09:00\nmood:: tired/2\nMệt quá.")[0]!;
  expect(e.relations).toBeUndefined();
  expect(e.tags).toBeUndefined();
  expect(e.text).toBe("Mệt quá.");
});

test("a no-field entry parses identically to v1", () => {
  const e = parseEntries("\n## 09:00\nĐi làm bình thường.")[0]!;
  expect(e.mood).toBeUndefined();
  expect(e.relations).toBeUndefined();
  expect(e.tags).toBeUndefined();
  expect(e.text).toBe("Đi làm bình thường.");
});

// --- adversarial: prose must NOT be swallowed as a field ---
test("prose line 'with:: my friend Hùng' stays verbatim, not a relation", () => {
  const body = "\n## 09:00\nwith:: my friend Hùng came over";
  const e = parseEntries(body)[0]!;
  expect(e.relations).toBeUndefined();
  expect(e.text).toBe("with:: my friend Hùng came over");
});

test("a field-shaped line AFTER body text is not consumed (zone already ended)", () => {
  const body = "\n## 09:00\nmood:: happy/4\nĐi chơi vui.\njoy:: [[Sau]]";
  const e = parseEntries(body)[0]!;
  expect(e.mood).toBe("happy");
  // joy:: appears after the body began → stays verbatim in text.
  expect(e.relations).toBeUndefined();
  expect(e.text).toBe("Đi chơi vui.\njoy:: [[Sau]]");
});

test("a blank line between mood and a relation ends the zone (relation is body)", () => {
  const body = "\n## 09:00\nmood:: happy/4\n\njoy:: [[X]]";
  const e = parseEntries(body)[0]!;
  expect(e.mood).toBe("happy");
  expect(e.relations).toBeUndefined();
  expect(e.text).toBe("joy:: [[X]]");
});

test("tags:: [[x]] is NOT a tags line (stays verbatim)", () => {
  const body = "\n## 09:00\ntags:: [[x]]";
  const e = parseEntries(body)[0]!;
  expect(e.tags).toBeUndefined();
  expect(e.text).toBe("tags:: [[x]]");
});

test("tags are de-duped across lines, order preserved (consistent with relations)", () => {
  const body = "\n## 09:00\ntags:: a, a, b\ntags:: b, c\nText.";
  const e = parseEntries(body)[0]!;
  expect(e.tags).toEqual(["a", "b", "c"]);
});

test("CRLF body does not leak \\r into entry text", () => {
  const body = "\r\n## 09:00\r\nmood:: happy/4\r\njoy:: [[X]]\r\nDòng 1\r\nDòng 2\r\n";
  const e = parseEntries(body)[0]!;
  expect(e.mood).toBe("happy");
  expect(e.relations).toEqual({ joy: ["X"] });
  expect(e.text).toBe("Dòng 1\nDòng 2");
  expect(e.text).not.toContain("\r");
});
