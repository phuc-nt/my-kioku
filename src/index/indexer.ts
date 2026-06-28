// Index a single vault file into SQLite, dispatching by kind. The index mirrors
// the markdown; entries + its FTS row are always written in the same transaction.
// entries_fts stores fold(body) (diacritic-folded incl. đ→d) so diacritic-free
// queries match; entries.rowid == entries_fts.rowid keeps the two 1:1.

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseFrontmatter } from "../vault/frontmatter.ts";
import { parseEntries } from "../vault/entry-parser.ts";
import { extractWikilinks } from "../vault/wikilink-parser.ts";
import { fold } from "../lib/diacritics.ts";
import { walkVault, type VaultFile, type FileKind } from "./vault-walker.ts";

const KNOWN_META = new Set(["sleep_hours", "exercise", "mood_score"]);

/** Extract the YYYY-MM-DD date from a journal file path (basename without .md). */
function dateFromJournalPath(path: string): string {
  return basename(path, ".md");
}

/**
 * Remove all rows that belong to a file, keeping FTS in sync.
 * Journal rows are keyed by FILE (not date) so that — even in the abnormal case
 * of two files mapping to one date — re-indexing one file never deletes another
 * file's entries (avoids silent data loss; keeps the index disposable/order-free).
 */
export function removeFile(db: Database, rel: string): void {
  const kind = fileKind(rel);
  if (kind === "journal") {
    // Delete FTS rows FIRST (mirror by rowid), then entries/links/meta for this file.
    const ids = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM entries WHERE file = ?",
      )
      .all(rel);
    const delFts = db.prepare("DELETE FROM entries_fts WHERE rowid = ?");
    for (const { rowid } of ids) delFts.run(rowid);
    const byFile =
      "entry_id IN (SELECT id FROM entries WHERE file = ?)";
    db.prepare(`DELETE FROM links WHERE ${byFile}`).run(rel);
    // Delete relations/tags BEFORE entries so the entry-id subquery still resolves.
    db.prepare(`DELETE FROM relations WHERE ${byFile}`).run(rel);
    db.prepare(`DELETE FROM tags WHERE ${byFile}`).run(rel);
    db.prepare("DELETE FROM entries WHERE file = ?").run(rel);
    db.prepare("DELETE FROM daily_meta WHERE file = ?").run(rel);
  } else if (kind === "entity") {
    db.prepare("DELETE FROM entities WHERE file = ?").run(rel);
  }
  db.prepare("DELETE FROM files WHERE path = ?").run(rel);
}

function fileKind(rel: string): FileKind | null {
  if (rel.startsWith("journal/")) return "journal";
  if (rel.startsWith("entities/")) return "entity";
  if (rel.startsWith("insights/")) return "insight";
  return null;
}

/** Index (or re-index) one file. Idempotent: removes prior rows first. */
export function indexFile(db: Database, vf: VaultFile): void {
  const raw = readFileSync(vf.path, "utf8");
  const { meta, body } = parseFrontmatter(raw);

  db.transaction(() => {
    removeFile(db, vf.rel);

    if (vf.kind === "journal") {
      indexJournal(db, vf, meta, body);
    } else if (vf.kind === "entity") {
      indexEntity(db, vf, meta);
    }
    // insight files are tracked in `files` only (no derived rows).

    db.prepare("INSERT OR REPLACE INTO files(path, mtime, kind) VALUES (?, ?, ?)").run(
      vf.rel,
      Math.floor(vf.mtimeMs),
      vf.kind,
    );
  })();
}

