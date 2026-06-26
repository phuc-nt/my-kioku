// `my-kioku reindex` — rebuild the disposable SQLite index from the whole vault.

import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { openDb, closeDb } from "../index/db.ts";
import { fullReindex, type ReindexStats } from "../index/indexer.ts";

export function runReindex(vaultFlag?: string): never {
  const resolved = resolveVault({ vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) {
    return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  }

  const db = openDb(resolved.path);
  let stats: ReindexStats;
  try {
    stats = fullReindex(db, resolved.path);
  } finally {
    // closeDb runs before ok() exits the process; checkpoints WAL.
    closeDb(db);
  }
  return ok(stats);
}
