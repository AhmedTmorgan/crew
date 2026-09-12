---
name: run
description: >-
  Execute an approved crew ticket set autonomously, for as long as it takes — hours, a whole day,
  across compaction and new sessions. It works frontier-first and in parallel worktrees: backend
  goes to Codex Sol and frontend to Opus 5. Every ticket gets a spec-and-quality review (Codex
  Astra) and a bounded fix loop, then merges into the feature branch and gets its journal entries.
  The run ends with a whole-branch review, migrations on dev, and a PR, then stops at the approval
  gate. Use after crew:tickets gets the go, or when the user says "continue the run" / "كمّل".
---

# crew:run: work the tickets until they're all done

Adapted from superpowers' `subagent-driven-development` (MIT, Jesse Vincent) and Matt Pocock's
`implement-spec` (MIT). Staying alive across turns is inspired by the `ralph-loop` plugin
(Apache-2.0), reimplemented as crew's `keep-going` hook.

You are the **controller**. You dispatch, verify, route, merge, and keep the ledger. **You never
write feature code, and you never fix review findings yourself.** Controller fixes pollute your
context and skip review.

```bash
T="${CLAUDE_PLUGIN_ROOT}/scripts/tickets.mjs"
C="${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.mjs"
P="${CLAUDE_PLUGIN_ROOT}/scripts/review-package.mjs"
W="<parent of repo>/<repo>-crew"      # all crew worktrees for this project
TASK=".crew/tasks/<slug>"             # in the main checkout
```

- Brief templates: [references/briefs.md](references/briefs.md).
- Roles: `.crew/config.json` → `roles`, read through the effective config.

## Continuous execution: rulings, not stalls

The user answered everything during intake and said go. **Don't check in between tickets**, don't
ask "should I continue?", and don't send progress summaries. Execute.

Conflicts, ambiguities, plan defects, a cap you'd like to exceed: **decide them.**
- The spec is the binding authority, the tickets argue from it, and your judgment settles what
  neither answers.
- Record each decision with `node "$T" note "Ruling: <what you decided> — <why> — <what it costs if wrong>"`,
  and keep going.
- A wrong ruling costs rework the user can see and undo. A run parked on a question costs their
  whole day.

**Only four things stop the run:**
1. **Something irreversible or destructive:** production data, deleting anything that isn't crew's,
   a force-push.
2. **Something security-sensitive beyond the spec:** secrets, a change to the auth or permission
   model, switching off a check.
3. **A side effect outside the crew branches:** merging to the base branch, pushing to a shared
   branch, deploying, production migrations, sending or publishing anything. These come at the end
   anyway, through the ship phase and the approval gate.
4. **A plan so broken that every way forward is a guess.**

To stop:
1. Run `node "$T" run pause --reason "<the decision needed>"`.
2. Explain it to the user in their language, with the options and your recommendation.
3. Mark the affected ticket `needs-human`.
4. Keep working on every other ticket that doesn't depend on it.

## What lives where

| Path | What it holds |
|---|---|
| `TASK/spec.md` | The authority. |
| `TASK/tickets/NN-*.md` | Requirements. Their `**Status:**` line is the progress. |
| `TASK/ledger.md` | Append-only: starts, verdicts, fix rounds, rulings, parked findings, completions. |
| `TASK/run.json` | The run's state, read by the keep-going hook. Changed only through `tickets.mjs run …`. |
| `TASK/runs/NN/` | That ticket's briefs, reports, review packages, and verdicts. |

**Memory doesn't survive compaction.** After compaction, or in a new session, trust the ledger, the
ticket statuses, and `git log` over your own recollection. Never re-dispatch a ticket that is
`done`. The most expensive failure seen in practice is a controller that lost its place and redid
finished work.

## 0. Start or resume

**New run:**
1. `node "$T" run start --task <slug>`.
2. `git fetch origin`.
3. `git worktree add "$W/<slug>" -b crew/<slug> origin/<base>`: the integration tree.
4. Install dependencies there if the gates need them.
5. Record the base commit: `node "$T" note "base <sha7>, integration tree $W/<slug>"`.
6. **Explore once, for every agent** (see `crew:context-economy`). Send one `Explore` subagent per
   area the spec touches (in parallel, cheap model) and have each write `TASK/notes/<area>.md`: the
   files that matter, the patterns to follow, the traps, the existing tests. For an area nobody has
   mapped, add a compressed map beside it:
   `npx --yes repomix <dir> --compress --stdout --style plain > TASK/notes/<area>.map.txt`
   (measured 62% smaller than the raw files). Every brief points at these notes, so no implementer
   pays to rediscover the same code.
