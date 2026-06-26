# Skill Workflow Routing

When orchestrating multi-step tasks, consider these workflow sequences. Skills are listed in typical execution order.

## Core Development Workflow

```
/mk:plan → /mk:cook → /mk:test → /mk:code-review → /mk:ship → /mk:journal
```

| User Intent | Suggested Start |
|-------------|----------------|
| "implement feature X", "build X", "add X" | `/mk:plan` then `/mk:cook` |
| "execute this plan" | `/mk:cook <plan-path>` |
| "quick implementation" | `/mk:cook --fast` |

## Bugfix Workflow

```
/mk:scout → /mk:debug → /mk:fix → /mk:test → /mk:code-review
```

| User Intent | Suggested Start |
|-------------|----------------|
| "X is broken", "error in X", "bug in X" | `/mk:fix` (auto-scouts internally) |
| "CI is failing", "tests broken" | `/mk:fix --auto` |
| "investigate why X happens" | `/mk:scout` then `/mk:debug` |

## Investigation Workflow

```
/mk:scout → /mk:debug → /mk:brainstorm → /mk:plan
```

| User Intent | Suggested Start |
|-------------|----------------|
| "understand how X works" | `/mk:scout` |
| "why is X happening" | `/mk:debug` |
| "explore options for X" | `/mk:brainstorm` then `/mk:plan` |

## Post-Implementation Checklist

After completing implementation work, consider:
- `/mk:code-review` — review changes before merging
- `/mk:ship` — run full shipping pipeline (tests, review, version, PR)
- `/mk:journal` — document decisions and lessons learned

## Setup Skills

Before starting implementation in a shared codebase:
- `/mk:worktree` — create isolated worktree for the feature/fix
- `/mk:scout` — discover relevant files and code patterns
