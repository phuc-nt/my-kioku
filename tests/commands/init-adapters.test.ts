// Tests for `init --skill` / `init --hook`. Crucially includes a COMPILED-BINARY
// smoke test: resources are embedded via `with { type: "text" }`, and the only
// way to prove they ship correctly is to build the binary and run it (running
// from source can't catch the /$bunfs resource-resolution failure).

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;
let scratch: string;

interface RunResult { ok: boolean; data?: any; error?: string; exitCode: number; }
function runWith(cmd: string[], args: string[]): RunResult {
  const proc = Bun.spawnSync([...cmd, ...args]);
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}
const fromSource = (args: string[]) => runWith(["bun", "run", CLI], args);

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-adapt-vault-"));
  scratch = mkdtempSync(join(tmpdir(), "kioku-adapt-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

test("init --skill writes a non-empty SKILL.md (source mode)", () => {
  const skillDir = join(scratch, "agent");
  const r = fromSource(["init", "--vault", vault, "--skill", skillDir]);
  expect(r.ok).toBe(true);
  expect(r.exitCode).toBe(0);
  expect(existsSync(r.data.skill_written)).toBe(true);
  const content = readFileSync(r.data.skill_written, "utf8");
  expect(content).toContain("my-kioku");
  expect(content).toContain("remember");
  expect(content.length).toBeGreaterThan(500);
});

test("init --hook writes the hook script and returns a real path (source mode)", () => {
  const r = fromSource(["init", "--vault", vault, "--hook"]);
  expect(r.ok).toBe(true);
  expect(existsSync(r.data.hook.script)).toBe(true);
  const sh = readFileSync(r.data.hook.script, "utf8");
  expect(sh).toContain("recall --digest");
  // The settings snippet points at the SAME real path.
  const cmd = r.data.hook.settings_snippet.hooks.SessionStart[0].hooks[0].command;
  expect(cmd).toContain(r.data.hook.script);
});

test("COMPILED BINARY: --skill and --hook work (resources embedded)", () => {
  // Build the binary into the scratch dir (dist/ is access-blocked).
  const bin = join(scratch, "my-kioku-bin");
  const build = Bun.spawnSync([
    "bun", "build", "--compile", CLI, "--outfile", bin,
  ]);
  expect(build.exitCode).toBe(0);

  const skillDir = join(scratch, "agent2");
  const r = runWith([bin], ["init", "--vault", vault, "--skill", skillDir, "--hook"]);
  expect(r.ok).toBe(true);
  expect(r.exitCode).toBe(0);
  // SKILL.md was embedded and written from the compiled binary.
  expect(existsSync(r.data.skill_written)).toBe(true);
  expect(readFileSync(r.data.skill_written, "utf8")).toContain("remember");
  // Hook script written to a real on-disk path by the compiled binary.
  expect(existsSync(r.data.hook.script)).toBe(true);
}, 30_000);
