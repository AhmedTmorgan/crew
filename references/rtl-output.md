# Writing to a right-to-left reader

When the user writes Arabic (or any RTL language), everything crew shows them — question rounds,
plan summaries, approval gates, final reports — goes through the Unicode bidirectional algorithm
before it reaches their screen. A line's direction comes from its first strong character, and neutral
characters (digits, `—`, `:`, `(`, `)`, `/`, `·`) attach to whichever side is next to them. A line
that mixes Arabic prose with ticket ids, model names, or counts arrives reordered and unreadable,
even though it looked correct when written.

This is not cosmetic. Crew's whole intake depends on the user being able to read a numbered question
and answer `5a, 6b`. A scrambled round costs a round.

## The rules

1. **Start every Arabic line with an Arabic word.** Never open with `T07`, `Q13`, `BUG-0002`,
   `v0.5`, or a digit — a Latin or numeric first character flips the line.
2. **One direction per line.** Break instead of mixing.
3. **Latin tokens go in backticks, at the end of a line or on their own line.** A code span is
   visually contained, so it disturbs the line far less.
4. **No `—` between Arabic and Latin.** Use a colon or a line break.
5. **Numbers drift mid-sentence.** Put the figure at the end, or in its own table cell. Spell out
   small counts.
6. **Tables: one direction per cell.** Ids, paths, and numbers get their own column.
7. **Short bullets over paragraphs.**
8. **Headings too:** all-Arabic or all-Latin.

Code blocks, diffs, and raw command output are exempt — they are Latin-only and render as-is.

## Question rounds, the shape that survives

```markdown
**الجولة ٢**

**سؤال ٥ — ترميز الأهمية**

الأرشيف كله ١١٤ إصدار، ومنهم ٢٣ مهمّين. الاختيارات:

- **أ** — نستنتجها من رقم الإصدار: مفيش تغيير في الـ schema، ومفيش backfill.
- **ب** — علامة صريحة لكل إصدار: تحكّم أكتر، بس محتاج مرور على ١١٤ سجل.
- **ج** — حقل مستقل للأهمية: أوسع، وأغلى.

➡️ **اقتراحي: أ**، ومعاها علامة يدوية للاستثناءات.
السبب: بيرتّب الأرشيف كله من غير ما حد يفتكر يعلّم حاجة.

الملفات: `buildReleaseRecords` · `content/releases`
```

Every line is single-direction, the option letters are Arabic, the identifiers sit at the end in
backticks, and the answer format (`5أ` or `5a`) still works.

## Reports and the approval gate

- Lead each section with an Arabic heading.
- Numbers go in a table, never inside an Arabic sentence: a column for the figure, a column for what
  it means.
- Ticket ids, branches, PR links, commands: their own column, or their own line in backticks.
- A ruling reads as two short Arabic lines — what was decided, and what it costs if wrong — with any
  identifier at the end.

## When the user writes in English

Ignore all of this and write normally. These rules exist to serve an RTL reader; applied to an
English reader they only add noise.
