// GAP 9B: `entity list [--type]`, `recall --type`, and reflect entity_type_suggestions.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
function classify(name: string, type: string) {
  writeFileSync(join(vault, "entities", `${name}.md`), `---\ntype: ${type}\n---\n# ${name}\n`, "utf8");
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "kioku-9b-"));
  run(["init", "--vault", vault]);
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

test("entity list --type filters by type with mention counts (stable order)", () => {
  remember("Ăn tối với [[Mẹ]] ở [[Quảng An]].", "2026-06-10", "happy/4");
  remember("Cà phê [[Quảng An]] sáng.", "2026-06-11", "calm/3");
  classify("Quảng An", "place");
  classify("Mẹ", "person");
  run(["reindex", "--vault", vault]);

  const places = run(["entity", "list", "--vault", vault, "--type", "place"]);
  expect(places.ok).toBe(true);
  expect(places.data.count).toBe(1);
  expect(places.data.entities[0].name).toBe("Quảng An");
  expect(places.data.entities[0].mentions).toBe(2);

  const all = run(["entity", "list", "--vault", vault]);
  expect(all.data.count).toBe(2); // no --type → all entities
});

test("recall --type filters to entries linking an entity of that type", () => {
  remember("Ăn tối với [[Mẹ]] ở [[Quảng An]].", "2026-06-10", "happy/4");
  remember("Cà phê [[Quảng An]] sáng.", "2026-06-11", "calm/3");
  remember("Đi chạy bộ một mình.", "2026-06-12", "tired/2"); // no entity
  classify("Quảng An", "place");
  classify("Mẹ", "person");
  run(["reindex", "--vault", vault]);

  const place = run(["recall", "--vault", vault, "--type", "place"]);
  expect(place.ok).toBe(true);
  expect(place.data.count).toBe(2); // both Quảng An entries
  expect(place.data.type).toBe("place");

  const person = run(["recall", "--vault", vault, "--type", "person"]);
  expect(person.data.count).toBe(1); // only the Mẹ entry
});

test("recall --type with no matching entity returns empty (S4, no invention)", () => {
  remember("Ăn phở sáng.", "2026-06-10", "happy/4");
  const r = run(["recall", "--vault", vault, "--type", "event"]);
  expect(r.ok).toBe(true);
  expect(r.data.count).toBe(0);
});

test("recall query + --type: type seeds, query ranks the match first", () => {
  remember("Họp ở [[văn phòng]] về dự án.", "2026-06-10", "neutral/3");
  remember("Ăn trưa ở [[quán cũ]].", "2026-06-11", "happy/4");
  classify("văn phòng", "place");
  classify("quán cũ", "place");
  run(["reindex", "--vault", vault]);
  // --type place admits both place-linking entries; the query "họp dự án" ranks the
  // matching one FIRST (the other is a lower-scored type-seed, still type-valid).
  const r = run(["recall", "--vault", vault, "họp dự án", "--type", "place"]);
  expect(r.ok).toBe(true);
  expect(r.data.results[0].id).toBe("2026-06-10#0"); // query match ranks first
  // Every result genuinely links a place (the hard filter held).
  expect(r.data.results.every((e: { links: string[] }) =>
    e.links.some((l) => l === "văn phòng" || l === "quán cũ"))).toBe(true);
});

test("reflect suggests person type for a relation target (deterministic)", () => {
  remember("joy:: [[Mẹ]]\nĂn tối với [[Mẹ]].", "2026-06-10", "happy/4");
  const r = run(["reflect", "--vault", vault, "--since", "30d"]);
  expect(r.ok).toBe(true);
  const s = r.data.entity_type_suggestions;
  expect(s.some((x: { name: string; suggested: string }) => x.name === "Mẹ" && x.suggested === "person")).toBe(true);
  expect(r.data.suggested_actions.some((a: string) => a.includes("set type"))).toBe(true);
});

test("reflect omits a type suggestion when there is no confident signal", () => {
  // A bare wikilink with no relation → unknown, no confident signal → not suggested.
  remember("Đi ngang [[chỗ lạ]] hôm nay.", "2026-06-10", "neutral/3");
  const r = run(["reflect", "--vault", vault, "--since", "30d"]);
  expect(r.data.entity_type_suggestions).toHaveLength(0);
});
