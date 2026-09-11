---
name: ship
description: >-
  Take verified work from a branch to production safely with git and GitHub. Stage "pr": commit,
  push, open a PR, watch CI, and fix failures until green. Stage "release", only after the user
  explicitly approves in chat: merge, run the project's production migrations and deploy command,
  verify the live site, record problems in BUGS.md, and clean up branches and worktrees. Use for
  "ارفع الشغل", "push", "open a PR", "ship it", "deploy", or as steps 10–12 of crew:feature.
argument-hint: "[pr | release] [branch or PR number]"
---

# crew:ship

Read `.crew/config.json` first. The `baseBranch` and `commands` in it are the only commands you
use for gates, migrations, and deploys. Never improvise a production command. If one is `null`,
stop and ask.

## Stage `pr`

1. **Preconditions.** The work is committed on a non-base branch, and the gates pass *in this
   tree*: run `typecheck`, `lint`, `test` from the config yourself. Don't take anyone's word for it.
2. **Journal.** The problems this work hit are in `BUGS.md` (crew:bugs). Commit the journal on the
   same branch.
3. **Sync.** `git fetch origin` then rebase on or merge `origin/<base>`. Resolve conflicts and
   re-run the gates. If `BUGS.md` conflicted or merged, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" check --fix`.
4. **Push.** `git push -u origin <branch>`. If a sandbox blocks the network, retry that one
   command with the sandbox disabled. Never `--force` a shared branch; `--force-with-lease` only on
   your own crew branch after a rebase.
5. **Open the PR.**
   ```bash
   gh pr create --base <base> --head <branch> --title "<type>: <summary>" --body-file <file>
   ```
   PR body sections, short:
   - **What & why:** from the brief.
   - **How:** the plan, including who built what and any fallbacks.
   - **Review:** the reviewer's verdict and what was fixed.
   - **Migrations:** which files; applied to dev yes or no.
   - **Journal:** the BUGS ids added or updated, open security issues first.
   - **Test plan:** the acceptance criteria.
6. **CI.**
   ```bash
   gh pr checks <n> --watch --interval 30
   ```
   Run it in the background. When it finishes, check the result. On failure:
   - `gh run view <run-id> --log-failed`
   - find the cause and route the fix to the role that owns that code (in crew:feature), or fix a
     trivial gate issue yourself
   - re-run the gates locally, push, and watch again
   - after `limits.ciFixRounds` rounds, stop and report

   If CI is red for a reason unrelated to this PR, say so with evidence. Don't "fix" unrelated code.
7. **Bot reviews (optional).**
   - If review bots or people comment, run the `crew:babysit-pr` skill: verify, fix, reply, resolve.
   - For a posted two-model review, run `crew:debate-review` on the PR.
8. **Report.** PR link, CI status, open review threads, what's needed for release.

## Stage `release`: only after explicit approval

Approval must be the user's own words in this conversation, given after they saw what will run:
- the PR
- CI status
- the migrations for PROD
- the deploy command

"Ship it" earlier in the task doesn't count as approval to deploy. Ask at the gate. The guard hook
also prompts on the production commands themselves. That is a second lock, not a substitute.

1. **Re-check.** The PR is mergeable, CI is green on the latest head, and nothing was pushed after
   the approval.
2. **Production migrations,** if any: dispatch `crew:migration-runner` with target `migrateProd`. It
   stops on the first error. Don't deploy if migrations failed. Report and ask.
3. **Merge.** Use the repo's allowed method:
   - `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`
   - then `gh pr merge <n> --squash --delete-branch` (or the allowed method)
   - then `git fetch origin`
4. **Deploy.** Run `commands.deploy` exactly, from the state it requires (for example, a clean
   checkout of the latest base). If the project's deploy guard refuses, fix the precondition. Never
   bypass the guard.
5. **Verify.** `curl` returning 200 is not proof.
   - Load `commands.verifyUrl` for real: the browser tool if available, otherwise fetch it and
     check for expected content.
   - Check any logs or health endpoint the project has.
   - Then check the specific acceptance criteria that are observable in production.
6. **If verification fails:** tell the user immediately. Give what failed, the evidence, and the
   options (`gh pr revert <n>` then deploy, or a forward fix). Don't choose for them unless it's an
   outage and they approved rollbacks in advance.
7. **Journal.** Mark fixed entries with the merge commit, and log any deploy or migration problem.
   Commit on the base branch through a follow-up PR if the base branch is protected.
8. **Clean up.**
   - `git worktree remove` each crew worktree for this task
   - `git branch -d` for the crew branches (their remotes were deleted with the merge)
   - `git worktree prune`
   - leave nothing behind
9. **Report** to the user in their language: what is live, the evidence, the journal changes, and
   the follow-ups.
