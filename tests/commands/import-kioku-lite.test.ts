import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyNotePath } from "../../src/vault/vault-paths.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;
let source: string;

interface RunResult { ok: boolean; data?: any; error?: string; exitCode: number; }
function run(args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args]);
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}

// Fixture mimicking the real kioku-lite format (verified against companion data).
const FIXTURE_A = `# Kioku Lite — 2026-03-03

---
time: "2026-03-03T20:41:11.258053+07:00"
mood: "neutral"
---
Anh chia sẻ link GitHub: https://github.com/phuc-nt
- Blog: https://example.com/blog

---
time: "2026-03-03T20:43:17.966712+07:00"
mood: "excited"
event_time: "2022-08-25"
---
Profile: Nguyễn Trọng Phúc (gọi là Phúc/Anh Phúc)
- Từ Hà Nội, đã có vợ và 2 con
`;

const FIXTURE_B = `# Kioku Lite — 2026-04-04

---
time: "2026-04-04T09:15:00.000000+07:00"
mood: "calm"
---
Một ngày yên bình ở nhà 🏡
`;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-imp-vault-"));
  source = mkdtempSync(join(tmpdir(), "kioku-imp-src-"));
  run(["init", "--vault", vault]);
  writeFileSync(join(source, "2026-03-03.md"), FIXTURE_A);
  writeFileSync(join(source, "2026-04-04.md"), FIXTURE_B);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test("imports blocks into daily notes (event_time wins over time date)", () => {
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);
  expect(r.data.entries_created).toBe(3);

  // Block 1 → 2026-03-03 (no event_time); block 2 → 2022-08-25 (event_time wins).
  const note0303 = readFileSync(dailyNotePath(vault, "2026-03-03"), "utf8");
  expect(note0303).toContain("https://github.com/phuc-nt");
  expect(note0303).toContain("mood:: neutral");
  const note2022 = readFileSync(dailyNotePath(vault, "2022-08-25"), "utf8");
  expect(note2022).toContain("Nguyễn Trọng Phúc");
  expect(note2022).toContain("mood:: excited");
});

test("text imported verbatim with NO wikilinks added", () => {
  run(["import", "--vault", vault, "--from-kioku-lite", source]);
  const note = readFileSync(dailyNotePath(vault, "2026-04-04"), "utf8");
  expect(note).toContain("Một ngày yên bình ở nhà 🏡");
  expect(note).not.toContain("[["); // KG backfilled later, not at import
});

test("import is idempotent (run twice does not duplicate)", () => {
  const r1 = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  const r2 = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r1.data.entries_created).toBe(3);
  expect(r2.data.entries_created).toBe(0);
  expect(r2.data.skipped_duplicate).toBe(3);
});

test("--dry-run previews without writing", () => {
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source, "--dry-run"]);
  expect(r.ok).toBe(true);
  expect(r.data.dry_run).toBe(true);
  expect(r.data.entries_created).toBe(3);
  // Nothing written.
  const { existsSync } = require("node:fs");
  expect(existsSync(dailyNotePath(vault, "2026-03-03"))).toBe(false);
});

test("mood preserved as single word, no intensity", () => {
  run(["import", "--vault", vault, "--from-kioku-lite", source]);
  const note = readFileSync(dailyNotePath(vault, "2026-04-04"), "utf8");
  expect(note).toContain("mood:: calm");
  expect(note).not.toContain("calm/"); // no intensity appended
});

test("imported entries are queryable after import (reindexed)", () => {
  run(["import", "--vault", vault, "--from-kioku-lite", source]);
  const proc = Bun.spawnSync(["bun", "run", CLI, "recall", "--vault", vault, "yên bình"]);
  const res = JSON.parse(proc.stdout.toString().trim());
  expect(res.ok).toBe(true);
  expect(res.data.count).toBeGreaterThanOrEqual(1);
});

test("missing source folder fails cleanly", () => {
  const r = run(["import", "--vault", vault, "--from-kioku-lite", "/no/such/folder"]);
  expect(r.ok).toBe(false);
  expect(r.exitCode).toBe(1);
});

// --- v1.1: tags become a tags:: line; recursive scan; tag-aware idempotency ---
// beforeEach seeds FIXTURE_A/B into `source`; clear them so these tests control
// the file/entry counts they assert on.
function clearSource(): void {
  for (const f of require("node:fs").readdirSync(source)) {
    rmSync(join(source, f), { recursive: true, force: true });
  }
}
const TELEGRAM_FIXTURE = `# Kioku — 2026-02-26

---
time: "2026-02-26T23:14:38.700935+07:00"
mood: "concerned"
tags: ['parenting', 'children', 'phong']
---
Con tôi 4 tuổi. Hay nóng tính mắng con.
`;

test("imports tags as a tags:: line; body verbatim; tags indexed", () => {
  writeFileSync(join(source, "2026-02-26.md"), TELEGRAM_FIXTURE);
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);

  const note = readFileSync(dailyNotePath(vault, "2026-02-26"), "utf8");
  // tags:: line written; verbatim body follows unchanged.
  expect(note).toContain("tags:: parenting, children, phong");
  expect(note).toContain("Con tôi 4 tuổi. Hay nóng tính mắng con.");

  // Tags indexed (queryable via reflect later); body has no tags:: text leak.
  const { openDb } = require("../../src/index/db.ts");
  const db = openDb(vault);
  const tags = db.query("SELECT tag FROM tags ORDER BY tag").all().map((r: any) => r.tag);
  expect(tags).toEqual(["children", "parenting", "phong"]);
  db.close();
});

test("recursive scan ingests subfolders in one command (decision #4)", () => {
  clearSource();
  writeFileSync(join(source, "2026-02-26.md"), TELEGRAM_FIXTURE);
  const sub = join(source, "memory_pre_phase7");
  require("node:fs").mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "2026-02-22.md"),
    `# Kioku — 2026-02-22\n\n---\ntime: "2026-02-22T10:00:00+07:00"\nmood: "proud"\n---\nKỷ niệm cũ.\n`,
  );
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);
  expect(r.data.files).toBe(2); // top-level + subfolder file
  expect(r.data.entries_created).toBe(2);
});

test("idempotent even with tags: re-run creates 0 (hash over original text)", () => {
  clearSource();
  writeFileSync(join(source, "2026-02-26.md"), TELEGRAM_FIXTURE);
  const r1 = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  const r2 = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r1.data.entries_created).toBe(1);
  expect(r2.data.entries_created).toBe(0);
  expect(r2.data.skipped_duplicate).toBe(1);
});

test("non-diary .md in the folder (README) is ignored, not fatal", () => {
  clearSource();
  writeFileSync(join(source, "2026-02-26.md"), TELEGRAM_FIXTURE);
  writeFileSync(join(source, "README.md"), "# Just docs\n\nNo memory blocks here.\n");
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);
  expect(r.data.entries_created).toBe(1); // only the real diary file
  expect(r.data.skipped_bad).toBe(0); // README yields 0 blocks, not an error
});
