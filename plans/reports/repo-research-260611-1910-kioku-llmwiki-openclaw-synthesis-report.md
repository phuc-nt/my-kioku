# Research Report: kioku-lite + my-llm-wiki + openclaw → vision cho my-kioku

Date: 2026-06-11 | Type: repo exploration synthesis

## 1. kioku-agent-kit-lite (memory engine hiện tại)

- Python 3.11+, ~3.8K LOC src + 4.4K LOC tests, v0.2.0 (04/2026)
- **Single SQLite file** chứa 3 backend: FTS5 (BM25) + sqlite-vec (embedding fastembed/ONNX) + KG tables (`kg_nodes`, `kg_edges`, `kg_aliases`)
- Lưu ý: bản "lite" này KHÔNG còn 3 DB rời — bản gốc kioku (FalkorDB + ChromaDB + SQLite) mới là bản cồng kềnh mà openclaw đang chạy
- Search: tri-hybrid BM25 + vector + graph (PPR/BFS) → RRF fusion
- Agent-driven extraction: agent tự gọi `save` rồi `kg-index` với entities/relations JSON
- Lifecycle: temporal validity (`valid_from/valid_until`), confidence decay (half-life 90d), `consolidate` report — nhưng tất cả đều agent-driven, không tự động
- Markdown backup tồn tại nhưng **một chiều** (DB là truth, markdown không rebuild được DB) — điểm yếu lớn
- Pain points: hub node problem, agent quên gọi kg-index, alias/entity drift, thresholds hardcode, không export Obsidian

## 2. openclaw-workspace (consumer)

- Multi-agent (personal/research/kioku) qua Telegram bot + cron jobs, gateway local macOS
- Agent "kioku" = emotional companion + diary + health tracking, gọi kioku CLI qua Bash
- Flows: health check-in 7:30 sáng, ghi sự kiện đời sống, recall, weekly review (multi-agent)
- Pain points thực chiến:
  1. Shell isolation LaunchAgent → mỗi call phải activate venv (~1-2s overhead)
  2. Haiku quá "lười" với multi-step protocol (save→kg-index), phải nâng lên Sonnet (3x cost)
  3. Entity drift: "Phúc/anh/tôi/phuc-nt" → 3 nodes, phải manual kg-alias
  4. Quy tắc verbatim chỉ enforce bằng prompt, hay bị vi phạm
  5. Health data free-text, không aggregate được (AVG sleep_hours…)
  6. Không bulk import/export, không handoff giữa agents
  7. Quyết định 04/2026: xoá kioku-lite agent, consolidate về kioku
- Nhu cầu rút ra: **API đơn giản hơn (ít quyết định cho agent)**, event_time chuẩn, structured fields cho health, portability markdown, reflection/insight offline

## 3. my-llm-wiki (concept "living")

- Karpathy-inspired: raw files → compiled graph → query. "Compile once, query forever"
- **Không DB, không embeddings**: NetworkX graph.json + Obsidian vault markdown. Tech rất nhẹ (~5K LOC, tree-sitter + networkx)
- Living loop: Monitor → Rebuild (SHA256 cache) → Lint (orphans, tiny communities, confidence breakdown) → Write-back (`llm-wiki note` → `ingested/`, session capture → `pending-notes.md`) → Report (WIKI_REPORT.md)
- Vault export chuẩn Obsidian: 1 file/node, wikilinks basename, YAML frontmatter, tags, community MOCs, dataview queries
- Confidence 3 tiers per edge: EXTRACTED / INFERRED / AMBIGUOUS
- `/wiki maintain`: phát hiện contradiction, stale TODO, orphan concept, broken wikilinks — anti-hallucination (mọi finding phải từ CLI output)
- Triết lý then chốt: *"At personal scale (10-1000 files), you don't need ANN. You need what connects to what."*

## 4. Synthesis — vision đề xuất cho my-kioku

**Core flip: Obsidian vault LÀ database. KG là derived index, không phải source of truth.**

| Layer | Thiết kế | Giải quyết pain point |
|---|---|---|
| Storage | Plain markdown vault (daily notes verbatim + entity notes + insight notes), wikilinks + frontmatter = KG | "KG làm màu" → KG chỉ là wikilinks, plain text vẫn là vua; portability; Obsidian native không cần export |
| Index (disposable) | 1 SQLite file FTS5 (+ sqlite-vec optional tier) rebuild từ vault bất kỳ lúc nào | Markdown-DB divergence của kioku-lite; zero ops |
| Interface | CLI JSON + SKILL.md + hooks; rút còn ~3 lệnh chính: `remember`, `recall`, `reflect` | Haiku-friendly (1 lệnh, không cần 2-step save+kg-index); agent decision burden |
| Living loop | Cron `reflect`: consolidate dailies → entity notes, dedupe alias, mark stale, sinh insight, lint report | llm-wiki maintain concept; thay cho consolidate agent-driven thụ động |
| Structured data | Frontmatter fields (sleep_hours, mood_score…) → dataview/CLI aggregate | Health tracking aggregation |

**Trade-off chấp nhận:** graph traversal yếu hơn graph DB thật — nhưng ở personal scale (<10K entries) backlinks + grep + FTS đủ; PPR/hub-node complexity của kioku-lite bị cắt bỏ.

## Unresolved questions

1. Vector search: optional tier hay bỏ hẳn? (fastembed model ~250MB, openclaw data mới 75 entries — BM25 + wikilink có thể đủ giai đoạn đầu)
2. Entity extraction lúc save: 1-step (agent đính wikilinks ngay trong nội dung) hay để reflect job làm sau (async)?
3. Ngôn ngữ implement: Python (kế thừa kioku-lite) hay TS/Bun (startup nhanh hơn cho hook)?
4. Tên user/multi-user: giữ profile-per-user của kioku-lite hay 1 vault = 1 user?
5. Migration: import 75 entries hiện tại của openclaw từ kioku DB → vault?
