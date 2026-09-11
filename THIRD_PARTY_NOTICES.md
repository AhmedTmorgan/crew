# Third-party notices

crew builds on open-source work. Bundled skills are included unchanged except where noted. Adapted
skills are rewritten for crew, and their sources are credited here and at the top of the adapted
file.

## Bundled (copied)

| Path | Upstream | Author · License | Local changes |
|---|---|---|---|
| `skills/codex-delegate` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy · MIT | none |
| `skills/claude-delegate` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy · MIT | none |
| `skills/delegate-setup` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy · MIT | none |
| `skills/debate-review` | https://github.com/amElnagdy/review-skills | Ahmed Nagdy · MIT | `scripts/lib/dispatch.mjs` also searches the plugin's own `skills/` folder |
| `skills/babysit-pr` | https://github.com/amElnagdy/review-skills | Ahmed Nagdy · MIT | none |
| `skills/tdd` | https://github.com/mattpocock/skills | Matt Pocock · MIT | the pointer to `codebase-design` is replaced with crew's spec seams |
| `skills/diagnosing-bugs` | https://github.com/mattpocock/skills | Matt Pocock · MIT | none |
| `skills/verification-before-completion` | https://github.com/obra/superpowers | Jesse Vincent · MIT | none |

## Adapted (rewritten for crew)

| crew file | Based on | Author · License |
|---|---|---|
| `skills/intake` | `grilling` (design tree, frontier, rounds, ❓/➡️ format, facts vs decisions) | Matt Pocock · MIT |
| `skills/spec` | `to-spec`, plus "Global Constraints" from `writing-plans` | Matt Pocock · MIT; Jesse Vincent · MIT |
| `skills/tickets` | `to-tickets` (tracer-bullet slices, blocking edges, expand–contract) | Matt Pocock · MIT |
| `skills/run`, `skills/run/references/briefs.md` | `subagent-driven-development` and its implementer, task-reviewer, re-review, and code-reviewer prompts; `implement-spec` (frontier, parallel worktrees) | Jesse Vincent · MIT; Matt Pocock · MIT |
| `scripts/review-package.mjs` | `subagent-driven-development/scripts/review-package`, ported from bash to Node | Jesse Vincent · MIT |
| `hooks/keep-going.mjs` | The idea of a Stop hook that keeps a session iterating (`ralph-loop` plugin in anthropics/claude-plugins-official). No code is copied. crew's hook is an independent implementation that reads the ticket graph instead of a completion phrase. | Anthropic · Apache-2.0 |

## License texts

**MIT License** (applies to every MIT item above; each copyright holder is named in the tables):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Copyright lines: © 2026 Matt Pocock · © 2025 Jesse Vincent · © Ahmed Nagdy.

**Apache License 2.0:** http://www.apache.org/licenses/LICENSE-2.0. No Apache-licensed code is
included. The reference above credits the source of an idea.

To update a bundled skill, copy the upstream folder over it and re-apply the local change listed above.
