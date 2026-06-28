---
phase: 2
title: "Prefix search + phrase boost"
status: pending
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 2: Prefix search + phrase boost

## Overview
Two recall-quality wins on the existing folded FTS: (a) **prefix match** on the
last query token (search-as-you-type — `deadl`→deadline, `Quảng A`→Quảng An), and
(b) **phrase boost** — entries containing the full multi-word query contiguously
rank above entries with the same words scattered.

## Requirements
- Functional:
  - Last token of a sanitized query becomes a `prefix*` term; earlier tokens stay
    exact. `recall "phở Quảng A"` → matches "...Quảng An...".
  - For queries with ≥2 tokens, an entry matching the contiguous phrase gets a score
    bonus (ranks above scattered-token matches).
  - Single-token queries unchanged except trailing `*` prefix.
- Non-functional: no FTS injection regression (operators still neutralized); no new
  deps; recall JSON envelope shape unchanged; <200 LOC per file.

## Architecture
- **Prefix** lives in `sanitizeFtsQuery` ([fts-search.ts](../../src/search/fts-search.ts)).
  Current code strips user `*` (anti-injection) then quotes each folded token. New:
  quote all tokens as today, but append `*` to the LAST token's quoted form
  (`"deadl"*` is valid FTS5 prefix syntax). Min-length guard (≥2 chars) so a 1-char
  tail doesn't explode the match. Injection stays safe: we add a controlled `*`
  ourselves, never echo the user's.
- **Phrase boost** lives in recall scoring ([recall.ts](../../src/commands/recall.ts)).
  Reuse the existing additive-bonus pattern (like `RELATION_BONUS`): when the query
  has ≥2 tokens, run a second cheap FTS match for the folded contiguous phrase
  (`"pho quang an"`), and add a constant bonus to entries in that result set before
  final ranking. No new scoring framework — just one more bonus term.

## Related Code Files
- Modify: `src/search/fts-search.ts` (last-token prefix in sanitizeFtsQuery; maybe a
  small helper `foldedPhrase(raw)` for the phrase form — keep file <200 LOC)
- Modify: `src/commands/recall.ts` (phrase-bonus pass + constant; wire into ranking)
- Modify: `tests/search/fts-search.test.ts` (prefix sanitize assertions)
- Modify/Add: `tests/index/fts-vietnamese.test.ts` or a new recall test
  (`tests/search/recall-prefix-phrase.test.ts`) for prefix-hit + phrase-ranking

## Implementation Steps
1. `sanitizeFtsQuery`: after building the quoted folded tokens, append `*` to the
   last token if its length ≥2. Add a `foldedPhrase(raw)` helper returning the
   space-joined folded tokens wrapped as one FTS phrase string (`"a b c"`), or "" if
   <2 tokens.
2. Update `tests/search/fts-search.test.ts`: `sanitizeFtsQuery('deadl')` → `"deadl"*`;
   multi-token last-token-prefix assertion; 1-char tail → no `*`; operator-injection
   cases still neutralized.
3. `recall.ts`: define `PHRASE_BONUS` constant (size relative to existing bonuses —
   pick so a contiguous match outranks a scattered one but doesn't dominate entity
   links). When `foldedPhrase` non-empty, query it, collect entry ids, add bonus.
4. Add recall test: two entries, one with the contiguous phrase, one with the words
   scattered → contiguous ranks first. Prefix test: partial last word still hits.
5. `bunx tsc --noEmit` + `bun test`.

## Success Criteria
- [ ] `recall "deadl"` finds "deadline"; `recall "phở Quảng A"` finds "Quảng An".
- [ ] Contiguous-phrase entry ranks above scattered-words entry for the same query.
- [ ] Injection cases (`*`, `"`, `^`, NEAR, mixed đ) still neutralized — no crash.
- [ ] All prior queries unchanged (regression E2E: `gia dinh`→20, `phở`→7, `Hung`→2).
- [ ] tsc clean; full suite green.
- [ ] code-reviewer: no Critical/High; confirm no FTS injection path reintroduced.

## Risk Assessment
- Risk: prefix `*` too broad → noisy results. Mitigation: only last token, min-len 2.
- Risk: phrase bonus mis-tuned (dominates or no-ops). Mitigation: test asserts
  relative ordering, not absolute scores; tune constant against the assertion.
- Risk: phrase query double-counts or errors on single-token input. Mitigation:
  `foldedPhrase` returns "" for <2 tokens; recall skips the bonus pass.

## Cadence
code → test (tester) → fix → code-review (code-reviewer) → commit (git-manager) → journal.
