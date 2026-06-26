# Phase 4 — Remember Command

**Date:** 2026-06-26 · **Commit:** 2ed8af2 · **Branch:** feat/v1-vault-memory-cli

## What shipped

The single write command — the product's Haiku-friendly core. One `remember` call: append entry + auto-stub linked entities + incremental index.

- Text positional XOR `--stdin` (heredoc-safe), stored verbatim.
- `--checkin k=v,k=v` → frontmatter only (text optional).
- Strict mood (`emotion` or `emotion/1-5`); invalid → warning, not stored, text untouched.
- Alias-aware stubbing: linking a known entity's alias creates no duplicate stub.
- JSON output: `{date, time, entry_id, ordinal, mood, links, stubs_created, checkin?, warnings?}`.

## Key decisions / learnings

- **Code review caught 1 Critical + 1 High the 81 tests missed:**
  - **C1**: checkin-only `remember` (no text) wrote frontmatter but **never indexed it** — the re-index sat inside `if (text !== "")`. Invisible to recall/reflect until manual reindex → broke the "one command does everything" contract. Fix: hoist re-index out; track a `touchedPaths` set covering checkin OR text.
  - **H1**: `db.close()` in `finally` was **dead code** — `ok()`/`fail()` call `process.exit()`, which skips `finally`. WAL grew uncheckpointed (189–502 KB per write). Fix: a `closeDb()` helper that runs `PRAGMA wal_checkpoint(TRUNCATE)` then close, called on the normal path *before* `ok()`. Verified WAL → 0 after subprocess.
- **H2**: incremental index walked the whole vault to find 1–2 files → replaced with direct `statSync` of the touched paths (`vaultFileFor`). O(touched), not O(vault).
- **M1/M2**: checkin parser: empty value `sleep_hours=` silently became `0` → now skipped with warning; quote-stripping happened anywhere → now only strips a balanced *wrapping* pair (inner quotes literal).
- Body-verbatim invariant (leading whitespace, internal newlines, text starting with `## HH:MM`/`mood::`) **verified intact on disk** by the reviewer.

## Verification

84 tests, `tsc` clean. Heredoc `--stdin` smoke: Vietnamese + `"` + `'` + em-dash + emoji + multi-line preserved verbatim, 2 stubs, checkin merged. C1 + H1 both re-verified end-to-end via subprocess (checkin indexed; WAL=0).

## Unresolved

- L1 (accepted v1): case-variant links `[[Hùng]]` + `[[hùng]]` produce a dangling `links` row for the lowercase target on case-sensitive FS. Harmless for recall; revisit if it matters.
