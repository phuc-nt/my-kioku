// Extract [[Target]] / [[Target|display]] wikilinks from markdown text.
// Code fences and inline code are stripped first so links inside code blocks
// are ignored (they are examples, not real references).

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/** Remove fenced and inline code spans so we don't extract example links. */
function stripCode(text: string): string {
  return text.replace(FENCE_RE, "").replace(INLINE_CODE_RE, "");
}

/**
 * Normalize a wikilink target: NFC-canonicalize, take the part before `|`, trim.
 * NFC matters because the target is a GRAPH-JOIN KEY (links.target = entities.name);
 * a target pasted in decomposed form must byte-match the (NFC) entity name, or the
 * edge silently breaks. Display text (after `|`) is dropped here anyway.
 */
export function normalizeTarget(raw: string): string {
  const pipe = raw.indexOf("|");
  const target = pipe >= 0 ? raw.slice(0, pipe) : raw;
  return target.normalize("NFC").trim();
}

/**
 * Extract normalized, de-duplicated wikilink targets from text.
 * Order of first appearance is preserved.
 */
export function extractWikilinks(text: string): string[] {
  const clean = stripCode(text);
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(clean)) !== null) {
    const target = normalizeTarget(m[1] ?? "");
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}
