# Agent setup guide — installing & configuring my-kioku

**Audience:** an automation/manager agent that SETS UP my-kioku so another agent (a
diary agent) can use it as long-term memory. This file is self-contained: follow the
checklist top to bottom, verifying each step. For the JSON/command contract the diary
agent uses at runtime, see [integration-guide.md](./integration-guide.md); for the
openclaw-specific hook/cron recipe see [openclaw-integration.md](./openclaw-integration.md).

## What my-kioku is (one line)

A CLI that stores a person's diary as a plain-markdown Obsidian vault (the source of
truth) with a disposable SQLite index for search. The diary agent writes memories with
`remember`, reads them with `recall`, and a scheduled `reflect` improves the vault over
time. Every command prints one line of JSON: `{ok:true,data}` or `{ok:false,error,hint}`.

## Prerequisites (check first)

- **Bun ≥ 1.3** must be installed (my-kioku uses `bun:sqlite`; it does NOT run on Node).
  Verify: `bun --version`. If missing, install from https://bun.sh, then re-check.
- Write access to a directory for the vault (default suggestion: `~/kioku-vault`).

## Setup checklist

Run each step; check the `Verify` line before moving on. Replace `~/kioku-vault` and
`<diary-agent-skills-dir>` with the real paths for this deployment.

### 1. Install the CLI

```bash
bun add -g my-kioku
```

Verify: `my-kioku --help` prints `{"ok":true,"data":{...}}` (exit 0). If you prefer no
global install, prefix every command with `bunx` instead (e.g. `bunx my-kioku --help`).

> **If not yet published to npm:** until `my-kioku` is on the npm registry, the commands
> above fail with "not found". Run from a local clone instead — substitute
> `bun run /path/to/my-kioku/src/cli.ts` for `my-kioku` in every command below
> (e.g. `bun run /path/to/my-kioku/src/cli.ts init --vault ~/kioku-vault`). Verify with
> `bun run /path/to/my-kioku/src/cli.ts --help`.

### 2. Create the vault

```bash
my-kioku init --vault ~/kioku-vault
```

Verify: `data.created` lists `["journal","entities","insights",".kioku"]` (or
`data.already_present` if it existed). `data.vault_version.vault_format_version` is `1`.

### 3. Make the vault its own git repo (recommended)

So memory has a diff-able, revertable history. `.kioku/` is auto-gitignored.

```bash
cd ~/kioku-vault && git init && git add -A && git commit -m "init kioku vault"
```

Verify: `git -C ~/kioku-vault status` is clean.

### 4. Give the diary agent its operating protocol

Writes `SKILL.md` (the agent's how-to: store-verbatim rule, keep-the-user's-language,
the remember/recall/reflect flow) into the diary agent's skills/instructions dir.

```bash
my-kioku init --vault ~/kioku-vault --skill <diary-agent-skills-dir>
```

Verify: `data.skill_written` is the path to the written `SKILL.md`, and that file exists.
Re-running this refreshes the protocol when my-kioku updates.

### 5. Wire the SessionStart context hook (optional but recommended)

Writes a hook script into `<vault>/.kioku/` that injects a recent-memory digest at the
start of each session, and prints the settings snippet to register it.

```bash
my-kioku init --vault ~/kioku-vault --hook
```

Verify: `data.hook.script` is the script path; `data.hook.settings_snippet` is the
config to add to the diary agent's session hooks. Register it in the diary agent's hook
mechanism (the snippet is in Claude Code `settings.json` shape — adapt as needed).
Ensure `MY_KIOKU_VAULT=~/kioku-vault` is exported in the hook's environment.

### 6. Schedule the living loop (optional but recommended)

A periodic deterministic scan whose `suggested_actions` the diary agent acts on
(classify entities, backfill links, add emotional relations, write insights). Add a
cron/scheduled job that runs:

```bash
my-kioku reflect --vault ~/kioku-vault --since 30d
```

…and feeds `data.suggested_actions` to the diary agent with the instruction to apply
them by editing the vault markdown — **never rewriting the user's words**. See
[openclaw-integration.md](./openclaw-integration.md) for a concrete cron job example.

## Required configuration

| What | Value | Where |
|------|-------|-------|
| Vault path | e.g. `~/kioku-vault` | `MY_KIOKU_VAULT` env (or `--vault` on every call) |
| Binary name | `my-kioku` | `MY_KIOKU_BIN` env overrides (the hook honors it) |

Set `MY_KIOKU_VAULT` in the environment of BOTH the diary agent and any hook/cron, so
calls don't need `--vault`.

## Hand-off to the diary agent

After setup, the diary agent (not this manager agent) does the day-to-day:
- It reads `SKILL.md` (step 4) to learn the protocol.
- It runs `remember` when the user shares life events, `recall` to look things up.
- The hook (step 5) and cron (step 6) run automatically.

The manager agent's job is done once steps 1–4 verify clean (5–6 if scheduling is in
scope). Point the diary agent at [integration-guide.md](./integration-guide.md) for the
exact command/flag/JSON contract.

## The verbatim contract (must convey to the diary agent)

Bodies are stored byte-for-byte. The diary agent MUST NOT summarize, translate, or
rewrite the user's words — including mixed Vietnamese-English. Only the entity `type:`
field uses a fixed English vocabulary (person/place/event/activity/thing). my-kioku
normalizes only its disposable index, never the markdown.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `requires the Bun runtime` message, exit 1 | Run under Node, not Bun | Install Bun (https://bun.sh); invoke with `bunx my-kioku` or after `bun add -g`. |
| `env: bun: No such file or directory` | Bun not on PATH | Install Bun; ensure its bin dir is on PATH. |
| `{ok:false,error:"No vault configured."}` | Vault not set/created | Run step 2; export `MY_KIOKU_VAULT` or pass `--vault`. |
| Hook injects nothing | `MY_KIOKU_VAULT` not in hook env, or no recent entries | Export the env in the hook's environment; the hook is silent by design on error. |
| Search misses a recent manual edit | Index not synced | Run `my-kioku reindex --vault ~/kioku-vault` (the index is disposable and rebuilds from markdown). |

## Quick post-setup smoke test

```bash
export MY_KIOKU_VAULT=~/kioku-vault
my-kioku remember --stdin --mood happy/4 <<'EOF'
Test memory with [[Someone]].
EOF
my-kioku recall "test"          # → data.count ≥ 1, the entry in data.results
my-kioku recall --digest --since 7d   # → the object the SessionStart hook injects
```

If all three return `{"ok":true,...}`, the integration works end to end.
