import { test, expect } from "bun:test";
import {
  parseRelationLine,
  parseTagsLine,
} from "../../src/vault/inline-field-parser.ts";

// --- parseRelationLine ---

test("parses a relation line with one wikilink", () => {
  expect(parseRelationLine("joy:: [[Chạy bộ]]")).toEqual({
    verb: "joy",
    targets: ["Chạy bộ"],
  });
});

test("parses multiple comma-separated targets, preserves order, dedupes", () => {
  expect(parseRelationLine("with:: [[Hùng]], [[Mẹ]], [[Hùng]]")).toEqual({
    verb: "with",
    targets: ["Hùng", "Mẹ"],
  });
});

test("lowercases the verb", () => {
  expect(parseRelationLine("Joy:: [[X]]")?.verb).toBe("joy");
});

test("preserves display alias target (before pipe)", () => {
  expect(parseRelationLine("with:: [[Hùng|bạn ấy]]")).toEqual({
    verb: "with",
    targets: ["Hùng"],
  });
});

test("rejects prose with no wikilink (verbatim)", () => {
  expect(parseRelationLine("with:: my friend Hùng came over")).toBeNull();
});

test("rejects line mixing wikilink + stray prose", () => {
  expect(parseRelationLine("joy:: [[Chạy bộ]] và nhiều thứ khác")).toBeNull();
});

test("rejects reserved verbs mood/tags", () => {
  expect(parseRelationLine("mood:: [[X]]")).toBeNull();
  expect(parseRelationLine("tags:: [[X]]")).toBeNull();
});

test("rejects a non-field line", () => {
  expect(parseRelationLine("just some text")).toBeNull();
  expect(parseRelationLine("")).toBeNull();
});

// --- parseTagsLine ---

test("parses a comma tags list", () => {
  expect(parseTagsLine("tags:: career, health, family")).toEqual([
    "career",
    "health",
    "family",
  ]);
});

test("trims whitespace and drops empties", () => {
  expect(parseTagsLine("tags::  a ,, b , ")).toEqual(["a", "b"]);
});

test("rejects a tags line containing a wikilink (ambiguous → verbatim)", () => {
  expect(parseTagsLine("tags:: [[x]]")).toBeNull();
});

test("rejects an empty tags list", () => {
  expect(parseTagsLine("tags::")).toBeNull();
  expect(parseTagsLine("tags::   ")).toBeNull();
});

test("rejects a non-tags line", () => {
  expect(parseTagsLine("joy:: [[X]]")).toBeNull();
});