function indexJournal(
  db: Database,
  vf: VaultFile,
  meta: Record<string, unknown>,
  body: string,
): void {
  const date = dateFromJournalPath(vf.path);

  const insEntry = db.prepare(
    "INSERT INTO entries(id, file, date, time, ordinal, mood, intensity, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insFts = db.prepare("INSERT INTO entries_fts(rowid, body) VALUES (?, ?)");
  const insLink = db.prepare("INSERT INTO links(entry_id, target) VALUES (?, ?)");
  const insRel = db.prepare(
    "INSERT INTO relations(entry_id, rel_type, target) VALUES (?, ?, ?)",
  );
  const insTag = db.prepare("INSERT INTO tags(entry_id, tag) VALUES (?, ?)");

  for (const e of parseEntries(body)) {
    const id = `${date}#${e.ordinal}`;
    const info = insEntry.run(
      id,
      vf.rel,
      date,
      e.time,
      e.ordinal,
      e.mood ?? null,
      e.intensity ?? null,
      e.text,
    );
    // FTS stores the FOLDED body (đ→d + strip marks) so diacritic-free queries hit.
    insFts.run(Number(info.lastInsertRowid), fold(e.text));
    for (const target of extractWikilinks(e.text)) insLink.run(id, target);
    // Emotional relations (typed edges) + plain tags from the entry's leading fields.
    for (const [verb, targets] of Object.entries(e.relations ?? {})) {
      for (const target of targets) insRel.run(id, verb, target);
    }
    for (const tag of e.tags ?? []) insTag.run(id, tag);
  }

  // Daily check-in frontmatter → daily_meta (unknown keys collected into extra).
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!KNOWN_META.has(k)) extra[k] = v;
  }
  db.prepare(
    "INSERT OR REPLACE INTO daily_meta(file, date, sleep_hours, exercise, mood_score, extra) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    vf.rel,
    date,
    typeof meta.sleep_hours === "number" ? meta.sleep_hours : null,
    typeof meta.exercise === "string" ? meta.exercise : null,
    typeof meta.mood_score === "number" ? meta.mood_score : null,
    Object.keys(extra).length ? JSON.stringify(extra) : null,
  );
}

function indexEntity(
  db: Database,
  vf: VaultFile,
  meta: Record<string, unknown>,
): void {
  // NFC the entity name: it is the GRAPH-JOIN KEY (entities.name = links.target).
  // A filesystem may hand back a decomposed (NFD) basename (e.g. APFS); link targets
  // are stored NFC (normalizeTarget), so the name must canonicalize too or the join
  // silently breaks.
  const name = basename(vf.path, ".md").normalize("NFC");
  const type = typeof meta.type === "string" ? meta.type : "unknown";
  const aliases = Array.isArray(meta.aliases)
    ? JSON.stringify((meta.aliases as unknown[]).map(String))
    : "[]";
  db.prepare(
    "INSERT OR REPLACE INTO entities(name, file, type, aliases) VALUES (?, ?, ?, ?)",
  ).run(name, vf.rel, type, aliases);
}

export interface ReindexStats {
  files: number;
  entries: number;
  entities: number;
  links: number;
  relations: number;
  tags: number;
  skipped: { file: string; error: string }[];
  ms: number;
}

/**
 * Drop all derived rows and rebuild from the whole vault, in ONE transaction so
 * a mid-walk failure rolls back to the previous good index (never leaves a
 * half-built one). A single unreadable/malformed file is skipped, not fatal.
 */
export function fullReindex(db: Database, vault: string): ReindexStats {
  const start = performance.now();
  const files = walkVault(vault);
  const skipped: { file: string; error: string }[] = [];

  db.transaction(() => {
    db.exec(
      "DELETE FROM entries_fts; DELETE FROM entries; DELETE FROM links; DELETE FROM relations; DELETE FROM tags; DELETE FROM entities; DELETE FROM daily_meta; DELETE FROM files;",
    );
    for (const vf of files) {
      try {
        indexFile(db, vf);
      } catch (e) {
        skipped.push({ file: vf.rel, error: (e as Error).message });
      }
    }
  })();

  const count = (sql: string): number =>
    db.query<{ n: number }, []>(sql).get()?.n ?? 0;

  return {
    files: files.length,
    entries: count("SELECT COUNT(*) n FROM entries"),
    entities: count("SELECT COUNT(*) n FROM entities"),
    links: count("SELECT COUNT(*) n FROM links"),
    relations: count("SELECT COUNT(*) n FROM relations"),
    tags: count("SELECT COUNT(*) n FROM tags"),
    skipped,
    ms: Math.round(performance.now() - start),
  };
}
