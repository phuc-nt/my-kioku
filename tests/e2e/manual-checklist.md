# my-kioku — Manual E2E Checklist (real openclaw data)

Run against the **real** kioku-lite markdown folder
`~/.kioku-lite/users/companion/memory/` (177 blocks across 4 files).
The automated E2E (`e2e-import-recall-reflect.test.ts`) uses a deterministic
fixture; this checklist exercises the real data and Obsidian.

## Setup

```bash
VAULT=~/kioku-vault          # production vault (git-able, outside the openclaw workspace)
SRC=~/.kioku-lite/users/companion/memory
my-kioku init --vault "$VAULT"
```

## Steps

- [ ] **Import** — `my-kioku import --vault "$VAULT" --from-kioku-lite "$SRC"`
      Expect: `blocks=177 entries_created=68 skipped_duplicate=109 skipped_bad=0`.
      (The source repeats many text blocks; content-hash dedup → 68 unique, matching
      the legacy SQLite DB's 68 memories.)
- [ ] **Idempotent** — run import again → `entries_created=0`, all skipped duplicate.
- [ ] **Recall (FTS)** — `my-kioku recall --vault "$VAULT" "Techbase"` → several hits.
      Try diacritic-free queries: `Nhat Ban`, `phuc`, `vo con` → all return hits.
      KNOWN LIMIT: `đ`-words (e.g. "gia đình") do NOT match the `d`-form via FTS —
      SQLite `remove_diacritics 2` treats `đ` as a distinct base letter. Entity-name
      matching folds `đ→d`; body FTS does not. Acceptable for v1.
- [ ] **Reflect** — `my-kioku reflect --vault "$VAULT" --since 2020-01-01`
      Expect: `entries_without_links` ≈ 68 (the living-loop baseline — imports carry
      no wikilinks by design; the agent backfills them over time).
- [ ] **Digest** — `my-kioku recall --vault "$VAULT" --digest` → JSON well under 500 tokens.
- [ ] **Open in Obsidian** —
  - [ ] Graph view: right after import it is mostly isolated notes (no wikilinks yet).
        Structure only appears AFTER the agent backfills links over several reflect
        cycles — do NOT expect a rich graph immediately.
  - [ ] Dataview: a `mood::` table renders across daily notes.
  - [ ] Backlinks resolve once entities are linked.
- [ ] **Living loop (smoke)** — write a few entries WITH `[[links]]` via `remember`,
      reflect again, confirm `unknown_type_entities` and `suggested_actions` populate.
- [ ] **Disposable** — delete `$VAULT/.kioku/index.db*`, run `reindex`, re-run a recall
      → identical results.

## Comparison vs legacy kioku

- [ ] Run 3 of the same queries on legacy kioku and my-kioku; note quality diffs
      (verbatim preservation, diacritic handling, entity recall once backfilled).

## Notes

- Production vault `~/kioku-vault` is git-able and lives OUTSIDE the openclaw
  workspace (validation decision).
- The graph being empty right after import is expected and by design — the KG is
  grown by the agent (living loop), not imported.
