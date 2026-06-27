// Hydrate a scored entry id into the full recall result row (verbatim body + mood
// + links + relations + tags). relations/tags are ALWAYS present (decision #1) so
// the agent sees a stable schema (empty {} / [] when the entry has none).

import { Database } from "bun:sqlite";
import type { DateRange } from "../lib/dates.ts";

export interface HydratedEntry {
  id: string;
  date: string;
  time: string;
  ordinal: number;
  mood: string | null;
  intensity: number | null;
  body: string;
  links: string[];
  relations: Record<string, string[]>;
  tags: string[];
  score: number;
}

export function hydrate(db: Database, id: string, score: number): HydratedEntry | null {
  const row = db
    .query<
      { id: string; date: string; time: string; ordinal: number; mood: string | null; intensity: number | null; body: string },
      [string]
    >("SELECT id, date, time, ordinal, mood, intensity, body FROM entries WHERE id = ?")
    .get(id);
  if (!row) return null;

  const links = db
    .query<{ target: string }, [string]>("SELECT target FROM links WHERE entry_id = ?")
    .all(id)
    .map((r) => r.target);

  const relations: Record<string, string[]> = {};
  for (const r of db
    .query<{ rel_type: string; target: string }, [string]>(
      "SELECT rel_type, target FROM relations WHERE entry_id = ?",
    )
    .all(id)) {
    (relations[r.rel_type] ??= []).push(r.target);
  }

  const tags = db
    .query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE entry_id = ?")
    .all(id)
    .map((r) => r.tag);

  return { ...row, links, relations, tags, score: Math.round(score * 1000) / 1000 };
}

/** Inclusive date-window check (null range = no filter). */
export function inRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  return date >= range.from && date <= range.to;
}

/** Recency tiebreak: newer date first, then higher ordinal first. */
export function cmpRecency(a: HydratedEntry, b: HydratedEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.ordinal - a.ordinal;
}
