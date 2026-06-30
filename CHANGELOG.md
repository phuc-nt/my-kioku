# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Round-5 (end-to-end agent) gaps. No new dependency; no schema change. Driven by the
lesson that a cheap model can't be trusted to pass flags — must-be-correct behavior
moves into the deterministic engine.

### Added

- **Auto event-date inference in `remember`.** When no `--date` is passed, the engine
  parses a Vietnamese date expression from the entry text (`hôm 12/4`, `ngày 12 tháng 4`,
  `hôm qua`, `tuần trước`, `cuối tuần`, `thứ 7 vừa rồi`, `12/04/2026`) and stamps it;
  year-less dates resolve to the nearest past year. Conservative: a bare `d/m` needs
  `hôm`/`ngày` context (so `3/4 cốc`, `tỉ số 2/1` are not dates), ambiguous phrases keep
  today, the body text is never modified. The reply carries `date_inferred_from` and
  warns when a year was guessed; explicit `--date` always overrides. Fixes Round-5's
  "every entry stamped today" timeline corruption without depending on the agent.
- **Inline `#hashtag` tags.** A `#hashtag` in the entry body now also yields a tag row
  (the token stays verbatim in the body), so `reflect`'s `concept_bridges` works for
  agents that write inline hashtags rather than `tags::` lines.
- **Filter/list by entity type.** New `entity list [--type person|place|…]` and
  `recall --type <type>` (a hard filter: entries linking an entity of that type; empty
  when none match). `reflect` adds `entity_type_suggestions` — a deterministic type guess
  (e.g. a relation target → `person`) for `type:unknown` entities, for the agent to
  confirm and write to frontmatter.

## [0.4.0] - 2026-06-29

Semantic-recall lift, no new dependency. A Phase-0 spike (real install of a local
embedding model + the benchmark VI corpus) showed a vector layer could not preserve
the true-negative guarantee under any cosine threshold (real-match and absent-topic
cosines overlap) and pulls a ~380 MB native dependency — so vector was deferred in
favor of the lever below, which beats it on the benchmark (R@3 0.96 vs 0.92) at zero
dependency cost.

### Added

- **Richer `recall --digest` entries.** Each `recent_entries` item gains a `snippet`
  (first ~2 lines, ≤280 chars) so a SessionStart hook injects usable context in ONE call
  instead of having to recall the entry again to see past line 1. `first_line` (≤100 chars)
  is kept for back-compat; the digest stays within its token budget (snippet bounded,
  5-entry cap). Display-only — derived from the verbatim body, markdown unchanged.
- **Superseded-fact / latest-fact.** A `superseded:: <date#ordinal>` leading field marks
  an entry as replaced by a newer one (strict shape — a free-text `superseded:: …` stays
  verbatim in the body). `recall` demotes a superseded entry **as a tiebreak** so a
  "current/now" query prefers the newer fact, while the old fact is never buried (a
  "what was my previous…" query still finds it); each result exposes a `superseded` field.
  `reflect` surfaces `superseded_candidates` (distinct same-type entities — e.g. employers
  — sharing a context, ≥7 days apart, never co-occurring) for the agent to confirm and
  mark. Index schema bumps **6 → 7** (new `superseded` table; a disposable drop-rebuild,
  so existing vaults auto-migrate with zero data risk). Both reindex paths (version-bump
  and normal) now clear derived tables from one shared list, so no table can leave stale
  rows.
