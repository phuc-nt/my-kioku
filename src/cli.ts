#!/usr/bin/env bun
// my-kioku CLI entry point. Parses argv with node:util parseArgs (Bun-supported),
// routes to src/commands/*. No CLI framework — YAGNI.

import { parseArgs } from "node:util";
import { ok, fail } from "./lib/json-output.ts";
import { runInit } from "./commands/init.ts";
import { runReindex } from "./commands/reindex.ts";

const COMMANDS = [
  "init",
  "remember",
  "recall",
  "reflect",
  "reindex",
  "import",
  "entity",
  "watch",
] as const;

const HELP = {
  usage: "my-kioku <command> [options]",
  commands: {
    init: "Create a vault structure (journal/, entities/, insights/, .kioku/)",
    remember: "Append a diary entry; auto-stub linked entities",
    recall: "Search entries (FTS5 + entity expansion); --digest for hooks",
    reflect: "Scan vault for lint/stats/insight candidates (deterministic)",
    reindex: "Rebuild the disposable SQLite index from the vault",
    import: "Import legacy memories (--from-kioku-lite <markdown-folder>)",
    entity: "Entity ops, e.g. `entity merge \"A\" --into \"B\"`",
    watch: "Poll the vault and keep the index in sync (foreground)",
  },
  global_flags: {
    "--vault <path>": "Vault path (overrides MY_KIOKU_VAULT / config)",
    "--help": "Show this help",
  },
};

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    return ok(HELP);
  }

  if (!(COMMANDS as readonly string[]).includes(command)) {
    return fail(
      `Unknown command: ${command}`,
      `Run \`my-kioku --help\`. Valid commands: ${COMMANDS.join(", ")}`,
    );
  }

  // Parse the remaining args. Commands read what they need; parseArgs with
  // strict:false tolerates command-specific flags declared per-command later.
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      vault: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const vaultFlag = typeof values.vault === "string" ? values.vault : undefined;

  switch (command) {
    case "init":
      return runInit(vaultFlag);
    case "reindex":
      return runReindex(vaultFlag);
    default:
      // Stubs — implemented in later phases.
      return fail(
        `Command '${command}' is not implemented yet.`,
        "Tracked in the my-kioku v1 plan (phases 4–8).",
      );
  }
}

main();
