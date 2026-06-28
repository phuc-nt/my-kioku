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
 * Minimum folded length for the last token to get a trailing prefix `*`. Set to 4:
 * most Vietnamese single-syllable words fold to ≤3 chars (phở→pho, bạn→ban, hoa→hoa),
 * so a complete short word matches EXACTLY rather than prefix-flooding (pho* → phòng).
 * Only a longer partial word (≥4, e.g. "deadl") gets search-as-you-type prefixing.
 */
const MIN_PREFIX_LEN = 4;

/**
 * Split raw text into folded, FTS-safe tokens. Keep Unicode letters/numbers;
 * everything else is a separator — this strips every FTS operator while preserving
 * Vietnamese words. Each token is FOLDED (đ→d + strip marks) to match the folded
 * index, so "gia dinh" hits "gia đình". NFC FIRST: in decomposed (NFD) input a
 * combining mark is neither \p{L} nor \p{N}, so it would act as a separator and split
 * a word mid-character ("đình" → "đi"+"nh"); canonicalizing keeps each syllable whole.
 */
function foldedTokens(raw: string): string[] {
  return raw
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => fold(t.trim()))
    .filter((t) => t.length > 0);
}

/** Quote a folded token so it can never be read as an FTS operator. */
function quote(t: string): string {
  return `"${t.replace(/"/g, '""')}"`;
}

/**
 * Turn arbitrary text into a safe FTS5 MATCH string: folded tokens, each quoted,
 * implicit AND. The LAST token gets a prefix `*` (search-as-you-type: a partial
 * final word like "deadl" still matches "deadline"); earlier tokens stay exact to
 * avoid noisy prefix floods. Returns "" when no usable token remains (caller skips).
 */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = foldedTokens(raw);
  if (tokens.length === 0) return "";
  const last = tokens.length - 1;
  return tokens
    .map((t, i) =>
      i === last && t.length >= MIN_PREFIX_LEN ? `${quote(t)}*` : quote(t),
    )
    .join(" ");
}

/**
 * Build an FTS5 phrase MATCH from the folded tokens (`"a b c"`) for ranking a
 * contiguous-phrase match above scattered words. Returns "" for <2 tokens (a
 * single-token query has no phrase to boost).
 */
export function foldedPhrase(raw: string): string {
  const tokens = foldedTokens(raw);
  if (tokens.length < 2) return "";
  return quote(tokens.join(" "));
}

/**
 * Return the entry ids whose body contains the query as a CONTIGUOUS phrase (folded).
 * Used to boost an exact-phrase match above scattered-word matches. Empty for a
 * single-token query (nothing to treat as a phrase).
 */
export function ftsPhraseMatch(db: Database, rawQuery: string, limit = 50): string[] {
  const phrase = foldedPhrase(rawQuery);
  if (!phrase) return [];
  return db
    .query<{ id: string }, [string, number]>(
      `SELECT e.id AS id
       FROM entries_fts
       JOIN entries e ON e.rowid = entries_fts.rowid
       WHERE entries_fts MATCH ?
       LIMIT ?`,
    )
    .all(phrase, limit)
    .map((r) => r.id);
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
