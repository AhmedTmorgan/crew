---
name: intake
description: >-
  Fully understand a task before any work starts. The user describes the whole task; you read the
  project, ask about every unclear part up front in rounds, record each answer as a decision, and
  end with a written brief the user explicitly approves. Use at the start of any feature, phase, or
  batch of work run through crew (crew:feature calls it first), or when the user says "I'll describe
  the task", "grill me", "افهم التاسك الأول", "اسألني الأول". Not for one-line fixes.
argument-hint: "[task description]"
---

# Intake: understand the whole task before anyone touches code

You are the orchestrator. The only thing intake produces is **understanding**: a brief the user
has approved. No code, no plan, no dispatch until the user says go. A wrong assumption caught here
costs one question. Caught after three agents built on it, it costs the whole run.

## 1. Listen

Let the user describe the task in full. If they send it in pieces, wait until they say they are done.

## 2. Read before you ask

Never ask something the repository can answer. Before the first question:

- Read `CLAUDE.md` / `AGENTS.md` and `.crew/config.json`, and the journal's open items:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" summary`.
- Map the affected area. For anything beyond a handful of files, launch `Explore` subagents (in
  parallel, one per area) with a precise question: where is X handled, what calls it, which tables
  and routes does it touch, what tests cover it. Keep their conclusions, not their file dumps.
- Note what already exists that the task can reuse, and every open journal entry in this area.

## 3. Draft the brief

Create `.crew/tasks/<slug>/brief.md` (`<slug>` = short kebab-case name of the task) from
[references/brief-template.md](references/brief-template.md). Fill in what you already know. Every
unknown becomes an open question in the brief.

## 4. Ask in rounds

- Use AskUserQuestion, at most 4 questions per round, the most plan-changing first.
- Every question is concrete and has 2 to 4 options. Put your recommended option first, marked
  "(Recommended)", and give each option one line on its trade-off.
- Ask in the user's language (Egyptian Arabic if they write it). Keep code terms in English.
- Cover whatever applies:
  - scope in and out
  - exact behaviour and edge cases
  - data model and migrations
  - roles, tenants, and permissions
  - UI states (empty, loading, error) and copy/i18n
  - integrations and what happens when they fail
  - security and privacy
  - performance
  - acceptance criteria
  - rollout, flags, and backwards compatibility
- After each round, write the answers into the brief as numbered **Decisions** (D1, D2, …) and
  delete the questions they settled. New unknowns an answer uncovers go into the next round.
- Don't ask about things with an obvious convention. Decide them yourself and list them under
  **Assumptions** so the user can veto any of them.
- If an answer contradicts the code, say so with the file and line and ask again. Don't silently
  pick one.

## 5. Readiness check

Stop asking only when all of these hold:

- [ ] The goal and the user-visible result fit in two sentences.
- [ ] Scope in and out is explicit.
- [ ] Every acceptance criterion is testable (a command, a click path, or a query).
- [ ] The backend / frontend / database / integration split is clear, including new tables,
      columns, and migrations.
- [ ] Permissions, and tenant or user isolation if the project has it, are decided.
- [ ] Error and edge-case behaviour is decided.
- [ ] Security-relevant parts are identified: auth, secrets, input from outside, payments,
      personal data.
- [ ] No open question left would change the plan.

## 6. Get the go

Present the final understanding in the user's language:
- the goal
- what will be built (backend / frontend / database)
- what will not be built
- the decisions
- the assumptions
- the acceptance criteria
- the main risks

End with one question: go, or change something. Only an explicit go ends intake. Write
`Approved: <date>` at the top of the brief, then hand control back (to crew:feature step 2, or to
the user if intake ran on its own).
