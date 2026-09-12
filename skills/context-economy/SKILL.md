---
name: context-economy
description: >-
  Spend context like it costs money, because it does. How to find code without reading whole files
  (LSP symbols, ranged reads, precise grep), how to hand work over as files instead of pasted text,
  and how to keep a long agent session from ballooning. Crew implementers and reviewers use it on
  every dispatch; use it yourself whenever a session is reading a lot of code, or when the user says
  the tokens are too high / "التوكنز كتير".
---

# Context economy

Every token you pull into context is re-read on every later turn of that session. A 800-line file
read once in turn 3 is still being paid for in turn 200. That is why long sessions get expensive: not
one big read, but one careless read multiplied by the turns that follow it.

**Measured on crew's first real run** (326M tokens, 7 tickets): implementers were 69% of the bill,
the orchestrator 28%, and every review together 4%. One implementer ran 308 turns and cost 85M by
itself. The cost is long implementer sessions, not reviews — so the rules below are aimed there.

## 1. Find code by symbol, not by reading files

The `LSP` tool answers precise questions without loading a file:

| Question | Operation |
|---|---|
| Where is this defined? | `goToDefinition` |
| Who calls it, and would my change break them? | `findReferences`, `incomingCalls` |
| What does this file export, and where? | `documentSymbol` |
| Where does the thing called `TemplateRow` live at all? | `workspaceSymbol` (always pass `query`) |
| What is this parameter's type? | `hover` |

`documentSymbol` on an 806-line, 34KB file returns a symbol map instead of ~8,600 tokens of source.
Then read only the range you actually need.

**It needs a language server for the file type, started in a workspace that has the toolchain
installed.** In a TypeScript repo that means `node_modules/typescript` must exist in the worktree
you are working in — so run the project's install command before relying on it. If LSP returns an
error, say so once and fall back to grep; don't retry it on every file.

## 2. Read narrowly

- **Grep first, read second.** Search for the exact symbol or string, then read the file around the
  hit with `offset`/`limit` (30–80 lines is usually plenty). Never read a file "to see what's in it".
- **Never read a whole file over ~300 lines** unless you are about to rewrite most of it. Read the
  region.
- **`git diff` beats re-reading.** To see what you or someone else changed, diff it. Don't re-open
  the files.
- **Cap search output** (`head_limit`), and prefer one precise pattern over three vague ones.
- **Never read `node_modules`, `.next`, `dist`, build output, or lockfiles.** If you think you need a
  library's source, read its types or its docs instead.

## 3. Hand over files, not contents

- Write reports, findings, and diffs to a file; return **the path plus a one-line summary**. Anything
  you paste into a message stays in context for the rest of the session — on both sides.
- A dispatch brief carries pointers (ticket path, spec path, notes path) and the exact values that
  cannot be looked up. It never carries the session's history.
- When a reviewer needs a diff, generate the review package file and pass its path. One `Read` there
  costs far less than the same diff pasted into a prompt.

## 4. Explore once per effort, not once per agent

A fresh agent that crawls the codebase pays for what the previous agent already learned. Do it once,
write it down, and point everyone at it:

```bash
# a compact, tree-sitter-compressed map of the area (measured on a real module:
# 276 KB raw → 105 KB compressed, 62% less)
npx --yes repomix <dir> --compress --stdout --style plain > .crew/tasks/<slug>/notes/<area>.map.txt
```

Alongside it, write `notes/<area>.md` in prose: the files that matter and why, the patterns to
follow, the traps, where the tests live. Prose notes beat a raw map — the map is a fallback for
areas nobody has explored yet.

## 5. Keep a session from ballooning

- **Finish the smallest complete slice, then report.** Past ~100 tool calls, stop adding scope and
  hand back what is done plus what is left. A ticket that needs 300 turns was sized wrong, and
  splitting it costs a fraction of running it.
- **Don't re-run the full test suite after every edit.** Run the focused test while iterating, and
  the full gates once before reporting.
- **Don't paste command output you don't need.** Pipe through `head`, `tail`, or a grep for the
  failing lines. A 5,000-line test log costs more than the fix.
- **Match the model to the job.** Mechanical work on a cheap model, judgment on an expensive one.
  An omitted model inherits the session's, which is usually the most expensive one available.
- **Parallelism spends the same tokens faster.** It buys wall-clock, not budget: three agents at
  once reach a usage limit three times sooner.

## What not to do for economy's sake

- Don't skip reading the code you are about to change. Guessing produces rework, which costs more
  than the read would have.
- Don't skip the review. Reviews were 4% of the bill and caught real defects.
- Don't compress by omitting evidence from a report: keep the command, the failing output, and the
  file:line. Cut prose, not proof.
