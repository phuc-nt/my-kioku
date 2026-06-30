import { test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyNotePath, entityPath } from "../../src/vault/vault-paths.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-rem-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

interface RunResult {
  ok: boolean;
  data?: any;
  error?: string;
  exitCode: number;
}

/** Invoke the CLI as a subprocess (the way an agent does). */
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  const parsed = out ? JSON.parse(out) : {};
  return { ...parsed, exitCode: proc.exitCode ?? 0 };
}

test("remember appends an entry and creates entity stubs", () => {
  const r = run([
    "remember",
    "--vault", vault,
    "--mood", "happy/4",
    "--date", "2026-06-12",
    "--time", "21:30",
    "Ăn tối với [[Hùng]] ở [[Quảng An]]",
  ]);
  expect(r.ok).toBe(true);
  expect(r.data.entry_id).toBe("2026-06-12#0");
  expect(r.data.links).toEqual(["Hùng", "Quảng An"]);
  expect(r.data.stubs_created.sort()).toEqual(["Hùng", "Quảng An"]);

  const note = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(note).toContain("mood:: happy/4");
  expect(note).toContain("Ăn tối với [[Hùng]] ở [[Quảng An]]");
});

test("stdin preserves Vietnamese + quotes + newlines verbatim", () => {
  const text = `Hôm nay "vui" lắm!\nGặp [[Mẹ]] 'ở' nhà 🏡`;
  const r = run(
    ["remember", "--vault", vault, "--stdin", "--date", "2026-06-12"],
    text,
  );
  expect(r.ok).toBe(true);
  const note = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(note).toContain(text);
});

test("linking an existing entity alias does NOT create a duplicate stub", () => {
  // First remember stubs "Hùng".
  run(["remember", "--vault", vault, "--date", "2026-06-12", "Gặp [[Hùng]]"]);
  // Give Hùng an alias by editing the entity note, then reindex.
  const p = entityPath(vault, "Hùng");
  const raw = readFileSync(p, "utf8");
  Bun.write(p, raw.replace("aliases: []", 'aliases:\n  - "bạn Hùng"'));
  run(["reindex", "--vault", vault]);

  // Linking the alias must not create a new stub.
  const r = run(["remember", "--vault", vault, "--date", "2026-06-13", "Đi chơi với [[bạn Hùng]]"]);
  expect(r.ok).toBe(true);
  expect(r.data.stubs_created).toEqual([]);
});

test("--checkin writes frontmatter without text AND indexes it (C1)", () => {
  const r = run([
    "remember", "--vault", vault, "--date", "2026-06-12",
    "--checkin", "sleep_hours=7,exercise=run 5km,mood_score=4",
  ]);
  expect(r.ok).toBe(true);
  expect(r.data.checkin).toMatchObject({ sleep_hours: 7, mood_score: 4 });
  const note = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(note).toContain("sleep_hours: 7");

  // C1 regression: checkin-only must be indexed immediately, no separate reindex.
  const { openDb } = require("../../src/index/db.ts");
  const db = openDb(vault);
  const meta = db
    .query("SELECT sleep_hours, mood_score FROM daily_meta WHERE date = ?")
    .get("2026-06-12");
  expect(meta).toMatchObject({ sleep_hours: 7, mood_score: 4 });
  db.close();
});

test("invalid mood format warns but still stores text", () => {
  const r = run([
    "remember", "--vault", vault, "--date", "2026-06-12",
    "--mood", "super duper", "Một ngày đẹp trời",
  ]);
  expect(r.ok).toBe(true);
  expect(r.data.mood).toBeNull();
  expect(r.data.warnings?.length).toBeGreaterThanOrEqual(1);
  const note = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(note).toContain("Một ngày đẹp trời");
  expect(note).not.toContain("mood::");
});

test("empty remember (no text, no checkin) fails", () => {
  const r = run(["remember", "--vault", vault, "--date", "2026-06-12"]);
  expect(r.ok).toBe(false);
  expect(r.exitCode).toBe(1);
});

