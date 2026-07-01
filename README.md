# my-kioku

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3-black)](https://bun.sh)

**Living personal memory for a diary agent.** An Obsidian markdown vault *is* the
database — markdown + wikilinks + frontmatter are the source of truth; SQLite FTS5
is a disposable index that rebuilds 100% from the vault. No vector search.

Built for a personal-life + emotions diary (not work). A tiny command set covers the
whole lifecycle — `remember` / `recall` / `reflect` (plus `forget` for privacy) —
designed so even a small model gets the protocol right: one situation → one command.

## Why

The previous system (kioku-lite) put memory in a SQLite/graph DB the user couldn't
read or edit. my-kioku inverts that: **your memory is plain markdown you own**,
openable in Obsidian, diff-able in git, and editable by hand — the index just
makes it searchable.

## Install

Requires the [Bun](https://bun.sh) runtime (≥ 1.3) — my-kioku uses `bun:sqlite` and
other Bun APIs, so it does **not** run on Node (running it under Node prints a clear
"requires Bun" message and exits).

```bash
bunx my-kioku <command>      # run ad-hoc, no install
bun add -g my-kioku          # or install globally → `my-kioku <command>`
```

From source (development):

```bash
bun install
bun run src/cli.ts <command>          # run from source
bun run build                         # → dist/my-kioku (optional single binary)
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
my-kioku recall --type place             # everything linking a place-typed entity
my-kioku recall --digest                 # compact summary for a session-start hook

# 5. Reflect (the living loop — run on a schedule)
my-kioku reflect --since 30d

# 6. Forget (privacy) — delete or redact an entry
my-kioku forget "2026-06-12#1" --dry-run
```

## Commands

| Command | Purpose |
|---------|---------|
| `init` | Create a vault (`journal/ entities/ insights/ .kioku/`). `--skill <dir>` copies the agent SKILL.md; `--hook` prints SessionStart hook setup. |
| `remember` | Append a diary entry; auto-stub linked entities; index — all in one call. `--stdin`, `--mood`, `--checkin`, `--date`, `--time`. With no `--date`, infers the event-date from a Vietnamese phrase in the text ("hôm 12/4", "hôm qua"). |
| `recall` | Search: FTS5 + entity expansion + relation/type filter + time filters. `--entity`, `--relation`, `--type <person\|place\|…>`, `--digest`, `--since/--from/--to`, `--limit`. |
| `reflect` | Deterministic scan → lint + stats + insight/concept-bridge/superseded/type candidates for the agent. `--since`, `--md`. |
| `forget <id>` / `forget --entity "X"` | Delete an entry (privacy). `--redact` keeps the heading + mood/relations/tags and blanks the body; `--dry-run` previews. |
| `reindex` | Rebuild the disposable index from the vault. |
| `import --from-kioku-lite <folder>` | Migrate legacy kioku-lite markdown (idempotent). `--dry-run`. |
| `entity merge "B" --into "A"` | Fold one entity into another (link rewrite + frontmatter merge). `--dry-run`. |
| `entity list [--type person]` | List entities (+ mention counts), optionally filtered by type. |
| `watch [--interval 30]` | Foreground loop keeping the index in sync with manual edits. |

All commands output a stable JSON envelope `{ok, data}` / `{ok:false, error, hint}`.

## Vault conventions

```
~/kioku-vault/
├── journal/2026/06/2026-06-12.md   # daily note; entries are `## HH:MM` sections
├── entities/Hùng.md                # one note per person/place/event
├── insights/                       # agent-written reflections
├── vault-version.json              # vault format version (git-tracked; for upgrades)
└── .kioku/                         # disposable index + reflect output (gitignored)
```

The vault is meant to be its **own git repo** — markdown is the source of truth, so
your memory gets a diff-able, rollback-able history (`git init` inside the vault;
`.kioku/` is gitignored, everything else tracked).

- **Daily note**: frontmatter holds health check-ins; each entry is a `## HH:MM`
  section. The leading lines (after the heading) may carry inline fields —
  `mood:: emotion/intensity`, typed emotional relations (`joy:: [[X]]`,
  `trigger:: [[Y]]`, `with::`, `eases::`), `tags:: a, b`, and `superseded:: <id>`
  (marks a fact replaced by a newer entry). The rest is **verbatim** — an inline
  `#hashtag` in the body is also indexed as a tag while staying in the text.
- **Entity note**: `[[wikilinks]]` from entries point here; frontmatter `type:`
  classifies it (person/place/event/activity/thing/unknown).
- **Emotional relations** are markdown-native typed edges (not a graph DB): the
  `joy::`/`trigger::`/… lines are derived into a rebuildable `relations` table, so
  `recall --relation joy --entity "Mẹ"` answers "what brought joy with Mẹ?".
- **The graph is derived from wikilinks.** Imported entries start link-less; the
  agent grows the graph over time via `reflect` (the "living loop").

## The living loop

`reflect` is 100% deterministic (no LLM) and read-only. It surfaces gaps —
unclassified entities (with a suggested `type:`), unlinked entries, possible aliases,
recurring tags that could become `[[concept]]` links, facts a newer entry may have
superseded, mood/health trends, insight candidates — each traceable to a real entry
id. A scheduled agent reads the `suggested_actions`, then classifies entity types,
backfills links, adds concept/relation links, marks superseded facts, and writes
insight notes. The vault improves itself over time — **by adding, never by rewriting
past entries**.

Reference agent harnesses live in [`tests/sim/`](./tests/sim) — they drive a small
model (Qwen via OpenRouter) through each living-loop action (backfill links, extract
relations, merge aliases, classify types). They are **verbatim-guarded at the code
layer**: mentions are wrapped as `[[Entity|written-word]]` and a post-edit assertion
rejects any edit that changed the user's words — because a small model cannot be
trusted to preserve text. They run manually (need a key); the CLI needs none. Run on
a temp vault copy first, dry-run before `--apply`.

## Integrate with your agent

The integration surface is the CLI's stable JSON envelope (`{ok, data}` /
`{ok:false, error, hint}`) — spawn the binary, parse stdout. There's no library API on
purpose. `init --skill <dir>` drops the agent protocol (`SKILL.md`) into your framework.

- **[Agent setup guide](docs/agent-setup.md)** — a setup checklist for an automation /
  manager agent installing & configuring my-kioku for another agent (install → init →
  skill → hook → cron, with verify steps).
- **[Integration guide](docs/integration-guide.md)** — the generic contract: commands,
  flags, exact JSON shapes, the verbatim rule. Integrate from the doc alone.
- **[openclaw integration](docs/openclaw-integration.md)** — concrete recipe: a
  SessionStart hook (`recall --digest`) + a nightly cron `reflect` feeding the agent.

## Design decisions (locked)

- Bun + `bun:sqlite` (FTS5 built in), TypeScript, one runtime dep (`yaml`).
- Markdown is the source of truth; the SQLite index is disposable.
- No vector search — FTS5 (`unicode61 remove_diacritics 2`) + entity-link expansion.
- Emotions are structured fields, not graph entities.
- Reflect is deterministic; the agent does the judgement via cron.

## Versioning & upgrades

Three independent versions, so upgrades are safe:

- **package version** (`package.json`) — the binary release.
- **vault format version** (`vault-version.json`, git-tracked) — the markdown
  conventions. `init` records it; a future binary compares it to migrate an older
  vault. v1.0 and v1.1 share format version `1` (relations/tags are additive).
- **index schema version** (internal) — the disposable SQLite index; a bump just
  triggers an automatic rebuild from markdown, never touching your notes.

See [`docs/`](./docs) for architecture, codebase summary, and code standards;
[`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## License

[Apache-2.0](./LICENSE) © 2026 phucnt.
