#!/usr/bin/env node
/**
 * crew · bugs.mjs — the project problem journal (BUGS.md).
 *
 * One file per project, however large the project. Every session records the problems it hit, how
 * they were solved, what is still open, and security issues that need a human. Entries sit under
 * fixed category sections and carry permanent ids (BUG-0001), and a generated summary at the top
 * lists what is still open — security first — so the file stays readable at any size.
 *
 *   node bugs.mjs init    [--project <name>]
 *   node bugs.mjs add     --json '<entry>' | --from <entry.json> | --title … --category … [fields…]
 *   node bugs.mjs update  <BUG-id> --json '<fields>' | --from <file> | [fields…]
 *   node bugs.mjs list    [--status open|closed|all] [--category <key>] [--severity <level>] [--json]
 *   node bugs.mjs show    <BUG-id>
 *   node bugs.mjs find    <text>
 *   node bugs.mjs summary [--brief]
 *   node bugs.mjs check   [--fix]
 *
 * Fields: title, category, severity, status, phase, where, problem, cause, fix, commit, remaining,
 *         links, by
 * Common: --file <path>   (default: <git root>/<bugsFile from .crew/config.json, else BUGS.md>)
 *
 * Git merges: setup marks BUGS.md `merge=union`, so parallel branches that each add entries merge
 * without conflicts. That can leave a duplicated id or a stale summary; `check --fix` repairs both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CATEGORIES = [
  ['security', 'Security'],
  ['data', 'Database & migrations'],
  ['auth', 'Auth & permissions'],
  ['backend', 'Backend & API'],
  ['frontend', 'Frontend & UI'],
  ['integrations', 'Integrations & webhooks'],
  ['performance', 'Performance'],
  ['build', 'Build, tooling & CI'],
  ['deploy', 'Deploy & infrastructure'],
  ['tests', 'Tests'],
  ['other', 'Other'],
];
const STATUSES = ['open', 'in-progress', 'mitigated', 'fixed', 'wontfix'];
const OPEN_STATUSES = new Set(['open', 'in-progress', 'mitigated']);
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Field key (CLI / JSON) → label written in the file, in the order entries are rendered.
const FIELDS = [
  ['status', 'Status'],
  ['severity', 'Severity'],
  ['phase', 'Phase'],
  ['found', 'Found'],
  ['where', 'Where'],
  ['problem', 'Problem'],
  ['cause', 'Root cause'],
  ['fix', 'Fix'],
  ['remaining', 'Still open'],
  ['links', 'Links'],
  ['updated', 'Updated'],
];
const LABEL = Object.fromEntries(FIELDS);
const INPUT_KEYS = new Set([...FIELDS.map(([k]) => k), 'title', 'category', 'commit', 'by']);

const SUMMARY_START = '<!-- crew:summary:start -->';
const SUMMARY_END = '<!-- crew:summary:end -->';
const ENTRY_RE = /^### (BUG-\d{4,}) · (.*)$/;
const CAT_RE = /^<!-- crew:category:([a-z-]+) -->$/;
const FIELD_RE = /^- \*\*(.+?):\*\* ?(.*)$/;
const SUMMARY_CAP = 100;

const today = () => new Date().toISOString().slice(0, 10);

function fail(message, code = 2) {
  process.stderr.write(`bugs.mjs: ${message}\n`);
  process.exit(code);
}

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { opts._.push(arg); continue; }
    const key = arg.slice(2);
    // --json and --fix are flags (list --json, check --fix) or carry a value (add --json '{…}',
    // update --fix "…"), depending on whether a value follows.
    const bare = argv[i + 1] === undefined || argv[i + 1].startsWith('--');
    if (key === 'brief' || (['json', 'fix'].includes(key) && bare)) {
      opts[key] = true;
      continue;
    }
    if (argv[i + 1] === undefined) fail(`--${key} needs a value`);
    opts[key] = argv[++i];
  }
  return opts;
}

/** The entry fields a command was given, from --json, --from, or individual flags. */
function inputFields(opts) {
  let fields = {};
  if (typeof opts.json === 'string') fields = JSON.parse(opts.json);
  if (opts.from) fields = JSON.parse(fs.readFileSync(opts.from, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of INPUT_KEYS) if (typeof opts[key] === 'string') fields[key] = opts[key];
  for (const key of Object.keys(fields)) {
    if (!INPUT_KEYS.has(key)) fail(`unknown field "${key}" (allowed: ${[...INPUT_KEYS].join(', ')})`);
  }
  return fields;
}

// ---------- locating the file ----------

function locate(opts) {
  if (opts.file) return path.resolve(opts.file);
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not a git repo: use cwd */ }
  let name = 'BUGS.md';
  const config = path.join(root, '.crew', 'config.json');
  if (fs.existsSync(config)) {
    try { name = JSON.parse(fs.readFileSync(config, 'utf8')).bugsFile || name; } catch { /* keep default */ }
  }
  return path.join(root, name);
}

