import { test, expect } from "bun:test";
import {
  parseFrontmatter,
  serializeFrontmatter,
} from "../../src/vault/frontmatter.ts";

test("parse file with no frontmatter", () => {
  const r = parseFrontmatter("# Title\n\nbody text");
  expect(r.meta).toEqual({});
  expect(r.body).toBe("# Title\n\nbody text");
});

test("parse frontmatter block", () => {
  const raw = "---\nsleep_hours: 7\nmood_score: 4\n---\n# 2026-06-12\nbody";
  const r = parseFrontmatter(raw);
  expect(r.meta).toEqual({ sleep_hours: 7, mood_score: 4 });
  expect(r.body).toBe("# 2026-06-12\nbody");
});

test("malformed YAML returns empty meta + warning, no throw", () => {
  const raw = "---\n: : : bad\n  - nope:\n---\nbody";
  const r = parseFrontmatter(raw);
  expect(r.meta).toEqual({});
  expect(r.warning).toBeDefined();
  expect(r.body).toBe("body");
});

test("serialize omits block when meta empty", () => {
  expect(serializeFrontmatter({}, "body")).toBe("body");
});

test("round-trip frontmatter", () => {
  const meta = { sleep_hours: 7, exercise: "run 5km", mood_score: 4 };
  const body = "# 2026-06-12\n\n## 21:30\nhi";
  const serialized = serializeFrontmatter(meta, body);
  const parsed = parseFrontmatter(serialized);
  expect(parsed.meta).toEqual(meta);
  expect(parsed.body).toBe(body);
});
