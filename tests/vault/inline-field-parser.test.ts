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

test("parses a Vietnamese-diacritic verb in decomposed (NFD) form", () => {
  // "nhớ" in NFD has a combining mark that is not \p{L}; without NFC the verb
  // capture would stop early and the relation would be silently dropped.
  const line = "nhớ:: [[Mẹ]]".normalize("NFD");
  expect(parseRelationLine(line)).toEqual({ verb: "nhớ", targets: ["Mẹ"] });
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

test("canonicalizes tag values to NFC (composed == decomposed)", () => {
  const nfc = parseTagsLine("tags:: sức khỏe");
  const nfd = parseTagsLine("tags:: sức khỏe".normalize("NFD"));
  expect(nfd).toEqual(nfc);
  expect(nfd?.[0]).toBe("sức khỏe".normalize("NFC"));
});
