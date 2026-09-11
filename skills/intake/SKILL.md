---
name: intake
description: >-
  Fully understand a task before any work starts. The user describes the whole task. You read the
  project, then grill them in numbered rounds (❓ question with options, ➡️ your recommendation and
  why) until every decision is settled. Each answer is recorded in a written brief the user
  explicitly approves. Use at the start of any feature, phase, or batch of work run through crew
  (crew:feature calls it first), or when the user says "I'll describe the task", "grill me",
  "افهم التاسك الأول", "اسألني الأول". Not for one-line fixes.
argument-hint: "[task description]"
---

# Intake: understand the whole task before anyone touches code

You are the orchestrator. The only thing intake produces is **shared understanding**: a brief the
user has approved. Write no code, no plan, and dispatch nothing until the user says go. A wrong
assumption caught here costs one question. Caught after three agents have built on it, it costs
the whole run.

The questioning method, with its design tree, frontier, rounds, and the ❓/➡️ format, is adapted
from Matt Pocock's `grilling` skill (MIT). The difference here is that every answer is written into
the brief as it is given, because the build agents never see this conversation.

## 1. Listen

Let the user describe the task in full. If they send it in pieces, wait until they say they are done.

## 2. Read before you ask

Facts are your job, never the user's. Before the first round:

- Read `CLAUDE.md` / `AGENTS.md`, `.crew/config.json`, and the journal's open items:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" summary`.
- Map the affected area. For anything beyond a handful of files, launch `Explore` subagents in
  parallel, one per area, each with a precise question: where is X handled, what calls it, which
  tables and routes it touches, and what tests cover it. Keep their conclusions, not their file
  dumps.
- For library or framework behaviour, check current docs (context7, if available). Don't rely on
  memory.
- Collect evidence you can cite: counts, file:line, what is used and what is dead. Good questions
  come from evidence ("`feedbackDriven` is defined and translated but used 0 times in 333 entries").

## 3. Draft the brief

Create `.crew/tasks/<slug>/brief.md` (`<slug>` = a short kebab-case name for the task) from
[references/brief-template.md](references/brief-template.md). Fill in what you already know.

## 4. Grill in rounds

**Model the task as a design tree.** Every decision has other decisions hanging off it. The
**frontier** is every open decision whose prerequisites are already settled: the questions you can
honestly ask now, without guessing at answers you haven't heard.

**One round asks the whole frontier:** not one question at a time, and not everything at once. Two
questions never share a round if one depends on the other. The dependent one waits for a later round.

Write the round as plain chat text. Don't use AskUserQuestion, which caps a round at 4 short
options. Number questions continuously across rounds (Q1, Q2, … Q9), so answers stay unambiguous.

```
**Round 2**

❓ **Q5 — <short title>**: <the question, with the evidence that raises it (file:line, counts, what
exists today). Then the options, each with its real cost:
(a) … — zero schema change, works retroactively
(b) … — editorial control, but needs a backfill of 114 records
(c) … — most expressive, most expensive>

➡️ **(a)**, <plus any tweak>. <Why: the trade-off that decides it, tied to the evidence and to
earlier answers.>

---

❓ **Q6 — …**
```

- Every question gets a recommendation on its own `➡️` line. Recommend; don't just list options.
- Put the options' consequences in the question itself: what each one costs in schema, backfill,
  routes, security, or effort.
- The user answers by number: `5a, 6a, 7 keep, 8 all as you said`. "زي ما قلت" or "all as you
  said" means accept your recommendations for the rest of the round. If a recommendation argued
  against the question's wording, confirm which way the answer goes before recording it.
- Ask in the user's language (Egyptian Arabic if they write it). Keep code terms and identifiers in
  English.
- **Facts don't block a round.** If a question needs something the repo, tools, or docs can settle,
  dispatch a subagent for it and ask the rest of the frontier now. Only the questions downstream of
  a running lookup wait.
- **Decisions are the user's.** Never answer your own decisions and move on. Anything with an
  obvious convention isn't asked at all: decide it and list it under **Assumptions**, where the user
  can veto it.
- **Record every answer immediately** in the brief as a numbered decision (**D5 — <title>:**
  answer, plus the reason if one was given). Keep exact values, orderings, and "must not" rules
  word for word. The brief is the only thing the backend, frontend, and review agents will read.
- **Recompute the frontier** after each round. Settled answers unblock new questions. An answer
  that contradicts the code, or an earlier decision, reopens that branch with the evidence.
- Cover whatever applies:
  - scope in and out
  - exact behaviour and edge cases
  - data model and migrations
  - roles, tenants, and permissions
  - UI states and copy/i18n
  - URLs and anchors
  - integrations and what happens when they fail
  - security and privacy
  - performance
  - acceptance criteria
  - rollout, flags, and backwards compatibility
- If the user wants one question at a time, do that instead.
- Grill the **whole** feature, however big. This is the only planned conversation before an
  autonomous run that may last hours, so every decision the build needs is taken here. crew:tickets
  splits the work afterwards. Only when the request bundles several unrelated products, propose
  separate runs.

## 5. Readiness check

The frontier is empty, and all of these hold:

- [ ] The goal and the user-visible result fit in two sentences.
- [ ] Scope in and out is explicit.
- [ ] Every acceptance criterion is testable: a command, a click path, or a query.
- [ ] The backend / frontend / database / integration split is clear, including new tables,
      columns, and migrations.
- [ ] Permissions, and tenant or user isolation if the project has it, are decided.
- [ ] Error and edge-case behaviour is decided.
- [ ] The security-relevant parts are identified: auth, secrets, outside input, payments, personal
      data.
- [ ] Nothing is silently assumed. Every assumption is listed in the brief.

## 6. Get the go

An empty frontier isn't the end. The user's confirmation is. Present the final understanding in
their language:
- the goal
- what will be built (backend / frontend / database)
- what won't be built
- the decisions (D-numbers)
- the assumptions
- the acceptance criteria
- the main risks

End with one question: go, or change something. Only an explicit go ends intake. Write
`Approved: <date>` at the top of the brief, then continue with `crew:spec`. If intake ran on its
own, hand back to the user instead.
