// Jaro-Winkler string similarity for surfacing likely entity aliases/duplicates
// (e.g. "Hùng" vs "bạn Hùng", "Phúc" vs "phuc-nt"). Compares diacritic-folded
// forms so accented/unaccented variants pair up. Self-contained (~no deps).

import { fold } from "../lib/diacritics.ts";

/** Jaro similarity in [0,1]. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchDist = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatched = new Array<boolean>(la).fill(false);
  const bMatched = new Array<boolean>(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Count transpositions.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (
    (matches / la + matches / lb + (matches - transpositions) / matches) / 3
  );
}

/** Jaro-Winkler: boosts strings sharing a common prefix (up to 4 chars). */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

export interface AliasCandidate {
  a: string;
  b: string;
  similarity: number;
  hint: string;
}

/**
 * Token-containment: one folded name's tokens are a subset of the other's
 * (e.g. "bạn Hùng" ⊇ "Hùng"). Jaro-Winkler alone misses honorific/prefix cases
 * because the length gap tanks the score, yet these are common aliases.
 */
function tokenContains(a: string, b: string): boolean {
  const ta = new Set(fold(a).split(/\s+/).filter(Boolean));
  const tb = new Set(fold(b).split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0 || ta.size === tb.size) return false;
  const [small, big] = ta.size < tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * Pairwise compare entity names (folded) and return pairs above `threshold` OR
 * where one name's tokens contain the other's. O(n^2) — fine to ~1000 entities.
 */
export function findAliasCandidates(
  names: string[],
  threshold = 0.85,
): AliasCandidate[] {
  const out: AliasCandidate[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const sim = jaroWinkler(fold(a), fold(b));
      const contained = tokenContains(a, b);
      if (sim >= threshold || contained) {
        out.push({
          a,
          b,
          // Containment matches get a high reported similarity so they sort up.
          similarity: contained ? Math.max(0.9, Math.round(sim * 1000) / 1000) : Math.round(sim * 1000) / 1000,
          hint: contained
            ? "One name contains the other (honorific/prefix?) — likely same entity."
            : "Possible same entity — review and `entity merge` if so.",
        });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
