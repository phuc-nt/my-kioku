// Deterministic, read-only detectors over the relations/tags tables — the
// living-loop signals for the cron agent. They COUNT/JOIN only; they never infer
// relations (the agent decides). Every finding cites real entry ids.

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";
import type { DateRange } from "../lib/dates.ts";

// --- Tunable thresholds (named for clarity) ---
export const STRONG_HIGH = 4; // intensity >= this is a strong (positive) mood
export const STRONG_LOW = 2; // intensity <= this is a strong (negative) mood
export const RELATION_SUMMARY_TOP_N = 5; // top targets per joy/trigger
export const TAGS_SURFACED_MAX = 30; // cap on surfaced tags (442-block imports have many)
const TAG_EXAMPLES = 3; // example entry ids per surfaced tag

function firstLine(body: string): string {
  const l = body.split("\n").find((x) => x.trim() !== "") ?? "";
  return l.length > 80 ? l.slice(0, 80) + "…" : l;
}

export const MISSING_RELATIONS_MAX = 50; // cap so a large import doesn't flood actions

export interface MissingRelation {
  entry_id: string;
  intensity: number;
  first_line: string;
}

/**
 * Strong-mood entries (high or low intensity) that have NO relation row.
 * ALL-TIME by design: backfill debt isn't period-bound. Capped so a large
 * import doesn't return hundreds of rows (most-recent first).
 */
export function findMissingRelations(db: Database): MissingRelation[] {
  return db
    .query<{ id: string; intensity: number; body: string }, [number, number, number]>(
      `SELECT e.id, e.intensity, e.body FROM entries e
       LEFT JOIN relations r ON r.entry_id = e.id
       WHERE e.intensity IS NOT NULL AND (e.intensity >= ? OR e.intensity <= ?)
         AND r.entry_id IS NULL
       ORDER BY e.date DESC, e.ordinal DESC
       LIMIT ?`,
    )
    .all(STRONG_HIGH, STRONG_LOW, MISSING_RELATIONS_MAX)
    .map((r) => ({
      entry_id: r.id,
      intensity: r.intensity,
      first_line: firstLine(r.body),
    }));
}

export interface RelationSummary {
  joy: { target: string; count: number }[];
  trigger: { target: string; count: number }[];
}

/**
 * Top joy/trigger targets within the date RANGE (range-scoped: a summary is a
 * snapshot, not all-time debt). Counts are merged across casing/diacritic
 * variants of the same target (folded) so "[[Chạy bộ]]" and "[[chạy bộ]]" count
 * as one pattern, then capped to the top N by count.
 */
export function buildRelationSummary(db: Database, range: DateRange): RelationSummary {
  const top = (relType: string) => {
    const rows = db
      .query<{ target: string; n: number }, [string, string, string]>(
        `SELECT r.target, COUNT(*) n FROM relations r
         JOIN entries e ON e.id = r.entry_id
         WHERE r.rel_type = ? AND e.date BETWEEN ? AND ?
         GROUP BY r.target ORDER BY n DESC`,
      )
      .all(relType, range.from, range.to);

    // Merge variants that fold to the same key; keep the first-seen display form
    // (already in count-desc order, so the dominant spelling wins).
    const merged = new Map<string, { target: string; count: number }>();
    for (const r of rows) {
      const key = fold(r.target);
      const existing = merged.get(key);
      if (existing) existing.count += r.n;
      else merged.set(key, { target: r.target, count: r.n });
    }
    return [...merged.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, RELATION_SUMMARY_TOP_N);
  };
  return { joy: top("joy"), trigger: top("trigger") };
}

export interface UnconvertedTag {
  tag: string;
  count: number;
  examples: string[]; // up to TAG_EXAMPLES entry ids
}

/**
 * Distinct tags NOT yet represented as an entity note (folded comparison) — the
 * agent gradually converts these to wikilinks/relations (the migration living loop).
 * ALL-TIME by design (migration debt isn't period-bound); surfaces the most
 * frequent unconverted tags first, capped at TAGS_SURFACED_MAX.
 */
export function findUnconvertedTags(db: Database): UnconvertedTag[] {
  const entityNames = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM entities")
      .all()
      .map((r) => fold(r.name)),
  );

  const tagRows = db
    .query<{ tag: string; n: number }, []>(
      "SELECT tag, COUNT(*) n FROM tags GROUP BY tag ORDER BY n DESC",
    )
    .all();

  const out: UnconvertedTag[] = [];
  for (const row of tagRows) {
    if (entityNames.has(fold(row.tag))) continue; // already an entity
    const examples = db
      .query<{ entry_id: string }, [string, number]>(
        "SELECT entry_id FROM tags WHERE tag = ? LIMIT ?",
      )
      .all(row.tag, TAG_EXAMPLES)
      .map((r) => r.entry_id);
    out.push({ tag: row.tag, count: row.n, examples });
    if (out.length >= TAGS_SURFACED_MAX) break;
  }
  return out;
}
