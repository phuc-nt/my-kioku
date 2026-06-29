# Superseded-Fact Schema Bump (v6→v7): Strict Field Parsing + Deterministic Reflect

**Date**: 2026-06-29 23:59
**Severity**: Medium
**Component**: Schema, parser, indexer, reflect detector, recall ranking
**Status**: Resolved

## What Happened

Shipped the superseded-fact phase (benchmark gap #3), enabling queries like "what's my current job?" to prefer newer facts over obsolete ones while preserving historical recall. A strict `superseded:: <date#ordinal>` leading field marks replacement relationships; non-conforming text stays verbatim in body (S1). Schema bumped 6→7 (drop-rebuild; existing vaults auto-migrate).

## The Brutal Truth

This was the most structurally complex phase: four systems touching simultaneously (parser, indexer, reflect detector, recall ranking) with interdependencies that could silently corrupt the index. The real nightmare was discovering that `fullReindex` and `dropAll` maintained SEPARATE hardcoded table-deletion lists — a configuration drift waiting to happen. Adding a new derived table to one path but not the other would leave stale rows alive, breaking the "rebuild clean from markdown" guarantee (S2). Found and fixed this design bug mid-review.

## Technical Details

**Index Schema Change (6→7):**
- New table: `superseded(entry_id, newer_id)` — deterministic pairs, ≥7 days apart, distinct entity IDs, no co-occurrence
- Parsed field stripped from stored body; only tiebreak logic consumes it
- Recall demotes superseded entries by rank (sort: score → supersededRank → recency), not score subtraction — "current" queries prefer newer, "old job" queries still find history

**Reflect Integration:**
- Surfaces `superseded_candidates` only when entities classify as employer/workplace/job/company (classification-gated)
- Deterministic pairing logic: anchor entity + 7+ day gap + distinct type + no co-occurrence
- CLI never auto-marks (agent confirms in language before writing field) — avoids false "fact replaced" claims

**H5 Fix — The Class Bug:**
```javascript
// Before: Two separate hardcoded DELETE lists → stale rows survive normal reindex
fullReindex(): DELETE FROM X, Y, Z ... // 8 tables
dropAll(): DELETE FROM A, B, C ... // different 8 tables

// After: Single exported source of truth
export const DERIVED_TABLES = ['superseded', 'fts_index', ...];
fullReindex(): DELETE FROM DERIVED_TABLES.map(t => t)
dropAll(): DELETE FROM DERIVED_TABLES.map(t => t)
```

This kills the entire class of "table addition drift" bugs, not just this instance.

## What We Tried

1. **Parser strictness**: Regex-validated leading field; free text in body stays literal ✓
2. **Deterministic vs. suggested**: Tested that reflect only surfaces candidates (agent confirms) ✓
3. **Schema migration**: Verified v6→v7 auto-migration on existing vaults (zero data risk) ✓
4. **Index rebuild guarantee**: Fixed `DERIVED_TABLES` single-source-of-truth (S2) ✓

## Root Cause Analysis

The schema bump was necessary but revealed deeper infrastructure rot: two independent code paths managing derived table state, no canonical list. This happens in systems that grow incrementally—each phase adds tables locally, nobody owns the global inventory. The v7 deployment forced the confrontation.

## Lessons Learned

1. **Derived state requires single source of truth**: Database tables, cache keys, index paths—own the full list in ONE place, inject it into all consumers. H5 pattern now scalable.
2. **S1 field strictness works**: Strict leading regex + verbatim body text allows deterministic parsing without language ambiguity. Reject fuzzy parsing early.
3. **Reflect as suggestion engine**: Never auto-mutate user facts—surface deterministic candidates, let the agent (which understands context) confirm. Avoids false "fact replaced" claims.
4. **Classification gates indexing**: Superseded logic only makes sense for employer/workplace/job/company. Gating on entity type prevents spurious pairs.

## Next Steps

- Phase 6 (digest body enrichment) active — low priority, cheap to ship
- Vector search deferred (P2); multi-topic clause also P2
- Monitor production for S1 edge cases (agent-written field variations)—current two Low findings documented; one fixed (shared_context display name), one left (invalid-but-shape-valid dates in agent fields = YAGNI to validate)
- 273 tests pass; all 5 code-review guards verified (v6→v7 migration + H5 normal-reindex-clears-stale-flag)

**P0+P1 complete:** Phases 1–5 shipped (enrichment, FTS-OR, forget, concept-bridge, superseded). Plan on track.
