import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStub,
  readEntity,
  updateMeta,
} from "../../src/vault/entity-note.ts";
import { entityPath } from "../../src/vault/vault-paths.ts";

const dirs: string[] = [];
function vault(): string {
  const d = mkdtempSync(join(tmpdir(), "kioku-entity-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("ensureStub creates an unknown-type stub", () => {
  const v = vault();
  expect(ensureStub(v, "Hùng")).toBe(true);
  const e = readEntity(v, "Hùng");
  expect(e.exists).toBe(true);
  expect(e.type).toBe("unknown");
  expect(e.aliases).toEqual([]);
});

test("ensureStub is idempotent and never overwrites Facts", () => {
  const v = vault();
  ensureStub(v, "Mẹ");
  // Hand-edit the Facts section.
  const path = entityPath(v, "Mẹ");
  const raw = readFileSync(path, "utf8");
  const edited = raw.replace("## Facts\n", "## Facts\nSinh năm 1960.\n");
  Bun.write(path, edited);

  // Second ensureStub must NOT clobber the edit.
  expect(ensureStub(v, "Mẹ")).toBe(false);
  const after = readFileSync(path, "utf8");
  expect(after).toContain("Sinh năm 1960.");
});

test("updateMeta patches frontmatter and preserves body", () => {
  const v = vault();
  ensureStub(v, "Quảng An");
  updateMeta(v, "Quảng An", { type: "place", aliases: ["Quán Quảng An"] });
  const e = readEntity(v, "Quảng An");
  expect(e.type).toBe("place");
  expect(e.aliases).toEqual(["Quán Quảng An"]);
  expect(e.body).toContain("## Facts");
});

test("readEntity on missing entity returns non-existent shell", () => {
  const v = vault();
  const e = readEntity(v, "Nobody");
  expect(e.exists).toBe(false);
  expect(e.type).toBe("unknown");
});
