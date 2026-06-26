#!/usr/bin/env bash
#
# verify.sh — Fail if any upstream identity marker remains.
#
# Run after strip.sh, or as a CI gate after an upstream sync. Exits non-zero
# and lists offending files if any marker is found, so a bad sync cannot be
# committed or published.
#
# The `ck:` check uses the SAME boundary-safe pattern as strip.sh:
# `(?<![a-zA-Z])ck:` — so it does not false-positive on check:/block:/etc.
#
# Two paths are excluded by design: metadata.json (its `deletions` array
# intentionally lists legacy ck-paths/.ck entries for --upgrade cleanup) and
# skills/strip-identity/ (this skill documents the markers as examples).
#
# Usage:
#   bash verify.sh [TARGET_DIR]    # default: ./claude
#
# Exit codes:
#   0  clean — zero markers
#   1  markers found (details printed) / perl missing / dir not found

set -uo pipefail

TARGET_DIR="${1:-claude}"

if ! command -v perl >/dev/null 2>&1; then
  echo "ERROR: perl is required" >&2
  exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "ERROR: target directory not found: $TARGET_DIR" >&2
  exit 1
fi

FAIL=0

report() {
  local label="$1"; shift
  local matches="$1"
  if [[ -n "$matches" ]]; then
    echo "✗ $label — found in:"
    echo "$matches" | sed 's/^/    /'
    FAIL=1
  else
    echo "✓ $label — clean"
  fi
}

# Scan via perl, NOT `grep -P`. macOS/BSD grep has no -P (PCRE) support, so
# `grep -rIlP '(?<!...)'` fails silently there and the script would wrongly
# report "clean". perl is already a hard dependency (see strip.sh) and its
# regex engine is identical across platforms — the only portable choice for
# the lookbehind. metadata.json is skipped (its deletions array intentionally
# lists legacy ck-paths/.ck paths for --upgrade cleanup).
#
# Args: <perl-regex> ; prints newline-separated matching file paths.
scan() {
  local pattern="$1"
  find "$TARGET_DIR" -type f \
    \( -name '*.md' -o -name '*.json' -o -name '*.js' -o -name '*.cjs' \
       -o -name '*.mjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.py' \
       -o -name '*.sh' -o -name '*.bash' -o -name '*.zsh' -o -name '*.yaml' \
       -o -name '*.yml' -o -name '*.toml' -o -name '*.html' -o -name '*.css' \
       -o -name '*.txt' -o -name '*.example' -o -name '*.template' \) \
    ! -path "$TARGET_DIR/metadata.json" \
    ! -path '*/skills/strip-identity/*' \
    -exec perl -ne 'BEGIN{$p=shift @ARGV} if(/$p/){print "$ARGV\n";close ARGV}' \
      "$pattern" {} + 2>/dev/null | sort -u || true
}

# Plain project/author/domain markers (case-insensitive).
PLAIN=$(scan '(?i:claudekit|goonnguyen|mrgoonie|\bgoonie\b|udit goenka|claudekit\.cc|github\.com/claudekit|\bck-config\b|\bck-paths\b)')
report "project/author/domain markers" "$PLAIN"

# Config filename refs — kit ships .mk.json / .mkignore.
CFG=$(scan '\.ck\.json|\.ckignore')
report ".ck.json / .ckignore references" "$CFG"

# The ck: slash-command prefix — boundary-safe lookbehind.
CKPREFIX=$(scan '(?<![a-zA-Z])ck:')
report "ck: slash-command prefix" "$CKPREFIX"

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "RESULT: clean — no identity markers remain."
  exit 0
else
  echo "RESULT: identity markers remain. Run strip.sh, then re-verify."
  exit 1
fi
