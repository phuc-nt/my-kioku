# my-kioku — personal diary memory

You keep a person's life memory in a `my-kioku` vault (an Obsidian vault that IS
the database). Three commands cover everything. **One situation → one command.**

## Golden rules

1. **Store VERBATIM.** Never summarize, translate, or "clean up" what the person
   said. Save it as-is.
2. **Link people, places, events** with `[[Name]]` while writing — that builds
   the memory graph. Same name every time (use the canonical name, not variants).
3. **Mood** is one free word, optional 1–5 intensity: `happy`, `tired/2`, `buồn/4`.
4. **Always use `--stdin` with a heredoc** for text. It avoids every shell-quoting
   problem with quotes, apostrophes, newlines, and Vietnamese diacritics.
5. **Keep the person's language.** Write entries and entity/relation names in the
   exact language and words they used — including mixed Vietnamese-English ("họp
   với team về deadline"). Don't translate either way. Proper nouns stay as written
   (`[[Techbase]]`, `[[Mẹ]]`). The ONLY English-vocabulary field is the entity
   `type:` (person/place/event/activity/thing) — that's a fixed tag, not a name.
6. **Reply concisely.** Answer in a few sentences; cite at most one or two recalled
   entries — don't dump a big markdown table every turn. Long replies pile up and
   overflow a small model's context, which can make it get stuck repeating itself.
   Summarize; recall once.

## Remember (write)

Every new thing the person tells you → one `remember`:

```bash
my-kioku remember --stdin --mood happy/4 <<'EOF'
Ăn tối với [[Hùng]] ở [[Quảng An (quán)]]. Bàn về dự án mới, rất hào hứng.
EOF
```

Health check-in (sleep / exercise / mood score) → no text needed:

```bash
my-kioku remember --checkin sleep_hours=7,exercise="chạy 5km",mood_score=4
```

Backfill a past day: add `--date 2026-06-10`. Set a time: `--time 21:30`. When the
person names a past date in their words ("hôm 12/4", "hôm qua", "cuối tuần trước"),
the engine infers the event-date automatically (the reply shows `date_inferred_from`);
still pass `--date` explicitly when you know the exact day — it always wins.

The JSON reply shows `links` and `stubs_created` so you can confirm with the user.

### Emotional relations (when the cause is clear)

When the person says what made them feel something, capture it as a typed line at
the TOP of the entry (right after where mood goes), value = `[[wikilinks]]`:

- `joy::` — what brought joy
- `trigger::` — what triggered a feeling (often negative)
- `with::` — who shared the moment
- `eases::` — what eased a bad feeling

```bash
my-kioku remember --stdin --mood happy/4 <<'EOF'
joy:: [[Chạy bộ]], [[Mẹ]]
trigger:: [[Áp lực công việc]]
Sáng chạy bộ rồi gọi cho mẹ, thấy nhẹ nhõm dù việc đang căng.
EOF
```

Write a relation line ONLY when the cause is clear. If unsure, skip it — `reflect`
will remind you to backfill later. Don't invent a relation the person didn't express.

`tags::` (a comma list of plain words, no `[[ ]]`) is mostly for imported memories;
`reflect` surfaces tags you should turn into wikilinks/relations over time.

## Recall (read)

```bash
my-kioku recall "phở Quảng An"              # full-text search (diacritic-insensitive)
my-kioku recall --entity "Hùng" --since 30d # everything about a person/place
my-kioku recall --relation joy --entity "Mẹ" # entries where Mẹ brought joy
my-kioku recall --digest                    # compact summary (for session start)
```

Combine query + `--relation` + `--since`/`--from`/`--to` freely. Results are JSON
with the verbatim body, mood, links, relations, tags, and entity context.

### Enrich the query first (recall is keyword-driven)

Recall matches on the WORDS in your query — it has no built-in synonyms. Before you
call `recall`, rewrite the user's question into search terms:

- Replace pronouns / vague references with the real `[[Name]]` you know from context
  (the conversation, prior `entity_context`).
- ADD known entity names + a synonym or paraphrase of the user's wording. Mix
  Vietnamese + English freely; **keep the user's language — add terms, never translate
  away the original.**

Recall now matches ANY of the query terms (not all), so MORE relevant terms = better
recall. Examples:

- User: *"lúc nào tôi kiệt sức?"* → recall `"kiệt sức mệt mỏi burnout [[công việc]] deadline"`
- User: *"chuyện với sếp dạo này"* → recall `"[[Hùng]] sếp họp promotion lương"`

An entry must share at least two of your terms to surface (a single shared word is
treated as noise), so give a few specific terms, not one vague one.

## Reflect (the living loop — run on a schedule)

```bash
my-kioku reflect --since 30d
```

`reflect` is read-only analysis. It returns `suggested_actions` (already
prioritized) plus the underlying lint and insight candidates. Handle each action
by its type — work the `suggested_actions` list top to bottom:

- **classify** entities with `type: unknown` — read the entries that mention
  them, decide person/place/event/activity/thing, then edit the entity note's
  frontmatter `type:` (plain file edit). `reflect` may pre-suggest a type in
  `entity_type_suggestions` (e.g. a `joy::`/`with::` target → person) — confirm it
  against the entries before applying. Once typed, `recall --type person` and
  `entity list --type place` can filter/list by type.
- **review alias pairs** — if two names are the same entity, merge them:
  `my-kioku entity merge "bạn Hùng" --into "Hùng"`. **If unsure, ASK the user
  first** (two different people can share a name).
- **fix broken wikilinks** — a `[[Name]]` whose entity note is missing: either
  create the entity note or correct the link in the daily note.
- **backfill links** — for `entries_without_links`, add `[[wikilinks]]` to the
  people/places the entry mentions (edit the daily note). Prioritize entries the
  person recalls often; you do NOT have to fix them all at once.
- **backfill emotional relation** — for `missing_emotional_relation` (strong-mood
  entries with no relation), add a `joy::`/`trigger::`/… line IF the cause is clear
  from the text. If it's not clear, leave it — don't guess.
- **convert tags** — for `tags_to_convert` (imported tags not yet entities), turn a
  tag into a `[[wikilink]]` or relation when it names a real person/place/event.
- **add concept link** — for `concept_bridges` (a recurring tag/theme spanning several
  entries but not yet linked), add the suggested `[[concept]]` to the cited entries
  when the theme is real. Keep the user's wording — only APPEND the link; this connects
  the theme so a later recall finds all of them.
- **mark superseded** — for `superseded_candidates` (an older fact that looks replaced
  by a newer one, e.g. a job change), IF it is truly replaced, add a
  `superseded:: <newer-entry-id>` line to the OLD entry's top fields (alongside
  `mood::`). Don't edit the body. recall then prefers the newer fact for "current/now"
  questions while the old one is still findable for "what was my previous…" questions.
  If it's NOT a real replacement (both still true), skip it.
