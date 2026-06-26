// Lazy incremental sync: compare on-disk mtimes against the `files` table and
// re-index only what changed. Called at the start of every read command so the
// vault stays the source of truth even after manual edits in Obsidian.

import { Database } from "bun:sqlite";
import { walkVault } from "./vault-walker.ts";
import { indexFile, removeFile } from "./indexer.ts";

export interface SyncStats {
  changed: number;
  removed: number;
  scanned: number;
  skipped: { file: string; error: string }[];
}

/**
 * Re-index files whose mtime differs from the stored value, remove rows for
 * files that disappeared. Returns counts (all zero when nothing changed).
 * A single unreadable/malformed file is skipped, not fatal to the whole sync.
 */
export function syncIfStale(db: Database, vault: string): SyncStats {
  const onDisk = walkVault(vault);
  const stored = new Map<string, number>();
  for (const row of db
    .query<{ path: string; mtime: number }, []>("SELECT path, mtime FROM files")
    .all()) {
    stored.set(row.path, row.mtime);
  }

  let changed = 0;
  const seen = new Set<string>();
  const skipped: { file: string; error: string }[] = [];

  for (const vf of onDisk) {
    seen.add(vf.rel);
    const prev = stored.get(vf.rel);
    // Compare with != (not >) — some filesystems have coarse mtime resolution.
    if (prev === undefined || prev !== Math.floor(vf.mtimeMs)) {
      try {
        indexFile(db, vf);
        changed++;
      } catch (e) {
        skipped.push({ file: vf.rel, error: (e as Error).message });
      }
    }
  }

  // Files in the index but no longer on disk → remove (keyed by relative path).
  let removed = 0;
  for (const path of stored.keys()) {
    if (!seen.has(path)) {
      removeFile(db, path);
      removed++;
    }
  }

  return { changed, removed, scanned: onDisk.length, skipped };
}
