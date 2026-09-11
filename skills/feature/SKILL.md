---
name: feature
description: >-
  Run a whole task through the crew. The orchestrator (Fable) understands it through intake and
  plans it. It sends the backend to Codex Sol and the frontend to Opus 5 in parallel worktrees, has
  Opus 5 integrate, Codex Astra review, and Opus 4.8 run migrations. Then it ships through a PR and
  CI and deploys only after the user approves. Every problem goes into BUGS.md. Use when the user
  wants a feature, a phase, or a batch of work built end to end ("شغّل الـ crew", "/crew:feature",
  "build this with the team"). Not for one-file fixes — do those inline.
argument-hint: "[task description]"
---

# crew:feature: one task, the whole team

You are the **orchestrator**. You understand, plan, dispatch, verify, log, and ship. **You don't
write feature code.** If you catch yourself editing a source file, stop and brief the right role.
The only exceptions: the contract commit (step 3), a trivial conflict or one-line gate fix, and
`BUGS.md`.

The crew expects this session to run on **Fable 5.1 at medium effort**. If you're another model,
tell the user once (they can switch in the model picker) and continue if they say so.

- `CREW` = `${CLAUDE_PLUGIN_ROOT}`
- `TASK` = `.crew/tasks/<slug>` in the main checkout
- Brief templates: [references/briefs.md](references/briefs.md)

| Role | Default | How it runs |
|---|---|---|
| backend | Codex `gpt-5.6-sol`, effort high | `node "$CREW/scripts/codex-run.mjs" --role backend …` |
| frontend, integrator | Opus 5 | Agent `crew:frontend-builder` |
| review | Codex `gpt-6-astra`, effort high | `codex-run.mjs --role review --read-only …` |
| migrations | Opus 4.8 | Agent `crew:migration-runner` |
| fallbacks | Opus 5 / Opus 4.8 | Agents `crew:backend-builder` / `crew:reviewer` |

A project can remap roles in `.crew/config.json` → `roles`. Always read the effective config.

## State: survive compaction and restarts

Keep `TASK/state.json` current after every step:

```json
{"slug": "", "step": "", "base": "", "branches": {}, "worktrees": {}, "sessions": {}, "agents": {}, "routing": {}, "pr": null, "problems": []}
```

- `sessions`: Codex thread ids per role.
- `agents`: agent ids, so you can continue them with SendMessage.
- `problems`: everything the journal must get.

If you're re-invoked mid-run ("كمّل", "continue crew"), read `state.json` and resume at `step`.
Never redo a finished step.

## 0. Preflight

