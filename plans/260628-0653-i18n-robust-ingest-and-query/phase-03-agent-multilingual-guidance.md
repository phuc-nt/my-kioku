---
phase: 3
title: "Agent multilingual guidance (docs only)"
status: pending
priority: P3
effort: "0.5h"
dependencies: []
---

# Phase 3: Agent multilingual guidance (docs only)

## Overview
The "agent understands mixed EN-VI" goal is **not** a search-engine change — it's a
prompt instruction for the living-loop agent (openclaw/Qwen). When a user writes
mixed VI-EN, the agent must keep the user's original language and not translate when
classifying entities or extracting relations. The verbatim guard already exists at
the code layer (tests/sim assertions); this phase makes the expectation explicit in
the agent-facing SKILL.md so the behavior is intended, not accidental.

## Requirements
- Functional: the vault-agent SKILL.md states the language-preservation rule clearly
  enough that a small model follows it: don't translate user words; keep EN proper
  nouns in EN; entity `type:` may be English (schema vocabulary) but display names
  and bodies stay in the user's language.
- Non-functional: docs only — zero code change, zero SCHEMA impact.

## Architecture
The agent contract lives in the SKILL.md that `init --skill <dir>` copies into the
vault (the agent's operating instructions). Add a short "Language" subsection. No
engine change — the code-layer verbatim assertion ([tests/sim](../../tests/sim))
already rejects any edit that altered the user's words; this phase documents the
*intent* so the agent doesn't fight the guard.

## Related Code Files
- Modify: the agent SKILL.md template shipped by `init --skill` (locate via
  `src/commands/init.ts`; likely under an assets/skill path). Add "Language" section.
- Possibly: `README.md` "living loop" note — one line that the agent preserves user
  language.

## Implementation Steps
1. Locate the SKILL.md template referenced by `init --skill` (read `init.ts`).
2. Add a concise "Language" subsection: "Keep the user's words verbatim. Do not
   translate. Proper nouns stay in their original language. Only the entity `type:`
   field uses the fixed English vocabulary (person/place/event/activity/thing)."
3. If a real vault's copied SKILL.md exists (~/kioku-vault), note it's a copy — the
   template is the source; document that re-running `init --skill` refreshes it.
4. No tsc/test needed (docs), but run `bun test` to confirm nothing referencing the
   template path broke.

## Success Criteria
- [ ] SKILL.md template has an explicit, small-model-friendly Language rule.
- [ ] No code/SCHEMA change; full suite still green.
- [ ] code-reviewer (light): wording is unambiguous and consistent with the
      verbatim contract already enforced in code.

## Risk Assessment
- Risk: instruction contradicts existing SKILL.md wording. Mitigation: read the whole
  template first, integrate consistently.
- Low overall — documentation only.

## Cadence
code (docs) → review (light) → commit (git-manager) → journal. (No tester gate; docs.)
