# Living loop on real data — agent-simulation harnesses

**Date:** 2026-06-27 · **Branch:** main · Code `a97d508` · Vault commits `82090aa`→`62c55bf`

## What happened

Ran the my-kioku living loop **for real** on the production vault (`~/kioku-vault`, 155
imported memories) using a cheap model (Qwen `qwen3.6-flash` via OpenRouter) to simulate
the cron agent — instead of spending main-loop tokens. Five passes, each a `tests/sim/`
harness driving one SKILL.md action.

## Passes (all on real data, ~$0.20 total)

| Pass | Harness | Result |
|------|---------|--------|
| import | (CLI) | 442 blocks → 155 entries, 0 dropped, 403 tags |
| backfill | `agent-backfill-sim` | +137 wikilinks, +72 entity stubs |
| merge | `agent-merge-sim` | judged 21 alias pairs → 4 merged, 16 kept apart |
| relations | `agent-relation-sim` | +2 emotional relations (trigger/joy) |
| classify | `agent-classify-sim` | all 68 entities typed (30 person/15 place/12 event/11 thing) |

Final lint backlog: **0 unknown-type, 0 broken-wikilinks, 0 orphans** (61 entries still
unlinked — the long tail with no clear entity).

## The core lesson: a small model cannot be trusted to preserve verbatim

Every pass tried to corrupt data; the **code-layer guards** caught all of it. This
empirically validates the project's #1 architectural choice — *CLI deterministic + agent
judges, with verbatim enforced in code, not trusted to the model*.

- **backfill (Critical, caught on production)**: the model rewrote `bố` → `father`
  (Vietnamese word replaced by the English tag). First run wrote it to disk before the
  guard existed; reverted via vault git. Fix: wrap as `[[father|bố]]` (alias form keeps
  the written word) + a post-edit `strip-wikilinks == original` assertion that rejects any
  edit that changed text. Full re-run: 4 such edits **rejected**, 0 reached disk.
- **relations**: the model proposed a garbage target with nested `[[ ]]` and a phrase →
  `validTarget` (no markup, must be a real substring of the body) rejected it.
- **merge**: string-similarity reflect proposed 21 pairs, many false (`Mei`≈`mẹ`,
  `Nhật`≈`Sinh nhật`, `Cám`≈`Tấm Cám`) — the model judged conservatively and kept 16 apart.
- **classify**: frontmatter-only (lowest risk); 68/68 sensible.

Across all 5 passes: **0 verbatim violations reached disk**. The vault git diff for every
body-touching pass is provably "only `[[ ]]` added / link targets rewritten, prose intact".

## Harness design (tests/sim/)

- `openrouter-client.ts`: key from `.env` (gitignored; `.env.example` template), per-call
  AbortController timeout (20s) so a slow model can't hang a run.
- Two-phase: fetch all decisions **concurrently** (pool of 6 — independent read-only LLM
  calls), then apply edits **serially** (writes to a daily file must serialize). This fixed
  an early sequential run that wedged.
- DRY-RUN default; `--apply` writes. Always run on a TEMP vault copy first.

## Also fixed (code)

**Lint case/diacritic mismatch** — `broken_wikilinks` + `orphan_entities` used exact SQL
name match, but recall's entity-expansion folds (`[[Mẹ]]` ↔ entity `mẹ`). Real vault showed
28 false-positive broken links. Now both sides fold in TS → consistent with recall;
`broken_wikilinks 28 → 0`. +5 regression tests.

## Outcome

my-kioku is no longer "code that works on the bench" — the production vault is a living
graph (68 typed entities, 137 links, emotional relations) grown by a cheap agent, with the
user's words provably untouched. The verbatim-at-code-layer architecture is the reason this
is safe to run on a real personal diary.

## Unresolved / next (incremental, not blocking)

- 61 long-tail entries with no clear entity to link (acceptable; agent can revisit).
- Only 2 emotional relations so far — more relation passes would enrich the emotional graph.
- Vault has no off-machine remote (local git only, by design for private memory).
