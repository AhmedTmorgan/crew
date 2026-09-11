// SessionStart: put the project's open problems — and any unfinished crew run — in front of Claude,
// and remember where the session started so the Stop hooks can tell whether it changed anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, project, readStdin, saveSessionState } from './lib.mjs';
import { activeSlug, readRun, summarize } from '../scripts/tickets.mjs';

const input = await readStdin();
const cwd = input.cwd || process.cwd();
const p = project(cwd);
if (!p) process.exit(0);

if (input.session_id) saveSessionState(input.session_id, { head: git(cwd, ['rev-parse', 'HEAD']), asked: false });

const lines = [];

const slug = activeSlug(p.root);
const run = slug && readRun(p.root, slug);
if (run && run.status !== 'done') {
  const s = summarize(p.root, slug);
  const mine = run.session && input.session_id && run.session === input.session_id;
  lines.push(`[crew] Active run '${slug}': ${run.status}, phase ${run.phase}, ${s.done}/${s.total} tickets done${run.reason ? ` — ${run.reason}` : ''}.`);
  lines.push(mine
    ? `Resume crew:run now from .crew/tasks/${slug}/ledger.md and the ticket statuses. After compaction, trust the ledger and git log over memory, and never re-dispatch a done ticket.`
    : `It belongs to an earlier session. If the user says "كمّل" / "continue", run crew:run in resume mode (\`tickets.mjs run resume --task ${slug}\`), which rebinds it to this session.`);
}

const bugs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bugs.mjs');
if (fs.existsSync(p.bugsFile)) {
  const r = spawnSync(process.execPath, [bugs, 'summary', '--brief', '--file', p.bugsFile], { encoding: 'utf8', timeout: 10000 });
  lines.push(`[crew] ${(r.stdout || '').trim() || `Problem journal: ${p.bugsName}`}`);
  lines.push('Before working in an area, check its open entries (bugs.mjs find <area>). Record every problem you hit — root cause, fix, what is still open, and any security issue — with the crew:bugs skill.');
} else if (p.config) {
  lines.push(`[crew] This project is set up for crew but has no ${p.bugsName} yet — create it with crew:bugs ("bugs.mjs init").`);
}

if (lines.length) console.log(lines.join('\n'));
