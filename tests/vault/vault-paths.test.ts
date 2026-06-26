import { test, expect } from "bun:test";
import {
  sanitizeFileName,
  dailyNoteRelPath,
  entityRelPath,
  dailyNotePath,
  entityPath,
} from "../../src/vault/vault-paths.ts";

test("sanitizeFileName keeps Vietnamese diacritics", () => {
  expect(sanitizeFileName("Hùng")).toBe("Hùng");
  expect(sanitizeFileName("Quảng An (quán)")).toBe("Quảng An (quán)");
});

test("sanitizeFileName strips illegal filesystem chars", () => {
  expect(sanitizeFileName("a/b:c*d?")).toBe("a b c d");
  expect(sanitizeFileName('x"y<z>|w')).toBe("x y z w");
});

test("sanitizeFileName keeps emoji", () => {
  expect(sanitizeFileName("Trip 🏖️")).toBe("Trip 🏖️");
});

test("sanitizeFileName falls back for empty", () => {
  expect(sanitizeFileName("///")).toBe("untitled");
  expect(sanitizeFileName("   ")).toBe("untitled");
});

test("sanitizeFileName rejects dot-only traversal names", () => {
  expect(sanitizeFileName(".")).toBe("untitled");
  expect(sanitizeFileName("..")).toBe("untitled");
  expect(sanitizeFileName("...")).toBe("untitled");
});

test("dailyNotePath rejects invalid dates (H1)", () => {
  expect(() => dailyNotePath("/vault", "2026-6")).toThrow();
  expect(() => dailyNotePath("/vault", "../../etc")).toThrow();
  expect(() => dailyNotePath("/vault", "2026-02-30")).toThrow();
});

test("entityPath stays under vault, no traversal (H2)", () => {
  const p = entityPath("/vault", "../../../etc/passwd");
  expect(p.startsWith("/vault/")).toBe(true);
  expect(p).not.toContain("etc/passwd");
});

test("dailyNoteRelPath nests by year/month", () => {
  expect(dailyNoteRelPath("2026-06-12")).toBe("journal/2026/06/2026-06-12.md");
});

test("entityRelPath", () => {
  expect(entityRelPath("Mẹ")).toBe("entities/Mẹ.md");
});
