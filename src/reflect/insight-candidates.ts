// Insight candidate detectors over the index. Each returns evidence (entry ids /
// dates) so the agent can verify before writing an insight note. Thresholds are
// NAMED CONSTANTS (validation decision #4) — tune later against real data.
// These are SUGGESTIONS; the agent decides whether to act.

import { Database } from "bun:sqlite";
import type { DateRange } from "../lib/dates.ts";

// --- Tunable thresholds (named for clarity; adjust with real data) ---
export const MOOD_STREAK_MIN_DAYS = 4; // consecutive declining-intensity days
export const CO_OCCURRENCE_MIN = 4; // times two entities appear together
export const ENTITY_SPIKE_FACTOR = 3; // period mentions vs baseline multiple
export const ENTITY_SPIKE_MIN = 4; // min mentions to count as a spike
export const SILENCE_MIN_DAYS = 60; // days absent to flag a "silence"

export interface InsightCandidate {
  kind: "mood_streak" | "co_occurrence" | "entity_spike" | "silence";
  detail: string;
  evidence: string[];
}

export function detectInsights(db: Database, range: DateRange): InsightCandidate[] {
  return [
    ...detectMoodStreak(db, range),
    ...detectCoOccurrence(db, range),
    ...detectEntitySpike(db, range),
    ...detectSilence(db, range),
  ];
}

/** Consecutive days where average intensity declines for >= MIN_DAYS. */
function detectMoodStreak(db: Database, range: DateRange): InsightCandidate[] {
  const days = db
    .query<{ date: string; avg_int: number }, [string, string]>(
      `SELECT date, AVG(intensity) avg_int FROM entries
       WHERE date BETWEEN ? AND ? AND intensity IS NOT NULL
       GROUP BY date ORDER BY date`,
    )
    .all(range.from, range.to);

  // Only extend a streak across CALENDAR-ADJACENT recorded days, so a gap (a day
  // with no intensity logged) breaks the "N days in a row" claim honestly.
  let streak: { date: string; avg_int: number }[] = [];
  let best: typeof streak = [];
  for (let i = 0; i < days.length; i++) {
    const declined = i > 0 && days[i]!.avg_int < days[i - 1]!.avg_int;
    const adjacent = i > 0 && isNextDay(days[i - 1]!.date, days[i]!.date);
    if (declined && adjacent) {
      if (streak.length === 0) streak = [days[i - 1]!];
      streak.push(days[i]!);
    } else {
      if (streak.length > best.length) best = streak;
      streak = [];
    }
  }
  if (streak.length > best.length) best = streak;

  if (best.length >= MOOD_STREAK_MIN_DAYS) {
    return [
      {
        kind: "mood_streak",
        detail: `Intensity declined ${best.length} days in a row (${best[0]!.date} → ${best[best.length - 1]!.date}).`,
        evidence: best.map((d) => d.date),
      },
    ];
  }
  return [];
}

/** Pairs of entities co-occurring in the same entry >= CO_OCCURRENCE_MIN times. */
function detectCoOccurrence(db: Database, range: DateRange): InsightCandidate[] {
  const pairs = db
    .query<{ a: string; b: string; n: number }, [string, string]>(
      `SELECT l1.target a, l2.target b, COUNT(*) n
       FROM links l1
       JOIN links l2 ON l1.entry_id = l2.entry_id AND l1.target < l2.target
       JOIN entries e ON e.id = l1.entry_id
       WHERE e.date BETWEEN ? AND ?
       GROUP BY l1.target, l2.target
       HAVING n >= ${CO_OCCURRENCE_MIN}
       ORDER BY n DESC`,
    )
    .all(range.from, range.to);

  return pairs.map((p) => ({
    kind: "co_occurrence" as const,
    detail: `[[${p.a}]] and [[${p.b}]] appeared together ${p.n} times.`,
    evidence: linkEntryIds(db, p.a, p.b, range),
  }));
}

