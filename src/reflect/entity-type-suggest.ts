// Deterministic, read-only entity-TYPE suggester for the living loop (GAP 9B part a).
// reflect surfaces a guessed type for `type:unknown` entities; the AGENT confirms and
// writes the frontmatter (CLI never auto-classifies — markdown stays source of truth).
// Heuristic, not NLP: use signals already in the index. Precision over recall — when no
// confident signal, suggest nothing (leave it unknown for the agent to decide).

import { Database } from "bun:sqlite";
import { fold } from "../lib/diacritics.ts";
import type { EntityType } from "../vault/entity-note.ts";

export interface EntityTypeSuggestion {
  name: string;
  file: string;
  suggested: EntityType;
  reason: string;
}

// Relation verbs whose TARGET is almost always a person (someone you feel something
// with/toward). A name that is a target of these → strong person signal.
const PERSON_REL_VERBS = new Set(["with", "joy", "trigger", "eases"]);

/**
 * Suggest a type for each `type:unknown` entity that has a confident signal. Entities
 * with no signal are omitted (agent leaves them unknown). Deterministic + bounded.
 */
export function suggestEntityTypes(db: Database): EntityTypeSuggestion[] {
  const unknowns = db
    .query<{ name: string; file: string }, []>(
      "SELECT name, file FROM entities WHERE type = 'unknown'",
    )
    .all();
  if (unknowns.length === 0) return [];

  // Folded entity-name → set of relation verbs it is a TARGET of.
  const relVerbsByTarget = new Map<string, Set<string>>();
  for (const r of db
    .query<{ rel_type: string; target: string }, []>(
      "SELECT rel_type, target FROM relations",
    )
    .all()) {
    const key = fold(r.target);
    (relVerbsByTarget.get(key) ?? relVerbsByTarget.set(key, new Set()).get(key)!).add(
      r.rel_type.toLowerCase(),
    );
  }

  const out: EntityTypeSuggestion[] = [];
  for (const e of unknowns) {
    const verbs = relVerbsByTarget.get(fold(e.name));
    if (verbs && [...verbs].some((v) => PERSON_REL_VERBS.has(v))) {
      const hit = [...verbs].find((v) => PERSON_REL_VERBS.has(v))!;
      out.push({
        name: e.name,
        file: e.file,
        suggested: "person",
        reason: `Target of a "${hit}::" emotional relation → likely a person.`,
      });
    }
    // No confident signal → omit (agent decides; precision over recall).
  }
  return out;
}
