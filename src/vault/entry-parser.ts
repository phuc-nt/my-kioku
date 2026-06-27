// Parse a daily-note body into entries. Each entry is a `## HH:MM` section.
// The first non-empty line of an entry MAY be a mood inline field: `mood:: happy/4`.
// Entries with the same time are kept in document order (id ordinal disambiguates).
//
// Verbatim safety: a `## HH:MM` line is treated as an entry heading ONLY when it
// is preceded by a blank line (or starts the body). appendEntry always emits the
// heading after a blank line, so entry PROSE that happens to contain a
// heading-shaped line (e.g. a pasted "## 10:00 standup") is NOT split out — it
// stays inside the entry text, preserving the verbatim contract.

import { parseRelationLine, parseTagsLine } from "./inline-field-parser.ts";

export interface ParsedEntry {
  time: string; // "HH:MM" as written in the heading
  ordinal: number; // 0-based position among all entries in the note
  mood?: string; // emotion word, e.g. "happy"
  intensity?: number; // 1-5 if present
  // Typed emotional edges: verb → wikilink targets, e.g. { joy: ["Chạy bộ"] }.
  // Omitted entirely when the entry has no relation lines.
  relations?: Record<string, string[]>;
  // Plain string tags (NOT wikilinks). Omitted when absent.
  tags?: string[];
  text: string; // entry body VERBATIM, leading field lines removed
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
  // Normalize CRLF so a Windows/Telegram-sourced note can't leave stray \r in
  // entry text (the field matchers trim per-line, but the body would keep them).
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const entries: ParsedEntry[] = [];

  let current: { time: string; lines: string[] } | null = null;
  let prevBlank = true; // start-of-body counts as "preceded by blank"

  const flush = (): void => {
    if (!current) return;
    const ordinal = entries.length;
    const fields = extractLeadingFields(current.lines);
    entries.push({ time: current.time, ordinal, ...fields });
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

interface LeadingFields {
  mood?: string;
  intensity?: number;
  relations?: Record<string, string[]>;
  tags?: string[];
  text: string;
}

/**
 * Consume the contiguous run of recognized field lines at the top of an entry
 * (mood / relations / tags), in any order, stopping at the FIRST line that is not
 * a recognized field. Everything from there on is the verbatim body — even if a
 * later line happens to look field-shaped.
 */
function extractLeadingFields(rawLines: string[]): LeadingFields {
  const lines = [...rawLines];
  // Skip leading blank lines (the field zone starts at the first content line).
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;

  let mood: string | undefined;
  let intensity: number | undefined;
  const relations: Record<string, string[]> = {};
  let tags: string[] | undefined;

  for (; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === "") break; // a blank line ends the field zone

    // mood:: (only once; a second mood line is treated as body)
    if (mood === undefined && raw.startsWith("mood::")) {
      const m = parseMoodValue(raw.slice("mood::".length).trim());
      if (m) {
        mood = m.mood;
        intensity = m.intensity;
        continue;
      }
      break; // mood:: prefix but not a strict field → verbatim
    }

    // tags:: (de-dup + order-preserve, consistent with relations below)
    const t = parseTagsLine(raw);
    if (t) {
      tags ??= [];
      for (const tag of t) if (!tags.includes(tag)) tags.push(tag);
      continue;
    }

    // <verb>:: [[...]]
    const rel = parseRelationLine(raw);
    if (rel) {
      const bucket = (relations[rel.verb] ??= []);
      for (const target of rel.targets) {
        if (!bucket.includes(target)) bucket.push(target);
      }
      continue;
    }

    break; // first non-field line → body begins here
  }

  const text = trimBlock(lines.slice(i));
  const out: LeadingFields = { text };
  if (mood !== undefined) out.mood = mood;
  if (intensity !== undefined) out.intensity = intensity;
  if (Object.keys(relations).length > 0) out.relations = relations;
  if (tags && tags.length > 0) out.tags = tags;
  return out;
}

/** Trim leading/trailing blank lines but keep internal formatting verbatim. */
function trimBlock(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end).join("\n");
}
