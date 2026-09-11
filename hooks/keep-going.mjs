// Stop: keep an active crew run going until the work is actually finished.
//
// While a run bound to THIS session has work left and nothing is legitimately being waited on, block
// the stop and tell Claude exactly where to pick up. The idea comes from the ralph-loop plugin
// (Apache-2.0). This hook is written from scratch for crew: instead of trusting a completion phrase,
// it reads the ticket graph, so "done" is a fact on disk, not a claim.
//
// It lets the session stop when:
//   - the run is paused, awaiting approval, or done (only a human can move it on)
//   - dispatched work is in flight, or the orchestrator declared `run wait`, so a notification will
//     wake the session
//   - the run belongs to another session
//   - there has been no progress for keepGoing.maxNoProgress continuations, or maxContinuations is
//     exceeded. The run is then paused with a reason, so it can never spin forever.
import { readStdin } from './lib.mjs';
import {
  activeSlug, config, fingerprint, frontier, INFLIGHT, ledgerAppend, loadTickets, projectRoot, readRun, writeRun,
} from '../scripts/tickets.mjs';

const input = await readStdin();
const root = projectRoot(input.cwd || process.cwd());
const slug = root && activeSlug(root);
const run = slug && readRun(root, slug);
if (!run || run.status !== 'running') process.exit(0);
if (run.session && input.session_id && run.session !== input.session_id) process.exit(0);
if (['awaiting-approval', 'done'].includes(run.phase)) process.exit(0);
if (run.waiting) process.exit(0);

const cfg = config(root);
const tickets = loadTickets(root, slug);
const inflight = tickets.filter(t => INFLIGHT.has(t.status));
const ready = run.phase === 'tickets' ? frontier(tickets, cfg.limits?.parallel ?? 3) : [];
if (inflight.length && !ready.length) process.exit(0);

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
writeRun(root, slug, run);

const done = tickets.filter(t => t.status === 'done').length;
const next = run.phase === 'tickets'
  ? (ready.length
    ? `Ready now: ${ready.map(t => `T${t.id} ${t.title}`).join(' | ')}. Dispatch them (background, same message)${inflight.length ? `; T${inflight.map(t => t.id).join(', T')} still in flight` : ''}.`
    : tickets.every(t => ['done', 'dropped'].includes(t.status))
      ? 'Every ticket is finished: move to the final review (`tickets.mjs run phase final-review`).'
      : 'Tickets remain but none is ready or in flight: resolve the blockage (needs-human / dropped blockers) or pause the run with a reason.')
  : `Continue the ${run.phase} phase.`;

const reason = [
  `crew run '${slug}' is not finished — phase ${run.phase}, ${done}/${tickets.length} tickets done.`,
  next,
  `Work from .crew/tasks/${slug}/ledger.md and \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/tickets.mjs" summary\`, not from memory, and follow the crew:run skill.`,
  'If you are waiting on background work you already dispatched, record it (`tickets.mjs set <NN> in-progress`, or `tickets.mjs run wait --reason "<what>"`) and end the turn.',
  'Stop only for the four stop classes, and run `tickets.mjs run pause --reason "<decision needed>"` first.',
].join('\n');

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason,
  systemMessage: `crew: continuing '${slug}' (${done}/${tickets.length} done, phase ${run.phase})`,
}));
