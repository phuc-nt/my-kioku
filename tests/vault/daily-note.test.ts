import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  readDaily,
  setCheckinMeta,
} from "../../src/vault/daily-note.ts";
import { dailyNotePath } from "../../src/vault/vault-paths.ts";

const dirs: string[] = [];
function vault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-daily-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const DATE = "2026-06-12";

test("append then read round-trips verbatim with Vietnamese + emoji + multi-line", () => {
  const v = vault();
  appendEntry(v, DATE, "21:30", "Ăn phở với [[Hùng]] 🍜\nNgon tuyệt!", "happy", 4);
  appendEntry(v, DATE, "22:00", "Về nhà nghỉ ngơi", "tired", 2);

  const daily = readDaily(v, DATE);
  expect(daily.entries).toHaveLength(2);
  expect(daily.entries[0]).toMatchObject({
    time: "21:30",
    mood: "happy",
    intensity: 4,
    text: "Ăn phở với [[Hùng]] 🍜\nNgon tuyệt!",
  });
  expect(daily.entries[1]).toMatchObject({
    time: "22:00",
    mood: "tired",
    intensity: 2,
    text: "Về nhà nghỉ ngơi",
  });
});

test("entryId uses date#ordinal", () => {
  const v = vault();
  const r1 = appendEntry(v, DATE, "08:00", "a");
  const r2 = appendEntry(v, DATE, "08:00", "b");
  expect(r1.entryId).toBe("2026-06-12#0");
  expect(r2.entryId).toBe("2026-06-12#1");
});

test("append without mood omits mood line", () => {
  const v = vault();
  appendEntry(v, DATE, "09:00", "no mood here");
  const daily = readDaily(v, DATE);
  expect(daily.entries[0]!.mood).toBeUndefined();
  expect(daily.entries[0]!.text).toBe("no mood here");
});

test("manual edit between entries: parser still finds all sections", () => {
  const v = vault();
  appendEntry(v, DATE, "08:00", "first");
  appendEntry(v, DATE, "20:00", "second");
  // User hand-edits: append prose to the end of the 08:00 section.
  // By the section model, that prose belongs to entry 0 — the parser must
  // not crash, must still find both sections, and entry 1 stays intact.
  const path = dailyNotePath(v, DATE);
  const raw = readFileSync(path, "utf8");
  const edited = raw.replace(
    "## 20:00",
    "Some stray note I typed myself.\n\n## 20:00",
  );
  writeFileSync(path, edited, "utf8");

  const daily = readDaily(v, DATE);
  expect(daily.entries).toHaveLength(2);
  // Entry 0 absorbs the appended prose (it lives inside the 08:00 section).
  expect(daily.entries[0]!.text).toContain("first");
  expect(daily.entries[0]!.text).toContain("Some stray note I typed myself.");
  // Entry 1 is untouched.
  expect(daily.entries[1]!.text).toBe("second");
});

test("setCheckinMeta writes frontmatter without disturbing body", () => {
  const v = vault();
  appendEntry(v, DATE, "21:30", "evening entry", "calm", 3);
  setCheckinMeta(v, DATE, { sleep_hours: 7, exercise: "run 5km", mood_score: 4 });

  const daily = readDaily(v, DATE);
  expect(daily.meta).toMatchObject({
    sleep_hours: 7,
    exercise: "run 5km",
    mood_score: 4,
  });
  // Body entry survives the frontmatter write.
  expect(daily.entries).toHaveLength(1);
  expect(daily.entries[0]!.text).toBe("evening entry");
});

test("setCheckinMeta merges across two calls", () => {
  const v = vault();
  setCheckinMeta(v, DATE, { sleep_hours: 6 });
  setCheckinMeta(v, DATE, { exercise: "yoga" });
  const daily = readDaily(v, DATE);
  expect(daily.meta).toMatchObject({ sleep_hours: 6, exercise: "yoga" });
});

test("readDaily on missing note returns empty", () => {
  const v = vault();
  const daily = readDaily(v, "2099-01-01");
  expect(daily.exists).toBe(false);
  expect(daily.entries).toEqual([]);
});

test("empty-string mood does not write a malformed mood line (H3)", () => {
  const v = vault();
  appendEntry(v, DATE, "09:00", "no real mood", "", 3);
  const path = dailyNotePath(v, DATE);
  expect(readFileSync(path, "utf8")).not.toContain("mood:: /");
  const daily = readDaily(v, DATE);
  expect(daily.entries[0]!.mood).toBeUndefined();
  expect(daily.entries[0]!.text).toBe("no real mood");
});
