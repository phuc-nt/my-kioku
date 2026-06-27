// Agent-simulation harness: drive a small model (Qwen via OpenRouter) through the
// SKILL.md "convert tags → wikilinks" living-loop action, to TEST whether a small
// model follows the protocol correctly. Operates on a target vault (pass a TEMP
// copy first). Caps the batch — this is a measurement tool, not a bulk migrator.
//
// Run:  bun run tests/sim/agent-backfill-sim.ts <vault> [maxEntries]
//   (requires .env with OPENROUTER_API_KEY — see .env.example)
//
// What it does per entry (with tags, no links yet):
//   1. show the model the entry body + its tags + the SKILL rule
//   2. model returns JSON: which tags are real people/places/events (→ entity name)
//   3. harness creates the entity stub + injects [[Name]] into the body where the
//      tag's subject is mentioned (the model proposes the exact replacement)
//   4. reindex; report what changed + token cost + any protocol violations

import { readFileSync, writeFileSync } from "node:fs";
import { readDaily, appendEntry } from "../../src/vault/daily-note.ts";
import { ensureStub } from "../../src/vault/entity-note.ts";
import { dailyNotePath } from "../../src/vault/vault-paths.ts";
import { openDb, closeDb } from "../../src/index/db.ts";
import { fullReindex } from "../../src/index/indexer.ts";
import { chat, parseJsonReply, openRouterEnv } from "./openrouter-client.ts";

const SKILL_RULE = `You are a diary memory agent. A diary entry has plain "tags" and you convert tags
that name a real PERSON, PLACE, or EVENT into a [[wikilink]] inside the entry text,
so the memory graph grows. Rules:
- ONLY convert a tag that clearly names a person/place/event the text refers to.
- Skip abstract/topic tags (e.g. "reading", "career", "love", "memory", "independence").
- Use the name AS IT APPEARS in the text (Vietnamese as written, e.g. "Mẹ", "Phong").
- NEVER change the meaning or wording of the entry beyond wrapping an existing mention in [[ ]].
- If a person is referred to but not by the exact tag word, still link the mention.`;

interface AgentDecision {
  links: { tag: string; entity_name: string; mention_in_text: string }[];
  skipped_tags: string[];
}

interface SimEntry {
  id: string;
  date: string;
  body: string;
  tags: string[];
}

/** Collect entries that have tags but no wikilinks yet (backfill candidates). */
function candidates(vault: string, db: ReturnType<typeof openDb>, max: number): SimEntry[] {
  const rows = db
    .query<{ id: string; date: string; body: string }, []>(
      `SELECT e.id, e.date, e.body FROM entries e
       JOIN tags t ON t.entry_id = e.id
       LEFT JOIN links l ON l.entry_id = e.id
       WHERE l.entry_id IS NULL
       GROUP BY e.id ORDER BY e.date DESC`,
    )
    .all();
  const out: SimEntry[] = [];
  for (const r of rows) {
    const tags = db
      .query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE entry_id = ?")
      .all(r.id)
      .map((x) => x.tag);
    out.push({ ...r, tags });
    if (out.length >= max) break;
  }
  return out;
}

// Long bodies (the 193 KB import file has multi-KB entries) make the model slow
// and rarely change the linking decision — cap what we send.
const MAX_BODY_CHARS = 2000;

async function askAgent(
  e: SimEntry,
): Promise<{ decision: AgentDecision | null; tokens: number; error?: string }> {
  const body = e.body.length > MAX_BODY_CHARS ? e.body.slice(0, MAX_BODY_CHARS) + "…" : e.body;
  const user = `Entry tags: ${JSON.stringify(e.tags)}
Entry text:
"""
${body}
"""
Return JSON: {"links":[{"tag":"...","entity_name":"...","mention_in_text":"<exact substring of the text to wrap in [[ ]]>"}],"skipped_tags":["..."]}.
Only include a link if mention_in_text is an EXACT substring of the entry text above.`;
  try {
    const res = await chat({ system: SKILL_RULE, user, json: true, maxTokens: 600, timeoutMs: 30_000 });
    return { decision: parseJsonReply<AgentDecision>(res.content), tokens: res.totalTokens };
  } catch (err) {
    return { decision: null, tokens: 0, error: (err as Error).message };
  }
}

