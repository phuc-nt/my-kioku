// `my-kioku entity merge "B" --into "A"` — fold entity B into A. The one
// operation an agent should NOT do by hand (link rewrites must be exhaustive).
// Default is safe: prints a full diff summary; --dry-run previews without writing.

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { entityPath } from "../vault/vault-paths.ts";
import { parseFrontmatter, serializeFrontmatter } from "../vault/frontmatter.ts";
import { readEntity } from "../vault/entity-note.ts";
import { rewriteWikilinks } from "../lib/link-rewriter.ts";
import { openDb, closeDb } from "../index/db.ts";
import { fullReindex } from "../index/indexer.ts";

export interface MergeArgs {
  vaultFlag?: string;
  from?: string; // B (the entity being absorbed)
  into?: string; // A (the surviving entity)
  dryRun?: boolean;
}

/** Recursively list .md files under journal/, insights/, entities/. */
function contentFiles(vault: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".md")) out.push(full);
    }
  };
  for (const sub of ["journal", "insights", "entities"]) walk(join(vault, sub));
  return out;
}

export function runEntityMerge(args: MergeArgs): never {
  if (!args.from || !args.into) {
    return fail("Merge needs both names.", 'Usage: entity merge "B" --into "A".');
  }
  if (args.from === args.into) return fail("Cannot merge an entity into itself.");

  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path || !resolved.exists) return fail("No vault configured.", NO_VAULT_HINT);
  const vault = resolved.path;

  const bPath = entityPath(vault, args.from);
  if (!existsSync(bPath)) return fail(`Entity not found: ${args.from}`);
  const aPath = entityPath(vault, args.into);
  if (!existsSync(aPath)) return fail(`Target entity not found: ${args.into}`);

  // 1. Rewrite [[B]] → [[A]] across all content files.
  const rewrites: { file: string; count: number }[] = [];
  let totalLinks = 0;
  for (const file of contentFiles(vault)) {
    if (file === bPath) continue; // B's own file is deleted, not rewritten
    const raw = readFileSync(file, "utf8");
    const { text, count } = rewriteWikilinks(raw, args.from, args.into);
    if (count > 0) {
      rewrites.push({ file: relative(vault, file), count });
      totalLinks += count;
      if (!args.dryRun) writeFileSync(file, text, "utf8");
    }
  }

  // 2. Merge B's aliases (+ B's name) into A's frontmatter; append B's Facts.
  const a = readEntity(vault, args.into);
  const b = readEntity(vault, args.from);
  const mergedAliases = Array.from(
    new Set([...a.aliases, ...b.aliases, args.from]),
  ).filter((x) => x !== args.into);

  if (!args.dryRun) {
    const rawA = readFileSync(aPath, "utf8");
    const { meta, body } = parseFrontmatter(rawA);
    meta.aliases = mergedAliases;
    // Rewrite any [[B]] self-references inside B's own Facts before folding them
    // into A (C3) — otherwise A is left with dangling links to the deleted entity.
    const bBodyRewritten = rewriteWikilinks(b.body, args.from, args.into).text;
    const mergedBody =
      b.body.trim() !== ""
        ? `${body.replace(/\s+$/, "")}\n\n## Facts (merged from ${args.from})\n${stripHeading(bBodyRewritten)}\n`
        : body;
    writeFileSync(aPath, serializeFrontmatter(meta, mergedBody), "utf8");

    // 3. Delete B's file, then reindex.
    rmSync(bPath);
    const db = openDb(vault);
    try {
      fullReindex(db, vault);
    } finally {
      closeDb(db);
    }
  }

  return ok({
    dry_run: !!args.dryRun,
    from: args.from,
    into: args.into,
    files_rewritten: rewrites,
    links_rewritten: totalLinks,
    merged_aliases: mergedAliases,
    deleted_file: relative(vault, bPath),
  });
}

/**
 * Drop the leading "# Name" title, and a "## Facts" header ONLY if it is the
 * first content line (no /m flag — a mid-body "## Facts" of a multi-section
 * entity must be preserved, else its bullets get orphaned).
 */
function stripHeading(body: string): string {
  let out = body.replace(/^#[^\n]*\n/, ""); // leading "# Name" title
  out = out.replace(/^\s*\n/, ""); // any blank line after the title
  out = out.replace(/^##\s*Facts\s*\n/, ""); // leading "## Facts" only (no /m)
  return out.trim();
}
