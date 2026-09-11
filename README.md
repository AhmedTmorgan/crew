# crew

A multi-model engineering team for [Claude Code](https://code.claude.com). You describe a task once.
The team understands it, plans it, builds it in parallel, reviews it with a different model, runs the
migrations, and ships it through a PR and CI. Nothing reaches production until you say yes. Every
session also keeps one problem journal per project, `BUGS.md`, so the next session knows what already
went wrong.

```
you ─▶ intake (Fable 5.1: asks about every unclear part, then waits for your go)
        ▼
      plan (contract between backend and frontend, work packages, risks)
        ▼
      ┌─ backend  → Codex gpt-5.6-sol · worktree A ─┐   in parallel
      └─ frontend → Opus 5           · worktree B ─┘
        ▼
      integrate (Opus 5 merges both and wires them together)
        ▼
      review (Codex gpt-6-astra, read-only; fixes go back to the author)
        ▼
      migrations on dev (Opus 4.8)  →  BUGS.md  →  PR + CI (fix until green)
        ▼
      ⛔ you approve  →  prod migrations (Opus 4.8)  →  merge  →  deploy  →  verify  →  clean up
```

If Codex is out of limit, too old, or logged out, crew notices before the run starts and hands that
role to a Claude agent (Opus 5 for the backend, Opus 4.8 for review). It tells you when it does.

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
- the [Codex CLI](https://github.com/openai/codex), up to date (optional, but it's the default for
  backend and review)
- `jq` and bash, but only for `babysit-pr`

## Use

| Command | What it does |
|---|---|
| `/crew:setup` | Once per repo: detects the real gate, migration, and deploy commands, writes `.crew/config.json`, creates `BUGS.md` |
| `/crew:feature <task>` | The whole pipeline above |
| `/crew:intake <task>` | Only the "understand it fully" step, which ends with an approved brief |
| `/crew:ship pr` · `/crew:ship release` | Commit, PR, and CI · merge, deploy, verify, and clean up (release needs your approval) |
| `/crew:bugs` | Read or update the problem journal |
| `/crew:debate-review <PR>` · `/crew:babysit-pr` | Two-model PR review posted as comments · work through bot review rounds |

Start the session on **Fable 5.1, effort medium**. That model is the orchestrator.

## Configure

`.crew/config.json` in each project. Only the keys you change are needed; the defaults are in
[`templates/crew.config.json`](templates/crew.config.json).

```json
{
  "version": "crew.v1",
  "baseBranch": "master",
  "commands": {
    "typecheck": "npx tsc --noEmit", "lint": "npm run lint", "test": "npm test",
    "migrateDev": null, "migrateProd": "npx supabase db push",
    "deploy": "pwsh scripts/deploy-prod.ps1", "verifyUrl": "https://example.com/login"
  },
  "roles": {
    "backend": { "implementer": "codex", "model": "gpt-5.6-sol", "effort": "high", "fallback": "crew:backend-builder" },
    "review":  { "implementer": "codex", "model": "gpt-6-astra", "effort": "high", "fallback": "crew:reviewer" }
  }
}
```

To run the backend role on Claude only, set `"backend": {"implementer": "agent", "agent": "crew:backend-builder"}`.

## The problem journal (`BUGS.md`)

There is one file per project, however big the project is. Entries have permanent ids (`BUG-0001`),
sit under fixed categories (security, database, auth, backend, frontend, integrations, performance,
build/CI, deploy, tests, other), and record:
- the problem
- the root cause
- the fix and its commit
- what is still open

A generated summary at the top lists the open items, with security issues that need a human first.

- The **SessionStart** hook shows every new session the open items.
- The **Stop** hook asks once per session to record anything learned if the session changed code
  without touching the journal.
- `scripts/bugs.mjs` does all the edits, so the format survives hundreds of entries and parallel
  branches. Setup marks the file `merge=union`, and `check --fix` repairs duplicate ids.

Secrets never go in the journal. Entries say where a secret lives, not what it is.

## Safety rails

- **Guard hook** (`PreToolUse` on Bash and PowerShell):
  - **Asks you** before production deploys, production migrations, and direct pushes to the base
    branch. That covers the project's configured commands, Vercel, Netlify, Fly, Railway,
    Cloudflare, Firebase, `supabase db push`, `prisma migrate deploy`, terraform, and kubectl.
  - **Blocks** force-pushes to the base branch.
- Implementers never commit, push, merge, deploy, or touch production. The orchestrator commits
  after re-running the gates itself.
- Worktrees live outside the repo, in `<repo>-crew/`, and are removed when a task ships.

## Layout

```
.claude-plugin/   plugin.json, marketplace.json
agents/           frontend-builder (Opus 5) · backend-builder (Opus 5, fallback)
                  reviewer (Opus 4.8, read-only fallback) · migration-runner (Opus 4.8)
skills/           feature · intake · setup · ship · bugs
                  + bundled: codex-delegate · claude-delegate · delegate-setup · debate-review · babysit-pr
hooks/            session-start · guard · stop-journal
scripts/          bugs.mjs (journal) · codex-run.mjs (Codex roles + fallback detection)
templates/        crew.config.json (defaults)
```

## Credits

The delegation and review skills are bundled from Ahmed Nagdy's
[delegate-skills](https://github.com/amElnagdy/delegate-skills) and
[review-skills](https://github.com/amElnagdy/review-skills) (MIT). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT
