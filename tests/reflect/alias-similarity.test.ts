import { test, expect } from "bun:test";
import {
  jaroWinkler,
  findAliasCandidates,
} from "../../src/reflect/alias-similarity.ts";

test("identical strings score 1", () => {
  expect(jaroWinkler("hung", "hung")).toBe(1);
});

test("close Vietnamese variants score high", () => {
  expect(jaroWinkler("hung", "hungg")).toBeGreaterThan(0.85);
  expect(jaroWinkler("phuc", "phucnt")).toBeGreaterThan(0.8);
});

test("unrelated strings score low", () => {
  expect(jaroWinkler("hung", "xyzzy")).toBeLessThan(0.5);
});

test("findAliasCandidates pairs accented/unaccented and near-dupes", () => {
  // After folding: "Hùng"→"hung", "Hung"→"hung" (identical), "bạn Hùng"→"ban hung"
  const cands = findAliasCandidates(["Hùng", "Hung", "Mẹ", "Xyz"]);
  const pair = cands.find(
    (c) => (c.a === "Hùng" && c.b === "Hung") || (c.a === "Hung" && c.b === "Hùng"),
  );
  expect(pair).toBeDefined();
  expect(pair!.similarity).toBe(1);
});

test("dissimilar names produce no candidate", () => {
  const cands = findAliasCandidates(["Mẹ", "Quảng An", "Hùng"]);
  expect(cands.length).toBe(0);
});

test("token containment catches honorific/prefix aliases (plan: Hùng / bạn Hùng)", () => {
  const cands = findAliasCandidates(["Hùng", "bạn Hùng", "Mẹ"]);
  const pair = cands.find(
    (c) =>
      (c.a === "Hùng" && c.b === "bạn Hùng") ||
      (c.a === "bạn Hùng" && c.b === "Hùng"),
  );
  expect(pair).toBeDefined();
  expect(pair!.similarity).toBeGreaterThanOrEqual(0.9);
});
