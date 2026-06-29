// Superseded-fact / latest-fact (phase-05): the `superseded::` leading field, its
// indexing + reindex cleanup (H5), recall demotion-as-tiebreak (M2, never buries the
// old fact past the limit), and reflect's candidate detection.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

interface RunResult {
  ok: boolean;
  // deno-lint-ignore no-explicit-any
  data?: any;
  exitCode: number;
}
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}
function remember(text: string, date: string, mood = "neutral/3") {
  return run(["remember", "--vault", vault, "--stdin", "--date", date, "--mood", mood], text);
}
function recall(query: string) {
  const r = run(["recall", "--vault", vault, query]);
  expect(r.ok).toBe(true);
  return r.data.results as { id: string; body: string; superseded: string | null; score: number }[];
}
function dailyFile(date: string): string {
  const [y, m] = date.split("-");
  return join(vault, "journal", y!, m!, `${date}.md`);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-sup-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("a strict superseded:: field is stripped from the verbatim body (S1) and indexed", () => {
  remember("superseded:: 2026-03-01#0\nLàm ở [[Zalo]].", "2026-01-15", "reflective/3");
  const r = recall("Zalo làm");
  const e = r.find((x) => x.id === "2026-01-15#0")!;
  expect(e.body).toBe("Làm ở [[Zalo]]."); // field NOT in body
  expect(e.superseded).toBe("2026-03-01#0"); // flag exposed
});

test("a non-strict superseded:: line stays VERBATIM in the body (S1 negative)", () => {
  remember("superseded:: theo tôi thì xong rồi\nGhi chú.", "2026-01-16");
  const e = recall("ghi chú").find((x) => x.id === "2026-01-16#0")!;
  expect(e.body).toContain("superseded:: theo tôi thì xong rồi"); // not eaten
  expect(e.superseded).toBeNull();
});

test("recall demotes a superseded entry as a TIEBREAK but still returns it (M2)", () => {
  // Two entries with the SAME query relevance (identical body words) — one superseded.
  remember("superseded:: 2026-02-01#0\nlàm việc công ty dự án chung", "2026-01-10");
  remember("làm việc công ty dự án chung", "2026-02-01", "happy/4");
  const ids = recall("làm việc công ty dự án chung").map((r) => r.id);
  // Both present; the non-superseded (newer) ranks first on the tiebreak.
  expect(ids).toContain("2026-01-10#0"); // old fact NOT buried
  expect(ids).toContain("2026-02-01#0");
  expect(ids.indexOf("2026-02-01#0")).toBeLessThan(ids.indexOf("2026-01-10#0"));
});

test("H5: a normal reindex clears a superseded flag once the field is removed", () => {
  remember("superseded:: 2026-03-01#0\nLàm ở [[Zalo]].", "2026-01-15");
  expect(recall("Zalo").find((x) => x.id === "2026-01-15#0")!.superseded).toBe("2026-03-01#0");
  // Remove the field from the markdown, then a NORMAL reindex (no version bump).
  const f = dailyFile("2026-01-15");
  writeFileSync(f, readFileSync(f, "utf8").replace("superseded:: 2026-03-01#0\n", ""), "utf8");
  run(["reindex", "--vault", vault]);
  expect(recall("Zalo").find((x) => x.id === "2026-01-15#0")!.superseded).toBeNull();
});

test("reflect surfaces a superseded candidate for distinct same-type entities + shared anchor", () => {
  remember("Làm ở [[Zalo]] với [[Phúc]].", "2026-05-10");
  remember("Chuyển sang [[Tiki]], vẫn làm với [[Phúc]].", "2026-06-15", "happy/4");
  // Classify both employers (what the agent does after the reflect classify action).
  writeFileSync(join(vault, "entities", "Zalo.md"), "---\ntype: employer\n---\n# Zalo\n", "utf8");
  writeFileSync(join(vault, "entities", "Tiki.md"), "---\ntype: employer\n---\n# Tiki\n", "utf8");
  run(["reindex", "--vault", vault]);
  const r = run(["reflect", "--vault", vault, "--since", "90d"]);
  expect(r.ok).toBe(true);
  const cands = r.data.superseded_candidates;
  expect(cands).toHaveLength(1);
  expect(cands[0].old_entity).toBe("Zalo");
  expect(cands[0].new_entity).toBe("Tiki");
  expect(cands[0].type).toBe("employer");
  expect(cands[0].shared_context).toBe("Phúc"); // display-cased, not folded "phuc"
  expect(r.data.suggested_actions.some((a: string) => a.includes("superseded by 2026-06-15#0"))).toBe(true);
});

test("reflect does NOT suggest when the two entities co-occur in one entry (not a replacement)", () => {
  // Both employers mentioned together → not a clean replacement.
  remember("So sánh [[Zalo]] và [[Tiki]] với [[Phúc]].", "2026-05-10");
  remember("Vẫn ở [[Tiki]] với [[Phúc]].", "2026-06-15");
  writeFileSync(join(vault, "entities", "Zalo.md"), "---\ntype: employer\n---\n# Zalo\n", "utf8");
  writeFileSync(join(vault, "entities", "Tiki.md"), "---\ntype: employer\n---\n# Tiki\n", "utf8");
  run(["reindex", "--vault", vault]);
  const r = run(["reflect", "--vault", vault, "--since", "90d"]);
  expect(r.data.superseded_candidates).toHaveLength(0);
});

test("reflect does NOT suggest for un-classified (unknown-type) entities", () => {
  // Without classifying Zalo/Tiki as employer, no supersedable type → no candidate.
  remember("Làm ở [[Zalo]] với [[Phúc]].", "2026-05-10");
  remember("Chuyển sang [[Tiki]], vẫn làm với [[Phúc]].", "2026-06-15");
  const r = run(["reflect", "--vault", vault, "--since", "90d"]);
  expect(r.data.superseded_candidates).toHaveLength(0);
});
