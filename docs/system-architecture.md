# System Architecture

## Core Principle

**Obsidian vault IS the database.** Markdown files + wikilinks + frontmatter are the source of truth. SQLite FTS5 (stored in `.kioku/`) is a 100%-rebuildable, disposable index. The system rebuilds from vault markdown on every schema bump — migrations don't exist.

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI (cli.ts)                         │
│  Routes: init, remember, recall, reflect, reindex, import,  │
│  entity, watch — all output stable JSON envelopes           │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                   Commands (src/commands/)                   │
│  Each command: validate vault → open db → business logic    │
│  → update vault/index → closeDb (checkpoint WAL) → JSON out │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│         Search & Reflect (src/search/, src/reflect/)        │
│  FTS5 BM25 + entity expansion + mood/health stats + lint   │
│  Reflect: deterministic, read-only, traces to entry_id      │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│          Index Layer (src/index/)                           │
│  - db.ts: schema, WAL checkpoint, version bumps             │
│  - indexer.ts: parse & load vault file → SQLite transaction │
│  - lazy-sync.ts: mtime-based reindex trigger                │
│  - vault-walker.ts: read vault structure                    │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│           Vault Core (src/vault/)                           │
│  - Read/write daily notes, entities, frontmatter, wikilinks │
│  - entry-parser.ts: `## HH:MM` sections → ParsedEntry[]     │
│  - frontmatter.ts: YAML boundaries + parsing                │
│  - wikilink-parser.ts: [[Name]] extraction                  │
│  - vault-paths.ts: path construction (journal/YYYY/MM/...)  │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│         Library (src/lib/)                                  │
│  - dates.ts: todayISO, local-tz handling (NOT toISOString)  │
│  - diacritics.ts: fold() matches FTS remove_diacritics 2    │
│  - json-output.ts: {ok, data/error, hint}                   │
│  - checkin-parser.ts, link-rewriter.ts, etc.                │
└──────────────────────────────────────────────────────────────┘
```

## Data Model

### Vault Structure
```
~/kioku-vault/
├── journal/2026/06/2026-06-12.md    # daily note
├── entities/Hùng.md                 # entity note
├── insights/                        # agent-written reflections
└── .kioku/                          # gitignored; contains index.db + reflect output
```

### Daily Note Format
```yaml
---
sleep_hours: 7
exercise: "chạy 5km"
mood_score: 4
extra_field: "value"
---

## 14:30
mood:: happy/4
joy:: [[Chạy bộ]]
with:: [[Hùng]]
tags:: friends, fitness
Ăn tối với [[Hùng]] ở [[Quảng An (quán)]]. Bàn về dự án mới.

## 20:00
mood:: thoughtful/3
Viết code. Suy nghĩ về kiến trúc.
```

- **Frontmatter**: health check-ins (sleep_hours, exercise, mood_score) + extras
- **Leading field zone** (strict shape only): `mood:: emotion[/intensity]`, relation lines (`joy::/trigger::/with::/eases::/` + free verbs), `tags:: a, b, c`
  - Lines are stripped from body; they never appear in entry text
  - If a line doesn't match the strict shape, it falls through to body (verbatim)
- **Wikilinks**: `[[Name]]` auto-stubs entity notes if missing; relation targets are wikilinks
- **Verbatim contract**: entry body text is NEVER mutated beyond trailing-whitespace trim

### Entity Note Format
```yaml
---
type: person
aliases:
  - Hung
  - Mr. H
---

Details about this person...
```

- **type**: person | place | event | activity | thing | unknown (reflect classifies)
- **aliases**: JSON array matched with diacritic-folding

### SQLite Schema (`.kioku/index.db`)
| Table | Purpose |
|-------|---------|
| `files(path, mtime, kind)` | Vault file tracking; mtime for lazy sync |
| `entries(id, file, date, time, ordinal, mood, intensity, body)` | Parsed `## HH:MM` sections; id = `{date}#{ordinal}` |
| `entries_fts(body, ...)` | FTS5 virtual table (unicode61 + remove_diacritics 2); external-content synced in-transaction |
| `links(entry_id, target)` | Wikilinks extracted from entries |
| `relations(entry_id, rel_type, target)` | Emotional relation edges (joy/trigger/with/eases/...); derived from inline fields |
| `tags(entry_id, tag)` | Plain-text tags indexed for surfacing unconverted tags |
| `entities(name, file, type, aliases)` | Entity catalog with type & alias JSON |
| `daily_meta(file, date, sleep_hours, exercise, mood_score, extra)` | Parsed frontmatter |

**Keying safety**: entries keyed by file path (not date) — robust to duplicate-date files; re-indexing one never deletes another's entries.

**SCHEMA_VERSION**: 3 (v0.2.0+) — includes relations + tags tables; drop-rebuild migration on schema bump.

## Versioning (three independent axes)

- **package version** (`package.json`) — the binary release.
- **VAULT_FORMAT_VERSION** (`src/vault/vault-version.ts`) — the vault's markdown
  conventions. Written to `vault-version.json` at the vault ROOT (git-tracked,
  outside `.kioku/`) by `init`. `compareVaultVersion()` → current/older/newer/
  unversioned so a future binary can migrate an older vault. v1.0/v1.1 = `1`.
