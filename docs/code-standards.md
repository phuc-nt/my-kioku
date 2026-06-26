# Code Standards

Implementation standards for my-kioku v1. All standards derive from actual codebase practices and lessons from phase validation.

## Language & Runtime

- **Language**: TypeScript strict mode
  - `noUncheckedIndexedAccess: true`
  - `strict: true` (nullability, no implicit any)
  - No `any` types; use `unknown` + type guards
- **Runtime**: Bun ≥ 1.3.11
  - bun:sqlite built-in (FTS5 available)
  - Node.js compat for fs, path, os, util APIs
- **Single production dep**: `yaml` (frontmatter parsing only)
- **Dev deps**: @types/bun

## File Organization

### Structure
```
src/
├── cli.ts                  # 176 LOC; entry point + routing
├── config.ts               # 71 LOC; vault resolution
├── vault/                  # markdown I/O layer (6 files)
├── index/                  # SQLite layer (4 files)
├── search/                 # query layer (3 files)
├── reflect/                # analysis layer (5 files)
├── commands/               # 8 commands (180 LOC avg)
└── lib/                    # utilities (5 files, <100 LOC each)
```

### File Naming
- **kebab-case** for .ts files
- **Descriptive**: entry-parser.ts (not parser.ts), fts-search.ts (not search.ts)
- **Size limit**: Keep files <200 LOC
  - Single responsibility per module
  - If file exceeds 200 LOC, split at logical boundaries
  - Example: indexer.ts handles indexJournal() + indexEntity() as cohesive unit

### Module Boundaries
- **vault/**: read/write markdown; no db knowledge
- **index/**: SQLite operations; no vault mutation
- **search/**: query layer; composes fts + entity expansion
- **reflect/**: analysis only; no mutations, all findings traceable
- **commands/**: orchestration; call vault → index → search/reflect → close db
- **lib/**: pure functions, no side effects

## TypeScript Standards

### Type Safety
```typescript
// ✅ Good: explicit types, union discriminators
interface ResolveOptions {
  vaultFlag?: string;
  allowMissing?: boolean;
}

function resolveVault(opts: ResolveOptions = {}): {
  path: string | null;
  source: "flag" | "env" | "config" | "none";
  exists: boolean;
} { ... }

// ❌ Avoid: implicit any, unsafe indexing
function parse(data: any) { ... }
const val = data['key']; // no bounds check
```

### Error Handling
- **Never crash on user input**: parse leniently, skip invalid rows
  - Example: checkin-parser skips unknown keys; JSON.parse wraps try-catch
- **All errors are JSON**: {ok: false, error: string, hint?: string}
- **Hint field**: actionable guidance (e.g., NO_VAULT_HINT)

```typescript
// ✅ Lenient parsing
try {
  const aliases = JSON.parse(row.aliases) as string[];
  for (const a of aliases) { ... }
} catch {
  /* ignore malformed JSON, continue */
}

// ✅ Error envelope
return fail("Query is empty", "Provide a search term or --entity <name>");
```

### Null Safety
- Use `string | null` not `string | undefined` (clearer intent)
- Guard with explicit checks: `if (path === null)` not `if (!path)`
- For optional parameters, use `undefined`: `vaultFlag?: string`

## Code Style

### Functions
- **Pure functions** in lib/; side effects only in commands
- **Descriptive names**: extractWikilinks(), parseMoodValue(), findAliasCandidates()
- **Short parameter lists**: if >3 params, use object; if >1 object param, split function
- **No boolean params**: use object with named properties

```typescript
// ❌ Avoid
function parse(text: string, strict: boolean, trim: boolean) { ... }