function linkEntryIds(db: Database, a: string, b: string, range: DateRange): string[] {
  return db
    .query<{ entry_id: string }, [string, string, string, string]>(
      `SELECT l1.entry_id FROM links l1
       JOIN links l2 ON l1.entry_id = l2.entry_id
       JOIN entries e ON e.id = l1.entry_id
       WHERE l1.target = ? AND l2.target = ? AND e.date BETWEEN ? AND ?`,
    )
    .all(a, b, range.from, range.to)
    .map((r) => r.entry_id);
}

/** Entities mentioned >= FACTOR× their PRIOR per-active-day baseline. */
function detectEntitySpike(db: Database, range: DateRange): InsightCandidate[] {
  const rows = db
    .query<{ target: string; period_n: number; total_n: number }, [string, string]>(
      `SELECT target,
              SUM(CASE WHEN e.date BETWEEN ? AND ? THEN 1 ELSE 0 END) period_n,
              COUNT(*) total_n
       FROM links l JOIN entries e ON e.id = l.entry_id
       GROUP BY target`,
    )
    .all(range.from, range.to);

  const out: InsightCandidate[] = [];
  for (const r of rows) {
    if (r.period_n < ENTITY_SPIKE_MIN) continue;
    // Count-based comparison against PRIOR mentions (outside the period). Robust
    // on sparse vaults where per-day rates with tiny denominators are too noisy.
    // Skip first-ever bursts (no prior history to be "above").
    const baseN = r.total_n - r.period_n;
    if (baseN === 0) continue;
    if (r.period_n >= baseN * ENTITY_SPIKE_FACTOR) {
      out.push({
        kind: "entity_spike",
        detail: `[[${r.target}]] mentioned ${r.period_n}× this period vs ${baseN}× before (spike).`,
        evidence: entryIdsForEntity(db, r.target, range),
      });
    }
  }
  return out;
}

/** Entities mentioned >= 3× ever but absent for >= SILENCE_MIN_DAYS. */
function detectSilence(db: Database, range: DateRange): InsightCandidate[] {
  const rows = db
    .query<{ target: string; last_date: string; n: number }, []>(
      `SELECT l.target, MAX(e.date) last_date, COUNT(*) n
       FROM links l JOIN entries e ON e.id = l.entry_id
       GROUP BY l.target HAVING n >= 3`,
    )
    .all();

  const to = new Date(range.to + "T00:00:00").getTime();
  const out: InsightCandidate[] = [];
  for (const r of rows) {
    const last = new Date(r.last_date + "T00:00:00").getTime();
    const gapDays = Math.floor((to - last) / 86_400_000);
    if (gapDays >= SILENCE_MIN_DAYS) {
      out.push({
        kind: "silence",
        // "previously frequent" — n>=3 lifetime, not a strict cadence check.
        detail: `[[${r.target}]] (frequent before) not mentioned for ${gapDays} days; last on ${r.last_date}.`,
        // Evidence = the most recent entries that DID mention it (verifiable).
        evidence: db
          .query<{ entry_id: string }, [string]>(
            `SELECT l.entry_id FROM links l JOIN entries e ON e.id = l.entry_id
             WHERE l.target = ? ORDER BY e.date DESC, e.ordinal DESC LIMIT 3`,
          )
          .all(r.target)
          .map((x) => x.entry_id),
      });
    }
  }
  return out;
}

/** Entry ids that mention an entity within the date window (spike evidence). */
function entryIdsForEntity(db: Database, target: string, range: DateRange): string[] {
  return db
    .query<{ entry_id: string }, [string, string, string]>(
      `SELECT l.entry_id FROM links l JOIN entries e ON e.id = l.entry_id
       WHERE l.target = ? AND e.date BETWEEN ? AND ?
       ORDER BY e.date DESC, e.ordinal DESC`,
    )
    .all(target, range.from, range.to)
    .map((r) => r.entry_id);
}

/** True if `b` is the calendar day immediately after `a` (both YYYY-MM-DD). */
function isNextDay(a: string, b: string): boolean {
  const da = new Date(a + "T00:00:00").getTime();
  const db2 = new Date(b + "T00:00:00").getTime();
  return Math.round((db2 - da) / 86_400_000) === 1;
}

