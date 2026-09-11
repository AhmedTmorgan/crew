// PreToolUse (Bash|PowerShell): the mechanical lock behind crew's approval gate.
//  - deny: force-pushing the base branch, and the project's guard.denyPatterns
//  - ask:  production deploys and production migrations (the project's configured commands, well-known
//          production CLIs, guard.askPatterns) and direct pushes to the base branch
// "ask" makes Claude Code show a permission prompt, so these commands never run without the human.
import { project, readStdin } from './lib.mjs';

const input = await readStdin();
const command = String(input.tool_input?.command || '');
if (!command) process.exit(0);

const p = project(input.cwd || process.cwd());
const config = p?.config || {};
const base = config.baseBranch || 'main|master';
const lower = command.toLowerCase();

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

// ---- deny ----
const pushes = command.match(/git(\s+-C\s+("[^"]*"|\S+))?\s+push\b[^;&|\n]*/gi) || [];
const baseRe = new RegExp(`(^|[\\s:/+])(${base})(\\s|$)`);
for (const push of pushes) {
  const forced = /\s(--force(?!-with-lease)|-f)(\s|$)/.test(push) || /\s\+\S+/.test(push);
  if (forced && baseRe.test(push)) deny(`force-pushing the base branch (${base}) is blocked. Open a PR instead.`);
}
for (const pattern of config.guard?.denyPatterns || []) {
  if (pattern && lower.includes(String(pattern).toLowerCase())) deny(`"${pattern}" is on this project's deny list (.crew/config.json guard.denyPatterns).`);
}

// ---- ask ----
const configured = [
  ['production deploy', config.commands?.deploy],
  ['production migrations', config.commands?.migrateProd],
].filter(([, c]) => c);
for (const [what, c] of configured) {
  if (lower.includes(String(c).toLowerCase())) ask(`${what} ("${c}") needs the owner's approval.`);
}

const PRODUCTION = [
  [/\bvercel\b[^\n]*(--prod\b|\bdeploy\b[^\n]*--prod)/i, 'Vercel production deploy'],
  [/\bnetlify\s+deploy\b[^\n]*--prod/i, 'Netlify production deploy'],
  [/\bfly(ctl)?\s+deploy\b/i, 'Fly.io deploy'],
  [/\brailway\s+up\b/i, 'Railway deploy'],
  [/\bwrangler\s+(deploy|publish)\b/i, 'Cloudflare deploy'],
  [/\bfirebase\s+deploy\b/i, 'Firebase deploy'],
  [/\bsupabase\s+db\s+push\b(?![^\n]*(--db-url|--local|--dry-run))/i, 'Supabase migrations to the linked (production) project'],
  [/\bprisma\s+migrate\s+deploy\b/i, 'Prisma production migrations'],
  [/\bterraform\s+apply\b/i, 'Terraform apply'],
  [/\bkubectl\s+(apply|delete|rollout)\b/i, 'Kubernetes change'],
];
for (const [re, what] of PRODUCTION) if (re.test(command)) ask(`${what} needs the owner's approval.`);

for (const push of pushes) {
  if (new RegExp(`\\s(origin\\s+)?(HEAD:)?(${base})(\\s|$)`).test(push)) ask(`pushing straight to the base branch (${base}) — crew ships through PRs.`);
}
for (const pattern of config.guard?.askPatterns || []) {
  if (pattern && lower.includes(String(pattern).toLowerCase())) ask(`"${pattern}" is on this project's approval list (guard.askPatterns).`);
}
process.exit(0);
