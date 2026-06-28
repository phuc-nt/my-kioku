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

test("fold collapses NFC and NFD input to the same output", () => {
  // The same word can arrive composed (NFC) or decomposed (NFD) from different
  // sources; fold() must treat them identically so index and query never diverge.
  for (const w of ["gia đình", "phở", "Đà Nẵng", "nghĩ", "trường", "ước"]) {
    const nfc = w.normalize("NFC");
    const nfd = w.normalize("NFD");
    expect(nfd).not.toBe(nfc); // sanity: the two forms really differ in bytes
    expect(fold(nfd)).toBe(fold(nfc));
  }
});

test("fold is idempotent", () => {
  for (const w of ["gia đình", "Đà Nẵng", "phở Quảng An", "HÙNG"]) {
    expect(fold(fold(w))).toBe(fold(w));
  }
});
