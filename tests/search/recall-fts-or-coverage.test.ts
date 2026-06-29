// FTS-OR ranking mode (phase-08): OR matching lifts recall for longer/enriched
// queries (AND would require ALL terms), the cover≥2 gate drops single-incidental-
// token noise, and FTS still owns the true-negative guarantee (S4).
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
function recallIds(query: string): string[] {
  const r = run(["recall", "--vault", vault, query]);
  expect(r.ok).toBe(true);
  return (r.data?.results ?? []).map((e: { id: string }) => e.id);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-fts-or-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("OR recall: a longer enriched query still recalls an entry sharing only SOME terms", () => {
  // The entry has "kiệt sức" + "deadline" but NOT "mệt mỏi burnout".
  remember("Kiệt sức vì deadline cuối tuần", "2026-06-10", "stressed/4");
  // An enriched query adds synonyms the entry lacks. Under AND this returns 0 (not
  // every term present). Under OR it recalls via the shared "kiệt sức" + "deadline".
  const ids = recallIds("kiệt sức mệt mỏi burnout deadline công việc");
  expect(ids).toContain("2026-06-10#0");
});

test("coverage gate: an entry sharing only ONE incidental token is dropped (cover≥2)", () => {
  // This entry shares only "mua" with the query below — incidental, not relevant.
  remember("Đi mua rau ngoài chợ", "2026-06-11");
  // This entry shares TWO query tokens ("họp", "sếp") — genuinely relevant.
  remember("Họp với sếp về dự án", "2026-06-12");
  const ids = recallIds("họp sếp tăng lương mua nhà"); // "mua" is the incidental overlap
  expect(ids).toContain("2026-06-12#0"); // cover=2 kept
  expect(ids).not.toContain("2026-06-11#0"); // cover=1 ("mua" only) gated out
});

test("single-token query is not gated to empty (cover≥1 fallback)", () => {
  remember("Ăn phở sáng nay", "2026-06-13", "happy/4");
  expect(recallIds("phở")).toContain("2026-06-13#0");
});

test("S4 true-negative: an absent term returns empty (FTS owns this)", () => {
  remember("Hôm nay đi làm bình thường", "2026-06-14");
  expect(recallIds("Singapore")).toHaveLength(0);
  // An absent-topic phrase whose tokens don't appear → still empty.
  expect(recallIds("du lịch Singapore nghỉ dưỡng")).toHaveLength(0);
});

test("OR does not over-match: a fully-unrelated multi-token query stays empty", () => {
  remember("Chơi cầu lông với bạn", "2026-06-15", "happy/4");
  // None of these tokens appear in the single entry → cover 0 → empty.
  expect(recallIds("crypto bitcoin đầu tư chứng khoán")).toHaveLength(0);
});
