# Phase 6 — Reflect Command (the "living loop")

**Date:** 2026-06-26 · **Commit:** e58f1e2 · **Branch:** feat/v1-vault-memory-cli

## What shipped

The deterministic scan that drives self-improvement: lint + alias-similarity + mood/health stats + 4 insight detectors. CLI never calls an LLM — it surfaces candidates; the cron agent decides.

- 6 lint checks (unknown-type/orphan entities, broken wikilinks, entries without links/mood, missing check-ins).
- Jaro-Winkler alias detection (diacritic-folded) + token-containment.
- Mood/health: distribution, half-period trend, sleep/exercise.
- 4 insight detectors: mood_streak, co_occurrence, entity_spike, silence — each with evidence.
- `suggested_actions` (prioritized to-do) + `--md` Obsidian-readable report.

## Key decisions / learnings

- **Code review found 3 High the 112 tests missed:**
  - **H1 (TZ bug)**: `midDate()` parsed dates as local but emitted via `toISOString()` (UTC) → mid-date shifted a day in **Asia/Saigon (the primary user's TZ)** → corrupted *every* trend split. Fix: emit local `todayISO(mid)`.
  - **H3 (anti-hallucination)**: `entity_spike` + `silence` returned the entity **name** as evidence, not entry_ids — the contract requires every finding be verifiable to a real entry/file. The worst failure mode for this product. Fix: both now return real `entry_id`s.
  - **H2 (contaminated baseline)**: `entity_spike` baseline counted the period itself → suppressed genuine spikes on young vaults. Reworked to a robust count-based comparison (`period_n >= prior_n × FACTOR`, skip first-ever bursts).
- **M2**: mood_streak now only extends across **calendar-adjacent** recorded days (a gap day breaks the "N in a row" claim honestly).
- **L3**: pure Jaro-Winkler can't pair "Hùng" / "bạn Hùng" (length gap tanks the score) — yet that's a plan success criterion. Added token-containment so honorific/prefix aliases surface.
- **M1**: `--md` filename now second-precision (cron double-fire in same minute no longer overwrites).

## Verification

116 tests, `tsc` clean. Smoke (Asia/Ho_Chi_Minh TZ): mood_streak (4-day decline w/ date evidence), co_occurrence ([[Hùng]]+[[Mẹ]] w/ 5 entry_ids), entity_spike ("5× vs 1× before" w/ 5 entry_ids), falling trend, `--md` checklist. Spike correctly fires when period excludes prior mentions, stays silent when it doesn't.

## Unresolved

- entity_spike count-based (`period_n >= prior_n × 3`) chosen over rate-based after rate math proved too noisy on sparse vaults — thresholds are named constants, tune with real data (Phase 8 E2E).
