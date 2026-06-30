// Entry-set filter by the TYPE of the entities an entry links. Powers `recall --type`
// (the one place kioku-lite's knowledge-graph won at the Round-5 Phase-C benchmark:
// "list everything of type X"). Read-only; folded join so links↔entities match across
// case/diacritic forms, consistent with entity-expansion / lint-checks.

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";
import { inRange } from "./hydrate.ts";
import type { DateRange } from "../lib/dates.ts";

/**
 * Return the set of entry ids that link at least one entity whose `type` matches
 * `type` (case-insensitive), optionally restricted to a date range. The entities↔links
 * join is FOLDED in TS (SQL `=` is exact; names/targets can differ by form) — mirrors
 * lint-checks/entity-expansion.
 */
export function entriesLinkingTypedEntity(
  db: Database,
  type: string,
  range: DateRange | null,
): Set<string> {
  const want = type.toLowerCase();
  // Folded entity-name → matches the wanted type?
  const typedNames = new Set(
    db
      .query<{ name: string; type: string }, []>("SELECT name, type FROM entities")
      .all()
      .filter((e) => (e.type ?? "").toLowerCase() === want)
      .map((e) => fold(e.name)),
  );
  if (typedNames.size === 0) return new Set();

  const out = new Set<string>();
  for (const l of db
    .query<{ entry_id: string; target: string; date: string }, []>(
      `SELECT l.entry_id AS entry_id, l.target AS target, e.date AS date
       FROM links l JOIN entries e ON e.id = l.entry_id`,
    )
    .all()) {
    if (typedNames.has(fold(l.target)) && inRange(l.date, range)) out.add(l.entry_id);
  }
  return out;
}