// ---------- parse / render ----------

function parseEntry(id, title, lines) {
  const fields = [];
  const rest = [];
  let last = null;
  for (const line of lines) {
    const m = line.match(FIELD_RE);
    if (m && rest.length === 0) { last = { label: m[1], value: m[2] }; fields.push(last); continue; }
    if (last && rest.length === 0 && /^ {2,}\S/.test(line)) { last.value += `\n${line.trim()}`; continue; }
    last = null;
    rest.push(line);
  }
  return { id, title, fields, rest: trimBlank(rest) };
}

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function parse(text, file) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf(SUMMARY_START);
  const end = lines.indexOf(SUMMARY_END);
  if (start < 0 || end < start) fail(`${file} is missing the crew summary markers. Recreate it with "init" or restore the markers.`);

  const doc = { eol, header: trimBlank(lines.slice(0, start)), lead: [], sections: [] };
  const body = lines.slice(end + 1);
  let section = null;
  let entry = null;
  const flush = () => {
    if (entry) section.entries.push(parseEntry(entry.id, entry.title, entry.lines));
    entry = null;
  };
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const marker = (body[i + 1] || '').match(CAT_RE);
    if (line.startsWith('## ') && marker) {
      flush();
      section = { key: marker[1], heading: line.slice(3).trim(), preamble: [], entries: [] };
      doc.sections.push(section);
      i++;
      continue;
    }
    const m = line.match(ENTRY_RE);
    if (m && section) { flush(); entry = { id: m[1], title: m[2].trim(), lines: [] }; continue; }
    if (entry) entry.lines.push(line);
    else if (section) section.preamble.push(line);
    else doc.lead.push(line);
  }
  flush();
  for (const s of doc.sections) s.preamble = trimBlank(s.preamble);
  doc.lead = trimBlank(doc.lead);

  // A file that lost a category section (hand edit) gets it back, empty, in canonical order.
  for (const [key, heading] of CATEGORIES) {
    if (!doc.sections.some(s => s.key === key)) doc.sections.push({ key, heading, preamble: [], entries: [] });
  }
  const order = new Map(CATEGORIES.map(([key], i) => [key, i]));
  doc.sections.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  return doc;
}

function renderEntry(e) {
  const out = [`### ${e.id} · ${e.title}`];
  for (const f of e.fields) {
    const [first, ...more] = String(f.value).split('\n');
    out.push(`- **${f.label}:** ${first}`.trimEnd());
    for (const line of more) out.push(`  ${line}`);
  }
  if (e.rest.length) out.push('', ...e.rest);
  return out;
}

function render(doc) {
  const out = [...doc.header, '', SUMMARY_START, ...renderSummary(doc), SUMMARY_END, ''];
  if (doc.lead.length) out.push(...doc.lead, '');
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, `<!-- crew:category:${s.key} -->`, '');
    if (s.preamble.length) out.push(...s.preamble, '');
    for (const e of s.entries) out.push(...renderEntry(e), '');
  }
  return `${trimBlank(out).join(doc.eol)}${doc.eol}`;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---------- entry helpers ----------

