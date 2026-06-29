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
import { entryRanges } from "./entry-block-range.ts";

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
  // Latest-fact flag: the id ("date#ordinal") of a newer entry that replaces this
  // one, from a strict `superseded:: <date#ordinal>` leading field. Omitted when absent.
  superseded?: string;
  text: string; // entry body VERBATIM, leading field lines removed
}

// A mood field is only recognized in a STRICT shape: a single emotion token
// (letters/diacritics/digits/_/-) optionally followed by /intensity. This keeps
// free prose that merely starts with "mood::" from being swallowed as a field.
const MOOD_LINE_RE = /^mood::\s*([\p{L}\p{N}_-]+)(?:\/([0-9]+))?\s*$/u;
// A superseded field is only recognized in a STRICT `date#ordinal` shape, so a
// user-typed `superseded:: whatever` stays verbatim in the body (never silently eaten).
const SUPERSEDED_LINE_RE = /^superseded::\s*(\d{4}-\d{2}-\d{2}#\d+)\s*$/;

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
  // NFC first: MOOD_LINE_RE uses \p{L}; a decomposed VI emotion ("khỏe") would have
  // a combining mark that is not a letter, failing the capture and silently dropping
  // the mood. Canonicalizing recombines the syllable.
  const m = MOOD_LINE_RE.exec(`mood:: ${value.normalize("NFC")}`);
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
  // Block boundaries come from the SHARED helper so the heading rule lives in one
  // place (entry-block-range.ts) — forget reuses the exact same ranges for byte-
  // accurate deletes, so reading and editing can never disagree.
  return entryRanges(lines).map((r) => {
    const fields = extractLeadingFields(lines.slice(r.startLine, r.endLine + 1));
    return { time: r.time, ordinal: r.ordinal, ...fields };
  });
}

interface LeadingFields {
  mood?: string;
  intensity?: number;
  relations?: Record<string, string[]>;
  tags?: string[];
  superseded?: string;
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
  let mood: string | undefined;
  let intensity: number | undefined;
  const relations: Record<string, string[]> = {};
  let tags: string[] | undefined;
  let superseded: string | undefined;

  // Skip leading blank lines (the field zone starts at the first content line).
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;

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

    // superseded:: <date#ordinal> (only once; strict shape or it falls to body)
    if (superseded === undefined && raw.startsWith("superseded::")) {
      const s = SUPERSEDED_LINE_RE.exec(raw);
      if (s) {
        superseded = s[1]!;
        continue;
      }
      break; // superseded:: prefix but not a strict id → verbatim
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
  if (superseded !== undefined) out.superseded = superseded;
  return out;
}

/**
 * Count the lines at the top of an entry block (after the `## HH:MM` heading) that
 * are the leading STRUCTURED fields — i.e. how many lines to KEEP when redacting so
 * the heading + mood/relations/tags survive and only the verbatim body is blanked.
 * Uses the SAME field-recognition rule as `extractLeadingFields` (DRY): a leading
 * blank run, then the contiguous recognized-field lines, up to the first body line.
 */
export function extractLeadingFieldCount(blockBodyLines: string[]): number {
  let i = 0;
  while (i < blockBodyLines.length && blockBodyLines[i]!.trim() === "") i++;
  for (; i < blockBodyLines.length; i++) {
    const raw = blockBodyLines[i]!.trim();
    if (raw === "") break;
    if (raw.startsWith("mood::") && parseMoodValue(raw.slice("mood::".length).trim())) continue;
    if (SUPERSEDED_LINE_RE.test(raw)) continue;
    if (parseTagsLine(raw)) continue;
    if (parseRelationLine(raw)) continue;
    break; // first non-field line → body begins
  }
  return i;
}

/** Trim leading/trailing blank lines but keep internal formatting verbatim. */
function trimBlock(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end).join("\n");
}
