#!/usr/bin/env node
/**
 * crew · review-package.mjs — write a reviewer's whole view of a change (commit list, stat summary,
 * full diff with context) to ONE file, so a reviewer reads it in one call and the diff never has to
 * pass through the orchestrator's context.
 *
 *   node review-package.mjs --cd <worktree> --base <sha|ref> --head <sha|ref> --out <file>
 *
 * Always pass the BASE recorded before the implementer started, never HEAD~1 — HEAD~1 silently
 * drops all but the last commit of a multi-commit task.
 *
 * Adapted from superpowers' subagent-driven-development/scripts/review-package (MIT, Jesse Vincent),
 * ported to Node so it runs the same on Windows, macOS, and Linux.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`review-package: ${message}\n`);
  process.exit(2);
}

const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  if (!['cd', 'base', 'head', 'out'].includes(key)) fail(`unknown argument ${argv[i]}`);
  if (argv[i + 1] === undefined) fail(`--${key} needs a value`);
  opts[key] = argv[++i];
}
for (const key of ['cd', 'base', 'head', 'out']) if (!opts[key]) fail(`--${key} is required`);

const git = args => {
  const r = spawnSync('git', ['-C', opts.cd, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
};

git(['rev-parse', '--verify', '--quiet', opts.base]);
git(['rev-parse', '--verify', '--quiet', opts.head]);
const range = `${opts.base}..${opts.head}`;

const text = [
  `# Review package: ${range}`,
  '',
  '## Commits',
  git(['log', '--oneline', range]).trimEnd(),
  '',
  '## Files changed',
  git(['diff', '--stat', range]).trimEnd(),
  '',
  '## Diff',
  git(['diff', '-U10', range]),
].join('\n');

fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
fs.writeFileSync(opts.out, text);
const commits = git(['rev-list', '--count', range]).trim();
console.log(`wrote ${path.resolve(opts.out)}: ${commits} commit(s), ${Buffer.byteLength(text)} bytes`);