const field = (e, key) => {
  const label = (LABEL[key] || key).toLowerCase();
  const f = e.fields.find(x => x.label.toLowerCase() === label);
  return f ? f.value : '';
};

function setField(e, key, value) {
  const label = LABEL[key];
  const existing = e.fields.find(x => x.label.toLowerCase() === label.toLowerCase());
  if (existing) { existing.value = value; return; }
  const rank = k => FIELDS.findIndex(([fk]) => fk === k);
  const labelRank = l => rank(FIELDS.find(([, fl]) => fl.toLowerCase() === l.toLowerCase())?.[0]);
  const at = e.fields.findIndex(x => labelRank(x.label) > rank(key));
  e.fields.splice(at < 0 ? e.fields.length : at, 0, { label, value });
}

const statusOf = e => (field(e, 'status').toLowerCase().match(/[a-z-]+/) || ['open'])[0];
const severityOf = e => (field(e, 'severity').toLowerCase().match(/[a-z]+/) || ['medium'])[0];
const allEntries = doc => doc.sections.flatMap(s => s.entries.map(e => ({ e, section: s })));

function validate(fields) {
  if (fields.category && !CATEGORIES.some(([k]) => k === fields.category)) {
    fail(`unknown category "${fields.category}" (use one of: ${CATEGORIES.map(([k]) => k).join(', ')})`);
  }
  if (fields.status && !STATUSES.includes(fields.status)) fail(`unknown status "${fields.status}" (use: ${STATUSES.join(', ')})`);
  if (fields.severity && !SEVERITIES.includes(fields.severity)) fail(`unknown severity "${fields.severity}" (use: ${SEVERITIES.join(', ')})`);
}

function applyFields(e, fields) {
  if (fields.title) e.title = oneLine(fields.title);
  const fix = fields.fix && fields.commit ? `${fields.fix} (commit ${fields.commit})` : fields.fix;
  for (const [key] of FIELDS) {
    const value = key === 'fix' ? fix : fields[key];
    if (value !== undefined && value !== '') setField(e, key, String(value).trim());
  }
  if (!fields.fix && fields.commit) setField(e, 'links', [field(e, 'links'), `commit ${fields.commit}`].filter(Boolean).join(' · '));
}

const oneLine = s => String(s).replace(/\s+/g, ' ').trim();

function nextId(doc) {
  const max = allEntries(doc).reduce((n, { e }) => Math.max(n, Number(e.id.slice(4))), 0);
  return `BUG-${String(max + 1).padStart(4, '0')}`;
}

function findEntry(doc, id) {
  const hit = allEntries(doc).find(({ e }) => e.id.toUpperCase() === String(id).toUpperCase());
  if (!hit) fail(`no entry ${id}`);
  return hit;
}

// ---------- summary ----------

const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const bySeverity = (a, b) => (SEVERITY_RANK[severityOf(a.e)] ?? 9) - (SEVERITY_RANK[severityOf(b.e)] ?? 9) || a.e.id.localeCompare(b.e.id);

function summaryLine({ e, section }) {
  const status = statusOf(e);
  const tag = status === 'open' ? '' : ` _(${status})_`;
  return `- **${e.id}** · ${severityOf(e)} · ${e.title} — ${section.heading}${tag}`;
}

function renderSummary(doc) {
  const all = allEntries(doc);
  const open = all.filter(x => OPEN_STATUSES.has(statusOf(x.e)));
  const security = open.filter(x => x.section.key === 'security').sort(bySeverity);
  const others = open.filter(x => x.section.key !== 'security').sort(bySeverity);
  const fixed = all.filter(x => statusOf(x.e) === 'fixed').length;
  const capped = list => list.length > SUMMARY_CAP
    ? [...list.slice(0, SUMMARY_CAP).map(summaryLine), `- … and ${list.length - SUMMARY_CAP} more (\`bugs.mjs list\`)`]
    : list.map(summaryLine);
  return [
    '## Summary',
    '',
    `**${open.length} open** (${security.length} security) · ${fixed} fixed · ${all.length} total · updated ${today()}`,
    '',
    '### Open security issues (need a human)',
    '',
    ...(security.length ? capped(security) : ['_None._']),
    '',
    '### Other open problems',
    '',
    ...(others.length ? capped(others) : ['_None._']),
    '',
  ];
}

