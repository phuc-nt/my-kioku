// Deterministic, read-only "concept bridge" detector for the living loop.
// A concept bridge = a recurring THEME (a tag appearing across many entries) that
// is not yet a wikilink, so those entries don't connect in the graph and a semantic
// query like "thể dục" misses them. reflect SUGGESTS adding a `[[concept]]` link to
// the cited entries; the AGENT applies it (markdown stays verbatim — the CLI never
// writes). This is a cheap, vector-free way to grow the graph for recall.
//
// Why a tag (not a free keyword): a tag is an explicit signal the user/import
// already attached, so proposing `[[tag]]` is a concrete, verifiable edit. Free-text
// keyword clustering is left out (YAGNI) — it risks noisy, unverifiable suggestions.

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";

// --- Tunable thresholds (named, matching the reflect-detector convention) ---
export const CONCEPT_BRIDGE_MIN = 3; // a tag must span >= this many entries to bridge
export const MAX_BRIDGES = 10; // cap suggestions so a big import can't flood actions
const EVIDENCE_MAX = 5; // example entry ids cited per bridge

export interface ConceptBridge {
  concept: string; // the proposed wikilink text, e.g. "thể dục"
  reason: string; // why it's suggested (human-readable)
  entry_count: number; // how many entries share this tag
  evidence: string[]; // up to EVIDENCE_MAX entry ids
}

/**
 * Find tags that (a) appear in >= CONCEPT_BRIDGE_MIN entries, (b) are not already
 * an entity note, and (c) are not already linked as `[[tag]]` in MOST of those
 * entries — i.e. a real bridge opportunity. Returns the top MAX_BRIDGES by entry
 * count. Range-scoped: a bridge is a current-window suggestion, not all-time debt.
 */
export function detectConceptBridges(
  db: Database,
  range: { from: string; to: string },
): ConceptBridge[] {
  // Tags already represented as an entity note → folded set (skip these).
  const entityKeys = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM entities")
      .all()
      .map((r) => fold(r.name)),
  );

  // Tag → distinct entry ids within the range. Folded GROUP merges casing/diacritic
  // variants of the same tag, keeping the most-frequent display spelling.
  const rows = db
    .query<{ tag: string; entry_id: string }, [string, string]>(
      `SELECT t.tag AS tag, t.entry_id AS entry_id
       FROM tags t
       JOIN entries e ON e.id = t.entry_id
       WHERE e.date BETWEEN ? AND ?`,
    )
    .all(range.from, range.to);

  // Group by folded tag → { display spelling (most common), set of entry ids }.
  const groups = new Map<string, { display: Map<string, number>; entries: Set<string> }>();
  for (const r of rows) {
    const key = fold(r.tag);
    if (entityKeys.has(key)) continue; // already an entity → not a bridge
    let g = groups.get(key);
    if (!g) {
      g = { display: new Map(), entries: new Set() };
      groups.set(key, g);
    }
    g.display.set(r.tag, (g.display.get(r.tag) ?? 0) + 1);
    g.entries.add(r.entry_id);
  }

  const bridges: ConceptBridge[] = [];
  for (const g of groups.values()) {
    if (g.entries.size < CONCEPT_BRIDGE_MIN) continue;
    // Skip if the entries ALREADY share a link with this tag's name (folded): the
    // bridge already exists, nothing to suggest.
    const display = topKey(g.display);
    if (alreadyLinkedInMost(db, fold(display), g.entries)) continue;
    bridges.push({
      concept: display,
      reason: `Tag "${display}" appears in ${g.entries.size} entries but is not yet a [[wikilink]] — linking them connects the theme for recall.`,
      entry_count: g.entries.size,
      evidence: [...g.entries].slice(0, EVIDENCE_MAX),
    });
  }

  return bridges
    // Total order: tiebreak equal counts by concept so output is stable run-to-run
    // (the tag⋈entries scan has no ORDER BY, so insertion order isn't contractual).
    .sort((a, b) => b.entry_count - a.entry_count || a.concept.localeCompare(b.concept))
    .slice(0, MAX_BRIDGES);
}

/** The most frequently-written spelling of a tag (dominant display form). */
function topKey(counts: Map<string, number>): string {
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) ((best = k), (bestN = n));
  return best;
}

/**
 * True if a MAJORITY of the given entries already link the concept (folded target
 * match) — then the bridge is effectively in place and we don't re-suggest it.
 */
function alreadyLinkedInMost(
  db: Database,
  conceptKey: string,
  entries: Set<string>,
): boolean {
  let linked = 0;
  const stmt = db.query<{ target: string }, [string]>(
    "SELECT target FROM links WHERE entry_id = ?",
  );
  for (const id of entries) {
    const targets = stmt.all(id).map((r) => fold(r.target));
    if (targets.includes(conceptKey)) linked++;
  }
  return linked > entries.size / 2;
}
