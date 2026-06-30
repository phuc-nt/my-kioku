// `my-kioku entity list [--type X]` — list entities (optionally filtered by type),
// with all-time mention counts, most-mentioned first. The read-side of GAP 9B: lets an
// agent answer "list every PERSON / every place" without a knowledge graph.

import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";

export interface EntityListArgs {
  vaultFlag?: string;
  type?: string; // optional exact (case-insensitive) type filter
}

export function runEntityList(args: EntityListArgs): never {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  const vault = resolved.path;

  const db = openDb(vault);
  let payload: unknown;
  try {
    syncIfStale(db, vault);
    const want = args.type?.toLowerCase();
    const rows = db
      .query<{ name: string; type: string; aliases: string }, []>(
        "SELECT name, type, aliases FROM entities",
      )
      .all()
      .filter((e) => (want ? (e.type ?? "").toLowerCase() === want : true))
      .map((e) => ({
        name: e.name,
        type: e.type,
        aliases: parseAliases(e.aliases),
        mentions:
          db
            .query<{ n: number }, [string]>(
              "SELECT COUNT(*) n FROM links WHERE target = ?",
            )
            .get(e.name)?.n ?? 0,
      }))
      // Stable order for reproducible runs: mentions desc, then name asc.
      .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));

    payload = { type: args.type ?? null, count: rows.length, entities: rows };
  } finally {
    closeDb(db);
  }
  return ok(payload);
}

function parseAliases(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown[];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
