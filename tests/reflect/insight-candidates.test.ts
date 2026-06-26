import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { detectInsights } from "../../src/reflect/insight-candidates.ts";
import { appendEntry } from "../../src/vault/daily-note.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";

const dirs: string[] = [];
function vault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-insight-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ENTRY_ID = /^\d{4}-\d{2}-\d{2}#\d+$/;

test("co_occurrence evidence is real entry_ids", () => {
  const v = vault();
  for (let i = 10; i <= 13; i++) {
    appendEntry(v, `2026-06-${i}`, "20:00", "Gặp [[Hùng]] và [[Mẹ]]", "happy", 4);
  }
  ensureStub(v, "Hùng");
  ensureStub(v, "Mẹ");
  const db = openDb(v);
  fullReindex(db, v);
  const insights = detectInsights(db, { from: "2026-06-01", to: "2026-06-30" });
  const co = insights.find((i) => i.kind === "co_occurrence");
  expect(co).toBeDefined();
  expect(co!.evidence.length).toBeGreaterThanOrEqual(4);
  for (const id of co!.evidence) expect(id).toMatch(ENTRY_ID);
  db.close();
});

test("entity_spike evidence is real entry_ids (not just the entity name)", () => {
  const v = vault();
  // Establish a low baseline far in the past, then a burst in the period.
  appendEntry(v, "2026-01-05", "20:00", "Thoáng gặp [[Sếp]]", "ok", 3);
  for (let i = 10; i <= 14; i++) {
    appendEntry(v, `2026-06-${i}`, "20:00", "Họp với [[Sếp]]", "tired", 2);
  }
  ensureStub(v, "Sếp");
  const db = openDb(v);
  fullReindex(db, v);
  const insights = detectInsights(db, { from: "2026-06-01", to: "2026-06-30" });
  const spike = insights.find((i) => i.kind === "entity_spike");
  expect(spike).toBeDefined();
  for (const id of spike!.evidence) expect(id).toMatch(ENTRY_ID);
  db.close();
});

test("mood_streak breaks across a non-adjacent (gap) day", () => {
  const v = vault();
  // Declining but with a GAP (no 06-12) → not "4 in a row".
  appendEntry(v, "2026-06-10", "20:00", "d1", "ok", 5);
  appendEntry(v, "2026-06-11", "20:00", "d2", "ok", 4);
  // gap on 06-12
  appendEntry(v, "2026-06-13", "20:00", "d3", "ok", 3);
  appendEntry(v, "2026-06-14", "20:00", "d4", "ok", 2);
  const db = openDb(v);
  fullReindex(db, v);
  const insights = detectInsights(db, { from: "2026-06-01", to: "2026-06-30" });
  // Longest adjacent declining run is only 2 days (<4) → no streak.
  expect(insights.find((i) => i.kind === "mood_streak")).toBeUndefined();
  db.close();
});
