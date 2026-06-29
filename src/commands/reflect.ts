// `my-kioku reflect` — deterministic scan producing lint + stats + insight
// candidates for the cron agent to act on. CLI never calls an LLM.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT, VAULT_INDEX_DIR } from "../config.ts";
import { parseSince, todayISO, nowHHMM, type DateRange } from "../lib/dates.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";
import { runLint } from "../reflect/lint-checks.ts";
import { findAliasCandidates } from "../reflect/alias-similarity.ts";
import { buildMoodStats, buildHealthStats } from "../reflect/mood-stats.ts";
import { detectInsights } from "../reflect/insight-candidates.ts";
import {
  findMissingRelations,
  buildRelationSummary,
  findUnconvertedTags,
} from "../reflect/relation-checks.ts";
import { detectConceptBridges } from "../reflect/concept-bridge.ts";
import { renderReflectMarkdown } from "../reflect/render-markdown.ts";

export interface ReflectArgs {
  vaultFlag?: string;
  since?: string;
  md?: boolean;
}

export function runReflect(args: ReflectArgs): never {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  const vault = resolved.path;

  const range: DateRange = args.since
    ? parseSince(args.since) ?? fallbackRange()
    : fallbackRange();

  const db = openDb(vault);
  let report: ReturnType<typeof assembleReport>;
  try {
    syncIfStale(db, vault);
    report = assembleReport(db, range);
  } finally {
    closeDb(db);
  }

  // Optional human-readable markdown copy written into the vault index folder.
  if (args.md) {
    const dir = join(vault, VAULT_INDEX_DIR, "reflect");
    mkdirSync(dir, { recursive: true });
    // Second-precision stamp so two reflects in the same minute don't overwrite.
    const now = new Date();
    const ss = String(now.getSeconds()).padStart(2, "0");
    const stamp = `${todayISO().replace(/-/g, "")}-${nowHHMM().replace(":", "")}${ss}`;
    const path = join(dir, `${stamp}.md`);
    writeFileSync(path, renderReflectMarkdown(report), "utf8");
    (report as Record<string, unknown>).md_path = path;
  }

  return ok(report);
}

function fallbackRange(): DateRange {
  return parseSince("30d")!;
}

function assembleReport(db: ReturnType<typeof openDb>, range: DateRange) {
  const lint = runLint(db);
  const entityNames = db
    .query<{ name: string }, []>("SELECT name FROM entities")
    .all()
    .map((r) => r.name);
  const aliasCandidates = findAliasCandidates(entityNames);
  const moodStats = buildMoodStats(db, range);
  const healthStats = buildHealthStats(db, range);
  const insightCandidates = detectInsights(db, range);
  const missingRelations = findMissingRelations(db);
  const relationSummary = buildRelationSummary(db, range);
  const tagsToConvert = findUnconvertedTags(db);
  const conceptBridges = detectConceptBridges(db, range);

  return {
    period: range,
    lint,
    alias_candidates: aliasCandidates,
    mood_stats: moodStats,
    health_stats: healthStats,
    insight_candidates: insightCandidates,
    missing_emotional_relation: missingRelations,
    relation_summary: relationSummary,
    tags_to_convert: tagsToConvert,
    concept_bridges: conceptBridges,
    suggested_actions: deriveActions(
      lint,
      aliasCandidates,
      insightCandidates,
      missingRelations,
      tagsToConvert,
      conceptBridges,
    ),
  };
}

/** Turn counts into a prioritized to-do list for the cron agent. */
function deriveActions(
  lint: ReturnType<typeof runLint>,
  aliases: ReturnType<typeof findAliasCandidates>,
  insights: ReturnType<typeof detectInsights>,
  missingRelations: ReturnType<typeof findMissingRelations>,
  tagsToConvert: ReturnType<typeof findUnconvertedTags>,
  conceptBridges: ReturnType<typeof detectConceptBridges>,
): string[] {
  const actions: string[] = [];
  if (lint.unknown_type_entities.length)
    actions.push(`classify ${lint.unknown_type_entities.length} unknown-type entities`);
  if (aliases.length)
    actions.push(`review ${aliases.length} possible alias pairs`);
  if (lint.broken_wikilinks.length)
    actions.push(`fix ${lint.broken_wikilinks.length} broken wikilinks`);
  if (lint.entries_without_links.length)
    actions.push(`backfill links on ${lint.entries_without_links.length} entries`);
  if (missingRelations.length)
    actions.push(`backfill emotional relation on ${missingRelations.length} strong-mood entries`);
  if (tagsToConvert.length)
    actions.push(`convert ${tagsToConvert.length} tags to wikilinks/relations`);
  for (const b of conceptBridges)
    actions.push(`add [[${b.concept}]] to ${b.entry_count} entries`);
  for (const ins of insights) actions.push(`consider insight: ${ins.kind}`);
  return actions;
}
