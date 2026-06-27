import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VAULT_FORMAT_VERSION,
  ensureVaultVersion,
  readVaultVersion,
  compareVaultVersion,
  vaultVersionPath,
} from "../../src/vault/vault-version.ts";

const dirs: string[] = [];
function vault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-ver-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("ensureVaultVersion writes the marker at vault root (git-tracked)", () => {
  const v = vault();
  const written = ensureVaultVersion(v, "0.2.0", "2026-06-27");
  expect(written.vault_format_version).toBe(VAULT_FORMAT_VERSION);
  expect(written.my_kioku_version).toBe("0.2.0");
  expect(written.created).toBe("2026-06-27");
  // At root, NOT inside .kioku/ (so the vault's own git tracks it).
  expect(vaultVersionPath(v).endsWith("/vault-version.json")).toBe(true);
  expect(vaultVersionPath(v)).not.toContain(".kioku");
});

test("ensureVaultVersion is idempotent (never clobbers an existing marker)", () => {
  const v = vault();
  ensureVaultVersion(v, "0.2.0", "2026-06-27");
  const second = ensureVaultVersion(v, "9.9.9", "2099-01-01");
  // Returns the ORIGINAL, doesn't overwrite.
  expect(second.my_kioku_version).toBe("0.2.0");
  expect(second.created).toBe("2026-06-27");
});

test("compareVaultVersion detects current / older / newer / unversioned", () => {
  const v = vault();
  expect(compareVaultVersion(v)).toBe("unversioned");
  ensureVaultVersion(v, "0.2.0", "2026-06-27");
  expect(compareVaultVersion(v)).toBe("current");

  // Simulate an older vault.
  writeFileSync(
    vaultVersionPath(v),
    JSON.stringify({ vault_format_version: VAULT_FORMAT_VERSION - 1, my_kioku_version: "0.1.0", created: "2026-01-01" }),
  );
  expect(compareVaultVersion(v)).toBe("vault_older");

  // Simulate a newer vault (written by a future binary).
  writeFileSync(
    vaultVersionPath(v),
    JSON.stringify({ vault_format_version: VAULT_FORMAT_VERSION + 1, my_kioku_version: "9.0.0", created: "2099-01-01" }),
  );
  expect(compareVaultVersion(v)).toBe("vault_newer");
});

test("readVaultVersion tolerates a corrupt marker (returns null)", () => {
  const v = vault();
  writeFileSync(vaultVersionPath(v), "{ not json");
  expect(readVaultVersion(v)).toBeNull();
  expect(compareVaultVersion(v)).toBe("unversioned");
});
