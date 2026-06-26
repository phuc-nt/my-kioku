import { test, expect } from "bun:test";
import { fold } from "../../src/lib/diacritics.ts";

test("folds Vietnamese diacritics", () => {
  expect(fold("Hùng")).toBe("hung");
  expect(fold("phở")).toBe("pho");
  expect(fold("Mẹ")).toBe("me");
});

test("folds đ/Đ to d", () => {
  expect(fold("Đà Nẵng")).toBe("da nang");
  expect(fold("đường")).toBe("duong");
});

test("folding makes accented and bare forms equal", () => {
  expect(fold("Hung")).toBe(fold("Hùng"));
  expect(fold("BUON")).toBe(fold("buồn"));
});
