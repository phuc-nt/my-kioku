# openclaw integration

Concrete recipe for making the openclaw Telegram diary agent use my-kioku as its
memory. Two wires: a **SessionStart hook** that injects recent context, and a **cron
job** that runs the living loop. Read [integration-guide.md](./integration-guide.md)
first for the command/JSON contract.

## Prerequisites

```bash
bun add -g my-kioku                       # Bun ≥1.3 required
my-kioku init --vault ~/kioku-vault       # one-time
export MY_KIOKU_VAULT=~/kioku-vault       # the agent's env must have this
```

The vault should be its own git repo (markdown is the source of truth; `.kioku/` is
gitignored). Drop the agent protocol into openclaw's instructions:

```bash
my-kioku init --vault ~/kioku-vault --skill <openclaw-skills-dir>
```

## 1. Write memories during a chat

When the user tells the agent something about their life, the agent runs one
`remember` (always `--stdin`). Link people/places/events with `[[Name]]`:

```bash
my-kioku remember --stdin --mood happy/4 <<'EOF'
Hôm nay đi cà phê với [[Hùng]], nói chuyện về [[dự án mới]].
EOF
```

Keep the user's exact words (verbatim contract — see integration-guide). The JSON
reply's `links` / `stubs_created` let the agent confirm what was captured.

## 2. SessionStart hook — inject recent context

`init --hook` writes a wrapper script into `<vault>/.kioku/` and prints the settings
snippet:

```bash
my-kioku init --vault ~/kioku-vault --hook
```

The script is a thin wrapper around `my-kioku recall --digest --since 7d`; it prints
ONLY a success envelope and never blocks the session on error. Wire it into the agent's
SessionStart (Claude Code `settings.json` shape; adapt to openclaw's hook mechanism):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "bash ~/kioku-vault/.kioku/kioku-session-start-digest.sh" } ] }
    ]
  }
}
```

Ensure `MY_KIOKU_VAULT` is exported in the hook's environment (the script honors it;
`MY_KIOKU_BIN` overrides the binary name). Result: every new session starts with a
compact `{period, mood_summary, checkin, active_entities, recent_entries}` digest as
context — the agent "remembers" the last week without the user re-explaining.

## 3. Cron — run the living loop

`reflect` is deterministic and read-only; it surfaces `suggested_actions`. Schedule it,
then have the agent act on the output (classify entity types, backfill links, merge
aliases, add emotional relations, write insights). Example openclaw cron job
(`~/.openclaw/cron/jobs.json` shape):

```json
{
  "id": "<uuid>",
  "agentId": "personal",
  "name": "my-kioku living loop — nightly reflect",
  "enabled": true,
  "schedule": { "kind": "cron", "expr": "0 3 * * *", "tz": "Asia/Ho_Chi_Minh" },
  "prompt": "Run `my-kioku reflect --vault ~/kioku-vault --since 30d`, then work the data.suggested_actions list top to bottom. Edit the vault markdown directly. NEVER rewrite the user's words — preserve language and wording verbatim; only set entity type: fields and add [[links]] / relation lines."
}
```

The agent reads `data.suggested_actions` (prioritized plain-text actions, each tracing
to a real entry/file id) and applies edits. Over time the vault's graph fills in and
insight notes accumulate — the memory improves itself.

## Safety notes

- **Verbatim:** the agent must never summarize/translate the user's text. A small model
  cannot be trusted here, so review its edits (the reference sim harnesses in
  `tests/sim/` enforce a verbatim assertion at the code layer; mirror that discipline).
- **Model:** any model works; a cheap one is fine for the deterministic-action loop
  since `reflect` does the analysis and the agent only judges/applies.
- **Vault git:** commit the vault after each loop so memory has a diff-able history and
  any bad edit is revertable.

## Quick check

```bash
my-kioku recall --vault ~/kioku-vault --digest --since 7d   # what the hook injects
my-kioku reflect --vault ~/kioku-vault --since 30d          # what cron feeds the agent
```
