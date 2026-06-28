#!/usr/bin/env bun
// my-kioku CLI entry. Intentionally TINY: it runs the Bun-runtime guard, then LAZILY
// imports the real CLI logic. The lazy import matters — ES modules resolve all STATIC
// imports up front, so if cli-main.ts (which loads bun:sqlite) were imported statically,
// a non-Bun runtime would crash on module resolution BEFORE the guard could print its
// friendly message. A dynamic import() defers loading cli-main until the guard passes.

import "./lib/require-bun.ts"; // side-effect: exits with a clear message if not on Bun

const { main } = await import("./cli-main.ts");
main();
