# Round 5 Gaps Closure — v0.5.0 Ready

**Date:** 2026-06-30 · **Commits:** 98eceb2, 150c554, 19ae977, 1c6b257, 24c09d1 · **Plan:** plans/260630-1400-my-kioku-v0.5.0-round5-gaps

## What shipped

5 phases closed the benchmark's Round-5 findings (§9). All changes are backward-compatible, no schema bump.

1. **Auto event-date (Phase 9A, P0):** Vietnamese date inference from entry body. New `src/lib/vietnamese-date-parser.ts` extracts "hôm 12/4", "hôm qua", "cuối tuần", "thứ 7 vừa rồi", ISO d/m/yyyy. Safety gate: bare d/m requires "hôm"/"ngày" context (blocks false positives like "3/4 cốc", "tỉ số 2/1", "v1/2"). Conservative: ambiguous → keep today; body never modified. Reply: `date_inferred_from` + year-guess warning. **Fix:** R5.4 scenario (agent forgot --date flag) now stamps correct date — the root cause of R5's time-range-query failures.

2. **#hashtag → tags (Phase 9B, P1):** Inline `#hashtag` in body now yields a tag row; token stays verbatim. Unblocks reflect's `concept_bridges` for agents writing #tags instead of structured `tags::`. Verified: 3 entries with `#thể_dục` now produce a bridge (was [] in R4.4).

3. **Entity-type filter (Phase 9C, P1):** Restored `--type` flag + entity list `[--type]` + reflect `entity_type_suggestions`. Entity type is lowercase 5-set (person, place, event, object, concept). Closes the gap where kioku-lite ranked higher (Phase C) — kioku now has type-aware recall too. S4-safe: no match → empty.

4. **Concise-reply rule (Phase 9D, P1, docs-only):** SKILL.md Golden rule #6 — reply concise, recall once, no sprawling tables. Fixes long-reply context-overflow bug from R4.4; also a backstop note on event-date inference. (This is correct prompt-design, not engine change.)

5. **Superseded current-intent (Phase 9E, P1):** A `current`/`now`/`hiện tại`/`bây giờ`/`đang` keyword in body now applies 0.5× ORDERING penalty to superseded entry, ranking newer fact above old fact without deletion. Ordering-only: old fact remains in history, unaffected by queries. **Fix:** R4.4 tiebreak-only didn't override lexical bias.

9D (auto-relations) DEFERRED: benchmark showed minimax-m3+ infers relations itself; KG-priming caused kioku-lite to fabricate 3/8 answers. Not worth building.

## Key decisions

- **Schema reuse:** All 5 phases reused existing columns/tables (`entries.date`, `tags`, `entities.type`, `superseded`). Zero schema version bump. Contrast v0.4.0 (6→7 bump for every phase).
- **Engine-vs-prompt split:** Benchmark's root lesson: **must-be-correct behavior (event-date, date parsing, exact tag matching) belongs in the deterministic engine; only context-dependent behavior (reply conciseness, query style) belongs in the prompt.** Cheap LLM agents read "pass --date" 73× and still forget. Can't fix with instructions alone.
- **Planner caught 3 stale assumptions** from benchmark spec by verifying against code: EntityType is exactly 5 values, no org/role; `relations::` frontmatter isn't indexed; no guard harness existed for round testing. This vetting loop prevented scope creep.

## Verification

- **Code:** 277 → 316 tests (+39). Every phase: code → test → inline self-review → commit. No external reviewer (code-reviewer subagent session limit mid-plan); adversarial testing included 10+ false-positive probes on date parser.
- **Regressions:** Zero schema migrations, 100% read-path compatible, all old entries parse unchanged.

## Next steps

- [ ] `git push` (commits local on main, awaiting user approval)
- [ ] Version bump to 0.5.0 + annotated tag
- [ ] Round-6 rebenchmark notes file (for comparison vs v0.4.0 baseline)

## Unresolved

- Auto-relations deferred (see above). If Round 6 data shows agents need KG priming to avoid hallucination, revisit with a different design (e.g., opt-in `--prime-relations` flag).
