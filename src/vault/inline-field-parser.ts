// Strict matchers for the inline leading-field zone of an entry (the lines right
// after `## HH:MM` and before the verbatim body): mood / relations / tags.
// "Strict" is the whole safety story — a line is only consumed as a field when it
// matches the exact shape, so free prose that merely starts with a word + `::`
// (e.g. "with:: my friend Hùng came over") stays VERBATIM in the body.

import { extractWikilinks } from "./wikilink-parser.ts";

// Verbs that are NOT relations (they have their own typed handling).
const RESERVED_VERBS = new Set(["mood", "tags"]);

const VERB_PREFIX = /^([\p{L}\p{N}_-]+)::\s*(.*)$/u;

export interface RelationLine {
  verb: string; // lowercased, e.g. "joy" | "trigger" | "with" | "eases" | <free verb>
  targets: string[]; // normalized, de-duped wikilink targets
}

/**
 * Parse a relation line `<verb>:: [[a]], [[b]]`. Returns null unless:
 *   - the verb is a non-reserved word, AND
 *   - the value contains ≥1 wikilink, AND
 *   - the value is ONLY wikilinks + commas/whitespace (no stray prose).
 * This rejects `with:: my friend Hùng` (prose) but accepts `with:: [[Hùng]]`.
 */
export function parseRelationLine(line: string): RelationLine | null {
  // NFC first: VERB_PREFIX uses \p{L}, and an NFD combining mark is not a letter,
  // so a decomposed VI verb ("nhớ" as n+h+ớ→o+◌̛+◌̉) would stop the verb capture
  // before `::` and silently drop the relation. Canonicalizing recombines it.
  const m = VERB_PREFIX.exec(line.normalize("NFC").trim());
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  const value = m[2]!;
  if (RESERVED_VERBS.has(verb)) return null;

  const targets = extractWikilinks(value);
  if (targets.length === 0) return null;

  // The value must reduce to empty once wikilinks + separators are removed.
  const residue = value
    .replace(/\[\[[^\[\]]+?\]\]/g, "")
    .replace(/[,\s]+/g, "")
    .trim();
  if (residue !== "") return null;

  return { verb, targets };
}

// An inline `#hashtag` in the entry body. Unlike `tags::` (a leading field that is
// consumed/removed), a hashtag lives INSIDE the prose and MUST stay verbatim (S1) —
// we only DERIVE a tag row from it. Grammar: `#` then a Unicode LETTER, then letters/
// digits/underscore (so `#thể_dục`/`#chạy_bộ` work but `#123` doesn't). The lookbehind
// rejects `C#`, `a#b`, `##` (markdown heading), `/#frag` (URL) — `#` must not follow a
// letter/digit/_/#// (so it's a standalone hashtag, not part of a word/heading/URL).
const INLINE_HASHTAG = /(?<![\p{L}\p{N}_#/])#(\p{L}[\p{L}\p{N}_]*)/gu;

/**
 * Extract inline `#hashtag` tokens from an entry body as tag strings (without the `#`).
 * Read-only — never modifies the text. Deduped, order-preserved. NFC so a composed/
 * decomposed Vietnamese tag yields one key.
 */
export function extractInlineHashtags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.normalize("NFC").matchAll(INLINE_HASHTAG)) {
    const tag = m[1]!;
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Parse a `tags:: a, b, c` line into plain string tags. Returns null unless the
 * line is exactly `tags::` + a non-empty comma list with NO wikilinks (a
 * `tags:: [[x]]` line is ambiguous → not a tags line, falls through to verbatim).
 */
export function parseTagsLine(line: string): string[] | null {
  // NFC so the same tag in composed/decomposed form stores as one string (the tags
  // table keys on the raw value; cross-form would create duplicates).
  const trimmed = line.normalize("NFC").trim();
  if (!trimmed.startsWith("tags::")) return null;
  const value = trimmed.slice("tags::".length);
  if (value.includes("[[")) return null;
  const tags = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tags.length > 0 ? tags : null;
}
