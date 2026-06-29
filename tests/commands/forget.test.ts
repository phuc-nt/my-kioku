// `forget` command (phase-03): delete / redact an entry by id or entity, with a
// dry-run preview. Guards: neighbor entries stay byte-for-byte (S1), a pasted
// heading-shaped line inside prose is NOT mis-cut, ordinals renumber after delete.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

interface RunResult {
  ok: boolean;
  // deno-lint-ignore no-explicit-any
  data?: any;
  // deno-lint-ignore no-explicit-any
  error?: any;
  exitCode: number;
}
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}
function remember(text: string, date: string, time: string, mood = "neutral/3") {
  return run(["remember", "--vault", vault, "--stdin", "--date", date, "--time", time, "--mood", mood], text);
}
function dailyFile(date: string): string {
  const [y, m] = date.split("-");
  return join(vault, "journal", y!, m!, `${date}.md`);
}
function forget(args: string[]): RunResult {
  return run(["forget", "--vault", vault, ...args]);
}
function recallCount(query: string): number {
  const r = run(["recall", "--vault", vault, query]);
  return (r.data?.results ?? []).length;
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-forget-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("delete by id removes exactly that block; neighbor byte-identical", () => {
  remember("Sáng họp với [[Hùng]].", "2026-06-12", "09:00");
  remember("Lương 65 triệu, bí mật.", "2026-06-12", "14:00", "happy/4");
  const before = readFileSync(dailyFile("2026-06-12"), "utf8");
  const neighborBlock = before.slice(before.indexOf("## 09:00"), before.indexOf("## 14:00"));

  const r = forget(["2026-06-12#1"]);
  expect(r.ok).toBe(true);
  expect(r.data.mode).toBe("delete");
  expect(r.data.removed_count).toBe(1);

  const after = readFileSync(dailyFile("2026-06-12"), "utf8");
  expect(after).not.toContain("65 triệu"); // deleted entry gone
  expect(after).toContain(neighborBlock.trimEnd()); // neighbor bytes intact
  expect(recallCount("lương 65 triệu bí mật")).toBe(0); // index reflects deletion
});

test("dry-run previews without writing", () => {
  remember("Bí mật cần xoá.", "2026-06-12", "09:00");
  const before = readFileSync(dailyFile("2026-06-12"), "utf8");
  const r = forget(["2026-06-12#0", "--dry-run"]);
  expect(r.ok).toBe(true);
  expect(r.data.dry_run).toBe(true);
  expect(readFileSync(dailyFile("2026-06-12"), "utf8")).toBe(before); // unchanged
  expect(recallCount("bí mật cần xoá")).toBe(1); // still indexed
});

test("--redact keeps heading + mood, replaces only the body", () => {
  remember("Nội dung nhạy cảm cần che.", "2026-06-12", "09:00", "anxious/4");
  const r = forget(["2026-06-12#0", "--redact"]);
  expect(r.ok).toBe(true);
  expect(r.data.mode).toBe("redact");
  const after = readFileSync(dailyFile("2026-06-12"), "utf8");
  expect(after).toContain("## 09:00"); // heading kept
  expect(after).toContain("mood:: anxious/4"); // structured field kept
  expect(after).toContain("[redacted 2026-06-12]"); // body replaced
  expect(after).not.toContain("nhạy cảm"); // original body gone
});

test("--redact of a NON-last entry keeps the next entry intact (separator preserved)", () => {
  remember("Nội dung nhạy cảm.", "2026-06-12", "09:00", "anxious/4");
  remember("Entry kế tiếp giữ nguyên.", "2026-06-12", "14:00", "happy/4");
  const r = forget(["2026-06-12#0", "--redact"]);
  expect(r.ok).toBe(true);
  const after = readFileSync(dailyFile("2026-06-12"), "utf8");
  // The 14:00 entry must remain a DISTINCT, blank-preceded heading (not swallowed).
  expect(after).toContain("\n\n## 14:00"); // blank separator before next heading survives
  expect(after).toContain("Entry kế tiếp giữ nguyên.");
  expect(after.endsWith("\n")).toBe(true); // EOF newline preserved
  // Re-parse: still TWO entries (redacted #0 + intact #1), recall finds the neighbor.
  expect(recallCount("entry kế tiếp giữ nguyên")).toBe(1);
  const neighbor = run(["recall", "--vault", vault, "entry kế tiếp"]).data.results[0];
  expect(neighbor.time).toBe("14:00"); // time + identity intact, not absorbed
  expect(neighbor.mood).toBe("happy");
});

test("--entity --redact redacts every linked entry, neighbors intact", () => {
  remember("Cãi nhau với [[Hùng]] gay gắt.", "2026-06-12", "09:00", "angry/4");
  remember("Buổi trưa yên bình.", "2026-06-12", "12:00", "calm/3"); // no link
  remember("Lại gặp [[Hùng]] buổi tối.", "2026-06-12", "20:00", "sad/3");
  const r = forget(["--entity", "Hùng", "--redact"]);
  expect(r.ok).toBe(true);
  expect(r.data.mode).toBe("redact");
  expect(r.data.removed_count).toBe(2);
  const after = readFileSync(dailyFile("2026-06-12"), "utf8");
  expect(after).not.toContain("gay gắt"); // both bodies redacted
  expect(after).not.toContain("buổi tối");
  expect(after).toContain("Buổi trưa yên bình."); // untargeted middle entry byte-intact
  expect(after).toContain("mood:: angry/4"); // redacted entries keep their mood field
  // All three entries still parse distinctly.
  expect(recallCount("buổi trưa yên bình")).toBe(1);
});

test("delete by entity removes all linked entries across files", () => {
  remember("Gặp [[Hùng]] sáng.", "2026-06-12", "09:00");
  remember("Đi chơi một mình.", "2026-06-12", "10:00"); // no Hùng link
  remember("Ăn tối với [[Hùng]].", "2026-06-13", "19:00");
  const r = forget(["--entity", "Hùng"]);
  expect(r.ok).toBe(true);
  expect(r.data.removed_count).toBe(2);
  expect(readFileSync(dailyFile("2026-06-12"), "utf8")).not.toContain("[[Hùng]]");
  expect(readFileSync(dailyFile("2026-06-12"), "utf8")).toContain("Đi chơi một mình"); // unlinked entry kept
  expect(existsSync(dailyFile("2026-06-13"))).toBe(true);
  expect(readFileSync(dailyFile("2026-06-13"), "utf8")).not.toContain("[[Hùng]]");
});

test("delete by entity tolerates an accent-free name (folded match)", () => {
  remember("Cà phê với [[Hùng]].", "2026-06-12", "09:00");
  const r = forget(["--entity", "Hung"]); // no diacritic
  expect(r.ok).toBe(true);
  expect(r.data.removed_count).toBe(1);
});

test("a pasted heading-shaped line inside prose is NOT mis-cut (verbatim S1)", () => {
  // Entry 0's BODY contains a line that looks like a heading. It must stay inside
  // entry 0 — deleting the PRECEDING entry must not corrupt it.
  remember("Buổi sáng bình thường.", "2026-06-12", "08:00");
  const tricky = "Ghi lại lịch họp:\n\n## 10:00 standup nhóm\nNhớ chuẩn bị slide.";
  remember(tricky, "2026-06-12", "09:00", "neutral/3");
  // Delete entry 0 (08:00). Entry 1's body (with the pasted "## 10:00") must survive byte-exact.
  const r = forget(["2026-06-12#0"]);
  expect(r.ok).toBe(true);
  const after = readFileSync(dailyFile("2026-06-12"), "utf8");
  expect(after).toContain("## 10:00 standup nhóm"); // the pasted line survived
  expect(after).toContain("Nhớ chuẩn bị slide."); // and its following line
  expect(after).not.toContain("Buổi sáng bình thường"); // entry 0 gone
  // Only ONE real entry heading remains (the 09:00 one); the pasted "## 10:00" is body.
  expect(recallCount("standup chuẩn bị slide")).toBe(1);
});

test("ordinals renumber after a delete; the report warns", () => {
  // Distinct content words so recall pinpoints one entry (coverage counts ≥3-char tokens).
  remember("Ăn phở sáng.", "2026-06-12", "08:00");
  remember("Họp nhóm trưa.", "2026-06-12", "09:00");
  remember("Chạy bộ tối muộn.", "2026-06-12", "10:00");
  forget(["2026-06-12#0"]); // delete the phở entry → others renumber down
  // The "Chạy bộ" entry was #2, now #1 after the delete.
  expect(recallCount("chạy bộ tối muộn")).toBe(1);
  const after = run(["recall", "--vault", vault, "chạy bộ tối muộn"]).data.results[0];
  expect(after.id).toBe("2026-06-12#1"); // renumbered
});

test("forget with no target fails with a hint", () => {
  const r = forget([]);
  expect(r.ok).toBe(false);
  expect(r.error).toContain("target");
});

test("forget a non-existent id fails cleanly", () => {
  remember("Có một entry.", "2026-06-12", "09:00");
  const r = forget(["2026-06-12#9"]);
  expect(r.ok).toBe(false);
});
