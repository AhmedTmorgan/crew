# Brief templates

Implementers see only the brief: no chat history, no memory of the repo. Everything they need goes
in it. Keep one task per brief. Use absolute paths. Paste the real gate commands from
`.crew/config.json`. Never paste secrets; name the environment variables instead.

## Backend (Codex Sol, or crew:backend-builder)

```xml
<role>You are the backend engineer. You do not commit, push, apply migrations, or deploy — the orchestrator does.</role>
<workspace>Work ONLY in: <absolute worktree path> (branch crew/<slug>-be). Do not touch any other directory.</workspace>
<context>
Project: <one paragraph: stack, relevant architecture, conventions from CLAUDE.md that matter here>
Relevant files: <paths + one line each>
Known problems in this area (BUGS.md): <ids + one line each, or none>
</context>
<task><what to build, from the approved brief — behaviour, edge cases, errors></task>
<contract><exact routes/actions, types, tables/columns, events — the frontend is being built against this in parallel></contract>
<migrations>Write new migration files only, following <convention/folder>. Never edit existing migrations. Do not apply them.</migrations>
<constraints>
- Out of bounds: <files/areas>
- Security: authn/authz on every entry point; <tenant/user isolation rule>; validate external input; never log secrets or personal data.
- Reuse <existing helpers>; no new dependencies without saying why in the report.
</constraints>
<gates>Run and make pass, in this worktree: <typecheck> ; <lint> ; <test></gates>
<report_contract>
Final message sections: Result (done|blocked) · Changed files · Migrations written (file, destructive?) · Gates (command → pass/fail + failure tail) · Contract deviations · Problems hit (symptom → root cause → fix/open) · Security notes.
</report_contract>
```

## Frontend (crew:frontend-builder, build mode)

```
Mode: build
Worktree: <absolute path> (branch crew/<slug>-fe)
Task: <UI to build, from the brief: screens, flows, states, copy, i18n/RTL>
Contract: <same contract as the backend brief — code against its types; mocks allowed only where marked, tag them // crew:mock>
Conventions: <component library, tokens, loading/skeleton rules, i18n files>
Out of bounds: <files>
Acceptance criteria you own: <list>
Gates: <typecheck> ; <lint> ; <test>
Known problems in this area: <BUGS ids or none>
```

## Integrate (crew:frontend-builder, integrate mode)

```
Mode: integrate
Worktree: <absolute path of the integration tree> (branch crew/<slug>)
Merge, in order: crew/<slug>-be, then crew/<slug>-fe (git merge --no-ff). Resolve conflicts by understanding both sides.
Then: replace every `crew:mock` with real calls, make the feature work end to end against the contract.
Acceptance criteria (all): <list>
Gates: <typecheck> ; <lint> ; <test> ; <build if cheap>
Backend report summary: <paste the key parts: changed files, deviations>
Frontend report summary: <paste>
```

## Review (Codex Astra read-only, or crew:reviewer)

```
You are the reviewer. READ-ONLY: do not modify any file.
Worktree: <integration tree path>. Review the diff: git diff origin/<base>...HEAD
Brief (goal, scope, acceptance criteria): <paste from brief.md>
Contract: <paste>
Gates you may run: <typecheck> ; <lint> ; <test>
Priorities: correctness vs brief → security (authn/authz, isolation, input validation, injection, secrets, webhook signatures, personal data in logs) → data/migrations safety → contract match → tests. No style nits.
Every finding needs file, line, a concrete failure scenario, and the smallest correct fix. Verify in the code before claiming.
End your final message with exactly one ```json block:
{"schema":"crew.review.v1","verdict":"approve|changes","summary":"","gates":[{"command":"","result":"pass|fail","note":""}],
 "findings":[{"id":"R1","severity":"blocker|major|minor|nit","area":"backend|frontend|db|security|tests|other","file":"","line":0,"problem":"","fix":"","security":false}]}
verdict is "changes" if any blocker/major exists. Any security finding sets "security": true.
```

For a re-review, add: `Previous findings: <ids + status>. Review only the changes since <sha>.`

## Rework / fix (delta brief to the SAME session)

```
Follow-up on the same task (you have the context from your previous turn).
Fix exactly these, nothing else:
- R2 (major) src/…:88 — <problem> → <expected fix>
- Gate failure: <command> → <last lines>
Worktree: <path> (unchanged unless stated). Re-run the gates. Same report format as before.
```

## Migrate dev (crew:migration-runner)

```
Target: dev
Worktree: <integration tree path>   Base ref: origin/<base>
Migration files: <list>
Command (from .crew/config.json commands.migrateDev): <exact command, or "none — validate only">
Smoke query (optional): <query that proves the schema works>
```

## Migrate prod (crew:migration-runner)

```
Target: prod
Owner approved production migrations: <ISO timestamp of the user's yes> — files: <list>; destructive statements approved: <none | list>
Worktree: <clean checkout at the merged commit, or the integration tree at the PR head>   Base ref: origin/<base>
Migration files: <list>
Command (from .crew/config.json commands.migrateProd): <exact command>
Smoke query (optional): <query>
```
