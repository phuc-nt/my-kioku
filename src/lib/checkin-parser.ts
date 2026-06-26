// Parse a `--checkin` argument: comma-separated key=value pairs, where values
// may be quoted to contain spaces or commas. Known numeric keys are coerced.
//   sleep_hours=7,exercise="run 5km",mood_score=4

const KNOWN_NUMBERS = new Set(["sleep_hours", "mood_score"]);

/**
 * Split on commas that are NOT inside quotes, so `exercise="run 5km, then yoga"`
 * stays one segment. Quote characters are kept in the segment here; only a
 * balanced WRAPPING pair is stripped later (inner quotes stay literal).
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

/** Strip a single balanced wrapping quote pair, leaving inner quotes literal. */
function unwrapQuotes(value: string): string {
  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export interface CheckinResult {
  fields: Record<string, string | number>;
  warnings: string[];
}

/** Parse the check-in string into typed fields. */
export function parseCheckin(input: string): CheckinResult {
  const fields: Record<string, string | number> = {};
  const warnings: string[] = [];

  for (const raw of splitTopLevel(input)) {
    const segment = raw.trim();
    if (segment === "") continue;
    const eq = segment.indexOf("=");
    if (eq < 0) {
      warnings.push(`Ignored malformed check-in segment (no '='): "${segment}"`);
      continue;
    }
    const key = segment.slice(0, eq).trim();
    const value = unwrapQuotes(segment.slice(eq + 1).trim());
    if (!key) {
      warnings.push(`Ignored check-in segment with empty key: "${segment}"`);
      continue;
    }
    if (value === "") {
      warnings.push(`Ignored check-in "${key}" with empty value`);
      continue;
    }
    if (KNOWN_NUMBERS.has(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        fields[key] = n;
      } else {
        warnings.push(`Check-in "${key}" expected a number, got "${value}" — stored as text`);
        fields[key] = value;
      }
    } else {
      fields[key] = value;
    }
  }

  return { fields, warnings };
}
