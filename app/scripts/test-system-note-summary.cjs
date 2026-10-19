/**
 * B15-17 (INV-126) -- system note summaries in Contact Workspace and
 * Conversations (Walkthrough 2).
 *
 * Offline. Compiles the pure summarizer (src/lib/system-note-summary.ts) and
 * runs table-driven cases, then checks every ledger header the repository
 * actually writes (read from source, not copied here), then checks the page
 * wiring by source text, following this repository's convention for UI
 * wiring (no browser rendering harness; see test-message-links.cjs).
 * Proves: every IAOS ledger header summarizes; people's notes, call-log
 * notes and near-misses do not; the full original body stays reachable;
 * nothing renders as markup; no write is added.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-system-note-summary-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/system-note-summary.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const { summarizeSystemNote, ledgerTitleToOperatorWords, STATUS_LABELS } = require(path.join(TMP, 'src/lib/system-note-summary.js'));
fs.rmSync(TMP, { recursive: true, force: true });

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${name}${detail === undefined ? '' : ` -- ${detail}`}`); }
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

// ── 1. Table cases ───────────────────────────────────────────────────────────
const arvNote = [
  'IAOS ARV APPROVAL LEDGER — iaos-arv-approval-v1',
  'Approval timestamp: 2026-10-01T15:00:00.000Z',
  'Opportunity: abc123',
  'Decision: APPROVED',
].join('\n');
const s1 = summarizeSystemNote(arvNote);
check('ARV ledger summarizes', s1 && s1.title === 'ARV approval' && s1.version === 'iaos-arv-approval-v1', JSON.stringify(s1));
const s2 = summarizeSystemNote(arvNote.replace(/\n/g, '\r\n'));
check('CRLF ledger summarizes', s2 && s2.title === 'ARV approval', JSON.stringify(s2));
const s3 = summarizeSystemNote('IAOS SELLER CALL OUTCOME LEDGER — iaos-seller-call-outcome-v1\nOutcome: pass');
check('call outcome title', s3 && s3.title === 'Seller call outcome', JSON.stringify(s3));
const s4 = summarizeSystemNote('IAOS ATTORNEY/MANUAL FIELD DISPOSITION — iaos-attorney-manual-field-disposition-v1');
check('slash title', s4 && s4.title === 'Attorney/manual field disposition', JSON.stringify(s4));
check('header-only LEDGER word kept', ledgerTitleToOperatorWords('LEDGER') === 'Ledger');
check('acronym kept', ledgerTitleToOperatorWords('IAOS ARV APPROVAL LEDGER') === 'IAOS ARV approval');

const js = summarizeSystemNote('  {"kind":"x","value":1}\n');
check('JSON object summarizes', js && js.title === 'Technical record' && js.version === null, JSON.stringify(js));
const ja = summarizeSystemNote('[1,2]');
check('JSON array summarizes', ja && ja.title === 'Technical record', JSON.stringify(ja));

const plain = [
  ['person note', 'Seller wants to close after school ends. Call back Tuesday.'],
  ['call-log note', 'Call (reported by Brad in IAOS): No answer'],
  ['ordinary IAOS mention', 'IAOS rocks — iaos-test'],
  ['lower-case header', 'IAOS arv approval ledger — iaos-arv-approval-v1'],
  ['header not on first line', 'note\nIAOS ARV APPROVAL LEDGER — iaos-arv-approval-v1'],
  ['hyphen instead of em dash', 'IAOS ARV APPROVAL LEDGER - iaos-arv-approval-v1'],
  ['non-iaos version', 'IAOS ARV APPROVAL LEDGER — v1'],
  ['trailing text after version', 'IAOS ARV APPROVAL LEDGER — iaos-arv-approval-v1 extra'],
  ['braces but not JSON', '{call back after 5}'],
  ['JSON string', '"hello"'],
  ['JSON number', '42'],
  ['JSON null', 'null'],
  ['empty', ''],
];
for (const [name, body] of plain) check(`plain: ${name}`, summarizeSystemNote(body) === null, JSON.stringify(summarizeSystemNote(body)));
check('non-string', summarizeSystemNote(undefined) === null && summarizeSystemNote(null) === null);

// ── 1b. Status distinctions (Brad, 2026-10-19) ───────────────────────────────
// Each stored status stays distinct, quoted from the record's own line.
const SEND = 'IAOS CONTRACT SEND — iaos-contract-send-v3\nRecorded at: 2026-10-01T00:00:00Z\nOperator: x\nOpportunity: o1\nAttempt: a1\nStatus: ';
const sendCases = [
  ['in_progress', 'in progress'],
  ['provider_accepted_pending_readback', 'provider accepted pending readback'],
  ['accepted', 'accepted'],
  ['failed', 'failed'],
  ['ambiguous', 'ambiguous'],
];
const seen = new Set();
for (const [stored, shown] of sendCases) {
  const s = summarizeSystemNote(SEND + stored + '\nFailure reason: UNAVAILABLE');
  check(`send status ${stored}`, s && s.status && s.status.label === 'Status' && s.status.value === shown, JSON.stringify(s));
  if (s && s.status) seen.add(s.status.value);
}
check('five send statuses stay distinct', seen.size === 5, [...seen].join('|'));
for (const v of ['confirmed', 'withdrawn']) {
  const s = summarizeSystemNote(`IAOS PROPERTY IDENTITY CONFIRMATION — iaos-property-identity-confirmation-v2\nRecorded at: t\nOperator: x\nOpportunity: o\nStatus: ${v}\nAddress: 1 Main`);
  check(`identity status ${v}`, s && s.status && s.status.value === v, JSON.stringify(s));
}
for (const v of ['in_progress', 'accepted', 'failed', 'indeterminate']) {
  const s = summarizeSystemNote(`IAOS CONTRACT DRAFT REQUEST SYNC — iaos-contract-draft-request-sync-v3\nStatus: ${v}`);
  check(`draft sync status ${v}`, s && s.status && s.status.value === v.replace(/_/g, ' '), JSON.stringify(s));
}
const outcome = summarizeSystemNote('IAOS SELLER CALL OUTCOME LEDGER — iaos-seller-call-outcome-v1\nOutcome timestamp: t\nOutcome: follow_up');
check('Outcome timestamp is not mistaken for Outcome', outcome && outcome.status && outcome.status.label === 'Outcome' && outcome.status.value === 'follow up', JSON.stringify(outcome));
const arvDecision = summarizeSystemNote(arvNote + '\nEvidence state: LOW');
check('Decision chosen before Evidence state', arvDecision && arvDecision.status.label === 'Decision' && arvDecision.status.value === 'APPROVED', JSON.stringify(arvDecision));
const lifecycle = summarizeSystemNote('IAOS CONTRACT LIFECYCLE — iaos-contract-lifecycle-v1\nEvent kind: partially_signed\nRaw provider status: x');
check('lifecycle event kind', lifecycle && lifecycle.status.label === 'Event kind' && lifecycle.status.value === 'partially signed', JSON.stringify(lifecycle));
// Malformed / unknown: still summarized as a record, with NO status claimed.
const facts = summarizeSystemNote('IAOS TITLE AND SURVEY FACTS — iaos-title-survey-facts-v1\nRecorded at: t');
check('record without a status line claims none', facts && facts.status === null, JSON.stringify(facts));
const malformed = summarizeSystemNote('IAOS CONTRACT SEND — iaos-contract-send-v9\n%%garbage%%\nStatus:\nStatus:   ');
check('malformed record: empty status claims none', malformed && malformed.title === 'Contract send' && malformed.status === null, JSON.stringify(malformed));
check('header-only record claims none', summarizeSystemNote('IAOS CONTRACT SEND — iaos-contract-send-v3').status === null);
const indented = summarizeSystemNote('IAOS CONTRACT SEND — iaos-contract-send-v3\n  Status: accepted');
check('indented line is not a status line', indented.status === null, JSON.stringify(indented));
const long = summarizeSystemNote('IAOS CONTRACT SEND — iaos-contract-send-v3\nStatus: ' + 'x'.repeat(200));
check('long status cut for summary', long.status.value.length === 80 && long.status.value.endsWith('…'));
check('JSON record claims no status', summarizeSystemNote('{"status":"accepted"}').status === null);

// ── 2. Every ledger header the repository writes ─────────────────────────────
// Each `const X_HEADER = \`IAOS ... — ${VERSION}\`` in src/lib and the Netlify
// functions, with VERSION resolved from the same file. A new writer whose
// header this summarizer cannot read fails here.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(APP, 'src')), ...walk(path.join(APP, 'netlify'))];
// Version constants are sometimes imported (arv-approval-note.ts imports
// arv-persist.ts's), so resolve each name across every file.
const versions = new Map();
for (const file of files) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\b([A-Z0-9_]+)\s*=\s*"(iaos-[a-z0-9-]+)"/g)) versions.set(m[1], m[2]);
}
let headers = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/`(IAOS [^`$]*?) — \$\{([A-Z0-9_]+)\}`/g)) {
    const version = versions.get(m[2]);
    check(`version resolves for ${m[2]} in ${path.relative(APP, file)}`, !!version);
    if (!version) continue;
    const header = `${m[1]} — ${version}`;
    const s = summarizeSystemNote(`${header}\nField: value`);
    headers++;
    check(`real header summarizes: ${header}`, s && s.version === version && s.title.length > 0 && !/LEDGER$/.test(s.title), JSON.stringify(s));
  }
  for (const m of src.matchAll(/"(IAOS [A-Z][^"]*? — iaos-[a-z0-9-]+)"/g)) {
    headers++;
    check(`literal header summarizes: ${m[1]}`, summarizeSystemNote(m[1]) !== null);
  }
}
check('found the repository ledger headers', headers >= 30, `found ${headers}`);

// Every status label the summarizer reads is one a real writer emits.
const allSource = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
for (const label of STATUS_LABELS) {
  check(`status label is written somewhere: ${label}`, allSource.includes(`"${label}"`) || allSource.includes(`\`${label}: \${`));
}

// ── 3. Wiring ────────────────────────────────────────────────────────────────
const comp = read('src/components/NoteBody.tsx');
check('component uses the summarizer', comp.includes('summarizeSystemNote(body)'));
check('plain notes render as written', comp.includes('if (!summary) return <>{body}</>;'));
check('full record stays reachable', /<details[\s\S]*Show full record[\s\S]*\{body\}/.test(comp));
check('no markup injection', !comp.includes('dangerouslySetInnerHTML'));
check('expanded record is the complete original body, unmodified', /Show full record<\/summary>\s*<div[^>]*>\{body\}<\/div>/.test(comp));
check('status shown as label and quoted value', comp.includes('{summary.status.label}: {summary.status.value}'));
check('missing status is said, not implied', comp.includes('No status line — see full record'));
check('no authorship claim', !/Saved by|Written by|Created by/.test(comp));
check('component performs no I/O', !/fetch\(|ghl\.|appWriteFetch/.test(comp));

const conv = read('src/pages/Conversations.tsx');
check('Conversations imports NoteBody', conv.includes('import { NoteBody } from "../components/NoteBody";'));
check('Conversations notes use NoteBody', conv.includes('<NoteBody body={n.body} />'));
check('Conversations keeps empty-note label', conv.includes('(empty note)'));

const cw = read('src/pages/ContactWorkspace.tsx');
check('Contact imports NoteBody', cw.includes('import { NoteBody } from "../components/NoteBody";'));
check('Contact notes use NoteBody', cw.includes('whiteSpace: "pre-wrap" }}><NoteBody body={n.body} /></div>'));
check('Contact no longer renders raw note body', !cw.includes('whiteSpace: "pre-wrap" }}>{n.body}</div>'));

console.log(`${checks - failures}/${checks} checks passed (${headers} repository headers).`);
process.exit(failures ? 1 : 0);
