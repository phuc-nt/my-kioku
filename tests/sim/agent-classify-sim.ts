// Agent-simulation: entity type classification pass. Each entity note starts as
// type: unknown; the agent reads the entity name + sample entries that mention it
// and assigns person/place/event/activity/thing. Lowest-risk living-loop action —
// it only edits the entity note's frontmatter `type:`, never journal bodies.
//
// Run:  bun run tests/sim/agent-classify-sim.ts <vault> [maxEntities] [--apply]
//   default DRY-RUN.

import { readEntity, updateMeta, type EntityType } from "../../src/vault/entity-note.ts";
import { openDb } from "../../src/index/db.ts";
import { chat, parseJsonReply, openRouterEnv } from "./openrouter-client.ts";

const TYPES: EntityType[] = ["person", "place", "event", "activity", "thing"];

const RULE = `You classify a diary entity into exactly one type:
- person: a human (Mẹ, Phong, a colleague, an author)
- place: a location/org (Sài Gòn, Techbase Việt Nam, Nhật)
- event: a one-time happening (a birthday, a conference edition, a funeral rite)
- activity: a recurring practice (Chạy bộ/running, đọc sách/reading, làm thơ/writing poetry)
- thing: a concept/object/work (a book, a film character, a philosophy term)
Use the entity NAME and the example entries. Return your single best type.`;

interface Verdict { type: string; reason: string }

interface Cand { name: string; sampleEntries: string[] }

function candidates(db: ReturnType<typeof openDb>, max: number): Cand[] {
  const names = db
    .query<{ name: string }, []>("SELECT name FROM entities WHERE type = 'unknown' ORDER BY name")
    .all()
    .map((r) => r.name)
    .slice(0, max);
  return names.map((name) => {
    const rows = db
      .query<{ body: string }, [string]>(
        `SELECT e.body FROM entries e JOIN links l ON l.entry_id = e.id
         WHERE l.target = ? LIMIT 2`,
      )
      .all(name);
    return { name, sampleEntries: rows.map((r) => r.body.slice(0, 200)) };
  });
}

async function classify(c: Cand): Promise<{ verdict: Verdict | null; tokens: number }> {
  const user = `Entity: "${c.name}"
Example entries that mention it:
${c.sampleEntries.map((s, i) => `(${i + 1}) ${s}`).join("\n") || "(no linked entries — judge by the name)"}
Return JSON: {"type":"person|place|event|activity|thing","reason":"<short>"}`;
  try {
    const res = await chat({ system: RULE, user, json: true, maxTokens: 120, timeoutMs: 20_000 });
    return { verdict: parseJsonReply<Verdict>(res.content), tokens: res.totalTokens };
  } catch {
    return { verdict: null, tokens: 0 };
  }
}

async function main(): Promise<void> {
  const vault = process.argv[2];
  const max = Number(process.argv[3] ?? 20);
  const doApply = process.argv.includes("--apply");
  if (!vault) {
    console.error("usage: bun run tests/sim/agent-classify-sim.ts <vault> [maxEntities] [--apply]");
    process.exit(1);
  }
  console.log(`# classify-sim: model=${openRouterEnv().model}, vault=${vault}, max=${max}, mode=${doApply ? "APPLY" : "DRY-RUN"}\n`);

  const db = openDb(vault);
  const todo = candidates(db, max);
  db.close();
  console.log(`unknown-type entities: ${todo.length}\n`);

  // Phase 1: concurrent classification.
  const CONCURRENCY = 6;
  const results = new Array<{ c: Cand; verdict: Verdict | null; tokens: number }>(todo.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= todo.length) return;
      results[i] = { c: todo[i]!, ...(await classify(todo[i]!)) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  // Phase 2: serial apply (frontmatter only).
  let tokens = 0, applied = 0, fails = 0;
  const dist: Record<string, number> = {};
  for (const r of results) {
    tokens += r.tokens;
    const t = r.verdict?.type;
    if (!t || !TYPES.includes(t as EntityType)) {
      fails++;
      console.log(`  ${r.c.name}: ⚠️ no/invalid type (left unknown)`);
      continue;
    }
    dist[t] = (dist[t] ?? 0) + 1;
    console.log(`  ${r.c.name}: ${t} (${r.verdict!.reason})`);
    if (doApply && readEntity(vault, r.c.name).exists) {
      updateMeta(vault, r.c.name, { type: t });
      applied++;
    }
  }

  console.log(`\n# summary`);
  console.log(`entities: ${todo.length} | classified: ${Object.values(dist).reduce((a, b) => a + b, 0)} | left unknown: ${fails} | applied: ${applied}`);
  console.log(`distribution: ${JSON.stringify(dist)}`);
  console.log(`mode: ${doApply ? "APPLIED" : "DRY-RUN (nothing written — re-run with --apply)"}`);
  console.log(`tokens: ${tokens} (~$${((tokens / 1e6) * 0.3).toFixed(4)})`);
}

main();