// ---------- commands ----------

function newDocument(project) {
  const header = [
    `# BUGS — ${project}`,
    '',
    'The single problem journal for this project, kept by every Claude / crew session. Each entry',
    'records a problem we hit, its root cause, how it was solved, and what is still open. Open',
    'security issues that need a human decision are listed first in the summary.',
    '',
    '- Add or update entries with the `crew:bugs` skill, or `node <crew>/scripts/bugs.mjs`.',
    '- Never paste secrets, tokens, credentials, or customer data here. Say where they live instead.',
    '- Entry ids are permanent. Update an existing entry rather than opening a duplicate.',
  ];
  return parse([...header, '', SUMMARY_START, SUMMARY_END, ''].join('\n'), '(new)');
}

function cmdInit(file, opts) {
  if (fs.existsSync(file)) { console.log(`exists: ${file}`); return; }
  const project = opts.project || path.basename(path.dirname(file));
  writeAtomic(file, render(newDocument(project)));
  console.log(`created: ${file}`);
}

function load(file) {
  if (!fs.existsSync(file)) fail(`${file} does not exist. Run "bugs.mjs init" first.`);
  return parse(fs.readFileSync(file, 'utf8'), file);
}

function cmdAdd(file, opts) {
  const fields = inputFields(opts);
  validate(fields);
  if (!fields.title) fail('add needs a title');
  if (!fields.problem) fail('add needs a problem (what went wrong, observable symptoms)');
  const doc = load(file);
  const category = fields.category || 'other';
  const e = { id: nextId(doc), title: '', fields: [], rest: [] };
  applyFields(e, {
    status: 'open',
    severity: category === 'security' ? 'high' : 'medium',
    ...fields,
    found: `${today()}${fields.by ? ` · ${fields.by}` : ''}`,
  });
  doc.sections.find(s => s.key === category).entries.push(e);
  writeAtomic(file, render(doc));
  console.log(e.id);
}

function cmdUpdate(file, opts) {
  const id = opts._[1];
  if (!id) fail('update needs an entry id, e.g. update BUG-0007 --status fixed --fix "…"');
  const fields = inputFields(opts);
  validate(fields);
  const doc = load(file);
  const { e, section } = findEntry(doc, id);
  applyFields(e, { ...fields, updated: `${today()}${fields.by ? ` · ${fields.by}` : ''}` });
  if (fields.category && fields.category !== section.key) {
    section.entries.splice(section.entries.indexOf(e), 1);
    doc.sections.find(s => s.key === fields.category).entries.push(e);
  }
  writeAtomic(file, render(doc));
  console.log(`${e.id} · ${statusOf(e)} · ${e.title}`);
}

function cmdList(file, opts) {
  const doc = load(file);
  const want = opts.status || 'open';
  const rows = allEntries(doc)
    .filter(({ e }) => want === 'all' || (want === 'open' ? OPEN_STATUSES.has(statusOf(e)) : want === 'closed' ? !OPEN_STATUSES.has(statusOf(e)) : statusOf(e) === want))
    .filter(({ section }) => !opts.category || section.key === opts.category)
    .filter(({ e }) => !opts.severity || severityOf(e) === opts.severity)
    .sort(bySeverity);
  if (opts.json) {
    console.log(JSON.stringify(rows.map(({ e, section }) => ({
      id: e.id, title: e.title, category: section.key, status: statusOf(e), severity: severityOf(e),
      ...Object.fromEntries(FIELDS.map(([k]) => [k, field(e, k)]).filter(([, v]) => v)),
    })), null, 2));
    return;
  }
  if (!rows.length) { console.log('(none)'); return; }
  for (const { e, section } of rows) console.log(`${e.id}  ${statusOf(e).padEnd(11)} ${severityOf(e).padEnd(8)} [${section.key}] ${e.title}`);
}

