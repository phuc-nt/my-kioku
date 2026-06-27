import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let vault: string;

interface RunResult {
  ok: boolean;
  data?: any;
  error?: string;
  exitCode: number;
}
function run(args: string[], stdin?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", CLI, ...args], {
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : undefined,
  });
  const out = proc.stdout.toString().trim();
  return { ...(out ? JSON.parse(out) : {}), exitCode: proc.exitCode ?? 0 };
}
/** Write an entry, passing the text via --stdin (matches the agent's pattern). */
function remember(text: string, args: string[]) {
  return run(["remember", "--vault", vault, "--stdin", ...args], text);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-recall-"));
  run(["init", "--vault", vault]);
  // Seed a small life-like vault.
  remember("Ăn phở với [[Hùng]] ở [[Quảng An]]", ["--date", "2026-06-10", "--mood", "happy/4"]);
  remember("Gọi điện cho [[Mẹ]], nói chuyện lâu", ["--date", "2026-06-11", "--mood", "calm/3"]);
  remember("Đi chạy bộ buổi sáng một mình", ["--date", "2026-06-12", "--mood", "tired/2"]);
  run(["remember", "--vault", vault, "--date", "2026-06-12", "--checkin", "sleep_hours=7,mood_score=4"]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("FTS query matches body text (with and without diacritics)", () => {
  const r = run(["recall", "--vault", vault, "pho"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBeGreaterThanOrEqual(1);
  expect(r.data.results[0].body).toContain("phở");
});

test("entity expansion: querying an entity name returns its linked entries", () => {
  // Body of the Mẹ entry does NOT contain the word "Mẹ" outside the wikilink,
  // but querying "Mẹ" must surface it via entity expansion.
  const r = run(["recall", "--vault", vault, "Mẹ"]);
  expect(r.ok).toBe(true);
  const bodies = r.data.results.map((x: any) => x.body);
  expect(bodies.some((b: string) => b.includes("[[Mẹ]]"))).toBe(true);
  expect(r.data.entity_context.some((e: any) => e.name === "Mẹ")).toBe(true);
});

test("strongest FTS match ranks first (C1: bm25 normalization not inverted)", () => {
  // Two entries contain "táo"; one mentions it many times → must rank above the
  // sparse mention. Inverted normalization would put the dense match LAST.
  remember("táo táo táo táo táo rất nhiều táo", ["--date", "2026-06-14"]);
  remember("một quả táo trong một câu rất dài về nhiều chủ đề khác nhau", ["--date", "2026-06-15"]);
  const r = run(["recall", "--vault", vault, "táo"]);
  expect(r.ok).toBe(true);
  expect(r.data.results[0].body).toContain("táo táo táo");
  expect(r.data.results[0].score).toBeGreaterThan(r.data.results[1].score);
});

test("--entity filter returns all entries linking the entity", () => {
  const r = run(["recall", "--vault", vault, "--entity", "Hùng"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBe(1);
  expect(r.data.results[0].links).toContain("Hùng");
});

test("dirty FTS characters do not crash the query", () => {
  for (const q of ['"', "*", "()", "a AND b", "phở* OR ^x", "gì??? !!!"]) {
    const r = run(["recall", "--vault", vault, q]);
    expect(r.ok).toBe(true); // no crash, valid envelope
  }
});

test("--since time filter narrows results", () => {
  const all = run(["recall", "--vault", vault, "--entity", "Mẹ", "--since", "2026-06-01"]);
  expect(all.data.count).toBe(1);
  const none = run(["recall", "--vault", vault, "--entity", "Mẹ", "--from", "2026-06-12"]);
  expect(none.data.count).toBe(0); // Mẹ entry was on 06-11
});

test("--digest returns a compact summary", () => {
  const r = run(["recall", "--vault", vault, "--digest", "--since", "2026-06-01"]);
  expect(r.ok).toBe(true);
  expect(r.data.mood_summary.distribution).toMatchObject({ happy: 1, calm: 1, tired: 1 });
  expect(r.data.checkin.days_logged).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(r.data.active_entities)).toBe(true);
  // Compactness: serialized digest should be well under ~2KB for this fixture.
  expect(JSON.stringify(r.data).length).toBeLessThan(2000);
});

test("manual edit to vault is visible on next recall (lazy sync)", () => {
  remember("Một sự kiện [[mới]] xảy ra hôm nay", ["--date", "2026-06-13"]);
  const r = run(["recall", "--vault", vault, "sự kiện"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBeGreaterThanOrEqual(1);
});

test("query with no match returns empty results, not an error", () => {
  const r = run(["recall", "--vault", vault, "zzzznonexistentzzzz"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBe(0);
});

// --- v1.1: relation filter, RELATION_BONUS, hydrate ---
test("--relation joy --entity X returns the entry with that relation", () => {
  remember("joy:: [[Mẹ]]\nChiều nay vui vì gọi cho mẹ.", ["--date", "2026-06-13", "--mood", "happy/4"]);
  const r = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]);
  expect(r.ok).toBe(true);
  expect(r.data.relation).toBe("joy");
  expect(r.data.count).toBe(1);
  expect(r.data.results[0].relations.joy).toEqual(["Mẹ"]);
});

test("--relation filter excludes entries lacking that relation type", () => {
  remember("joy:: [[Mẹ]]\nVui.", ["--date", "2026-06-13", "--mood", "happy/4"]);
  remember("trigger:: [[Mẹ]]\nLo lắng.", ["--date", "2026-06-14", "--mood", "anxious/2"]);
  const joy = run(["recall", "--vault", vault, "--relation", "joy", "--entity", "Mẹ"]);
  expect(joy.data.count).toBe(1);
  expect(joy.data.results[0].relations.joy).toEqual(["Mẹ"]);
  const trig = run(["recall", "--vault", vault, "--relation", "trigger", "--entity", "Mẹ"]);
  expect(trig.data.count).toBe(1);
  expect(trig.data.results[0].relations.trigger).toEqual(["Mẹ"]);
});

test("relation-linked entry ranks above a plain-link entry for the same entity", () => {
  // Both mention [[Phúc]]; only one has a joy:: relation → it should rank first.
  remember("Gặp [[Phúc]] thoáng qua.", ["--date", "2026-06-10", "--mood", "neutral/3"]);
  remember("joy:: [[Phúc]]\nĐi chơi với Phúc cả ngày.", ["--date", "2026-06-11", "--mood", "happy/5"]);
  const r = run(["recall", "--vault", vault, "--entity", "Phúc"]);
  expect(r.ok).toBe(true);
  expect(r.data.results.length).toBeGreaterThanOrEqual(2);
  // The relation-bearing entry (06-11) ranks first (RELATION_BONUS > ENTITY_BONUS).
  expect(r.data.results[0].relations.joy).toEqual(["Phúc"]);
});

test("hydrate always includes relations + tags keys (stable schema, empty when none)", () => {
  // The seeded v1 entries have no relations/tags.
  const r = run(["recall", "--vault", vault, "Mẹ"]);
  expect(r.ok).toBe(true);
  for (const e of r.data.results) {
    expect(e.relations).toBeDefined();
    expect(e.tags).toBeDefined();
    expect(typeof e.relations).toBe("object");
    expect(Array.isArray(e.tags)).toBe(true);
  }
});

test("--relation with no entity returns all entries having that relation type", () => {
  remember("joy:: [[A]]\nx", ["--date", "2026-06-13", "--mood", "happy/4"]);
  remember("joy:: [[B]]\ny", ["--date", "2026-06-14", "--mood", "happy/4"]);
  remember("trigger:: [[C]]\nz", ["--date", "2026-06-15", "--mood", "anxious/2"]);
  const r = run(["recall", "--vault", vault, "--relation", "joy"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBe(2); // the two joy entries, not the trigger one
});
