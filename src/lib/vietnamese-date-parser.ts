// Infer an event-date from a Vietnamese diary entry's text, for `remember` when no
// explicit --date is passed. A cheap LLM agent won't reliably pass --date (Round 5:
// minimax-m3 read the rule 73× and still didn't), so the ENGINE infers it.
//
// SAFETY CONTRACT (the whole point — a wrong date silently corrupts the timeline):
//  - Only return a date on a CONFIDENT, unambiguous match; vague phrases → null.
//  - A bare "d/m" is a date ONLY with date-y context ("hôm"/"ngày"), never on its own
//    (so "3/4 cốc cà phê", "tỉ số 2/1" are NOT dates).
//  - NEVER mutate the text — this only reads it.
//  - Validate every candidate via isValidISODate before returning.
// Prefer a false-NEGATIVE (keep today) over a wrong date.

import { todayISO, isValidISODate } from "./dates.ts";

export interface InferredDate {
  date: string; // YYYY-MM-DD
  phrase: string; // the matched source phrase (for date_inferred_from)
  yearGuessed: boolean; // true when a year-less d/m had its year inferred
}

/** Build a local-tz ISO date from y/m/d, or null if not a real calendar date. */
function isoFrom(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(s) ? s : null;
}

/** Shift a Date by whole days (local), return ISO. */
function shiftDays(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/**
 * Try to infer an event-date from `text`. Returns null when there is no confident
 * match (caller keeps todayISO()). `now` is injectable for testing.
 */
export function inferEventDate(text: string, now: Date = new Date()): InferredDate | null {
  const t = text.normalize("NFC");
  const lower = t.toLowerCase();

  // --- 1. Absolute date WITH a year: d/m/yyyy or d-m-yyyy (most explicit) ---
  const full = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(t);
  if (full) {
    const iso = isoFrom(Number(full[3]), Number(full[2]), Number(full[1]));
    if (iso) return { date: iso, phrase: full[0], yearGuessed: false };
  }

  // --- 2. "ngày 12 tháng 4 [năm 2026]" (worded) ---
  const worded = /\bngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?\b/.exec(lower);
  if (worded) {
    const day = Number(worded[1]);
    const mon = Number(worded[2]);
    if (worded[3]) {
      const iso = isoFrom(Number(worded[3]), mon, day);
      if (iso) return { date: iso, phrase: worded[0], yearGuessed: false };
    } else {
      const g = guessYearless(now, mon, day);
      if (g) return { date: g, phrase: worded[0], yearGuessed: true };
    }
  }

  // --- 3. Bare "d/m" (no year) ONLY with date-y context: "hôm 12/4", "ngày 12/4" ---
  // The context word is REQUIRED — a standalone "3/4" is treated as a quantity/score,
  // never a date (false-positive guard).
  const ctx = /\b(?:hôm|ngày)\s+(\d{1,2})[/](\d{1,2})\b(?!\s*[/-]?\d)/.exec(lower);
  if (ctx) {
    const g = guessYearless(now, Number(ctx[2]), Number(ctx[1]));
    if (g) return { date: g, phrase: ctx[0], yearGuessed: true };
  }

  // --- 4. Relative day words ---
  if (/\bhôm\s+qua\b/.test(lower)) return rel(now, -1, "hôm qua");
  if (/\bhôm\s+kia\b/.test(lower)) return rel(now, -2, "hôm kia");

  // --- 5. Specific weekday / weekend (MUST come before the bare "tuần trước",
  // since "cuối tuần trước" and "thứ 2 tuần trước" both CONTAIN "tuần trước"). ---

  // "thứ N vừa rồi" / "thứ N tuần trước" / "chủ nhật …" → most recent past weekday.
  // VI weekday: "thứ 2".."thứ 7" = Mon..Sat → JS getDay() (N-1); "chủ nhật" = Sun(0).
  // Only the "vừa rồi"/"tuần trước" form (clearly past); a bare "thứ 7" is ambiguous → skip.
  const wd = /\b(?:thứ\s+([2-7])|chủ\s+nhật)\s+(?:vừa\s+rồi|tuần\s+trước)\b/.exec(lower);
  if (wd) {
    const target = wd[1] ? Number(wd[1]) - 1 : 0; // "thứ 2"→1(Mon) … "thứ 7"→6(Sat); CN→0
    return { date: lastWeekday(now, target), phrase: wd[0], yearGuessed: false };
  }

  // "cuối tuần (trước)" → Saturday of last week. "cuối tuần" alone is treated as last
  // weekend too (a diary entry written about the weekend refers to the past one).
  if (/\bcuối\s+tuần(?:\s+trước)?\b/.test(lower)) {
    return { date: lastWeekday(now, 6), phrase: matchPhrase(lower, /cuối\s+tuần(?:\s+trước)?/), yearGuessed: false };
  }

  // --- 6. Bare relative week / month (after the specific weekday forms above) ---
  if (/\btuần\s+trước\b/.test(lower)) return rel(now, -7, "tuần trước");
  if (/\btháng\s+trước\b/.test(lower)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return { date: todayISO(d), phrase: "tháng trước", yearGuessed: false };
  }

  return null;
}

function rel(now: Date, days: number, phrase: string): InferredDate {
  return { date: shiftDays(now, days), phrase, yearGuessed: false };
}

/** Year-less d/m → nearest year ≤ today (roll back one year if it'd be in the future). */
function guessYearless(now: Date, mon: number, day: number): string | null {
  const y = now.getFullYear();
  let iso = isoFrom(y, mon, day);
  if (!iso) return null;
  if (iso > todayISO(now)) {
    iso = isoFrom(y - 1, mon, day);
  }
  return iso;
}

/**
 * Most recent PAST date whose weekday == target (0=Sun..6=Sat). If today IS that
 * weekday, go back a full week (a past reference, not today).
 */
function lastWeekday(now: Date, target: number): string {
  const d = new Date(now);
  let delta = (d.getDay() - target + 7) % 7;
  if (delta === 0) delta = 7;
  d.setDate(d.getDate() - delta);
  return todayISO(d);
}

/** Extract the exact matched substring (for the phrase field). */
function matchPhrase(s: string, re: RegExp): string {
  return re.exec(s)?.[0] ?? "";
}
