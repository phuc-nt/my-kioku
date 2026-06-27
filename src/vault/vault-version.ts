// Vault format versioning — distinct from SCHEMA_VERSION (the disposable SQLite
// index) and the npm package version. This tracks the VAULT'S markdown conventions
// (daily-note layout, inline fields, entity-note shape) so a future binary can
// detect an older vault and migrate it safely.
//
// Bump VAULT_FORMAT_VERSION ONLY when the on-disk markdown format changes in a way
// that needs migration — NOT on every release. v1 + v1.1 share format version 1
// (relations/tags are additive inline fields; old vaults parse unchanged).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VAULT_FORMAT_VERSION = 1;
// Lives at the vault ROOT (not .kioku/, which is gitignored) so it is tracked by
// the vault's own git history.
export const VAULT_VERSION_FILE = "vault-version.json";

export interface VaultVersion {
  vault_format_version: number;
  my_kioku_version: string; // the binary version that created/last-touched it
  created: string; // YYYY-MM-DD
}

export function vaultVersionPath(vault: string): string {
  return join(vault, VAULT_VERSION_FILE);
}

export function readVaultVersion(vault: string): VaultVersion | null {
  const path = vaultVersionPath(vault);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VaultVersion;
  } catch {
    return null;
  }
}

/** Write the version marker if absent (idempotent — never clobbers an existing one). */
export function ensureVaultVersion(
  vault: string,
  myKiokuVersion: string,
  today: string,
): VaultVersion {
  const existing = readVaultVersion(vault);
  if (existing) return existing;
  const v: VaultVersion = {
    vault_format_version: VAULT_FORMAT_VERSION,
    my_kioku_version: myKiokuVersion,
    created: today,
  };
  writeFileSync(vaultVersionPath(vault), JSON.stringify(v, null, 2) + "\n", "utf8");
  return v;
}

/**
 * Compare a vault's format version to the binary's.
 * - "current": same version.
 * - "vault_older": vault predates the binary → a future migration may be needed.
 * - "vault_newer": vault written by a newer binary → this binary may not understand it.
 * - "unversioned": no marker (a pre-versioning vault) — treat as needing init.
 */
export function compareVaultVersion(
  vault: string,
): "current" | "vault_older" | "vault_newer" | "unversioned" {
  const v = readVaultVersion(vault);
  if (!v) return "unversioned";
  if (v.vault_format_version === VAULT_FORMAT_VERSION) return "current";
  return v.vault_format_version < VAULT_FORMAT_VERSION ? "vault_older" : "vault_newer";
}
