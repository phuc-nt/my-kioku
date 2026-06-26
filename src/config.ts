// Vault path resolution. Precedence (validation session 1):
//   --vault flag  →  env MY_KIOKU_VAULT  →  ~/.my-kioku/config.json key "vault"  →  error
// The config dir is ~/.my-kioku (binary renamed from `kioku`); the index folder
// INSIDE the vault stays `.kioku/` (short, vault-internal, no collision).

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const CONFIG_DIR = join(homedir(), ".my-kioku");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** Index folder name inside a vault (kept short, intentionally NOT renamed). */
export const VAULT_INDEX_DIR = ".kioku";

export interface UserConfig {
  vault?: string;
}

export function readUserConfig(): UserConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as UserConfig;
  } catch {
    return {};
  }
}

export interface ResolveOptions {
  /** Value of an explicit --vault flag, if any. */
  vaultFlag?: string;
  /** When true, skip the existence check (used by `init`, which creates the vault). */
  allowMissing?: boolean;
}

/**
 * Resolve the active vault path following the documented precedence.
 * Returns the resolved absolute path, or null with no source found.
 * Existence is validated unless allowMissing is set.
 */
export function resolveVault(opts: ResolveOptions = {}): {
  path: string | null;
  source: "flag" | "env" | "config" | "none";
  exists: boolean;
} {
  let path: string | null = null;
  let source: "flag" | "env" | "config" | "none" = "none";

  if (opts.vaultFlag) {
    path = opts.vaultFlag;
    source = "flag";
  } else if (process.env.MY_KIOKU_VAULT) {
    path = process.env.MY_KIOKU_VAULT;
    source = "env";
  } else {
    const cfg = readUserConfig();
    if (cfg.vault) {
      path = cfg.vault;
      source = "config";
    }
  }

  const exists = path ? existsSync(path) : false;
  return { path, source, exists };
}

/** Human-readable hint shown when no vault can be resolved. */
export const NO_VAULT_HINT =
  "Set a vault: pass --vault <path>, export MY_KIOKU_VAULT=<path>, " +
  "or run `my-kioku init --vault <path>` to create one.";
