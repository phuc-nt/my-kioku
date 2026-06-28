import { test, expect, beforeAll } from "bun:test";

// Importing the guard runs its side effect (process.exit) unless this is set.
beforeAll(() => {
  process.env.KIOKU_SKIP_BUN_GUARD = "1";
});

test("isBun() is true under the Bun test runner", async () => {
  const { isBun } = await import("../../src/lib/require-bun.ts");
  expect(isBun()).toBe(true);
});

test("the require-bun message names Bun and the install URL", async () => {
  const { REQUIRE_BUN_MESSAGE } = await import("../../src/lib/require-bun.ts");
  expect(REQUIRE_BUN_MESSAGE).toContain("Bun");
  expect(REQUIRE_BUN_MESSAGE).toContain("https://bun.sh");
});

test("a non-Bun runtime fails fast and never succeeds (subprocess)", () => {
  // Run cli.ts under Node. On Node ≥22.6 (default TS stripping) Node loads cli.ts, the
  // guard fires, and the friendly message prints to stderr. On older Node it fails at
  // module load (ERR_UNKNOWN_FILE_EXTENSION) before the guard. Either way: non-zero exit
  // and NO success envelope — a non-Bun invocation never silently succeeds.
  const proc = Bun.spawnSync(["node", "src/cli.ts", "recall", "x"], {
    cwd: import.meta.dir + "/../..",
  });
  expect(proc.exitCode).not.toBe(0);
  expect(proc.stdout.toString()).not.toContain('"ok":true');
  // On a TS-capable Node the guard message must reach the user; tolerate the older-Node
  // load-time failure where it can't.
  const stderr = proc.stderr.toString();
  const guardFired = stderr.includes("requires the Bun runtime");
  const loadFailedFirst = stderr.includes("ERR_UNKNOWN_FILE_EXTENSION");
  expect(guardFired || loadFailedFirst).toBe(true);
});
