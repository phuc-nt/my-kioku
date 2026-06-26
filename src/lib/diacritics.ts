// Diacritic folding for case/accent-insensitive matching (entity names, aliases).
// Matches the FTS tokenizer's `remove_diacritics 2` behavior at the app layer so
// "Hung" can match "Hùng" in entity expansion. Also folds Vietnamese đ/Đ, which
// NFD normalization does not decompose.

/** Lowercase + strip combining marks + fold đ→d. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