7. Probe the Codex roles with `node "$C" --probe`, and record the routing in the ledger. Any Codex
   role that isn't ok uses its fallback agent for the whole run. Tell the user in one line.
   **A passing probe is not a promise of quota.** It proves the CLI, auth and model are reachable;
   a real turn can still hit the account's usage limit on its first message. When it does, the
   verdict carries `kind: usage_limit` and a `fallback`, and crew remembers the reset time — later
   dispatches of that model return the fallback in milliseconds. Switch the role for the rest of
   the run, ledger it as a ruling, and say so in the final report.

**Resume** (new session, "كمّل", or after a pause):
1. `node "$T" run resume --task <slug>`. This rebinds the run to this session.
2. Read the last 40 lines of the ledger and `node "$T" summary`.
3. For each ticket left `in-progress`, `review`, or `fixing` by a dead session: inspect its worktree
   (`git -C … status`, `git log`, and its report), then finish it from there or restart it
   deliberately. Record the ruling.

## 1. The loop

1. Run `node "$T" frontier --json`. It lists the tickets that are todo, have every blocker
   finished, don't overlap in Touches with in-flight work, and fit the parallel limit.
2. Dispatch **every** ready ticket in one message, in the background (§2).
3. While work is in flight, keep doing local bookkeeping. When you're idle, end the turn. The
   completion notifications will wake you.
   - The keep-going hook lets you wait only while in-flight tickets are genuinely alive: no report
     newer than the ledger's last word on them, and file activity within `keepGoing.staleMinutes`
     (45 by default). A finished report nobody acted on, or a silent worker, brings you back.
   - Never poll tightly. When you come back after a long wait, reconcile: list your live children
     and chase any that finished without reporting. A worker that is gone gets re-dispatched from
     what its worktree holds, with a ruling; one that is alive but slow gets
     `tickets.mjs run wait --reason "T<NN> still working: <what>"`.
   - **Writes to external services** (creating something at a provider's API, sending a message,
     changing a third-party account) are stop class 3, even as a "live proof". Prove against a
     sandbox, a dry run, or a read-only call; if only a real write can prove it, pause and ask, and
     never do it on a customer's account. Projects list such commands in
     `guard.externalWritePatterns` so the guard prompts on them.
4. As each ticket reports: verify → review → fix loop → merge → complete (§3–§6).
5. Go back to step 1.

When no ticket is left todo or in flight, go to the final phase (§7).

## 2. Dispatch one ticket

- **Worktree,** from the current integration head, so it includes everything already merged:
  `git worktree add "$W/<slug>-t<NN>" -b crew/<slug>-t<NN> crew/<slug>`. Install dependencies if
  the gates need them.
- **Model:** read the ticket's `**Size:**` and take the model and effort from
  `models.implementerBySize`. State both in the dispatch.
- **Record BASE:**
  1. `BASE=$(git -C "$W/<slug>-t<NN>" rev-parse HEAD)`.
  2. `node "$T" set <NN> in-progress --note "base <sha7>, <who builds it>"`.
- **Write the brief** to `TASK/runs/NN/brief.md` from the matching template.
  - Point to `spec.md` and the ticket file. Don't paste them.
  - Add:
    - the Global Constraints, verbatim
    - the interfaces from already-merged tickets (names and types)
    - your ruling on any ambiguity you noticed
    - the gate commands
    - the report contract
  - **A dispatch describes one ticket, never the session's history.**
- **Route by Layers:**
  - **backend / db:**
    1. Run `node "$C" --role backend --brief TASK/runs/NN/brief.md --cd "$W/<slug>-t<NN>" --out-dir TASK/runs/NN/impl-1 --timeout 2h`
       in the background.
    2. Record the verdict's `threadId` in the ledger.
  - **frontend:**
    1. Launch Agent `crew:frontend-builder` in the background: "Mode: build. Read <brief path>
       first; it is your requirements."
    2. Record the agent id.
  - **Both:**
    1. The backend part goes first.
    2. Verify it.
    3. Then the frontend-builder does the frontend part in the **same** worktree, with the
       backend's report as its contract.

    Other tickets keep running in parallel meanwhile.
  - **Fallback:** if a Codex verdict comes back with `fallback`:
    1. Dispatch that agent with the same brief in the same worktree. It continues from whatever
       Codex left behind.
    2. Ledger a ruling for it.
    3. Add a journal entry for it later.
