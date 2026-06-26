// Parse a daily-note body into entries. Each entry is a `## HH:MM` section.
// The first non-empty line of an entry MAY be a mood inline field: `mood:: happy/4`.
// Entries with the same time are kept in document order (id ordinal disambiguates).
//
// Verbatim safety: a `## HH:MM` line is treated as an entry heading ONLY when it
// is preceded by a blank line (or starts the body). appendEntry always emits the
// heading after a blank line, so entry PROSE that happens to contain a
// heading-shaped line (e.g. a pasted "## 10:00 standup") is NOT split out — it
// stays inside the entry text, preserving the verbatim contract.

export interface ParsedEntry {
  time: string; // "HH:MM" as written in the heading
  ordinal: number; // 0-based position among all entries in the note
  mood?: string; // emotion word, e.g. "happy"
  intensity?: number; // 1-5 if present
  text: string; // entry body VERBATIM, mood line removed
}

const HEADING_RE = /^##\s+(\d{1,2}:\d{2})\s*$/;
// A mood field is only recognized in a STRICT shape: a single emotion token
// (letters/diacritics/digits/_/-) optionally followed by /intensity. This keeps
// free prose that merely starts with "mood::" from being swallowed as a field.
const MOOD_LINE_RE = /^mood::\s*([\p{L}\p{N}_-]+)(?:\/([0-9]+))?\s*$/u;

export const MIN_INTENSITY = 1;
export const MAX_INTENSITY = 5;

/**
 * Parse a strict `emotion` or `emotion/intensity` mood value.
 * Returns null when the value is not a recognizable mood field (so callers can
 * leave the line in the entry text verbatim). Intensity must be 1..5.
 */
export function parseMoodValue(
  value: string,
): { mood: string; intensity?: number } | null {
  const m = MOOD_LINE_RE.exec(`mood:: ${value}`);
  if (!m) return null;
  const mood = m[1] ?? "";
  if (m[2] === undefined) return { mood };
  const intensity = Number(m[2]);
  if (intensity < MIN_INTENSITY || intensity > MAX_INTENSITY) {
    // Out-of-range intensity → not a valid field; treat as plain text upstream.
    return null;
  }
  return { mood, intensity };
}

/** Split a daily-note body (frontmatter already removed) into entries. */
export function parseEntries(body: string): ParsedEntry[] {
  const lines = body.split("\n");
  const entries: ParsedEntry[] = [];

  let current: { time: string; lines: string[] } | null = null;
  let prevBlank = true; // start-of-body counts as "preceded by blank"

  const flush = (): void => {
    if (!current) return;
    const ordinal = entries.length;
    const { mood, intensity, text } = extractMood(current.lines);
    entries.push({ time: current.time, ordinal, mood, intensity, text });
  };

  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    // Only a heading-shaped line that follows a blank line opens a new entry.
    if (h && prevBlank) {
      flush();
      current = { time: h[1] ?? "", lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first heading (e.g. the `# date` title) are ignored.
    prevBlank = line.trim() === "";
  }
  flush();

  return entries;
}

/** Pull an optional leading mood line out of an entry's raw lines. */
function extractMood(rawLines: string[]): {
  mood?: string;
  intensity?: number;
  text: string;
} {
  const lines = [...rawLines];
  let firstIdx = 0;
  while (firstIdx < lines.length && lines[firstIdx]!.trim() === "") firstIdx++;

  if (firstIdx < lines.length) {
    const raw = lines[firstIdx]!.trim();
    if (raw.startsWith("mood::")) {
      const parsed = parseMoodValue(raw.slice("mood::".length).trim());
      if (parsed) {
        lines.splice(0, firstIdx + 1);
        return { ...parsed, text: trimBlock(lines) };
      }
      // "mood::" prefix but not a strict field → leave line in text verbatim.
    }
  }
  return { text: trimBlock(lines) };
}

/** Trim leading/trailing blank lines but keep internal formatting verbatim. */
function trimBlock(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end).join("\n");
}
