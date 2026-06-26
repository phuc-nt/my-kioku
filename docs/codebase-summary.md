# Codebase Summary

Generated from source audit of v1 implementation (150 passing tests, 8 phases complete).

## Module Overview

### src/cli.ts (176 LOC)
- **Purpose**: CLI entry point; routes 8 commands via node:util parseArgs
- **Exports**: main() entry point
- **Flags**: --vault, --stdin, --mood, --time, --date, --checkin, --entity, --digest, --since, --from, --to, --limit, --md, --from-kioku-lite, --dry-run, --into, --interval, --skill, --hook
- **Commands**: init, remember, recall, reflect, reindex, import, entity, watch

### src/config.ts (71 LOC)
- **Purpose**: Vault path resolution (--vault flag → env MY_KIOKU_VAULT → ~/.my-kioku/config.json)
- **Exports**: resolveVault(), readUserConfig(), CONFIG_DIR, CONFIG_PATH, VAULT_INDEX_DIR
- **Invariant**: index folder inside vault is always `.kioku/` (not renamed with binary)

### src/vault/ (Markdown read/write layer)
| File | LOC | Purpose |
|------|-----|---------|
| `daily-note.ts` | ~150 | appendEntry(), getDailyNote(), setCheckinMeta() — mutate daily notes |
| `entity-note.ts` | ~100 | ensureStub(), mergeEntities() — entity file ops |
| `entry-parser.ts` | ~100 | parseEntries(), parseMoodValue() — split `## HH:MM` sections, extract mood |
| `frontmatter.ts` | ~80 | parseFrontmatter(), renderFrontmatter() — YAML boundaries |
| `wikilink-parser.ts` | ~60 | extractWikilinks() — find [[Name]] in text |
| `vault-paths.ts` | ~40 | dailyNoteRelPath(), entityRelPath() — construct paths |

**Key**: daily-note handles verbatim-safe append (heading after blank line only).

### src/index/ (SQLite FTS5 layer)
| File | LOC | Purpose |
|------|-----|---------|
| `db.ts` | ~120 | openDb(), closeDb(), SCHEMA, WAL checkpoint logic |
| `indexer.ts` | ~200 | indexFile(), removeFile(), indexJournal(), indexEntity() — parse & load files |
| `lazy-sync.ts` | ~60 | needsReindex(), reindexIfNeeded() — mtime-based incremental trigger |
| `vault-walker.ts` | ~80 | walkVault(), vaultFileFor() — enumerate vault structure |

**Schema version**: SCHEMA_VERSION = 2; bumped = full rebuild.

### src/search/ (Query layer)
| File | LOC | Purpose |
|------|-----|---------|
| `fts-search.ts` | ~100 | ftsSearch() — BM25 on entries_fts with time filters |
| `entity-expansion.ts` | ~80 | expandQuery() — find entities linked in query results |
| `digest.ts` | ~60 | digestRecent() — summarize last N days for session hooks |

**Token**: unicode61 remove_diacritics 2 (matches fold() helper).

### src/reflect/ (Deterministic analysis)
| File | LOC | Purpose |
|------|-----|---------|
| `lint-checks.ts` | ~150 | checkUnknownTypes(), orphanEntities(), brokenLinks(), unlinkedEntries(), untaggedEntries(), missingCheckins() |
| `mood-stats.ts` | ~80 | analyzeMood(), analyzeHealth() — distribution, trends, avg intensity |
| `alias-similarity.ts` | ~70 | findAliasCandidates() — Levenshtein + diacritics |
| `insight-candidates.ts` | ~100 | findInsights() — spikes, patterns, frequency changes |
| `render-markdown.ts` | ~80 | renderReflectMarkdown() — format report for Obsidian |

**All traceable**: every finding has entry_id or file reference.

### src/commands/ (8 command implementations)
| File | LOC | Purpose |
|------|-----|---------|
| `init.ts` | ~100 | Create vault structure; optionally copy SKILL.md, print hook setup |
| `remember.ts` | ~180 | Append entry + auto-stub entities + index; one call, all operations |
| `recall.ts` | ~150 | FTS search + entity expansion + time filters + digest mode |
| `reflect.ts` | ~140 | Scan vault → lint + stats + insights; write markdown report |
| `reindex.ts` | ~40 | Drop index, rebuild from vault |
| `import-kioku-lite.ts` | ~150 | Migrate kioku-lite markdown folder (idempotent, content-hash) |
| `entity-merge.ts` | ~120 | Fold entity B into A; rewrite links + merge metadata |
| `watch.ts` | ~60 | Poll vault mtime; trigger reindex if changed |

**All return**: JSON {ok, data} or {ok: false, error, hint}.

### src/lib/ (Utilities)
| File | LOC | Purpose |
|------|-----|---------|
| `json-output.ts` | ~30 | ok(), fail() — stable JSON envelope |
| `dates.ts` | ~80 | todayISO(), nowHHMM(), isValidISODate() — local TZ (NOT toISOString) |
| `diacritics.ts` | ~15 | fold() — normalize + strip combining marks + đ→d |
| `checkin-parser.ts` | ~60 | parseCheckin() — "sleep_hours=7,exercise=chạy" → object |
| `link-rewriter.ts` | ~70 | rewriteLinks() — find & replace wikilinks |

