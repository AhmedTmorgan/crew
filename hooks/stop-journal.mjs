// Stop: once per session, if this session changed the project but never touched the problem journal,
// ask Claude to record what it ran into (or to say there was nothing worth recording) before it stops.
import fs from 'node:fs';
import { git, project, readStdin, saveSessionState, sessionState } from './lib.mjs';

const input = await readStdin();
if (input.stop_hook_active) process.exit(0);

const cwd = input.cwd || process.cwd();
const p = project(cwd);
if (!p || !fs.existsSync(p.bugsFile) || !input.session_id) process.exit(0);

const state = sessionState(input.session_id);
if (state.asked) process.exit(0);

const status = (git(cwd, ['status', '--porcelain']) || '').split('\n').filter(Boolean);
const touched = line => line.slice(3).replace(/"/g, '');
const journalDirty = status.some(line => touched(line).endsWith(p.bugsName));
const otherDirty = status.some(line => !touched(line).endsWith(p.bugsName) && !touched(line).startsWith('.crew/'));

const head = git(cwd, ['rev-parse', 'HEAD']);
let committed = [];
if (state.head && head && state.head !== head) {
  committed = (git(cwd, ['diff', '--name-only', `${state.head}..${head}`]) || '').split('\n').filter(Boolean);
}
const journalCommitted = committed.some(f => f.endsWith(p.bugsName));

const changedSomething = otherDirty || committed.some(f => !f.endsWith(p.bugsName));
if (!changedSomething || journalDirty || journalCommitted) process.exit(0);

saveSessionState(input.session_id, { ...state, asked: true });
process.stderr.write([
  `crew: this session changed the project but ${p.bugsName} was not updated.`,
  'If you hit any problem worth remembering (a bug and its root cause, an approach that failed, a CI/build/deploy/migration failure, surprising platform behaviour, or ANY security issue), record it now with the crew:bugs skill.',
  'If nothing is worth recording, say so in one line and stop. This check runs once per session.',
].join('\n'));
process.exit(2);
