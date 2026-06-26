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
  const cleanText = text.replace(/\s+$/, "");
  const section = `\n## ${time}\n${moodLine}${cleanText}\n`;

  appendFileSync(path, section, "utf8");

  const ordinal = readDaily(vault, dateISO).entries.length - 1;
  return { ordinal, entryId: `${dateISO}#${ordinal}` };
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
