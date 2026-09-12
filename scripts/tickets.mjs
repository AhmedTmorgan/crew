#!/usr/bin/env node
/**
 * crew · tickets.mjs — the ticket graph and run state behind crew:run.
 *
 * Tickets are markdown files (.crew/tasks/<slug>/tickets/NN-title.md). Their **Status:** line is the
 * source of truth, so progress is readable and editable by a human. ledger.md is the append-only
 * record that survives compaction and new sessions. run.json is what the keep-going hook reads.
 *
 *   node tickets.mjs list      [--task <slug>]
 *   node tickets.mjs frontier  [--task <slug>] [--json]        ready tickets (blockers, parallel limit, Touches)
 *   node tickets.mjs set       <NN> <status> [--task <slug>] [--note "<text>"]
 *   node tickets.mjs note      "<text>" [--task <slug>]         append a ledger line, e.g. "Ruling: …"
 *   node tickets.mjs validate  [--task <slug>]
 *   node tickets.mjs summary   [--task <slug>]
 *   node tickets.mjs run start|resume|wait|pause|phase|finish|status [--task <slug>] [--reason "<text>"] [<phase>]
 *
 * --task defaults to the active run (.crew/active-run).
 * Statuses: todo, in-progress, review, fixing, done, needs-human, dropped.
 * Phases:   tickets, final-review, migrations, ship, awaiting-approval, releasing, done.
 * The run binds to the Claude Code session that starts or resumes it (CLAUDE_CODE_SESSION_ID), so
 * the keep-going hook never holds another session in the same project.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATUSES = ['todo', 'in-progress', 'review', 'fixing', 'done', 'needs-human', 'dropped'];
export const INFLIGHT = new Set(['in-progress', 'review', 'fixing']);
export const FINISHED = new Set(['done', 'dropped']);
export const PHASES = ['tickets', 'final-review', 'migrations', 'ship', 'awaiting-approval', 'releasing', 'done'];
const LAYERS = new Set(['backend', 'frontend', 'db', 'infra', 'docs']);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELD_RE = /^\*\*(Status|Blocked by|Layers|Touches|Size|Issue):\*\*\s*(.*)$/i;
const num = s => String(Number(String(s).replace(/\D/g, '')));

function fail(message) {
  process.stderr.write(`tickets.mjs: ${message}\n`);
  process.exit(2);
}

// ---------- locations and config ----------

/** The MAIN checkout's root, also when called from inside a crew worktree. */
export function projectRoot(cwd = process.cwd()) {
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (common.status !== 0) return null;
  const dir = common.stdout.trim();
  if (path.basename(dir) === '.git') return path.dirname(dir);
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return top.status === 0 ? top.stdout.trim() : null;
}

const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
};

export function config(root) {
  const defaults = readJson(path.join(PLUGIN_ROOT, 'templates', 'crew.config.json')) || {};
  const project = readJson(path.join(root, '.crew', 'config.json')) || {};
  // A project overrides one field of a role (say roles.backend.model) without losing the rest of it.
  const roles = { ...defaults.roles };
  for (const [name, role] of Object.entries(project.roles || {})) roles[name] = { ...defaults.roles?.[name], ...role };
  return {
    ...defaults, ...project,
    roles,
    limits: { ...defaults.limits, ...project.limits },
    keepGoing: { ...defaults.keepGoing, ...project.keepGoing },
  };
}

export const taskDir = (root, slug) => path.join(root, '.crew', 'tasks', slug);
const activeFile = root => path.join(root, '.crew', 'active-run');