- **write insight notes** — for an insight candidate you judge real, write a
  short note into `insights/` (a normal file write) citing the evidence entry ids.

Candidates are SUGGESTIONS — you decide. Every finding cites a real file/entry id.

## Forget (privacy / right-to-be-forgotten)

When the person asks to delete or hide something they shared:

```bash
my-kioku forget "2026-06-12#1"            # delete one entry by id
my-kioku forget --entity "Hùng"           # delete every entry linking a person/place
my-kioku forget "2026-06-12#1" --redact   # keep heading + mood, blank only the body
my-kioku forget "2026-06-12#1" --dry-run  # preview what would be removed (no write)
```

- Prefer `--dry-run` first when deleting by `--entity` (it can match several entries)
  — the summary lists every target before you commit.
- `--redact` leaves a `[redacted DATE]` tombstone but keeps the `## HH:MM` heading and
  the mood/relations/tags, so trends stay intact; use it when the person wants the
  fact gone but the moment acknowledged.
- After a delete, later entries in that day are **renumbered** — don't reuse an old
  `date#ordinal`; re-`recall` if you need a fresh id (the response says so).
- The vault is a git repo, so removed text stays in git history. That's an audit
  trail, not a leak — for true hard erasure the person must rewrite git history
  themselves (out of scope for this tool); `--redact` is the in-repo-safe option.

## Anti-patterns (learned the hard way)

- ❌ Summarizing or paraphrasing before saving. Save the raw words.
- ❌ Inventing an entity `type` blindly — let reflect surface it, then classify
  from the actual entries.
- ❌ Typing text as a positional arg with quotes — use `--stdin` heredoc.
- ❌ Merging two same-named entities without checking they're truly the same person.
- ❌ Adding `/intensity` the person didn't express — mood word alone is fine.
- ❌ Inventing a `joy::`/`trigger::` relation the person didn't actually express —
  only write one when the cause is clear; otherwise let `reflect` remind you.
- ❌ Translating mixed-language entries to one language, or renaming an English
  proper noun to Vietnamese (or vice-versa). Mirror what the person wrote.
- ❌ Recalling a raw natural-language question verbatim. Enrich it first —
  pronoun→`[[Name]]`, add known entities + synonyms (see "Enrich the query first").