// --- 9A: auto event-date inference (no --date) ---

test("infers event-date from VI text + reports date_inferred_from; body verbatim (S1)", () => {
  const body = "hôm 12/4 Vy sốt cao";
  const r = run(["remember", "--vault", vault, "--stdin"], body);
  expect(r.ok).toBe(true);
  expect(r.data.date.endsWith("-04-12")).toBe(true); // month/day from "12/4"
  expect(r.data.date_inferred_from).toContain("12/4");
  // The body is stored byte-for-byte — the date phrase stays IN the text.
  const stored = readFileSync(dailyNotePath(vault, r.data.date), "utf8");
  expect(stored).toContain("hôm 12/4 Vy sốt cao");
});

test("explicit --date overrides inference", () => {
  const r = run(["remember", "--vault", vault, "--date", "2026-01-01", "--stdin"], "hôm qua ăn phở");
  expect(r.ok).toBe(true);
  expect(r.data.date).toBe("2026-01-01");
  expect(r.data.date_inferred_from).toBeUndefined();
});

test("vague / no date expression keeps today (no inference)", () => {
  const { todayISO } = require("../../src/lib/dates.ts");
  const r = run(["remember", "--vault", vault, "--stdin"], "dạo này hay lo lắng");
  expect(r.ok).toBe(true);
  expect(r.data.date).toBe(todayISO());
  expect(r.data.date_inferred_from).toBeUndefined();
});

test("a quantity like 3/4 is NOT mistaken for a date (safety)", () => {
  const { todayISO } = require("../../src/lib/dates.ts");
  const r = run(["remember", "--vault", vault, "--stdin"], "pha 3/4 cốc cà phê sáng nay");
  expect(r.ok).toBe(true);
  expect(r.data.date).toBe(todayISO()); // kept today, not 0?-0?
  expect(r.data.date_inferred_from).toBeUndefined();
});

test("year-less inference warns that the year was guessed", () => {
  const r = run(["remember", "--vault", vault, "--stdin"], "hôm 12/4 đi chơi");
  expect(r.ok).toBe(true);
  expect((r.data.warnings ?? []).some((w: string) => w.includes("year inferred"))).toBe(true);
});

// --- carry-over B: inline #hashtag → tag rows (body stays verbatim) ---

test("inline #hashtag becomes a tag row; the #tag stays verbatim in the body (S1)", () => {
  const body = "đi #chạy_bộ với #Vy buổi sáng";
  run(["remember", "--vault", vault, "--date", "2026-06-12", "--stdin"], body);
  // Body byte-for-byte (the #tags remain in prose).
  const stored = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(stored).toContain("đi #chạy_bộ với #Vy buổi sáng");
  // The index has the derived tag rows.
  const { openDb } = require("../../src/index/db.ts");
  const { syncIfStale } = require("../../src/index/lazy-sync.ts");
  const db = openDb(vault);
  syncIfStale(db, vault);
  const tags = db.query("SELECT tag FROM tags ORDER BY tag").all().map((r: { tag: string }) => r.tag);
  db.close();
  expect(tags).toContain("chạy_bộ");
  expect(tags).toContain("Vy");
});

test("a # in code/heading/URL does NOT create a tag", () => {
  run(["remember", "--vault", vault, "--date", "2026-06-12", "--stdin"], "viết C# xem example.com/#frag");
  const { openDb } = require("../../src/index/db.ts");
  const { syncIfStale } = require("../../src/index/lazy-sync.ts");
  const db = openDb(vault);
  syncIfStale(db, vault);
  const n = db.query("SELECT COUNT(*) c FROM tags").get().c as number;
  db.close();
  expect(n).toBe(0);
});