/** Apply the agent's links: create entity stubs + wrap the mention in the body. */
function applyLinks(
  vault: string,
  e: SimEntry,
  decision: AgentDecision,
): { applied: string[]; violations: string[] } {
  const applied: string[] = [];
  const violations: string[] = [];
  const daily = readDaily(vault, e.date);
  const entry = daily.entries.find((x) => `${e.date}#${x.ordinal}` === e.id);
  if (!entry) return { applied, violations: ["entry not found on re-read"] };

  let body = entry.text;
  for (const link of decision.links) {
    const mention = link.mention_in_text;
    // VERBATIM guard: the mention must be an exact substring, and we only WRAP it.
    if (!body.includes(mention)) {
      violations.push(`mention not in text: "${mention}"`);
      continue;
    }
    if (mention.includes("[[")) {
      violations.push(`mention already linked: "${mention}"`);
      continue;
    }
    // The DISPLAYED text must stay byte-identical to the original mention. When the
    // canonical entity name differs from the written word (e.g. entity "Bố" but the
    // text says "bố", or an English tag vs a Vietnamese word), use the Obsidian
    // alias form [[Entity|mention]] so the user's words are never rewritten.
    const wrap = link.entity_name === mention
      ? `[[${mention}]]`
      : `[[${link.entity_name}|${mention}]]`;
    ensureStub(vault, link.entity_name);
    body = body.replace(mention, wrap);
    applied.push(`${link.tag}→${wrap}`);
  }

  if (applied.length > 0) {
    // BELT-AND-SUSPENDERS verbatim assertion: stripping the wikilink syntax from
    // the new body MUST yield the original text exactly. If not, the model
    // rewrote words — reject the whole edit for this entry (write nothing).
    if (stripWikilinks(body) !== entry.text) {
      violations.push("verbatim check failed (text changed beyond [[ ]]); edit rejected");
      return { applied: [], violations };
    }
    const path = dailyNotePath(vault, e.date);
    const raw = readFileSync(path, "utf8");
    if (raw.includes(entry.text)) {
      writeFileSync(path, raw.replace(entry.text, body), "utf8");
    } else {
      violations.push("could not locate original body to rewrite (skipped write)");
      return { applied: [], violations };
    }
  }
  return { applied, violations };
}

/** Remove wikilink syntax to recover the displayed text: [[A|b]]→b, [[A]]→A. */
function stripWikilinks(s: string): string {
  return s.replace(/\[\[([^\[\]]+?)\]\]/g, (_m, inner: string) => {
    const pipe = inner.indexOf("|");
    return pipe >= 0 ? inner.slice(pipe + 1) : inner;
  });
}

async function main(): Promise<void> {
  const vault = process.argv[2];
  const maxEntries = Number(process.argv[3] ?? 5);
  if (!vault) {
    console.error("usage: bun run tests/sim/agent-backfill-sim.ts <vault> [maxEntries]");
    process.exit(1);
  }
  console.log(`# agent-sim: model=${openRouterEnv().model}, vault=${vault}, max=${maxEntries}\n`);

  const db = openDb(vault);
  const before = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM links").get()?.n ?? 0;
  const todo = candidates(vault, db, maxEntries);
  db.close();
  console.log(`links before: ${before} | candidate entries (tagged, unlinked): ${todo.length}\n`);

  let totalTokens = 0, totalApplied = 0, totalViolations = 0, parseFails = 0;
  for (const e of todo) {
    const { decision, tokens, error } = await askAgent(e);
    totalTokens += tokens;
    if (!decision) {
      parseFails++;
      console.log(`  ${e.id}: ⚠️ ${error ? "call failed: " + error : "unparseable JSON"} (skipped)`);
      continue;
    }
    const { applied, violations } = applyLinks(vault, e, decision);
    totalApplied += applied.length;
    totalViolations += violations.length;
    console.log(
      `  ${e.id}: tags=${e.tags.length} applied=[${applied.join(", ")}] skipped=${decision.skipped_tags.length}` +
        (violations.length ? ` ⚠️ ${violations.join("; ")}` : ""),
    );
  }

  // Reindex so links count reflects the edits.
  const db2 = openDb(vault);
  fullReindex(db2, vault);
  const after = db2.query<{ n: number }, []>("SELECT COUNT(*) n FROM links").get()?.n ?? 0;
  db2.close();

  console.log(`\n# summary`);
  console.log(`entries processed: ${todo.length}`);
  console.log(`links: ${before} → ${after} (+${after - before})`);
  console.log(`applied: ${totalApplied} | protocol violations (rejected): ${totalViolations} | parse fails: ${parseFails}`);
  console.log(`tokens: ${totalTokens} (~$${((totalTokens / 1e6) * 0.3).toFixed(4)} at ~$0.30/M)`);
}

main();
