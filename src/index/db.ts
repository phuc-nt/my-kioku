// Disposable SQLite index over the vault, using bun:sqlite (FTS5 built in).
// The index can always be rebuilt from the markdown — so "migrations" are just
// drop-and-rebuild keyed on user_version.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { VAULT_INDEX_DIR } from "../config.ts";

/** Bump when the schema changes — triggers a full rebuild on next open. */
export const SCHEMA_VERSION = 2;

export function indexDbPath(vault: string): string {
  return join(vault, VAULT_INDEX_DIR, "index.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files(
  path TEXT PRIMARY KEY,
  mtime INTEGER,
  kind TEXT                       -- journal | entity | insight
);

CREATE TABLE IF NOT EXISTS entries(
  id TEXT PRIMARY KEY,            -- "{date}#{ordinal}"
  file TEXT,
  date TEXT,
  time TEXT,
  ordinal INTEGER,
  mood TEXT,
  intensity INTEGER,
  body TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  body,
  content='entries',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS links(
  entry_id TEXT,
  target TEXT                     -- normalized entity name
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
CREATE INDEX IF NOT EXISTS idx_links_entry ON links(entry_id);

CREATE TABLE IF NOT EXISTS entities(
  name TEXT PRIMARY KEY,
  file TEXT,
  type TEXT,
  aliases TEXT                    -- JSON array
);

CREATE TABLE IF NOT EXISTS daily_meta(
  file TEXT PRIMARY KEY,          -- keyed by file, not date (robust to dup-date files)
  date TEXT,
  sleep_hours REAL,
  exercise TEXT,
  mood_score INTEGER,
  extra TEXT                      -- JSON of unknown frontmatter keys
);
CREATE INDEX IF NOT EXISTS idx_daily_meta_date ON daily_meta(date);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
`;

/**
 * Open (creating if needed) the index db for a vault. If the on-disk schema
 * version differs, drop everything and rebuild the empty schema — callers then
 * run a full reindex. WAL mode for concurrent reads while writing.
 */
export function openDb(vault: string): Database {
  const path = indexDbPath(vault);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // No FK constraints declared — referential integrity is maintained by hand in
  // the indexer (same-transaction writes), so we don't enable foreign_keys.

  const row = db.query<{ user_version: number }, []>(
    "PRAGMA user_version;",
  ).get();
  const version = row?.user_version ?? 0;

  if (version !== SCHEMA_VERSION) {
    dropAll(db);
  }

  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

/**
 * Checkpoint the WAL back into the main db and close. A plain db.close() leaves
 * the -wal file growing across CLI invocations (each command is a short-lived
 * process); TRUNCATE folds it back so the index dir stays small.
 */
export function closeDb(db: Database): void {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    /* checkpoint is best-effort; never fail a command over it */
  }
  db.close();
}

/** Drop all known tables (index is disposable; this is the migration strategy). */
function dropAll(db: Database): void {
  for (const t of [
    "entries_fts",
    "entries",
    "links",
    "entities",
    "daily_meta",
    "files",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
}
