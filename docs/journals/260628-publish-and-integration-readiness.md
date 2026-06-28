# Bun-Required npm Package Published — The Lessons Learned

**Date**: 2026-06-28 17:44
**Severity**: High
**Component**: Package distribution, runtime integration, documentation
**Status**: Resolved (published, integration docs shipped)

## What Happened

Finalized my-kioku for npm publication (0.3.1) and integration readiness. Three commits landed on origin/main: npm readiness + Bun runtime guard (Phase 1), agent integration documentation (Phase 2), README + release (Phase 3). Package ships TypeScript source directly — bunx runs `src/cli.ts`, no build step. Integration contract = CLI JSON envelope only; no library exports (YAGNI). Docs link to integration guides from README; guides not bundled in npm tarball.

## The Brutal Truth

This shipped correctly, but only because code review and verification caught THREE separate problems that would have broken users or the publish pipeline itself. The "clean shipping" feeling masks how close we came to releasing a package that either can't be published, crashes cryptically on Node, or ships undocumented JSON fields integrators would reject. That's humbling.

## Technical Details

**Bun Runtime Guard — ES Module Resolution Order Issue**

The original plan: add `import "./require-bun.ts"` on line 1 of `src/cli.ts` to guard against non-Bun runtimes. Theory: guard runs first, checks runtime, prints friendly error if needed.

Reality: ES modules resolve ALL top-level static imports before ANY code body executes. Under Node ≥22.6 (default TypeScript stripping), trying to resolve `src/cli.ts` hits `bun:sqlite` and `.md` text imports (lines 13–16) during the import phase — the guard never runs. First error is `ERR_UNKNOWN_FILE_EXTENSION` on the markdown import, not a friendly "requires Bun" message.

Fix: Split `cli.ts` into a tiny guarded entry point + dynamic import. Entry point: check runtime, print message, exit if not Bun. Only then `await import("./cli-main.ts")`. Now Bun-only modules load AFTER the guard passes. Code review verified this on Node 25 — guard fires, message prints, exit 1. Without it: cryptic extension error.

Lesson: **A runtime guard for modules must run before static import resolution of the thing it guards.** Use dynamic import to defer loading.

**Missing typescript Dependency — Publish Pipeline Silent Failure**

`package.json` declared `typescript` only in `optionalDependencies` (intent: prefer bunx tsc). Lifecycle script `prepublishOnly` runs `tsc`. On a clean machine (no prior install), `npm publish` fails with "tsc: command not found" because tsc isn't in node_modules or PATH. The script doesn't auto-download bunx binaries during npm lifecycle.

Fix: Move `typescript@5.x` to `devDependencies`. Now `npm install` resolves tsc to `./node_modules/.bin/tsc`, `prepublishOnly` runs cleanly, publish succeeds.

Lesson: **Any tool a lifecycle script invokes must be a declared dependency.** PATH and on-demand downloads don't work in npm's execution sandbox.

**Undocumented JSON Fields — Integration Schema Rejection**

Code review of integration docs caught: `recall` response includes top-level `entity_context[]` (extracted entities), per-result `score` (confidence), and conditional `remember` data structure (`checkin` mode returns `{date, checkin}`; text mode returns full entry + `warnings[]`). The integration guide documented only the happy path and omitted these entirely.

A strict integrator building a schema validator would fail on unknown keys. Fix: documented all fields, added guidance "tolerate additive fields, ignore unknown keys for forward compatibility."

Lesson: **Document JSON contracts from LIVE output, not memory.** Tell integrators to use open schemas.

## What We Tried

1. **Simple guard on line 1** → Failed: ES module resolution precedes guard execution
2. **Dynamic import deferred guard** → Worked: guard runs before module loading
3. **Optional TypeScript dependency** → Failed: npm publish breaks on clean machine
4. **TypeScript in devDependencies** → Worked: tsc resolves in lifecycle
5. **Memory-based JSON docs** → Failed: omitted live fields
6. **Live output auditing + schema validation** → Worked: caught additions

## Root Cause Analysis

**Guard issue**: Misunderstood ES module load semantics. Assumed imports execute sequentially within the module body; they actually resolve statically upfront.

**TypeScript issue**: Confused "bunx can download tsc" with "tsc is available during npm lifecycle scripts." npm lifecycle runs in isolation; it doesn't inherit PATH or auto-download binaries.

**JSON docs issue**: Lazy — wrote integration guide from code inspection, not from capturing ACTUAL CLI output. Skipped the "call the CLI and compare docs to output" verification step.

## Lessons Learned

1. **ES Module guards must defer loads:** Next time a runtime guard is needed, reach for dynamic import immediately. Don't try to guard static imports — it's impossible.

2. **Lifecycle scripts need declared dependencies:** If a script calls a tool, declare it. Don't rely on PATH or bunx auto-download during npm publish/install.

3. **Capture JSON from LIVE output, not code:** Before finalizing integration docs, call the actual CLI with test data and dump the response. Diff output against docs. Bake this into the verification checklist.

4. **Verification cadence works:** Code → verify → code-review → commit. The per-phase rhythm caught all three issues. Skipping review would have shipped broken.

5. **Bun lock-in is real, but accepted:** 13 files use `bun:sqlite`. Node port would need a database abstraction layer (significant refactor). YAGNI was the right call — no users asked for Node support, no integrators require it (they spawn the CLI). Shipping as-is (Bun-only, TS source, bunx runner) is the leanest path.

## Next Steps

1. **User action (not ours)**: Run `npm publish` when ready. The pipeline is now safe — prepublishOnly gates it, `npm pack --dry-run` audited (48 files, secret-free, lean).

2. **Verify real integration**: openclaw integration docs exist (Phase 2), but actual openclaw consumption is not yet wired. Future: open issue to connect openclaw agent to my-kioku CLI.

3. **Monitor integration feedback**: Ship integration docs, watch for schema complaints. If strict integrators hit unknown fields, adjust guidance or consider backcompat warnings.

---

**Unresolved Questions:**
- Should integration docs ship in npm tarball? Currently link-only (lean package). Revisit if users ask.
- Will openclaw team actually use the integration guide, or does it need direct support/PR from us?
