// `recall --digest` — a compact, deterministic summary for the SessionStart hook
// (target <500 tokens). Pure aggregation over the index; no LLM.

import { Database } from "bun:sqlite";
import type { DateRange } from "../lib/dates.ts";

export interface Digest {
  period: DateRange;
  mood_summary: { distribution: Record<string, number>; avg_intensity: number | null };
  checkin: { days_logged: number; avg_sleep: number | null };
  active_entities: { name: string; mentions: number }[];
  recent_entries: {
    date: string;
    time: string;
    mood: string | null;
    first_line: string; // first non-empty line (≤100 chars) — kept for back-compat
    snippet: string; // richer preview (first ~2 lines, ≤SNIPPET_MAX) so the hook
    // injects usable context in ONE call without a second recall
  }[];
}

// Snippet cap: ~2 lines of content per entry × 5 entries stays within the digest's
// <500-token budget while giving the agent enough to act without re-querying.
const SNIPPET_MAX = 280;

export function buildDigest(db: Database, range: DateRange): Digest {
  const moodRows = db
    .query<{ mood: string; intensity: number | null }, [string, string]>(
      "SELECT mood, intensity FROM entries WHERE date BETWEEN ? AND ? AND mood IS NOT NULL",
    )
    .all(range.from, range.to);

  const distribution: Record<string, number> = {};
  let intSum = 0;
  let intCount = 0;
  for (const r of moodRows) {
    distribution[r.mood] = (distribution[r.mood] ?? 0) + 1;
    if (typeof r.intensity === "number") {
      intSum += r.intensity;
      intCount++;
    }
  }

  const checkin = db
    .query<{ days: number; avg_sleep: number | null }, [string, string]>(
      `SELECT COUNT(*) days, AVG(sleep_hours) avg_sleep
       FROM daily_meta
       WHERE date BETWEEN ? AND ? AND (sleep_hours IS NOT NULL OR exercise IS NOT NULL OR mood_score IS NOT NULL)`,
    )
    .get(range.from, range.to) ?? { days: 0, avg_sleep: null };

  const activeEntities = db
    .query<{ name: string; mentions: number }, [string, string]>(
      `SELECT l.target AS name, COUNT(*) AS mentions
       FROM links l JOIN entries e ON e.id = l.entry_id
       WHERE e.date BETWEEN ? AND ?
       GROUP BY l.target ORDER BY mentions DESC LIMIT 5`,
    )
    .all(range.from, range.to);

  const recent = db
    .query<{ date: string; time: string; mood: string | null; body: string }, [string, string]>(
      `SELECT date, time, mood, body FROM entries
       WHERE date BETWEEN ? AND ?
       ORDER BY date DESC, ordinal DESC LIMIT 5`,
    )
    .all(range.from, range.to);

  return {
    period: range,
    mood_summary: {
      distribution,
      avg_intensity: intCount ? Math.round((intSum / intCount) * 10) / 10 : null,
    },
    checkin: {
      days_logged: checkin.days,
      avg_sleep:
        checkin.avg_sleep != null ? Math.round(checkin.avg_sleep * 10) / 10 : null,
    },
    active_entities: activeEntities,
    recent_entries: recent.map((r) => ({
      date: r.date,
      time: r.time,
      mood: r.mood,
      first_line: firstLine(r.body),
      snippet: snippet(r.body),
    })),
  };
}

/** First non-empty line, truncated for compactness. */
function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 100 ? line.slice(0, 100) + "…" : line;
}

/**
 * A richer preview: the first up-to-2 non-blank lines joined, capped at SNIPPET_MAX.
 * Gives the agent the entry's substance (often on line 2+) without a second recall,
 * while staying inside the digest token budget. Derived from the verbatim body for
 * DISPLAY only — the markdown is never changed.
 */
function snippet(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const text = lines.slice(0, 2).join(" ");
  return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) + "…" : text;
}
