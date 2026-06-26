// Render a reflect report as human-readable markdown (readable in Obsidian).
// Pure formatting — takes the assembled report object, returns a string.

interface ReflectLike {
  period: { from: string; to: string };
  lint: {
    unknown_type_entities: { name: string; mentions: number }[];
    orphan_entities: { name: string }[];
    broken_wikilinks: { target: string; entry_id: string }[];
    entries_without_links: { entry_id: string; first_line: string }[];
    entries_without_mood: { entry_id: string }[];
    missing_checkin_days: string[];
  };
  alias_candidates: { a: string; b: string; similarity: number }[];
  mood_stats: { distribution: Record<string, number>; avg_intensity: number | null; trend: string };
  health_stats: { avg_sleep: number | null; exercise_days: number; mood_score_trend: string };
  insight_candidates: { kind: string; detail: string }[];
  suggested_actions: string[];
}

export function renderReflectMarkdown(r: ReflectLike): string {
  const lines: string[] = [];
  lines.push(`# Reflect — ${r.period.from} → ${r.period.to}`, "");

  lines.push("## Suggested actions");
  if (r.suggested_actions.length) {
    for (const a of r.suggested_actions) lines.push(`- [ ] ${a}`);
  } else {
    lines.push("- _Nothing pending — vault is tidy._");
  }
  lines.push("");

  lines.push("## Mood");
  const dist = Object.entries(r.mood_stats.distribution)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ") || "—";
  lines.push(`- distribution: ${dist}`);
  lines.push(`- avg intensity: ${r.mood_stats.avg_intensity ?? "—"} (trend: ${r.mood_stats.trend})`);
  lines.push("");

  lines.push("## Health");
  lines.push(`- avg sleep: ${r.health_stats.avg_sleep ?? "—"}h`);
  lines.push(`- exercise days: ${r.health_stats.exercise_days}`);
  lines.push(`- mood-score trend: ${r.health_stats.mood_score_trend}`);
  lines.push("");

  lines.push("## Insight candidates");
  if (r.insight_candidates.length) {
    for (const i of r.insight_candidates) lines.push(`- **${i.kind}** — ${i.detail}`);
  } else {
    lines.push("- _None detected this period._");
  }
  lines.push("");

  lines.push("## Lint");
  lines.push(`- unknown-type entities: ${r.lint.unknown_type_entities.length}`);
  lines.push(`- orphan entities: ${r.lint.orphan_entities.length}`);
  lines.push(`- broken wikilinks: ${r.lint.broken_wikilinks.length}`);
  lines.push(`- entries without links: ${r.lint.entries_without_links.length}`);
  lines.push(`- entries without mood: ${r.lint.entries_without_mood.length}`);
  lines.push(`- days missing check-in: ${r.lint.missing_checkin_days.length}`);
  lines.push("");

  if (r.alias_candidates.length) {
    lines.push("## Possible aliases");
    for (const c of r.alias_candidates) {
      lines.push(`- [[${c.a}]] ≈ [[${c.b}]] (${c.similarity})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
