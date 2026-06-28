// Diacritic folding for case/accent-insensitive matching (entity names, aliases).
// Matches the FTS tokenizer's `remove_diacritics 2` behavior at the app layer so
// "Hung" can match "Hùng" in entity expansion. Also folds Vietnamese đ/Đ, which
// NFD normalization does not decompose.
//
// NFC is applied FIRST so any input form (composed, decomposed, or mixed/half-
// composed from different sources — Telegram, macOS paste, other keyboards) collapses
// to one canonical shape before NFD splits the marks deterministically. For text that
// is already NFC (today's vault), NFC→NFD is a no-op, so this is free now and a guard
// for future input. fold() output is only used by the disposable index/query layer —
// never written to markdown — so the verbatim contract is unaffected.

/** Canonicalize (NFC) then lowercase + strip combining marks + fold đ→d. */
export function fold(s: string): string {
  return s
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
