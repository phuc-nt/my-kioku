---
phase: 5
title: "Recall Command"
status: pending
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 5: Recall Command

## Overview

Lệnh đọc duy nhất: FTS5 BM25 + entity-aware expansion (thay thế graph traversal của kioku cũ) + time filter + `--digest` cho SessionStart hook.

## Requirements

<!-- Updated: Validation Session 1 - binary name my-kioku -->
- Functional:
  - `my-kioku recall "query" [--from 2026-06-01] [--to ...] [--since 7d] [--limit 10]`
  - `my-kioku recall --entity "Hùng" [--since 30d]` — mọi entry backlink tới entity (khớp name HOẶC aliases)
  - `my-kioku recall --digest` — summary compact cho hook (<500 tokens)
  - Query + entity kết hợp được
- Non-functional: <200ms gồm lazy sync; output JSON ổn định schema cho agent

## Architecture

Scoring 2 nguồn, hợp nhất đơn giản (KHÔNG RRF phức tạp — chỉ 2 list):

```
1. FTS: SELECT ... FROM entries_fts WHERE entries_fts MATCH ? ORDER BY bm25(entries_fts) LIMIT 20
   - Query sanitize: escape FTS operators (", *, ^, dấu phẩy — bài học openclaw pain #9)
2. Entity expansion: tokens của query khớp entities.name/aliases (case-insensitive, bỏ dấu)
   → entries có link tới entity đó, ORDER BY date DESC LIMIT 20
3. Merge: dedupe theo entry_id; score = normalized_bm25 + 0.3 nếu cũng là entity hit + recency tiebreak
4. Hydrate: trả body verbatim + date/time/mood + links + entity_context
   (entity_context: với mỗi entity match — name, type, aliases, total_mentions)
```

`--digest` (deterministic, không LLM):

```json
{
  "period": "7d",
  "mood_summary": {"happy": 4, "tired": 2, "avg_intensity": 3.4},
  "checkin": {"days_logged": 5, "avg_sleep": 6.9},
  "active_entities": [{"name": "Hùng", "mentions": 3}, ...top 5],
  "recent_entries": [{"date", "time", "mood", "first_line"} ...5]
}
```

## Related Code Files

- Create: `src/commands/recall.ts`, `src/search/fts-search.ts`, `src/search/entity-expansion.ts`, `src/search/digest.ts`
- Modify: `src/cli.ts`
- Create: `tests/search/*.test.ts`

## Implementation Steps

1. `fts-search.ts`: query sanitizer (escape/strip FTS5 special chars) + BM25 query; test các query bẩn: `"`, `,`, `*`, `()`, câu hỏi tiếng Việt dài
2. `entity-expansion.ts`: token match vs entities (name + aliases, diacritic-insensitive nhờ helper bỏ dấu dùng chung), rồi join links→entries
3. Merge + scoring; `--limit` áp sau merge
4. Time filters áp ở SQL (`date BETWEEN`); `--since` dùng `parseSince` Phase 1
5. `digest.ts`: 4 query thống kê trên entries/daily_meta/links
6. `recall.ts`: gọi `syncIfStale` trước mọi query; wire các mode
7. Test fixture vault ~30 entries giả lập data openclaw (gia đình, health, sự kiện) — dùng lại cho Phase 8

## Success Criteria

- [ ] Query "gia đình" trả entries nhắc [[Mẹ]]/[[Bố]] dù body không chứa chữ "gia đình" (qua entity expansion khi query chứa tên entity) — và ngược lại body match thuần FTS vẫn ra
- [ ] Query chứa ký tự FTS đặc biệt không crash (regression openclaw pain)
- [ ] `--digest` output <500 tokens với fixture 30 entries
- [ ] Sửa tay vault → recall ngay thấy (lazy sync hoạt động)

## Risk Assessment

- Entity expansion nhiễu khi tên entity là từ phổ thông ("Mẹ" xuất hiện mọi nơi) → expansion chỉ kích hoạt khi token khớp CHÍNH XÁC tên/alias entity, và giới hạn 20 entries gần nhất/entity
- BM25 normalize giữa 2 nguồn không chuẩn học thuật → đủ tốt ở personal scale; đo bằng fixture trước khi phức tạp hoá
