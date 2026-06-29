# Integration guide

How to wire **my-kioku** into any agent or app. The integration surface is the CLI's
JSON envelope — you spawn the binary and parse stdout. There is no library API on
purpose: the CLI is the stable contract.

## Requirements

- **Bun ≥ 1.3** (the package uses `bun:sqlite` and other Bun APIs — it does not run on
  Node). Install: https://bun.sh
- Install: `bun add -g my-kioku` (or run ad-hoc with `bunx my-kioku`).
- A vault: `my-kioku init --vault <path>`. Point every call at it with `--vault <path>`
  or export `MY_KIOKU_VAULT=<path>`.

## The envelope contract

Every command prints ONE line of JSON to stdout and sets the exit code:

```json
{ "ok": true,  "data": { ... } }            // exit 0
{ "ok": false, "error": "...", "hint": "..." } // exit 1  (hint optional)
```

Be tolerant of additive fields: new keys may appear in `data` over time, so ignore
unknown keys rather than rejecting the payload (don't use a strict/closed schema).

Parse pattern (any language): read stdout, `JSON.parse`, branch on `ok`.

```ts
const proc = Bun.spawnSync(["my-kioku", "recall", "phở", "--vault", vault]);
const res = JSON.parse(proc.stdout.toString());
if (!res.ok) throw new Error(res.error); // res.hint may suggest a fix
for (const e of res.data.results) { /* e.id, e.date, e.body, e.mood, ... */ }
```

## Core commands an agent uses

One situation → one command. The agent almost always needs only these three.

### `remember` — write a diary entry

Always pass text via `--stdin` with a heredoc — it sidesteps every shell-quoting issue
with quotes, apostrophes, newlines, and Vietnamese diacritics.

```bash
my-kioku remember --stdin --mood happy/4 <<'EOF'
Ăn tối với [[Hùng]] ở [[Quảng An]]. Bàn về dự án mới.
EOF
```

Flags: `--mood emotion[/1-5]`, `--date YYYY-MM-DD`, `--time HH:MM`, `--checkin
sleep_hours=7,exercise=...,mood_score=4` (frontmatter-only, no text).

`data` is conditional on what you sent:
- **With text** (the usual case): `{ date, time, entry_id, ordinal, mood, intensity,
  links[], relations{}, tags[], stubs_created[] }`. `links` / `stubs_created` confirm
  which entities were referenced / auto-created.
- **`--checkin` only** (no text): `{ date, checkin }` — none of the entry fields above.
- **Text + `--checkin`**: the full entry object plus a `checkin` key.
- A `warnings[]` array may be present (e.g. an unrecognized mood value).

So read `data.entry_id` only when you sent text; branch on whether you passed text.

### `recall` — search

```bash
my-kioku recall "phở Quảng An"           # full-text (folded: no-accent ok)
my-kioku recall --entity "Hùng" --since 30d
my-kioku recall --relation joy --entity "Mẹ"
my-kioku recall --digest --since 7d      # compact summary for a session-start hook
```

Flags: `--entity`, `--relation joy|trigger|with|eases|<verb>`, `--since 7d|YYYY-MM-DD`,
`--from`/`--to`, `--limit`, `--digest`.

**Matching is OR + coverage-gated.** A query matches an entry that shares ANY of its
(diacritic-folded) terms, ranked by how many terms it covers — so a richer query
recalls *more*, not less. An entry must share ≥2 distinct query terms to surface
(single-term queries excepted), which drops incidental one-word overlaps. It favors
**recall over precision** (the right entry is in the top-k you read), so the agent
should **enrich the query** before calling recall: replace pronouns with known
`[[Name]]`s and add entities/synonyms (keep the user's language — add terms, don't
translate). A term that appears nowhere returns an empty result (no fabricated hits).

`data` (search): `{ query, entity, relation, count, results: [...], entity_context: [...] }`.
- `results[]`: `{ id, date, time, ordinal, mood, intensity, body, links[], relations{},
  tags[], score }`. `body` is the VERBATIM entry text. `score` is a relevance number
  (higher = better; NOT stable across queries — for ordering only).
- `entity_context[]`: entities the query/`--entity` matched —
  `{ name, type, aliases[], total_mentions_all_time }`. Useful to show "who/what this is
  about". Empty when nothing matched.

`data` (`--digest`): `{ period{from,to}, mood_summary, checkin, active_entities[],
recent_entries[] }` — a small object meant to be injected as session context.

### `reflect` — the living loop (run on a schedule)

```bash
my-kioku reflect --since 30d
```

100% deterministic, read-only. `data` keys: `period, lint, alias_candidates,
mood_stats, health_stats, insight_candidates, missing_emotional_relation,
relation_summary, tags_to_convert, suggested_actions`.

`suggested_actions` is a prioritized list of plain-text actions (e.g. `"classify 1
unknown-type entities"`). The agent works the list top to bottom: classify entity
types, backfill `[[links]]`, merge aliases, add emotional relations, write insight
notes. Each underlying finding cites a real entry/file id, so actions are traceable.

## Drop-in agent instructions

`my-kioku init --skill <dir>` writes a `SKILL.md` into `<dir>` — the agent operating
protocol (golden rules incl. store-verbatim and keep-the-user's-language, the
remember/recall/reflect flow, anti-patterns). Point your agent framework at it instead
of re-deriving the protocol.

## Verbatim contract (important for LLM agents)

Bodies are stored byte-for-byte. The agent MUST NOT summarize, translate, or rewrite
the user's words — including mixed Vietnamese-English. Only the entity `type:` field
uses a fixed English vocabulary (person/place/event/activity/thing). The CLI normalizes
only its disposable index and structured keys, never the markdown you wrote.

## Auxiliary commands

| Command | Purpose |
|---------|---------|
| `init` | Create a vault. `--skill <dir>` writes SKILL.md; `--hook` prints SessionStart hook setup. |
| `reindex` | Rebuild the disposable SQLite index from the vault. |
| `import --from-kioku-lite <folder>` | Migrate legacy kioku-lite markdown (`--dry-run`). |
| `entity merge "B" --into "A"` | Fold one entity into another (`--dry-run`). |
| `forget <id>` / `forget --entity "X"` | Delete an entry block (privacy). `--redact` keeps the heading + mood/relations/tags and blanks only the body; `--dry-run` previews. |
| `watch [--interval 30]` | Foreground loop keeping the index in sync with manual edits. |

`forget` `data`: `{ dry_run, mode:"delete"|"redact", removed_count, files_touched[],
targets:[{entry_id, file, date, time}], note }`. The `note` warns that deleting an entry
**renumbers** later `date#ordinal` ids in that file — re-query rather than reuse an old id.
Markdown is the source of truth, so this is a file edit + reindex; the vault's git history
retains removed content (audit), so true hard-erasure needs a git history rewrite (`--redact`
is the in-repo-safe alternative).

For the concrete openclaw recipe, see [openclaw-integration.md](./openclaw-integration.md).
