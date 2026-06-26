import { test, expect } from "bun:test";
import { parseCheckin } from "../../src/lib/checkin-parser.ts";

test("parses simple key=value pairs", () => {
  const { fields } = parseCheckin("sleep_hours=7,mood_score=4");
  expect(fields).toEqual({ sleep_hours: 7, mood_score: 4 });
});

test("coerces known numeric keys, keeps strings", () => {
  const { fields } = parseCheckin('sleep_hours=6.5,exercise="run 5km"');
  expect(fields.sleep_hours).toBe(6.5);
  expect(fields.exercise).toBe("run 5km");
});

test("quoted value may contain a comma", () => {
  const { fields } = parseCheckin('exercise="run 5km, then yoga"');
  expect(fields.exercise).toBe("run 5km, then yoga");
});

test("inner quotes are preserved (only wrapping pair stripped)", () => {
  const { fields } = parseCheckin('note="he said ""hi"""');
  expect(fields.note).toBe('he said ""hi""');
});

test("unquoted inner quote is kept literal", () => {
  const { fields } = parseCheckin('note=say "hi"');
  expect(fields.note).toBe('say "hi"');
});

test("empty value is skipped with a warning (no silent 0)", () => {
  const { fields, warnings } = parseCheckin("sleep_hours=");
  expect(fields.sleep_hours).toBeUndefined();
  expect(warnings.length).toBe(1);
});

test("non-numeric value for numeric key warns and stores as text", () => {
  const { fields, warnings } = parseCheckin("sleep_hours=lots");
  expect(fields.sleep_hours).toBe("lots");
  expect(warnings.length).toBe(1);
});

test("malformed segment without '=' is warned and skipped", () => {
  const { fields, warnings } = parseCheckin("sleep_hours=7,garbage");
  expect(fields).toEqual({ sleep_hours: 7 });
  expect(warnings.length).toBe(1);
});

test("empty input yields no fields", () => {
  expect(parseCheckin("").fields).toEqual({});
});
