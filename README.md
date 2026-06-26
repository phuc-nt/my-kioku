# my-kioku

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3-black)](https://bun.sh)

**Living personal memory for a diary agent.** An Obsidian markdown vault *is* the
database — markdown + wikilinks + frontmatter are the source of truth; SQLite FTS5
is a disposable index that rebuilds 100% from the vault. No vector search.

Built for a personal-life + emotions diary (not work). Three commands cover the
whole lifecycle, designed so even a small model gets the protocol right: one
situation → one command.

## Why

The previous system (kioku-lite) put memory in a SQLite/graph DB the user couldn't
read or edit. my-kioku inverts that: **your memory is plain markdown you own**,
openable in Obsidian, diff-able in git, and editable by hand — the index just
makes it searchable.

## Install

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install
bun run build          # → dist/my-kioku (single binary)
# or run from source: bun run src/cli.ts <command>
```

## Quick start

```bash
# 1. Create a vault
my-kioku init --vault ~/kioku-vault
export MY_KIOKU_VAULT=~/kioku-vault

# 2. Remember (always --stdin heredoc — safe for Vietnamese/quotes/newlines)
my-kioku remember --stdin --mood happy/4 <<'EOF'
Ăn tối với [[Hùng]] ở [[Quảng An (quán)]]. Bàn về dự án mới.
EOF

# 3. Health check-in (frontmatter only, no text)
my-kioku remember --checkin sleep_hours=7,exercise="chạy 5km",mood_score=4

# 4. Recall
my-kioku recall "phở Quảng An"
my-kioku recall --entity "Hùng" --since 30d
my-kioku recall --digest                 # compact summary for a session-start hook

# 5. Reflect (the living loop — run on a schedule)
my-kioku reflect --since 30d
```

## Commands

| Command | Purpose |
|---------|---------|
| `init` | Create a vault (`journal/ entities/ insights/ .kioku/`). `--skill <dir>` copies the agent SKILL.md; `--hook` prints SessionStart hook setup. |
| `remember` | Append a diary entry; auto-stub linked entities; index — all in one call. `--stdin`, `--mood`, `--checkin`, `--date`, `--time`. |
| `recall` | Search: FTS5 + entity expansion + time filters. `--entity`, `--digest`, `--since/--from/--to`, `--limit`. |
| `reflect` | Deterministic scan → lint + stats + insight candidates for the agent. `--since`, `--md`. |
| `reindex` | Rebuild the disposable index from the vault. |
| `import --from-kioku-lite <folder>` | Migrate legacy kioku-lite markdown (idempotent). `--dry-run`. |
| `entity merge "B" --into "A"` | Fold one entity into another (link rewrite + frontmatter merge). `--dry-run`. |
| `watch [--interval 30]` | Foreground loop keeping the index in sync with manual edits. |

All commands output a stable JSON envelope `{ok, data}` / `{ok:false, error, hint}`.

## Vault conventions

```
~/kioku-vault/
├── journal/2026/06/2026-06-12.md   # daily note; entries are `## HH:MM` sections
├── entities/Hùng.md                # one note per person/place/event
├── insights/                       # agent-written reflections
└── .kioku/                         # disposable index + reflect output (gitignored)
```

- **Daily note**: frontmatter holds health check-ins; each entry is a `## HH:MM`
  section whose first line may be `mood:: emotion/intensity`. Text is **verbatim**.
- **Entity note**: `[[wikilinks]]` from entries point here; frontmatter `type:`
  classifies it (person/place/event/activity/thing/unknown).
- **The graph is derived from wikilinks.** Imported entries start link-less; the
  agent grows the graph over time via `reflect` (the "living loop").

## The living loop

`reflect` is 100% deterministic (no LLM) and read-only. It surfaces gaps —
unclassified entities, unlinked entries, possible aliases, mood/health trends,
insight candidates — each traceable to a real entry id. A scheduled agent reads
the `suggested_actions`, then classifies entities, backfills links, merges
aliases, and writes insight notes. The vault improves itself over time.

## Design decisions (locked)

- Bun + `bun:sqlite` (FTS5 built in), TypeScript, one runtime dep (`yaml`).
- Markdown is the source of truth; the SQLite index is disposable.
- No vector search — FTS5 (`unicode61 remove_diacritics 2`) + entity-link expansion.
- Emotions are structured fields, not graph entities.
- Reflect is deterministic; the agent does the judgement via cron.

See [`docs/`](./docs) for architecture, codebase summary, and code standards;
[`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## License

[Apache-2.0](./LICENSE) © 2026 phucnt.
