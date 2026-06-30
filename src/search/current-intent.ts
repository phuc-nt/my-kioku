// Detect a deterministic "current/now" intent in a recall query — the signal that the
// user wants the LATEST fact (so a superseded entry should rank below its replacement).
// NOT general NLP: a frozen, folded keyword set, exact-token match. Without a keyword,
// recall keeps its default behavior (superseded is only a tiebreak), so there is no
// regression for history queries like "công việc cũ".

import { fold } from "../lib/diacritics.ts";

// Frozen set of current-intent markers (folded). VI + EN. Kept small + literal on
// purpose — fuzzy matching would misfire and demote facts the user actually wants.
const CURRENT_INTENT = new Set([
  "hien tai", // hiện tại
  "bay gio", // bây giờ
  "hien nay", // hiện nay
  "now",
  "currently",
  "current",
]);
// Single-token markers checked per-token (multi-word ones checked as substrings of the
// folded query below).
const CURRENT_TOKENS = new Set(["dang", "now", "currently", "current"]); // đang / now / ...

/** True when the query carries a current/now intent marker. */
export function detectCurrentIntent(query: string | undefined): boolean {
  if (!query) return false;
  const folded = fold(query);
  // Multi-word markers: substring match on the folded query.
  for (const m of CURRENT_INTENT) if (folded.includes(m)) return true;
  // Single-word markers: exact token match (avoid "dang" matching inside "dang ky" etc.
  // is acceptable — "đang" as a standalone aspect marker is the current-intent signal).
  const tokens = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.some((t) => CURRENT_TOKENS.has(t));
}
