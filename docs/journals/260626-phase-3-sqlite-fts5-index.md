# Phase 3 — Disposable SQLite FTS5 Index

**Date:** 2026-06-26 · **Commit:** 32d9afd · **Branch:** feat/v1-vault-memory-cli

## What shipped

The disposable index layer: `bun:sqlite` schema + FTS5, full reindex, lazy mtime sync, `my-kioku reindex`.

- Schema: `files / entries / entries_fts(unicode61 remove_diacritics 2) / links / entities / daily_meta`.
- `indexer`: parse each vault file via Phase 2 core; external-content FTS row written in the same transaction as its `entries` row (no drift).
- `lazy-sync`: scan mtimes, reindex changed/new, remove vanished; `!=` compare (coarse-FS safe).
- `reindex` CLI command outputs `{files, entries, entities, links, skipped, ms}`.

## Key decisions / learnings

- **Code review verified the top risk (FTS5 external-content desync) is NOT present** — delete-FTS-by-rowid-before-deleting-entries is correct.
- **Critical found: journal rows were keyed by `date`.** Two files mapping to one date → second silently deleted the first's entries + broke disposability (order-dependent result). Fix: **key journal rows by `file`**, change `daily_meta` PK to `file`. Dup-date now hits the `entries.id` PK and **fails loudly** (reported in `skipped`) — first file's data survives. One-date-one-file stays the invariant; the failure is loud, not silent.
- **`fullReindex` is now one transaction** (atomic rebuild → mid-walk failure rolls back to the previous good index; also fewer fsyncs). A single malformed/unreadable file is **skipped, not fatal** (collected in `skipped[]`) — fits a hand-edited vault.
- Dropped a no-op `PRAGMA foreign_keys` (no FKs declared; integrity maintained by hand).
- Verified **wikilink target == entity name** alignment (incl. diacritics + parens) — load-bearing for Phase 5 entity expansion.

## Verification

67 tests, `tsc` clean. Smoke via CLI: `init → reindex` (5 files/2 entries/7ms), FTS `pho`→`phở` match, disposable rebuild identical. C1 dup-date loud-skip + first-survives reproduced live.

## Unresolved

- `daily_meta` is now per-file; a future "merge two same-date files" feature would need a dedup decision. Not needed for v1 (canonical layout is one-date-one-file).
