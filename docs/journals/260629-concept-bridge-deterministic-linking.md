# Concept bridges: deterministic graph linkage without embeddings

**Date:** 2026-06-29 · **Phase:** reflect semantic-recall pipeline (benchmark gap 1B)
- `748c3ad` feat(reflect): concept_bridges detector; deterministic tag-variant folding + linking suggestions (not yet pushed)

## What happened

Shipped a deterministic concept-bridge detector that identifies recurring tags (≥3 entries, no current wikilink) and suggests the agent add `[[concept]]` links to bind them. No schema bump (read-only over tags/entries/links). The detector reuses existing reflect infrastructure (detector→report→deriveActions) and produces `concept_bridges` with cited evidence entry IDs. This closes a benchmark gap (R3.2: adding `[[thể dục]]` lifted recall 0→3 on that cluster).

## Strategy: semantic without embeddings

With vector embeddings deferred (cosine can't enforce S4 true-negative guard), the recall strategy now stacks three S4-safe levers:
1. **FTS OR-matching + coverage gate** (phase 4)
2. **Agent query-enrichment** (phase 4.5)
3. **Concept-bridge links** (this phase) — recurring tag-clusters that the agent steadily links, growing the graph

Together they hit benchmark recall targets without the 380MB native embedding dependency.

## Technical: deterministic tag folding

`src/reflect/concept-bridge.ts` folds tag variants (Thể Dục/thể dục) into one bridge; skips tags already an entity or already linked in majority of the cluster. Caps at MAX_BRIDGES=10.

**Code review caught a latent bug:** the module header claimed "deterministic" but `sort` by entry_count had no tiebreaker, and the tag⋈entries scan had no ORDER BY. Equal-count bridges could reorder run-to-run; near the cap, WHICH bridge was dropped could flip. Fixed: 1-line tiebreaker `|| a.concept.localeCompare(b.concept)`. Also aligned render-markdown interface to include `reason` for type consistency.

## Validation

266 tests pass. No E2E on real vault yet (concept-bridge is read-only suggestion; agent integration ships in phase 5).

## Decision record

| What | Why | Trade-off |
|------|-----|-----------|
| Tag-variant folding (not NLP) | Deterministic; no deps; matches user intent (tag names are explicit) | Misses semantic synonyms (e.g., "workout" ≠ "exercise" as tags); deferred to embedding phase |
| Majority-linked skip | Avoid noise (tag already connected); safe conservative gate | May miss bridges if a few entries lack the link; acceptable (agent can link gradually) |
| MAX_BRIDGES=10 | Prevent report spam on large vaults | Bridges outside top 10 by frequency are dropped; less common concepts deferred |
| LocaleCompare tiebreaker | Deterministic; alphabetical is stable | Doesn't reflect concept importance; acceptable (same-count tags are rare in practice) |

## Next

Phase 5: superseded-fact/latest-fact (owns the SCHEMA 6→7 bump — the only schema change in this plan), then digest body. Agent wiring follows post-phase-7.