// ✅ Good
function parse(text: string, opts: { strict?: boolean; trim?: boolean } = {}) { ... }
```

### Comments
- **Explain "why"** not "what" (code reads the what)
- **Edge cases**: document non-obvious invariants, gotchas
- **Verbatim safety**: explain why append() writes heading after blank line

```typescript
// ✅ Explains the contract
// Verbatim safety: a `## HH:MM` line is treated as an entry heading ONLY when it
// is preceded by a blank line (or starts the body). appendEntry always emits the
// heading after a blank line, so entry PROSE that happens to contain a
// heading-shaped line (e.g. a pasted "## 10:00 standup") is NOT split out — it
// stays inside the entry text, preserving the verbatim contract.
```

### Naming Conventions
| Category | Convention | Example |
|----------|-----------|---------|
| Files | kebab-case | entry-parser.ts |
| Functions | camelCase | parseEntries() |
| Classes | PascalCase (rare) | Database |
| Constants | UPPER_SNAKE | SCHEMA_VERSION, MIN_INTENSITY |
| Types | PascalCase | ParsedEntry, ResolveOptions |
| Booleans | is*/has*/can* prefix | isValidISODate, hasWikilinks |

## Key Invariants

### 1. The Verbatim Invariant
**Entry text is NEVER mutated beyond trailing-whitespace trim.**

Why: User pastes content into entries; we must preserve exact wording for recall accuracy.

Enforcement:
- appendEntry() writes heading AFTER blank line → prose headings stay in text
- Parser only splits on heading + preceding blank line
- No text normalization (punctuation, casing, etc.)
- Tests in entry-parser.test.ts validate heading-shaped prose is NOT split

### 2. Diacritics Alignment
**fold() at app layer MUST match FTS tokenizer behavior (unicode61 remove_diacritics 2).**

```typescript
// In diacritics.ts
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")      // combining marks
    .replace(/đ/g, "d")          // Vietnamese ð
    .replace(/Đ/g, "D")
    .toLowerCase();
}

// Used in: entity expansion, alias matching
// Test: tests/index/fts-vietnamese.test.ts verifies fold("Hùng") == key "hung"
```

### 3. Local Timezone Dates
**Use todayISO (Date constructor) NOT toISOString() (converts to UTC).**

Bug caught in validation session 1:
```typescript
// ❌ WRONG: converts to UTC
const date = new Date().toISOString().split('T')[0]; // 2026-06-12T... → UTC offset wrong

// ✅ RIGHT: local YYYY-MM-DD
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

### 4. Entries Keyed by File
**Entry IDs are "{date}#{ordinal}", keyed by file path in DB.**

Why: If two files map to the same date (abnormal), re-indexing one file must never delete another's entries. Safety over elegance.

```sql
CREATE TABLE entries(
  id TEXT PRIMARY KEY,    -- "{date}#{ordinal}"
  file TEXT,              -- which file this entry belongs to
  ...
);
CREATE INDEX idx_entries_date ON entries(date);
```

### 5. FTS Sync in Transaction
**entries + entries_fts rows written in same db.transaction().**

Guarantee: If process crashes mid-write, both roll back; no drift.

```typescript
db.transaction(() => {
  db.prepare("INSERT INTO entries(id, file, ...) VALUES (...)").run(...);
  db.prepare("INSERT INTO entries_fts(rowid, body) VALUES (...)").run(...);
})();
```

### 6. WAL Checkpoint on Close
**closeDb() explicitly checkpoints WAL before returning.**

Why: Each CLI command opens/closes db. Without checkpoint, -wal file grows across invocations.

```typescript
export function closeDb(db: Database): void {
  db.exec("PRAGMA optimize;");
  db.exec("PRAGMA wal_checkpoint(RESTART);");
  db.close();
}
```

### 7. All Lint Traceable
**Every suggested action in reflect output has entry_id or file reference.**

Why: Agent must be able to jump to the source when reviewing suggested actions.

Example:
```typescript
// ✅ Good: entry_id traceable
{
  kind: "broken_wikilink",
  detail: "[[Hùng2]] → no entity found",
  entry_id: "2026-06-12#0",  // ← can jump to entry
}
```

