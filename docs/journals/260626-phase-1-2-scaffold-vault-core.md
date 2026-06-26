# Phase 1+2 — Scaffold & Vault Core

**Date:** 2026-06-26 · **Commit:** 917696e · **Branch:** feat/v1-vault-memory-cli

## What shipped

Phase 1 (scaffold/config/init) + Phase 2 (vault core) of my-kioku v1. Bun + TypeScript, "markdown vault is the database", no index layer yet.

- CLI router (`node:util` parseArgs, no framework), JSON `{ok,data}|{ok,error,hint}` envelope, idempotent `init`.
- Vault resolution chain: `--vault` → `MY_KIOKU_VAULT` → `~/.my-kioku/config.json`.
- 6 vault modules, each <200 LOC, standalone (no index dep): frontmatter, wikilink-parser, entry-parser, daily-note, entity-note, vault-paths.

## Key decisions / learnings

- **Verbatim contract is the hard part.** Code review (DONE_WITH_CONCERNS) reproduced 2 Critical round-trip bugs the 49 green tests missed:
  - C1: entry prose containing a `## HH:MM`-shaped line got split into phantom entries.
  - C2: prose starting with `mood::` got swallowed into the mood field.
- **Fix = anchor parser to the deterministic append shape**, not to free-text heuristics:
  - A `## HH:MM` line is a heading only when **preceded by a blank line** (`appendEntry` always emits one). Inner prose lines can't be split out.
  - A `mood::` line is consumed only in a **strict shape** (`emotion` or `emotion/1-5`, no spaces); anything else stays in text verbatim.
- Also fixed: unvalidated-date crash/traversal (validate `isValidISODate` at path boundary, drop the lying tuple cast), entity-name traversal (reject dot-only names + resolve-under-vault guard), empty-mood `mood:: /3` malformed line, intensity bounded 1–5.

## Verification

55 tests pass, `tsc --noEmit` clean. C1/C2 re-reproduced through real file I/O → verbatim true, correct ordinal/entryId. Smoke test produced clean Obsidian-shaped markdown (frontmatter check-in + `## HH:MM` + `mood::` + wikilinks with Vietnamese/emoji).

## Deferred (accepted per plan)

- CRLF-saved notes not byte-verbatim vs `\n` rewrite (macOS target, low risk).
- `setCheckinMeta`/`updateMeta` use full-file write (not append) — drops YAML comments; round-trip comments are not required per plan.

## Unresolved

- entryId currently derived by re-parsing after append (couples id to parser correctness). Revisit if Phase 3 indexer needs a write-time counter.
