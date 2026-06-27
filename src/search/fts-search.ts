// FTS5 full-text search over entries. The query is sanitized into a safe MATCH
// expression so user/agent input containing FTS operators ("", *, ^, NEAR, etc.)
// can never crash the query (a real pain point in the previous system).

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";

export interface FtsHit {
  id: string;
  date: string;
  time: string;
  bm25: number; // lower is better (SQLite bm25); we negate to a 0..1 score later
}

/**
 * Turn arbitrary text into a safe FTS5 MATCH string: split on non-word runs,
 * wrap each token in double quotes (escaping internal quotes), OR-less implicit
 * AND. Returns "" when no usable token remains (caller skips FTS).
 */
export function sanitizeFtsQuery(raw: string): string {
  // Keep Unicode letters/numbers; everything else is a separator. This strips
  // every FTS operator while preserving Vietnamese words. Each token is FOLDED
  // (đ→d + strip marks) to match the folded index, so "gia dinh" hits "gia đình".
  const tokens = raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => fold(t.trim()))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  // Quote each token so none is interpreted as an operator. (No internal quotes
  // survive tokenization, but escape defensively.)
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

/** Run a sanitized FTS query; returns up to `limit` hits ordered by bm25. */
export function ftsSearch(
  db: Database,
  rawQuery: string,
  limit = 20,
): FtsHit[] {
  const match = sanitizeFtsQuery(rawQuery);
  if (!match) return [];
  return db
    .query<FtsHit, [string, number]>(
      `SELECT e.id AS id, e.date AS date, e.time AS time, bm25(entries_fts) AS bm25
       FROM entries_fts
       JOIN entries e ON e.rowid = entries_fts.rowid
       WHERE entries_fts MATCH ?
       ORDER BY bm25(entries_fts)
       LIMIT ?`,
    )
    .all(match, limit);
}