- **SCHEMA_VERSION** — the disposable index; a bump just rebuilds from markdown.

The vault is intended to be its own git repo (markdown = source of truth), giving
the memory a diff-able / rollback-able history independent of the code repo.

## Key Flows

### Remember (Append + Index)
1. Read today's daily note (or create)
2. Parse frontmatter; extract/merge check-in meta
3. Append entry: write `\n\n## HH:MM` + mood line (if provided) + text
4. Extract wikilinks; stub missing entity notes
5. Open db → index the daily note + stub entities in one transaction
6. Checkpoint WAL, close db → return {ok, entry_id, ...}

**Verbatim safety**: appendEntry writes the exact heading AFTER a blank line; prose heading-shaped lines never split entries.

### Recall (FTS + Entity + Relation Expansion)
1. Parse query; apply time filters (--since, --from, --to)
2. FTS5 BM25 search on entries.body (unicode61, diacritics folded)
3. Extract entities from query; expand by wikilinks (query "Hùng" → entries linking [[Hùng]])
4. If --relation <type> given: expand by relation (entries where Hùng is target of joy/trigger/... relation); bonus: RELATION_BONUS (0.5) above ENTITY_BONUS (0.3)
5. Merge results; rank by score + recency
6. Apply --limit; optionally --entity to narrow scope
7. Hydrate results: each entry includes relations + tags (always present as {} / [] even if empty)
8. Return {ok, results: [{ entry_id, date, time, score, mood, relations, tags, ... }, ...]}

**Digest mode**: --digest summarizes last N days for session-start hooks.

### Reflect (Deterministic Lint + Insights + Relation/Tag Analysis)
1. Scan vault; gather all entries, entities, wikilinks, mood/health/relations/tags data
2. **Lint checks** (all findings traceable to entry_id/file):
   - Unknown-type entities (not classified)
   - Orphan entities (never mentioned)
   - Broken wikilinks (target entity missing)
   - Entries without wikilinks (unlinked)
   - Entries without mood (untagged)
   - Missing check-in days (health gaps)
3. **Mood stats**: distribution, avg intensity, trend (increasing/stable/declining)
4. **Health stats**: avg sleep, exercise day count, mood-score trend
5. **Relation detectors**:
   - **missing_emotional_relation**: strong-mood entries (intensity ≥4 or ≤2) with no relation row; backfill debt, all-time
   - **relation_summary**: top joy/trigger targets in the period (count-merged by folded name)
6. **Tag converter**: tags not yet represented as entity notes; surfaced by frequency
7. **Alias candidates**: similar entity names (Levenshtein similarity + diacritics)
8. **Insight candidates**: mood spikes, health patterns, relationship frequency changes
9. **Suggested actions**: actionable lint + relation backfill + tag conversion candidates
10. Write markdown report → `.kioku/reflect/{timestamp}.md` (if --md)
11. Return {ok, report, lint, alias_candidates, mood_stats, missing_emotional_relation, relation_summary, tags_to_convert, ...}

**No LLM**: all deterministic; agent reads suggested_actions and backfills via cron.

### The Living Loop
- `reflect` surfaces gaps → suggested_actions
- Agent (on cron) reads reflect report → classifies entities, merges aliases, backfills wikilinks, writes insight notes
- Next `reflect` run sees the improvements; KG grows over time
- Vault is iteratively refined by human + agent cooperation

## Design Decisions (Locked)

- **Bun + bun:sqlite** (FTS5 native); TypeScript strict + noUncheckedIndexedAccess; one dep (yaml)
- **Emotional relations are markdown-native** — typed edges (joy/trigger/with/eases/free verbs) written as inline fields, NOT a graph DB
  - Derived into the rebuildable `relations` table — same disposal model as links
  - Enables `recall --relation <type>` + relation-aware ranking (RELATION_BONUS)
- **No vector search** — FTS5 (unicode61 remove_diacritics 2) + entity link expansion + relation expansion sufficient
- **No LLM in deterministic paths** — reflect is purely rule-based; agent judges
- **Emotions are fields, not entities** — mood is frontmatter + inline field, not a KG node
- **Wikilinks are the KG** — no separate entity graph; backlinks are implicit; relation targets are wikilinks
- **Markdown is authoritative** — index is rebuilt on schema bumps; no migrations
- **WAL checkpoint TRUNCATE on close** — closeDb() uses TRUNCATE to fold -wal back promptly, not left for next invocation
- **Diacritics matched at app layer** — fold() aligns with FTS tokenizer

## Invariants

1. **Entries keyed by file** — dup-date files never delete each other's entries
2. **Verbatim entry text** — only trailing-whitespace trim; no mutation
3. **Mood lines recognized only in strict shape** — `mood:: emotion/intensity`; prose starting with "mood::" is not a field
4. **FTS synced in-transaction** — entries + entries_fts rows written together
5. **WAL checkpointed on close** — no stale -wal files
6. **All lint findings traceable** — every suggested action links to an entry_id or file
7. **Lazy mtime reindex** — full rebuild only on SCHEMA_VERSION bump; watch polls mtime for incremental
