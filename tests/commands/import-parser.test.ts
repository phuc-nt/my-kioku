import { test, expect } from "bun:test";
import { parseKiokuLiteFile } from "../../src/commands/import-kioku-lite.ts";

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
