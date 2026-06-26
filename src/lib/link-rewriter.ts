// Rewrite wikilink targets within a markdown string, skipping fenced code blocks.
// Shared by `entity merge` (rename [[B]] → [[A]], preserving any |display alias).

const FENCE_RE = /```[\s\S]*?```/g;

/**
 * Replace every [[from]] / [[from|display]] with [[to]] / [[to|display]].
 * Matching is exact on the (trimmed) target; the display part is preserved.
 * Code fences are left untouched. Returns {text, count}.
 *
 * Implementation: walk the string, copying fenced spans through verbatim and
 * only rewriting links in the gaps between fences. Avoids placeholder collisions.
 */
export function rewriteWikilinks(
  input: string,
  from: string,
  to: string,
): { text: string; count: number } {
  let count = 0;

  const rewriteSpan = (s: string): string =>
    s.replace(/\[\[([^\[\]]+?)\]\]/g, (whole, inner: string) => {
      const pipe = inner.indexOf("|");
      const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      if (target !== from) return whole;
      count++;
      const display = pipe >= 0 ? inner.slice(pipe) : ""; // includes leading "|"
      return `[[${to}${display}]]`;
    });

  let out = "";
  let lastIndex = 0;
  for (const m of input.matchAll(FENCE_RE)) {
    const start = m.index ?? 0;
    out += rewriteSpan(input.slice(lastIndex, start)); // gap before this fence
    out += m[0]; // the fence itself, untouched
    lastIndex = start + m[0].length;
  }
  out += rewriteSpan(input.slice(lastIndex)); // trailing gap

  return { text: out, count };
}
