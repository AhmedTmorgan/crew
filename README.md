# crew

A multi-model engineering team for [Claude Code](https://code.claude.com). You describe a feature
**once**. Crew grills you about every unclear part, writes a spec, and splits it into small tickets.
Then it builds the whole thing on its own, for hours if it has to, reviewing every ticket with a
different model. It stops only when it needs you to approve the deploy.

```
you ─▶ intake (Fable 5.1: numbered question rounds, a recommendation on each, until nothing is open)
        ▼
      spec  →  tickets (vertical slices + blocking edges + what can run in parallel)  →  one "go"
        ▼
      run — autonomous, frontier-first, in parallel worktrees:
        per ticket:  Codex gpt-5.6-sol (backend) → Opus 5 (frontend)
                     → Codex gpt-6-astra review (spec + quality) → fix loop (≤5 rounds)
                     → merge into crew/<feature> → BUGS.md
        keep-going hook: the session doesn't stop while tickets remain; a new session resumes from the ledger
        ▼
      final whole-branch review → migrations on dev (Opus 4.8) → PR + CI
        ▼
      ⛔ you approve  →  prod migrations  →  merge  →  deploy  →  verify  →  clean up
```

If Codex is out of limit, too old, or logged out, crew notices before the run starts and hands that
role to a Claude agent. Every fallback, and every decision it takes on your behalf (a "Ruling"), is
listed in the final report.

> **Status: early (v0.2).** The building blocks are tested on their own: the journal, the ticket
> graph, the keep-going hook, the guard, and Codex routing and fallback. Full end-to-end runs on real
> projects are just starting. Expect rough edges, and please open an issue when you hit one.

## Install

```text
/plugin marketplace add AhmedTmorgan/crew      # or a local path: /plugin marketplace add D:\crew
/plugin install crew@crew
```

Requirements:
- Claude Code
- Node 18+
- git
- `gh`, authenticated
- the [Codex CLI](https://github.com/openai/codex), up to date (optional; it's the default for
  backend and review)
- `jq` and bash, only for `babysit-pr`

## Use

Start the session on **Fable 5.1, effort medium**.

| Command | What it does |
|---|---|
| `/crew:setup` | Once per repo: detects the real gate, migration, and deploy commands, writes `.crew/config.json`, creates `BUGS.md` |
| `/crew:feature <feature>` | The whole pipeline above |
| `/crew:intake` · `/crew:spec` · `/crew:tickets` · `/crew:run` | The pipeline's stages, one at a time. Say "كمّل" / "continue" to resume a run |
| `/crew:ship pr` · `/crew:ship release` | PR and CI · merge, deploy, and verify (release needs your approval) |
| `/crew:bugs` | The problem journal |
| `/crew:tdd` · `/crew:diagnosing-bugs` · `/crew:verification-before-completion` | Engineering discipline the builders use |
| `/crew:debate-review <PR>` · `/crew:babysit-pr` | Two-model PR review · working through bot review rounds |

## How the long run stays alive

- **Ledger:** each ticket is a markdown file whose `**Status:**` line is its progress.
  `.crew/tasks/<slug>/ledger.md` records every start, verdict, fix round, ruling, and completion.
  After compaction, or in a brand-new session, crew trusts the ledger and `git log` over memory,
  and never redoes a finished ticket.
- **Keep-going hook** (Stop): while the run has work and nothing is in flight, the session isn't
  allowed to stop, and it's told exactly which tickets are ready. It lets the session wait while
  agents are working, stops at the approval gate, is bound to the session that owns the run, and
  pauses itself after 3 turns without progress, so it can never spin forever.
- **SessionStart hook:** announces an unfinished run in a new session and how to resume it.
- **Only four things stop a run:** something irreversible, something security-sensitive, a side
  effect outside the crew branches (merge, deploy, production), or a plan so broken every path is
  a guess. Everything else is decided, recorded as a ruling, and reported at the end.

## Configure (`.crew/config.json`)

Only the keys you change are needed. The defaults are in
[`templates/crew.config.json`](templates/crew.config.json).

```json
{
  "baseBranch": "master",
  "commands": { "typecheck": "npx tsc --noEmit", "lint": "npm run lint", "test": "npm test",
                "migrateProd": "npx supabase db push", "deploy": "pwsh scripts/deploy-prod.ps1" },
  "limits": { "parallel": 3, "fixRounds": 5 },
  "roles": { "backend": { "implementer": "codex", "model": "gpt-5.6-sol", "effort": "high", "fallback": "crew:backend-builder" } }
}
```

## The problem journal (`BUGS.md`)

There is one file per project, however large, managed by `scripts/bugs.mjs`. Entries have permanent
ids and fixed categories, and record the problem, the root cause, the fix and its commit, and what
is still open. Open security issues are listed first. Secrets never go in it. Crew records problems
per ticket as it goes, the SessionStart hook shows the open items, and a Stop hook asks once per
session to record what was learned.

## Safety rails

- **Guard hook:** asks you before production deploys, production migrations, and direct pushes to
  the base branch. Blocks force-pushes to the base branch.
- **Implementers never commit, push, merge, deploy, or touch production.** The controller commits
  after re-running the gates itself, and reviews run read-only.
- **Worktrees live outside the repo** (`<repo>-crew/`) and are removed as tickets merge.

## Credits

Crew stands on:
- Ahmed Nagdy's [delegate-skills](https://github.com/amElnagdy/delegate-skills) and
  [review-skills](https://github.com/amElnagdy/review-skills)
- Matt Pocock's [skills](https://github.com/mattpocock/skills)
- Jesse Vincent's [superpowers](https://github.com/obra/superpowers)
- the idea behind Anthropic's `ralph-loop` plugin

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for exactly what was taken and how it was
changed.

## License

MIT
