#!/usr/bin/env bash
#
# strip.sh — Remove upstream identity markers from kit content.
#
# Substitutes every upstream identity marker (project names, authors, domains,
# the `ck:` slash-command prefix, and `.ck*` config filenames) with the
# my-agent-kit equivalents.
#
# WHY a dedicated script: the v2.0.0 sync did this by hand with `sed` + `\b`
# word boundaries. BSD/macOS `sed` does not honor `\b` consistently, so the
# `ck:<skill>` pattern silently slipped through — 246 files shipped with
# `/ck:cook` instead of `/mk:cook` (fixed in v2.0.1). This script encodes the
# boundary-safe pattern that was verified correct, so the bug cannot recur.
#
# THE ck: PATTERN: a naive `s/ck:/mk:/g` corrupts `check:`, `block:`,
# `track:`, `feedback:`, `stack:`, `lock:`. The safe rule is: replace `ck:`
# only when it is NOT preceded by an ASCII letter — `(?<![a-zA-Z])ck:`.
# That matches `/ck:fix`, `ck:cook`, `"ck:test"` but never the inside of a
# longer word. Perl is required (BSD sed has no lookbehind).
#
# Usage:
#   bash strip.sh [TARGET_DIR]    # default: ./claude
#
# Exit codes:
#   0  substitutions applied (run verify.sh afterwards to confirm zero remain)
#   1  target dir not found / perl missing

set -euo pipefail

TARGET_DIR="${1:-claude}"

if ! command -v perl >/dev/null 2>&1; then
  echo "ERROR: perl is required (BSD sed lacks lookbehind support)" >&2
  exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "ERROR: target directory not found: $TARGET_DIR" >&2
  exit 1
fi

echo "Stripping identity markers in: $TARGET_DIR"

# Only touch text-like files. Two paths are excluded by design:
#   - metadata.json: its deletions array intentionally retains legacy paths
#     (e.g. hooks/lib/ck-paths.cjs) so `mk-init.sh --upgrade` deletes them
#     from old installs.
#   - skills/strip-identity/: this skill documents the markers as examples;
#     rewriting them would corrupt its own docs/scripts.
FILES=$(grep -rIl . "$TARGET_DIR" 2>/dev/null \
  --include='*.md' --include='*.json' --include='*.js' --include='*.cjs' \
  --include='*.mjs' --include='*.ts' --include='*.tsx' --include='*.py' \
  --include='*.sh' --include='*.bash' --include='*.zsh' --include='*.yaml' \
  --include='*.yml' --include='*.toml' --include='*.html' --include='*.css' \
  --include='*.txt' --include='*.example' --include='*.template' \
  | grep -v "$TARGET_DIR/metadata.json" \
  | grep -v "/skills/strip-identity/" || true)

if [[ -z "$FILES" ]]; then
  echo "No matching files found."
  exit 0
fi

COUNT=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue

  # ORDER MATTERS: longest project names first, then the bare `claudekit`,
  # otherwise `claudekit` consumes the `-engineer`/`-cli` suffix prematurely.
  perl -i -pe '
    s/claudekit-engineer/my-agent-kit/g;
    s/claudekit-marketing/my-marketing-kit/g;
    s/claudekit-cli/my-kit-cli/g;
    s/claudekit-docs/my-kit-docs/g;

    # Domains before the bare name (they contain "claudekit").
    s/docs\.claudekit\.cc/docs.my-kit.local/g;
    s/claudekit\.cc/my-kit.local/g;
    s{https?://github\.com/claudekit[A-Za-z0-9._/-]*}{}g;
    s{github\.com/claudekit[A-Za-z0-9._/-]*}{}g;

    # Case-specific project name variants.
    s/CLAUDEKIT/MYKIT/g;
    s/ClaudeKit/MyKit/g;
    s/claudekit/my-kit/g;

    # Authors / attribution.
    s/\@goonnguyen/personal/g;
    s/mrgoonie/personal/g;
    s/\bgoonie\b/personal/g;
    s/Udit Goenka/original author/g;

    # Config filenames — kit ships .mk.json / .mkignore, not .ck*.
    s/\.ckignore/.mkignore/g;
    s/\.ck\.json/.mk.json/g;
    s/\bck-config\b/mk-config/g;
    s/\bck-paths\b/mk-paths/g;

    # THE FIX: ck: slash-command prefix, boundary-safe.
    # Negative lookbehind on [a-zA-Z] keeps check:/block:/track:/feedback:
    # intact while still rewriting /ck:cook, ck:docs-seeker, "ck:test".
    s/(?<![a-zA-Z])ck:/mk:/g;
  ' "$f"

  COUNT=$((COUNT + 1))
done <<< "$FILES"

echo "Processed $COUNT files."
echo "Run verify.sh to confirm zero markers remain."
