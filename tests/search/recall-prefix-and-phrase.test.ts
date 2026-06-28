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
function remember(text: string, args: string[]) {
  return run(["remember", "--vault", vault, "--stdin", ...args], text);
}
function recallIds(query: string): string[] {
  const r = run(["recall", "--vault", vault, query]);
  expect(r.ok).toBe(true);
  return (r.data?.results ?? []).map((e: { id: string }) => e.id);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-recall-pp-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("prefix search: a partial last word matches (search-as-you-type)", () => {
  remember("Nộp báo cáo trước deadline", ["--date", "2026-06-12", "--mood", "stressed/3"]);
  expect(recallIds("deadl")).toHaveLength(1); // "deadl" → deadline
  expect(recallIds("deadline")).toHaveLength(1);
});

test("phrase boost: a contiguous-phrase match ranks above scattered words", () => {
  // Entry A: the words appear scattered, not as a phrase.
  remember("Phở sáng ngon, ghé Quảng trường rồi về An toàn", [
    "--date", "2026-06-10", "--mood", "happy/4",
  ]);
  // Entry B: the exact phrase appears contiguously.
  remember("Ăn phở Quảng An với bạn", ["--date", "2026-06-11", "--mood", "happy/4"]);

  const ids = recallIds("phở Quảng An");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe("2026-06-11#0"); // contiguous-phrase entry ranks first
});

test("prefix needs a ≥4-char last token; short complete words stay exact", () => {
  remember("Gọi cho gia đình, đi chạy bộ", ["--date", "2026-06-12", "--mood", "calm/3"]);
  // A ≥4-char partial prefixes: "chuy" would match nothing here, but "chay" exact does.
  // The key guarantee: a complete short word like "phở"→"pho" does NOT prefix-flood.
  remember("Ăn phở sáng", ["--date", "2026-06-13", "--mood", "happy/4"]);
  remember("Dọn phòng cho gọn", ["--date", "2026-06-14", "--mood", "calm/3"]);
  // "phở" (folds to 3 chars) → exact, must NOT pull in "phòng" (folds to "phong").
  const ids = recallIds("phở");
  expect(ids).toContain("2026-06-13#0"); // the phở entry
  expect(ids).not.toContain("2026-06-14#0"); // phòng entry excluded
});

test("NFD-pasted relation + mood survive ingest (canonicalized)", () => {
  // Simulate a decomposed paste: verb "nhớ" + mood "khỏe" in NFD form.
  const text = "nhớ:: [[Mẹ]]\nNhớ mẹ hôm nay".normalize("NFD");
  remember(text, ["--date", "2026-06-13", "--mood", "khỏe/4".normalize("NFD")]);
  // The relation must be recorded (recall --relation finds it via the entity).
  const r = run(["recall", "--vault", vault, "--relation", "nhớ"]);
  expect(r.ok).toBe(true);
  expect((r.data?.results ?? []).length).toBeGreaterThanOrEqual(1);
});
