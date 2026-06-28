// Bun-runtime guard. my-kioku depends on Bun-only APIs (bun:sqlite in 13 files,
// Bun.sleep, `with { type: "text" }` imports), so it cannot run on plain Node.
//
// cli.ts imports THIS first, then DYNAMICALLY imports the real logic — so the check
// below runs before any Bun-only module is resolved, letting a non-Bun runtime get a
// clear message instead of a cryptic loader error.
//
// On Node ≥22.6 (default TS stripping) Node actually loads cli.ts and this guard is the
// PRIMARY friendly-failure path — the message prints and the process exits 1. Bypassing
// it (KIOKU_SKIP_BUN_GUARD=1) under Node shows what it prevents: the first crash is
// `ERR_UNKNOWN_FILE_EXTENSION ".md"` on the `with { type: "text" }` import in init.ts —
// it resolves before bun:sqlite. The earlier OS-level paths (no Bun on PATH → the
// `#!/usr/bin/env bun` shebang fails; older Node can't load .ts at all) fail before any
// JS runs; `engines.bun` + the README cover those.

/** True when the current runtime exposes the Bun global. */
export function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

/** Message shown when not running under Bun. */
export const REQUIRE_BUN_MESSAGE =
  "my-kioku requires the Bun runtime (it uses bun:sqlite and other Bun APIs).\n" +
  "Install Bun: https://bun.sh  — then run:  bunx my-kioku <command>\n";

// Side effect on import: fail fast if not on Bun. Skipped when the test harness sets
// KIOKU_SKIP_BUN_GUARD (so importing this module in a test doesn't exit the runner).
if (!isBun() && process.env.KIOKU_SKIP_BUN_GUARD !== "1") {
  process.stderr.write(REQUIRE_BUN_MESSAGE);
  process.exit(1);
}
