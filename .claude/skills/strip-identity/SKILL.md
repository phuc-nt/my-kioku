---
name: mk:strip-identity
description: "Remove upstream identity markers from kit content after an upstream sync. Use after pulling upstream updates, before committing or publishing, to rewrite ck: prefixes, project names, authors, and domains."
category: dev-tools
keywords: [identity, upstream-sync, rename, ck-prefix, maintenance]
argument-hint: "[target-dir]  (default: claude/)"
metadata:
  author: my-kit
  version: "1.0.0"
---

# Strip Identity

Rewrites every upstream identity marker in kit content to the my-agent-kit
equivalents, then verifies none remain. Run this **after every upstream sync**,
before committing or publishing.

## When to use

- After bulk-copying upstream content into `claude/` (upstream sync workflow)
- Before `git commit` / `npm publish` following any upstream merge
- As a CI gate — `verify.sh` exits non-zero if any marker leaks

## Why this skill exists

The v2.0.0 release was stripped by hand with `sed` + `\b` word boundaries.
BSD/macOS `sed` does not honor `\b` consistently, so the `ck:<skill>` slash
command pattern slipped through — **246 files shipped with `/ck:cook` instead
of `/mk:cook`** (fixed in v2.0.1). These scripts encode the verified
boundary-safe patterns so that bug class cannot recur.

## The two scripts

| Script | Purpose | Exit |
|---|---|---|
| `scripts/strip.sh [dir]` | Apply all substitutions in place | 0 = applied |
| `scripts/verify.sh [dir]` | Fail if any marker remains | 0 = clean, 1 = dirty |

Default target is `claude/`. Always run `verify.sh` after `strip.sh`.

```bash
bash claude/skills/strip-identity/scripts/strip.sh
bash claude/skills/strip-identity/scripts/verify.sh   # must exit 0
```

## What gets rewritten

| Marker | Becomes |
|---|---|
| `claudekit-engineer` | `my-agent-kit` |
| `claudekit-marketing` | `my-marketing-kit` |
| `claudekit-cli` / `claudekit-docs` | `my-kit-cli` / `my-kit-docs` |
| `ClaudeKit` / `CLAUDEKIT` / `claudekit` | `MyKit` / `MYKIT` / `my-kit` |
| `docs.claudekit.cc` / `claudekit.cc` | `docs.my-kit.local` / `my-kit.local` |
| `github.com/claudekit/...` | (removed) |
| `@goonnguyen` / `mrgoonie` / `goonie` | `personal` |
| `Udit Goenka` | `original author` |
| `.ck.json` / `.ckignore` | `.mk.json` / `.mkignore` |
| `ck-config` / `ck-paths` | `mk-config` / `mk-paths` |
| `ck:<name>` (slash command) | `mk:<name>` |

## Critical implementation notes

**The `ck:` rule.** A naive `s/ck:/mk:/g` corrupts `check:`, `block:`,
`track:`, `feedback:`, `stack:`, `lock:`. The safe pattern is a negative
lookbehind — replace `ck:` only when **not preceded by an ASCII letter**:

```
(?<![a-zA-Z])ck:
```

This matches `/ck:fix`, `ck:cook`, `"ck:test"` but never the inside of a
longer word.

**Perl, not grep -P or sed.** macOS/BSD `grep` has no `-P` (PCRE); BSD `sed`
has no lookbehind. Both scripts use `perl`, whose regex engine is identical
across platforms. `perl` is a hard dependency — the scripts abort if missing.

**Substitution order matters.** Longest project names (`claudekit-engineer`)
are rewritten before the bare `claudekit`, otherwise `claudekit` consumes the
`-engineer`/`-cli` suffix first and leaves `my-kit-engineer`.

**`metadata.json` is excluded** from the `ck-paths` / `.ck` checks. Its
`deletions` array intentionally retains legacy paths (e.g.
`hooks/lib/ck-paths.cjs`) so `mk-init.sh --upgrade` knows to delete them from
old installs. Do not "fix" those entries.

## Adding a new marker

Add the substitution to **both** scripts:

- `strip.sh` — a new `s/.../.../g` line (mind the ordering rule above)
- `verify.sh` — extend the relevant `scan '...'` pattern

Then re-run the fixture test (see git history of this skill for the test
fixture used to validate the `ck:` lookbehind against `check:`/`block:`).
