// `my-kioku import --from-kioku-lite <folder>` — migrate legacy kioku-lite
// memories. Source is a FOLDER of markdown files (validation decision), NOT the
// SQLite DB. Each file holds blocks: `---\n<yaml>\n---\n<text>` after a heading.
//
// Decisions baked in (validation session 1):
//   - text imported VERBATIM, with NO wikilinks (KG is backfilled later by the
//     agent via reflect lint — entries_without_links will surface them).
//   - date = event_time (if present) else date(time); time HH:MM from `time`.
//   - mood = single word, no intensity.
//   - idempotent: hash(text block) → entry id recorded in .kioku/import-log.json.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT, VAULT_INDEX_DIR } from "../config.ts";
import { appendEntry } from "../vault/daily-note.ts";
import { openDb, closeDb } from "../index/db.ts";
import { fullReindex } from "../index/indexer.ts";

export interface ImportArgs {
  vaultFlag?: string;
  source?: string;
  dryRun?: boolean;
}

interface Block {
  time?: string; // ISO timestamp from `time:`
  mood?: string;
  eventTime?: string; // optional date-only override
  text: string;
}

// A block opens with a `---` fence line IMMEDIATELY followed by a known yaml key.
// Anchoring on this (not a bare `---`) means a stray `---` horizontal rule inside
// diary text can NOT desync the block boundaries (C1) — it stays part of the text.
const BLOCK_HEADER = /(?:^|\n)---\n(?=(?:time|mood|event_time):)/g;

/** Parse one kioku-lite markdown file into blocks. Lenient: skip bad blocks. */
export function parseKiokuLiteFile(raw: string): { blocks: Block[]; skipped: number } {
  // Normalize CRLF first (C2) so all the \n-based regexes work on Windows files.
  const normalized = raw.replace(/\r\n/g, "\n");
  // Drop the leading "# Kioku Lite — ..." heading line if present.
  const body = normalized.replace(/^#[^\n]*\n/, "");

  // Find every block-header position; the block's content runs to the next header.
  const headers: number[] = [];
  let m: RegExpExecArray | null;
  BLOCK_HEADER.lastIndex = 0;
  while ((m = BLOCK_HEADER.exec(body)) !== null) {
    // Position of the `---\n` (skip a leading \n captured by the alternation).
    headers.push(m.index + (body[m.index] === "\n" ? 1 : 0));
  }

  const blocks: Block[] = [];
  let skipped = 0;

  for (let h = 0; h < headers.length; h++) {
    const start = headers[h]!;
    const end = h + 1 < headers.length ? headers[h + 1]! : body.length;
    const chunk = body.slice(start, end); // "---\n<yaml>\n---\n<text>"
    // Strip the opening fence, split yaml / text on the FIRST closing fence only.
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
    blocks.push({
      time: meta.time,
      mood: meta.mood,
      eventTime: meta.event_time,
      text,
    });
  }
  return { blocks, skipped };
}

/** Parse the tiny known YAML subset (time/mood/event_time, quoted values). */
function parseMiniYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = /^(time|mood|event_time):\s*"?([^"]*)"?\s*$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** date = event_time ?? date-part of time; HH:MM from time. */
function resolveDateTime(b: Block): { date: string; time: string } | null {
  const fromTime = b.time ? b.time.slice(0, 10) : undefined;
  // Degrade a timestamped event_time to its date part (M2) before validating.
  const date = (b.eventTime || fromTime)?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // HH:MM from the processing timestamp (best available clock for the entry).
  let time = "00:00";
  if (b.time) {
    const tm = /T(\d{2}:\d{2})/.exec(b.time);
    if (tm) time = tm[1]!;
  }
  return { date, time };
}

function hashBlock(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export function runImport(args: ImportArgs): never {
  if (!args.source) {
    return fail("Missing import source.", "Use --from-kioku-lite <markdown-folder>.");
  }
  if (!existsSync(args.source)) {
    return fail(`Source folder not found: ${args.source}`);
  }
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path || !resolved.exists) {
    return fail("No vault configured.", NO_VAULT_HINT);
  }
  const vault = resolved.path;

  const logPath = join(vault, VAULT_INDEX_DIR, "import-log.json");
  mkdirSync(join(vault, VAULT_INDEX_DIR), { recursive: true });
  // Guard against a corrupt/partial log (H2) — treat unreadable as "nothing yet".
  let imported: Record<string, true> = {};
  if (existsSync(logPath)) {
    try {
      const parsed = JSON.parse(readFileSync(logPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        imported = parsed as Record<string, true>;
      }
    } catch {
      /* corrupt log → start fresh; idempotency falls back to a clean re-import */
    }
  }

  const files = readdirSync(args.source).filter((f) => f.endsWith(".md"));
  let blocksTotal = 0, created = 0, skippedDup = 0, skippedBad = 0;
  const newLog: Record<string, true> = { ...imported };

  // Persist the log atomically (temp + rename) so a crash can't corrupt it (L1).
  const flushLog = (): void => {
    if (args.dryRun) return;
    const tmp = `${logPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(newLog), "utf8");
    require("node:fs").renameSync(tmp, logPath);
  };

  for (const f of files) {
    const raw = readFileSync(join(args.source, f), "utf8");
    const { blocks, skipped } = parseKiokuLiteFile(raw);
    skippedBad += skipped;
    for (const b of blocks) {
      blocksTotal++;
      const dt = resolveDateTime(b);
      if (!dt) {
        skippedBad++;
        continue;
      }
      const id = hashBlock(b.text);
      if (newLog[id]) {
        skippedDup++;
        continue;
      }
      try {
        if (!args.dryRun) appendEntry(vault, dt.date, dt.time, b.text, b.mood);
        newLog[id] = true;
        created++;
      } catch {
        skippedBad++; // a single bad block must not abort the migration (H3)
      }
    }
    // Persist after each file so a mid-migration crash records progress (H3).
    flushLog();
  }

  if (!args.dryRun) {
    const db = openDb(vault);
    try {
      fullReindex(db, vault);
    } finally {
      closeDb(db);
    }
  }

  return ok({
    dry_run: !!args.dryRun,
    files: files.length,
    blocks: blocksTotal,
    entries_created: created,
    skipped_duplicate: skippedDup,
    skipped_bad: skippedBad,
  });
}
