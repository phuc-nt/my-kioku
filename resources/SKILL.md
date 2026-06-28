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

Backfill a past day: add `--date 2026-06-10`. Set a time: `--time 21:30`.

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

## Reflect (the living loop — run on a schedule)

```bash
my-kioku reflect --since 30d
```

`reflect` is read-only analysis. It returns `suggested_actions` (already
prioritized) plus the underlying lint and insight candidates. Handle each action
by its type — work the `suggested_actions` list top to bottom:

- **classify** entities with `type: unknown` — read the entries that mention
  them, decide person/place/event/activity/thing, then edit the entity note's
  frontmatter `type:` (plain file edit).
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
- **write insight notes** — for an insight candidate you judge real, write a
  short note into `insights/` (a normal file write) citing the evidence entry ids.

Candidates are SUGGESTIONS — you decide. Every finding cites a real file/entry id.

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
