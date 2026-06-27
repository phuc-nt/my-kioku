// Pure parsers for the kioku-lite / Telegram-backup markdown format. Extracted
// from the import command so both stay < 200 LOC and the parser is unit-testable.
//
// Format (verified against real data): a file opens with `# Kioku — DATE` or
// `# Kioku Lite — DATE`, then blocks of `---\n<yaml>\n---\n<text>`. The yaml has
// `time`, `mood`, optional `event_time`, and an optional Python-list `tags:`.

import { createHash } from "node:crypto";

export interface Block {
  time?: string; // ISO timestamp from `time:`
  mood?: string;
  eventTime?: string; // optional date-only override
  tags?: string[]; // from a Python-list `tags: ['a','b']` line
  text: string;
}

// A block opens with a `---` fence line IMMEDIATELY followed by a known yaml key.
// Anchoring on this (not a bare `---`) means a stray `---` horizontal rule inside
// diary text can NOT desync the block boundaries — it stays part of the text.
const BLOCK_HEADER = /(?:^|\n)---\n(?=(?:time|mood|event_time|tags):)/g;

/** Parse one kioku-lite markdown file into blocks. Lenient: skip bad blocks. */
export function parseKiokuLiteFile(raw: string): { blocks: Block[]; skipped: number } {
  // Normalize CRLF first so all the \n-based regexes work on Windows files.
  const normalized = raw.replace(/\r\n/g, "\n");
  // Drop the leading "# Kioku — ..." / "# Kioku Lite — ..." heading line if present.
  const body = normalized.replace(/^#[^\n]*\n/, "");

  // Find every block-header position; the block's content runs to the next header.
  const headers: number[] = [];
  let m: RegExpExecArray | null;
  BLOCK_HEADER.lastIndex = 0;
  while ((m = BLOCK_HEADER.exec(body)) !== null) {
    headers.push(m.index + (body[m.index] === "\n" ? 1 : 0));
  }

  const blocks: Block[] = [];
  let skipped = 0;

  for (let h = 0; h < headers.length; h++) {
    const start = headers[h]!;
    const end = h + 1 < headers.length ? headers[h + 1]! : body.length;
    const chunk = body.slice(start, end); // "---\n<yaml>\n---\n<text>"
    const afterOpen = chunk.replace(/^---\n/, "");
    const closeIdx = afterOpen.indexOf("\n---\n");
    if (closeIdx < 0) {
      skipped++;
      continue;
    }
    const yaml = afterOpen.slice(0, closeIdx);
    const text = afterOpen.slice(closeIdx + "\n---\n".length).replace(/\s+$/, "");
    const meta = parseMiniYaml(yaml);
    if (!meta.time && !meta.mood && !meta.event_time) {
      skipped++;
      continue;
    }
    if (text.trim() === "") {
      skipped++;
      continue;
    }
    const block: Block = {
      time: meta.time,
      mood: meta.mood,
      eventTime: meta.event_time,
      text,
    };
    const tags = parseTagList(yaml);
    if (tags.length > 0) block.tags = tags;
    blocks.push(block);
  }
  return { blocks, skipped };
}

/** Parse the tiny known YAML subset (time/mood/event_time, quoted values). */
export function parseMiniYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = /^(time|mood|event_time):\s*"?([^"]*)"?\s*$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * Parse a Python-list `tags: ['career', "japan", ...]` line into plain strings.
 * NOT JSON/YAML — single-quoted items, lenient. Returns [] when no tags line.
 */
export function parseTagList(yaml: string): string[] {
  for (const line of yaml.split("\n")) {
    const m = /^tags:\s*\[(.*)\]\s*$/.exec(line.trim());
    if (!m) continue;
    return m[1]!
      .split(",")
      .map((t) => t.trim().replace(/^['"]|['"]$/g, "").trim())
      .filter((t) => t.length > 0);
  }
  return [];
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * date = a FULL event_time date if present, else the date-part of `time`.
 * Real data has partial event_times ("2020", "2025-02", even "lớp 2") — those
 * are NOT valid days, so we fall back to the processing timestamp's date rather
 * than dropping the memory (event_time is enrichment, not a requirement).
 * HH:MM always comes from `time`.
 */
export function resolveDateTime(b: Block): { date: string; time: string } | null {
  const fromTime = b.time?.slice(0, 10);
  const eventDate = b.eventTime?.slice(0, 10);
  const date =
    eventDate && FULL_DATE.test(eventDate)
      ? eventDate
      : fromTime && FULL_DATE.test(fromTime)
        ? fromTime
        : undefined;
  if (!date) return null; // no usable date anywhere → genuinely unparseable
  let time = "00:00";
  if (b.time) {
    const tm = /T(\d{2}:\d{2})/.exec(b.time);
    if (tm) time = tm[1]!;
  }
  return { date, time };
}

/** Stable content hash of the ORIGINAL block text — drives idempotent dedup. */
export function hashBlock(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}
