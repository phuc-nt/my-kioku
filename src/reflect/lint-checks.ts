// Deterministic lint checks over the index — surface gaps for the cron agent to
// heal (the "living loop"). Every finding is traceable to a file or entry id.

import { Database } from "bun:sqlite";

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

  // 2. Orphan entities: a note exists but nothing links to it.
  const orphans = db
    .query<{ name: string; file: string }, []>(
      `SELECT e.name, e.file FROM entities e
       LEFT JOIN links l ON l.target = e.name
       WHERE l.target IS NULL`,
    )
    .all();

  // 3. Broken wikilinks: a link target with no matching entity note.
  const broken = db
    .query<{ target: string; entry_id: string }, []>(
      `SELECT DISTINCT l.target, l.entry_id FROM links l
       LEFT JOIN entities e ON e.name = l.target
       WHERE e.name IS NULL`,
    )
    .all();

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
