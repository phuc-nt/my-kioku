// Walk a vault and classify every markdown file by kind. Skips the .kioku/ index
// folder and any dotfiles. Shared by full reindex and lazy sync.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_INDEX_DIR } from "../config.ts";

export type FileKind = "journal" | "entity" | "insight";

export interface VaultFile {
  path: string; // absolute
  rel: string; // relative to vault root
  kind: FileKind;
  mtimeMs: number;
}

/** Map a top-level folder to a file kind; null = ignore. */
function kindForRel(rel: string): FileKind | null {
  if (rel.startsWith("journal/")) return "journal";
  if (rel.startsWith("entities/")) return "entity";
  if (rel.startsWith("insights/")) return "insight";
  return null;
}

/**
 * Build a VaultFile for one relative path by stat-ing it directly (no walk).
 * Returns null if the file does not exist or is not an indexable kind.
 */
export function vaultFileFor(vault: string, rel: string): VaultFile | null {
  const norm = rel.split("\\").join("/");
  const kind = kindForRel(norm);
  if (!kind) return null;
  const full = join(vault, norm);
  if (!existsSync(full)) return null;
  try {
    return { path: full, rel: norm, kind, mtimeMs: statSync(full).mtimeMs };
  } catch {
    return null;
  }
}

/** Recursively collect indexable markdown files under the vault. */
export function walkVault(vault: string): VaultFile[] {
  const out: VaultFile[] = [];

  const recurse = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return; // directory vanished mid-walk — ignore
    }
    for (const ent of entries) {
      const name = ent.name;
      if (name.startsWith(".") || name === VAULT_INDEX_DIR) continue;
      const full = join(dir, name);
      if (ent.isDirectory()) {
        recurse(full);
      } else if (ent.isFile() && name.endsWith(".md")) {
        const rel = relative(vault, full).split("\\").join("/");
        const kind = kindForRel(rel);
        if (!kind) continue;
        try {
          out.push({ path: full, rel, kind, mtimeMs: statSync(full).mtimeMs });
        } catch {
          // file removed between readdir and stat — skip
        }
      }
    }
  };

  recurse(vault);
  return out;
}
