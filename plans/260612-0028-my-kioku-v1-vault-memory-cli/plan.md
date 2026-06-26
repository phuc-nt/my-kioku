---
title: "my-kioku v1 — Obsidian-vault agent memory CLI (Bun)"
description: "Living personal memory cho diary agent: Obsidian vault là source of truth, SQLite FTS5 index disposable, 3 lệnh remember/recall/reflect"
status: completed
priority: P1
created: 2026-06-12
completed: 2026-06-26
---

# my-kioku v1 — Obsidian-vault agent memory CLI (Bun)

## Overview

Agent memory mới cho "trợ lý nhật ký cá nhân" (openclaw). Đảo kiến trúc kioku-lite: **markdown vault là database**, KG = wikilinks + frontmatter, SQLite chỉ là index rebuild được 100%. Không vector search. Schema: đời sống cá nhân + cảm xúc (không công việc).

Design approved: `plans/reports/brainstorm-260612-0028-my-kioku-v1-design-decisions-report.md`
Research context: `plans/reports/repo-research-260611-1910-kioku-llmwiki-openclaw-synthesis-report.md`

## Key Decisions (locked)

- Bun + bun:sqlite (FTS5), TypeScript, deps tối thiểu (chỉ `yaml`)
- Daily-note centric: `journal/YYYY/MM/YYYY-MM-DD.md`, entry = section `## HH:MM`
- Mood = inline field `mood:: emotion/intensity`, KHÔNG phải entity
- Entity auto-stub khi remember, folder phẳng `entities/`, `type: unknown` → reflect phân loại
- Health check-in = frontmatter daily note
- Reflect deterministic (CLI không gọi LLM), agent phán đoán qua cron
- Lazy mtime reindex là cơ chế sync chính; `watch` chỉ là polling wrapper

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scaffold & Config](./phase-01-scaffold-config.md) | ✅ Done |
| 2 | [Vault Core](./phase-02-vault-core.md) | ✅ Done |
| 3 | [SQLite Index](./phase-03-sqlite-index.md) | ✅ Done |
| 4 | [Remember Command](./phase-04-remember-command.md) | ✅ Done |
| 5 | [Recall Command](./phase-05-recall-command.md) | ✅ Done |
| 6 | [Reflect Command](./phase-06-reflect-command.md) | ✅ Done |
| 7 | [Utilities](./phase-07-utilities.md) | ✅ Done |
| 8 | [Adapters & E2E](./phase-08-adapters-e2e.md) | ✅ Done |

## Dependency Chain

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (tuyến tính; 5/6 chỉ cần 3, có thể song song với 4 nếu cần)

## Module Layout (target)

```
src/
├── cli.ts                  # entry + arg routing (node:util parseArgs)
├── config.ts               # MY_KIOKU_VAULT resolution
├── vault/                  # markdown read/write (daily-note, frontmatter, entry, wikilink, entity-note, vault-paths)
├── index/                  # bun:sqlite (db, indexer, lazy-sync)
├── commands/               # init, remember, recall, reflect, reindex, import-kioku-lite, entity-merge, watch
├── reflect/                # alias-similarity, lint-checks, mood-stats, insight-candidates
└── lib/                    # json-output, dates
```

## Success Criteria (v1) — ✅ ALL MET

- [x] Haiku-class model dùng được protocol (1 lệnh/hành động) — SKILL.md, verified
- [x] Xoá `.kioku/` + `reindex` → recall kết quả y hệt — disposable test (rich snapshot)
- [x] Vault mở Obsidian: markdown + wikilinks + dataview chuẩn (graph trống lúc đầu, agent bồi đắp)
- [x] Import 177 memories từ markdown kioku-lite thật → 68 unique, 0 bad; recall trả kết quả đúng
- [x] Reflect report có actionable items (suggested_actions) từ data thật, mọi finding truy được entry_id

**Result:** 8/8 phases, 153 tests pass, tsc clean, single binary builds & runs. Mỗi phase qua adversarial code-review (caught 12+ real bugs: verbatim round-trip, inverted BM25, TZ trend, import desync, compiled-binary resource embedding).

## Dependencies

Cross-plan: none (plan đầu tiên của project).

## Validation Log

### Session 1 — 2026-06-12 (`/mk:plan validate`)

**Verification pass (claims checked):**

| Claim | Result | Evidence |
|-------|--------|----------|
| Bun cài sẵn, bun:sqlite có FTS5 | ✅ Verified | Bun 1.3.11; test script FTS5 `unicode61 remove_diacritics 2` match "phở"/"pho"/"hung" — SQLite 3.51.0 |
| openclaw dùng kioku-lite SQLite (không phải kioku full) | ✅ Verified | `~/.kioku-lite/users/companion/data/kioku.db` tồn tại, 68 memories — risk FalkorDB/ChromaDB ở Phase 8 GỠ BỎ |
| Schema DB trong Phase 7 (cột `text`, `created`) | ❌ Failed | Schema thật: `memories(content, date, timestamp, ...)`; `kg_nodes` không có `confidence`; `kg_edges` không có `valid_from/until` |
| Binary name `kioku` chưa bị chiếm trên máy | ✅ Verified | `which kioku` rỗng |
| Markdown folder kioku-lite làm nguồn import | ✅ Verified | 4 files, 177 memory blocks (NHIỀU hơn DB 68); format: blocks `---\ntime/mood/[event_time]\n---\ntext` |

**Interview decisions:**

1. **Import source = markdown folder** (`~/.kioku-lite/users/companion/memory/*.md`), KHÔNG phải SQLite DB — user override recommendation. Hệ quả: bỏ import kg_nodes/kg_aliases/kg_edges (entities + wikilink-injection); entries import sẽ không có wikilinks ban đầu → reflect lint surface, agent bồi đắp dần. Phase 7 viết lại theo quyết định này.
2. **Production vault = `~/kioku-vault`** độc lập (git-able), không nằm trong workspace openclaw.
3. **Binary name = `my-kioku`** — user override (dù `kioku` còn trống). Đổi theo: bin/package/build outfile = `my-kioku`, env `MY_KIOKU_VAULT`, config `~/.my-kioku/config.json`. GIỮ NGUYÊN: folder index trong vault `.kioku/` (nội bộ vault, ngắn gọn, không va chạm).
4. **Ngưỡng insight detectors = named constants**, tinh chỉnh sau với data thật (giữ nguyên Phase 6).