test("tag rows are rebuildable from markdown (S2 reindex round-trip)", () => {
  run(["remember", "--vault", vault, "--date", "2026-06-12", "--stdin"], "tập #yoga sáng nay");
  run(["reindex", "--vault", vault]);
  const { openDb } = require("../../src/index/db.ts");
  const db = openDb(vault);
  const tags = db.query("SELECT tag FROM tags").all().map((r: { tag: string }) => r.tag);
  db.close();
  expect(tags).toContain("yoga"); // survived a full drop+rebuild
});

test("entry is immediately queryable via the index after remember", () => {
  run(["remember", "--vault", vault, "--date", "2026-06-12", "Ăn phở ngon"]);
  // Re-open the index and FTS-search.
  const { openDb } = require("../../src/index/db.ts");
  const { syncIfStale } = require("../../src/index/lazy-sync.ts");
  const db = openDb(vault);
  syncIfStale(db, vault);
  const hit = db
    .query("SELECT e.body FROM entries_fts f JOIN entries e ON e.rowid=f.rowid WHERE entries_fts MATCH ?")
    .all("pho");
  expect(hit.length).toBe(1);
  db.close();
});

test("invalid --date is rejected", () => {
  const r = run(["remember", "--vault", vault, "--date", "2026-13-99", "hi"]);
  expect(r.ok).toBe(false);
  expect(r.exitCode).toBe(1);
});

// --- v1.1: relation + tags round-trip via --stdin ---
test("relations/tags lines in stdin: verbatim body, parsed back, targets stubbed", () => {
  const stdin = "joy:: [[Chạy bộ]], [[Mẹ]]\ntags:: health, morning\nChạy bộ buổi sáng, vui.";
  const r = run(
    ["remember", "--vault", vault, "--stdin", "--date", "2026-06-12", "--mood", "happy/4"],
    stdin,
  );
  expect(r.ok).toBe(true);
  // JSON result surfaces relations + tags.
  expect(r.data.relations).toEqual({ joy: ["Chạy bộ", "Mẹ"] });
  expect(r.data.tags).toEqual(["health", "morning"]);
  // Relation targets auto-stubbed (Chạy bộ, Mẹ).
  expect(r.data.stubs_created).toEqual(expect.arrayContaining(["Chạy bộ", "Mẹ"]));
  expect(existsSync(entityPath(vault, "Mẹ"))).toBe(true);

  // On disk: mood:: then joy:: then tags:: then verbatim body line.
  const note = readFileSync(dailyNotePath(vault, "2026-06-12"), "utf8");
  expect(note).toContain("mood:: happy/4\njoy:: [[Chạy bộ]], [[Mẹ]]\ntags:: health, morning\nChạy bộ buổi sáng, vui.");
});

test("entry with no relations/tags still works (v1 behavior)", () => {
  const r = run(
    ["remember", "--vault", vault, "--stdin", "--date", "2026-06-12"],
    "Một ngày bình thường.",
  );
  expect(r.ok).toBe(true);
  expect(r.data.relations).toEqual({});
  expect(r.data.tags).toEqual([]);
});

test("C1: --mood + leading-blank stdin — reported relations match the INDEX", () => {
  // The drift bug: remember used to re-parse `## time\n<text>` (no mood line) so a
  // leading blank made joy:: a field; on disk the mood line pushed the blank AFTER
  // it, ending the field zone → index saw joy:: as body. remember now returns the
  // entry the indexer parsed, so the two agree.
  const stdin = "\njoy:: [[Mẹ]]\nĐi bộ với mẹ.";
  const r = run(
    ["remember", "--vault", vault, "--stdin", "--date", "2026-06-12", "--mood", "happy/4"],
    stdin,
  );
  expect(r.ok).toBe(true);
  expect(r.data.relations).toEqual({ joy: ["Mẹ"] });

  // The index must actually have the joy relation (no drift).
  const hit = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]);
  expect(hit.data.count).toBe(1);
  expect(hit.data.results[0].relations.joy).toEqual(["Mẹ"]);
});
