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
 * Minimum number of DISTINCT query tokens an entry must match to survive the
 * coverage gate. With OR matching (below), an entry sharing a single incidental
 * common token (e.g. "mua", "đầu tư") would otherwise leak in; requiring ≥2
 * distinct matched tokens drops that noise while real multi-term queries keep
 * 2–3 on the right entry. A query with fewer usable tokens than this falls back
 * to cover≥1 so a legitimately short query is never gated to empty. Spike Q4:
 * cover≥2 removes absent-topic-phrase leakage at no cost to real recall.
 */
const FTS_MIN_COVER = 2;

/**
 * Only tokens whose folded length is ≥ this count toward COVERAGE (they still all
 * MATCH for recall). Short tokens are grammatical glue — Vietnamese particles like
 * "đi"→di, "ở"→o, "và"→va, English "to"/"in" — that collide incidentally across
 * unrelated entries. The benchmark surfaced a false positive where an absent-topic
 * query ("…chuyến đi…") covered an unrelated entry via the diacritic-fold collision
 * chuyến/chuyện ("chuyen") + the particle "đi"; requiring coverage from ≥3-char
 * content tokens drops that leak while real queries still cover ≥2 content words.
 */
const COVERAGE_MIN_TOKEN_LEN = 3;

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
 * joined with OR. OR (not implicit AND) is the key recall lever: an enriched query
 * ADDS terms, and under AND every added term is another REQUIRED match (so a longer
 * query recalls LESS); under OR more terms = more chances to match (more recall),
 * and bm25 already ranks higher-coverage entries above lower ones. The coverage
 * gate in ftsSearch then removes single-incidental-token noise. The LAST token gets
 * a prefix `*` (search-as-you-type: "deadl" still matches "deadline"). Returns ""
 * when no usable token remains (caller skips).
 */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = foldedTokens(raw);
  if (tokens.length === 0) return "";
  const last = tokens.length - 1;
  return tokens
    .map((t, i) =>
      i === last && t.length >= MIN_PREFIX_LEN ? `${quote(t)}*` : quote(t),
    )
    .join(" OR ");
}

/**
 * Count how many DISTINCT CONTENT query tokens (folded length ≥ COVERAGE_MIN_TOKEN_LEN)
 * appear in an entry's body (folded match). Used by the coverage gate: with OR matching,
 * an entry need only share one token to be returned, so we re-check overlap to demand a
 * minimum — and short grammatical-glue tokens don't count (they collide incidentally).
 * Mirrors the MATCH semantics — the LAST token is a PREFIX match when ≥ MIN_PREFIX_LEN
 * (just as sanitizeFtsQuery adds `*`), so "deadl" counts against a body with "deadline".
 * Folds the body once; called on the ≤limit hits FTS already returned, so cost is trivial.
 */
function coverage(queryTokens: string[], body: string, countShort: boolean): number {
  const bodyTokens = foldedTokens(body);
  const bodySet = new Set(bodyTokens);
  const lastIdx = queryTokens.length - 1;
  let n = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    const t = queryTokens[i]!;
    // Glue tokens (<3 chars) don't anchor relevance, so they don't count toward the
    // gate — UNLESS the query is ALL short (countShort), e.g. a 2-char name "Vy" or a
    // word like "ăn" not stored as an entity; then we must count them or the query
    // would be gated to empty. (Named entities also recall via entity expansion.)
    if (!countShort && t.length < COVERAGE_MIN_TOKEN_LEN) continue;
    const isPrefix = i === lastIdx && t.length >= MIN_PREFIX_LEN;
    if (isPrefix ? bodyTokens.some((b) => b.startsWith(t)) : bodySet.has(t)) n++;
  }
  return n;
}

/** How many query tokens are "content" tokens (≥ COVERAGE_MIN_TOKEN_LEN) — the pool the
 *  coverage gate can draw from. Used to pick the gate floor so an all-short query isn't
 *  gated to empty. */
function contentTokenCount(queryTokens: string[]): number {
  return queryTokens.filter((t) => t.length >= COVERAGE_MIN_TOKEN_LEN).length;
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

/**
 * Run a sanitized FTS query; returns up to `limit` hits ordered by bm25 (best first),
 * after a COVERAGE GATE. OR matching admits any entry sharing one query token, so we
 * keep only entries matching ≥ FTS_MIN_COVER distinct query tokens — except when the
 * query itself has fewer usable tokens than that (then cover≥1, so a short/single-word
 * query is never gated to empty). FTS still owns the true-negative guarantee: a query
 * whose tokens appear nowhere returns no rows at all (S4).
 */
export function ftsSearch(
  db: Database,
  rawQuery: string,
  limit = 20,
): FtsHit[] {
  const match = sanitizeFtsQuery(rawQuery);
  if (!match) return [];
  // Fetch enough rows to gate without starving the result: OR can match many weak
  // (cover=1) entries, so over-fetch then filter down to `limit` survivors. 4× is
  // ample headroom — bm25 sorts higher-coverage entries ABOVE single-token noise
  // (a 2-distinct-term match sums two contributions and IDF suppresses common
  // tokens), so real cover≥2 hits never fall past the cut at journal scale.
  const rows = db
    .query<FtsHit & { body: string }, [string, number]>(
      `SELECT e.id AS id, e.date AS date, e.time AS time, e.body AS body,
              bm25(entries_fts) AS bm25
       FROM entries_fts
       JOIN entries e ON e.rowid = entries_fts.rowid
       WHERE entries_fts MATCH ?
       ORDER BY bm25(entries_fts)
       LIMIT ?`,
    )
    .all(match, limit * 4);

  const queryTokens = foldedTokens(rawQuery);
  const nContent = contentTokenCount(queryTokens);
  // When the query has NO content tokens (all ≤2 chars, e.g. "ăn" / a 2-char name),
  // coverage counts the short tokens instead — otherwise it could never reach the gate.
  const countShort = nContent === 0;
  // Gate floor is FTS_MIN_COVER, capped by how many tokens can actually count, so a
  // single-content-word (or all-short) query falls back to cover≥1, never gated empty.
  // Note: an all-short MULTI-token query (e.g. "ăn ở") still needs cover≥2 — exact
  // parity with the pre-content-token behavior (which counted all tokens at min(2,len)).
  const coverPool = countShort ? queryTokens.length : nContent;
  const minCover = Math.max(1, Math.min(FTS_MIN_COVER, coverPool || 1));
  const out: FtsHit[] = [];
  for (const r of rows) {
    if (coverage(queryTokens, r.body, countShort) < minCover) continue;
    out.push({ id: r.id, date: r.date, time: r.time, bm25: r.bm25 });
    if (out.length >= limit) break;
  }
  return out;
}
