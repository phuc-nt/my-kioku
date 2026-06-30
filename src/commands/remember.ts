// `my-kioku remember` — the single write command. One call: append entry,
// auto-stub linked entities, incrementally index. Designed so an agent never
// needs a second command for any case.

import { readFileSync } from "node:fs";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { todayISO, nowHHMM, isValidISODate } from "../lib/dates.ts";
import { inferEventDate } from "../lib/vietnamese-date-parser.ts";
import { appendEntry, setCheckinMeta } from "../vault/daily-note.ts";
import { ensureStub } from "../vault/entity-note.ts";
import { extractWikilinks } from "../vault/wikilink-parser.ts";
import { fold } from "../lib/diacritics.ts";
import { parseMoodValue, MIN_INTENSITY, MAX_INTENSITY } from "../vault/entry-parser.ts";
import { parseCheckin } from "../lib/checkin-parser.ts";
import { dailyNoteRelPath, entityRelPath } from "../vault/vault-paths.ts";
import { openDb, closeDb } from "../index/db.ts";
import { indexFile } from "../index/indexer.ts";
import { vaultFileFor } from "../index/vault-walker.ts";

export interface RememberArgs {
  vaultFlag?: string;
  text?: string; // positional text
  stdin?: boolean; // read text from stdin
  mood?: string; // "happy/4" or "happy"
  time?: string; // HH:MM
  date?: string; // YYYY-MM-DD
  checkin?: string; // "k=v,k=v"
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Look up the set of known entity names + aliases so we don't stub duplicates. */
function knownEntityKeys(db: ReturnType<typeof openDb>): Set<string> {
  const keys = new Set<string>();
  for (const row of db
    .query<{ name: string; aliases: string }, []>(
      "SELECT name, aliases FROM entities",
    )
    .all()) {
    keys.add(fold(row.name));
    try {
      for (const a of JSON.parse(row.aliases) as string[]) {
        keys.add(fold(String(a)));
      }
    } catch {
      /* ignore malformed aliases JSON */
    }
  }
  return keys;
}

export function runRemember(args: RememberArgs): never {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  const vault = resolved.path;

  // Resolve text source: stdin takes priority when both are given.
  const warnings: string[] = [];
  let text = args.text ?? "";
  if (args.stdin) {
    if (args.text) warnings.push("Both positional text and --stdin given; using --stdin.");
    text = readStdin();
  }
  text = text.replace(/\s+$/, ""); // trailing-whitespace trim only

  // Date resolution: explicit --date wins; else try to INFER an event-date from the
  // text (a cheap agent won't pass --date — R5). Inference is conservative (confident
  // match only); on no match we keep today. The text is never modified (S1).
  let date: string;
  let dateInferredFrom: string | undefined;
  if (args.date !== undefined) {
    date = args.date;
    if (!isValidISODate(date)) {
      return fail(`Invalid --date: ${args.date}`, "Expected YYYY-MM-DD.");
    }
  } else {
    const inferred = text ? inferEventDate(text) : null;
    if (inferred) {
      date = inferred.date;
      dateInferredFrom = inferred.phrase;
      if (inferred.yearGuessed) {
        warnings.push(
          `Event-date year inferred for "${inferred.phrase}" → ${date} (no year in text); pass --date to be explicit.`,
        );
      }
    } else {
      date = todayISO();
    }
  }
  const time = args.time ?? nowHHMM();

  // Mood parsing (strict). Invalid format → warn, drop mood (text untouched).
  let mood: string | undefined;
  let intensity: number | undefined;
  if (args.mood !== undefined) {
    const parsed = parseMoodValue(args.mood);
    if (parsed) {
      mood = parsed.mood;
      intensity = parsed.intensity;
    } else {
      warnings.push(
        `Mood "${args.mood}" is not a valid emotion or emotion/intensity (${MIN_INTENSITY}-${MAX_INTENSITY}); skipped.`,
      );
    }
  }

  // A pure check-in (no text) is allowed.
  if (text === "" && !args.checkin) {
    return fail("Nothing to remember.", "Provide text, --stdin, or --checkin.");
  }

  const db = openDb(vault);
  const result: Record<string, unknown> = { date };
  // Surface the source phrase when the date was inferred (so the agent/user can verify).
  if (dateInferredFrom !== undefined) result.date_inferred_from = dateInferredFrom;
  // Paths touched this call → re-indexed once at the end (covers checkin-only too).
  const touchedPaths = new Set<string>();

  try {
    // Check-in frontmatter (optional). Touches the daily note → must be indexed.
    if (args.checkin) {
      const { fields, warnings: cw } = parseCheckin(args.checkin);
      warnings.push(...cw);
      if (Object.keys(fields).length) {
        setCheckinMeta(vault, date, fields);
        touchedPaths.add(dailyNoteRelPath(date));
      }
      result.checkin = fields;
    }

    // Append the entry (if any text).
    if (text !== "") {
      const { ordinal, entryId, entry } = appendEntry(vault, date, time, text, mood, intensity);
      touchedPaths.add(dailyNoteRelPath(date));

      // Use the entry exactly as the indexer parsed it (appendEntry re-read the
      // note) — never re-parse the raw text, which would drift from the on-disk
      // mood/field ordering and report relations the index never wrote.
      const relations = entry.relations ?? {};
      const tags = entry.tags ?? [];

      // Auto-stub linked entities (body wikilinks + relation targets) not already known.
      const known = knownEntityKeys(db);
      const links = extractWikilinks(entry.text);
      const relationTargets = Object.values(relations).flat();
      const stubsCreated: string[] = [];
      // Dedup by fold() (NFC + accent + case) so "Mẹ"/"me"/decomposed-"Mẹ" are one
      // entity — consistent with knownEntityKeys above and entity-expansion matching.
      for (const target of [...links, ...relationTargets]) {
        if (known.has(fold(target))) continue;
        if (ensureStub(vault, target)) {
          stubsCreated.push(target);
          known.add(fold(target));
          touchedPaths.add(entityRelPath(target));
        }
      }

      Object.assign(result, {
        time,
        entry_id: entryId,
        ordinal,
        mood: mood ?? null,
        intensity: intensity ?? null,
        links,
        relations,
        tags,
        stubs_created: stubsCreated,
      });
    }

    // Incremental index: re-index exactly the touched files (entry, checkin, stubs).
    reindexPaths(db, vault, [...touchedPaths]);

    if (warnings.length) result.warnings = warnings;
  } finally {
    // ok()/fail() call process.exit(), which skips finally — so close explicitly
    // here (this finally runs on the normal path before ok() is reached below).
    // closeDb checkpoints the WAL so the index dir doesn't grow across calls.
    closeDb(db);
  }
  return ok(result);
}

/**
 * Re-index a specific set of relative paths by stat-ing each directly — no full
 * vault walk (keeps writes O(touched files), not O(vault size)).
 */
function reindexPaths(
  db: ReturnType<typeof openDb>,
  vault: string,
  rels: string[],
): void {
  for (const rel of rels) {
    const vf = vaultFileFor(vault, rel);
    if (vf) indexFile(db, vf);
  }
}
