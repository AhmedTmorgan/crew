#!/usr/bin/env node
/**
 * crew · codex-run.mjs — run one crew role on Codex through the bundled codex-delegate relay, and
 * say plainly whether it worked; if not, why, and which Claude agent should take over.
 *
 *   node codex-run.mjs --role <role> --brief <file> --cd <dir> [--session <threadId>] [--read-only]
 *                      [--out-dir <dir>] [--timeout 2h]
 *   node codex-run.mjs --probe [--roles backend,review] [--cd <project dir>]
 *
 * The role's model, effort, and fallback agent come from the plugin defaults
 * (templates/crew.config.json) overlaid with the project's .crew/config.json.
 *
 * Prints one JSON verdict on stdout (also written to <out-dir>/verdict.json):
 *   { ok, kind, role, model, effort, threadId, resultPath, fallback, detail, finalMessage }
 * kind: completed | usage_limit | outdated_cli | auth | model_unavailable | codex_missing
 *       | timeout | aborted | failed
 * `fallback` is set only for kinds another model can fix (limit, CLI version, auth, model). A
 * timeout or an ordinary failure is left to the orchestrator: inspect the tree, then retry or re-brief.
 *
 * --probe sends a tiny read-only prompt to each Codex role's model. It proves the CLI, the auth and
 * the model are REACHABLE — it does NOT prove any quota is left: a tiny probe passes happily while a
 * real turn hits the account's usage limit immediately (observed 2026-09-11). So a real usage_limit
 * is remembered instead: its reset time goes to ~/.claude/crew-codex-limits.json, and every later
 * dispatch of that model returns the fallback verdict at once instead of spending a turn to
 * rediscover it. `--limits` prints what is remembered; `--clear-limits` forgets it.
 * Exit code: 0 when ok, 1 otherwise (2 for usage errors).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY = path.join(PLUGIN_ROOT, 'skills', 'codex-delegate', 'scripts', 'relay.mjs');
const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;

// Order matters: an outdated CLI also prints "model metadata not found", which must not read as a
// missing model.
const FAILURE_PATTERNS = [
  ['outdated_cli', /requires a newer version of codex|upgrade to the latest (app|cli|version)/i],
  ['usage_limit', /usage limit|rate[ _-]?limit|quota|too many requests|\b429\b|limit (has been |was )?reached|hit your .*limit|try again (at|in) /i],
  ['auth', /\b401\b|unauthori[sz]ed|not logged in|codex login|authentication (failed|required)|invalid api key/i],
  ['model_unavailable', /model .{0,40}(not found|does not exist|not supported|unavailable)|unknown model|invalid model/i],
];
const FALLBACK_KINDS = new Set(['usage_limit', 'outdated_cli', 'auth', 'model_unavailable', 'codex_missing']);

// ---------- remembered usage limits ----------
// The limit belongs to the account, not to one project, so it lives in the user's Claude directory.
const LIMITS_FILE = path.join(os.homedir(), '.claude', 'crew-codex-limits.json');
// The provider's stated reset time is not reliable: on 2026-09-11 Codex said "try again at Sep 15"
// and the quota was back the next morning. So a remembered limit is a short cooldown that doubles
// if the limit is still there, never a multi-day lockout — it must heal on its own.
const FIRST_COOLDOWN_MS = 20 * 60 * 1000;
const MAX_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** "try again at Sep 15th, 2026 11:19 AM" → a Date, or null when the message says nothing usable. */
function parseResetTime(text) {
  const m = String(text).match(/try again (?:at|in) ([^".}\\]+)/i);
  if (!m) return null;
  const when = Date.parse(m[1].replace(/(\d+)(st|nd|rd|th)/i, '$1').trim());
  return Number.isNaN(when) ? null : new Date(when);
}

function writeLimits(data) {
  try {
    fs.mkdirSync(path.dirname(LIMITS_FILE), { recursive: true });
    fs.writeFileSync(LIMITS_FILE, `${JSON.stringify(data, null, 2)}\n`);
  } catch { /* remembering is best effort */ }
}

/** Remembered limits that have not expired yet; expired ones are dropped on read. */
function readLimits() {
  const data = readJson(LIMITS_FILE) || {};
  const now = Date.now();
  let changed = false;
  for (const [model, entry] of Object.entries(data)) {
    if (!entry?.until || Date.parse(entry.until) <= now) { delete data[model]; changed = true; }
  }
  if (changed) writeLimits(data);
  return data;
}

const activeLimit = model => (model ? readLimits()[model] : null);

function rememberLimit(model, detail) {
  if (!model) return;
  const data = readLimits();
  const previous = data[model];
  // Back off further each time the limit is still there; cap it, and never wait past the provider's
  // own reset time when it gives one.
  const cooldown = Math.min(previous ? (previous.cooldownMs || FIRST_COOLDOWN_MS) * 2 : FIRST_COOLDOWN_MS, MAX_COOLDOWN_MS);
  const stated = parseResetTime(detail);
  const until = new Date(Math.min(Date.now() + cooldown, stated ? stated.getTime() : Infinity));
  data[model] = {
    until: until.toISOString(), cooldownMs: cooldown, attempts: (previous?.attempts || 0) + 1,
    statedReset: stated ? stated.toISOString() : null, noticedAt: new Date().toISOString(),
    detail: String(detail).slice(0, 300),
  };
  writeLimits(data);
}

function fail(message) {
  process.stderr.write(`codex-run: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { readOnly: false, probe: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { if (argv[i + 1] === undefined) fail(`${arg} needs a value`); return argv[++i]; };
    switch (arg) {
      case '--role': opts.role = value(); break;
      case '--roles': opts.roles = value().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--brief': opts.brief = value(); break;
      case '--cd': opts.cd = value(); break;
      case '--session': opts.session = value(); break;
      case '--out-dir': opts.outDir = value(); break;
      case '--timeout': opts.timeout = value(); break;
      case '--read-only': opts.readOnly = true; break;
      case '--probe': opts.probe = true; break;
      case '--limits': opts.limits = true; break;
      case '--clear-limits': opts.clearLimits = true; break;
      case '--help': case '-h': {
        const doc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
        process.stdout.write(`${doc.replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '')}\n`);
        process.exit(0);
      }
      default: fail(`unknown argument ${arg}`);
    }
  }
  return opts;
}

// ---------- config ----------

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function gitRoot(dir) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' });
  // --git-common-dir points at the MAIN checkout's .git even from inside a crew worktree, which is
  // where .crew/config.json lives.
  if (r.status === 0) return path.dirname(r.stdout.trim());
  return dir;
}

function loadRoles(dir) {
  const defaults = readJson(path.join(PLUGIN_ROOT, 'templates', 'crew.config.json'))?.roles || {};
  const project = readJson(path.join(gitRoot(dir), '.crew', 'config.json'))?.roles || {};
  // Per-role merge: overriding one field (say backend.model) keeps implementer, effort, fallback.
  const roles = { ...defaults };
  for (const [name, role] of Object.entries(project)) roles[name] = { ...defaults[name], ...role };
  return roles;
}

function roleConfig(roles, name) {
  const role = roles[name];
  if (!role) fail(`role "${name}" is not in the crew config (known: ${Object.keys(roles).join(', ')})`);
  if (role.implementer !== 'codex') fail(`role "${name}" runs on "${role.implementer}", not codex — dispatch it as a Claude agent instead`);
  for (const key of ['model', 'effort']) {
    if (role[key] && !SAFE_TOKEN.test(role[key])) fail(`role "${name}" has an unsafe ${key}: ${role[key]}`);
  }
  return role;
}

// ---------- classification ----------

function classify(text) {
  for (const [kind, re] of FAILURE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const at = Math.max(0, m.index - 120);
      return { kind, detail: text.slice(at, m.index + 200).replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

/** Error text from a relay run: stderr tail, relay error, and error events from the JSONL stream. */
function failureText(result) {
  const parts = [...(result.stderrTail || []), result.error || ''];
  if (result.eventsPath && fs.existsSync(result.eventsPath)) {
    const lines = fs.readFileSync(result.eventsPath, 'utf8').split('\n').filter(Boolean).slice(-200);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'error' || ev.type === 'turn.failed' || ev.item?.type === 'error') parts.push(JSON.stringify(ev));
      } catch { /* partial line */ }
    }
  }
  return parts.join('\n');
}

function verdictFor(result, role, name) {
  const base = {
    role: name, model: role.model || null, effort: role.effort || null,
    threadId: result.threadId || null, resultPath: result.resultPath || null,
  };
  if (result.status === 'completed') {
    return { ok: true, kind: 'completed', ...base, fallback: null, detail: null, finalMessage: result.finalMessage || '' };
  }
  if (result.status === 'codex_unavailable') {
    return { ok: false, kind: 'codex_missing', ...base, fallback: role.fallback || null, detail: 'codex CLI not found on PATH' };
  }
  const hit = classify(failureText(result));
  const kind = hit?.kind || (['timeout', 'aborted'].includes(result.status) ? result.status : 'failed');
  return {
    ok: false, kind, ...base,
    fallback: FALLBACK_KINDS.has(kind) ? role.fallback || null : null,
    detail: hit?.detail || (result.stderrTail || []).slice(-3).join(' | ') || result.error || `relay status ${result.status}`,
  };
}

// ---------- modes ----------

function run(opts) {
  for (const key of ['role', 'brief', 'cd']) if (!opts[key]) fail(`--${key} is required (or use --probe)`);
  if (!fs.existsSync(RELAY)) fail(`bundled relay not found at ${RELAY}`);
  const role = roleConfig(loadRoles(opts.cd), opts.role);
  const outDir = path.resolve(opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), `crew-${opts.role}-`)));
  fs.mkdirSync(outDir, { recursive: true });

  // A limit this account already hit is not worth another turn to rediscover.
  const known = activeLimit(role.model);
  if (known) {
    const verdict = {
      ok: false, kind: 'usage_limit', role: opts.role, model: role.model || null, effort: role.effort || null,
      threadId: null, resultPath: null, fallback: role.fallback || null,
      detail: `known usage limit for ${role.model}: no dispatch until ${known.until} (seen ${known.noticedAt}). Use --clear-limits to retry sooner.`,
    };
    fs.writeFileSync(path.join(outDir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(1);
  }

  const args = [RELAY, '--brief', path.resolve(opts.brief), '--cd', path.resolve(opts.cd), '--out-dir', outDir];
  if (role.model) args.push('--model', role.model);
  if (role.effort) args.push('--effort', role.effort);
  if (opts.readOnly) args.push('--read-only');
  if (opts.session) args.push('--session', opts.session);
  if (opts.timeout) args.push('--timeout', opts.timeout);

  const proc = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const resultPath = path.join(outDir, 'result.json');
  const result = readJson(resultPath) || {
    status: 'failed', error: `relay exited ${proc.status} without result.json`,
    stderrTail: (proc.stderr || '').split('\n').filter(Boolean).slice(-20),
  };
  result.resultPath = fs.existsSync(resultPath) ? resultPath : null;

  const verdict = verdictFor(result, role, opts.role);
  if (verdict.kind === 'usage_limit') rememberLimit(role.model, verdict.detail);
  fs.writeFileSync(path.join(outDir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}

function probe(opts) {
  const roles = loadRoles(opts.cd || process.cwd());
  const names = opts.roles || Object.keys(roles).filter(n => roles[n].implementer === 'codex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-probe-'));
  const report = {};
  for (const name of names) {
    const role = roleConfig(roles, name);
    const known = activeLimit(role.model);
    if (known) {
      report[name] = {
        ok: false, kind: 'usage_limit', model: role.model || null, fallback: role.fallback || null,
        detail: `known usage limit until ${known.until} (seen ${known.noticedAt})`,
      };
      continue;
    }
    const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'model_reasoning_effort=low'];
    if (role.model) args.push('-m', role.model);
    args.push('-');
    // codex is a .cmd/.ps1 shim on Windows, so it needs a shell; every argument is a safe token.
    const r = spawnSync('codex', args, {
      cwd: dir, input: 'Reply with the single word OK.', encoding: 'utf8',
      shell: process.platform === 'win32', timeout: 120_000,
    });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const completed = /"type":"turn\.completed"/.test(out);
    const hit = completed ? null : classify(out);
    const kind = completed ? 'completed'
      : r.error?.code === 'ENOENT' || /not recognized|command not found/i.test(out) ? 'codex_missing'
      : hit?.kind || 'failed';
    report[name] = {
      ok: completed, kind, model: role.model || null,
      fallback: !completed && FALLBACK_KINDS.has(kind) ? role.fallback || null : null,
      detail: completed ? null : hit?.detail || out.trim().split('\n').slice(-2).join(' | ').slice(0, 300),
    };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({
    probe: report,
    note: 'A passing probe proves the CLI, auth and model are reachable — NOT that quota remains. A real dispatch can still hit the account usage limit; crew then remembers it and routes to the fallback for the rest of the run.',
  }, null, 2));
  process.exit(Object.values(report).every(r => r.ok) ? 0 : 1);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.clearLimits) {
  writeLimits({});
  console.log(`forgot every remembered usage limit (${LIMITS_FILE})`);
} else if (opts.limits) {
  const rows = Object.entries(readLimits());
  console.log(rows.length
    ? rows.map(([model, e]) => `${model}: no dispatch until ${e.until} (seen ${e.noticedAt})`).join('\n')
    : 'no usage limit remembered');
} else if (opts.probe) probe(opts);
else run(opts);