## Testing Standards

### Test Organization
- **Unit tests** for pure modules (lib/, vault/, search/reflect structures)
- **CLI subprocess tests** for commands (spawn real process, temp vault, validate JSON)
- **Real data**: no mocks; actual vault files created/read
- **E2E**: full workflow (import → remember → recall → reflect)

### Patterns
```typescript
// ✅ Test real behavior with subprocess
const result = await runCmd(`bun run src/cli.ts remember --stdin --mood happy/4`, {
  stdin: "Ăn tối với [[Hùng]].",
  vault: tempVault,
});
const json = JSON.parse(result.stdout);
expect(json.ok).toBe(true);
expect(json.data.entry_id).toMatch(/^2026-\d{2}-\d{2}#\d+$/);

// ✅ Unit test edge cases
it("does not split on heading-shaped prose in entry text", () => {
  const body = `## 10:00\nPlanned: ## 14:00 meeting.`;
  const entries = parseEntries(body);
  expect(entries).toHaveLength(1);
  expect(entries[0].text).toContain("## 14:00 meeting");
});
```

### Coverage
- Target: All module boundaries (vault↔index, search/reflect calls)
- Real-data tests validate against actual kioku-lite import (~177 memories)
- Adversarial review: phase journals document edge cases caught + test additions

## Database Standards

### Schema
- **Version bump = full rebuild** (SCHEMA_VERSION in db.ts)
- **No migrations**: drop old, create new, reindex from vault
- **Indexes on foreign keys**: idx_links_target, idx_links_entry, idx_daily_meta_date, idx_entries_date

### Transactions
- **Atomic writes**: indexFile() wraps all changes in db.transaction()
- **No FK constraints enabled**: referential integrity maintained by hand (simpler logic)

### WAL Mode
```typescript
db.exec("PRAGMA journal_mode = WAL;");  // concurrent reads while writing
db.exec("PRAGMA wal_checkpoint(RESTART);"); // on close
```

## Performance Considerations

- **Lazy mtime reindex**: full rebuild only on SCHEMA_VERSION bump; watch polls mtime for incremental
- **FTS BM25**: unicode61 tokenizer; fast on text search
- **Entity expansion**: secondary query; merged with FTS results
- **No vector embeddings**: saves compute; FTS + diacritics sufficient for personal memory

## Security & Privacy

- **All user data in vault** (markdown, gitignored index) → user controls storage
- **No remote calls**: pure local computation
- **No secrets in code**: config stored in ~/.my-kioku/config.json (user-readable)
- **Deterministic reflect**: no LLM, so no data sent to external services

## Integration Checklist

When adding a new command:
1. Add routing to cli.ts (parseArgs + case statement)
2. Create commands/{name}.ts; export run{Name}() function
3. Validate vault path (resolveVault)
4. Open db with openDb(vault)
5. Run business logic (vault ops → index updates → search/reflect)
6. Close db with closeDb(db) (checkpoints WAL)
7. Return JSON {ok, data} or {ok: false, error, hint}
8. Add subprocess CLI test in tests/commands/{name}.test.ts

## Common Pitfalls

| Mistake | Why It Matters | Solution |
|---------|---|---|
| Mutating entry text beyond trim | Violates verbatim contract | Only trailing-whitespace trim in parser |
| Using toISOString() for dates | Converts to UTC, breaks tz-aware logic | Use todayISO() or Date constructor |
| FTS + entries out of sync | Stale index, wrong results | Write both in same transaction |
| Not checkpointing WAL | -wal file accumulates | Call closeDb() which checkpoints |
| Entity key case-sensitive | Aliases don't match "Hùng" vs "hung" | Always fold() entity keys + query |
| Lint findings without entry_id | Agent can't jump to source | Every suggested action traces back |
| Mocking vault in tests | Miss real edge cases | Use subprocess tests with temp vaults |
