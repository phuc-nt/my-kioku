// Entity-aware recall: when the query mentions an entity name/alias, pull recent
// entries that LINK to that entity — even if their body never contains the query
// words. Replaces graph traversal with a simple link join (KISS at personal scale).

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";
import type { DateRange } from "../lib/dates.ts";

export interface EntityMatch {
  name: string;
  type: string;
  aliases: string[];
  /** Lifetime mention count (NOT scoped to the query date range). */
  totalMentionsAllTime: number;
}

export interface ExpansionResult {
  entities: EntityMatch[];
  /** entry ids linked to a matched entity, most recent first */
  entryIds: string[];
}

/**
 * Find entities whose name or any alias exactly equals a query token (after
 * diacritic/case folding), then collect recent entries linking to them.
 * Exact token match only — avoids "Mẹ" matching every sentence.
 * When `range` is given, the per-entity recency cap is applied WITHIN the window
 * (so a date-filtered recall doesn't lose in-range entries to out-of-range newer ones).
 */
export function expandByEntity(
  db: Database,
  rawQuery: string,
  range: DateRange | null = null,
  perEntityLimit = 20,
): ExpansionResult {
  const queryTokens = new Set(
    rawQuery
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => fold(t.trim()))
      .filter((t) => t.length > 0),
  );
  if (queryTokens.size === 0) return { entities: [], entryIds: [] };

  const allEntities = db
    .query<{ name: string; type: string; aliases: string }, []>(
      "SELECT name, type, aliases FROM entities",
    )
    .all();

  const matched: EntityMatch[] = [];
  for (const e of allEntities) {
    let aliases: string[] = [];
    try {
      aliases = (JSON.parse(e.aliases) as unknown[]).map(String);
    } catch {
      /* ignore */
    }
    const keys = [e.name, ...aliases].map(fold);
    const hit = keys.some((k) => queryTokens.has(k));
    if (!hit) continue;

    const mentions =
      db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) n FROM links WHERE target = ?",
        )
        .get(e.name)?.n ?? 0;
    matched.push({ name: e.name, type: e.type, aliases, totalMentionsAllTime: mentions });
  }

  // Collect linked entries (recent first), de-duped, capped per entity. The cap
  // is applied within the date window when one is provided.
  const entryIds: string[] = [];
  const seen = new Set<string>();
  for (const e of matched) {
    const rows = range
      ? db
          .query<{ entry_id: string }, [string, string, string, number]>(
            `SELECT l.entry_id FROM links l
             JOIN entries en ON en.id = l.entry_id
             WHERE l.target = ? AND en.date BETWEEN ? AND ?
             ORDER BY en.date DESC, en.ordinal DESC
             LIMIT ?`,
          )
          .all(e.name, range.from, range.to, perEntityLimit)
      : db
          .query<{ entry_id: string }, [string, number]>(
            `SELECT l.entry_id FROM links l
             JOIN entries en ON en.id = l.entry_id
             WHERE l.target = ?
             ORDER BY en.date DESC, en.ordinal DESC
             LIMIT ?`,
          )
          .all(e.name, perEntityLimit);
    for (const r of rows) {
      if (!seen.has(r.entry_id)) {
        seen.add(r.entry_id);
        entryIds.push(r.entry_id);
      }
    }
  }

  return { entities: matched, entryIds };
}
