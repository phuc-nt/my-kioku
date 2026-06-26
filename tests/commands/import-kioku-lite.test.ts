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