**Diacritics**: fold() matches FTS tokenizer; entity expansion uses it.

## Test Structure

Tests mirror src/ structure:

```
tests/
├── vault/                  # vault-layer unit tests
│   ├── entry-parser.test.ts
│   ├── entity-note.test.ts
│   └── ...
├── index/                  # index-layer tests
│   ├── indexer.test.ts
│   ├── lazy-sync.test.ts
│   ├── fts-vietnamese.test.ts  # diacritics folding
│   └── ...
├── search/                 # search-layer tests
│   └── fts-search.test.ts
├── reflect/                # reflect-layer tests
│   ├── alias-similarity.test.ts
│   ├── insight-candidates.test.ts
│   └── ...
├── commands/               # subprocess CLI tests (real vault)
│   ├── remember.test.ts
│   ├── recall.test.ts
│   ├── reflect.test.ts
│   ├── entity-merge.test.ts
│   ├── import-kioku-lite.test.ts
│   └── ...
├── lib/                    # lib utilities
│   ├── diacritics.test.ts
│   ├── checkin-parser.test.ts
│   ├── link-rewriter.test.ts
│   └── ...
├── config.test.ts          # config resolution
├── dates.test.ts           # date utilities
└── e2e/                    # full integration tests
    └── e2e-import-recall-reflect.test.ts
```

**Total**: 150+ tests passing.

**Key patterns**:
- **CLI subprocess tests**: spawn `bun run src/cli.ts ...` with temp vaults; validate JSON output
- **Real-data tests**: no mocks; actual vault files created/read
- **Adversarial review**: phase journals document test findings + edge cases caught

## CLI Routing

All commands follow: validate vault → resolve config → open db → run logic → closeDb → return JSON.

```
my-kioku init [--vault <path>] [--skill <dir>] [--hook]
my-kioku remember [<text>] [--stdin] [--mood happy/4] [--time HH:MM] [--date YYYY-MM-DD] [--checkin sleep_hours=7,...]
my-kioku recall [<query>] [--entity <name>] [--digest] [--since 30d] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit 10]
my-kioku reflect [--since 30d] [--md]
my-kioku reindex
my-kioku import --from-kioku-lite <folder> [--dry-run]
my-kioku entity merge <from> --into <to> [--dry-run]
my-kioku watch [--interval 30]
```

## Conventions

### File Naming
- **TypeScript**: kebab-case, <200 LOC per file
- **Modules**: single responsibility (vault, index, search, reflect, commands each own a layer)
- **Examples**: entry-parser.ts, fts-search.ts, lint-checks.ts

### Code Quality
- **TypeScript**: strict mode, noUncheckedIndexedAccess, Bun runtime
- **Deps**: only yaml (for frontmatter parsing)
- **Error handling**: try-catch, lenient parsers skip-not-crash, JSON error envelopes
- **Testing**: bun test; subprocess CLI tests for commands, unit tests for pure modules

### Database
- **WAL mode**: ensures concurrent reads while writing
- **Checkpoint on close**: closeDb() explicitly checkpoints WAL before process.exit (prevents file accumulation)
- **Schema versioning**: SCHEMA_VERSION bump = full rebuild (no migration needed)
- **Transactions**: indexFile() wraps all changes in db.transaction()

### Date Handling
- **Local timezone**: todayISO uses Date constructor (returns local YYYY-MM-DD)
- **NOT toISOString()**: that converts to UTC (bug caught in phase validation)
- **Time format**: HH:MM (24-hr, entries)

### Verbatim Invariant
- **Entry text never mutated** — only trailing whitespace trim
- **Parsing safety**: appendEntry() writes heading after blank line only
  - Prose heading-shaped lines (e.g., pasted "## 10:00 standup") stay in entry text
  - Prevents accidental entry splitting on user pasted content

### Entity Expansion
- **Diacritic folding**: fold("Hùng") matches entity key "hung"
- **Query expansion**: "Hùng" → find entities with that key + aliases
- **FTS + expansion merge**: results ranked by score + expansion distance

## Build & Deployment

```bash
bun install              # install yaml dep
bun test                 # run all tests (subprocess + unit + e2e)
bun run build            # compile → dist/my-kioku (single binary, Bun-embedded)
```

**Binary**: Self-contained, no runtime deps needed (yaml bundled).

## Vault State Management

- **Index location**: always `{vault}/.kioku/` (gitignored)
- **Reflect output**: `.kioku/reflect-report-{YYYY-MM-DD}.md`
- **No state outside vault**: user controls all source files in git
- **Idempotency**: import uses content-hash; reindex is safe to re-run

## Key Implementation Facts

1. **Entries keyed by file**, not date → dup-date files safe
2. **FTS external-content synced in transaction** → entries + FTS rows always match
3. **Lazy reindex on mtime** → incremental updates except schema bumps
4. **Lint findings all traceable** → entry_id or file reference in every suggested action
5. **No LLM in reflect** → deterministic; agent does judgment
6. **Mood is field** — frontmatter + inline, not entity
7. **Entity merge rewrites wikilinks** — one operation, no orphaned links
