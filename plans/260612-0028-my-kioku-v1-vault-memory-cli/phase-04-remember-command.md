---
phase: 4
title: "Remember Command"
status: pending
priority: P1
effort: "3h"
dependencies: [2, 3]
---

# Phase 4: Remember Command

## Overview

Lệnh ghi duy nhất, 1 bước: append entry vào daily note + auto-stub entities + update index. Đây là lệnh quyết định "Haiku-friendly" của toàn sản phẩm.

## Requirements

<!-- Updated: Validation Session 1 - binary name my-kioku -->
- Functional:
  - `my-kioku remember "text" [--mood happy/4] [--time 21:30] [--date 2026-06-12]`
  - `echo "text" | my-kioku remember --stdin ...` (tránh lỗi quote tiếng Việt/ký tự đặc biệt)
  - `my-kioku remember --checkin sleep_hours=7,exercise="run 5km",mood_score=4 [--date]` — chỉ ghi frontmatter, text optional
  - Text lưu VERBATIM — CLI không sửa/trim nội dung (ngoài trailing whitespace)
- Non-functional: 1 lần gọi <100ms; agent không cần lệnh thứ hai cho bất kỳ trường hợp nào

## Architecture

Flow:

```
parse args (text từ arg hoặc stdin)
→ default date=today, time=now nếu thiếu
→ daily-note.appendEntry(date, time, mood, text)
→ wikilink-parser.extract(text) → với mỗi target chưa có file: entity-note.ensureStub(target)
→ index: indexFile(dailyNotePath) + indexFile(entityPath) cho stub mới  (incremental, không cần fullReindex)
→ output JSON: {ok, data: {date, time, entry_id, mood, links: [...], stubs_created: [...]}}
```

- `--checkin`: parse `k=v,k=v` (value có space phải quote) → `daily-note.setCheckinMeta`; known keys (sleep_hours, exercise, mood_score) vào cột riêng, key lạ vào `extra` JSON khi index
- Validate mood format `emotion/intensity`: emotion là từ tự do (gợi ý 10 từ trong SKILL.md, KHÔNG enforce), intensity 1-5 nếu có; sai format → warning trong output, vẫn lưu raw text mood vào field
- `--date` quá khứ: ghi đúng file ngày đó (backfill nhật ký) — event time mặc định = processing time chỉ khi không truyền

## Related Code Files

- Create: `src/commands/remember.ts`, `src/lib/checkin-parser.ts`
- Modify: `src/cli.ts` (route)
- Create: `tests/commands/remember.test.ts`

## Implementation Steps

1. Arg parsing: text positional XOR `--stdin` (cả hai → ưu tiên stdin + warning; không có → fail kèm hint)
2. `checkin-parser.ts`: parse k=v list, number coercion cho known keys
3. Flow chính như Architecture; stub creation + index trong cùng lần chạy
4. Output JSON đủ thông tin để agent confirm với user (links thấy được, stubs mới)
5. Edge tests: text chứa `[[link]]` trùng alias entity sẵn có (không tạo stub trùng — check cả aliases trong bảng entities), text rỗng (fail), `--checkin` không text (ok), mood thiếu intensity (ok), stdin UTF-8 tiếng Việt + emoji
6. Concurrency: 2 remember liên tiếp cùng giây → 2 section riêng, ordinal khác nhau

## Success Criteria

- [ ] 1 lệnh duy nhất hoàn thành: entry + stubs + index (kiểm tra bằng recall ngay sau đó thấy entry)
- [ ] stdin tiếng Việt có quote `"'` và xuống dòng lưu verbatim 100%
- [ ] `--checkin` ghi frontmatter không đụng body; chạy 2 lần merge đúng
- [ ] Link trỏ alias đã biết → KHÔNG tạo stub mới

## Risk Assessment

- Agent quên wikilink trong text → chấp nhận, reflect lint sẽ surface entries không link (self-healing loop)
- Shell quoting vẫn là bẫy lớn nhất với agent → SKILL.md bắt buộc dùng `--stdin` với heredoc; test pattern này như chính agent sẽ gọi
