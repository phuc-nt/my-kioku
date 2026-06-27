// Agent-simulation: entity-merge living-loop pass. reflect proposes alias pairs by
// STRING similarity (noisy — "Mei"≈"mẹ", "Nhật"≈"Sinh nhật" are false positives).
// The agent must JUDGE which pairs are truly the same real entity before merging.
// This harness asks a small model per pair, then applies only confident merges via
// the safe `entity merge` command (verbatim-safe link rewriter, dry-run preview).
//
// Run:  bun run tests/sim/agent-merge-sim.ts <vault> [--apply]
//   default is DRY-RUN (prints decisions + planned merges, writes nothing).
//   --apply executes the merges the model is confident about.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readEntity } from "../../src/vault/entity-note.ts";
import { chat, parseJsonReply, openRouterEnv } from "./openrouter-client.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

interface AliasPair { a: string; b: string; similarity: number }
interface MergeVerdict { same: boolean; canonical: string; reason: string }

const JUDGE_RULE = `You decide if two diary entity names refer to the SAME real person/place/thing.
Two names can look similar but be DIFFERENT entities — be conservative:
- "Mei" (a film character) is NOT "mẹ" (mother).
- "Nhật" (Japan) is NOT "Sinh nhật" (birthday).
- "Cám" (a folktale character) is NOT "Tấm Cám" (the tale's title).
- "Phong" (one child) is NOT "Phong Vy" (two children together).
- "con trai" (son) vs "con trai út" (youngest son) — usually DIFFERENT (which son?).
Only say same=true when you are confident they are the same entity (e.g. spelling
variants "Techbase Vietnam"/"Techbase Việt Nam", "Yahoo Japan"/"Yahoo! Japan").
canonical = the name to keep (the cleaner/fuller proper form).`;

function reflectAliasPairs(vault: string): AliasPair[] {
  const r = spawnSync("bun", ["run", CLI, "reflect", "--vault", vault, "--since", "1900-01-01"], {
    encoding: "utf8",
  });
  const data = JSON.parse(r.stdout.trim()).data;
  return data.alias_candidates as AliasPair[];
}

async function judge(p: AliasPair): Promise<{ verdict: MergeVerdict | null; tokens: number }> {
  // Give the model a little context: each entity's type + how many entries mention it.
  const user = `Are these the same real entity?
A: "${p.a}"
B: "${p.b}"
(string similarity ${p.similarity})
Return JSON: {"same": true|false, "canonical": "<name to keep>", "reason": "<short>"}`;
  try {
    const res = await chat({ system: JUDGE_RULE, user, json: true, maxTokens: 200, timeoutMs: 20_000 });
    return { verdict: parseJsonReply<MergeVerdict>(res.content), tokens: res.totalTokens };
  } catch {
    return { verdict: null, tokens: 0 };
  }
}

function entityExists(vault: string, name: string): boolean {
  return readEntity(vault, name).exists;
}

async function main(): Promise<void> {
  const vault = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!vault) {
    console.error("usage: bun run tests/sim/agent-merge-sim.ts <vault> [--apply]");
    process.exit(1);
  }
  console.log(`# merge-sim: model=${openRouterEnv().model}, vault=${vault}, mode=${apply ? "APPLY" : "DRY-RUN"}\n`);

  const pairs = reflectAliasPairs(vault);
  console.log(`alias candidates from reflect: ${pairs.length}\n`);

  let tokens = 0, merges = 0, kept = 0, rejected = 0, skipped = 0;
  const merged = new Set<string>(); // names already merged away this run

  for (const p of pairs) {
    // Skip if a side was already merged away in a prior pair this run.
    if (merged.has(p.a) || merged.has(p.b)) { skipped++; continue; }
    const { verdict, tokens: t } = await judge(p);
    tokens += t;
    if (!verdict) { console.log(`  ${p.a} ≈ ${p.b}: ⚠️ no verdict (skipped)`); skipped++; continue; }
    if (!verdict.same) {
      console.log(`  ${p.a} ≈ ${p.b}: ✗ different (${verdict.reason})`);
      rejected++;
      continue;
    }
    // same → merge the non-canonical INTO the canonical.
    const canonical = verdict.canonical === p.b ? p.b : p.a;
    const from = canonical === p.a ? p.b : p.a;
    if (!entityExists(vault, from) || !entityExists(vault, canonical)) {
      console.log(`  ${p.a} ≈ ${p.b}: ⚠️ an entity note is missing (skipped)`);
      skipped++;
      continue;
    }
    console.log(`  ${p.a} ≈ ${p.b}: ✓ SAME → merge [[${from}]] into [[${canonical}]] (${verdict.reason})`);
    merges++;
    if (apply) {
      const res = spawnSync(
        "bun",
        ["run", CLI, "entity", "merge", from, "--into", canonical, "--vault", vault],
        { encoding: "utf8" },
      );
      const ok = (() => { try { return JSON.parse(res.stdout.trim()).ok; } catch { return false; } })();
      if (ok) merged.add(from);
      else console.log(`     ⚠️ merge command failed: ${res.stdout.trim().slice(0, 120)}`);
    }
  }

  console.log(`\n# summary`);
  console.log(`pairs: ${pairs.length} | same→merge: ${merges} | different (kept apart): ${rejected} | skipped: ${skipped}`);
  console.log(`mode: ${apply ? "APPLIED" : "DRY-RUN (nothing written — re-run with --apply)"}`);
  console.log(`tokens: ${tokens} (~$${((tokens / 1e6) * 0.3).toFixed(4)})`);
}

main();
