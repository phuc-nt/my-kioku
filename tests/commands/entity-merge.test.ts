import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entityPath } from "../../src/vault/vault-paths.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

interface RunResult { ok: boolean; data?: any; error?: string; exitCode: number; }
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

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-merge-"));
  run(["init", "--vault", vault]);
  // Two stubs that should be one entity: "Hùng" and "bạn Hùng".
  remember("Ăn tối với [[Hùng]]", ["--date", "2026-06-10", "--mood", "happy/4"]);
  remember("Đi chơi với [[bạn Hùng|anh ấy]]", ["--date", "2026-06-11", "--mood", "calm/3"]);
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

test("merge rewrites all links B→A and deletes B", () => {
  const r = run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(r.data.links_rewritten).toBeGreaterThanOrEqual(1);

  // No [[bạn Hùng]] remains anywhere in the journal.
  const note = readFileSync(
    join(vault, "journal", "2026", "06", "2026-06-11.md"),
    "utf8",
  );
  expect(note).toContain("[[Hùng|anh ấy]]"); // display preserved, target merged
  expect(note).not.toContain("[[bạn Hùng");

  // B's entity file is gone.
  expect(existsSync(entityPath(vault, "bạn Hùng"))).toBe(false);
});

test("merge adds B (and its name) to A's aliases", () => {
  run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);
  const aFile = readFileSync(entityPath(vault, "Hùng"), "utf8");
  expect(aFile).toContain("bạn Hùng"); // alias recorded
});

test("recall --entity A returns entries that used to link B", () => {
  run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);
  const r = run(["recall", "--vault", vault, "--entity", "Hùng"]);
  expect(r.ok).toBe(true);
  // Both the original Hùng entry and the merged bạn-Hùng entry.
  expect(r.data.count).toBe(2);
});

test("--dry-run reports changes without writing", () => {
  const r = run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--dry-run", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(r.data.dry_run).toBe(true);
  // B still exists after dry-run.
  expect(existsSync(entityPath(vault, "bạn Hùng"))).toBe(true);
});

test("merging non-existent entity fails", () => {
  const r = run(["entity", "merge", "Nobody", "--into", "Hùng", "--vault", vault]);
  expect(r.ok).toBe(false);
  expect(r.exitCode).toBe(1);
});

test("merging into itself fails", () => {
  const r = run(["entity", "merge", "Hùng", "--into", "Hùng", "--vault", vault]);
  expect(r.ok).toBe(false);
});

test("B's body self-reference [[B]] is rewritten to [[A]], no dangling link (C3)", () => {
  // Put a [[bạn Hùng]] self-reference inside B's own Facts.
  const bPath = entityPath(vault, "bạn Hùng");
  const raw = readFileSync(bPath, "utf8");
  Bun.write(bPath, raw.replace("## Facts\n", "## Facts\n- Đồng đội của [[bạn Hùng]]\n"));
  run(["reindex", "--vault", vault]);

  run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);

  // The merged Facts in A must NOT contain a dangling [[bạn Hùng]].
  const aFile = readFileSync(entityPath(vault, "Hùng"), "utf8");
  expect(aFile).not.toContain("[[bạn Hùng]]");
  expect(aFile).toContain("[[Hùng]]"); // rewritten self-ref
});

test("multi-section B body: a mid-body ## Facts heading is preserved (H1)", () => {
  // B has ## Bio then ## Facts — stripHeading must not strip the mid-body Facts.
  const bPath = entityPath(vault, "bạn Hùng");
  const raw = readFileSync(bPath, "utf8");
  const body = "# bạn Hùng\n\n## Bio\nNgười bạn cũ.\n\n## Facts\n- Thích cà phê\n";
  Bun.write(bPath, raw.replace(/# bạn Hùng[\s\S]*$/, body));
  run(["reindex", "--vault", vault]);

  run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);
  const aFile = readFileSync(entityPath(vault, "Hùng"), "utf8");
  // The Bio section content survives; the mid-body Facts bullets are not orphaned.
  expect(aFile).toContain("Người bạn cũ.");
  expect(aFile).toContain("Thích cà phê");
});
