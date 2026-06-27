// `my-kioku import --from-kioku-lite <folder>` — migrate legacy kioku-lite /
// Telegram-backup memories. Source is a FOLDER of markdown files (validation
// decision), NOT the SQLite DB. The pure parsers live in
// `import-kioku-lite-parser.ts`; this file is orchestration only.
//
// Decisions baked in:
//   - text imported VERBATIM, with NO wikilinks (KG is backfilled later by the
//     agent via reflect lint — entries_without_links surfaces them).
//   - per-block `tags:` (Python-list) → an inline `tags::` line on the entry
//     (preserved for the living loop; hash stays over the ORIGINAL text so the
//     tags prepend never breaks idempotency).
//   - date = event_time (if present) else date(time); time HH:MM from `time`.
//   - recursive scan (validation decision #4): one import ingests subfolders too.
//   - idempotent: hash(original text) → entry id recorded in .kioku/import-log.json.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT, VAULT_INDEX_DIR } from "../config.ts";
import { appendEntry } from "../vault/daily-note.ts";
import { openDb, closeDb } from "../index/db.ts";
import { fullReindex } from "../index/indexer.ts";
import {
  parseKiokuLiteFile,
  resolveDateTime,
  hashBlock,
} from "./import-kioku-lite-parser.ts";

export interface ImportArgs {
  vaultFlag?: string;
  source?: string;
  dryRun?: boolean;
}

/** Recursively list *.md files under a folder (skips dotfiles). Lenient. */
function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: "utf8" });
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    try {
      if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
      else if (name.endsWith(".md")) out.push(full);
    } catch {
      /* vanished mid-scan — skip */
    }
  }
  return out;
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
  // Guard against a corrupt/partial log — treat unreadable as "nothing yet".
  let imported: Record<string, true> = {};
  if (existsSync(logPath)) {
    try {
      const parsed = JSON.parse(readFileSync(logPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        imported = parsed as Record<string, true>;
      }
    } catch {
      /* corrupt log → start fresh */
    }
  }

  const files = listMarkdown(args.source); // recursive (decision #4)
  let blocksTotal = 0, created = 0, skippedDup = 0, skippedBad = 0;
  const newLog: Record<string, true> = { ...imported };

  // Persist the log atomically (temp + rename) so a crash can't corrupt it.
  const flushLog = (): void => {
    if (args.dryRun) return;
    const tmp = `${logPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(newLog), "utf8");
    renameSync(tmp, logPath);
  };

  for (const path of files) {
    const raw = readFileSync(path, "utf8");
    const { blocks, skipped } = parseKiokuLiteFile(raw);
    skippedBad += skipped;
    for (const b of blocks) {
      blocksTotal++;
      const dt = resolveDateTime(b);
      if (!dt) {
        skippedBad++;
        continue;
      }
      // Hash the ORIGINAL text (not the tags-augmented text) for stable dedup.
      const id = hashBlock(b.text);
      if (newLog[id]) {
        skippedDup++;
        continue;
      }
      // Prepend a `tags::` line so the entry's tags are indexed (added line; the
      // user's words follow unchanged — verbatim body preserved).
      const text = b.tags && b.tags.length
        ? `tags:: ${b.tags.join(", ")}\n${b.text}`
        : b.text;
      try {
        if (!args.dryRun) appendEntry(vault, dt.date, dt.time, text, b.mood);
        newLog[id] = true;
        created++;
      } catch {
        skippedBad++; // a single bad block must not abort the migration
      }
    }
    flushLog(); // record progress after each file
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
