# Vector Deferred — FTS-OR + Coverage Gate Achieves 0.962 Recall

**Date**: 2026-06-29
**Severity**: Medium
**Component**: Search (fts-search.ts, benchmark compliance S4)
**Status**: Resolved (implemented, code-reviewed, 249 tests pass)

## What Happened

Third-party benchmark round 1–3 flagged my-kioku raw-NL recall at 0.17 (vs kioku-lite vector 0.74). Suggestion 1A: add vector index. Phase-0 spike investigated transformers.js + e5-small/large embeddings; discovered critical blocker + simpler lever — deferred vector, shipped FTS-OR instead.

## The Brutal Truth

Vector looked like the obvious fix. Found it _wasn't_. Spike unblocked by running real experiments, not reasoning. Discovered that:
- Vector hallucinate top-k for absent topics (S4 guard violation, exactly kioku-lite's failure mode the benchmark forbids)
- FTS had the real defect: implicit-AND on enriched queries choked recall (enriched R@3=0.154)
- FTS-OR + coverage gate beat vector (0.962 vs 0.923) with zero deps

The frustrating part: the research doc claimed "transformers.js is WASM, no native addon" — false. transformers.js is onnxruntime-node, ~380MB binary, `bun pm trust` postinstall blocker, breaks my-kioku's single-dep-yaml identity. Would have burned 25–35h shipping a feature that fails the S4 guard.

## Technical Details

### Phase-0 Spike (transformers.js v4 + e5 embeddings)
- e5-small (384d): raw-NL R@3 0.17→0.846, enriched 0.923
- e5-large (1024d): raw-NL R@3 0.85, enriched 0.924 (margin too small, small wins)
- **BLOCKER**: Gold cosines (0.83–0.94) overlap absent-topic top-1 cosines (0.79–0.84; "Singapore"/"Tesla"/"scuba" absent from corpus). No threshold preserves true-negative guard. Relative margin gate also overlapped. Pure-vector → hallucination on absent topics.
- **IDENTITY**: onnxruntime-node native dep blocks postinstall needing `bun pm trust`. Breaks my-kioku.
- **THE PIVOT**: Simulated FTS at 3 enrichment levels. Implicit-AND (original) gave enriched R@3=0.154. FTS-OR + cover≥2 gate: enriched R@3=0.962. Verified natively: "Singapore" (absent) → empty set (S4 holds).

### Commit 8e26d31 (Shipped)
- **src/search/fts-search.ts**: `sanitizeFtsQuery` joins folded tokens with OR (was AND). New `coverage()` helper. FTS_MIN_COVER=2 gate in `ftsSearch`; single-token queries fall back to cover≥1. Coverage mirrors MATCH prefix-`*` semantics for last token.
- **resources/SKILL.md**: "Enrich the query first" guidance (pronoun→[[Name]], add entities/synonyms, keep user's language) + anti-pattern.
- **docs/integration-guide.md, CHANGELOG.md**: Updated.
- **Tests**: fts-search.test.ts (OR-join assertions); new recall-fts-or-coverage.test.ts (OR recall lift, coverage gate drops cover=1, single-token fallback, S4 absent→empty). 249 pass, tsc clean.
- **Code review**: DONE. All 5 guards (S1–S5) hold. Empirically confirmed bm25 ranks coverage above single-token spam; limit×4 over-fetch safe.

## What We Tried

1. **Initial approach**: Accept vector recommendation, implement transformers.js.
   - Blocked by native dep + S4 guard violation. Rejected.

2. **Spike**: Run real e5-small/large embeddings on actual benchmark corpus (VI corpus, ~8k docs).
   - Found: hallucination + identity blocker. Pivoted to FTS analysis.

3. **Real fix**: Flip FTS to OR-match, add coverage gate (min 2 terms).
   - Achieved 0.962 recall, passed S4, zero deps, beats vector.

## Root Cause Analysis

FTS was literally AND-ing all tokens, so longer enriched queries (more tokens) had fewer docs matching ALL. The agent does enrich (pronoun→name, add synonyms), so queries grew, recall tanked. Vector hides this by searching embeddings, but without a true-negative gate, it hallucinates.

Why the research doc was wrong: transformers.js repo market-speak says "WASM" but onnxruntime-node is the runtime dep, and it's a ~380MB native binary for all platforms.

## Lessons Learned

1. **Red-team + spike > reasoning alone**. Discovered the research doc's factually wrong claim and the guessed threshold (MIN_COSINE=0.30) BEFORE vector code was written.

2. **S4 guard is non-negotiable**. Pure-vector without a true-negative anchor fails the benchmark's own test §7 (absent-topic recall). Any feature that can't prove absence is broken for my-kioku's use case.

3. **Identify the real lever**. The benchmark symptom (low recall) masked the root (AND semantics + enrichment). Fixing the root beats adding orthogonal machinery.

4. **Identity matters**. A single-dep-yaml architecture is load-bearing. A 380MB onnxruntime-node addition isn't free; it breaks reproducibility + complicates CI/CD.

## Next Steps

- **Vector**: Backlog as optional FTS-anchored re-rank only (phase-06, marked DEFERRED). If revisited, MUST anchor to FTS (use FTS to prove absence before re-ranking).
- **Active phases**: forget (privacy), concept-bridge, superseded-fact (SCHEMA 6→7 owner), digest body.
- **P2**: Multi-topic `;`-split clause indexing (unresolved: real VI viability).

## Unresolved Questions

- Coverage-gate threshold tuning: Is cover≥2 optimal vs live benchmark? Current spike used static corpus; live ingest may shift bm25 ranks.
- Multi-topic `;`-split viability: Does real VI corpus have significant semicolon-delimited multi-topic entries? If sparse, may not justify phase work.