- **Batch tiny, same-shape tickets** (the same small edit across several files) into one dispatch
  and one review.

## 3. Verify: don't trust the report

Handle the report status:
- **DONE:** go ahead and verify.
- **DONE_WITH_CONCERNS:** read the concerns first. Resolve correctness or scope concerns before
  review.
- **NEEDS_CONTEXT:** provide the missing context and re-dispatch.
- **BLOCKED:** change something before retrying: more context, a stronger model, a smaller split,
  or a ruling on a plan defect. Never retry the same thing unchanged.

Then verify it yourself:
1. `git -C <wt> status` and the diff against BASE.
2. Run the gates from the config yourself.
3. Check the scope against the ticket's Touches.

When it holds:
1. `git -C <wt> add -A`.
2. `git -C <wt> commit -m "T<NN>: <title>"`.
3. `node "$T" set <NN> review`.

## 4. Task review: spec compliance, then quality

1. Build the review package:
   `node "$P" --cd <wt> --base <BASE> --head HEAD --out TASK/runs/NN/review-1.diff`.
2. Write the task-review brief, then dispatch it:
   `node "$C" --role review --read-only --brief TASK/runs/NN/review-brief.md --cd <wt> --out-dir TASK/runs/NN/review-1`.
   If the verdict has a fallback, use Agent `crew:reviewer` instead.
3. Parse the `crew.review.v1` JSON.
   - **`cannotVerify` items:** check them yourself. You hold the cross-ticket context. A real gap
     joins the findings.
   - **Minor findings:** record each one with `node "$T" note "T<NN>: minor (deferred): <one line>"`.
     They never enter the loop.
   - **Security findings:** they go into the journal, fixed or not.
   - **`verdict: approve`:** go to §6.
   - **A spec failure, or any critical or important finding:** go to §5. First, rule on any finding
     that conflicts with the spec or ticket text, and ledger the ruling.

## 5. The fix loop: up to `limits.fixRounds` rounds (default 5)

1. Run `node "$T" set <NN> fixing`.
2. **Rounds 1 to 3:** resume the **same** implementer with the findings verbatim. Its context is
   intact.
   - Codex: `node "$C" --role backend --session <threadId> --cd <wt> …`.
   - Agent: SendMessage.

   It fixes the findings, re-runs the tests that cover them, and appends a fix report.
3. **Rounds 4 and 5:** send a **fresh implementer one tier up** (`escalation` role, or
   `crew:backend-builder` for a stuck frontend), with this framing: "A prior implementer tried this
   N times; you own it now. Read the reports."
4. **Every round:**
   1. Commit.
   2. Build a scoped package from the head the last review saw (FIX_BASE) to HEAD.
   3. Send the re-review brief.
   4. Ledger the round: `T<NN>: fix round R/5 (X addressed, Y open — …; commits a..b)`.
5. **The breaker:** if findings are still open after the last round, stop dispatching and judge each
   open finding yourself.
   - Park it with a ruling (`T<NN>: parked — <finding> — Ruling: <why the code stands>`).
   - Or, if it's load-bearing, rule on the smallest change that unblocks the tickets that depend on
     it, and carry that ruling into their dispatches.

   Judge only at the cap, and ledger every judgment. A silent discard is forbidden.

   **Hard limit — never parkable:** a `critical` finding, or any finding with `"security": true`.
   These cannot be deferred by a ruling, at any round count. Either it gets fixed (escalate the
   model, split the ticket, or fix the plan defect that causes it), or the ticket goes
   `needs-human` with a journal entry (`crew:bugs`, category `security` or severity `critical`)
   and the run pauses with the reason. `tickets.mjs run phase ship` refuses mechanically while any
   such journal entry is open, however many rounds ran.

## 6. Merge and complete

1. **Merge** in the integration tree: `git -C "$W/<slug>" merge --no-ff crew/<slug>-t<NN> -m "T<NN>: <title>"`.
   - If it conflicts, send `crew:frontend-builder` in integrate mode to the integration tree. It
     must keep both tickets' behaviour. Then verify its work.
2. **Run the gates** on the integration tree. If they're red, resume the ticket's implementer on the
   integration tree.
