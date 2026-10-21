/**
 * B15 bundle display follow-ups (Spock, Addendum 2, 2026-10-21) -- two
 * confirmed display defects on Test, fixed as display only.
 *
 *   1. B15-17: a Disposition stored as JSON was quoted raw in a note's
 *      collapsed summary ({"kind":"not applicable"}). The three reported
 *      shapes now read "Not applicable", "Not yet made" and "Made on <date>";
 *      the full record behind "Show full record" is unchanged.
 *   2. Contact Notes header: "Not yet contacted" showed while the contact was
 *      still loading. It now shows only once the record has resolved without
 *      an attempt; before that the label is a neutral "Loading…". A known
 *      attempt still shows "Last attempted …" exactly as before.
 *
 * Offline. Compiles the pure summarizer, the pure header label and the REAL
 * ledger writers (seller-contract-facts-carriers.ts), so the note bodies are
 * the ones the app writes. Page wiring is checked by source text, this
 * repository's convention for UI wiring (see test-system-note-summary.cjs).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-display-followups-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/system-note-summary.ts'),
    path.join(APP, 'src/lib/notes-attempt-label.ts'),
    path.join(APP, 'src/lib/seller-contract-facts-carriers.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}
const { summarizeSystemNote } = require(path.join(TMP, 'src/lib/system-note-summary.js'));
const { notesAttemptLabel } = require(path.join(TMP, 'src/lib/notes-attempt-label.js'));
const carriers = require(path.join(TMP, 'src/lib/seller-contract-facts-carriers.js'));
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal count of check() calls below; never back-filled from a run. */
const FLOOR = 36;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${name}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`); }
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

// ── 1. B15-17 Disposition summaries, from the real writers ──────────────────
// The four notes Spock reported on IAOS Test Probe (Addendum 2), same shapes and times.
const OPP = 'opp-synthetic-b15';
const attorney = (at) => carriers.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at, operator: 'Brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } });
const equitable = (at, disposition) => carriers.formatSellerEquitableInterestDisclosureNote({ opportunityId: OPP, at, operator: 'Brad', disposition });
const reported = [
  { body: attorney('2026-09-19T16:20:31.074Z'), title: 'Attorney/manual field disposition', value: 'Not applicable' },
  { body: attorney('2026-09-19T16:20:25.602Z'), title: 'Attorney/manual field disposition', value: 'Not applicable' },
  { body: equitable('2026-09-19T16:19:54.318Z', { kind: 'made', at: '2026-09-19T16:19:54.318Z' }), title: 'Seller equitable interest disclosure', value: 'Made on Sep 19, 2026, 11:19 AM' },
  { body: equitable('2026-09-19T16:19:23.749Z', { kind: 'not_yet_made' }), title: 'Seller equitable interest disclosure', value: 'Not yet made' },
];
reported.forEach((r, i) => {
  const s = summarizeSystemNote(r.body);
  check(`reported note ${i + 1}: "${r.title} · Disposition: ${r.value}"`, s && s.title === r.title && s.status && s.status.label === 'Disposition' && s.status.value === r.value, s);
  check(`reported note ${i + 1}: no JSON left in the summary`, s && s.status && !/[{}"]|kind/.test(s.status.value), s && s.status);
});
// The "made" date uses the note cards' own wording and zone: Spock's card for this note reads "Sep 19, 2026, 11:19 AM".
const cw = read('src/pages/ContactWorkspace.tsx');
check('the made date uses the same toLocaleString options as the note cards (formatNoteDate)',
  /function formatNoteDate\(iso: string\): string \{\s*return new Date\(iso\)\.toLocaleString\("en-US", \{\s*timeZone: "America\/Chicago", month: "short", day: "numeric", year: "numeric",\s*hour: "numeric", minute: "2-digit",\s*\}\);/.test(cw)
  && /timeZone: "America\/Chicago", month: "short", day: "numeric", year: "numeric",\s*hour: "numeric", minute: "2-digit",/.test(read('src/lib/system-note-summary.ts')));
const winter = summarizeSystemNote(equitable('2026-01-15T18:00:00.000Z', { kind: 'made', at: '2026-01-15T18:00:00.000Z' }));
check('made date in standard time (CST) formats correctly', winter && winter.status.value === 'Made on Jan 15, 2026, 12:00 PM', winter && winter.status);
const badDate = summarizeSystemNote(equitable('2026-09-19T16:19:54.318Z', { kind: 'made', at: 'not-a-date' }));
check('made with an unparsable date reads "Made" (date only where available)', badDate && badDate.status.value === 'Made', badDate && badDate.status);

// Full record preserved: the stored body is untouched and the real parsers still read it.
const madeBody = reported[2].body;
check('the stored body still carries the raw Disposition JSON (summary is display only)', madeBody.includes('Disposition: {"kind":"made","at":"2026-09-19T16:19:54.318Z"}'));
const parsed = carriers.parseSellerEquitableInterestDisclosureNote(madeBody);
check('the real equitable-interest parser still reads the body exactly', parsed && parsed.disposition.kind === 'made' && parsed.disposition.at === '2026-09-19T16:19:54.318Z', parsed);
const parsedA = carriers.parseAttorneyManualFieldDispositionNote(reported[0].body);
check('the real attorney/manual-field parser still reads the body exactly', parsedA && parsedA.disposition.kind === 'not_applicable' && parsedA.slot === 'special_provisions', parsedA);
const nb = read('src/components/NoteBody.tsx');
check('NoteBody still renders the complete original body behind "Show full record"',
  nb.includes('<summary style={{ cursor: "pointer" }}>Show full record</summary>') && nb.includes('color: "#94A3B8" }}>{body}</div>'));
check('NoteBody still shows "label: value" from the summarizer', nb.includes('{summary.status.label}: {summary.status.value}'));

// Scope: only the three reported shapes change; everything else is quoted as before.
const willDraft = summarizeSystemNote(carriers.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: '2026-09-19T16:20:31.074Z', operator: 'Brad', slot: 'special_provisions', disposition: { kind: 'attorney_will_draft' } }));
check('unreported kind attorney_will_draft is quoted as before (out of scope)', willDraft && willDraft.status.value === '{"kind":"attorney will draft"}', willDraft && willDraft.status);
const verbatim = summarizeSystemNote(carriers.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: '2026-09-19T16:20:31.074Z', operator: 'Brad', slot: 'other_addenda_text', disposition: { kind: 'provided_verbatim', text: 'Seller keeps the shed' } }));
check('unreported kind provided_verbatim is quoted as before (out of scope)', verbatim && verbatim.status.value.startsWith('{"kind":"provided verbatim"'), verbatim && verbatim.status);
const H = 'IAOS SELLER EQUITABLE INTEREST DISCLOSURE — iaos-seller-equitable-interest-disclosure-v1';
const extra = summarizeSystemNote(`${H}\nDisposition: {"kind":"not_applicable","x":1}`);
check('a reported kind with an extra key is not reworded (exact shapes only)', extra && extra.status.value === '{"kind":"not applicable","x":1}', extra && extra.status);
const madeNoAt = summarizeSystemNote(`${H}\nDisposition: {"kind":"made"}`);
check('"made" without "at" is not reworded (writer always records at)', madeNoAt && madeNoAt.status.value === '{"kind":"made"}', madeNoAt && madeNoAt.status);
const statusJson = summarizeSystemNote(`IAOS CONTRACT SEND LEDGER — iaos-contract-send-v1\nStatus: {"kind":"not_applicable"}`);
check('the same JSON under another label (Status) is quoted as before', statusJson && statusJson.status.label === 'Status' && statusJson.status.value === '{"kind":"not applicable"}', statusJson && statusJson.status);
const plain = summarizeSystemNote(`${H}\nDisposition: withdrawn_by_operator`);
check('a non-JSON Disposition keeps the underscore-to-space rule', plain && plain.status.value === 'withdrawn by operator', plain && plain.status);
const broken = summarizeSystemNote(`${H}\nDisposition: {"kind":"not_applicable"`);
check('malformed JSON is quoted as before, never thrown', broken && broken.status.value === '{"kind":"not applicable"', broken && broken.status);

// ── 2. Contact Notes header label ──────────────────────────────────────────
const rel = (iso) => (iso === '2026-10-02T15:00:00.000Z' ? '19d ago' : `rel(${iso})`);
let l = notesAttemptLabel(null, false, rel);
check('loading (record not resolved, no attempt): neutral "Loading…"', l.text === 'Loading…' && l.attempted === false, l);
l = notesAttemptLabel(null, true, rel);
check('resolved with no attempt: "Not yet contacted"', l.text === 'Not yet contacted' && l.attempted === false, l);
l = notesAttemptLabel('2026-10-02T15:00:00.000Z', true, rel);
check('resolved with an attempt: "Last attempted 19d ago" (unchanged wording)', l.text === 'Last attempted 19d ago' && l.attempted === true, l);
l = notesAttemptLabel('2026-10-02T15:00:00.000Z', false, rel);
check('a known attempt (in-session override) shows even before the record resolves', l.text === 'Last attempted 19d ago', l);
check('"Not yet contacted" is never shown while unresolved (null or empty attempt)',
  notesAttemptLabel(null, false, rel).text !== 'Not yet contacted' && notesAttemptLabel('', false, rel).text !== 'Not yet contacted');
check('an empty attempt string after resolution still reads "Not yet contacted" (same falsy rule as before)', notesAttemptLabel('', true, rel).text === 'Not yet contacted');

// Page wiring (source text).
check('ContactWorkspace imports the header label', cw.includes('import { notesAttemptLabel } from "../lib/notes-attempt-label";'));
check('the Notes header renders the label with resolution = contact record present',
  cw.includes('{notesAttemptLabel(lastAttempt, contact !== null, relativeTime).text}'));
check('ContactWorkspace has no other "Not yet contacted" literal', !cw.includes('"Not yet contacted"'));
check('header colour rule unchanged (amber only for a known attempt)', cw.includes('<span style={{ fontSize: "11px", color: lastAttempt ? "#F59E0B" : "#334155" }}>'));
check('lastAttempt resolver unchanged (override, then precise, then DATE)',
  /if \(attemptOverride\) return attemptOverride;\s*return contact\?\.lastCallAttemptPrecise \?\? contact\?\.lastCallAttempt \?\? null;/.test(cw));
check('the contact record is cleared on navigation, so "resolved" is per contact', /setLoading\(true\);\s*setContact\(null\);/.test(cw));

// ── 3. Display only ────────────────────────────────────────────────────────
const lab = read('src/lib/notes-attempt-label.ts');
const sum = read('src/lib/system-note-summary.ts');
check('both helpers are pure: no import, fetch or GHL client', !/^import /m.test(lab) && !/^import /m.test(sum) && !/fetch\(|ghl\./.test(lab + sum));

console.log(`${checks - failures}/${checks} checks passed.`);
if (checks < FLOOR) { console.error(`FLOOR only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
process.exit(failures ? 1 : 0);
