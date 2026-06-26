// `my-kioku reindex` — rebuild the disposable SQLite index from the whole vault.

import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { openDb } from "../index/db.ts";
import { fullReindex } from "../index/indexer.ts";

export function runReindex(vaultFlag?: string): never {
  const resolved = resolveVault({ vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) {
    return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  }

  const db = openDb(resolved.path);
  try {
    const stats = fullReindex(db, resolved.path);
    return ok(stats);
  } finally {
    db.close();
  }
}
