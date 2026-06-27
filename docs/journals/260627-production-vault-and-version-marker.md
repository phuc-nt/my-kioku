# Production vault + format-version marker

**Date:** 2026-06-27 · **Commit:** d7b18b2 (code) · vault commit 82090aa · **Branch:** feat/v1.1-emotional-relations

## What happened

Created the production vault `~/kioku-vault` with the real Telegram-backup migration, and added a vault **format-version marker** so the vault can be upgraded safely later.

## Version marker (new feature)

Three distinct versions were getting conflated — clarified:
- **`SCHEMA_VERSION`** (SQLite index) — disposable, auto drop-rebuild. Already existed.
- **npm package version** — the binary release (0.2.0).
- **`VAULT_FORMAT_VERSION`** (NEW) — the vault's *markdown conventions* version. This is what "manage version to upgrade" needs.

`vault-version.json` lives at the vault **root** (NOT `.kioku/`, which is gitignored) so the vault's own git history tracks it. `init` writes it idempotently. `compareVaultVersion` → `current`/`vault_older`/`vault_newer`/`unversioned` for a future binary to detect and migrate an older vault. v1 + v1.1 share `VAULT_FORMAT_VERSION=1` (relations/tags are additive — old vaults parse unchanged).

## Production vault

- `~/kioku-vault` — **its own git repo** (separate from the code repo), per the "markdown is source of truth, git-able" design. `.kioku/` (disposable index) ignored; `vault-version.json` + journals/entities/insights tracked.
- Migrated the real 442-block Telegram backup: **155 entries, 0 dropped, 403 distinct tags**, spanning **1962–2026** (event_time correctly back-dated life memories: birth year, schooling, Japan years, kids).
- First vault commit captures the migrated state → ký ức now has git history (diff/rollback over time as the agent enriches it).
- Full pipeline verified on the production vault: recall (Techbase→5, Nhat Ban→9), reflect surfaces the living-loop backlog (155 unlinked entries, 30 tags-to-convert: mother×34, children×13, father×10…).

## Key decisions

- Version marker at vault root (git-tracked), not in `.kioku/` — so it survives index wipes and is visible in the vault's git history.
- Vault = its own git repo (not committed into the code repo) — keeps personal memory separate from source, enables independent backup/rollback.
- Idempotent: re-running `init` on the populated production vault created nothing and left the marker + git tree clean (verified).

## Verification

219 tests, tsc clean. Production vault: 155 entries / 0 bad, version marker present, git committed, recall + reflect working. Re-init idempotency confirmed (no clobber).

## Unresolved

- The vault git repo has no remote (local history only) — by design for private memory; user can add a private remote if they want off-machine backup.
