// `my-kioku watch [--interval 30]` — foreground polling loop that keeps the
// index in sync with manual vault edits. Not daemonized (user/launchd manages
// the process); emits JSON-lines when something changes.

import { fail } from "../lib/json-output.ts";
import { resolveVault, NO_VAULT_HINT } from "../config.ts";
import { openDb, closeDb } from "../index/db.ts";
import { syncIfStale } from "../index/lazy-sync.ts";

export interface WatchArgs {
  vaultFlag?: string;
  interval?: number; // seconds
}

export async function runWatch(args: WatchArgs): Promise<never> {
  const resolved = resolveVault({ vaultFlag: args.vaultFlag });
  if (!resolved.path || !resolved.exists) {
    return fail("No vault configured.", NO_VAULT_HINT);
  }
  const vault = resolved.path;
  const intervalMs = Math.max(1, args.interval ?? 30) * 1000;

  const line = (obj: unknown): void => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  line({ event: "watch_start", vault, interval_s: intervalMs / 1000 });

  // Single long-lived connection; checkpoint on exit signals.
  const db = openDb(vault);
  const shutdown = (): never => {
    closeDb(db);
    line({ event: "watch_stop" });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Loop forever; this function never returns normally.
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      const stats = syncIfStale(db, vault);
      if (stats.changed || stats.removed || stats.skipped.length) {
        line({ event: "sync", ...stats });
      }
    } catch (e) {
      line({ event: "error", message: (e as Error).message });
    }
    await Bun.sleep(intervalMs);
  }
}
