# Phase 8 — Adapters, E2E & Docs (v1 complete)

**Date:** 2026-06-26 · **Commit:** 31b567d · **Branch:** feat/v1-vault-memory-cli

## What shipped

The agent-facing surface + validation + docs — closes my-kioku v1.

- **SKILL.md**: Haiku-friendly protocol (one situation → one command), embedded in the binary.
- **SessionStart hook**: thin `recall --digest` wrapper for session context.
- **init --skill <dir> / --hook**: install the protocol + hook; never edits user settings.
- **Automated E2E**: 9-step lifecycle on a fixture; **real-data manual run validated** (177 blocks → 68 unique, 0 bad).
- **Docs**: system-architecture, codebase-summary, code-standards, README.

## Key decisions / learnings

- **Code review caught 2 Critical ship-blockers the 150 tests missed — and the reviewer proved them by compiling the binary:**
  - **C1/C2**: `init --skill`/`--hook` read `resources/` via `import.meta.dir`, which resolves to a virtual `/$bunfs/root` path in a `bun build --compile` binary → **ENOENT crash + dead hook path**. Since the binary IS the shipped artifact, this broke the phase's headline feature. Fix: **embed the resources** as `import … with { type: "text" }` (needs an ambient `*.md`/`*.sh` module decl for tsc); write the hook to a stable on-disk path. Added a **compiled-binary smoke test** so this can never regress silently.
- **H1**: the hook used `2>/dev/null` but `recall` writes its `{ok:false}` envelope to **stdout** → an error object leaked into every session's `additionalContext`. Fix: only forward `ok:true` output.
- **H2/M1/M2**: the init-adapters surface had 0 test coverage; E2E `run()` masked crashes as `{}`; step 8 ("disposable rebuild") only compared one count. Fixed: adapter tests (incl. compiled binary), `run()` throws on empty stdout, step 8 diffs a rich snapshot (moods/links/meta/FTS/digest).
- **M3**: SKILL.md reflect-action order didn't match `deriveActions` (missing "fix broken wikilinks"). Reconciled + softened to "handle by type."

## Real-data E2E results

177 blocks → 68 entries (0 bad). Recall (diacritic-free): Techbase→7, Nhat Ban→5, phuc→20, vo con→3. Reflect: 68 entries_without_links (living-loop baseline — imports are link-less by design). Digest: 53 tokens. **Known limit documented**: SQLite FTS `remove_diacritics 2` does NOT fold `đ→d` (treated as a distinct base letter) — entity-name matching folds it, body FTS doesn't. Acceptable for v1.

## v1 status

8/8 phases done. 153 tests, tsc clean, single binary builds & runs. 3 commands (remember/recall/reflect) + init/reindex/import/entity-merge/watch. The vault-is-database architecture works end-to-end on real data.

## Unresolved

- `đ`-word FTS body search (documented limit). Revisit if real usage shows it matters — would need a custom tokenizer or a folded shadow column.
