// Read/write daily notes. The daily note is the primary container: frontmatter
// holds health check-ins, the body holds `## HH:MM` entry sections.
// Append uses appendFileSync (not atomic temp+rename) — append is safe even if
// the file is open in Obsidian, and we never rewrite existing entries.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { dailyNotePath } from "./vault-paths.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { parseEntries, type ParsedEntry } from "./entry-parser.ts";

export interface AppendResult {
  ordinal: number; // position of the new entry among all entries
  entryId: string; // "{date}#{ordinal}"
  // The entry as the INDEXER will parse it (relations/tags stripped from body).
  // Single source of truth — callers must not re-parse the text themselves
  // (re-parsing without the mood line caused a relation parse-drift bug).
  entry: ParsedEntry;
}

/** Ensure the journal/YYYY/MM folder exists and the file has a `# date` title. */
function ensureDailyFile(vault: string, dateISO: string): string {
  const path = dailyNotePath(vault, dateISO);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# ${dateISO}\n`, "utf8");
  }
  return path;
}

/**
 * Append an entry section to a daily note. Creates the file/folders if missing.
 * Text is written verbatim (trailing whitespace trimmed only).
 */
export function appendEntry(
  vault: string,
  dateISO: string,
  time: string,
  text: string,
  mood?: string,
  intensity?: number,
): AppendResult {
  const path = ensureDailyFile(vault, dateISO);

  // Build the section. Mood line (if any) is the first line of the entry.
  // An empty/whitespace mood is treated as absent (avoids a malformed `mood:: /3`).
  const hasMood = mood !== undefined && mood.trim() !== "";
  const moodLine = hasMood
    ? `mood:: ${mood!.trim()}${intensity !== undefined ? `/${intensity}` : ""}\n`
    : "";
  // Strip LEADING blank lines too: they are not meaningful body content, and a
  // leading blank between the mood line and a relation/tags field line would end
  // the parser's leading-field zone, misfiling the relation as body text. The
  // verbatim body starts at the first non-blank line.
  const cleanText = text.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
  const section = `\n## ${time}\n${moodLine}${cleanText}\n`;

  appendFileSync(path, section, "utf8");

  // Re-read the note so we return the entry exactly as the indexer will parse it.
  const entries = readDaily(vault, dateISO).entries;
  const ordinal = entries.length - 1;
  const entry = entries[ordinal]!;
  return { ordinal, entryId: `${dateISO}#${ordinal}`, entry };
}

export interface DailyNote {
  date: string;
  exists: boolean;
  meta: Record<string, unknown>;
  entries: ParsedEntry[];
}

/** Read and parse a daily note. Returns empty structure if it does not exist. */
export function readDaily(vault: string, dateISO: string): DailyNote {
  const path = dailyNotePath(vault, dateISO);
  if (!existsSync(path)) {
    return { date: dateISO, exists: false, meta: {}, entries: [] };
  }
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return { date: dateISO, exists: true, meta, entries: parseEntries(body) };
}

/**
 * Merge check-in fields into a daily note's frontmatter without touching the body.
 * Creates the file if missing.
 */
export function setCheckinMeta(
  vault: string,
  dateISO: string,
  fields: Record<string, unknown>,
): void {
  const path = ensureDailyFile(vault, dateISO);
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const merged = { ...meta, ...fields };
  writeFileSync(path, serializeFrontmatter(merged, body), "utf8");
}
