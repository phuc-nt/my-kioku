// `my-kioku init` — create (or top up) a vault's folder structure.
// Idempotent: re-running never destroys existing data.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT, VAULT_INDEX_DIR } from "../config.ts";

const VAULT_README = `# my-kioku vault

This folder is an Obsidian vault that doubles as the database for a personal
diary agent. **The markdown is the source of truth** — the \`.kioku/\` index is
disposable and can be rebuilt at any time with \`my-kioku reindex\`.

## Layout

- \`journal/YYYY/MM/YYYY-MM-DD.md\` — daily notes. Each entry is a \`## HH:MM\`
  section. The first line may carry a mood inline field: \`mood:: happy/4\`.
  Daily frontmatter holds health check-ins (sleep_hours, exercise, mood_score).
- \`entities/<Name>.md\` — one note per person/place/event, linked from entries
  via \`[[wikilinks]]\`. Frontmatter \`type:\` classifies it (person/place/...).
- \`insights/\` — agent-written reflections and patterns.
- \`.kioku/\` — disposable SQLite index + reflect output. Safe to delete.

## Conventions

- Entries are stored **verbatim**. The CLI never summarizes or rewrites them.
- Link people/places/events with \`[[Name]]\` so the graph and recall work.
- Mood is a free-form word plus optional 1–5 intensity: \`mood:: tired/2\`.
`;

export function runInit(vaultFlag?: string): never {
  const resolved = resolveVault({ vaultFlag, allowMissing: true });
  if (!resolved.path) {
    return fail("No vault path provided.", NO_VAULT_HINT);
  }

  const vault = resolved.path;
  const folders = ["journal", "entities", "insights", VAULT_INDEX_DIR];
  const created: string[] = [];

  for (const f of folders) {
    const dir = join(vault, f);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(f);
    }
  }

  // Keep the disposable index out of git.
  const indexGitignore = join(vault, VAULT_INDEX_DIR, ".gitignore");
  if (!existsSync(indexGitignore)) {
    writeFileSync(indexGitignore, "*\n", "utf8");
  }

  // Vault README documents conventions — write once, never clobber edits.
  const readmePath = join(vault, "vault-README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, VAULT_README, "utf8");
  }

  return ok({
    vault,
    created,
    already_present: folders.filter((f) => !created.includes(f)),
  });
}
