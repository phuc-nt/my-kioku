// `my-kioku forget <entry-id>` / `forget --entity "X"` — the privacy/delete command.
// Removes (or redacts) a markdown entry block from its daily note, then reindexes.
// Markdown is the source of truth (S2), so deletion is just a file edit + reindex —
// no DB surgery. The vault is a git repo, so removed content stays in history (audit)
// while gone from the working tree.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { fold } from "../lib/diacritics.ts";
import { dailyNotePath, dailyNoteRelPath } from "../vault/vault-paths.ts";
import { parseFrontmatter, serializeFrontmatter } from "../vault/frontmatter.ts";
import { entryRanges } from "../vault/entry-block-range.ts";
import { extractLeadingFieldCount } from "../vault/entry-parser.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";
import { indexFile } from "../index/indexer.ts";
import { vaultFileFor } from "../index/vault-walker.ts";

export interface ForgetArgs {
  vaultFlag?: string;
  entryId?: string; // "date#ordinal"
  entity?: string; // delete all entries linking this entity
  redact?: boolean; // keep heading + structured fields, blank the body
  dryRun?: boolean;
}

interface Target {
  rel: string; // journal-relative path
  date: string;
  ordinal: number;
  time: string;
}

export function runForget(args: ForgetArgs): never {
  if (!args.entryId && !args.entity) {
    return fail(
      "forget needs a target.",
      'Pass an entry id (forget "2026-06-12#0") or --entity "Name".',
    );
  }
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  const vault = resolved.path;

  const db = openDb(vault);
  let payload: unknown;
  try {
    syncIfStale(db, vault);

    const targets = args.entity
      ? targetsForEntity(db, vault, args.entity)
      : targetForId(vault, args.entryId!);
    if ("error" in targets) return fail(targets.error, targets.hint);
    if (targets.list.length === 0) {
      return fail(
        args.entity ? `No entries link "${args.entity}".` : `Entry not found: ${args.entryId}`,
        "Nothing to forget — check the id (date#ordinal) or entity name.",
      );
    }

    const mode = args.redact ? "redact" : "delete";
    const touched = applyToFiles(vault, targets.list, args.redact === true, args.dryRun === true);

    // Reindex touched files (skip on dry-run — nothing changed on disk). Route
    // through indexFile/removeFile so the index stays consistent with any table.
    if (!args.dryRun) {
      for (const rel of touched) {
        const vf = vaultFileFor(vault, rel);
        if (vf) indexFile(db, vf);
      }
    }

    payload = {
      dry_run: args.dryRun === true,
      mode,
      removed_count: targets.list.length,
      files_touched: touched,
      targets: targets.list.map((t) => ({
        entry_id: `${t.date}#${t.ordinal}`,
        file: t.rel,
        date: t.date,
        time: t.time,
      })),
      note:
        "Later entries in an edited file are renumbered after a delete — do not reuse old date#ordinal ids; re-query if needed.",
    };
  } finally {
    closeDb(db);
  }
  return ok(payload);
}

/** Resolve a single `date#ordinal` id to a target (validating the ordinal exists). */
function targetForId(
  vault: string,
  entryId: string,
): { list: Target[] } | { error: string; hint?: string } {
  const hash = entryId.lastIndexOf("#");
  if (hash < 0) return { error: `Bad entry id: ${entryId}`, hint: "Expected date#ordinal, e.g. 2026-06-12#0." };
  const date = entryId.slice(0, hash);
  const ordinal = Number(entryId.slice(hash + 1));
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    return { error: `Bad ordinal in id: ${entryId}`, hint: "Ordinal must be a non-negative integer." };
  }
  let rel: string;
  try {
    rel = dailyNoteRelPath(date);
  } catch {
    return { error: `Bad date in id: ${entryId}`, hint: "Expected date#ordinal, e.g. 2026-06-12#0." };
  }
  const path = dailyNotePath(vault, date);
  if (!existsSync(path)) return { list: [] };
  const ranges = entryRanges(bodyLines(path));
  const r = ranges.find((x) => x.ordinal === ordinal);
  if (!r) return { list: [] };
  return { list: [{ rel, date, ordinal, time: r.time }] };
}

