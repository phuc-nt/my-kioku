// Deterministic, read-only detector for "latest-fact" candidates: an older entry
// whose fact (e.g. employer) looks REPLACED by a newer one. "Fact replaced" is
// NLP-hard, so the CLI only SUGGESTS candidate pairs — the agent (which understands
// language) confirms and writes `superseded:: <newer-id>` to the OLD entry. The CLI
// never auto-marks. Bounding constraints keep the suggestions low-noise.

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";

// --- Tunable thresholds (named) ---
// Entity types where "only one is current at a time" is a reasonable prior — a new
// one usually REPLACES the old. Keep small; tune against the real vault.
export const SUPERSEDABLE_TYPES = ["employer", "workplace", "job", "company"];
export const SUPERSEDE_MIN_GAP_DAYS = 7; // older must precede newer by >= this
export const MAX_SUPERSEDED_CANDIDATES = 10; // cap so an import can't flood actions

export interface SupersededCandidate {
  older_id: string;
  newer_id: string;
  type: string; // the shared entity type (e.g. "employer")
  old_entity: string; // entity linked by the older entry
  new_entity: string; // the distinct entity linked by the newer entry
  shared_context: string; // a common entity both entries link (the anchor)
}

interface EntryLinks {
  id: string;
  date: string;
  ordinal: number;
  targets: string[]; // linked entity names (raw)
}

/**
 * Surface candidate supersessions: pairs (older, newer) that each link a DISTINCT
 * entity of the SAME supersedable `type`, share ≥1 OTHER common entity (the anchor
 * that makes them comparable), are at least SUPERSEDE_MIN_GAP_DAYS apart, and whose
 * two distinct type-entities never co-occur in a single entry (a real replacement =
 * you don't mention both in one breath). Already-flagged olders are skipped.
 */
export function detectSupersededCandidates(
  db: Database,
  range: { from: string; to: string },
): SupersededCandidate[] {
  // Entities of a supersedable type → name(folded) → {type, displayName}.
  const typed = new Map<string, { type: string; name: string }>();
  for (const e of db
    .query<{ name: string; type: string }, []>("SELECT name, type FROM entities")
    .all()) {
    if (SUPERSEDABLE_TYPES.includes(e.type.toLowerCase())) {
      typed.set(fold(e.name), { type: e.type.toLowerCase(), name: e.name });
    }
  }
  if (typed.size === 0) return [];

  // Entries in range with their link targets (most recent first).
  const entries = loadEntryLinks(db, range);

  // Entries already marked superseded → skip as the OLDER side (don't re-suggest).
  const flagged = new Set(
    db.query<{ entry_id: string }, []>("SELECT entry_id FROM superseded").all().map((r) => r.entry_id),
  );

  // For each entry, which supersedable-typed entities does it link, and its full set.
  const enriched = entries.map((e) => {
    const folded = e.targets.map(fold);
    const typedHits = folded
      .map((f) => typed.get(f))
      .filter((x): x is { type: string; name: string } => x !== undefined);
    return { ...e, foldedSet: new Set(folded), typedHits };
  });

  const out: SupersededCandidate[] = [];
  const seenPairs = new Set<string>();

  // Compare every (older, newer) pair. entries are date-desc, so j<i ⇒ entries[j] newer.
  for (let i = 0; i < enriched.length; i++) {
    const older = enriched[i]!;
    if (flagged.has(older.id) || older.typedHits.length === 0) continue;

    for (let j = 0; j < i; j++) {
      const newer = enriched[j]!;
      if (newer.typedHits.length === 0) continue;
      if (dayGap(older.date, newer.date) < SUPERSEDE_MIN_GAP_DAYS) continue;

      const pair = matchTypedPair(older, newer);
      if (!pair) continue;

      // Shared OTHER context: a common entity that is NOT either type-entity.
      // Returns the OLDER entry's display-cased target (not the folded key).
      const shared = sharedAnchor(older.targets, newer.foldedSet, pair);
      if (!shared) continue;

      const key = `${older.id}>${newer.id}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      out.push({
        older_id: older.id,
        newer_id: newer.id,
        type: pair.type,
        old_entity: pair.oldName,
        new_entity: pair.newName,
        shared_context: shared,
      });
      if (out.length >= MAX_SUPERSEDED_CANDIDATES) return out;
    }
  }
  return out;
}

interface Enriched extends EntryLinks {
  foldedSet: Set<string>;
  typedHits: { type: string; name: string }[];
}

/**
 * Find a (type, oldName, newName) where older and newer each link a DISTINCT entity
 * of the SAME supersedable type, AND those two entities never co-occur in EITHER
 * entry (a real replacement isn't mentioned together). Returns null if none.
 */
function matchTypedPair(
  older: Enriched,
  newer: Enriched,
): { type: string; oldName: string; newName: string; oldKey: string; newKey: string } | null {
  for (const ot of older.typedHits) {
    for (const nt of newer.typedHits) {
      if (ot.type !== nt.type) continue;
      const oldKey = fold(ot.name);
      const newKey = fold(nt.name);
      if (oldKey === newKey) continue; // same entity → not a replacement
      // Non-co-occurrence: neither entry links BOTH.
      if (older.foldedSet.has(newKey) || newer.foldedSet.has(oldKey)) continue;
      return { type: ot.type, oldName: ot.name, newName: nt.name, oldKey, newKey };
    }
  }
  return null;
}

/**
 * A common entity both entries link that is NOT either type-entity (the anchor).
 * `aTargets` is the older entry's RAW (display-cased) targets; `b` is the newer
 * entry's folded set. Returns the display name (folded only for the membership test).
 */
function sharedAnchor(
  aTargets: string[],
  b: Set<string>,
  pair: { oldKey: string; newKey: string },
): string | null {
  for (const target of aTargets) {
    const f = fold(target);
    if (f === pair.oldKey || f === pair.newKey) continue;
    if (b.has(f)) return target; // display-cased
  }
  return null;
}

/** Load in-range entries with their link targets, newest first. */
function loadEntryLinks(db: Database, range: { from: string; to: string }): EntryLinks[] {
  const rows = db
    .query<{ id: string; date: string; ordinal: number; target: string | null }, [string, string]>(
      `SELECT e.id AS id, e.date AS date, e.ordinal AS ordinal, l.target AS target
       FROM entries e
       LEFT JOIN links l ON l.entry_id = e.id
       WHERE e.date BETWEEN ? AND ?
       ORDER BY e.date DESC, e.ordinal DESC`,
    )
    .all(range.from, range.to);

  const byId = new Map<string, EntryLinks>();
  const order: string[] = [];
  for (const r of rows) {
    let e = byId.get(r.id);
    if (!e) {
      e = { id: r.id, date: r.date, ordinal: r.ordinal, targets: [] };
      byId.set(r.id, e);
      order.push(r.id);
    }
    if (r.target) e.targets.push(r.target);
  }
  return order.map((id) => byId.get(id)!);
}

/** Whole-day gap between two YYYY-MM-DD dates (absolute). */
function dayGap(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Math.round(ms / 86_400_000);
}
