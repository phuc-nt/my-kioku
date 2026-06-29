# Privacy `forget` Implementation: Redact Boundary Bug Caught in Review

**Date**: 2026-06-29 11:58  
**Severity**: High  
**Component**: Privacy gate / entry deletion / markdown reindex (S1+S2)  
**Status**: Resolved  

## What Happened

Shipped the `forget` command suite (commit e15bf07, not yet pushed) with three operations:
- `forget <id>` — delete one entry block by heading id
- `forget --entity "X"` — delete all entries linking a person/place (NFC fold-match on links.target)
- `--redact` — blank body to `[redacted DATE]` while preserving heading, mood, relations, tags

All 258 green tests. Code review caught a critical **boundary bug** in `--redact` of non-last entries that violated S1+S2 (markdown is source of truth).

## The Brutal Truth

This was a testing blindspot that should have been caught locally. Testing only the last/only entry hid the fact that redacting a middle entry mangled the file structure. The next heading lost its blank-line separator and got parsed into the redacted entry's body on reindex. Silent data loss. Shipping this would have corrupted user diaries.

The code reviewer re-ran the CLI end-to-end (not just reading the code) and found it immediately. That adversarial test caught what my unit test suite missed.

## Technical Details

**Bug**: `--redact` of a non-last entry replaced the block's trailing blank separator with the tombstone line. On reindex, the next entry lost its blank-line prefix, so the parser treated its heading as part of the preceding body text instead of a boundary.

**Failure chain**:
```
## 10:30        ## 11:00 [originally separate entries]
[body1]         [body2]

After redact on entry 1:
## 10:30
[redacted ...]  ← trailing blank erased, replaced by tombstone
## 11:00        ← now looks like a body line to parser
[body2]

Reindex → "## 11:00" absorbed into entry 1, entry 2 lost
```

Last-entry redact also dropped the file's EOF newline.

**Fix**: Count the block's trailing blank lines and re-emit them after the tombstone. Added two regression tests:
- Redact non-last entry, verify next entry still parses independently
- `--entity --redact` on multi-target entries, verify all redacted blocks preserve separators

## What We Tried

1. **Initial fix attempt**: Just prepend tombstone, assume existing logic handles blanks → failed, same swallow bug
2. **Correct fix**: Preserve trailing blank count, re-emit after tombstone → verified in 260 passing tests

## Root Cause Analysis

Test coverage was incomplete. A "delete/edit" feature's tests **must** cover editing a non-terminal element. Testing only last/only cases creates a false sense of correctness for boundary logic. The markdown reindex relies on exact separator preservation — blank-line boundaries are not optional.

The lack of adversarial end-to-end testing (actually running the CLI, not simulating) meant the bug stayed hidden until code review.

## Lessons Learned

1. **Boundary-sensitive operations need adversarial test design**: Any edit/delete feature editing structured text must test non-terminal operations. Last-element tests are insufficient.

2. **Markdown is not forgiving**: S1+S2 (markdown as source of truth) means we can't hide bugs in DB abstractions. A separator misalignment silently corrupts structure.

3. **Code review as adversarial execution matters**: The reviewer's decision to actually run the CLI (not just read the code) caught a subtle failure that static analysis and unit tests missed.

## Next Steps

- **Merge after review approval**: Code reviewer re-verified both original failure scenarios + 3 edge cases (no-leading-fields redact, idempotent re-redaction, EOF handling)
- **Document the invariant**: Non-terminal boundary preservation in redact/delete is non-negotiable; documented in code
- **Carry-over DRY note** (non-blocking): `extractLeadingFieldCount` and `extractLeadingFields` both dispatch on field type — they must stay in sync. Documented as a must-mirror invariant; refactoring deferred (YAGNI)
- **Continue active phases**: concept-bridge (reflect/[[concept]] links), superseded-fact (SCHEMA 6→7), digest body. Vector deferred.

## Unresolved

- `extractLeadingFieldCount` duplicates field-dispatch logic in `extractLeadingFields`. Currently an invariant-to-mirror; future refactor may extract a shared dispatch table (low priority, post-ship).