export function activeSlug(root) {
  try { return fs.readFileSync(activeFile(root), 'utf8').trim() || null; } catch { return null; }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---------- tickets ----------

export function loadTickets(root, slug) {
  const dir = path.join(taskDir(root, slug), 'tickets');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^\d{2,}-.*\.md$/.test(f)).sort().map(file => {
    const full = path.join(dir, file);
    // Windows editors often save a BOM, which would hide the "# NN: Title" heading on line 1.
    const text = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const t = {
      id: file.match(/^(\d{2,})/)[1], file: full, title: '', status: '', blockedBy: [], layers: [],
      touches: [], size: '', issue: '', hasCriteria: /^##\s+Acceptance criteria/im.test(text),
    };
    for (const line of text.split('\n')) {
      const heading = line.match(/^#\s+\d{2,}\s*:\s*(.+)$/);
      if (heading && !t.title) t.title = heading[1].trim();
      const m = line.match(FIELD_RE);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      const list = () => (!value || /^none\b/i.test(value) ? [] : value.split(',').map(s => s.trim()).filter(Boolean));
      if (key === 'status') t.status = value.toLowerCase().split(/\s/)[0];
      else if (key === 'blocked by') t.blockedBy = list();
      else if (key === 'layers') t.layers = list().map(s => s.toLowerCase());
      else if (key === 'touches') t.touches = list().map(s => s.toLowerCase());
      else if (key === 'size') t.size = value;
      else if (key === 'issue') t.issue = value;
    }
    return t;
  });
}

/** Ready tickets: todo, every blocker finished, no Touches overlap with in-flight work, within the limit. */
export function frontier(tickets, limit = Infinity) {
  const byNum = new Map(tickets.map(t => [num(t.id), t]));
  const busy = tickets.filter(t => INFLIGHT.has(t.status));
  const taken = new Set(busy.flatMap(t => t.touches));
  const slots = Math.max(0, limit - busy.length);
  const ready = [];
  for (const t of tickets) {
    if (ready.length >= slots) break;
    if (t.status !== 'todo') continue;
    if (!t.blockedBy.every(b => FINISHED.has(byNum.get(num(b))?.status))) continue;
    if (t.touches.some(x => taken.has(x))) continue;
    ready.push(t);
    t.touches.forEach(x => taken.add(x));
  }
  return ready;
}

function findTicket(tickets, id) {
  const t = tickets.find(x => num(x.id) === num(id));
  if (!t) fail(`no ticket ${id}`);
  return t;
}

// ---------- ledger and run state ----------

// Local time, so the ledger reads the way the owner's clock does; `parseStamp` inverts it.
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseStamp = s => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
export const ledgerPath = (root, slug) => path.join(taskDir(root, slug), 'ledger.md');

export function ledgerAppend(root, slug, line) {
  const file = ledgerPath(root, slug);
  if (!fs.existsSync(file)) writeAtomic(file, `# crew ledger — task: ${slug}\n\n`);
  fs.appendFileSync(file, `- ${stamp()} · ${line.replace(/\s*\n\s*/g, ' ')}\n`);
}

export const readRun = (root, slug) => readJson(path.join(taskDir(root, slug), 'run.json'));

export function writeRun(root, slug, run) {
  writeAtomic(path.join(taskDir(root, slug), 'run.json'), `${JSON.stringify({ ...run, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

/** Changes whenever real progress happens: a status, a ledger line, or a phase. */
export function fingerprint(root, slug, tickets, phase) {
  let ledgerSize = 0;
  try { ledgerSize = fs.statSync(path.join(taskDir(root, slug), 'ledger.md')).size; } catch { /* none yet */ }
  const state = tickets.map(t => `${t.id}:${t.status}`).join(',');
  return crypto.createHash('sha1').update(`${phase}|${ledgerSize}|${state}`).digest('hex').slice(0, 12);
}

/** Any bookkeeping means the orchestrator is active again, so a pending "waiting" flag is cleared. */
function touchRun(root, slug) {
  const run = readRun(root, slug);
  if (run?.waiting) writeRun(root, slug, { ...run, waiting: null });
}

// ---------- commands ----------

function cmdList(root, slug) {
  const tickets = loadTickets(root, slug);
  if (!tickets.length) { console.log('(no tickets)'); return; }
  for (const t of tickets) {
    const blockers = t.blockedBy.length ? t.blockedBy.join(',') : '-';
    console.log(`${t.id}  ${t.status.padEnd(11)} ${t.layers.join('+').padEnd(18)} blocked-by:${blockers.padEnd(8)} ${t.title}`);
  }
}

function cmdFrontier(root, slug, opts) {
  const limit = config(root).limits?.parallel ?? 3;
  const ready = frontier(loadTickets(root, slug), limit);
  if (opts.json) {
    console.log(JSON.stringify(ready.map(({ id, title, layers, touches, file }) => ({ id, title, layers, touches, file })), null, 2));
    return;
  }
  if (!ready.length) { console.log('(nothing ready)'); return; }
  for (const t of ready) console.log(`${t.id}  ${t.layers.join('+').padEnd(18)} ${t.title}`);
}

function cmdSet(root, slug, opts) {
  const [, id, status] = opts._;
  if (!id || !status) fail('usage: set <NN> <status> [--note "…"]');
  if (!STATUSES.includes(status)) fail(`unknown status "${status}" (use: ${STATUSES.join(', ')})`);
  const t = findTicket(loadTickets(root, slug), id);
  const raw = fs.readFileSync(t.file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex(l => /^\*\*Status:\*\*/i.test(l));
  if (at < 0) fail(`${path.basename(t.file)} has no **Status:** line`);
  lines[at] = `**Status:** ${status}`;
  writeAtomic(t.file, lines.join(eol));
  ledgerAppend(root, slug, `T${t.id} → ${status}${opts.note ? ` · ${opts.note}` : ''}`);
  touchRun(root, slug);
  console.log(`T${t.id} → ${status}`);
}

function cmdNote(root, slug, opts) {
  const text = opts._.slice(1).join(' ').trim();
  if (!text) fail('usage: note "<text>"');
  ledgerAppend(root, slug, text);
  touchRun(root, slug);
  console.log('noted');
}

function cmdValidate(root, slug) {
  const tickets = loadTickets(root, slug);
  const errors = [];
  const warnings = [];
  if (!tickets.length) errors.push('no tickets found');
  const byNum = new Map();
  for (const t of tickets) {
    if (byNum.has(num(t.id))) errors.push(`duplicate ticket number ${t.id}`);
    byNum.set(num(t.id), t);
  }
  for (const t of tickets) {
    const where = `T${t.id}`;
    if (!t.title) errors.push(`${where}: missing "# NN: Title" heading`);
    if (!STATUSES.includes(t.status)) errors.push(`${where}: bad or missing status "${t.status}"`);
    if (!t.layers.length) errors.push(`${where}: missing **Layers:**`);
    for (const l of t.layers) if (!LAYERS.has(l)) errors.push(`${where}: unknown layer "${l}"`);
    if (!t.touches.length) errors.push(`${where}: missing **Touches:** (needed to keep parallel tickets apart)`);
    if (!t.hasCriteria) errors.push(`${where}: missing "## Acceptance criteria"`);
    for (const b of t.blockedBy) {
      if (!byNum.has(num(b))) errors.push(`${where}: blocked by unknown ticket "${b}"`);
      if (num(b) === num(t.id)) errors.push(`${where}: blocks itself`);
    }
  }
  // Cycles: depth-first search over "blocked by" edges.
  const state = new Map();
  const visit = (t, trail) => {
    const key = num(t.id);
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'active') { errors.push(`cycle: ${[...trail, t.id].join(' → ')}`); return; }
    state.set(key, 'active');
    for (const b of t.blockedBy) if (byNum.has(num(b))) visit(byNum.get(num(b)), [...trail, t.id]);
    state.set(key, 'done');
  };
  tickets.forEach(t => visit(t, []));
  // Overlapping Touches is fine only when one ticket (transitively) blocks the other.
  const reach = (from, to, seen = new Set()) => {
    if (seen.has(num(from.id))) return false;
    seen.add(num(from.id));
    return from.blockedBy.some(b => num(b) === num(to.id) || (byNum.has(num(b)) && reach(byNum.get(num(b)), to, seen)));
  };
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const [a, b] = [tickets[i], tickets[j]];
      const shared = a.touches.filter(x => b.touches.includes(x));
      if (shared.length && !reach(a, b) && !reach(b, a)) {
        warnings.push(`T${a.id} and T${b.id} share Touches (${shared.join(', ')}) with no blocking path; the run will serialise them`);
      }
    }
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : `ok (${tickets.length} tickets)`);
  process.exit(errors.length ? 1 : 0);
}

export function summarize(root, slug) {
  const tickets = loadTickets(root, slug);
  const count = s => tickets.filter(t => t.status === s).length;
  const limit = config(root).limits?.parallel ?? 3;
  const ready = frontier(tickets, limit);
  const inflight = tickets.filter(t => INFLIGHT.has(t.status));
  const remaining = tickets.filter(t => !FINISHED.has(t.status));
  return {
    total: tickets.length, done: count('done'), dropped: count('dropped'), needsHuman: count('needs-human'),
    inflight: inflight.map(t => t.id), ready: ready.map(t => `${t.id} ${t.title}`), remaining: remaining.length,
    stuck: remaining.length > 0 && !inflight.length && !ready.length,
  };
}

function cmdSummary(root, slug) {
  const s = summarize(root, slug);
  const run = readRun(root, slug);
  console.log(`task ${slug}: ${s.done}/${s.total} done · in flight: ${s.inflight.join(', ') || '-'} · needs-human: ${s.needsHuman}` +
    `${run ? ` · run ${run.status}/${run.phase}` : ''}`);
  if (s.ready.length) console.log(`ready: ${s.ready.join(' | ')}`);
  if (s.stuck) console.log('STUCK: tickets remain but none is ready or in flight (blocked by needs-human or dropped work?)');
}

/** Worktree folder crew uses for this project: <parent>/<repo>-crew */
export const crewDir = root => path.join(path.dirname(root), `${path.basename(root)}-crew`);

/**
 * Open problems that forbid shipping, whatever the fix-loop count: any open critical entry, and any
 * open security entry of severity high or critical, in the project's journal or the integration
 * tree's copy. Plus parked findings the ledger marks critical or security.
 */
export function releaseBlockers(root, slug) {
  const blockers = [];
  const bugsName = config(root).bugsFile || 'BUGS.md';
  const files = [path.join(root, bugsName), path.join(crewDir(root), slug, bugsName)].filter(f => fs.existsSync(f));
  const bugs = path.join(PLUGIN_ROOT, 'scripts', 'bugs.mjs');
  const seen = new Set();
  for (const file of files) {
    const r = spawnSync(process.execPath, [bugs, 'list', '--status', 'all', '--json', '--file', file], { encoding: 'utf8' });
    let rows = [];
    try { rows = JSON.parse(r.stdout || '[]'); } catch { /* unreadable journal: say so */ blockers.push(`cannot read ${file}`); }
    for (const b of rows) {
      if (!['open', 'in-progress'].includes(b.status) || seen.has(b.id)) continue;
      const critical = b.severity === 'critical';
      const security = b.category === 'security' && ['critical', 'high'].includes(b.severity);
      if (critical || security) { seen.add(b.id); blockers.push(`${b.id} [${b.severity}, ${b.category}] ${b.title} — ${b.status}`); }
    }
  }
  const ledger = ledgerPath(root, slug);
  if (fs.existsSync(ledger)) {
    for (const line of fs.readFileSync(ledger, 'utf8').split('\n')) {
      if (/parked/i.test(line) && /critical|security/i.test(line) && !/(unparked|resolved|fixed) /i.test(line)) blockers.push(`ledger: ${line.replace(/^- /, '').slice(0, 160)}`);
    }
  }
  return blockers;
}

function cmdRun(root, slug, opts) {
  const action = opts._[1];
  const run = readRun(root, slug) || {};
  const session = process.env.CLAUDE_CODE_SESSION_ID || null;
  const save = (patch, line) => {
    writeRun(root, slug, { ...run, ...patch });
    if (line) ledgerAppend(root, slug, line);
  };
  switch (action) {
    case 'start':
      if (!loadTickets(root, slug).length) fail('no tickets to run. Write them with crew:tickets first');
      save({ slug, status: 'running', phase: 'tickets', session, startedAt: new Date().toISOString(),
        continuations: 0, noProgress: 0, fingerprint: null, waiting: null, reason: null },
      `run started (session ${session || 'unknown'})`);
      writeAtomic(activeFile(root), `${slug}\n`);
      break;
    case 'resume':
      save({ status: 'running', session, noProgress: 0, waiting: null, reason: null }, `run resumed (session ${session || 'unknown'})`);
      writeAtomic(activeFile(root), `${slug}\n`);
      break;
    case 'wait':
      save({ waiting: opts.reason || 'background work' }, `waiting: ${opts.reason || 'background work'}`);
      break;
    case 'pause':
      if (!opts.reason) fail('pause needs --reason "<what the human must decide or do>"');
      save({ status: 'paused', reason: opts.reason, waiting: null }, `PAUSED: ${opts.reason}`);
      break;
    case 'phase': {
      const phase = opts._[2];
      if (!PHASES.includes(phase)) fail(`unknown phase "${phase}" (use: ${PHASES.join(', ')})`);
      if (['ship', 'awaiting-approval', 'releasing', 'done'].includes(phase)) {
        const blockers = releaseBlockers(root, slug);
        if (blockers.length) {
          ledgerAppend(root, slug, `phase ${phase} REFUSED: open critical/security problems — ${blockers.join(' | ')}`);
          fail(`cannot enter phase "${phase}": open critical or security problems block any release, however many fix rounds ran:\n  - ${blockers.join('\n  - ')}\nFix them (and mark the journal entries fixed/mitigated with a note), or the owner decides in chat.`);
        }
      }
      save({ phase, waiting: null, noProgress: 0, ...(phase === 'done' ? { status: 'done' } : {}) }, `phase → ${phase}`);
      if (phase === 'done') fs.rmSync(activeFile(root), { force: true });
      break;
    }
    case 'finish': {
      const blockers = releaseBlockers(root, slug);
      if (blockers.length) fail(`cannot finish: open critical or security problems — ${blockers.join(' | ')}`);
      save({ phase: 'done', status: 'done', waiting: null }, 'run finished');
      fs.rmSync(activeFile(root), { force: true });
      break;
    }
    case 'status':
      console.log(JSON.stringify({ run: readRun(root, slug), summary: summarize(root, slug) }, null, 2));
      return;
    default:
      fail('usage: run start|resume|wait|pause|phase <phase>|finish|status');
  }
  console.log(`run ${action}${action === 'phase' ? ` ${opts._[2]}` : ''} · ${slug}`);
}

// ---------- CLI ----------

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { opts._.push(arg); continue; }
    const key = arg.slice(2);
    if (key === 'json') { opts.json = true; continue; }
    if (argv[i + 1] === undefined) fail(`--${key} needs a value`);
    opts[key] = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const command = opts._[0];
  const commands = { list: cmdList, frontier: cmdFrontier, set: cmdSet, note: cmdNote, validate: cmdValidate, summary: cmdSummary, run: cmdRun };
  if (!commands[command]) {
    const doc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
    process.stdout.write(`${doc.replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '')}\n`);
    process.exit(command ? 2 : 0);
  }
  const root = projectRoot();
  if (!root) fail('not inside a git repository');
  const slug = opts.task || activeSlug(root);
  if (!slug) fail('no --task given and no active run (.crew/active-run)');
  if (!fs.existsSync(taskDir(root, slug))) fail(`no task folder .crew/tasks/${slug}`);
  commands[command](root, slug, opts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
