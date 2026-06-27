import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";
import {
  findMissingRelations,
  buildRelationSummary,
  findUnconvertedTags,
} from "../../src/reflect/relation-checks.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-relchk-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function writeDaily(v: string, dateISO: string, content: string): void {
  const [y, m] = dateISO.split("-") as [string, string, string];
  const dir = join(v, "journal", y, m);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${dateISO}.md`), content, "utf8");
}
const RANGE = { from: "2020-01-01", to: "2030-12-31" };

test("findMissingRelations: strong-mood entries with no relation", () => {
  const v = makeVault();
  // Strong high (4), strong low (2), and a mid (3, not flagged).
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\nmood:: happy/5\nVui mà không ghi relation.\n");
  writeDaily(v, "2026-06-11", "# d\n\n## 08:00\nmood:: sad/2\njoy:: [[X]]\nCó relation rồi.\n");
  writeDaily(v, "2026-06-12", "# d\n\n## 08:00\nmood:: ok/3\nTrung tính.\n");
  const db = openDb(v);
  fullReindex(db, v);
  const missing = findMissingRelations(db);
  expect(missing.map((m) => m.entry_id)).toEqual(["2026-06-10#0"]);
  expect(missing[0]!.intensity).toBe(5);
  expect(missing[0]!.first_line).toContain("Vui");
  db.close();
});

test("buildRelationSummary: top joy/trigger targets by count", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\njoy:: [[Chạy bộ]]\nx\n");
  writeDaily(v, "2026-06-11", "# d\n\n## 08:00\njoy:: [[Chạy bộ]], [[Mẹ]]\ny\n");
  writeDaily(v, "2026-06-12", "# d\n\n## 08:00\ntrigger:: [[Áp lực]]\nz\n");
  const db = openDb(v);
  fullReindex(db, v);
  const s = buildRelationSummary(db, RANGE);
  expect(s.joy[0]).toEqual({ target: "Chạy bộ", count: 2 });
  expect(s.joy.find((t) => t.target === "Mẹ")?.count).toBe(1);
  expect(s.trigger).toEqual([{ target: "Áp lực", count: 1 }]);
  db.close();
});

test("findUnconvertedTags: tags without a matching entity (folded), with examples", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\ntags:: career, Hùng\nx\n");
  // An entity note named Hùng exists → that tag is NOT surfaced (folded match).
  ensureStub(v, "Hùng");
  const db = openDb(v);
  fullReindex(db, v);
  const tags = findUnconvertedTags(db);
  const surfaced = tags.map((t) => t.tag);
  expect(surfaced).toContain("career"); // no entity → surfaced
  expect(surfaced).not.toContain("Hùng"); // matches entity → not surfaced
  const career = tags.find((t) => t.tag === "career")!;
  expect(career.count).toBe(1);
  expect(career.examples).toEqual(["2026-06-10#0"]);
  db.close();
});

test("relation_summary merges casing/diacritic target variants into one count (M2)", () => {
  const v = makeVault();
  // Same person, spelled two ways → should count as ONE target with count 2.
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\njoy:: [[Chạy bộ]]\nx\n");
  writeDaily(v, "2026-06-11", "# d\n\n## 08:00\njoy:: [[chạy bộ]]\ny\n");
  const db = openDb(v);
  fullReindex(db, v);
  const s = buildRelationSummary(db, RANGE);
  expect(s.joy.length).toBe(1);
  expect(s.joy[0]!.count).toBe(2);
  db.close();
});

test("findUnconvertedTags folds diacritics when comparing to entities", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\ntags:: hung\nx\n"); // tag 'hung'
  ensureStub(v, "Hùng"); // entity 'Hùng' folds to 'hung'
  const db = openDb(v);
  fullReindex(db, v);
  expect(findUnconvertedTags(db).map((t) => t.tag)).not.toContain("hung");
  db.close();
});
