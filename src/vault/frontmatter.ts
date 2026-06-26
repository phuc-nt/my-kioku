// Parse/serialize the leading `---` YAML frontmatter block of a markdown file.
// On malformed YAML, returns empty meta + a warning rather than throwing (KISS).

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ParsedDoc {
  meta: Record<string, unknown>;
  body: string;
  /** Non-fatal parse warning, if any. */
  warning?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a raw markdown string into {meta, body}. */
export function parseFrontmatter(raw: string): ParsedDoc {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { meta: {}, body: raw };
  }

  const yamlText = match[1] ?? "";
  const body = raw.slice(match[0].length);

  try {
    const parsed = parseYaml(yamlText);
    const meta =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { meta, body };
  } catch (e) {
    return {
      meta: {},
      body,
      warning: `Malformed frontmatter YAML: ${(e as Error).message}`,
    };
  }
}

/**
 * Serialize {meta, body} back to a markdown string.
 * Omits the frontmatter block entirely when meta is empty.
 */
export function serializeFrontmatter(
  meta: Record<string, unknown>,
  body: string,
): string {
  const keys = Object.keys(meta);
  if (keys.length === 0) return body;
  const yamlText = stringifyYaml(meta).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}
