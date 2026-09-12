// Stop: keep an active crew run going until the work is actually finished.
//
// While a run bound to THIS session has work left, block the stop and tell Claude exactly where to
// pick up. The idea comes from the ralph-loop plugin (Apache-2.0); this is an independent
// implementation that reads the ticket graph, so "done" is a fact on disk, not a claim.
//
// The session may stop when:
//   - the run is paused, awaiting approval, or done (only a human can move it on)
//   - the run belongs to another session
//   - dispatched work is genuinely in flight: its worker is still producing files and has not
//     delivered a report yet, or the orchestrator declared `run wait`
// It is NOT allowed to stop when an in-flight ticket has a report the ledger never picked up, or
// when a worker has shown no activity for keepGoing.staleMinutes — that is how an interrupted
// session used to idle for an hour with finished work waiting.
// After keepGoing.maxNoProgress continuations without any change, or maxContinuations in total, the
// run pauses itself with a reason, so it can never spin forever.
import fs from 'node:fs';
import path from 'node:path';
import { readStdin } from './lib.mjs';
import {
  activeSlug, config, crewDir, fingerprint, frontier, INFLIGHT, ledgerAppend, ledgerPath, loadTickets, parseStamp,
  projectRoot, readRun, taskDir, writeRun,
} from '../scripts/tickets.mjs';

const input = await readStdin();
const root = projectRoot(input.cwd || process.cwd());
const slug = root && activeSlug(root);
const run = slug && readRun(root, slug);
if (!run || run.status !== 'running') process.exit(0);
if (run.session && input.session_id && run.session !== input.session_id) process.exit(0);
if (['awaiting-approval', 'done'].includes(run.phase)) process.exit(0);

const cfg = config(root);
const tickets = loadTickets(root, slug);
const inflight = tickets.filter(t => INFLIGHT.has(t.status));
const ready = run.phase === 'tickets' ? frontier(tickets, cfg.limits?.parallel ?? 3) : [];

// ---------- liveness of in-flight work ----------

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage', '.cache']);
function newestMtime(dir, depth = 8) {
  let newest = 0;
  const walk = (d, left) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) { if (left > 0) walk(full, left - 1); }
        else { const m = fs.statSync(full).mtimeMs; if (m > newest) newest = m; }
      } catch { /* vanished mid-walk */ }
    }
  };
  walk(dir, depth);
  return newest;
}

/** When the ledger last mentioned this ticket (its dispatch at the latest). */
function lastLedgerTouch(id) {
  let last = parseStamp(run.startedAt ? run.startedAt.replace('T', ' ') : '') || new Date(run.startedAt || 0);
  try {
    for (const line of fs.readFileSync(ledgerPath(root, slug), 'utf8').split('\n')) {
      const m = line.match(/^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (.*)$/);
      if (m && new RegExp(`\\bT0*${Number(id)}\\b`).test(m[2])) { const d = parseStamp(m[1]); if (d && d > last) last = d; }
    }
  } catch { /* no ledger yet */ }
  return last;
}

const staleMs = (cfg.keepGoing?.staleMinutes ?? 45) * 60_000;
const now = Date.now();
const readyReports = [];
const stale = [];
for (const t of inflight) {
  const runDir = path.join(taskDir(root, slug), 'runs', t.id);
  const worktree = path.join(crewDir(root), `${slug}-t${t.id}`);
  const touched = lastLedgerTouch(t.id).getTime();
  let report = 0;
  for (const name of ['report.md', 'merge-report.md']) {
    try { report = Math.max(report, fs.statSync(path.join(runDir, name)).mtimeMs); } catch { /* none */ }
  }
  try {
    for (const e of fs.readdirSync(runDir)) {
      const verdict = path.join(runDir, e, 'verdict.json');
      try { report = Math.max(report, fs.statSync(verdict).mtimeMs); } catch { /* not a codex run dir */ }
    }
  } catch { /* no run dir yet */ }
  // A report newer than the ledger's last word on this ticket means a worker finished and nobody
  // acted on it (allow a minute of slack for the controller's own bookkeeping).
  if (report > touched + 60_000) { readyReports.push(t); continue; }
  const activity = Math.max(newestMtime(runDir), newestMtime(worktree), touched);
  if (now - activity > staleMs) stale.push({ t, minutes: Math.round((now - activity) / 60_000) });
}

