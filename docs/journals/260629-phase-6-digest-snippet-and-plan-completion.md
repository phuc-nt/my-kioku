# Phase 6: Digest Snippet & Benchmark-Improvements Plan Closure

**Date**: 2026-06-29 12:40
**Severity**: Low (refinement)
**Component**: Recall subsystem, digest preview body
**Status**: Resolved

## What Happened

Phase 6 closed the benchmark-improvements plan. The spec claimed `recall --digest` returned entries with an EMPTY body, but static verification showed the code already returned `first_line`. The real gap: a single line is **useless as a preview** when entry substance lives on lines 2+. Example: Vietnamese entry with title "Đi cà phê sáng." (line 1) but the actual insight "họp với Hùng về tăng lương" (line 2). A SessionStart hook got an uninformative preview and had to issue a second recall command.

**Fix deployed**: Added a `snippet` field (first ~2 non-blank lines, ≤280 chars) returned ADDITIVELY alongside `first_line`. Display-only, derived from verbatim body. Keeps backward-compatibility per the envelope's "tolerate additive fields" contract. Code-review SHIP; adopted reviewer's suggestion to make the token-budget guard a real worst-case (5 long multi-line entries < 2500 bytes) instead of fixture-specific bounds.

**Commit**: dca8b37. **Tests**: 276 pass.

## The Brutal Truth

This plan started promising to implement vector embeddings (the benchmark's headline recommendation). Instead, we *deliberately chose not to*—and that disciplined call saved 25–35 engineering hours and kept the product's S4 non-negotiable guard intact. The frustration of not shipping what was asked for is real, but the bigger frustration would have been shipping something that fails the product's own true-negative safety guard and then having to rip it out.

## Technical Details

**Digest body gap**: Sessions receive entry previews via `recall --digest`. Before Phase 6, the preview was `first_line` only. For entries with structure (title + substance on separate lines), this created a useless preview loop: agent sees "Đi cà phê sáng." and has no context, so it re-invokes recall with `--full` to get the real meaning.

**Solution**: 
- `snippet` field extracts first ~2 non-blank lines from body verbatim
- Capped at 280 chars to keep payload compact
- Returned alongside `first_line` (not replacing it, per envelope contract)
- Display layer chooses which to render; code layer treats both as valid
- Tested with 5 long multi-line entries, verified < 2500 bytes in worst case

**Code review input**: Reviewer suggested moving token-budget test from fixture-specific bounds (which don't reflect real-world patterns) to a real worst-case guard. Adopted; test now uses genuinely long entries.

## What We Tried

1. **Initial investigation**: Traced why sessions re-call despite digest existing → `first_line` is too narrow
2. **Vector alternative considered**: The benchmark's headline (add cosine-distance search) would have required:
   - ~380MB onnxruntime native dep (breaks "single yaml" identity)
   - Threshold selection for true/false positives (R@3 cosine scores for real matches and absent topics overlap → S4 guard fails)
   - 25–35h engineering for ~0.04 R@3 gain (0.96 FTS-OR+enrichment vs ~0.92 vector)
3. **Additive snippet field**: Low-risk, backward-compatible, solves the immediate problem without new dependencies

## Root Cause Analysis

**Why was digest broken?** The spec and code both existed, but neither captured that a one-line preview is insufficient for entries with multi-line structure. The design assumed entries are single-line facts; reality has title + depth.

**Why did the plan almost go down the vector path?** External benchmark authority + "vector search" sounds like a product win. But a red-team spike early in the plan forced adversarial verification on real data: installed real embeddings, ran real VI corpus, computed real recall scores, and discovered S4 overlap. That spike cost ~6h but prevented a 30h false-positive move.

## Lessons Learned

1. **Adversarial verification of external recommendations is force-multiplier work.** The plan's highest-ROI move was NOT building the suggested feature—it was proving it wouldn't work *before* the implementation tax. A spike that kills a bad path saves 25–35h later.

2. **Single-line previews break for multi-line data.** Future: Always include a snippet/excerpt field in list responses, not just an ID or first line.

3. **Additive API fields are the right pattern for compatibility.** Returning both `first_line` and `snippet` cost nothing, breaks nothing, gives callers a choice.

4. **Worst-case guards should use real data, not fixtures.** Test payload size with actual long entries, not synthetic minimums.

## Plan Arc Summary (Benchmark-Improvements Completion)

The full plan shipped:
1. **Query-enrichment skill guidance** + FTS-OR ranking (recall lift to 0.96 R@3)
2. **Forget command** (privacy gate; caught redact-neighbor bug in code-review)
3. **Concept-bridge reflect suggestions** (vector-free graph growth)
4. **Superseded-fact / latest-fact** (SCHEMA 6→7, H5 DERIVED_TABLES single-source)
5. **Digest snippet** (this phase)

**Deferred by design**:
- Vector embeddings (FTS-anchored re-rank backlog; S4 guard too precious to compromise)
- Multi-topic clause indexing (P2 priority)

**Remaining work**:
- ~10 unpushed local commits (awaiting user review/push)
- Vector as optional re-ranker only (if ever wanted; requires FTS as anchor)
- P2 multi-topic clause work (depends on feedback)

---

**Status**: RESOLVED
