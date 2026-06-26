import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
  vault = mkdtempSync(join(tmpdir(), "kioku-reflect-"));
  run(["init", "--vault", vault]);
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

test("empty/new vault reflect runs clean, no crash", () => {
  const r = run(["reflect", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(r.data.lint.entries_without_links).toEqual([]);
  expect(r.data.insight_candidates).toEqual([]);
  expect(r.data.suggested_actions).toEqual([]);
});

test("reflect surfaces lint defects with traceable evidence", () => {
  // Entry with a link → auto-stubs an unknown-type entity "Hùng".
  remember("Gặp [[Hùng]] hôm nay", ["--date", "2026-06-10", "--mood", "happy/4"]);
  // Entry with NO link and NO mood.
  remember("Một ngày bình thường không có gì đặc biệt", ["--date", "2026-06-11"]);

  const r = run(["reflect", "--vault", vault]);
  expect(r.ok).toBe(true);

  // unknown-type entity caught (Hùng, type:unknown from auto-stub)
  expect(r.data.lint.unknown_type_entities.some((e: any) => e.name === "Hùng")).toBe(true);
  // entry without links caught with an id
  expect(r.data.lint.entries_without_links.length).toBeGreaterThanOrEqual(1);
  expect(r.data.lint.entries_without_links[0].entry_id).toMatch(/2026-06-11#\d/);
  // entry without mood caught
  expect(r.data.lint.entries_without_mood.length).toBeGreaterThanOrEqual(1);
  // suggested_actions derived
  expect(r.data.suggested_actions.length).toBeGreaterThanOrEqual(1);
});

test("broken wikilink (entity file deleted) is detected", () => {
  remember("Đi cùng [[Hùng]]", ["--date", "2026-06-10", "--mood", "calm/3"]);
  // Delete the stub file but keep the link in the journal.
  rmSync(entityPath(vault, "Hùng"));
  const r = run(["reflect", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(r.data.lint.broken_wikilinks.some((b: any) => b.target === "Hùng")).toBe(true);
});

test("alias candidate detected for near-duplicate entity names", () => {
  // Create two entity stubs that fold to near-identical forms.
  remember("Gặp [[Hùng]]", ["--date", "2026-06-10", "--mood", "happy/4"]);
  remember("Gặp [[Hungg]]", ["--date", "2026-06-11", "--mood", "happy/4"]);
  const r = run(["reflect", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(r.data.alias_candidates.length).toBeGreaterThanOrEqual(1);
});

test("declining-intensity streak surfaces a mood_streak insight", () => {
  // 4 consecutive days of declining intensity.
  remember("Ngày 1", ["--date", "2026-06-10", "--mood", "ok/5"]);
  remember("Ngày 2", ["--date", "2026-06-11", "--mood", "ok/4"]);
  remember("Ngày 3", ["--date", "2026-06-12", "--mood", "ok/3"]);
  remember("Ngày 4", ["--date", "2026-06-13", "--mood", "ok/2"]);
  const r = run(["reflect", "--vault", vault, "--since", "2026-06-01"]);
  expect(r.ok).toBe(true);
  const streak = r.data.insight_candidates.find((i: any) => i.kind === "mood_streak");
  expect(streak).toBeDefined();
  expect(streak.evidence.length).toBeGreaterThanOrEqual(4);
});

test("--md writes a readable markdown report into the vault", () => {
  remember("Gặp [[Hùng]]", ["--date", "2026-06-10", "--mood", "happy/4"]);
  const r = run(["reflect", "--vault", vault, "--md"]);
  expect(r.ok).toBe(true);
  expect(r.data.md_path).toBeDefined();
  expect(existsSync(r.data.md_path)).toBe(true);
  const md = require("node:fs").readFileSync(r.data.md_path, "utf8");
  expect(md).toContain("# Reflect");
  expect(md).toContain("## Suggested actions");
});

test("every finding is traceable (no fabricated entries)", () => {
  remember("Không link gì cả", ["--date", "2026-06-10"]);
  const r = run(["reflect", "--vault", vault]);
  for (const e of r.data.lint.entries_without_links) {
    expect(e.entry_id).toMatch(/^\d{4}-\d{2}-\d{2}#\d+$/);
  }
});
