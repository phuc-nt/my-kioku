// `my-kioku recall` — the single read command. FTS5 + entity expansion + time
// filters, with a compact --digest mode for the SessionStart hook. Always runs a
// lazy sync first so the vault stays the source of truth.

import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { parseSince, isValidISODate, type DateRange } from "../lib/dates.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";
import { ftsSearch, ftsPhraseMatch } from "../search/fts-search.ts";
import { expandByEntity, type EntityMatch } from "../search/entity-expansion.ts";
import {
  expandByRelation,
  entriesWithRelationType,
  RELATION_BONUS,
} from "../search/relation-expansion.ts";
import { buildDigest } from "../search/digest.ts";
import {
  hydrate,
  inRange,
  cmpRecency,
  type HydratedEntry,
} from "../search/hydrate.ts";
import type { Database } from "bun:sqlite";

export interface RecallArgs {
  vaultFlag?: string;
  query?: string;
  entity?: string;
  relation?: string; // --relation <type> filter (joy/trigger/with/eases/...)
  digest?: boolean;
  from?: string;
  to?: string;
  since?: string;
  limit?: number;
}

const ENTITY_BONUS = 0.3;
// Contiguous-phrase match bonus. Small but enough to lift an entry that contains the
// whole query as a phrase above one with the same words scattered (both already share
// the normalized FTS score), without overriding entity/relation signals.
const PHRASE_BONUS = 0.2;

interface ScoredHit {
  id: string;
  score: number;
}

export function runRecall(args: RecallArgs): never {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path) return fail("No vault configured.", NO_VAULT_HINT);
  if (!resolved.exists) return fail(`Vault not found: ${resolved.path}`, NO_VAULT_HINT);
  const vault = resolved.path;

  const range = resolveRange(args);
  if (range === "invalid") {
    return fail("Invalid date filter.", "Use --since 7d|YYYY-MM-DD or --from/--to YYYY-MM-DD.");
  }

  const db = openDb(vault);
  let payload: unknown;
  try {
    syncIfStale(db, vault);

    if (args.digest) {
      payload = buildDigest(db, range ?? defaultRange());
    } else {
      payload = runSearch(db, args, range);
    }
  } finally {
    closeDb(db);
  }
  return ok(payload);
}

/** Resolve the optional date window from --since / --from / --to. */
function resolveRange(args: RecallArgs): DateRange | null | "invalid" {
  if (args.since) {
    const r = parseSince(args.since);
    return r ?? "invalid";
  }
  if (args.from || args.to) {
    const from = args.from ?? "0000-01-01";
    const to = args.to ?? "9999-12-31";
    if (args.from && !isValidISODate(args.from)) return "invalid";
    if (args.to && !isValidISODate(args.to)) return "invalid";
    return { from, to };
  }
  return null; // no filter
}

/** Default digest window: last 7 days. */
function defaultRange(): DateRange {
  return parseSince("7d")!;
}

function runSearch(db: Database, args: RecallArgs, range: DateRange | null) {
  const limit = args.limit && args.limit > 0 ? args.limit : 10;

  // Source 1: FTS over the free-text query (if any).
  const ftsHits = args.query ? ftsSearch(db, args.query, 20) : [];
  const maxBm25 = ftsHits.length
    ? Math.max(...ftsHits.map((h) => Math.abs(h.bm25)))
    : 1;

  const scored = new Map<string, ScoredHit>();
  for (const h of ftsHits) {
    // SQLite bm25() is more-negative = more-relevant. |bm25| is therefore LARGEST
    // for the best match, so normalizing |bm25|/max gives the best hit ~1.0 and
    // weaker hits proportionally less. (A sole hit scores 1.0.)
    const norm = maxBm25 > 0 ? Math.abs(h.bm25) / maxBm25 : 1;
    scored.set(h.id, { id: h.id, score: norm });
  }

  // Source 1b: phrase boost. An entry containing the full query as a CONTIGUOUS
  // phrase ranks above one with the same words scattered. Additive on the FTS score;
  // only applies to entries already in the FTS result set (no-op for <2-token queries).
  if (args.query) {
    for (const id of ftsPhraseMatch(db, args.query)) {
      const existing = scored.get(id);
      if (existing) existing.score += PHRASE_BONUS;
    }
  }

  // Source 2: entity expansion. --entity is an explicit filter; otherwise the
  // query text is scanned for entity names/aliases.
  const expandText = args.entity ?? args.query ?? "";
  const expansion = expandByEntity(db, expandText, range);
  for (const id of expansion.entryIds) {
    const existing = scored.get(id);
    if (existing) existing.score += ENTITY_BONUS;
    else scored.set(id, { id, score: ENTITY_BONUS });
  }

  // Source 3: relation expansion. A typed relation is a stronger signal than a
  // plain mention → RELATION_BONUS (> ENTITY_BONUS). Note: bonuses are ADDITIVE
  // on top of FTS, so a relation hit (0.5) is guaranteed to outrank a plain-link
  // hit (0.3) only AMONG non-FTS results; a strong FTS body match (~1.0) can
  // still rank higher. Two modes:
  //   - relation TARGET hits for the matched entities (always, with bonus);
  //   - `--relation <type>` filter: entries having that relation type.
  const relIds = new Set<string>();
  // Reuse the entities already matched by expandByEntity (no second table scan).
  const entityNames = expansion.entities.map((e) => e.name);
  for (const id of expandByRelation(db, entityNames, args.relation, range)) relIds.add(id);
  if (args.relation && entityNames.length === 0) {
    // --relation with no entity → all entries having that relation type.
    for (const id of entriesWithRelationType(db, args.relation, range)) relIds.add(id);
  }
  for (const id of relIds) {
    const existing = scored.get(id);
    if (existing) existing.score += RELATION_BONUS;
    else scored.set(id, { id, score: RELATION_BONUS });
  }

  // `--relation` is a hard filter: restrict results to entries that matched it.
  let hits = [...scored.values()];
  if (args.relation) hits = hits.filter((h) => relIds.has(h.id));

  // Apply the date window (if any) and hydrate.
  const hydrated = hits
    .map((h) => hydrate(db, h.id, h.score))
    .filter((e): e is HydratedEntry => e !== null)
    .filter((e) => inRange(e.date, range));

  // Sort by score desc; among CLOSE scores, demote a superseded ("no longer current")
  // entry below its non-superseded peer; then recency. The demotion is a TIEBREAK, not
  // a score subtraction — so it never pushes a superseded entry out of the result set
  // (a "what was my OLD job" query still finds it), it only orders the newer fact first
  // when relevance is otherwise comparable (M2).
  hydrated.sort(
    (a, b) =>
      b.score - a.score ||
      supersededRank(a) - supersededRank(b) ||
      cmpRecency(a, b),
  );

  return {
    query: args.query ?? null,
    entity: args.entity ?? null,
    relation: args.relation ?? null,
    count: hydrated.length,
    results: hydrated.slice(0, limit),
    entity_context: expansion.entities.map(entityCtx),
  };
}

/** A superseded entry ranks AFTER a non-superseded one in a tiebreak (0 before 1). */
function supersededRank(e: HydratedEntry): number {
  return e.superseded ? 1 : 0;
}

function entityCtx(e: EntityMatch) {
  return {
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    total_mentions_all_time: e.totalMentionsAllTime,
  };
}
