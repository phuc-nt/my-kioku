---
phase: 2
title: "Vault Core"
status: completed
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Vault Core

## Overview

Layer đọc/ghi markdown — trái tim của "vault là database": daily note append/parse, frontmatter YAML, entry sections, wikilink parser, entity stub.

## Requirements

- Functional: append entry vào daily note không phá nội dung sẵn có (kể cả user sửa tay); parse ngược lại được mọi entry; tạo/đọc entity note
- Non-functional: mỗi module <200 LOC, không phụ thuộc index layer (vault core phải dùng được standalone)

## Architecture

Conventions (hợp đồng dữ liệu của toàn hệ thống):

```markdown
journal/2026/06/2026-06-12.md
---
sleep_hours: 7        # optional, từ --checkin
exercise: run 5km
mood_score: 4
---
# 2026-06-12

## 21:30
mood:: happy/4
Ăn tối với [[Hùng]] ở [[Quảng An (quán)]]. <verbatim>

entities/Hùng.md
---
type: person          # person|place|event|activity|thing|unknown
aliases: []
created: 2026-06-12
---
# Hùng

## Facts
<reflect/agent bồi đắp>
```

- `src/vault/vault-paths.ts`: `dailyNotePath(date)`, `entityPath(name)`, `insightPath(slug)`; sanitize tên file (bỏ ký tự cấm `/:*?"<>|`, giữ Unicode tiếng Việt)
- `src/vault/frontmatter.ts`: parse/serialize block `---` đầu file bằng `yaml`; trả `{meta, body}`; round-trip không mất comment thì tốt nhưng KHÔNG bắt buộc (KISS)
- `src/vault/entry-parser.ts`: split body theo heading `## HH:MM`; parse `mood:: emotion/intensity` (dòng đầu entry, optional); trả `{time, mood?, intensity?, text}`
- `src/vault/wikilink-parser.ts`: extract `[[Target]]` và `[[Target|display]]` → list target chuẩn hoá (trim)
- `src/vault/daily-note.ts`: `appendEntry(date, time, mood, text)` — tạo file+folder nếu thiếu (kèm heading `# date`), append section cuối file; `setCheckinMeta(date, fields)` — merge vào frontmatter, không đụng body; `readDaily(date)` → entries[]
- `src/vault/entity-note.ts`: `ensureStub(name)` — tạo nếu chưa có (type: unknown); `readEntity(name)`, `updateMeta(name, patch)`

## Related Code Files

- Create: `src/vault/vault-paths.ts`, `src/vault/frontmatter.ts`, `src/vault/entry-parser.ts`, `src/vault/wikilink-parser.ts`, `src/vault/daily-note.ts`, `src/vault/entity-note.ts`
- Create: `tests/vault/*.test.ts` (1 file test/module)

## Implementation Steps

1. `vault-paths.ts` + test sanitize (tên có dấu, có `/`, có emoji)
2. `frontmatter.ts` + test: file không frontmatter, frontmatter rỗng, YAML lỗi → trả meta {} + cảnh báo, không crash
3. `wikilink-parser.ts` + test: alias form, nested brackets, link trong code fence (bỏ qua — đơn giản: regex bỏ code fence trước)
4. `entry-parser.ts` + test: entry không mood, nhiều entry cùng giờ (cho phép — heading trùng vẫn parse theo thứ tự), text nhiều dòng có heading cấp 3
5. `daily-note.ts`: append phải đảm bảo `\n\n` ngăn cách; file đang mở trong Obsidian vẫn an toàn (atomic write: ghi temp rồi rename KHÔNG dùng được cho append → dùng `appendFileSync` đơn giản, chấp nhận)
6. `entity-note.ts` + test idempotent ensureStub
7. Round-trip test: appendEntry × 3 → readDaily → khớp 100% (verbatim, mood, links)

## Success Criteria

- [ ] Round-trip test pass với tiếng Việt có dấu, emoji, multi-line
- [ ] User sửa tay daily note (thêm text giữa entries) → readDaily vẫn parse đúng các section
- [ ] ensureStub chạy 2 lần không ghi đè nội dung Facts
- [ ] Mở vault mẫu bằng Obsidian: wikilinks resolve, không file lỗi

## Risk Assessment

- Heading `## HH:MM` trùng giờ → parse theo vị trí, id entry = `date+ordinal` (quyết định ở Phase 3)
- User đổi format tay (xoá heading) → entry-parser bỏ qua text ngoài section, reflect lint sẽ báo
