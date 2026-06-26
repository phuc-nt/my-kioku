import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVault } from "../src/config.ts";

const tmpDirs: string[] = [];
function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-cfg-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  delete process.env.MY_KIOKU_VAULT;
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

test("resolveVault prefers --vault flag", () => {
  const dir = makeTmp();
  process.env.MY_KIOKU_VAULT = "/should/be/ignored";
  const r = resolveVault({ vaultFlag: dir });
  expect(r.source).toBe("flag");
  expect(r.path).toBe(dir);
  expect(r.exists).toBe(true);
});

test("resolveVault falls back to env", () => {
  const dir = makeTmp();
  process.env.MY_KIOKU_VAULT = dir;
  const r = resolveVault({});
  expect(r.source).toBe("env");
  expect(r.path).toBe(dir);
  expect(r.exists).toBe(true);
});

test("resolveVault reports non-existent path", () => {
  const r = resolveVault({ vaultFlag: "/nope/does/not/exist/kioku" });
  expect(r.source).toBe("flag");
  expect(r.exists).toBe(false);
});

test("resolveVault returns none when nothing set", () => {
  // Note: a real ~/.my-kioku/config.json could exist; this test only asserts
  // that with no flag and no env, source is not 'flag' or 'env'.
  const r = resolveVault({});
  expect(["config", "none"]).toContain(r.source);
});
