// Agent-simulation: emotional-relation extraction pass. For entries that express
// a clear emotional cause, the agent adds a typed relation line (joy/trigger/with/
// eases) pointing at an existing-or-new entity — proving v1.1's flagship feature on
// real data. Conservative: only when the cause is explicit; otherwise skip.
//
// Run:  bun run tests/sim/agent-relation-sim.ts <vault> [maxEntries] [--apply]
//   default DRY-RUN (prints proposals, writes nothing).
//
// VERBATIM-SAFE: a relation is an ADDED line at the top of the entry (after mood),
// it never edits the body. The relation target must be a real subject in the text.

import { readFileSync, writeFileSync } from "node:fs";
import { readDaily } from "../../src/vault/daily-note.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";
import { dailyNotePath } from "../../src/vault/vault-paths.ts";
import { openDb } from "../../src/index/db.ts";
import { chat, parseJsonReply, openRouterEnv } from "./openrouter-client.ts";

const VERBS = ["joy", "trigger", "with", "eases"] as const;

const RULE = `You read a diary entry and extract EMOTIONAL RELATIONS — what caused a feeling.
Use ONLY these verbs:
- joy: a person/place/activity that brought joy/pride/gratitude
- trigger: a person/place/thing that triggered a negative feeling (stress, sadness, anxiety)
- with: a person a meaningful moment was shared with
- eases: something that relieved a bad feeling
Rules (be conservative):
- Only emit a relation when the entry CLEARLY expresses that cause. If vague, return none.
- The "target" must be a concrete subject mentioned in the text (a person/place/activity),
  named as it appears (Vietnamese as written, e.g. "Mẹ", "Chạy bộ", "Phong").
- Do NOT invent feelings the entry doesn't state. Quality over quantity.`;

interface RelationProposal { verb: string; target: string; evidence: string }
interface AgentRelations { relations: RelationProposal[] }

interface SimEntry { id: string; date: string; ordinal: number; body: string; mood: string | null }

function candidates(db: ReturnType<typeof openDb>, max: number): SimEntry[] {
  // Entries that have a mood but NO emotional relation yet (joy/trigger/with/eases).
  const rows = db
    .query<{ id: string; date: string; ordinal: number; body: string; mood: string | null }, []>(
      `SELECT e.id, e.date, e.ordinal, e.body, e.mood FROM entries e
       WHERE e.mood IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM relations r
           WHERE r.entry_id = e.id AND r.rel_type IN ('joy','trigger','with','eases'))
       ORDER BY e.date DESC`,
    )
    .all();
  return rows.slice(0, max);
}

const MAX_BODY = 1500;

async function ask(e: SimEntry): Promise<{ proposal: AgentRelations | null; tokens: number }> {
  const body = e.body.length > MAX_BODY ? e.body.slice(0, MAX_BODY) + "…" : e.body;
  const user = `Mood: ${e.mood}
Entry:
"""
${body}
"""
Return JSON: {"relations":[{"verb":"joy|trigger|with|eases","target":"<subject as written>","evidence":"<short quote>"}]}.
Return {"relations":[]} if no clear emotional cause.`;
  try {
    const res = await chat({ system: RULE, user, json: true, maxTokens: 300, timeoutMs: 20_000 });
    return { proposal: parseJsonReply<AgentRelations>(res.content), tokens: res.totalTokens };
  } catch {
    return { proposal: null, tokens: 0 };
  }
}

/** A clean entity target: a real subject mentioned in the entry, no markup/phrase. */
function validTarget(target: string, body: string): boolean {
  const t = target.trim();
  if (t === "" || t.length > 40) return false;
  if (t.includes("[[") || t.includes("]]") || t.includes("|")) return false; // no nested markup
  // Must actually appear in the entry text (the model can't invent a subject).
  return body.includes(t);
}

