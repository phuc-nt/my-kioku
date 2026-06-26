// Read/write entity notes. Entities are auto-stubbed (type: unknown) when first
// linked from an entry; reflect/agent later classifies and enriches them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { entityPath } from "./vault-paths.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { todayISO } from "../lib/dates.ts";

export type EntityType =
  | "person"
  | "place"
  | "event"
  | "activity"
  | "thing"
  | "unknown";

export interface EntityNote {
  name: string;
  exists: boolean;
  type: EntityType;
  aliases: string[];
  meta: Record<string, unknown>;
  body: string;
}

const STUB_BODY = (name: string): string =>
  `# ${name}\n\n## Facts\n`;

/**
 * Create an entity stub if it does not exist. Idempotent — never overwrites an
 * existing file. Returns true if a new file was created.
 */
export function ensureStub(vault: string, name: string): boolean {
  const path = entityPath(vault, name);
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const meta = { type: "unknown", aliases: [], created: todayISO() };
  writeFileSync(path, serializeFrontmatter(meta, STUB_BODY(name)), "utf8");
  return true;
}

/** Read and parse an entity note. */
export function readEntity(vault: string, name: string): EntityNote {
  const path = entityPath(vault, name);
  if (!existsSync(path)) {
    return {
      name,
      exists: false,
      type: "unknown",
      aliases: [],
      meta: {},
      body: "",
    };
  }
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const type = (meta.type as EntityType) ?? "unknown";
  const aliases = Array.isArray(meta.aliases)
    ? (meta.aliases as unknown[]).map(String)
    : [];
  return { name, exists: true, type, aliases, meta, body };
}

/** Patch an entity note's frontmatter, leaving the body intact. */
export function updateMeta(
  vault: string,
  name: string,
  patch: Record<string, unknown>,
): void {
  const path = entityPath(vault, name);
  if (!existsSync(path)) {
    ensureStub(vault, name);
  }
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const merged = { ...meta, ...patch };
  writeFileSync(path, serializeFrontmatter(merged, body), "utf8");
}