/**
 * Resolve all entries linking an entity into targets. `links.target` stores the
 * raw NFC entity name (e.g. "Hùng"), so we fold BOTH sides to match — tolerating
 * an accent-free argument ("Hung") and any composed/decomposed form, consistent
 * with how entity-expansion folds entity keys.
 */
function targetsForEntity(
  db: ReturnType<typeof openDb>,
  _vault: string,
  entity: string,
): { list: Target[] } | { error: string; hint?: string } {
  const key = fold(entity);
  const rows = db
    .query<{ id: string; file: string; date: string; time: string; ordinal: number; target: string }, []>(
      `SELECT e.id AS id, e.file AS file, e.date AS date, e.time AS time,
              e.ordinal AS ordinal, l.target AS target
       FROM entries e
       JOIN links l ON l.entry_id = e.id`,
    )
    .all();
  const seen = new Set<string>();
  const list: Target[] = [];
  for (const r of rows) {
    if (fold(r.target) !== key) continue;
    if (seen.has(r.id)) continue; // an entry linking X twice → one delete
    seen.add(r.id);
    list.push({ rel: r.file, date: r.date, ordinal: r.ordinal, time: r.time });
  }
  return { list };
}

/**
 * Edit each touched file: delete or redact the targeted blocks, highest-ordinal
 * first (so earlier deletions don't shift later block offsets). Returns the set of
 * relative paths actually edited (for reindex).
 */
function applyToFiles(
  vault: string,
  targets: Target[],
  redact: boolean,
  dryRun: boolean,
): string[] {
  const byFile = new Map<string, Target[]>();
  for (const t of targets) {
    (byFile.get(t.rel) ?? byFile.set(t.rel, []).get(t.rel)!).push(t);
  }

  const touched: string[] = [];
  for (const [rel, fileTargets] of byFile) {
    const path = dailyNotePath(vault, fileTargets[0]!.date);
    const raw = readFileSync(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    let lines = body.replace(/\r\n/g, "\n").split("\n");

    // Re-derive ranges from THIS file's body, then process the targeted ordinals
    // bottom-up so splicing one block never invalidates a higher block's range.
    const ranges = entryRanges(lines);
    const ords = new Set(fileTargets.map((t) => t.ordinal));
    const hit = ranges.filter((r) => ords.has(r.ordinal)).sort((a, b) => b.ordinal - a.ordinal);

    for (const r of hit) {
      if (redact) {
        // Keep the heading + the leading structured-field lines (mood/relations/
        // tags); replace ONLY the verbatim body with a single tombstone line.
        const blockLines = lines.slice(r.startLine, r.endLine + 1);
        const fieldCount = extractLeadingFieldCount(blockLines);
        const head = lines.slice(r.headingLine, r.startLine + fieldCount);
        // The body region may END with the blank separator that precedes the next
        // heading (or the file's trailing newline). That blank is what makes the
        // NEXT entry "blank-preceded" — drop it and the next heading stops being a
        // boundary and the next entry gets swallowed into this one (and the file
        // loses its EOF newline). So preserve the block's trailing blank lines.
        let trailingBlanks = 0;
        for (let j = r.endLine; j > r.startLine + fieldCount - 1 && lines[j]!.trim() === ""; j--) {
          trailingBlanks++;
        }
        lines = [
          ...lines.slice(0, r.headingLine),
          ...head,
          `[redacted ${fileTargets[0]!.date}]`,
          ...Array<string>(trailingBlanks).fill(""),
          ...lines.slice(r.endLine + 1),
        ];
      } else {
        // Delete the whole block: heading through its trailing separator line.
        lines = [...lines.slice(0, r.headingLine), ...lines.slice(r.endLine + 1)];
      }
    }

    if (!dryRun) writeFileSync(path, serializeFrontmatter(meta, lines.join("\n")), "utf8");
    touched.push(rel);
  }
  return touched;
}

/** Read a daily note's body lines (frontmatter stripped, CRLF normalized). */
function bodyLines(path: string): string[] {
  const { body } = parseFrontmatter(readFileSync(path, "utf8"));
  return body.replace(/\r\n/g, "\n").split("\n");
}
