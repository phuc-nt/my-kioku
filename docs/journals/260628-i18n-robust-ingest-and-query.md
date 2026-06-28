# i18n: Unicode canonicalization at index/query layer

**Date:** 2026-06-28 · **Branch:** main · v0.3.0 released
- `5e4e854` fix(search): canonicalize Unicode (NFC) before folding and tokenizing — Phase 1
- `c80894f` feat(search): NFC-canonicalize ingest keys; add prefix and phrase recall — Phase 2
- `1526f34` docs(skill): add agent language-preservation rule; release 0.3.0 — Phase 3

## What happened

Shipped Unicode normalization (NFC) throughout the search pipeline: ingest, query, FTS index. Validated against production vault (21 files, ~95% Vietnamese, zero observed search pain before). Brainstorm → plan → cook → test → review → commit cycle on REAL data. Three phases; three rounds of code review caught latent defects; all fixed; released.

## The core strategy: minimal + defensive

Did **not** ship stemmer or word-segmentation. Real vault data: zero cases of stems or hyphenation breaking search. Both would corrupt Vietnamese syllables (phở ≠ phòng; word-segmentation adds deps, can fail on mixed VI/EN text). YAGNI + KISS: guard with **NFC canonicalization only**, tune prefix MIN_PREFIX_LEN by live test.

Chose **NFC at index/query layer**: markdown bodies stay byte-verbatim (project contract); only structured values (entity names, link targets, mood, tags, verbs) and FTS index get normalized. Single `fold()` function is the normalize point: NFC → NFD → strip marks → đ→d → lowercase. (DRY.)

## Bugs caught + fixed (the value)

**Phase 1 code review** — latent NFD defect on QUERY: query sanitizer split on `[^\p{L}\p{N}]+` BEFORE folding. In decomposed (NFD) form, a combining mark is neither letter nor number, so it acted as a separator → "đình" became "đi"+"nh" → 0 hits. Fix: NFC before split.

**Phase 2 code review** — SAME defect class on INGEST: NFD relation verbs / moods failed strict `\p{L}` regexes (silently dropped); link targets vs entity names byte-mismatched across NFC/NFD (silently broken graph edges). Fixed by NFC-ing all structured values before store.

**Phase 2 code review** — real correctness gap: changing the STORED canonical FORM (not just schema shape) without bumping SCHEMA_VERSION. A vault upgraded in place with lazy-sync (per-file mtime) would end up with a MIXED NFD/NFC index → silently broken edges. Latent on the NFC prod vault, but a real contract violation on disposable-index rebuilds. Fix: SCHEMA_VERSION 5→6 (forces clean rebuild). **Lesson: bump SCHEMA_VERSION when stored canonical FORM of a value changes, not only when schema SHAPE changes.**

## Validation

Per-phase: code → test → fix → code-review → commit → journal. Test count 226→241; tsc clean. Real-data E2E each phase on production vault copy (`~/kioku-vault`):
- Auto-migrate confirmed (user_version 4→5→6 ✓)
- NFD "gia đình" 0→20 hits (found in body) ✓
- phở back to 7 exact (folded eq not prefix-polluted) ✓
- Entity joins identical for composed/decomposed forms ✓
- Markdown git-clean ✓
- Disposable rebuild byte-identical ✓

## Decision record

| What | Why | Trade-off |
|------|-----|-----------|
| NFC at layer, not body | Preserve markdown verbatim (core contract) | Adds two normalize steps (ingest/query) — negligible perf |
| No stemmer | Zero observed pain, would corrupt VI syllables | Future English content may want stemming (deferred) |
| No word-segmentation | VI is syllabic; EN text in VN vault is minimal | Intra-word search (e.g. "deadline" → "deadl") handled by prefix (not segmentation) |
| prefix MIN_PREFIX_LEN = 4 | Tuned live: single-syllable VI ≤3 chars (phở), prevents cross-syllable collapse (phở→phòng flood); long partials still do search-as-you-type | Exact 3-letter shorthand (bố, mẹ) requires full word, not prefix; acceptable |
| SCHEMA_VERSION 5→6 | Force rebuild on upgrade; don't trust lazy-sync with form changes | All prod vaults rebuild on first access (one-time cost, then cached) |

## Unresolved questions

1. **Is NFC-at-rest a hard guarantee at every write path?** Or could an NFD vault appear (other OS, future import)? If hard-guaranteed, the ingest-NFC + SCHEMA-6 fixes are defensive; if not, they close a latent data-completeness bug.
2. **Case-variant duplicates** in production vault (Mẹ/mẹ, Bố/bố) — observed during validation, out of scope, candidate for living-loop merge-pass. Not caused by this work; note for future.
3. **openclaw dogfooding** — my-kioku now ready for agent consumption; next gap is wiring the agent to use it.
