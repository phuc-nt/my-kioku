// Path construction + filename sanitization for vault files.
// Keeps Unicode (Vietnamese) intact; only strips characters illegal in filenames.
// Defense-in-depth: dates are validated and resolved paths must stay under the vault.

import { join, resolve, sep } from "node:path";
import { isValidISODate } from "../lib/dates.ts";

// Characters not allowed in file names on common filesystems.
const ILLEGAL = /[/\\:*?"<>|]/g;

/**
 * Sanitize an entity/insight name into a safe file basename.
 * Preserves Vietnamese diacritics and other Unicode; collapses whitespace;
 * rejects path-traversal names (".", "..", names that reduce to dots only).
 */
export function sanitizeFileName(name: string): string {
  let cleaned = name
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A name consisting only of dots ("." / "..") would create traversal or
  // hidden-file surprises — fall back to a safe placeholder.
  if (cleaned.length === 0 || /^\.+$/.test(cleaned)) {
    return "untitled";
  }
  return cleaned;
}

/** Throw if a date is not a real YYYY-MM-DD value (guards path building). */
function assertValidDate(dateISO: string): void {
  if (!isValidISODate(dateISO)) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${dateISO}`);
  }
}

/** Ensure a built path stays under the vault root; throw on escape. */
function assertUnderVault(vault: string, fullPath: string): string {
  const root = resolve(vault);
  const target = resolve(fullPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Path escapes vault: ${fullPath}`);
  }
  return target;
}

/** journal/YYYY/MM/YYYY-MM-DD.md relative to the vault root. */
export function dailyNoteRelPath(dateISO: string): string {
  assertValidDate(dateISO);
  const parts = dateISO.split("-");
  const [y, m] = parts;
  return join("journal", y!, m!, `${dateISO}.md`);
}

export function dailyNotePath(vault: string, dateISO: string): string {
  return assertUnderVault(vault, join(vault, dailyNoteRelPath(dateISO)));
}

/** entities/<Name>.md relative to the vault root. */
export function entityRelPath(name: string): string {
  return join("entities", `${sanitizeFileName(name)}.md`);
}

export function entityPath(vault: string, name: string): string {
  return assertUnderVault(vault, join(vault, entityRelPath(name)));
}

/** insights/<slug>.md relative to the vault root. */
export function insightRelPath(slug: string): string {
  return join("insights", `${sanitizeFileName(slug)}.md`);
}

export function insightPath(vault: string, slug: string): string {
  return assertUnderVault(vault, join(vault, insightRelPath(slug)));
}