const waiting = inflight.length && !ready.length && !readyReports.length && !stale.length;
if (waiting || (run.waiting && !readyReports.length && !stale.length)) process.exit(0);

// ---------- progress accounting ----------

const fp = fingerprint(root, slug, tickets, run.phase);
run.noProgress = fp === run.fingerprint ? (run.noProgress || 0) + 1 : 0;
run.fingerprint = fp;
run.continuations = (run.continuations || 0) + 1;

const maxNoProgress = cfg.keepGoing?.maxNoProgress ?? 3;
const maxContinuations = cfg.keepGoing?.maxContinuations ?? 300;
if (run.noProgress >= maxNoProgress || run.continuations > maxContinuations) {
  const reason = run.noProgress >= maxNoProgress
    ? `no progress in ${run.noProgress} continuations (tickets, ledger and phase unchanged)`
    : `reached ${maxContinuations} continuations`;
  writeRun(root, slug, { ...run, status: 'paused', reason });
  ledgerAppend(root, slug, `PAUSED by keep-going hook: ${reason}`);
  process.stdout.write(JSON.stringify({ systemMessage: `crew: run '${slug}' paused — ${reason}. Say "كمّل" / "continue" to resume.` }));
  process.exit(0);
}
writeRun(root, slug, { ...run, waiting: null });

// ---------- what to do next ----------

const done = tickets.filter(t => t.status === 'done').length;
const lines = [`crew run '${slug}' is not finished — phase ${run.phase}, ${done}/${tickets.length} tickets done.`];
if (readyReports.length) {
  lines.push(`Finished work is waiting for you: ${readyReports.map(t => `T${t.id} (${t.status})`).join(', ')} — each has a report newer than its last ledger entry. Read the report, verify the worktree and gates yourself, then review/merge and record it (\`tickets.mjs set <NN> review|done\`).`);
}
if (stale.length) {
  lines.push(`No activity for a while: ${stale.map(({ t, minutes }) => `T${t.id} (${minutes} min, status ${t.status})`).join(', ')}. Check whether its worker is still alive (list your background agents/tasks). If it is gone, re-dispatch from what the worktree holds or mark it needs-human; if it is alive, record \`tickets.mjs run wait --reason "T<NN> still working: <what>"\`.`);
}
if (run.phase === 'tickets') {
  if (ready.length) lines.push(`Ready now: ${ready.map(t => `T${t.id} ${t.title}`).join(' | ')}. Dispatch them (background, same message)${inflight.length ? `; T${inflight.map(t => t.id).join(', T')} still in flight` : ''}.`);
  else if (tickets.every(t => ['done', 'dropped'].includes(t.status))) lines.push('Every ticket is finished: move to the final review (`tickets.mjs run phase final-review`).');
  else if (!inflight.length) lines.push('Tickets remain but none is ready or in flight: resolve the blockage (needs-human / dropped blockers) or pause the run with a reason.');
} else {
  lines.push(`Continue the ${run.phase} phase.`);
}
lines.push(
  `Work from .crew/tasks/${slug}/ledger.md and \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/tickets.mjs" summary\`, not from memory, and follow the crew:run skill.`,
  'Stop only for the four stop classes, and run `tickets.mjs run pause --reason "<decision needed>"` first.',
);

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: lines.join('\n'),
  systemMessage: `crew: continuing '${slug}' (${done}/${tickets.length} done, phase ${run.phase}${readyReports.length ? `, ${readyReports.length} report(s) waiting` : ''}${stale.length ? `, ${stale.length} stale` : ''})`,
}));
