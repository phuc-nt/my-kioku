---
phase: 1
title: "NFC guard in fold()"
status: pending
priority: P2
effort: "1h"
dependencies: []
---

# Phase 1: NFC guard in fold()

## Overview
Add `.normalize("NFC")` at the start of `fold()` so any input form (composed,
decomposed, mixed) collapses to one canonical shape before mark-stripping. Index
and query both pass through `fold()` → automatically symmetric. Markdown untouched.

## Requirements
- Functional: `fold(x)` gives identical output for the NFC and NFD forms of the same
  VI string. Index stores `fold(body)`; query folds the same way → no silent miss.
- Non-functional: zero markdown change (verbatim contract); zero new deps; <200 LOC.

## Architecture
`fold()` is the single normalize point used by FTS index ([indexer.ts](../../src/index/indexer.ts)),
FTS query ([fts-search.ts](../../src/search/fts-search.ts)), and entity expansion
([entity-expansion.ts](../../src/search/entity-expansion.ts)). One edit fixes all three.

Order matters: `NFC` first (gather any half-composed sequence), then `NFD` (split
marks deterministically), then strip marks + đ→d + lowercase. NFC→NFD is idempotent
for already-NFC text (the 21/21 current files), so this is free for today's data and
a guard for future sources (macOS NFD paste, other keyboards, Telegram changes).

SCHEMA_VERSION bump 4→5 ([db.ts](../../src/index/db.ts)) → openDb drops+rebuilds the
disposable index. No data risk (proven by the đ-fold migration).

## Related Code Files
- Modify: `src/lib/diacritics.ts` (add `.normalize("NFC")` before NFD; update comment)
- Modify: `src/index/db.ts` (`SCHEMA_VERSION = 5`)
- Modify/Create test: `tests/index/fts-vietnamese.test.ts` (add NFC/NFD-equivalence case)
- Add test: `tests/lib/diacritics.test.ts` if absent (fold idempotence + NFC/NFD equality)

## Implementation Steps
1. `src/lib/diacritics.ts`: prepend `.normalize("NFC")` to the chain; update the
   header comment to state NFC-then-NFD rationale.
2. `src/index/db.ts`: `SCHEMA_VERSION = 5`.
3. Add a test: take a VI string, build its NFC and NFD forms, assert
   `fold(nfc) === fold(nfd)`; assert `fold(fold(x)) === fold(x)` (idempotent).
4. Add an index-level test: index an entry whose body is NFD-formed; a no-accent
   query still hits (proves index symmetry through fold).
5. `bunx tsc --noEmit` + `bun test`.

## Success Criteria
- [ ] `fold(NFC) === fold(NFD)` for VI samples (đ, ơ, ề, ữ).
- [ ] Existing 226 tests still pass; tsc clean.
- [ ] E2E: production vault auto-migrates 4→5; `recall gia dinh` still → 20; rebuild
      disposable identical; markdown git status clean.
- [ ] code-reviewer: no Critical/High; verbatim contract confirmed intact.

## Risk Assessment
- Risk: NFC changes some exotic codepoint unexpectedly. Mitigation: fold output is
  only used for the index, never written to markdown — worst case is a search miss,
  caught by the regression E2E.
- Risk: SCHEMA bump forgotten → stale index. Mitigation: the test in step 4 fails if
  the index wasn't rebuilt with the new fold.

## Cadence
code → test (tester) → fix → code-review (code-reviewer) → commit (git-manager) → journal.
