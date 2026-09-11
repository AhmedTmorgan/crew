---
name: spec
description: >-
  Turn an approved crew brief into a written spec: problem, solution, a long list of user stories,
  implementation decisions, global constraints, testing seams, security, and out of scope. It is
  synthesis, not a new interview. Use after crew:intake (crew:feature calls it), or when the user
  says "write the spec" / "اكتب الـ spec".
---

# crew:spec

Adapted from Matt Pocock's `to-spec` (MIT), with the "Global Constraints" block from superpowers'
`writing-plans` (MIT).

- **Input:** `.crew/tasks/<slug>/brief.md`, marked `Approved:`.
- **Output:** `.crew/tasks/<slug>/spec.md`, the binding authority for the whole run. Tickets argue
  from it, and reviewers judge against it.

**Don't interview.** Everything needed is already in the brief and the codebase. If writing the spec
exposes a real gap (something the brief never decided and that would change what gets built), ask
it as one grilling round in the ❓/➡️ format, record the answer as a new decision in the brief, and
continue.

## Process

1. **Re-read the brief** and its codebase notes. Explore more only where the spec needs it, using
   `Explore` subagents in parallel.
2. **Choose the seams** where the feature will be tested:
   - Prefer existing seams, as high as possible, and as few as possible. One is ideal.
   - A new seam goes in Testing Decisions with the reason for it. It is shown to the user in the
     ticket summary, not asked separately.
3. **Write `spec.md`** with the template below.
   - Reference the brief's decisions by number (D3, D7) so every decision can be traced.
   - Leave out file paths and code. They go stale. The one exception is a snippet that states a
     decision more precisely than prose can (a type shape, a state machine, a schema).
4. **Self-check before you hand off:**
   - Every D-decision from the brief appears.
   - Every acceptance criterion maps to at least one user story.
   - No placeholders anywhere: no "TBD", no "handle edge cases", no "add validation" without
     saying what.
5. **Optional tracker:** if `.crew/config.json` has `"tracker": "github"`, also publish the spec as
   a GitHub issue (`gh issue create --label crew:spec`) and write its URL at the top of `spec.md`.
   The local file stays the source of truth.

Then continue with `crew:tickets`.

## Template

```markdown
# <Feature> — Spec

Brief: ./brief.md · Written: <date>

## Problem Statement
The problem, from the user's perspective.

## Solution
The solution, from the user's perspective.

## User Stories
A LONG numbered list that covers every aspect of the feature:
1. As a <actor>, I want <feature>, so that <benefit>

## Implementation Decisions
Modules built or changed, their interfaces, schema changes, API contracts (routes, actions, request
and response shapes), and specific interactions. Each one cites its D-number.

## Global Constraints
Project-wide requirements every ticket inherits, one per line, with exact values copied verbatim:
limits, names, copy and i18n rules, URL and anchor rules, security rules, compatibility floors.

## Testing Decisions
What a good test is here (behaviour through public interfaces), the agreed seams, prior art in this
codebase, and the gate commands from .crew/config.json.

## Security & Data
Authentication and authorization, tenant or user isolation, untrusted input, secrets, personal data,
and migration safety (destructive steps, backfills, policies for new tables).

## Out of Scope

## Further Notes
```
