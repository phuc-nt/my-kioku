// Concept-bridge detector (phase-04): reflect SUGGESTS a [[concept]] link for a tag
// that spans >= CONCEPT_BRIDGE_MIN entries but isn't yet a wikilink. Read-only — the
// CLI never edits markdown (S1); the agent applies the link.
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
function bridges(): { concept: string; entry_count: number; evidence: string[] }[] {
  const r = run(["reflect", "--vault", vault, "--since", "90d"]);
  expect(r.ok).toBe(true);
  return r.data.concept_bridges;
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-cb-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function withTag(tag: string, body: string, date: string, mood = "happy/4") {
  remember(`tags:: ${tag}\n${body}`, date, mood);
}

test("a tag spanning >= MIN entries is suggested as a concept bridge", () => {
  withTag("thể dục", "Đi gym.", "2026-06-10");
  withTag("thể dục", "Chạy bộ.", "2026-06-11");
  withTag("thể dục", "Bơi lội.", "2026-06-12");
  const b = bridges();
  expect(b).toHaveLength(1);
  expect(b[0]!.concept).toBe("thể dục");
  expect(b[0]!.entry_count).toBe(3);
  expect(b[0]!.evidence).toContain("2026-06-10#0");
  expect(b[0]!.evidence).toContain("2026-06-12#0");
});

test("a tag below MIN entries is NOT suggested", () => {
  withTag("nấu ăn", "Nấu phở.", "2026-06-10");
  withTag("nấu ăn", "Làm bánh.", "2026-06-11");
  expect(bridges()).toHaveLength(0);
});

test("a tag already represented as an entity is NOT suggested", () => {
  // Create the entity note by linking it; also tag three entries with the same word.
  withTag("Gym", "Tập tạ. [[Gym]]", "2026-06-10");
  withTag("Gym", "Cardio. [[Gym]]", "2026-06-11");
  withTag("Gym", "Yoga. [[Gym]]", "2026-06-12");
  // "Gym" is both a tag and an entity (auto-stubbed by the [[Gym]] link) → not a bridge.
  expect(bridges().some((x) => x.concept.toLowerCase() === "gym")).toBe(false);
});

test("the suggestion appears in suggested_actions", () => {
  withTag("đọc sách", "Đọc Sapiens.", "2026-06-10");
  withTag("đọc sách", "Đọc Atomic Habits.", "2026-06-11");
  withTag("đọc sách", "Đọc Dune.", "2026-06-12");
  const r = run(["reflect", "--vault", vault, "--since", "90d"]);
  expect(r.data.suggested_actions).toContain("add [[đọc sách]] to 3 entries");
});

test("reflect does NOT edit the markdown (S1 read-only)", () => {
  withTag("thể dục", "Đi gym.", "2026-06-10");
  withTag("thể dục", "Chạy bộ.", "2026-06-11");
  withTag("thể dục", "Bơi lội.", "2026-06-12");
  const file = join(vault, "journal", "2026", "06", "2026-06-10.md");
  const before = Bun.spawnSync(["cat", file]).stdout.toString();
  run(["reflect", "--vault", vault, "--since", "90d"]);
  const after = Bun.spawnSync(["cat", file]).stdout.toString();
  expect(after).toBe(before); // byte-identical — reflect never writes the vault
});

test("folded variants of a tag count as one bridge", () => {
  // "Thể Dục" and "thể dục" should merge (fold) into one cluster of 3.
  withTag("Thể Dục", "Gym.", "2026-06-10");
  withTag("thể dục", "Chạy.", "2026-06-11");
  withTag("thể dục", "Bơi.", "2026-06-12");
  const b = bridges();
  expect(b).toHaveLength(1);
  expect(b[0]!.entry_count).toBe(3);
});
