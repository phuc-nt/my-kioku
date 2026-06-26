import { test, expect } from "bun:test";
import {
  todayISO,
  nowHHMM,
  parseSince,
  isValidISODate,
} from "../src/lib/dates.ts";

test("todayISO formats local date as YYYY-MM-DD", () => {
  const d = new Date(2026, 5, 12, 9, 5); // 2026-06-12 (month is 0-based)
  expect(todayISO(d)).toBe("2026-06-12");
});

test("nowHHMM zero-pads hours and minutes", () => {
  const d = new Date(2026, 5, 12, 9, 5);
  expect(nowHHMM(d)).toBe("09:05");
});

test("parseSince relative days", () => {
  const now = new Date(2026, 5, 12);
  expect(parseSince("7d", now)).toEqual({ from: "2026-06-05", to: "2026-06-12" });
});

test("parseSince relative weeks", () => {
  const now = new Date(2026, 5, 12);
  expect(parseSince("2w", now)).toEqual({ from: "2026-05-29", to: "2026-06-12" });
});

test("parseSince relative months", () => {
  const now = new Date(2026, 5, 12);
  expect(parseSince("3m", now)).toEqual({ from: "2026-03-12", to: "2026-06-12" });
});

test("parseSince absolute start date", () => {
  const now = new Date(2026, 5, 12);
  expect(parseSince("2026-01-01", now)).toEqual({
    from: "2026-01-01",
    to: "2026-06-12",
  });
});

test("parseSince rejects garbage", () => {
  expect(parseSince("banana")).toBeNull();
  expect(parseSince("7x")).toBeNull();
});

test("isValidISODate", () => {
  expect(isValidISODate("2026-06-12")).toBe(true);
  expect(isValidISODate("2026-02-30")).toBe(false); // Feb 30 rolls over
  expect(isValidISODate("2026-13-01")).toBe(false);
  expect(isValidISODate("not-a-date")).toBe(false);
});
