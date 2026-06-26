// Date/time helpers in the user's LOCAL timezone. The vault is a personal diary,
// so "today" must mean the user's calendar day, not UTC.

/** Local YYYY-MM-DD for a given date (defaults to now). */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local HH:MM (24h) for a given date (defaults to now). */
export function nowHHMM(d: Date = new Date()): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE = /^(\d+)([dwmy])$/; // 7d, 2w, 3m, 1y

/**
 * Parse a `--since` value into an inclusive date range ending today.
 * Accepts:
 *   - relative spans: "7d", "2w", "3m", "1y"
 *   - an absolute start date: "YYYY-MM-DD" (from that date through today)
 * Returns null when the input is unparseable (caller decides how to fail).
 */
export function parseSince(s: string, now: Date = new Date()): DateRange | null {
  const to = todayISO(now);

  if (ISO_DATE.test(s)) {
    return { from: s, to };
  }

  const rel = RELATIVE.exec(s);
  if (!rel) return null;

  const n = Number(rel[1]);
  const unit = rel[2];
  const start = new Date(now);

  switch (unit) {
    case "d":
      start.setDate(start.getDate() - n);
      break;
    case "w":
      start.setDate(start.getDate() - n * 7);
      break;
    case "m":
      start.setMonth(start.getMonth() - n);
      break;
    case "y":
      start.setFullYear(start.getFullYear() - n);
      break;
    default:
      return null;
  }

  return { from: todayISO(start), to };
}

/** Validate a YYYY-MM-DD string is well-formed and a real calendar date. */
export function isValidISODate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}
