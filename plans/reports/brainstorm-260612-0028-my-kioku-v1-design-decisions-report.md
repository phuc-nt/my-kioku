# Brainstorm Report: my-kioku v1 — Design Decisions

Date: 2026-06-12 | Status: APPROVED by user
Context: plans/reports/repo-research-260611-1910-kioku-llmwiki-openclaw-synthesis-report.md

## Problem Statement

Tạo lại kioku — agent memory cho "trợ lý nhật ký cá nhân" (openclaw):
- Gọn nhẹ (không 3 DB như kioku gốc), thân thiện đa dạng agent (CLI/skill/hook)
- "Living" theo concept my-llm-wiki (tự bồi đắp, dọn dẹp theo thời gian)
- KG phải "chơi được" và output chuẩn Obsidian vault
- Tránh vết xe "KG làm màu" — plain text vẫn là vua

## Core Architecture Decision

**Obsidian vault LÀ database. KG = wikilinks + frontmatter (derived). SQLite index = disposable.**

Đảo ngược kioku-lite (DB là truth, markdown backup 1 chiều) → markdown là truth, index rebuild được 100% từ vault.

## Decisions (all approved)

| # | Quyết định | Lựa chọn | Lý do chính |
|---|---|---|---|
| 1 | Runtime | **Bun + bun:sqlite** | FTS5 built-in, zero native dep, startup ~10ms cho hook/cron |
| 2 | Vault structure | **Daily-note centric** | 1 file/ngày, entry = section `## HH:MM`, chuẩn Obsidian, người đọc lại được |
| 3 | Cảm xúc | **Structured field, KHÔNG entity** | `mood:: emotion/intensity` inline; tránh hub-node "happy" như kioku cũ |
| 4 | Reflect | **CLI deterministic + agent phán đoán** | CLI scan/detect → report; agent (cron) quyết định/apply. Không API key trong tool |
| 5 | Entity lifecycle | **Auto-stub khi remember** | [[link]] thiếu → stub `entities/` phẳng, `type: unknown`; reflect phân loại sau |
| 6 | Health check-in | **Frontmatter daily note** | sleep_hours/exercise/mood_score YAML; aggregate rẻ |
| 7 | Adapters v1 | **CLI JSON + SKILL.md + Claude Code hook** | Hook = script mỏng gọi `recall --digest`. MCP để v2 |
| 8 | V1 scope extras | **Import kioku-lite DB, lint trong reflect, watch (lazy reindex chính + watch wrapper), insight generation** | Watch mode = lazy mtime reindex mỗi lệnh đọc; `kioku watch` chỉ là polling wrapper |
| 9 | Vector search | **BỎ** | Personal scale: BM25 + backlinks đủ; cắt 250MB ONNX model |
| 10 | Schema scope | **Đời sống cá nhân + cảm xúc, KHÔNG công việc** | Entity types gợi ý: person/place/event/activity/thing |
| 11 | Multi-user | **1 vault = 1 user** | Path qua `KIOKU_VAULT` env/config |

## Vault Layout

```
vault/
├── journal/YYYY/MM/YYYY-MM-DD.md   # frontmatter: sleep_hours, exercise, mood_score
│     ## HH:MM                       # 1 entry = 1 section
│     mood:: happy/4                 # emotion/intensity 1-5
│     <verbatim text với [[wikilinks]]>
├── entities/<Name>.md               # flat; frontmatter: type, aliases[]; body: ## Facts
├── insights/YYYY-Www-<slug>.md      # agent viết từ reflect report
└── .kioku/index.db                  # disposable
```

Mood vocab gợi ý (không enforce): happy, sad, excited, anxious, grateful, proud, calm, tired, angry, neutral.

## CLI Surface

- `kioku remember [--stdin] [--mood e/i] [--time HH:MM] [--date YYYY-MM-DD] [--checkin k=v,...]`
  - 1 bước: append daily note + parse links + auto-stub + update index
  - `--stdin` tránh lỗi shell quoting tiếng Việt
  - Lưu verbatim, không tóm tắt (enforce ở SKILL.md)
- `kioku recall "query" [--from --to] [--entity X] [--digest]`
  - FTS5 BM25 + entity expansion (query khớp tên/alias → kéo entries backlink). Output JSON
  - `--digest`: compact summary cho SessionStart hook
- `kioku reflect [--since 7d]` → report JSON+MD:
  - Alias nghi trùng (string similarity), entity type unknown, orphan entities, broken wikilinks (lint)
  - Mood/health stats theo kỳ, insight candidates (trend, co-occurrence)
- Utilities: `init`, `reindex`, `import --from-kioku-lite <db>`, `entity merge A B` (rewrite wikilinks an toàn), `watch`

## Index Design (bun:sqlite)

Tables: `entries` + FTS5 virtual table, `links(entry_id, target)`, `entities(name, type, aliases, file)`, `daily_meta(date, sleep_hours, ...)`.
Lazy sync: mọi lệnh đọc check mtime → incremental reindex (bắt cả sửa tay trong Obsidian). Full rebuild: `kioku reindex`.

## Living Loop

Cron openclaw (daily/weekly): `kioku reflect` → agent đọc report → classify entities, `entity merge`, viết insights/*.md, bồi Facts vào entity notes → lần đọc sau tự index. Phán đoán 100% ở agent.

## Cut from old kioku (deliberate)

Vector search, PPR/graph traversal + hub-node mitigation, temporal validity fields, confidence decay, 2-step save+kg-index, multi-user profiles, FalkorDB/ChromaDB.

## Risks & Mitigations

- **Agent quên wikilink khi remember** → SKILL.md directive + reflect phát hiện entries không link → agent bổ sung sau (self-healing)
- **Entity name collision** (Hùng đồng nghiệp vs Hùng em họ) → tên file phân biệt (`Hùng (em họ).md`) + aliases; reflect cảnh báo khi 1 alias trỏ 2 entity
- **Daily note conflict khi user sửa tay đồng thời** → remember chỉ append section mới, không rewrite file
- **Bun adoption** → single-file executable `bun build --compile` cho máy không cài Bun
- **FTS5 tiếng Việt** → unicode61 tokenizer remove_diacritics; test với corpus openclaw 75 entries thật

## Success Metrics

- Haiku-class model dùng được protocol (1 lệnh/hành động) — không cần nâng Sonnet như kioku cũ
- Xoá `.kioku/` + `reindex` → search kết quả y hệt (index thật sự disposable)
- Vault mở bằng Obsidian: graph view, backlinks, dataview hoạt động không cần plugin lạ
- Import 75 entries openclaw thành công, recall đúng các query test cũ (gia đình, sự kiện, timeline)
- Reflect report có actionable items thật từ data thật

## Next Steps

1. `/mk:plan` từ report này → phases: scaffold Bun project → vault+index core → remember → recall → reflect → import → SKILL.md+hook → test với data openclaw
2. Sau v1: cân nhắc MCP server, mood analytics sâu hơn

## Unresolved Questions

1. Tên repo/package chính thức: `my-kioku` hay `kioku` v2? (tạm dùng `kioku` cho binary)
2. Digest format cho SessionStart hook: bao nhiêu token là vừa? (đề xuất <500 tokens)
3. Insight candidates trong reflect: ngưỡng nào đáng báo (vd mood giảm N ngày liên tiếp)? — tinh chỉnh khi có data thật