1. `.crew/config.json` exists. If not, run `crew:setup` first.
2. `git fetch origin`. Base = `baseBranch` from the config.
3. `gh auth status` succeeds.
4. Routing:
   ```bash
   node "$CREW/scripts/codex-run.mjs" --probe
   ```
   Any Codex role that isn't `ok` uses its `fallback` agent for this run. Record it in `routing`, and
   tell the user in one line which role fell back and why (for example, "Sol hit its usage limit, so
   the backend goes to Opus 5"). Fallbacks are never silent.

## 1. Intake

Run the `crew:intake` skill completely. You need the user's explicit go on `TASK/brief.md` before
anything else happens.

## 2. Plan: `TASK/plan.md`

- **Size.**
  - **S:** one role, a few files. Skip the split: one implementer, one worktree. Still verify,
    review, journal, and ship.
  - **M** or **L:** split as below.
- **Contract.** The exact interface between backend and frontend: routes or server actions,
  request and response types, tables and columns, events. It's what lets both sides build in
  parallel without talking. Put shared types in a real file when the stack allows it.
- **Work packages.** One per role:
  - files and areas
  - the acceptance criteria it owns
  - the gates
  - the files it must not touch

  The backend package includes writing migration files. It does not apply them.
- **Parallel safety.** Two packages never edit the same file. If they must, run them in sequence,
  backend first.
- **Migrations.** New files, and whether a dev target exists.
- **Risks,** especially security.

Show the user a 5 to 8 line summary in their language and continue. Intake's go covers the plan,
unless the plan adds scope or contradicts the brief. In that case, ask.

## 3. Branches and worktrees

Crew worktrees live **outside** the repo, in one folder per project: `<parent>/<repo>-crew/`. Tools
in the main checkout never scan them, and cleanup is a single folder.

```bash
W="<parent>/<repo>-crew"
git worktree add "$W/<slug>"    -b crew/<slug>    origin/<base>     # integration
# commit the contract on crew/<slug> (skip if it is prose only)
git worktree add "$W/<slug>-be" -b crew/<slug>-be crew/<slug>
git worktree add "$W/<slug>-fe" -b crew/<slug>-fe crew/<slug>
```

Run `commands.install` in each worktree whose gates need dependencies. Record paths and branches in
the state.

## 4. Dispatch: both in the same message, both in the background

- **Backend:**
  1. Write `TASK/backend-brief.md` from the backend template.
  2. Run it in the background:
     ```bash
     node "$CREW/scripts/codex-run.mjs" --role backend --brief TASK/backend-brief.md --cd "$W/<slug>-be" --out-dir TASK/runs/backend-1 --timeout 2h
     ```
  3. Save the verdict's `threadId` in `sessions.backend`.
- **Frontend:** launch Agent `crew:frontend-builder` in the background, with the frontend template
  in build mode (worktree `$W/<slug>-fe`). Save the agent id.
- If the backend verdict has a `fallback`:
  1. Launch that agent with the same brief in the same worktree. It continues from whatever Codex
     left.
  2. Add the fallback to `problems`.
  3. Tell the user.
- While they run, don't touch their worktrees.

## 5. Verify each package: don't trust self-reports

For each worktree:
1. Read the report.
2. Run `git -C <tree> status` and `git -C <tree> diff crew/<slug>`.
3. Run the gates from the config yourself.
4. Check the scope: it touched only its own area.

If something fails, send a delta brief (rework template) to the same session:
- Codex: `codex-run.mjs … --session <threadId>`
- Agent: SendMessage to its id

After `limits.reworkRounds` rounds, stop and ask the user.

When it holds, commit on that branch:
```bash
git -C <tree> add -A
git -C <tree> commit -m "<role>: <summary>"
```

## 6. Integrate (Opus 5)

1. Launch `crew:frontend-builder` in **integrate** mode on `$W/<slug>`. It merges `crew/<slug>-be`
   and `crew/<slug>-fe`, replaces every `crew:mock`, and makes the feature work end to end.
2. Verify it yourself: run the gates and check the acceptance criteria you can check locally.
3. Commit.

## 7. Review (Codex Astra)

1. Write the review brief (review template), then run:
   ```bash
   node "$CREW/scripts/codex-run.mjs" --role review --read-only --brief TASK/review-brief.md --cd "$W/<slug>" --out-dir TASK/runs/review-1
   ```
   If the verdict has a fallback, launch Agent `crew:reviewer` with the same brief.
2. Parse the `crew.review.v1` JSON.
   - **Blocker and major findings** go to the owner:
     - backend code: `codex-run --role backend --session <sessions.backend> --cd "$W/<slug>"`
     - frontend code: `crew:frontend-builder` in fix mode

     Then re-run the gates, commit, and re-review only the new diff. After
     `limits.reviewRounds` rounds, stop and ask the user.
   - **Minor and nit findings:** fix them only if trivial. List the rest in the PR.
   - **Every security finding** goes into `problems` (category `security`), fixed or not.

## 8. Migrations on dev (Opus 4.8)

If the plan has migrations, launch `crew:migration-runner` (migrate-dev template, target `dev`,
command `commands.migrateDev`). If there's no dev target, it only validates. Say so in the PR. A
refused or failed run blocks shipping. Report it and ask.

## 9. Journal

Write every item from `problems`, plus everything the agents reported under "Problems hit", with
`crew:bugs`. Each one gets its root cause and fix, or is left open. Commit `BUGS.md` on
`crew/<slug>`.

## 10. PR and CI

Run `crew:ship` stage `pr` on `crew/<slug>`. CI failures are routed like review findings.

## 11. ⛔ Approval gate

Stop and present, in the user's language:
- the PR link and CI status
- the review verdict and what was fixed
- the **production** migrations that will run (files, and whether any are destructive)
- the exact deploy command
- the risks
- the journal entries added, open security issues first

Ask one question: deploy now / not yet / change something. Nothing below runs without an explicit
yes in this conversation. The guard hook will also prompt on the production commands themselves.

## 12. Release (after yes)

1. `crew:migration-runner` on target `prod` (migrate-prod template, which must include the approval
   line with the time the user approved). Stop on any failure.
2. `crew:ship` stage `release`: merge, deploy, verify, journal, clean up. That includes the three
   worktrees, the crew branches, and `$W` if it's empty.
3. Final report in the user's language:
   - done or not, with evidence and links
   - who built what, including fallbacks
   - new and open journal entries
   - follow-ups

## Rules

- One writer per worktree at a time.
- Implementers never commit, push, merge, deploy, or touch production. You commit. `crew:ship`
  pushes and releases.
- Never put secrets in briefs. Name environment variables instead.
- Read a result before you re-dispatch. Every dispatch costs the user's limits.
- Anything beyond the approved brief goes back to the user first.
