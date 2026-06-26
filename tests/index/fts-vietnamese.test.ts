import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { appendEntry } from "../../src/vault/daily-note.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-fts-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function search(v: string, q: string): string[] {
  const db = openDb(v);
  fullReindex(db, v);
  const rows = db
    .query<{ id: string }, [string]>(
      "SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ?",
    )
    .all(q)
    .map((r) => r.id);
  db.close();
  return rows;
}

test("FTS matches Vietnamese with and without diacritics", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "Ăn phở với Hùng ở quán", "happy", 4);

  // diacritic-insensitive (remove_diacritics 2)
  expect(search(v, "pho")).toHaveLength(1); // query "pho" matches "phở"
  expect(search(v, "phở")).toHaveLength(1); // query "phở" matches "phở"
  expect(search(v, "hung")).toHaveLength(1); // "hung" matches "Hùng"
  expect(search(v, "Hùng")).toHaveLength(1);
});

test("FTS does not match unrelated terms", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "Đi chạy bộ buổi sáng", "energetic", 4);
  expect(search(v, "phở")).toHaveLength(0);
});
