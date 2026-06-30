// Phase 5 / carry-over A: a "current/now" query demotes a superseded entry BELOW its
// replacement (ordering only — the old fact is never removed; S4). A history query
// (no current-intent keyword) is unaffected.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCurrentIntent } from "../../src/search/current-intent.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

interface RunResult { ok: boolean; data?: any; exitCode: number }
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}
function recallIds(query: string): string[] {
  const r = run(["recall", "--vault", vault, query]);
  expect(r.ok).toBe(true);
  return r.data.results.map((e: { id: string }) => e.id);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-sup5-"));
  run(["init", "--vault", vault]);
  // Old job (more keyword matches) marked superseded by the newer one.
  run(["remember", "--vault", vault, "--date", "2026-01-10", "--stdin", "--mood", "neutral/3"],
    "superseded:: 2026-05-01#0\nLàm việc ở công ty [[Zalo]], vị trí backend, dự án lớn.");
  run(["remember", "--vault", vault, "--date", "2026-05-01", "--stdin", "--mood", "happy/4"],
    "Chuyển sang [[Tiki]] làm việc.");
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("detectCurrentIntent: VI/EN current markers vs history phrases", () => {
  expect(detectCurrentIntent("công ty hiện tại")).toBe(true);
  expect(detectCurrentIntent("làm gì bây giờ")).toBe(true);
  expect(detectCurrentIntent("đang làm ở đâu")).toBe(true);
  expect(detectCurrentIntent("current job")).toBe(true);
  expect(detectCurrentIntent("công việc cũ")).toBe(false);
  expect(detectCurrentIntent("việc trước đây")).toBe(false);
  expect(detectCurrentIntent(undefined)).toBe(false);
});

test("current-intent query ranks the newer fact above the superseded one", () => {
  const ids = recallIds("công ty hiện tại làm việc");
  // Both present; the newer (non-superseded) Tiki entry ranks first.
  expect(ids).toContain("2026-05-01#0");
  expect(ids).toContain("2026-01-10#0"); // old fact NOT removed (S4)
  expect(ids.indexOf("2026-05-01#0")).toBeLessThan(ids.indexOf("2026-01-10#0"));
});

test("history query (no current keyword) leaves the old fact ranked by score", () => {
  const ids = recallIds("công việc làm ở công ty"); // no hiện tại/bây giờ
  // Old Zalo entry matches more keywords → ranks first, NOT demoted.
  expect(ids[0]).toBe("2026-01-10#0");
});

test("a sole superseded hit under current-intent is still returned (S4)", () => {
  const ids = recallIds("Zalo hiện tại");
  expect(ids).toContain("2026-01-10#0"); // never buried out of results
});
