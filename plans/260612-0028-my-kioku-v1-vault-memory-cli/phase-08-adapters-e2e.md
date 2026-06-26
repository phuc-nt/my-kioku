---
phase: 8
title: "Adapters & E2E"
status: pending
priority: P2
effort: "4h"
dependencies: [4, 5, 6, 7]
---

# Phase 8: Adapters & E2E

## Overview

Lớp tiếp xúc agent: SKILL.md (protocol Haiku-friendly), Claude Code SessionStart hook, E2E với data openclaw thật, docs.

## Requirements

<!-- Updated: Validation Session 1 - import từ markdown folder; production vault ~/kioku-vault; binary my-kioku -->
- Functional: SKILL.md đầy đủ để agent lạ dùng được không cần đọc source; hook inject digest; E2E import markdown kioku-lite thật của openclaw (`~/.kioku-lite/users/companion/memory/`, 177 blocks) và pass bộ query test
- Non-functional: SKILL.md ngắn gọn — mục tiêu Haiku làm đúng (kioku cũ fail vì protocol dài/2 bước); digest <500 tokens
- Production vault: `~/kioku-vault` — độc lập, git-able, ngoài workspace openclaw (quyết định validation)

## Architecture

**SKILL.md** (`resources/SKILL.md`, copy vào vault/agent workspace khi `my-kioku init --skill <dir>`):

- Nguyên tắc viết: mỗi tình huống → đúng 1 lệnh; ví dụ heredoc `--stdin` làm pattern mặc định:
  ```bash
  my-kioku remember --stdin --mood happy/4 <<'EOF'
  Ăn tối với [[Hùng]] ở [[Quảng An (quán)]]...
  EOF
  ```
- Quy tắc vàng giữ từ openclaw SOUL.md: lưu VERBATIM, wikilink người/nơi/sự kiện khi viết, mood vocab gợi ý 10 từ
- Quy trình reflect cho cron agent: chạy reflect → xử lý suggested_actions theo thứ tự (classify → merge [hỏi user nếu nghi ngờ] → viết insight notes vào `insights/` bằng Write thường → entry không link thì bổ sung)
- Anti-pattern table (học từ pain points cũ): không tóm tắt, không tự bịa entity type, luôn --stdin

**Hook** (`resources/hooks/kioku-session-start-digest.sh`): script mỏng gọi `my-kioku recall --digest`, in stdout (Claude Code SessionStart additionalContext). `my-kioku init --hook` in hướng dẫn settings.json snippet — KHÔNG tự sửa settings của user.

**E2E** (`tests/e2e/`): script + checklist chạy với markdown kioku-lite thật:

```
import folder thật ~/.kioku-lite/users/companion/memory/ (177 blocks) vào ~/kioku-vault
→ reindex → bộ 10 query từ acceptance test cũ của openclaw
(gia đình, sự kiện theo năm, health timeline, entity recall Hùng/Mẹ
 — LƯU Ý: entity recall chỉ hoạt động sau khi agent bồi đắp wikilinks; ngay sau import test bằng FTS)
→ reflect trên data thật → review report tay (kỳ vọng: entries_without_links cao — baseline cho living loop)
→ mở vault bằng Obsidian: graph view, backlinks, dataview bảng mood
```

**Docs** (`docs/`): `system-architecture.md`, `codebase-summary.md`, `code-standards.md` khởi tạo theo convention repo.

## Related Code Files

- Create: `resources/SKILL.md`, `resources/hooks/kioku-session-start-digest.sh`
- Modify: `src/commands/init.ts` (`--skill <dir>`, `--hook`)
- Create: `tests/e2e/e2e-import-recall-reflect.test.ts` (fixture) + `tests/e2e/manual-checklist.md` (markdown folder thật)
- Create: `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/code-standards.md`
- Modify: `README.md` (đầy đủ: positioning, quick start, vault conventions)

## Implementation Steps

1. Viết SKILL.md; tự audit: đếm số quyết định agent phải đưa ra mỗi flow (mục tiêu ≤2)
2. Hook script + `init --hook` hướng dẫn
3. E2E fixture test tự động (dùng fixture Phase 7)
4. Chạy manual checklist với markdown openclaw thật (`~/.kioku-lite/users/companion/memory/`) → import vào `~/kioku-vault` — ghi kết quả vào `plans/reports/`
5. So sánh đối chứng: 3 query chạy trên kioku cũ vs my-kioku, ghi nhận khác biệt chất lượng
6. Docs + README

## Success Criteria

- [ ] Import markdown thật (177 blocks) thành công vào `~/kioku-vault`, 10/10 query checklist có kết quả đúng kỳ vọng
- [ ] Obsidian mở vault: graph view có cấu trúc (không phải sao cô lập), dataview bảng mood chạy
- [ ] Digest thật <500 tokens
- [ ] Phiên Claude Code mới với SKILL.md: thực hiện remember/recall/reflect đúng không cần sửa prompt (smoke test với model nhỏ nếu có)

## Risk Assessment

- ~~DB kioku thật là bản full FalkorDB/ChromaDB~~ → ĐÃ GỠ (validation verified: nguồn là markdown kioku-lite, format đã xác nhận với data thật)
- Vault import xong toàn entries không wikilink → graph view Obsidian sẽ trống lúc đầu; success criteria "graph view có cấu trúc" chỉ đánh giá ĐƯỢC sau khi agent chạy vài vòng reflect/bồi đắp — note rõ trong checklist
- Haiku smoke test fail → đơn giản hoá SKILL.md thêm, không thêm lệnh
