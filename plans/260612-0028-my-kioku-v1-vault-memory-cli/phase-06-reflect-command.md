---
phase: 6
title: "Reflect Command"
status: pending
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 6: Reflect Command

## Overview

Linh hồn "living": lệnh deterministic scan vault → report candidates (lint + stats + insight) để agent cron phán đoán và hành động. CLI không gọi LLM.

## Requirements

<!-- Updated: Validation Session 1 - binary name my-kioku -->
- Functional: `my-kioku reflect [--since 7d] [--md]` → JSON stdout; `--md` ghi thêm bản markdown vào `.kioku/reflect/{YYYYMMDD-HHMM}.md`
- Non-functional: mọi finding phải truy được nguồn (file/entry id) — anti-hallucination như llm-wiki; thuần thống kê/string-matching, zero network

## Architecture

Report schema:

```json
{
  "period": {"from", "to"},
  "lint": {
    "unknown_type_entities": [{"name", "file", "mentions"}],
    "orphan_entities": [...],            // 0 inbound links
    "broken_wikilinks": [{"target", "entry_id"}],  // link không có entity file (sau manual edit)
    "entries_without_links": [{"entry_id", "first_line"}],
    "entries_without_mood": [...],
    "missing_checkin_days": ["2026-06-10", ...]
  },
  "alias_candidates": [{"a", "b", "similarity", "hint"}],   // jaro-winkler >= 0.85 trên name+aliases
  "mood_stats": {"distribution", "avg_intensity", "trend"}, // trend: so sánh nửa đầu/nửa cuối kỳ
  "health_stats": {"avg_sleep", "exercise_days", "mood_score_trend"},
  "insight_candidates": [
    {"kind": "mood_streak", "detail": "intensity giảm 4 ngày liên tiếp", "evidence": [entry_ids]},
    {"kind": "co_occurrence", "detail": "[[Hùng]] + [[Quảng An]] cùng xuất hiện 4 lần", "evidence": [...]},
    {"kind": "entity_spike", "detail": "[[Mẹ]] được nhắc 6 lần tuần này (trung bình 1)", "evidence": [...]},
    {"kind": "silence", "detail": "[[Jilliano]] không xuất hiện 60 ngày (trước đó đều đặn)", "evidence": [...]}
  ],
  "suggested_actions": ["classify 3 entities", "review 2 alias pairs", "write insight: mood_streak"]
}
```

- `src/reflect/alias-similarity.ts`: jaro-winkler tự viết (~40 LOC, port từ kioku-lite `string_similarity.py`); so cả dạng bỏ dấu ("Hung" vs "Hùng" → candidate)
- `src/reflect/lint-checks.ts`: 6 query lint trên index
- `src/reflect/mood-stats.ts`: distribution + trend (slope đơn giản nửa kỳ)
- `src/reflect/insight-candidates.ts`: 4 detector trên; ngưỡng hardcode kèm const đặt tên rõ (tinh chỉnh sau với data thật — unresolved question #3 của design)

## Related Code Files

- Create: `src/reflect/alias-similarity.ts`, `src/reflect/lint-checks.ts`, `src/reflect/mood-stats.ts`, `src/reflect/insight-candidates.ts`, `src/commands/reflect.ts`
- Modify: `src/cli.ts`
- Create: `tests/reflect/*.test.ts`

## Implementation Steps

1. `alias-similarity.ts` + test cặp tiếng Việt thực tế: Hùng/hùng/bạn Hùng, Phúc/phuc-nt
2. `lint-checks.ts`: mỗi check 1 function 1 query; test trên fixture có lỗi cài sẵn
3. `mood-stats.ts`, `health-stats` (gộp trong mood-stats nếu <200 LOC)
4. `insight-candidates.ts`: 4 detector, mỗi cái trả evidence entry_ids
5. `commands/reflect.ts`: syncIfStale → chạy tất cả → assemble report → `--md` render markdown người đọc được
6. `suggested_actions`: derive tự động từ counts (giúp agent cron prioritize)

## Success Criteria

- [ ] Fixture có 2 entity trùng (Hùng/bạn Hùng), 1 unknown type, 1 broken link, mood giảm dần → report bắt đủ 4 với evidence đúng
- [ ] Mọi finding có file path hoặc entry_id kiểm chứng được
- [ ] Chạy trên vault rỗng/mới init → report sạch, không crash
- [ ] `--md` render đọc được trong Obsidian

## Risk Assessment

- Ngưỡng insight sai → false positive làm agent viết insight rác. Mitigation: candidates chỉ là GỢI Ý, agent quyết định; ngưỡng là named constants dễ chỉnh
- Alias candidate O(n²) pairwise → ok tới ~1000 entities; chặn bằng so sánh chỉ trong cùng first-char bucket nếu chậm (đo trước)
