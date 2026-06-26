import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { syncIfStale } from "../../src/index/lazy-sync.ts";
import { appendEntry } from "../../src/vault/daily-note.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";
import { dailyNotePath, entityPath } from "../../src/vault/vault-paths.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-sync-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function bump(path: string): void {
  // Force a different mtime (some FS have 1s resolution → set to future).
  const t = new Date(Date.now() + 5000);
  utimesSync(path, t, t);
}

test("syncIfStale is a no-op when nothing changed", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "hello [[Hùng]]", "happy", 4);
  ensureStub(v, "Hùng");
  const db = openDb(v);
  fullReindex(db, v);
  const stats = syncIfStale(db, v);
  expect(stats.changed).toBe(0);
  expect(stats.removed).toBe(0);
  db.close();
});

test("syncIfStale picks up a manual edit to a daily note", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "08:00", "first entry", "calm", 3);
  const db = openDb(v);
  fullReindex(db, v);

  // Manually append a second entry to the file (simulate Obsidian edit).
  const path = dailyNotePath(v, "2026-06-12");
  appendEntry(v, "2026-06-12", "20:00", "second entry [[Mẹ]]", "tired", 2);
  bump(path);

  const stats = syncIfStale(db, v);
  expect(stats.changed).toBe(1);
  const n = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM entries").get();
  expect(n?.n).toBe(2);
  db.close();
});

test("syncIfStale removes rows when an entity file is deleted", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "hello [[Hùng]]", "happy", 4);
  ensureStub(v, "Hùng");
  const db = openDb(v);
  fullReindex(db, v);
  expect(
    db.query<{ n: number }, []>("SELECT COUNT(*) n FROM entities").get()?.n,
  ).toBe(1);

  rmSync(entityPath(v, "Hùng"));
  const stats = syncIfStale(db, v);
  expect(stats.removed).toBe(1);
  expect(
    db.query<{ n: number }, []>("SELECT COUNT(*) n FROM entities").get()?.n,
  ).toBe(0);
  db.close();
});

test("syncIfStale removes a deleted daily note's entries", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "to be deleted", "happy", 4);
  const db = openDb(v);
  fullReindex(db, v);
  rmSync(dailyNotePath(v, "2026-06-12"));
  syncIfStale(db, v);
  expect(
    db.query<{ n: number }, []>("SELECT COUNT(*) n FROM entries").get()?.n,
  ).toBe(0);
  db.close();
});
