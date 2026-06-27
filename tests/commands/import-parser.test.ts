import { test, expect } from "bun:test";
import {
  parseKiokuLiteFile,
  parseTagList,
  resolveDateTime,
} from "../../src/commands/import-kioku-lite-parser.ts";

// --- partial event_time must fall back to the time date (real-data gap) ---
test("partial/garbage event_time falls back to the time timestamp date (no data loss)", () => {
  const base = { time: "2026-02-24T19:49:27.169820+07:00", text: "x" };
  // Full event_time wins.
  expect(resolveDateTime({ ...base, eventTime: "2022-08-25" })?.date).toBe("2022-08-25");
  // Year-only / year-month / free text → fall back to the time date, not skip.
  expect(resolveDateTime({ ...base, eventTime: "2020" })?.date).toBe("2026-02-24");
  expect(resolveDateTime({ ...base, eventTime: "2025-02" })?.date).toBe("2026-02-24");
  expect(resolveDateTime({ ...base, eventTime: "lớp 2" })?.date).toBe("2026-02-24");
  // No event_time → time date.
  expect(resolveDateTime(base)?.date).toBe("2026-02-24");
  // HH:MM always from time.
  expect(resolveDateTime(base)?.time).toBe("19:49");
});

// --- v1.1: # Kioku — heading + Python-list tags ---
test("parses '# Kioku —' heading (Telegram format) + tags Python-list", () => {
  const f = `# Kioku — 2026-02-26

---
time: "2026-02-26T23:14:38.700935+07:00"
mood: "concerned"
tags: ['parenting', 'children', 'phong', 'vy']
---
Con tôi 4 tuổi rồi. Tôi bắt đầu dạy chữ cho con.
`;
  const { blocks } = parseKiokuLiteFile(f);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.mood).toBe("concerned");
  expect(blocks[0]!.tags).toEqual(["parenting", "children", "phong", "vy"]);
  expect(blocks[0]!.text).toBe("Con tôi 4 tuổi rồi. Tôi bắt đầu dạy chữ cho con.");
});

test("parseTagList: lenient Python-list (single/double quotes, spaces)", () => {
  expect(parseTagList("tags: ['a', \"b\" , 'c']")).toEqual(["a", "b", "c"]);
  expect(parseTagList("tags: []")).toEqual([]);
  expect(parseTagList("mood: happy")).toEqual([]); // not a tags line
});

test("a block with event_time AFTER tags still parses both", () => {
  const f = `# Kioku — 2026-03-03

---
time: "2026-03-03T20:43:17+07:00"
mood: "excited"
tags: ['career', 'japan']
event_time: "2022-08-25"
---
Profile text.
`;
  const b = parseKiokuLiteFile(f).blocks[0]!;
  expect(b.tags).toEqual(["career", "japan"]);
  expect(b.eventTime).toBe("2022-08-25");
});

test("a block with no tags has tags undefined", () => {
  const f = `# Kioku — 2026-03-03

---
time: "2026-03-03T20:00:00+07:00"
mood: "neutral"
---
No tags here.
`;
  expect(parseKiokuLiteFile(f).blocks[0]!.tags).toBeUndefined();
});


test("a stray --- inside text does NOT desync following blocks (C1)", () => {
  const f = `# Kioku Lite — 2026-03-03

---
time: "2026-03-03T20:00:00+07:00"
mood: "neutral"
---
First memory.
Some divider below in my notes:
---
More text after the divider, still block one.

---
time: "2026-03-03T21:00:00+07:00"
mood: "happy"
---
Second memory, must survive.
`;
  const { blocks } = parseKiokuLiteFile(f);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]!.text).toContain("More text after the divider");
  expect(blocks[1]!.text).toContain("Second memory, must survive.");
});

test("CRLF files parse correctly (C2)", () => {
  const f =
    "# Kioku Lite — 2026-03-03\r\n\r\n---\r\ntime: \"2026-03-03T20:00:00+07:00\"\r\nmood: \"calm\"\r\n---\r\nMemory with CRLF.\r\n";
  const { blocks } = parseKiokuLiteFile(f);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.mood).toBe("calm");
  expect(blocks[0]!.text).toContain("Memory with CRLF.");
});

test("trailing block with header but no text is skipped, not paired wrong", () => {
  const f = `# Kioku Lite — 2026-03-03

---
time: "2026-03-03T20:00:00+07:00"
mood: "ok"
---
Real memory.

---
time: "2026-03-03T21:00:00+07:00"
mood: "ok"
---
`;
  const { blocks } = parseKiokuLiteFile(f);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.text).toBe("Real memory.");
});

test("file with no heading still parses blocks", () => {
  const f = `---
time: "2026-03-03T20:00:00+07:00"
mood: "ok"
---
No heading memory.
`;
  const { blocks } = parseKiokuLiteFile(f);
  expect(blocks).toHaveLength(1);
});
