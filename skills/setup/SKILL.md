---
name: setup
description: >-
  Prepare a project for crew, once per repository: detect its real test/lint/typecheck/build,
  migration, and deploy commands, write .crew/config.json, create the BUGS.md problem journal, add
  the .gitignore and .gitattributes lines, add a short crew section to CLAUDE.md, and check the
  tools (codex, gh, node). Use when crew:feature finds no .crew/config.json, or when the user says
  "set up crew here" / "جهّز المشروع".
---

# crew:setup

Do each step, and show the user the resulting config before writing it.

## 1. Tools

```bash
node --version; git --version; gh auth status; codex --version
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.mjs" --probe
```

- If Codex is missing or reports `outdated_cli`, tell the user the exact fix
  (`npm i -g @openai/codex@latest`) and ask before running it.
- If `gh` is not authenticated, the user must run `gh auth login` themselves.
- Crew still works without Codex. The roles fall back to Claude agents.

## 2. Detect the project's real commands

Read and don't guess. Check `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`,
CI workflows (`.github/workflows/*`), and `CLAUDE.md` / `AGENTS.md` / `README` / runbooks. CI is the
best evidence of which gates the project actually trusts.

| Key | Meaning | Examples |
|---|---|---|
| `install` | install deps in a fresh worktree | `npm ci` |
| `typecheck` / `lint` / `test` / `build` | the gates | `npx tsc --noEmit`, `npm run lint`, `npm test` |
| `migrateDev` | apply migrations to a non-production database | `npx supabase db push --db-url $DEV_DB_URL`, `npx prisma migrate dev` |
| `migrateProd` | apply migrations to production | `npx supabase db push` |
| `deploy` | the ONLY sanctioned production deploy command | `pwsh scripts/deploy-prod.ps1` |
| `verifyUrl` | a real page that proves the deploy works | `https://example.com/login` |

- If a project documents a special deploy path (a deploy script, a guard), use exactly that.
  Never `vercel --prod` when a script exists.
- Unknown commands stay `null`. crew:ship stops and asks when it needs one.
- `baseBranch`: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
- `guard.askPatterns`: extra command substrings that must always prompt the user (production
  scripts, production DB CLIs). `guard.denyPatterns`: substrings that must never run.

## 3. Write the config

Start from `${CLAUDE_PLUGIN_ROOT}/templates/crew.config.json`. Keep only the keys that differ from
it, plus `commands` and `baseBranch`. Show the result to the user, adjust, then write
`.crew/config.json`.

Role defaults:
- orchestrator: Fable 5.1, effort medium
- backend: Codex `gpt-5.6-sol`, effort high
- frontend and integration: Opus 5
- review: Codex `gpt-6-astra`, effort high
- migrations: Opus 4.8

Change a role only if the user asks. For example, to run the backend on Claude only:
`"backend": {"implementer": "agent", "agent": "crew:backend-builder"}`.

## 4. Journal, ignores, attributes

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs" init --project "<name>"
```

- `.gitignore`: add `.crew/tasks/` and `.crew/worktrees/`. Commit `.crew/config.json`.
- `.gitattributes`: add `BUGS.md merge=union`. Parallel branches that each add journal entries
  then merge without conflicts, and `bugs.mjs check --fix` repairs ids afterwards.
- If the project already has scattered bug or audit docs, offer to import their still-open items
  as journal entries. Don't do it unasked.

## 5. CLAUDE.md section

Append this short section to the project's `CLAUDE.md` (create the file if missing). Keep it short.
The skills carry the detail.

```markdown
## crew
- Problem journal: `BUGS.md`. Before working in an area, check its open entries. Record every
  problem you hit, its root cause and fix, and every security issue — use the `crew:bugs` skill.
- Big tasks run through `/crew:feature`. Production deploys and production migrations happen only
  after the owner approves in chat.
```

## 6. Report

Tell the user in their language:
- what was detected
- what is still `null`
- the role table
- whether Codex is ready

Then commit the setup on a branch, or leave it staged if they prefer.
