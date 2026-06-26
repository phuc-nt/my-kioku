# Phase 7 — Utilities (import / merge / watch)

**Date:** 2026-06-26 · **Commit:** c5294fa · **Branch:** feat/v1-vault-memory-cli

## What shipped

The lifecycle utilities: `import --from-kioku-lite` (markdown-folder migration), `entity merge`, `watch`.

- **import**: scans a kioku-lite markdown folder, one entry per `---\n<yaml>\n---\n<text>` block; text verbatim, NO wikilinks (KG backfilled later); idempotent via content-hash log.
- **entity merge B --into A**: rewrites `[[B]]→[[A]]` across journal/insights/entities, merges aliases + Facts, deletes B, reindexes; `--dry-run` previews.
- **watch**: foreground poll loop around `syncIfStale`, JSON-lines, clean signal shutdown.

## Key decisions / learnings

- **Real-data validated**: import of the real openclaw folder = **177 blocks → 68 unique entries, 0 bad**. The 109 "duplicates" are repeated text blocks in the source — content-hash dedup collapses them to the same 68 the SQLite DB held. The markdown was *richer* (177) but the unique signal is 68.
- **Code review found 3 Critical silent-corruption bugs the 135 tests missed** — both highest-risk areas (one-time migration + source-of-truth merge):
  - **C1**: a stray `---` (horizontal rule) inside diary text desynced the block-pairing → silently dropped ALL following blocks. Fix: anchor block boundaries on `---` + a yaml-key lookahead, so a bare `---` stays inside the text.
  - **C2**: CRLF files imported as 0 blocks silently. Fix: normalize `\r\n` at parse entry.
  - **C3**: merge appended B's body without rewriting it → left dangling `[[B]]` in A, failing the plan's own "grep `[[B]]` = 0" criterion. Fix: run B's body through the rewriter first. Verified: 0 dangling.
  - **H1**: `stripHeading` `/m` flag stripped `## Facts` anywhere → orphaned bullets of multi-section entities. Fix: strip only a leading Facts heading.
  - **H2/H3**: corrupt `import-log.json` crashed import; log written once at end → partial-crash re-dup window. Fix: guarded JSON.parse, atomic temp+rename, per-file flush, per-block try/catch.
- **link-rewriter**: rewrote from a placeholder approach to a **span-walk** (copy fenced spans verbatim, rewrite the gaps) — no placeholder-collision risk, cleaner.

## Verification

141 tests, `tsc` clean. Real import re-run after the parser rewrite: still 177/68/0-bad (no regression). C3 grep across vault = 0 dangling. Watch: detects pre-existing + mid-watch file changes, clean stop. Reviewer confirmed watch WAL cross-connection isolation + resource handling correct.

## Unresolved

- M1 (intentional): text-identity dedup merges genuinely-distinct same-wording memories. Matches the DB's 68 unique; acceptable for v1. Fold timestamp into the hash only if real usage shows false merges.
