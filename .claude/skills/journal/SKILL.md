---
name: mk:journal
description: "Write technical journal entries analyzing recent changes. Use for session reflections, change analysis, decision documentation."
category: utilities
keywords: [journal, reflection, changes, session]
argument-hint: "[topic or reflection]"
metadata:
  author: my-kit
  version: "1.0.0"
---

# Journal

Use the `journal-writer` subagent to explore the memories and recent code changes, and write some journal entries.
Journal entries should be concise and focused on the most important events, key changes, impacts, and decisions.
Keep journal entries in the `./docs/journals/` directory.

**IMPORTANT:** Invoke "/mk:project-organization" skill to organize the outputs.

## Workflow Position

**Typically follows:** `/mk:ship` (journal after shipping), `/mk:cook` (journal after implementation), `/mk:fix` (journal after bug fix)
**Terminal skill** — no typical successor.
