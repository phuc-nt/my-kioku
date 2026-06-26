# Phase 5 — Recall Command

**Date:** 2026-06-26 · **Commit:** 9edacf5 · **Branch:** feat/v1-vault-memory-cli

## What shipped

The single read command: FTS5 BM25 + entity-aware expansion + time filters + `--digest`.

- `recall "q" [--from --to --since --limit]`, `recall --entity X`, `recall --digest`.
- Query sanitizer wraps each `\p{L}\p{N}` token in quotes → every FTS operator neutralized (no crash).
- `fold()` (NFD + strip marks + đ→d) → "Hung" matches "Hùng" in entity expansion.
- Digest ~150 tokens (target <500). Lazy sync runs before every read.

## Key decisions / learnings

- **Code review caught a Critical the 99 tests missed: BM25 normalization was inverted.** SQLite `bm25()` returns more-negative = more-relevant, so `|bm25|` is largest for the *best* match. My `score = 1 - norm` formula gave the best match score ≈ 0 → **ranked best matches LAST**. Tests passed because results still *returned* — only the ordering was wrong. Reviewer proved it with a dense-vs-sparse corpus. Fix: `score = norm` (best → ~1). Re-verified: dense "táo" → score 1.0, sparse → 0.498.
  - This also fixed H1 (entity-only 0.3 was outranking strong FTS hits scoring ~0).
- **M2**: entity-expansion per-entity recency cap now applies *within* the date window (range pushed into SQL) — a `--since 7d` recall no longer loses in-range entries to newer out-of-range ones.
- **M1**: renamed `total_mentions` → `total_mentions_all_time` so agents don't confuse a lifetime count with a range-scoped result.
- FTS robustness (14/14 operator-injection probes safe) and `fold()` Vietnamese coverage were **verified-correct** by the reviewer — the #1 crash-robustness requirement is met.

## Verification

100 tests, `tsc` clean. Smoke: entity expansion (query "Hùng"→3 entries + context), digest 608 bytes/~152 tokens, dirty query `"*^(`→no crash, C1 ranking (dense > sparse) re-verified live.

## Unresolved

- M3 (accepted v1): `--since` silently overrides `--from/--to` (precedence, no warning).
- L1/L2 (accepted): per-hit N+1 hydration + load-all-entities in expansion — fine at personal scale, scaling ceiling noted.