function cmdShow(file, opts) {
  const { e } = findEntry(load(file), opts._[1]);
  console.log(renderEntry(e).join('\n'));
}

function cmdFind(file, opts) {
  const needle = opts._.slice(1).join(' ').toLowerCase();
  if (!needle) fail('find needs some text');
  const hits = allEntries(load(file)).filter(({ e }) =>
    [e.title, ...e.fields.map(f => f.value), ...e.rest].join('\n').toLowerCase().includes(needle));
  if (!hits.length) { console.log('(no match)'); return; }
  for (const { e, section } of hits) console.log(`${e.id}  ${statusOf(e).padEnd(11)} [${section.key}] ${e.title}`);
}

function cmdSummary(file, opts) {
  if (!fs.existsSync(file)) { if (!opts.brief) console.log(`no journal at ${file}`); return; }
  const doc = load(file);
  if (!opts.brief) { console.log(renderSummary(doc).join('\n')); return; }
  const open = allEntries(doc).filter(x => OPEN_STATUSES.has(statusOf(x.e)));
  const security = open.filter(x => x.section.key === 'security').sort(bySeverity);
  const lines = [`Problem journal ${path.basename(file)}: ${open.length} open (${security.length} security).`];
  for (const x of security.slice(0, 8)) lines.push(`  ${x.e.id} [${severityOf(x.e)}] ${x.e.title}`);
  if (security.length > 8) lines.push(`  … ${security.length - 8} more security entries`);
  console.log(lines.join('\n'));
}

function cmdCheck(file, opts) {
  const doc = load(file);
  const problems = [];
  const seen = new Map();
  for (const { e, section } of allEntries(doc)) {
    if (seen.has(e.id)) problems.push({ kind: 'duplicate-id', e, section });
    else seen.set(e.id, e);
    if (!STATUSES.includes(statusOf(e))) problems.push({ kind: `bad-status "${field(e, 'status')}"`, e });
    if (!SEVERITIES.includes(severityOf(e))) problems.push({ kind: `bad-severity "${field(e, 'severity')}"`, e });
  }
  for (const s of doc.sections) {
    if (!CATEGORIES.some(([k]) => k === s.key)) problems.push({ kind: `unknown-category "${s.key}"`, e: { id: '-' } });
  }
  if (opts.fix) {
    for (const p of problems.filter(x => x.kind === 'duplicate-id')) {
      const old = p.e.id;
      p.e.id = nextId(doc);
      console.log(`renumbered duplicate ${old} → ${p.e.id} (${p.e.title})`);
    }
    writeAtomic(file, render(doc)); // also regenerates the summary
    const left = problems.filter(x => x.kind !== 'duplicate-id');
    for (const p of left) console.log(`needs a hand edit: ${p.e.id} ${p.kind}`);
    console.log(left.length ? 'fixed what could be fixed automatically' : 'ok');
    process.exit(left.length ? 1 : 0);
  }
  for (const p of problems) console.log(`${p.e.id} ${p.kind}`);
  console.log(problems.length ? `${problems.length} problem(s). Run "check --fix".` : 'ok');
  process.exit(problems.length ? 1 : 0);
}

const COMMANDS = { init: cmdInit, add: cmdAdd, update: cmdUpdate, list: cmdList, show: cmdShow, find: cmdFind, summary: cmdSummary, check: cmdCheck };

const opts = parseArgs(process.argv.slice(2));
const command = COMMANDS[opts._[0]];
if (!command) {
  const doc = fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  process.stdout.write(`${doc.replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '')}\n`);
  process.exit(opts._[0] ? 2 : 0);
}
command(locate(opts), opts);
