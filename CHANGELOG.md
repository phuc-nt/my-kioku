# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/phuc-nt/my-kioku/releases/tag/v0.1.0
