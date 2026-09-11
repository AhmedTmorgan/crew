# Third-party notices

crew bundles the following skills unchanged except where noted. Each is distributed under the MIT
License, as declared in its `SKILL.md` frontmatter (`license: MIT`).

| Bundled skill | Upstream | Author | Local changes |
|---|---|---|---|
| `skills/codex-delegate` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy | none |
| `skills/claude-delegate` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy | none |
| `skills/delegate-setup` | https://github.com/amElnagdy/delegate-skills | Ahmed Nagdy | none |
| `skills/debate-review` | https://github.com/amElnagdy/review-skills | Ahmed Nagdy | `scripts/lib/dispatch.mjs` also searches the plugin's own `skills/` folder, so the bundled relays are found without a separate install |
| `skills/babysit-pr` | https://github.com/amElnagdy/review-skills | Ahmed Nagdy | none |

`skills/intake` adapts the interview method of Matt Pocock's `grilling` skill
(https://github.com/mattpocock/skills, MIT, © Matt Pocock): the design tree, the frontier, round-based
numbered questions with a recommended answer each, and the facts-versus-decisions split. The text is
rewritten for crew, and crew adds the decision ledger in the task brief.

The MIT License text:

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

To update a bundled skill, copy the upstream folder over it and re-apply the local change listed above.