/** Insert relation lines after the mood line; verbatim body untouched. */
function apply(vault: string, e: SimEntry, rels: RelationProposal[]): string[] {
  const valid = rels.filter(
    (r) =>
      VERBS.includes(r.verb as (typeof VERBS)[number]) && validTarget(r.target, e.body),
  );
  if (valid.length === 0) return [];

  const path = dailyNotePath(vault, e.date);
  const raw = readFileSync(path, "utf8");
  // Locate this entry's section to insert after the mood:: line (or after heading).
  const daily = readDaily(vault, e.date);
  const entry = daily.entries.find((x) => x.ordinal === e.ordinal);
  if (!entry) return [];

  // Build relation lines grouped by verb.
  const byVerb = new Map<string, string[]>();
  for (const r of valid) {
    ensureStub(vault, r.target);
    const list = byVerb.get(r.verb) ?? [];
    list.push(`[[${r.target}]]`);
    byVerb.set(r.verb, list);
  }
  const relLines = [...byVerb.entries()].map(([v, ts]) => `${v}:: ${ts.join(", ")}`).join("\n");

  // Insert after the `mood:: ...` line of this entry's section. We find the section
  // heading by time+ordinal context; simplest robust approach: insert relation lines
  // right before the entry body text (which we locate verbatim in the file).
  if (!raw.includes(entry.text)) return [];
  writeFileSync(path, raw.replace(entry.text, `${relLines}\n${entry.text}`), "utf8");
  return valid.map((r) => `${r.verb}→[[${r.target}]]`);
}

async function main(): Promise<void> {
  const vault = process.argv[2];
  const max = Number(process.argv[3] ?? 10);
  const doApply = process.argv.includes("--apply");
  if (!vault) {
    console.error("usage: bun run tests/sim/agent-relation-sim.ts <vault> [maxEntries] [--apply]");
    process.exit(1);
  }
  console.log(`# relation-sim: model=${openRouterEnv().model}, vault=${vault}, max=${max}, mode=${doApply ? "APPLY" : "DRY-RUN"}\n`);

  const db = openDb(vault);
  const todo = candidates(db, max);
  db.close();
  console.log(`candidate entries (mood, no emotional relation yet): ${todo.length}\n`);

  // Phase 1: concurrent extraction.
  const CONCURRENCY = 6;
  const results = new Array<{ e: SimEntry; proposal: AgentRelations | null; tokens: number }>(todo.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= todo.length) return;
      results[i] = { e: todo[i]!, ...(await ask(todo[i]!)) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  // Phase 2: serial apply.
  let tokens = 0, applied = 0, withRel = 0, none = 0, fails = 0;
  for (const r of results) {
    tokens += r.tokens;
    if (!r.proposal) { fails++; console.log(`  ${r.e.id}: ⚠️ no/invalid response`); continue; }
    const rels = r.proposal.relations ?? [];
    if (rels.length === 0) { none++; console.log(`  ${r.e.id}: — none`); continue; }
    withRel++;
    if (doApply) {
      const done = apply(vault, r.e, rels);
      applied += done.length;
      console.log(`  ${r.e.id}: ${done.join(", ") || "(all rejected by guard)"}`);
    } else {
      // Preview only what the guard would ACCEPT (mark rejected ones).
      const shown = rels.map((x) => {
        const ok = VERBS.includes(x.verb as (typeof VERBS)[number]) && validTarget(x.target, r.e.body);
        return `${x.verb}→[[${x.target}]]${ok ? "" : " ⚠️REJECT"}`;
      });
      console.log(`  ${r.e.id}: ${shown.join(", ")}`);
    }
  }

  console.log(`\n# summary`);
  console.log(`entries: ${todo.length} | with-relation: ${withRel} | none: ${none} | fails: ${fails} | relations applied: ${applied}`);
  console.log(`mode: ${doApply ? "APPLIED" : "DRY-RUN (nothing written — re-run with --apply)"}`);
  console.log(`tokens: ${tokens} (~$${((tokens / 1e6) * 0.3).toFixed(4)})`);
}

main();
