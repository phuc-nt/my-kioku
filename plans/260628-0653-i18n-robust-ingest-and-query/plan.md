---
title: "i18n-robust ingest & query (NFC guard + prefix + phrase boost)"
status: pending
created: 2026-06-28
slug: i18n-robust-ingest-and-query
---

# i18n-robust ingest & query

Make ingest/query robust for an EN-aware-but-VI-dominant diary **without**
over-engineering. Grounded in real-vault data: 21/21 files already NFC, ~95% VI,
no EN prose, zero observed pain → this is a forward-looking guard + better recall
UX, not a fix for a current bug.

**Decisions (locked in brainstorm):**
- Markdown stays **verbatim** — all normalization is index/query-layer only.
- `fold()` is the single normalize point (DRY); changes go there + the sanitizer.
- **No** EN stemmer, **no** VI word-segmentation, **no** language detection (YAGNI —
  0 real cases, would corrupt VI tokens, adds deps).
- SCHEMA_VERSION bump → disposable drop-rebuild (proven zero-risk twice).

Brainstorm context: chose Approach **B** (minimal guard + smarter query); NFC at
**index only** (markdown verbatim).

## Phases

| # | Phase | Status | Scope |
|---|-------|--------|-------|
| 1 | [NFC guard in fold()](phase-01-nfc-guard-in-fold.md) | pending | 1-line normalize; SCHEMA bump; symmetry tests |
| 2 | [Prefix search + phrase boost](phase-02-prefix-search-and-phrase-boost.md) | pending | sanitizer last-token `*`; recall phrase bonus |
| 3 | [Agent multilingual guidance (docs only)](phase-03-agent-multilingual-guidance.md) | pending | SKILL.md prompt: keep user language, don't translate |

Each phase runs the standard cadence: **code → test → fix → code-review → commit → journal.**

## Key dependencies
- Phase 1 bumps SCHEMA_VERSION; Phase 2 builds on the folded index. Do 1 → 2.
- Phase 3 is doc-only, independent (can run anytime, no SCHEMA impact).

## Out of scope
- EN stemming / Porter / Snowball.
- VI word segmentation (dict/model based).
- Per-language tokenizers, language tags on entries.
- NFC into markdown (verbatim contract).
