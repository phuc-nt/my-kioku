// End-to-end v1.1 flow on a temp vault: import (with tags) → remember (with
// relations) → recall --relation → reflect (missing_relation + tags_to_convert +
// relation_summary). Proves the seams between every layer via the real CLI.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;
let source: string;

interface RunResult { ok: boolean; data?: any; error?: string; exitCode: number; }
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  if (!out) throw new Error(`no output (exit ${proc.exitCode}): ${proc.stderr.toString()}`);
  return { ...JSON.parse(out), exitCode: proc.exitCode ?? 0 };
}

const KIOKU_FIXTURE = `# Kioku — 2026-02-26

---
time: "2026-02-26T23:14:38+07:00"
mood: "concerned"
tags: ['parenting', 'children', 'phong']
---
Con 4 tuổi, dạy chữ mà hay nóng tính.
`;

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-e2e11-vault-"));
  source = mkdtempSync(join(tmpdir(), "kioku-e2e11-src-"));
  writeFileSync(join(source, "2026-02-26.md"), KIOKU_FIXTURE);
});
afterAll(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test("E2E 1: init", () => {
  expect(run(["init", "--vault", vault]).ok).toBe(true);
});

test("E2E 2: import legacy with tags → tags:: lines", () => {
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);
  expect(r.data.entries_created).toBe(1);
});

test("E2E 3: remember with relations + tags (verbatim body)", () => {
  const r = run(
    ["remember", "--vault", vault, "--stdin", "--date", "2026-06-12", "--mood", "happy/4"],
    "joy:: [[Mẹ]]\ntags:: family\nGọi cho mẹ, thấy vui.",
  );
  expect(r.ok).toBe(true);
  expect(r.data.relations.joy).toEqual(["Mẹ"]);
  expect(r.data.tags).toEqual(["family"]);
});

test("E2E 4: a strong-mood entry with NO relation (seed for reflect)", () => {
  expect(
    run(["remember", "--vault", vault, "--stdin", "--date", "2026-06-13", "--mood", "sad/2"], "Buồn mà không rõ vì sao.").ok,
  ).toBe(true);
});

test("E2E 5: recall --relation joy --entity Mẹ returns the relation entry", () => {
  const r = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBe(1);
  expect(r.data.results[0].relations.joy).toEqual(["Mẹ"]);
  expect(r.data.results[0].tags).toEqual(["family"]);
});

test("E2E 6: reflect surfaces all three living-loop signals", () => {
  const r = run(["reflect", "--vault", vault, "--since", "2020-01-01"]);
  expect(r.ok).toBe(true);
  // missing relation: the sad/2 entry with no relation.
  expect(r.data.missing_emotional_relation.some((m: any) => m.entry_id.startsWith("2026-06-13"))).toBe(true);
  // relation_summary: Mẹ under joy.
  expect(r.data.relation_summary.joy.some((t: any) => t.target === "Mẹ")).toBe(true);
  // tags_to_convert: the imported tags (no matching entities).
  const tags = r.data.tags_to_convert.map((t: any) => t.tag);
  expect(tags).toEqual(expect.arrayContaining(["parenting", "children"]));
  // suggested_actions reflect both new action kinds.
  expect(r.data.suggested_actions.some((a: string) => a.includes("backfill emotional relation"))).toBe(true);
  expect(r.data.suggested_actions.some((a: string) => a.includes("convert"))).toBe(true);
});

test("E2E 7: disposable — wipe index, reindex, relations/tags survive", () => {
  const before = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]).data.count;
  for (const f of ["index.db", "index.db-wal", "index.db-shm"]) {
    rmSync(join(vault, ".kioku", f), { force: true });
  }
  run(["reindex", "--vault", vault]);
  const after = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]).data.count;
  expect(after).toBe(before);
});
