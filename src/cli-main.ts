// my-kioku CLI logic. Statically imports the command modules (which load bun:sqlite),
// so it is loaded LAZILY by cli.ts only AFTER the Bun-runtime guard passes — keeping
// the friendly "requires Bun" message ahead of any bun:sqlite resolution. Parses argv
// with node:util parseArgs, routes to src/commands/*. No CLI framework — YAGNI.

import { parseArgs } from "node:util";
import { ok, fail } from "./lib/json-output.ts";
import { runInit } from "./commands/init.ts";
import { runReindex } from "./commands/reindex.ts";
import { runRemember } from "./commands/remember.ts";
import { runRecall } from "./commands/recall.ts";
import { runReflect } from "./commands/reflect.ts";
import { runImport } from "./commands/import-kioku-lite.ts";
import { runEntityMerge } from "./commands/entity-merge.ts";
import { runWatch } from "./commands/watch.ts";

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

export function main(): void {
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
      relation: { type: "string" },
      digest: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      since: { type: "string" },
      limit: { type: "string" },
      // reflect
      md: { type: "boolean" },
      // import / entity merge / watch
      "from-kioku-lite": { type: "string" },
      "dry-run": { type: "boolean" },
      into: { type: "string" },
      interval: { type: "string" },
      // init adapters
      skill: { type: "string" },
      hook: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const vaultFlag = str(values.vault);

  switch (command) {
    case "init":
      return runInit({
        vaultFlag,
        skillDir: str(values.skill),
        hook: values.hook === true,
      });
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
        relation: str(values.relation),
        digest: values.digest === true,
        from: str(values.from),
        to: str(values.to),
        since: str(values.since),
        limit: limitStr ? Number(limitStr) : undefined,
      });
    }
    case "reflect":
      return runReflect({
        vaultFlag,
        since: str(values.since),
        md: values.md === true,
      });
    case "import":
      return runImport({
        vaultFlag,
        source: str(values["from-kioku-lite"]),
        dryRun: values["dry-run"] === true,
      });
    case "entity": {
      // Sub-action: currently only `merge`.
      const action = positionals[0];
      if (action !== "merge") {
        return fail(
          `Unknown entity action: ${action ?? "(none)"}`,
          'Usage: entity merge "B" --into "A" [--dry-run].',
        );
      }
      return runEntityMerge({
        vaultFlag,
        from: positionals[1],
        into: str(values.into),
        dryRun: values["dry-run"] === true,
      });
    }
    case "watch": {
      const iv = str(values.interval);
      // watch is async and never returns; surface any startup rejection.
      runWatch({ vaultFlag, interval: iv ? Number(iv) : undefined }).catch((e) =>
        fail(`watch failed: ${(e as Error).message}`),
      );
      return undefined as never;
    }
    default:
      // Stubs — implemented in later phases.
      return fail(
        `Command '${command}' is not implemented yet.`,
        "Tracked in the my-kioku v1 plan (phases 4–8).",
      );
  }
}
