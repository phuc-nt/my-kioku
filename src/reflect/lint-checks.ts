// Deterministic lint checks over the index — surface gaps for the cron agent to
// heal (the "living loop"). Every finding is traceable to a file or entry id.

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";

export interface LintReport {
  unknown_type_entities: { name: string; file: string; mentions: number }[];
  orphan_entities: { name: string; file: string }[];
  broken_wikilinks: { target: string; entry_id: string }[];
  entries_without_links: { entry_id: string; first_line: string }[];
  entries_without_mood: { entry_id: string; first_line: string }[];
  missing_checkin_days: string[];
}

function firstLine(body: string): string {
  const l = body.split("\n").find((x) => x.trim() !== "") ?? "";
  return l.length > 80 ? l.slice(0, 80) + "…" : l;
}

export function runLint(db: Database): LintReport {
  // 1. Entities still classified as type:unknown (need agent classification).
  const unknown = db
    .query<{ name: string; file: string }, []>(
      "SELECT name, file FROM entities WHERE type = 'unknown'",
    )
    .all()
    .map((e) => ({
      ...e,
      mentions:
        db
          .query<{ n: number }, [string]>(
            "SELECT COUNT(*) n FROM links WHERE target = ?",
          )
          .get(e.name)?.n ?? 0,
    }));

  // Entity names, FOLDED, so link↔entity matching is case/diacritic-insensitive
  // (consistent with recall's entity-expansion: [[Mẹ]] resolves to entity `mẹ`).
  // SQL `=` is exact, so we compare folded sets in TS to avoid false orphans/broken.
  const entityNames = db
    .query<{ name: string }, []>("SELECT name FROM entities")
    .all()
    .map((r) => r.name);
  const foldedEntities = new Set(entityNames.map(fold));
  const allLinks = db
    .query<{ target: string; entry_id: string }, []>("SELECT target, entry_id FROM links")
    .all();
  const foldedLinkTargets = new Set(allLinks.map((l) => fold(l.target)));

  // 2. Orphan entities: a note exists but no link resolves to it (folded).
  const orphans = db
    .query<{ name: string; file: string }, []>("SELECT name, file FROM entities")
    .all()
    .filter((e) => !foldedLinkTargets.has(fold(e.name)));

  // 3. Broken wikilinks: a link target with no entity note (folded). De-duped by target.
  const broken: { target: string; entry_id: string }[] = [];
  const seenBroken = new Set<string>();
  for (const l of allLinks) {
    if (foldedEntities.has(fold(l.target))) continue;
    if (seenBroken.has(l.target)) continue;
    seenBroken.add(l.target);
    broken.push({ target: l.target, entry_id: l.entry_id });
  }

  // 4. Entries with no wikilink at all (candidates for agent backfill).
  const noLinks = db
    .query<{ entry_id: string; body: string }, []>(
      `SELECT e.id AS entry_id, e.body FROM entries e
       LEFT JOIN links l ON l.entry_id = e.id
       WHERE l.entry_id IS NULL`,
    )
    .all()
    .map((r) => ({ entry_id: r.entry_id, first_line: firstLine(r.body) }));

  // 5. Entries without a mood field.
  const noMood = db
    .query<{ entry_id: string; body: string }, []>(
      "SELECT id AS entry_id, body FROM entries WHERE mood IS NULL",
    )
    .all()
    .map((r) => ({ entry_id: r.entry_id, first_line: firstLine(r.body) }));

  // 6. Days that have journal entries but no health check-in row.
  const missingCheckin = db
    .query<{ date: string }, []>(
      `SELECT DISTINCT e.date FROM entries e
       LEFT JOIN daily_meta m
         ON m.date = e.date
        AND (m.sleep_hours IS NOT NULL OR m.exercise IS NOT NULL OR m.mood_score IS NOT NULL)
       WHERE m.date IS NULL
       ORDER BY e.date`,
    )
    .all()
    .map((r) => r.date);

  return {
    unknown_type_entities: unknown,
    orphan_entities: orphans,
    broken_wikilinks: broken,
    entries_without_links: noLinks,
    entries_without_mood: noMood,
    missing_checkin_days: missingCheckin,
  };
}
