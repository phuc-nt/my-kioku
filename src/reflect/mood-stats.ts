// Mood + health aggregation for reflect. Trend = compare first half vs second
// half of the period (simple, explainable; no fancy regression — KISS).

import { Database } from "bun:sqlite";
import { todayISO, type DateRange } from "../lib/dates.ts";

export interface MoodStats {
  distribution: Record<string, number>;
  avg_intensity: number | null;
  trend: "rising" | "falling" | "flat" | "insufficient_data";
}

export interface HealthStats {
  avg_sleep: number | null;
  exercise_days: number;
  mood_score_trend: "rising" | "falling" | "flat" | "insufficient_data";
}

function midDate(range: DateRange): string {
  const from = new Date(range.from + "T00:00:00");
  const to = new Date(range.to + "T00:00:00");
  const mid = new Date((from.getTime() + to.getTime()) / 2);
  // Use LOCAL Y-M-D (todayISO), not toISOString() — the latter converts to UTC
  // and shifts the mid date by a day in positive-offset zones (e.g. Asia/Saigon),
  // mis-bucketing boundary entries and corrupting the trend split.
  return todayISO(mid);
}

function trendOf(firstAvg: number | null, secondAvg: number | null) {
  if (firstAvg === null || secondAvg === null) return "insufficient_data" as const;
  const diff = secondAvg - firstAvg;
  if (Math.abs(diff) < 0.25) return "flat" as const;
  return diff > 0 ? ("rising" as const) : ("falling" as const);
}

export function buildMoodStats(db: Database, range: DateRange): MoodStats {
  const rows = db
    .query<{ mood: string; intensity: number | null; date: string }, [string, string]>(
      "SELECT mood, intensity, date FROM entries WHERE date BETWEEN ? AND ? AND mood IS NOT NULL",
    )
    .all(range.from, range.to);

  const distribution: Record<string, number> = {};
  let sum = 0;
  let count = 0;
  const mid = midDate(range);
  let firstSum = 0, firstN = 0, secondSum = 0, secondN = 0;

  for (const r of rows) {
    distribution[r.mood] = (distribution[r.mood] ?? 0) + 1;
    if (typeof r.intensity === "number") {
      sum += r.intensity;
      count++;
      if (r.date < mid) {
        firstSum += r.intensity;
        firstN++;
      } else {
        secondSum += r.intensity;
        secondN++;
      }
    }
  }

  return {
    distribution,
    avg_intensity: count ? Math.round((sum / count) * 10) / 10 : null,
    trend: trendOf(
      firstN ? firstSum / firstN : null,
      secondN ? secondSum / secondN : null,
    ),
  };
}

export function buildHealthStats(db: Database, range: DateRange): HealthStats {
  const rows = db
    .query<{ date: string; sleep_hours: number | null; exercise: string | null; mood_score: number | null }, [string, string]>(
      "SELECT date, sleep_hours, exercise, mood_score FROM daily_meta WHERE date BETWEEN ? AND ?",
    )
    .all(range.from, range.to);

  let sleepSum = 0, sleepN = 0, exerciseDays = 0;
  const mid = midDate(range);
  let firstSum = 0, firstN = 0, secondSum = 0, secondN = 0;

  for (const r of rows) {
    if (typeof r.sleep_hours === "number") {
      sleepSum += r.sleep_hours;
      sleepN++;
    }
    if (r.exercise && r.exercise.trim() !== "") exerciseDays++;
    if (typeof r.mood_score === "number") {
      if (r.date < mid) {
        firstSum += r.mood_score;
        firstN++;
      } else {
        secondSum += r.mood_score;
        secondN++;
      }
    }
  }

  return {
    avg_sleep: sleepN ? Math.round((sleepSum / sleepN) * 10) / 10 : null,
    exercise_days: exerciseDays,
    mood_score_trend: trendOf(
      firstN ? firstSum / firstN : null,
      secondN ? secondSum / secondN : null,
    ),
  };
}
