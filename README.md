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

If Codex is missing, outdated, logged out, or out of quota, that role goes to a Claude agent
instead. A preflight probe catches the first three; **quota it cannot catch** — a tiny probe passes
while a real turn hits the account limit — so the first dispatch that hits a limit is remembered
with its reset time, and every later dispatch of that model takes the fallback immediately instead
of spending a turn to rediscover it (`codex-run.mjs --limits` / `--clear-limits`). Every fallback,
and every decision crew takes on your behalf (a "Ruling"), is in the final report.

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
- **Keep-going hook** (Stop): while the run has work, the session isn't allowed to stop, and it's
  told exactly which tickets are ready. It lets the session wait only while dispatched work is
  **provably alive** — no report newer than the ledger's last word on that ticket, and file activity
  within `keepGoing.staleMinutes` (45 by default). A finished report nobody acted on, or a worker
  that went silent, brings the session back instead of letting the run idle. It stops at the
  approval gate, is bound to the session that owns the run, and pauses itself after 3 turns without
  progress, so it can never spin forever.
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

## What it costs, measured

The first real run — a 7-ticket WhatsApp template feature on a large Next.js/Supabase codebase, 5
tickets finished in 14.6 hours — billed **326M tokens**:

| | tokens | share |
|---|---|---|
| Implementers (7 agents) | 226M | **69%** |
| Orchestrator | 92M | 28% |
| Every review together (8 agents) | 10M | **4%** |

One oversized ticket took 308 turns and 85M tokens by itself — a quarter of the run. **Reviews are
cheap; long implementer sessions are not.** That is why crew now picks the implementer's model from
the ticket's size, explores the codebase once per run instead of once per agent, and treats a ticket
that outgrows ~100 tool calls as a sizing mistake to split rather than a session to extend.

Use it accordingly:
- **Worth it** for work with several independent slices, where review and a written record matter,
  and where you want it to keep going while you sleep.
- **Not worth it** for a one-file fix or a quick question. A normal session is cheaper and faster.
- Parallelism buys wall-clock, not tokens: three agents at once reach a usage limit three times
  sooner. Lower `limits.parallel` when quota matters more than speed.

## The problem journal (`BUGS.md`)

There is one file per project, however large, managed by `scripts/bugs.mjs`. Entries have permanent
ids and fixed categories, and record the problem, the root cause, the fix and its commit, and what
is still open. Open security issues are listed first. Secrets never go in it. Crew records problems
per ticket as it goes, the SessionStart hook shows the open items, and a Stop hook asks once per
session to record what was learned.

## Safety rails

- **Guard hook** (PreToolUse on Bash/PowerShell):
  - **Asks you** before anything that changes production or shared state: the project's configured
    deploy and production-migration commands; Vercel, Netlify, Fly, Railway, Cloudflare, Firebase,
    `supabase db push/reset` (anything that is not `--local` or `--dry-run`), Prisma, terraform,
    kubectl and helm; `gh pr merge`; repository visibility, protection, or deletion; a merge,
    rebase or commit made while the base branch is checked out; a push to the base branch;
    `reset --hard` and `clean -fd`; and any command matching `guard.externalWritePatterns` — the
    project's list of scripts that write to third-party APIs, so a "live proof" never creates
    something at Meta, Stripe, or Shopify without you.
  - **Blocks** force-pushing or deleting the base branch.
  - **It matches command text, so it is a second lock, not a permission system.** `crew:setup`
    offers to enable real branch protection on the forge, which is the lock that holds when a
    command slips past the text match.
- **A critical or security finding can never be parked.** Fix rounds end, but the finding doesn't:
  it is fixed, or the ticket goes `needs-human` with a journal entry. `tickets.mjs run phase ship`
  refuses mechanically while any open critical entry — or any open high/critical security entry —
  is in `BUGS.md`, whatever was approved earlier.
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
