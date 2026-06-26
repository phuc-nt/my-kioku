#!/usr/bin/env bun
// my-kioku CLI entry point. Parses argv with node:util parseArgs (Bun-supported),
// routes to src/commands/*. No CLI framework — YAGNI.

import { parseArgs } from "node:util";
import { ok, fail } from "./lib/json-output.ts";
import { runInit } from "./commands/init.ts";
import { runReindex } from "./commands/reindex.ts";
import { runRemember } from "./commands/remember.ts";
import { runRecall } from "./commands/recall.ts";

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

  // Parse the remaining args. Flags are declared centrally; strict:false keeps
  // unknown flags from crashing while we grow the surface.
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      vault: { type: "string" },
      // remember
      stdin: { type: "boolean" },
      mood: { type: "string" },
      time: { type: "string" },
      date: { type: "string" },
      checkin: { type: "string" },
      // recall
      entity: { type: "string" },
      digest: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      since: { type: "string" },
      limit: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const vaultFlag = str(values.vault);

  switch (command) {
    case "init":
      return runInit(vaultFlag);
    case "reindex":
      return runReindex(vaultFlag);
    case "remember":
      return runRemember({
        vaultFlag,
        text: positionals[0],
        stdin: values.stdin === true,
        mood: str(values.mood),
        time: str(values.time),
        date: str(values.date),
        checkin: str(values.checkin),
      });
    case "recall": {
      const limitStr = str(values.limit);
      return runRecall({
        vaultFlag,
        query: positionals[0],
        entity: str(values.entity),
        digest: values.digest === true,
        from: str(values.from),
        to: str(values.to),
        since: str(values.since),
        limit: limitStr ? Number(limitStr) : undefined,
      });
    }
    default:
      // Stubs — implemented in later phases.
      return fail(
        `Command '${command}' is not implemented yet.`,
        "Tracked in the my-kioku v1 plan (phases 4–8).",
      );
  }
}

main();
