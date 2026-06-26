#!/usr/bin/env bash
# Claude Code SessionStart hook: inject a compact memory digest as additionalContext.
# Thin wrapper around `my-kioku recall --digest`. Prints ONLY a successful digest;
# on any error (missing binary/vault) it prints nothing and never blocks the session.
#
# Requires: my-kioku on PATH (or set MY_KIOKU_BIN), and MY_KIOKU_VAULT exported
# (or a ~/.my-kioku/config.json with the vault path).

set -euo pipefail

BIN="${MY_KIOKU_BIN:-my-kioku}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  exit 0
fi

# Capture output; recall writes its {ok:false,...} envelope to STDOUT on error, so
# only forward the result when it is a success envelope (avoids leaking an error
# object into every new session's context).
out="$("$BIN" recall --digest --since 7d 2>/dev/null)" || exit 0
case "$out" in
  *'"ok":true'*) printf '%s\n' "$out" ;;
esac
