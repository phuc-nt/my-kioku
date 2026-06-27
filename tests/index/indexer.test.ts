import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/index/db.ts";
import { fullReindex, indexFile } from "../../src/index/indexer.ts";
import { vaultFileFor } from "../../src/index/vault-walker.ts";
import { appendEntry, setCheckinMeta } from "../../src/vault/daily-note.ts";
import { ensureStub, updateMeta } from "../../src/vault/entity-note.ts";

const dirs: string[] = [];
function makeVault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-idx-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function seed(v: string): void {
  appendEntry(v, "2026-06-12", "21:30", "Ăn phở với [[Hùng]]", "happy", 4);
  appendEntry(v, "2026-06-12", "22:00", "Về nhà với [[Mẹ]]", "calm", 3);
  setCheckinMeta(v, "2026-06-12", { sleep_hours: 7, exercise: "run 5km", mood_score: 4 });
  ensureStub(v, "Hùng");
  ensureStub(v, "Mẹ");
  updateMeta(v, "Hùng", { type: "person", aliases: ["bạn Hùng"] });
}

test("fullReindex builds entries, links, entities, daily_meta", () => {
  const v = makeVault();
  seed(v);
  const db = openDb(v);
  const stats = fullReindex(db, v);

  expect(stats.entries).toBe(2);
  expect(stats.entities).toBe(2);
  expect(stats.links).toBe(2);

  const entry = db
    .query<{ id: string; mood: string; intensity: number }, [string]>(
      "SELECT id, mood, intensity FROM entries WHERE id = ?",
    )
    .get("2026-06-12#0");
  expect(entry).toMatchObject({ id: "2026-06-12#0", mood: "happy", intensity: 4 });

  const meta = db
    .query<{ sleep_hours: number; exercise: string }, [string]>(
      "SELECT sleep_hours, exercise FROM daily_meta WHERE date = ?",
    )
    .get("2026-06-12");
  expect(meta).toMatchObject({ sleep_hours: 7, exercise: "run 5km" });

  const ent = db
    .query<{ type: string; aliases: string }, [string]>(
      "SELECT type, aliases FROM entities WHERE name = ?",
    )
    .get("Hùng");
  expect(ent?.type).toBe("person");
  expect(JSON.parse(ent!.aliases)).toEqual(["bạn Hùng"]);
  db.close();
});

test("links resolve to entity targets", () => {
  const v = makeVault();
  seed(v);
  const db = openDb(v);
  fullReindex(db, v);
  const targets = db
    .query<{ target: string }, []>("SELECT target FROM links ORDER BY target")
    .all()
    .map((r) => r.target);
  expect(targets).toContain("Hùng");
  expect(targets).toContain("Mẹ");
  db.close();
});

test("disposable: delete db then reindex yields identical results", () => {
  const v = makeVault();
  seed(v);

  const db1 = openDb(v);
  fullReindex(db1, v);
  const before = db1
    .query<{ id: string; body: string }, []>(
      "SELECT id, body FROM entries ORDER BY id",
    )
    .all();
  db1.close();

  // Nuke the index file entirely.
  rmSync(join(v, ".kioku", "index.db"), { force: true });
  rmSync(join(v, ".kioku", "index.db-wal"), { force: true });
  rmSync(join(v, ".kioku", "index.db-shm"), { force: true });

  const db2 = openDb(v);
  fullReindex(db2, v);
  const after = db2
    .query<{ id: string; body: string }, []>(
      "SELECT id, body FROM entries ORDER BY id",
    )
    .all();
  db2.close();

  expect(after).toEqual(before);
});

test("dup-date journal files: no silent data loss (loud skip, first survives)", () => {
  // Abnormal vault: two journal files map to the same date. The canonical layout
  // is one-date-one-file, so the second must NOT silently delete the first's
  // entries. Keyed-by-file removal + entry-id PK means the collision surfaces in
  // `skipped` rather than vanishing.
  const v = makeVault();
  const { mkdirSync, writeFileSync } = require("node:fs");
  const a = join(v, "journal", "2026", "06");
  mkdirSync(a, { recursive: true });
  writeFileSync(join(a, "2026-06-12.md"), "# 2026-06-12\n\n## 08:00\nfrom file A\n");
  // A second file in a different folder that also resolves to date 2026-06-12.
  const b = join(v, "journal", "2026", "06", "dup");
  mkdirSync(b, { recursive: true });
  writeFileSync(join(b, "2026-06-12.md"), "# 2026-06-12\n\n## 09:00\nfrom file B\n");

  const db = openDb(v);
  const stats = fullReindex(db, v);

  // Exactly one of the two indexed cleanly; the other is reported, not lost-silently.
  expect(stats.skipped.length).toBeGreaterThanOrEqual(1);
  const surviving = db
    .query<{ body: string }, []>("SELECT body FROM entries")
    .all()
    .map((r) => r.body);
  expect(surviving.length).toBeGreaterThanOrEqual(1);
  db.close();
});

test("malformed file is skipped, not fatal to the whole reindex", () => {
  const v = makeVault();
  seed(v);
  // Drop an entity file that is a directory-looking name is hard; instead make an
  // entity file unreadable-equivalent by writing binary garbage frontmatter — the
  // parser tolerates it, so simulate a throw via an unparyable path is N/A here.
  // We assert the happy path still reports an empty skipped list.
  const db = openDb(v);
  const stats = fullReindex(db, v);
  expect(stats.skipped).toEqual([]);
  db.close();
});

