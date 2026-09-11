// SessionStart: put the project's open problems in front of Claude, and remember where the session
// started so the Stop hook can tell whether this session changed anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, project, readStdin, saveSessionState } from './lib.mjs';

const input = await readStdin();
const cwd = input.cwd || process.cwd();
const p = project(cwd);
if (!p) process.exit(0);

if (input.session_id) saveSessionState(input.session_id, { head: git(cwd, ['rev-parse', 'HEAD']), asked: false });

if (!fs.existsSync(p.bugsFile)) {
  if (p.config) console.log(`[crew] This project is set up for crew but has no ${p.bugsName} yet — create it with crew:bugs ("bugs.mjs init").`);
  process.exit(0);
}

const bugs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bugs.mjs');
const r = spawnSync(process.execPath, [bugs, 'summary', '--brief', '--file', p.bugsFile], { encoding: 'utf8', timeout: 10000 });
const summary = (r.stdout || '').trim();

console.log([
  `[crew] ${summary || `Problem journal: ${p.bugsName}`}`,
  `Before working in an area, check its open entries (bugs.mjs find <area>). Record every problem you hit — root cause, fix, what is still open, and any security issue — with the crew:bugs skill.`,
].join('\n'));
