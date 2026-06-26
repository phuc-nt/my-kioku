---
phase: 7
title: "Utilities"
status: pending
priority: P2
effort: "4h"
dependencies: [2, 3]
---

# Phase 7: Utilities

## Overview

<!-- Updated: Validation Session 1 - import source = markdown folder (~177 memories), KHÔNG phải SQLite DB; binary my-kioku -->
Ba utility hoàn thiện vòng đời: `import --from-kioku-lite` (migration ~177 memories openclaw từ markdown folder), `entity merge` (việc duy nhất agent không nên sửa tay), `watch` (polling wrapper quanh lazy sync).

## Requirements

- Functional:
  - `my-kioku import --from-kioku-lite ~/.kioku-lite/users/X/memory/ [--dry-run]` — nguồn là FOLDER markdown, không phải DB
  - `my-kioku entity merge "bạn Hùng" --into "Hùng" [--dry-run]`
  - `my-kioku watch [--interval 30]`
- Non-functional: import idempotent (chạy lại không nhân đôi); merge an toàn tuyệt đối (dry-run mặc định in diff)

## Architecture

**Import** (`src/commands/import-kioku-lite.ts`):

Format nguồn (verified với data thật `~/.kioku-lite/users/companion/memory/`, 4 files / 177 blocks):

```markdown
# Kioku Lite — 2026-03-03

---
time: "2026-03-03T20:41:11.258053+07:00"
mood: "neutral"
event_time: "2022-08-25"        # optional
---
<text verbatim, multi-line>

---
time: ...
---
<block tiếp theo>
```

Flow:

```
scan folder *.md → mỗi file: bỏ heading "# Kioku Lite — ...",
   split theo block "---\n<yaml>\n---\n<text>" (YAML mini: time, mood, event_time?)
→ mỗi block = 1 entry: date = event_time ?? date(time); time HH:MM = từ field time
   (event_time chỉ có ngày → time của entry vẫn lấy từ time gốc, là processing time)
→ mood gốc là 1 từ không intensity ("neutral", "excited") → ghi "mood:: <word>" (không /intensity)
→ text giữ VERBATIM, KHÔNG có wikilinks ban đầu (chấp nhận — quyết định validation:
   bỏ import kg_nodes/kg_aliases/kg_edges; KG mới sẽ do agent bồi đắp dần qua reflect lint)
→ idempotency: hash(text block chuẩn hoá) → entry_id vào .kioku/import-log.json; hash đã import thì skip
→ fullReindex + report stats {files, blocks, entries_created, skipped}
```

**Entity merge** (`src/commands/entity-merge.ts`):

```
validate cả 2 tồn tại → dry-run: liệt kê files sẽ sửa + số link rewrite
→ apply: rewrite [[B]] và [[B|x]] → [[A]] / [[A|x]] trong journal/ + insights/ + entities/*.md (Facts)
→ gộp aliases B (+ tên B) vào frontmatter A; nối body Facts của B vào A (dưới heading "## Facts (merged from B)")
→ xoá file B → reindex các file đụng tới
```

**Watch** (`src/commands/watch.ts`): vòng lặp `syncIfStale` mỗi N giây, log JSON-lines khi có thay đổi. ~40 LOC, không daemon hoá (chạy foreground, user/launchd tự quản).

## Related Code Files

- Create: `src/commands/import-kioku-lite.ts`, `src/commands/entity-merge.ts`, `src/commands/watch.ts`, `src/lib/link-rewriter.ts`
- Modify: `src/cli.ts`
- Create: `tests/commands/import.test.ts`, `tests/commands/entity-merge.test.ts`

## Implementation Steps

1. `link-rewriter.ts`: rewrite wikilink targets trong 1 file, bỏ qua code fence; dùng chung cho merge
2. Import: dựng fixture markdown mini mô phỏng format kioku-lite (2 files, ~5 blocks: có/không event_time, multi-line, tiếng Việt có dấu, URL trong text)
3. Import flow + `--dry-run` (in preview entries, không ghi)
4. Idempotency test: chạy import 2 lần → vault identical
5. Merge: dry-run mặc định khi không có `--yes`? KHÔNG — `--dry-run` opt-in nhưng output luôn kèm full diff summary; agent có thói quen dry-run qua SKILL.md
6. Merge tests: alias form `[[B|bạn ấy]]`, B xuất hiện trong Facts của entity khác, merge rồi recall thấy entries cũ qua tên A
7. Watch: test thủ công (sửa file → log xuất hiện)

## Success Criteria

- [ ] Import fixture → daily notes đúng ngày (event_time ưu tiên, fallback date của time), mood giữ nguyên word, text verbatim 100%
- [ ] Import chạy 2 lần không nhân đôi
- [ ] Merge xong: grep `[[B]]` toàn vault = 0; recall --entity A trả cả entries cũ của B
- [ ] Watch bắt thay đổi tay trong ≤ interval giây

## Risk Assessment

- Format markdown thật có thể lệch fixture (block không có `---` đóng, YAML lạ) → parser khoan dung: block parse fail thì log warning + skip, không crash; validate bằng folder thật ở Phase 8
- Entries import KHÔNG có wikilinks → reflect lint sẽ báo `entries_without_links` hàng loạt ngay sau import → chấp nhận theo quyết định validation; SKILL.md hướng dẫn agent cron bồi đắp dần (ưu tiên entries được recall nhiều), KHÔNG bắt fix một lần
- Mood gốc kioku-lite là từ tiếng Anh không intensity → giữ nguyên (mood vocab tự do by design), không map/translate
- Merge nhầm 2 người trùng tên → dry-run + agent xác nhận với user trước (quy định trong SKILL.md)
