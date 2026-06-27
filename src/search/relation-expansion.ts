// Relation-aware recall: entries linked to a matched entity via a TYPED emotional
// relation (joy/trigger/with/eases/...) are a stronger signal than a plain mention,
// so they get a larger bonus. Also powers the `--relation <type>` filter.

import { Database } from "bun:sqlite";
import type { DateRange } from "../lib/dates.ts";

/** A relation is a stronger-than-plain link → bonus above ENTITY_BONUS (0.3). */
export const RELATION_BONUS = 0.5;

function dateClause(range: DateRange | null): { sql: string; params: string[] } {
  return range
    ? { sql: " AND e.date BETWEEN ? AND ?", params: [range.from, range.to] }
    : { sql: "", params: [] };
}

/**
 * Entry ids where one of `entityNames` is a relation TARGET. When `relType` is
 * given, restrict to that relation type. De-duped, recency order.
 */
export function expandByRelation(
  db: Database,
  entityNames: string[],
  relType: string | undefined,
  range: DateRange | null,
): string[] {
  if (entityNames.length === 0) return [];
  const dc = dateClause(range);
  const placeholders = entityNames.map(() => "?").join(", ");
  const typeClause = relType ? " AND r.rel_type = ?" : "";
  const rows = db
    .query<{ entry_id: string }, string[]>(
      `SELECT DISTINCT r.entry_id FROM relations r
       JOIN entries e ON e.id = r.entry_id
       WHERE r.target IN (${placeholders})${typeClause}${dc.sql}
       ORDER BY e.date DESC, e.ordinal DESC`,
    )
    .all(...entityNames, ...(relType ? [relType] : []), ...dc.params);
  return rows.map((r) => r.entry_id);
}

/**
 * All entry ids that have a relation of `relType` (no entity restriction).
 * Used by `recall --relation <type>` without `--entity`.
 */
export function entriesWithRelationType(
  db: Database,
  relType: string,
  range: DateRange | null,
): string[] {
  const dc = dateClause(range);
  const rows = db
    .query<{ entry_id: string }, string[]>(
      `SELECT DISTINCT r.entry_id FROM relations r
       JOIN entries e ON e.id = r.entry_id
       WHERE r.rel_type = ?${dc.sql}
       ORDER BY e.date DESC, e.ordinal DESC`,
    )
    .all(relType, ...dc.params);
  return rows.map((r) => r.entry_id);
}
