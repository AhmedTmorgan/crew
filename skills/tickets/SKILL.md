---
name: tickets
description: >-
  Break an approved crew spec into tracer-bullet tickets: small vertical slices through every layer,
  each with acceptance criteria, blocking edges, the layers it touches (which decides whether Codex
  or Opus builds it), and the areas it touches (which decides what can run in parallel). Writes one
  file per ticket under .crew/tasks/<slug>/tickets/ and validates the graph. Use after crew:spec, or
  when the user says "split this into tasks" / "قسّم الشغل".
---

# crew:tickets

Adapted from Matt Pocock's `to-tickets` (MIT).

**Input:** `.crew/tasks/<slug>/spec.md`.
**Output:** `.crew/tasks/<slug>/tickets/NN-<kebab-title>.md`, numbered from `01` in dependency order
(blockers first).

## 1. Draft vertical slices

- Each slice cuts a narrow but **complete** path through every layer it needs (schema, API, UI,
  tests). It is vertical, never one horizontal layer on its own.
- A finished slice can be demoed or verified on its own.
- Each slice fits a single fresh context window. When in doubt, split it.
- Prefactoring comes first: make the change easy, then make the easy change.
- **Wide refactors** are the exception. A wide refactor is one mechanical change whose blast radius
  crosses the codebase (renaming a column, retyping a shared symbol). Sequence it as
  **expand → migrate in batches → contract**, with each batch its own ticket blocked by the expand
  ticket, and the contract ticket blocked by every batch.

## 2. Wire the graph

- **Blocked by:** only the tickets that genuinely gate this one. Fewer edges means more parallelism.
- **Layers:** these decide who builds the ticket.
  - `backend` or `db` → the backend role (Codex `gpt-5.6-sol` by default).
  - `frontend` → the frontend role (Opus 5).
  - Both → the backend part first, then the frontend part, on the same ticket branch.
- **Touches:** the directories, modules, and tables the slice will change. Two tickets that could
  run at the same time must not share a Touches entry. If they have to, add a blocking edge between
  them.
- **Contract first:** when a ticket's backend and frontend parts go to different implementers, its
  Notes must pin the contract exactly (types, route or action names, response shape).

## 3. Write one file per ticket

```markdown
# 03: <Ticket title>

**Status:** todo
**Blocked by:** 01, 02
**Layers:** backend, frontend
**Touches:** changelog page, release-records search index
**Size:** M

## What to build
The end-to-end behaviour this ticket makes work, from the user's perspective.

## Acceptance criteria
- [ ] Criterion (testable: a command, a click path, or a query)

## Notes
Spec decisions that bind this ticket (D-numbers), the contract it defines or consumes, the seams
to test at, and security notes.
```

- **Blocked by:** use `None` for a ticket that can start immediately.
- **Layers:** any of `backend`, `frontend`, `db`, `infra`, `docs`.
- **Size:** `S`, `M`, or `L`.
- Avoid file paths and code snippets. The only exception is a snippet that pins a contract.

Validate, then list:

```bash
T="${CLAUDE_PLUGIN_ROOT}/scripts/tickets.mjs"
node "$T" validate --task <slug>   # unknown blockers, cycles, missing fields, overlapping parallel Touches
node "$T" list --task <slug>
```

Fix everything `validate` reports before going on.

## 4. One question round, then the autonomous run

Show the breakdown as a numbered list, one line per ticket: title · blocked by · layers · what it
delivers. Say how many can run in parallel at the start.

Then ask **one** grilling round (❓/➡️) that covers:
- the granularity (too coarse or too fine)
- the blocking edges
- any merges or splits
- the go for the autonomous run

From the go onwards, `crew:run` works through every ticket without stopping to check in. It stops
only for the four stop classes defined in `crew:run`.

## Optional: mirror to GitHub

If `.crew/config.json` has `"tracker": "github"`:
- Create one issue per ticket, in dependency order, labelled `crew:ticket`.
- Reference the blockers by issue number.
- Write `**Issue:** #N` into each ticket file.

The local files stay the source of truth for the run. The orchestrator closes each issue when its
ticket merges.
