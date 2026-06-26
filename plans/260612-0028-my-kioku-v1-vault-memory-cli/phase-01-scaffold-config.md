---
phase: 1
title: "Scaffold & Config"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Scaffold & Config

## Overview

<!-- Updated: Validation Session 1 - binary name kioku → my-kioku, env MY_KIOKU_VAULT, config ~/.my-kioku/ -->
Dựng Bun/TypeScript project, CLI skeleton với arg routing, config resolution, lệnh `my-kioku init` tạo vault structure.

## Requirements

- Functional: binary `my-kioku` chạy được, `my-kioku init` tạo vault, `--help` liệt kê lệnh, mọi lệnh output JSON (trừ `--help`)
- Non-functional: startup <50ms, deps runtime duy nhất là `yaml` (pure JS), file <200 LOC

## Architecture

- Entry `src/cli.ts`: parse argv bằng `node:util` `parseArgs` (Bun hỗ trợ), route đến `src/commands/*`. KHÔNG dùng framework CLI (commander/citty) — YAGNI
- `src/config.ts`: resolve vault path theo thứ tự: `--vault` flag → env `MY_KIOKU_VAULT` → `~/.my-kioku/config.json` key `vault` → error rõ ràng kèm hướng dẫn
- `src/lib/json-output.ts`: envelope thống nhất `{ok: true, data} | {ok: false, error, hint}` — agent parse ổn định
- `src/lib/dates.ts`: today/now theo local TZ, parse `--since 7d|2w|YYYY-MM-DD`

## Related Code Files

- Create: `package.json`, `tsconfig.json`, `.gitignore`, `README.md` (stub)
- Create: `src/cli.ts`, `src/config.ts`, `src/lib/json-output.ts`, `src/lib/dates.ts`, `src/commands/init.ts`
- Create: `tests/dates.test.ts`, `tests/config.test.ts` (bun test)

## Implementation Steps

1. `bun init`; cấu hình `package.json` với `"bin": {"my-kioku": "src/cli.ts"}`, script `build: bun build --compile src/cli.ts --outfile dist/my-kioku`
2. `tsconfig.json`: strict, moduleResolution bundler, types bun
3. Viết `json-output.ts`: `ok(data)`, `fail(error, hint?)` → in JSON ra stdout, exit code 0/1
4. Viết `dates.ts`: `todayISO()`, `nowHHMM()`, `parseSince(s)` → `{from, to}`
5. Viết `config.ts`: `resolveVault(flags)` theo thứ tự ưu tiên trên; validate path tồn tại (trừ lệnh init)
6. Viết `cli.ts`: subcommand router (init/remember/recall/reflect/reindex/import/entity/watch — stub các lệnh chưa có, trả `fail("not implemented")`)
7. Viết `commands/init.ts`: tạo `journal/`, `entities/`, `insights/`, `.kioku/`, ghi `.kioku/.gitignore` (`*`), tạo `vault-README.md` ngắn mô tả convention. Idempotent — chạy lại không phá data
8. `bun test` + chạy `my-kioku init --vault /tmp/test-vault` xác nhận structure

## Success Criteria

- [ ] `bun run src/cli.ts init --vault /tmp/v && ls /tmp/v` → đủ 4 folder
- [ ] `my-kioku` không args → JSON help/usage; lệnh sai → `{ok:false}` exit 1
- [ ] `bun build --compile` ra single binary chạy được
- [ ] `bun test` pass

## Risk Assessment

- Bun parseArgs khác biệt nhỏ với Node → test sớm ở phase này
- Quote tiếng Việt trong shell: chưa xử lý ở đây, dồn về `--stdin` ở Phase 4
