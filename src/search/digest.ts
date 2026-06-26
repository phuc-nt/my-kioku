// `recall --digest` — a compact, deterministic summary for the SessionStart hook
// (target <500 tokens). Pure aggregation over the index; no LLM.

import { Database } from "bun:sqlite";
import type { DateRange } from "../lib/dates.ts";

export interface Digest {
  period: DateRange;
  mood_summary: { distribution: Record<string, number>; avg_intensity: number | null };
  checkin: { days_logged: number; avg_sleep: number | null };
  active_entities: { name: string; mentions: number }[];
  recent_entries: { date: string; time: string; mood: string | null; first_line: string }[];
}

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
    })),
  };
}

/** First non-empty line, truncated for compactness. */
function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 100 ? line.slice(0, 100) + "…" : line;
}