- **`reflect` suggests concept bridges.** A new `concept_bridges` finding surfaces a
  recurring tag that spans ≥3 entries but isn't yet a `[[wikilink]]`, with a
  `add [[concept]] to N entries` action and cited evidence ids. The agent appends the
  link (the CLI never edits markdown) to connect the theme — a cheap, vector-free
  semantic-recall boost (it's the `[[thể dục]]` lift from the benchmark). Folded-variant
  tags merge into one bridge; tags already an entity are skipped.
- **`forget` command (privacy / right-to-be-forgotten).** `forget <id>` deletes one
  entry block; `forget --entity "X"` deletes every entry linking a person/place
  (accent-tolerant match). `--redact` keeps the `## HH:MM` heading and the
  mood/relations/tags but blanks only the verbatim body to a `[redacted DATE]`
  tombstone; `--dry-run` previews. Deletion is a markdown edit + reindex (markdown is
  the source of truth), and reuses the SHARED entry-block-range helper so a neighbor
  entry — even one whose body contains a pasted heading-shaped line — is never
  mis-cut. The response notes that later ids in the file are renumbered.

### Changed

- **FTS recall is now OR-matched + coverage-gated.** Previously every query token had
  to be present (implicit AND), so a longer/enriched query recalled *less*. Now an
  entry matching ANY query term surfaces, ranked by term coverage (bm25), with a
  ≥2-distinct-term gate to drop incidental single-word overlaps (single-term queries
  excepted). Big recall lift for natural-language/enriched queries; the true-negative
  guarantee is unchanged (a term that appears nowhere returns empty — no fabricated
  hits). Trades some precision for recall, which suits an agent that reads the top-k.
- **SKILL.md teaches query enrichment.** The shipped agent protocol now tells the agent
  to enrich a query before recall (pronoun→`[[Name]]`, add known entities + synonyms,
  keep the user's language) — pairs with OR matching for the recall lift.

## [0.3.1] - 2026-06-28

Publish & integration readiness. No runtime behavior change for existing users.

### Added

- **npm publish readiness** — `publishConfig.access=public`; `prepublishOnly` runs
  `tsc` + the test suite so a broken state can't publish; `typescript` is now a pinned
  devDependency (so `tsc` resolves during the npm lifecycle). The package ships TS
  source; `bunx my-kioku` runs it directly (no build step). Verified the tarball is
  secret-free (no `.env`) and contains only `src/`, `resources/`, README, LICENSE,
  NOTICE, package.json.
- **Bun-runtime guard** — `cli.ts` is a tiny entry that checks for Bun, then dynamically
  imports the real logic; running under Node prints a clear "requires Bun" message and
  exits non-zero instead of a cryptic loader error.
- **Integration docs** — `docs/integration-guide.md` (generic agent contract: the JSON
  envelope, commands/flags, exact data shapes, verbatim rule) and
  `docs/openclaw-integration.md` (SessionStart hook + cron reflect recipe). README gains
  an "Integrate with your agent" section and a Bun-required install story.

## [0.3.0] - 2026-06-28

Unicode-robust ingest & query (EN-aware, Vietnamese-first) + recall UX. Index-only
behavior; markdown stays verbatim. Schema bumps (4→6) are disposable drop-rebuilds, so
existing vaults auto-migrate on next open with zero data risk.

### Added

- **Prefix search (search-as-you-type)** — the last query token (folded length ≥4)
  matches as a prefix: `recall "deadl"` finds "deadline". Shorter complete words match
  exactly so a single-syllable Vietnamese word (phở→"pho") doesn't over-match (phòng).
- **Phrase boost** — an entry containing the whole query as a contiguous phrase ranks
  above one with the same words scattered (additive `PHRASE_BONUS`).
- **Agent language rule** — the shipped `SKILL.md` now tells the agent to keep the
  person's language verbatim, including mixed Vietnamese-English, and never translate
  names; only the entity `type:` field uses the fixed English vocabulary.

### Fixed

- **NFC canonicalization across ingest & query** — Vietnamese text in decomposed
  (NFD) form broke things: the query tokenizer split a syllable mid-character (a
  combining mark is not a letter, so "đình" became "đi"+"nh" → 0 hits), and on the
  ingest side a decomposed verb/mood failed the strict field regexes (relation/mood
  silently dropped) while link targets and entity names byte-mismatched across forms
  (broken graph edges). All structured values and the FTS index are now NFC-normalized;
  markdown bodies remain verbatim. Entity auto-stub dedup switches to `fold()` (NFC +
  accent + case), consistent with recall. Real-data E2E: NFD "gia đình" 0→20; existing
  queries unchanged; entity join identical for composed and decomposed forms.

## [0.2.1] - 2026-06-27

Vietnamese `đ`-fold in full-text search. Index-only fix — markdown untouched; the
schema bump (3→4) is a disposable drop-rebuild, so an existing vault auto-migrates on
next open with zero data risk.

### Fixed

- **FTS now folds `đ`→`d`** — SQLite's `unicode61 remove_diacritics 2` strips combining
  marks (ờ→o) but treats `đ` as a distinct base letter, so a diacritic-free query like
  "gia dinh" returned **0 hits** against bodies containing "gia đình" (96% of real
  entries carry `đ`). `entries_fts` is now a **standalone** FTS storing `fold(body)`
  (đ→d + strip marks) and the query is folded symmetrically. Display still reads the
  untouched `entries.body` (verbatim contract intact). Real-data E2E: `gia dinh` 0→20,
  `doc sach`→17, `duong`→11; no regression on accented/ASCII queries.

## [0.2.0] - 2026-06-27

Emotional relations (markdown-native typed edges) + richer migration. Additive: a
v0.1 vault re-indexes unchanged (schema bump 2→3 is a drop-rebuild).

### Added

- **Emotional relations** — typed edges written as inline entry lines after `mood::`:
  `joy::`, `trigger::`, `with::`, `eases::` (free-form, value = `[[wikilinks]]`).
  Stored in a derived, rebuildable `relations` table — not a graph DB.
- **`recall --relation <type>`** — filter by relation type (combine with `--entity`,
  `--since`, query). Relation targets rank above plain mentions (`RELATION_BONUS`).
  Recall output now always includes `relations` and `tags` per entry.
- **`tags::` inline field** — plain comma-separated tags, indexed in a `tags` table.
- **Reflect detectors** — `missing_emotional_relation` (strong-mood entries lacking a
  relation), `relation_summary` (top joy/trigger targets), `tags_to_convert` (tags not
  yet entities) → new `suggested_actions` for the living loop.
- **Migration upgrades** — `import --from-kioku-lite` now parses the `# Kioku —`
  heading and per-block `tags: [...]` (Python-list) into `tags::` lines, scans
  subfolders recursively, and falls back to the timestamp date when `event_time` is
  partial. Validated on a real 442-block Telegram backup (155 entries, 0 dropped).
- **Vault format-version marker** — `init` writes `vault-version.json` at the vault
  root (git-tracked, outside `.kioku/`) recording `{vault_format_version,
  my_kioku_version, created}`, so a future binary can detect an older vault and
  migrate it. v1.0/v1.1 share format version `1`. Distinct from the index schema
  version and the package version.
- SKILL.md teaches the relation/tags protocol; docs updated.

### Changed

- `SCHEMA_VERSION` 2 → 3 (adds `relations` + `tags` tables; one-time index rebuild).

## [0.1.0] - 2026-06-26

First release. An Obsidian markdown vault is the source of truth; SQLite FTS5 is a
disposable index that rebuilds 100% from the vault. No vector search.

### Added

- **Vault core** — markdown read/write: daily notes (`## HH:MM` entries, `mood::`
  inline field, frontmatter check-ins), entity notes, wikilink + frontmatter parsing.
  Entry text is stored verbatim.
- **SQLite FTS5 index** — `bun:sqlite` schema (entries keyed by file), external-content
  FTS kept in-transaction sync, lazy mtime-based incremental reindex; fully disposable.
- **`remember`** — one-shot write: append entry + auto-stub linked entities + index.
  `--stdin`, `--mood emotion/intensity`, `--checkin k=v`, `--date`, `--time`.
- **`recall`** — FTS5 BM25 + entity-link expansion + time filters; `--entity`,
  `--digest` (compact summary for hooks), `--since/--from/--to`, `--limit`.
- **`reflect`** — deterministic lint + mood/health stats + insight candidates
  (mood_streak, co_occurrence, entity_spike, silence) with traceable evidence;
  `suggested_actions` for a scheduled agent. `--md` renders a readable report.
- **`init`** — scaffold a vault; `--skill <dir>` installs the agent protocol,
  `--hook` prints SessionStart hook setup (never edits settings.json).
- **`reindex`**, **`import --from-kioku-lite`** (markdown-folder migration, idempotent),
  **`entity merge`** (link rewrite + frontmatter merge), **`watch`** (foreground sync loop).
- **Agent adapters** — `SKILL.md` protocol (embedded in the binary) and a SessionStart
  digest hook.
- **Docs** — architecture, codebase summary, code standards, and per-phase journals.

### Notes

- Vietnamese diacritic-insensitive search via FTS `remove_diacritics 2`. Known limit:
  `đ` is a distinct base letter and is not folded to `d` in body FTS (entity-name
  matching does fold it).
- Validated end-to-end against real data: 177 legacy memory blocks → 68 unique entries,
  0 parse failures.

[0.4.0]: https://github.com/phuc-nt/my-kioku/releases/tag/v0.4.0
[0.1.0]: https://github.com/phuc-nt/my-kioku/releases/tag/v0.1.0