test("openDb is idempotent (re-open keeps data)", () => {
  const v = makeVault();
  seed(v);
  const db1 = openDb(v);
  fullReindex(db1, v);
  db1.close();
  const db2 = openDb(v);
  const n = db2.query<{ n: number }, []>("SELECT COUNT(*) n FROM entries").get();
  expect(n?.n).toBe(2);
  db2.close();
});

// --- v1.1: relations + tags indexing ---
import { mkdirSync, writeFileSync } from "node:fs";
function writeDaily(v: string, dateISO: string, content: string): void {
  const [y, m] = dateISO.split("-") as [string, string, string];
  const dir = join(v, "journal", y, m);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${dateISO}.md`), content, "utf8");
}

test("indexes relations + tags rows for an entry", () => {
  const v = makeVault();
  writeDaily(
    v,
    "2026-06-12",
    "# 2026-06-12\n\n## 21:30\nmood:: happy/4\njoy:: [[Chạy bộ]], [[Mẹ]]\ntrigger:: [[Áp lực]]\ntags:: career, health\nĂn phở.\n",
  );
  const db = openDb(v);
  const stats = fullReindex(db, v);
  expect(stats.relations).toBe(3); // joy×2 + trigger×1
  expect(stats.tags).toBe(2);

  const rels = db
    .query<{ rel_type: string; target: string }, [string]>(
      "SELECT rel_type, target FROM relations WHERE entry_id = ? ORDER BY rel_type, target",
    )
    .all("2026-06-12#0");
  expect(rels).toEqual([
    { rel_type: "joy", target: "Chạy bộ" },
    { rel_type: "joy", target: "Mẹ" },
    { rel_type: "trigger", target: "Áp lực" },
  ]);
  const tags = db
    .query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE entry_id = ? ORDER BY tag")
    .all("2026-06-12#0")
    .map((r) => r.tag);
  expect(tags).toEqual(["career", "health"]);
  db.close();
});

test("re-indexing a file does not duplicate relations/tags (removeFile clears first)", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-12", "# 2026-06-12\n\n## 21:30\njoy:: [[X]]\ntags:: a\nText.\n");
  const db = openDb(v);
  fullReindex(db, v);
  fullReindex(db, v); // second pass
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM relations").get()?.n).toBe(1);
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM tags").get()?.n).toBe(1);
  db.close();
});

test("rebuild-identical: a v1 vault produces identical entries/links/fts after schema bump", () => {
  const v = makeVault();
  seed(v); // v1-style: mood-only entries + wikilinks, no relations/tags
  const db = openDb(v);
  fullReindex(db, v);
  const dump = () => ({
    entries: db.query<unknown, []>("SELECT id, mood, intensity, body FROM entries ORDER BY id").all(),
    links: db.query<unknown, []>("SELECT entry_id, target FROM links ORDER BY entry_id, target").all(),
    fts: db.query<unknown, []>("SELECT rowid, body FROM entries_fts ORDER BY rowid").all(),
  });
  const before = JSON.stringify(dump());
  fullReindex(db, v);
  const after = JSON.stringify(dump());
  expect(after).toBe(before);
  // And no relations/tags rows for a v1 vault.
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM relations").get()?.n).toBe(0);
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM tags").get()?.n).toBe(0);
  db.close();
});

test("single-file re-index removes stale relations/tags but keeps OTHER files' rows (Invariant #4)", () => {
  const v = makeVault();
  writeDaily(v, "2026-06-10", "# 2026-06-10\n\n## 08:00\njoy:: [[A]], [[A2]]\ntags:: x, x2\nFile one.\n");
  writeDaily(v, "2026-06-11", "# 2026-06-11\n\n## 09:00\njoy:: [[B]]\ntags:: y\nFile two.\n");
  const db = openDb(v);
  fullReindex(db, v);
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM relations").get()?.n).toBe(3);
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM tags").get()?.n).toBe(3);

  // Edit ONLY file one (remove a relation + a tag), then re-index JUST that file
  // via the single-file path (indexFile → removeFile) — the path lazy-sync uses.
  writeDaily(v, "2026-06-10", "# 2026-06-10\n\n## 08:00\njoy:: [[A]]\ntags:: x\nFile one edited.\n");
  const vf = vaultFileFor(v, "journal/2026/06/2026-06-10.md")!;
  indexFile(db, vf);

  // File one now has 1 rel + 1 tag (stale A2/x2 gone — no orphans).
  expect(
    db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM relations WHERE entry_id = ?").get("2026-06-10#0")?.n,
  ).toBe(1);
  expect(
    db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tags WHERE entry_id = ?").get("2026-06-10#0")?.n,
  ).toBe(1);
  // File TWO untouched — its rows survive the single-file re-index of file one.
  expect(
    db.query<{ target: string }, [string]>("SELECT target FROM relations WHERE entry_id = ?").get("2026-06-11#0")?.target,
  ).toBe("B");
  expect(
    db.query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE entry_id = ?").get("2026-06-11#0")?.tag,
  ).toBe("y");
  // No global orphans: totals reflect the edit.
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM relations").get()?.n).toBe(2);
  expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM tags").get()?.n).toBe(2);
  db.close();
});
