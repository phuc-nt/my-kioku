# Validation Session: my-kioku v1 Import Source Override

**Date**: 2026-06-12 09:15  
**Severity**: High  
**Component**: Architecture / Plan Validation  
**Status**: Resolved  

## What Happened

Ran `/mk:plan validate` on my-kioku v1 plan prior to implementation. Verification pass checked 5 environmental + technical claims. One claim **failed**; four passed. Then a 4-question interview produced **2 user overrides** that reshape Phase 7 (import utility) and project-wide naming.

## The Brutal Truth

Schema failure wasn't a bug—it was validation *working*. The real SQLite schema (`memories(content, date, timestamp)`, no `kg_nodes.confidence` or `kg_edges.valid_from/until`) was completely different from what Phase 7 claimed. Would've shipped broken code without this check.

The markdown folder override hit harder. Realized the markdown source is **richer than the database** (177 blocks vs 68 memories). This isn't just a migration choice—it's a fundamental architecture shift: **markdown vault becomes the source of truth, SQLite is purely disposable index**. This aligns the whole design with the "living loop" philosophy but means sacrificing knowledge graph structure at import time.

## Technical Details

**Verification results:**
- ✅ Bun 1.3.11 + bun:sqlite FTS5 Vietnamese: `unicode61 remove_diacritics 2` tokenizes "phở"/"pho"/"hung" correctly (SQLite 3.51.0)
- ✅ openclaw uses kioku-lite SQLite (not full kioku/ChromaDB): `~/.kioku-lite/users/companion/data/kioku.db` exists with 68 memories
- ❌ Phase 7 schema claims: Real schema is `memories(content, date, timestamp, ...)` — no `kg_nodes.confidence`, no `kg_edges.valid_from/until`
- ✅ Binary name `kioku` is free on machine
- ✅ Markdown folder `~/.kioku-lite/users/companion/memory/*.md`: 4 files, **177 blocks** (verified empirically)

**Decisions (2 overrides):**
1. **Import source = markdown folder** (not SQLite DB) — user override
   - Consequence: drop kg_nodes/kg_aliases/kg_edges import entirely
   - Imported entries have no wikilinks initially → reflect lint surfaces them → agent backfills gradually (design philosophy: lazy wikilink creation fits "living loop")
   - Phase 7 rewritten to parse markdown blocks instead of querying DB
2. **Binary name = `my-kioku`** (not `kioku`, even though free) — user override
   - Propagated: bin/build outfile, env var `MY_KIOKU_VAULT`, config `~/.my-kioku/config.json`
   - **Kept**: internal vault index folder `.kioku/` (short, scoped, no collision)

## What We Tried

- Planned import from SQLite: schema claims in Phase 7 seemed sound; validation proved wrong
- Recommended SQLite import (richer KG structure): user chose markdown folder instead (177 > 68 is compelling; living loop concept resonated)

## Root Cause Analysis

**Schema failure** was a documentation/assumption gap: Phase 7 was written against intuition about what columns *should* exist, not what kioku-lite's schema *actually* contains. Validation caught it before coding.

**Import source decision** was a discovery: markdown folder contains strictly more memories than the DB. Combined with the design goal ("vault is source of truth"), the override is rational—accept losing KG structure now to gain correctness and alignment with the obsidian-native philosophy.

## Lessons Learned

1. **Verify environmental claims before deep implementation** — "which kioku" + "bun --version" + "sqlite3 pragma compile_options" should be table-stakes, not late validation
2. **Schema assumptions ≠ reality** — queried the actual DB, not the code; found mismatch immediately
3. **Richer source + simpler semantics can beat structured data** — 177 unlinked entries are more valuable than 68 linked ones if the linking is incomplete or expensive to reverse-engineer. Lazy KG construction is defensible.
4. **Override decisions need backing evidence** — "markdown > DB by 109 entries" gave the override credibility; purely subjective preference would've been risky

## Next Steps

1. Phase 7 implementation: rewrite `import-kioku-lite.ts` to parse markdown blocks (YAML + text), not DB queries
2. Propagate `my-kioku` naming to all config/env/build scripts (Phase 1)
3. Phase 8: validate markdown folder parsing against real `~/.kioku-lite/users/companion/memory/` (not fixture)
4. Document in SKILL.md: agent must prepare for reflect lint reporting "entries_without_links" en masse; backfilling wikilinks is a background task, not Day 1

---

**Unresolved questions:**
- Should import create an `.kioku/import-log.json` for idempotency, or relabel by content hash? (Phase 7 detail, TBD in code)
- Does reflect lint count entries without *any* wikilinks as actionable, or only if recall found them but they stayed unlinked? (Phase 6 tuning)