3. **Clean up:**
   1. `git worktree remove "$W/<slug>-t<NN>"`.
   2. `git branch -d crew/<slug>-t<NN>`.
4. **Record completion:** `node "$T" set <NN> done --note "commits a..b, review clean | K parked"`.
   If there's a GitHub mirror, close the ticket's issue.
5. **Journal:** record every problem this ticket hit now, through `crew:bugs`, with its root cause
   and fix, or left open. Don't batch these to the end, because the run can die.
6. Go back to the loop (§1).

## 7. Final phase

1. **Final review:**
   1. `node "$T" run phase final-review`.
   2. Build the package from the base commit to HEAD on the integration tree.
   3. Dispatch the final-review brief with `--role finalReview` (Astra at effort xhigh). Point it at
      the ledger's deferred minors and parked lines.
   4. Send **one** fix wave: one implementer with the complete findings list, not one per finding.
   5. Run one scoped re-review.
   6. Judge whatever is left, as with the breaker.
2. **Migrations:** `node "$T" run phase migrations`. If there are new migrations, send
   `crew:migration-runner` to dev.
3. **Journal:** a final pass through `crew:bugs`, then commit `BUGS.md` on `crew/<slug>`.
4. **Ship:** `node "$T" run phase ship`, then `crew:ship` stage `pr`: push, PR, and the CI fix
   loop. Before a long CI watch, run `node "$T" run wait --reason "CI on PR #N"`.
5. **Hand over:** `node "$T" run phase awaiting-approval`. The keep-going hook lets the session stop
   here. The final report, in the user's language, covers:
   - what was built, ticket by ticket
   - **"Rulings I made":** every `Ruling:` line from the ledger, in order, each with what it costs if
     wrong
   - parked findings and fallbacks
   - journal entries, security first
   - the PR and CI status
   - the production migrations and the deploy command
   - the approval question (deploy now / not yet / change something)
6. **After an explicit yes:**
   1. `node "$T" run phase releasing`.
   2. `crew:migration-runner` on prod.
   3. `crew:ship` stage `release`.
   4. `node "$T" run finish`.
   5. Remove every crew worktree, and `$W` if it's empty.

## Models and cost

Measured on the first real run (7 tickets, 5 finished, 326M tokens): **implementers were 69% of the
bill, the orchestrator 28%, and every review together 4%.** One implementer alone burned 85M in 308
turns. So the dial that matters is the implementer's model and how long it runs — not the reviews.

- **Pick the implementer's model by the ticket's Size**, from `models.implementerBySize`
  (default: S and M → Sonnet, L → Opus), and the reviewer's from `models.reviewerBySize`. Pass the
  model explicitly on every dispatch; never leave a subagent on the session default, which is the
  most expensive model you have.
- **Escalate on evidence, not on a hunch:** a ticket that comes back BLOCKED, or fails its second
  fix round, earns the next model up. Record the escalation as a ruling.
- **`limits.maxAgentTurns` (120) is a sizing signal, not a budget to spend.** An implementer still
  working past it was given too much: tell it to report what is done and what is left, then split the
  rest into a new ticket rather than letting it run to 300 turns.
- **Explore once per run, not once per agent.** Before the first dispatch, send one `Explore`
  subagent per area the spec touches and have it write `TASK/notes/<area>.md`: the files that matter,
  the patterns to follow, the traps. Point every brief at those notes. Otherwise each fresh agent
  re-reads the same code, and that is most of the early turns.
- A dispatch prompt holds pointers and one ticket, never pasted history. Reports go to files, and
  final messages stay short.
- Read a result before you re-dispatch. Every dispatch costs the user's limits.
- **Parallelism does not save tokens, it spends them faster.** On one provider's quota, 3 agents at
  once reach the limit 3× sooner. Lower `limits.parallel` when the quota matters more than the
  wall clock.

## Common rationalizations

| Excuse | Reality |
|---|---|
| "I'll fix it myself, it's faster" | Controller fixes skip review and pollute your context. Resume the implementer. |
| "Close enough on the spec" | A spec gap means not done. Fix it, or hit the cap and judge it. |
| "Let me ask the user just this once" | Only the four stop classes stop the run. Rule, ledger it, continue. |
| "One more round will converge" | Past the cap, rounds don't converge. Judge the findings and route them. |
| "Ledger bookkeeping is overhead" | The ledger is what survives compaction and new sessions. |
| "The implementer's report says tests pass" | Run the gates yourself. Evidence before claims. |
