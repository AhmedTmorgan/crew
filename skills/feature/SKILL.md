---
name: feature
description: >-
  Run a whole feature, or a whole phase of a project, through the crew from start to finish. Fable
  grills the user about the entire thing once (intake), writes the spec, and splits it into tickets.
  After a single go, crew:run builds everything autonomously: Codex Sol on the backend, Opus 5 on
  the frontend, Codex Astra reviewing every ticket, Opus 5 on migrations. It keeps going for hours
  if needed, across compaction and new sessions, and stops only at the deploy approval. Use when the
  user wants something built end to end ("شغّل الـ crew", "/crew:feature", "build this with the
  team"). Not for one-file fixes.
argument-hint: "[feature description]"
---

# crew:feature: one conversation, then the team builds it

You are the **orchestrator**. You talk to the user only twice:
1. **Intake:** everything gets asked up front.
2. **The approval gate before deploy.**

In between, the crew works alone. The user will be away, so never block on them for anything
outside the four stop classes in `crew:run`.

Crew expects this session to run on **Fable 5.1 at medium effort**. If you're another model, say so
once (the user can switch in the model picker) and continue if they agree.

## 0. Preflight

1. `.crew/config.json` exists. If not, run `crew:setup` first.
2. `git fetch origin` succeeds, `gh auth status` succeeds, and the base branch is known.
3. If `.crew/active-run` exists, a run is already in progress. Offer to resume it
   (`crew:run` resume mode) before starting anything new.

## 1. `crew:intake`: the whole feature, once

Grill the user about **everything**, in numbered rounds with recommendations, until the frontier is
empty. That includes scope, behaviour, data, UI, security, and acceptance. This is the only planned
conversation, so be thorough here rather than asking later.

**Output:** `.crew/tasks/<slug>/brief.md`, with the user's explicit go.

## 2. `crew:spec`

**Output:** `.crew/tasks/<slug>/spec.md`, made by synthesis with no new interview. Ask only about a
real gap, as one round.

## 3. `crew:tickets`

**Output:** tracer-bullet tickets with blockers, Layers, and Touches, validated with
`tickets.mjs validate`.

Show the breakdown, then ask **one** round that covers the granularity and edges and **the go for
the autonomous run.**

## 4. `crew:run`: autonomous until the approval gate

It does all of this on its own:
- frontier-first parallel build in worktrees
- a review and fix loop on every ticket
- a merge into `crew/<slug>` after each ticket
- journal entries per ticket
- the final whole-branch review
- migrations on dev
- the PR and the CI fix loop

The keep-going hook keeps the session working while tickets remain. A new session resumes from the
ledger when the user says "كمّل".

## 5. ⛔ Approval gate

This comes from `crew:run` §7. The user sees:
- what was built
- every ruling made on their behalf
- parked findings and fallbacks
- journal entries, security first
- the PR and CI status
- the production migrations
- the deploy command

Nothing reaches production without their explicit yes in chat. The guard hook also prompts on the
production commands themselves.

## 6. Release (after yes)

Run `crew:run` §7 step 6: production migrations (Opus 5), then `crew:ship` release (merge,
deploy, verify), then journal, cleanup, and the final report.
