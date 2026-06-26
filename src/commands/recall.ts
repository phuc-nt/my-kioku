// `my-kioku recall` — the single read command. FTS5 + entity expansion + time
// filters, with a compact --digest mode for the SessionStart hook. Always runs a
// lazy sync first so the vault stays the source of truth.

import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { parseSince, isValidISODate, type DateRange } from "../lib/dates.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";
import { ftsSearch } from "../search/fts-search.ts";
import { expandByEntity, type EntityMatch } from "../search/entity-expansion.ts";
import { buildDigest } from "../search/digest.ts";
import type { Database } from "bun:sqlite";

export interface RecallArgs {
  vaultFlag?: string;
  query?: string;
  entity?: string;
  digest?: boolean;
  from?: string;
  to?: string;
  since?: string;
  limit?: number;
}

const ENTITY_BONUS = 0.3;

interface ScoredHit {
  id: string;
  score: number;
  entityHit: boolean;
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
    scored.set(h.id, { id: h.id, score: norm, entityHit: false });
  }

  // Source 2: entity expansion. --entity is an explicit filter; otherwise the
  // query text is scanned for entity names/aliases.
  const expandText = args.entity ?? args.query ?? "";
  const expansion = expandByEntity(db, expandText, range);
  for (const id of expansion.entryIds) {
    const existing = scored.get(id);
    if (existing) {
      existing.entityHit = true;
      existing.score += ENTITY_BONUS;
    } else {
      scored.set(id, { id, score: ENTITY_BONUS, entityHit: true });
    }
  }

  // When --entity is given with no query, results ARE the linked entries.
  let hits = [...scored.values()];

  // Apply the date window (if any) and hydrate.
  const hydrated = hits
    .map((h) => hydrate(db, h))
    .filter((e): e is HydratedEntry => e !== null)
    .filter((e) => inRange(e.date, range));

  // Sort by score desc, then recency.
  hydrated.sort((a, b) => b.score - a.score || cmpRecency(a, b));

  return {
    query: args.query ?? null,
    entity: args.entity ?? null,
    count: hydrated.length,
    results: hydrated.slice(0, limit),
    entity_context: expansion.entities.map(entityCtx),
  };
}

interface HydratedEntry {
  id: string;
  date: string;
  time: string;
  ordinal: number;
  mood: string | null;
  intensity: number | null;
  body: string;
  links: string[];
  score: number;
}

function hydrate(db: Database, h: ScoredHit): HydratedEntry | null {
  const row = db
    .query<
      { id: string; date: string; time: string; ordinal: number; mood: string | null; intensity: number | null; body: string },
      [string]
    >("SELECT id, date, time, ordinal, mood, intensity, body FROM entries WHERE id = ?")
    .get(h.id);
  if (!row) return null;
  const links = db
    .query<{ target: string }, [string]>(
      "SELECT target FROM links WHERE entry_id = ?",
    )
    .all(h.id)
    .map((r) => r.target);
  return { ...row, links, score: Math.round(h.score * 1000) / 1000 };
}

function entityCtx(e: EntityMatch) {
  return {
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    total_mentions_all_time: e.totalMentionsAllTime,
  };
}

function inRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  return date >= range.from && date <= range.to;
}

function cmpRecency(a: HydratedEntry, b: HydratedEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.ordinal - a.ordinal;
}
