import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";
import { runLint } from "../../src/reflect/lint-checks.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-lint-"));
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

test("broken_wikilinks folds case/diacritics: [[Mẹ]] resolves to entity 'mẹ' (not broken)", () => {
  const v = makeVault();
  // Entry links [[Mẹ]] (capitalized); the entity note is 'mẹ' (lowercase).
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\nGọi cho [[Mẹ]].\n");
  ensureStub(v, "mẹ");
  const db = openDb(v);
  fullReindex(db, v);
  const lint = runLint(db);
  // Must NOT report [[Mẹ]] as broken — it folds to the existing 'mẹ' entity.
  expect(lint.broken_wikilinks.map((b) => b.target)).not.toContain("Mẹ");
  db.close();
});

test("broken_wikilinks still catches a genuinely missing entity", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\nĐi với [[NgườiLạ]].\n");
  // No entity note created for NgườiLạ.
  const db = openDb(v);
  fullReindex(db, v);
  const lint = runLint(db);
  expect(lint.broken_wikilinks.map((b) => b.target)).toContain("NgườiLạ");
  db.close();
});

test("orphan_entities folds case: entity 'mẹ' linked only via [[Mẹ]] is NOT orphan", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\n[[Mẹ]] gọi điện.\n");
  ensureStub(v, "mẹ");
  const db = openDb(v);
  fullReindex(db, v);
  const lint = runLint(db);
  expect(lint.orphan_entities.map((o) => o.name)).not.toContain("mẹ");
  db.close();
});

test("orphan_entities still catches a truly unlinked entity", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\nKhông link ai.\n");
  ensureStub(v, "CôĐơn"); // entity exists but nothing links to it
  const db = openDb(v);
  fullReindex(db, v);
  const lint = runLint(db);
  expect(lint.orphan_entities.map((o) => o.name)).toContain("CôĐơn");
  db.close();
});

test("broken_wikilinks de-dupes repeated targets", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# d\n\n## 08:00\n[[Ghost]] và [[Ghost]] lại.\n");
  writeDaily(v, "2026-06-11", "# d\n\n## 08:00\n[[Ghost]] nữa.\n");
  const db = openDb(v);
  fullReindex(db, v);
  const lint = runLint(db);
  expect(lint.broken_wikilinks.filter((b) => b.target === "Ghost").length).toBe(1);
  db.close();
});
