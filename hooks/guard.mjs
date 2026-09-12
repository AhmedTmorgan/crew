// PreToolUse (Bash|PowerShell): the mechanical lock behind crew's approval gate.
//
// This hook matches command TEXT. It is a second lock, not a permission system: pair it with real
// branch protection on the forge (crew:setup offers to enable it) and with Claude Code's own
// permission rules. What it does:
//  - deny: force-pushing or deleting the base branch, and the project's guard.denyPatterns
//  - ask:  anything that changes production or shared state — the project's configured deploy and
//          production-migration commands, well-known production CLIs, merging a PR, merging while
//          checked out on the base branch, pushing to the base branch, discarding uncommitted work,
//          deleting or re-publishing a repository, writes to third-party APIs the project lists in
//          guard.externalWritePatterns, and guard.askPatterns
// "ask" makes Claude Code show a permission prompt, so these never run without the human.
import { spawnSync } from 'node:child_process';
import { project, readStdin } from './lib.mjs';

const input = await readStdin();
const command = String(input.tool_input?.command || '');
if (!command) process.exit(0);

const cwd = input.cwd || process.cwd();
const p = project(cwd);
const config = p?.config || {};
const guard = config.guard || {};
const base = config.baseBranch || 'main|master';
const lower = command.toLowerCase();
// A dry run or a local target is how crew VALIDATES before asking; it must stay frictionless.
const harmless = /--dry-run\b|--local\b/i.test(command);

const deny = reason => {
  process.stderr.write(`crew guard: ${reason}\n`);
  process.exit(2);
};
const ask = reason => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `crew guard: ${reason}` },
  }));
  process.exit(0);
};
const includesAny = patterns => (patterns || []).find(x => x && lower.includes(String(x).toLowerCase()));
// Regexes over the base-branch name are built with String.raw so the escapes survive verbatim.
const rx = (source, flags = '') => new RegExp(source, flags);

/** The branch checked out where the command will run (a `git -C <dir>` prefix wins over cwd). */
function currentBranch() {
  const m = command.match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const dir = m ? (m[1] || m[2] || m[3]) : cwd;
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
const baseRe = rx(String.raw`(^|[\s:/+])(${base})(\s|$)`);
const onBase = () => { const b = currentBranch(); return Boolean(b) && rx(`^(${base})$`).test(b); };

// ---- deny ----
const pushes = command.match(/\bgit(\s+-C\s+("[^"]*"|'[^']*'|\S+))?\s+push\b[^;&|\n]*/gi) || [];
for (const push of pushes) {
  const forced = /\s(--force(?!-with-lease)|-f)(\s|$)/.test(push) || /\s\+\S+/.test(push);
  if (forced && baseRe.test(push)) deny(`force-pushing the base branch (${base}) is blocked. Open a PR instead.`);
  const deleting = /\s(--delete|-d)\s/.test(push) || rx(String.raw`\s:(${base})(\s|$)`).test(push);
  if (deleting && baseRe.test(push)) deny(`deleting the base branch (${base}) on the remote is blocked.`);
}
const denied = includesAny(guard.denyPatterns);
if (denied) deny(`"${denied}" is on this project's deny list (.crew/config.json guard.denyPatterns).`);

// ---- ask: the project's own production commands ----
if (!harmless) {
  for (const [what, c] of [['production deploy', config.commands?.deploy], ['production migrations', config.commands?.migrateProd]]) {
    if (c && lower.includes(String(c).toLowerCase())) ask(`${what} ("${c}") needs the owner's approval.`);
  }
}

// ---- ask: well-known production and shared-state commands ----
const ASK = [
  [/\bvercel\b[^\n]*(--prod\b|\bdeploy\b[^\n]*--prod|\bpromote\b|\brollback\b)/i, 'Vercel production change'],
  [/\bnetlify\s+deploy\b[^\n]*--prod/i, 'Netlify production deploy'],
  [/\bfly(ctl)?\s+deploy\b/i, 'Fly.io deploy'],
  [/\brailway\s+up\b/i, 'Railway deploy'],
  [/\bwrangler\s+(deploy|publish)\b/i, 'Cloudflare deploy'],
  [/\bfirebase\s+deploy\b/i, 'Firebase deploy'],
  // Any db push can reach production: --db-url is a connection string that may well be prod.
  [/\bsupabase\s+db\s+(push|reset)\b/i, 'Supabase database change (db push/reset) — any target that is not --local or --dry-run'],
  [/\bsupabase\s+(functions\s+deploy|secrets\s+set|db\s+remote\s+commit)\b/i, 'Supabase remote change'],
  [/\bprisma\s+(migrate\s+deploy|migrate\s+reset|db\s+push)\b/i, 'Prisma database change'],
  [/\bterraform\s+(apply|destroy)\b|\bpulumi\s+(up|destroy)\b/i, 'infrastructure change'],
  [/\bkubectl\s+(apply|delete|rollout|scale)\b|\bhelm\s+(install|upgrade|uninstall)\b/i, 'Kubernetes change'],
  [/\bgh\s+pr\s+merge\b/i, 'merging a pull request'],
  [/\bgh\s+repo\s+(delete|archive|edit\b[^\n]*--visibility|rename)\b/i, 'changing or deleting a repository'],
  [/\bgh\s+api\b[^\n]*(-X|--method)\s+(PUT|PATCH|DELETE|POST)\b[^\n]*\/repos\/[^\n]*(branches|rulesets|protection|collaborators)/i, 'changing repository protection or access'],
  [/\bgit(\s+-C\s+\S+)?\s+reset\s+--hard\b|\bgit(\s+-C\s+\S+)?\s+clean\s+-\w*[fdx]/i, 'discarding uncommitted work (reset --hard / clean)'],
  [/\bgit(\s+-C\s+\S+)?\s+worktree\s+remove\b[^\n]*(--force|-f)\b/i, 'force-removing a worktree with uncommitted changes'],
  [/\bgit(\s+-C\s+\S+)?\s+branch\s+-D\b/i, 'force-deleting a branch'],
];
if (!harmless) for (const [re, what] of ASK) if (re.test(command)) ask(`${what} needs the owner's approval.`);

for (const push of pushes) {
  if (rx(String.raw`\s(origin\s+)?(HEAD:)?(${base})(\s|$)`).test(push)) ask(`pushing straight to the base branch (${base}) — crew ships through PRs.`);
  // `git push` with no refspec pushes the checked-out branch: ask when that branch is the base.
  const bare = push.replace(/\s--?[\w-]+(=\S*)?/g, '').trim().split(/\s+/).length <= 3;
  if (bare && onBase()) ask(`pushing while checked out on the base branch (${base}) — crew ships through PRs.`);
}
if (/\bgit(\s+-C\s+\S+)?\s+(merge|rebase|cherry-pick|commit)\b/i.test(command) && onBase()) {
  ask(`this changes the base branch (${base}) directly — crew lands work through PRs.`);
}

// ---- ask: writes to external services the project names ----
const external = includesAny(guard.externalWritePatterns);
if (external) ask(`"${external}" writes to an external service (guard.externalWritePatterns) — needs the owner's approval.`);
const asked = includesAny(guard.askPatterns);
if (asked) ask(`"${asked}" is on this project's approval list (guard.askPatterns).`);
process.exit(0);
