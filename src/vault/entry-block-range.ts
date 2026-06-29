// The ONE place the daily-note entry-heading rule lives. Both `parseEntries`
// (entry-parser.ts) and `forget` (commands/forget.ts) consume this so the rule
// for "where does an entry block start/end" cannot drift between reading entries
// and deleting/redacting them byte-accurately.
//
// Verbatim safety: a `## HH:MM` line opens a block ONLY when preceded by a blank
// line (or starts the body) — appendEntry always emits the heading after a blank
// line, so entry PROSE containing a heading-shaped line (a pasted "## 10:00") is
// NOT a boundary and stays inside the entry text.

/** A `## HH:MM` heading on its own line. */
export const HEADING_RE = /^##\s+(\d{1,2}:\d{2})\s*$/;

export interface EntryRange {
  time: string; // "HH:MM" from the heading
  ordinal: number; // 0-based position among all entries
  headingLine: number; // index of the `## HH:MM` line
  startLine: number; // first content line after the heading (== headingLine + 1)
  endLine: number; // index of the LAST line belonging to this block (inclusive)
}

/**
 * Split a daily-note body (frontmatter already removed) into entry blocks with
 * their line ranges. `lines` is the body split on "\n" (caller normalizes CRLF).
 *
 * Block boundary rule (must match how appendEntry writes): a heading-shaped line
 * starts a block only when `prevBlank` (start-of-body counts as blank). A block
 * runs from its heading through the line before the NEXT block's heading; the
 * single blank line that precedes the next heading belongs to THIS block's end
 * (appendEntry writes "\n## time\n…", so the blank separator trails the prior
 * entry). The final block runs to the last line.
 */
export function entryRanges(lines: string[]): EntryRange[] {
  const heads: { time: string; line: number }[] = [];
  let prevBlank = true; // start-of-body counts as "preceded by blank"
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING_RE.exec(lines[i]!);
    if (h && prevBlank) heads.push({ time: h[1] ?? "", line: i });
    prevBlank = lines[i]!.trim() === "";
  }

  const ranges: EntryRange[] = [];
  for (let k = 0; k < heads.length; k++) {
    const headingLine = heads[k]!.line;
    // This block ends at the line before the next heading; that next heading is
    // preceded by a blank line which is part of THIS block (the trailing
    // separator). The last block ends at the final line of the body.
    const endLine =
      k + 1 < heads.length ? heads[k + 1]!.line - 1 : lines.length - 1;
    ranges.push({
      time: heads[k]!.time,
      ordinal: k,
      headingLine,
      startLine: headingLine + 1,
      endLine,
    });
  }
  return ranges;
}
