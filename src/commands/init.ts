// `my-kioku init` — create (or top up) a vault's folder structure.
// Idempotent: re-running never destroys existing data.
// Flags: --skill <dir> writes the agent SKILL.md; --hook prints hook setup help.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ok, fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT, VAULT_INDEX_DIR } from "../config.ts";
// Embed the resources as TEXT so they ship inside the `bun build --compile`
// binary. Reading them from a resources/ dir on disk fails in a compiled binary
// (import.meta.dir resolves to a virtual /$bunfs path) — embedding is the only
// way --skill/--hook work both from source and as a shipped binary.
import SKILL_MD from "../../resources/SKILL.md" with { type: "text" };
import HOOK_SH from "../../resources/hooks/kioku-session-start-digest.sh" with { type: "text" };

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

export interface InitArgs {
  vaultFlag?: string;
  skillDir?: string; // --skill <dir>: copy SKILL.md there
  hook?: boolean; // --hook: print hook setup guidance
}

export function runInit(args: InitArgs): never {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag, allowMissing: true });
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

  const result: Record<string, unknown> = {
    vault,
    created,
    already_present: folders.filter((f) => !created.includes(f)),
  };

  // --skill: write the (embedded) agent protocol into the target dir.
  // Overwrites an existing SKILL.md intentionally — it is canonical protocol that
  // should track the installed binary version.
  if (args.skillDir) {
    mkdirSync(args.skillDir, { recursive: true });
    const dest = join(args.skillDir, "SKILL.md");
    writeFileSync(dest, SKILL_MD, "utf8");
    result.skill_written = dest;
  }

  // --hook: write the (embedded) hook script to a stable on-disk path inside the
  // vault index folder, then PRINT guidance (never edits the user's settings.json).
  if (args.hook) {
    const hookPath = join(vault, VAULT_INDEX_DIR, "kioku-session-start-digest.sh");
    writeFileSync(hookPath, HOOK_SH, { encoding: "utf8", mode: 0o755 });
    result.hook = {
      script: hookPath,
      instructions:
        "Add to your Claude Code settings.json (do not let any tool edit it for you):",
      settings_snippet: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: `bash ${hookPath}` }] },
          ],
        },
      },
      note: `Ensure MY_KIOKU_VAULT=${vault} is exported in the hook's environment.`,
    };
  }

  return ok(result);
}
