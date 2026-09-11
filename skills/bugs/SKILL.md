---
name: bugs
description: >-
  Keep the project's single problem journal (BUGS.md): record every problem a session hits (bugs,
  failed approaches, surprising behaviour, CI and deploy failures), its root cause, how it was
  solved, what is still unsolved, and security issues that need a human. Use whenever you find or
  fix a problem, when a crew run finishes a step, when the Stop hook asks for it, or when the user
  asks "إيه المشاكل اللي قابلتنا", "what's still open", or "log this".
---

# The problem journal

Each project has **one** journal file (`BUGS.md` at the repo root, or `bugsFile` in
`.crew/config.json`), however big the project is. It is the project's memory of what went wrong. The
next session reads it before touching the same area. Keep it truthful and current.

Always go through the script. It assigns ids, files each entry under its category, and regenerates
the summary of open items at the top:

```bash
B="${CLAUDE_PLUGIN_ROOT}/scripts/bugs.mjs"
node "$B" summary              # what is open, security first
node "$B" find "webhook"       # search before adding: no duplicates
node "$B" list --category security --status all
node "$B" show BUG-0012
```

## What to record

Record anything the next person working here would want to know:

- A bug you found, even if you fixed it in the same session. The root cause is the valuable part.
- An approach that failed and why (a library, a config, a query plan), so nobody retries it blind.
- Surprising behaviour of the platform, provider, or framework that cost time.
- A CI, build, migration, or deploy failure and what fixed it.
- A security issue: missing auth or isolation checks, exposed secrets, unvalidated input, injection,
  dependency CVEs, risky permissions. **Always log these, fixed or not.**
- A workaround or tech debt that is knowingly left in place.

Don't record routine work that went fine, or style nits.

## Adding an entry

Search first (`find`). If the problem is already there, update that entry instead. Then write the
entry as JSON in a temp file (quoting stays safe on every shell) and add it:

```json
{
  "title": "Telegram webhook accepted unsigned requests",
  "category": "security",
  "severity": "high",
  "status": "fixed",
  "phase": "channels v2",
  "where": "src/app/api/webhooks/telegram/[tenant]/route.ts",
  "problem": "Requests without the secret-token header were processed.",
  "cause": "The header check ran only when TELEGRAM_SECRET was set; it is unset in preview.",
  "fix": "Reject when the header is missing or wrong, in every environment.",
  "commit": "a1b2c3d",
  "remaining": "Old bots registered without a secret must be re-registered.",
  "by": "crew:feature / review (gpt-6-astra)"
}
```

```bash
node "$B" add --from "$TMP/bug.json"                                   # prints the new id
node "$B" update BUG-0012 --status fixed --fix "…" --commit a1b2c3d    # small updates work as flags
```

- **category:** `security` · `data` (database & migrations) · `auth` · `backend` · `frontend` ·
  `integrations` · `performance` · `build` (tooling & CI) · `deploy` · `tests` · `other`
- **severity:** `critical` · `high` · `medium` · `low`
- **status:** `open` · `in-progress` · `mitigated` (risk reduced but not solved) · `fixed` · `wontfix`
- **by:** who found it (session, role, model). **phase:** feature, phase, or task slug.

## Rules

- **No secrets, tokens, passwords, keys, or customer data. Ever.** Point to where they live
  ("the value in `.env.local`", "the tenant's conversation table") instead. The journal is committed.
- **Security entries that need a human decision stay `open`** with a clear `remaining` line saying
  what decision is needed. Say it to the user in the same turn, too.
- Write `problem` as observable symptoms and `cause` as the actual mechanism, not "it was broken".
- When you fix an existing entry, set `status`, `fix`, and `commit`. Never delete entries. The history
  is the point.
- Commit `BUGS.md` together with the change it describes when you can.
- After a merge from other branches, run `node "$B" check --fix`. It renumbers colliding ids and
  refreshes the summary.
