// End-to-end: drive the real CLI through the full lifecycle on a fixture vault
// that mimics the openclaw diary data. The real-data manual run is documented in
// tests/e2e/manual-checklist.md; this automated E2E uses a deterministic fixture
// so it runs anywhere without the user's ~/.kioku-lite folder.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
  if (!out) {
    // A crash (empty stdout) must fail loudly, not masquerade as {} downstream.
    throw new Error(
      `CLI produced no output (exit ${proc.exitCode}): ${proc.stderr.toString()}`,
    );
  }
  return { ...JSON.parse(out), exitCode: proc.exitCode ?? 0 };
}

// A kioku-lite-shaped fixture: family, health, events, multi-year.
const KIOKU_LITE_FIXTURE = `# Kioku Lite — 2026-03-03

---
time: "2026-03-03T20:00:00+07:00"
mood: "neutral"
event_time: "2020-05-01"
---
Profile: Nguyễn Trọng Phúc, từ Hà Nội, có vợ và 2 con. Làm ở Techbase Việt Nam.

---
time: "2026-03-03T20:05:00+07:00"
mood: "happy"
---
Cuối tuần ăn phở với gia đình, các con rất vui. Mẹ nấu ăn ngon.

---
time: "2026-03-03T20:10:00+07:00"
mood: "tired"
---
Tuần này ngủ ít, nhiều việc ở công ty. Cần nghỉ ngơi nhiều hơn.
`;

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-e2e-vault-"));
  source = mkdtempSync(join(tmpdir(), "kioku-e2e-src-"));
  writeFileSync(join(source, "2026-03-03.md"), KIOKU_LITE_FIXTURE);
});
afterAll(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test("E2E step 1: init creates a clean vault", () => {
  const r = run(["init", "--vault", vault]);
  expect(r.ok).toBe(true);
  expect(existsSync(join(vault, "journal"))).toBe(true);
});

test("E2E step 2: import legacy markdown (verbatim, no links)", () => {
  const r = run(["import", "--vault", vault, "--from-kioku-lite", source]);
  expect(r.ok).toBe(true);
  expect(r.data.entries_created).toBe(3);
  expect(r.data.skipped_bad).toBe(0);
});

test("E2E step 3: full-text recall on imported data (diacritic-insensitive)", () => {
  const pho = run(["recall", "--vault", vault, "pho"]); // matches "phở"
  expect(pho.ok).toBe(true);
  expect(pho.data.count).toBeGreaterThanOrEqual(1);
});

test("E2E step 4: event_time placed entry on the right (past) day", () => {
  // The profile entry has event_time 2020-05-01.
  const r = run(["recall", "--vault", vault, "Techbase", "--from", "2020-01-01", "--to", "2020-12-31"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBeGreaterThanOrEqual(1);
});

test("E2E step 5: remember new entries WITH links (the living layer)", () => {
  run(["remember", "--vault", vault, "--stdin", "--date", "2026-06-12", "--mood", "happy/4"],
    "Đi chơi với [[Mẹ]] và [[Hùng]] ở công viên");
  run(["remember", "--vault", vault, "--stdin", "--date", "2026-06-13", "--mood", "calm/3"],
    "Cà phê sáng với [[Hùng]]");
  run(["remember", "--vault", vault, "--date", "2026-06-13", "--checkin", "sleep_hours=7,mood_score=4"]);

  const ent = run(["recall", "--vault", vault, "--entity", "Hùng"]);
  expect(ent.data.count).toBe(2);
});

test("E2E step 6: reflect surfaces the living-loop backlog (imported entries lack links)", () => {
  const r = run(["reflect", "--vault", vault, "--since", "2020-01-01"]);
  expect(r.ok).toBe(true);
  // Imported entries have no wikilinks → baseline backlog for the agent.
  expect(r.data.lint.entries_without_links.length).toBeGreaterThanOrEqual(3);
  // Newly remembered entries created unknown-type entity stubs.
  expect(r.data.lint.unknown_type_entities.length).toBeGreaterThanOrEqual(1);
  // Suggested actions are derived.
  expect(r.data.suggested_actions.length).toBeGreaterThanOrEqual(1);
});

test("E2E step 7: entity merge consolidates duplicates", () => {
  // Create a duplicate then merge.
  run(["remember", "--vault", vault, "--stdin", "--date", "2026-06-14"],
    "Gặp lại [[bạn Hùng]]");
  const m = run(["entity", "merge", "bạn Hùng", "--into", "Hùng", "--vault", vault]);
  expect(m.ok).toBe(true);
  // After merge, recall --entity Hùng includes the merged entry.
  const ent = run(["recall", "--vault", vault, "--entity", "Hùng"]);
  expect(ent.data.count).toBe(3);
});

test("E2E step 8: disposable index — wipe and reindex yields identical snapshot", () => {
  // Snapshot a RICH set of signals (not just one count) so a partial rebuild
  // that drops moods/links/meta/FTS rows would be caught.
  const snapshot = () => {
    const ent = run(["recall", "--vault", vault, "--entity", "Hùng"]).data;
    const fts = run(["recall", "--vault", vault, "Hùng"]).data.count;
    const refl = run(["reflect", "--vault", vault, "--since", "2020-01-01"]).data;
    const digest = run(["recall", "--vault", vault, "--digest", "--since", "30d"]).data;
    return JSON.stringify({
      entityCount: ent.count,
      entityMoods: ent.results.map((r: any) => r.mood).sort(),
      ftsCount: fts,
      withoutLinks: refl.lint.entries_without_links.length,
      unknownEntities: refl.lint.unknown_type_entities.length,
      moodDist: digest.mood_summary.distribution,
    });
  };

  const before = snapshot();
  rmSync(join(vault, ".kioku", "index.db"), { force: true });
  rmSync(join(vault, ".kioku", "index.db-wal"), { force: true });
  rmSync(join(vault, ".kioku", "index.db-shm"), { force: true });
  run(["reindex", "--vault", vault]);
  const after = snapshot();
  expect(after).toBe(before);
});

test("E2E step 9: digest is compact (<500 tokens ≈ <2000 bytes)", () => {
  const r = run(["recall", "--vault", vault, "--digest", "--since", "30d"]);
  expect(r.ok).toBe(true);
  expect(JSON.stringify(r.data).length).toBeLessThan(2000);
});
