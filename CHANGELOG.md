# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

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
