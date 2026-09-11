// Shared helpers for crew hooks. Hooks must never crash a session: every helper fails soft.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Async on purpose: a synchronous read of fd 0 can fail on Windows pipes (EOF/EAGAIN), which would
// silently turn every hook into a no-op.
export async function readStdin() {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 8000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The project a hook runs for: the MAIN checkout of the repo (crew worktrees resolve to it through
 * --git-common-dir), with its crew config and journal path. null outside a git repo.
 */
export function project(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!common || !top) return null;
  const root = path.basename(common) === '.git' ? path.dirname(common) : top;
  let config = null;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.crew', 'config.json'), 'utf8')); } catch { /* not set up */ }
  const bugsName = config?.bugsFile || 'BUGS.md';
  return { root, top, config, bugsName, bugsFile: path.join(top, bugsName) };
}

const stateDir = path.join(os.tmpdir(), 'crew-hooks');

export function sessionState(sessionId) {
  try { return JSON.parse(fs.readFileSync(path.join(stateDir, `${sessionId}.json`), 'utf8')); } catch { return {}; }
}

export function saveSessionState(sessionId, state) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `${sessionId}.json`), JSON.stringify(state));
  } catch { /* best effort */ }
}
