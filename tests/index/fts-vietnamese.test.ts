import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { appendEntry } from "../../src/vault/daily-note.ts";
import { ftsSearch } from "../../src/search/fts-search.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-fts-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Search via the REAL path (ftsSearch folds the query to match the folded index).
function search(v: string, q: string): string[] {
  const db = openDb(v);
  fullReindex(db, v);
  const ids = ftsSearch(db, q).map((h) => h.id);
  db.close();
  return ids;
}

test("FTS matches Vietnamese with and without combining-mark diacritics", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "Ăn phở với Hùng ở quán", "happy", 4);
  expect(search(v, "pho")).toHaveLength(1); // "pho" matches "phở"
  expect(search(v, "phở")).toHaveLength(1);
  expect(search(v, "hung")).toHaveLength(1); // "hung" matches "Hùng"
  expect(search(v, "Hùng")).toHaveLength(1);
});

test("FTS folds đ→d: a diacritic-free query matches đ-words (the fix)", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "Gọi cho gia đình, đọc sách, đi trên đường về", "calm", 3);
  // No-accent queries must hit đ-words (previously returned 0).
  expect(search(v, "gia dinh")).toHaveLength(1); // gia đình
  expect(search(v, "doc sach")).toHaveLength(1); // đọc sách
  expect(search(v, "duong")).toHaveLength(1); // đường
  // Accented forms still match too.
  expect(search(v, "gia đình")).toHaveLength(1);
  expect(search(v, "đọc")).toHaveLength(1);
});

test("FTS đ-fold is symmetric: Đ at start of word", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "08:00", "Đà Nẵng đẹp, Đông ấm", "happy", 4);
  expect(search(v, "da nang")).toHaveLength(1); // Đà Nẵng
  expect(search(v, "dong")).toHaveLength(1); // Đông
});

test("FTS does not match unrelated terms", () => {
  const v = makeVault();
  appendEntry(v, "2026-06-12", "21:30", "Đi chạy bộ buổi sáng", "energetic", 4);
  expect(search(v, "phở")).toHaveLength(0);
  expect(search(v, "gia dinh")).toHaveLength(0); // not in this entry
});
