---
phase: 3
title: "SQLite Index"
status: completed
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: SQLite Index

## Overview

<!-- Updated: Validation Session 1 - binary name my-kioku -->
Index disposable trên bun:sqlite: schema + FTS5, full reindex từ vault, lazy mtime-based incremental sync, lệnh `my-kioku reindex`.

## Requirements

- Functional: xoá `.kioku/index.db` → `reindex` dựng lại 100%; mọi lệnh đọc tự sync file thay đổi trước khi query; FTS tìm được tiếng Việt có/không dấu
- Non-functional: reindex 1000 daily notes <5s; sync check (không có thay đổi) <30ms

## Architecture

Schema (`src/index/db.ts`):

```sql
CREATE TABLE files(path TEXT PRIMARY KEY, mtime INTEGER, kind TEXT);          -- kind: journal|entity|insight
CREATE TABLE entries(id TEXT PRIMARY KEY, file TEXT, date TEXT, time TEXT,
                     ordinal INTEGER, mood TEXT, intensity INTEGER, body TEXT);
                     -- id = "{date}#{ordinal}" (heading trùng giờ vẫn unique)
CREATE VIRTUAL TABLE entries_fts USING fts5(body, content=entries, content_rowid=rowid,
                     tokenize='unicode61 remove_diacritics 2');
CREATE TABLE links(entry_id TEXT, target TEXT);                               -- target = tên entity chuẩn hoá
CREATE TABLE entities(name TEXT PRIMARY KEY, file TEXT, type TEXT, aliases TEXT); -- aliases JSON array
CREATE TABLE daily_meta(date TEXT PRIMARY KEY, sleep_hours REAL, exercise TEXT,
                     mood_score INTEGER, extra TEXT);                          -- extra = JSON các field lạ
```

- `src/index/db.ts`: open `.kioku/index.db`, PRAGMA journal_mode=WAL, create-if-missing idempotent, version pragma (`user_version`) để migrate bằng cách drop-rebuild (index disposable nên migration = rebuild)
- `src/index/indexer.ts`: `indexFile(path)` — dispatch theo kind: journal → entries+links+daily_meta+fts; entity → entities; insight → chỉ files. `removeFile(path)` xoá rows. `fullReindex()` — walk vault, drop+rebuild
- `src/index/lazy-sync.ts`: `syncIfStale(db)` — scan mtime toàn vault (readdir đệ quy, so với bảng `files`), reindex file mới/đổi, remove file đã xoá. Gọi ở đầu mọi lệnh đọc (recall/reflect)
- FTS sync: dùng trigger hoặc manual insert vào `entries_fts` sau khi ghi `entries` (manual — dễ debug hơn trigger)

## Related Code Files

- Create: `src/index/db.ts`, `src/index/indexer.ts`, `src/index/lazy-sync.ts`, `src/commands/reindex.ts`
- Create: `tests/index/indexer.test.ts`, `tests/index/lazy-sync.test.ts`, `tests/index/fts-vietnamese.test.ts`

## Implementation Steps

1. `db.ts`: schema + open helper; test create idempotent
2. `indexer.ts` journal path: dùng vault core (Phase 2) parse → insert entries + links + daily_meta + fts rows
3. `indexer.ts` entity path: parse frontmatter → upsert entities (aliases JSON)
4. `fullReindex()`: walk `journal/`, `entities/`, `insights/`; bỏ qua `.kioku/`
5. `lazy-sync.ts`: mtime diff → indexFile/removeFile từng file lệch; cập nhật bảng files
6. `commands/reindex.ts`: gọi fullReindex, output JSON stats `{files, entries, entities, links, ms}`
7. FTS test tiếng Việt: index "Ăn phở với Hùng" → query "pho", "phở", "hung" đều match (remove_diacritics 2)
8. Disposable test: index → query → xoá db → reindex → cùng kết quả

## Success Criteria

- [ ] Disposable test pass (kết quả identical trước/sau rebuild)
- [ ] Sửa tay 1 daily note → lệnh đọc kế tiếp thấy nội dung mới, không cần reindex thủ công
- [ ] Xoá 1 entity file tay → entity biến mất khỏi index sau sync
- [ ] FTS match có dấu lẫn không dấu

## Risk Assessment

- mtime resolution 1s trên một số FS → so sánh `mtime != stored` (không phải `>`), đủ an toàn
- Vault lớn scan readdir mỗi lệnh → chấp nhận ở personal scale; nếu chậm, cache dir mtime (đo trước khi tối ưu — YAGNI)
- FTS5 external content table dễ lệch → luôn ghi entries và entries_fts trong cùng transaction
