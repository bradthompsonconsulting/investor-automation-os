/**
 * B14-12 / INV-94 — call-outcome wording, operator note source label, the
 * Seller Call pointer and the pre-commit consequence text.
 *
 * Offline. Compiles the pure copy module and checks the two surfaces that use
 * it by source text, following this repository's existing convention for UI
 * wiring (see test-seller-call-workspace-wiring.cjs). Webhook behavior and the
 * Production write scope are deliberately untouched by this change and are
 * asserted unchanged here.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-call-outcome-copy-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/call-outcome-copy.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const copy = require(path.join(TMP, 'src/lib/call-outcome-copy.js'));
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const stripBlockComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const disposition = read('src/components/DispositionControl.tsx');
const dispositionCode = stripBlockComments(disposition);
const sellerCall = read('src/pages/SellerCallWorkspace.tsx');
const sellerCallCode = stripBlockComments(sellerCall);
const noteGuard = read('netlify/functions/lib/write-note-guard.ts');
const webhook = read('netlify/functions/ghl-disposition.ts');
const writeContracts = read('netlify/functions/lib/write-contracts.ts');
const contactPageCode = stripBlockComments(read('src/pages/ContactWorkspace.tsx'));

// ── Operator note source label ───────────────────────────────────────────
check('dial-result note names its source', copy.operatorCallNote('No Answer', null), 'Call (reported by Brad in IAOS): No Answer');
check('Follow Up note keeps the callback assertion', copy.operatorCallNote('Follow Up', 'Oct 4, 10:00 AM'),
  'Call (reported by Brad in IAOS): Follow Up — callback scheduled for Oct 4, 10:00 AM');
const guardPattern = (() => {
  const m = noteGuard.match(/if \((\/\^IAOS \(\?:[^/]+\/)\.test\(body\)\)/);
  if (!m) return null;
  return new RegExp(m[1].slice(1, -1));
})();
check('note guard ledger-prefix pattern located in write-note-guard.ts', guardPattern instanceof RegExp, true);
const sampleNotes = ['No Answer', 'Voicemail', 'Follow Up', 'Requested Appointment', 'Not Interested', 'Incorrect Number']
  .map((label) => copy.operatorCallNote(label, label === 'Follow Up' ? 'Oct 4, 10:00 AM' : null));
check('no operator note begins with IAOS + a ledger word (write-note-guard would refuse it)',
  sampleNotes.filter((body) => guardPattern && guardPattern.test(body)), []);
check('no operator note begins with "IAOS "', sampleNotes.filter((body) => body.startsWith('IAOS ')), []);
check('operator label differs from the GHL call-event note form', sampleNotes.some((body) => /^Call: /.test(body)), false);

// ── Consequence copy ─────────────────────────────────────────────────────
const tranche = (disposition.match(/export const TRANCHE_A_DISPOSITIONS = \[([\s\S]*?)\] as const;/) || [])[1] || '';
const trancheLabels = [...tranche.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check('every Tranche A disposition has consequence copy, and nothing else does',
  Object.keys(copy.DIAL_RESULT_CONSEQUENCES).sort(), [...trancheLabels].sort());
check('Do Not Call is not an IAOS outcome', Object.keys(copy.DIAL_RESULT_CONSEQUENCES).includes('Do Not Call'), false);
check('second click required exactly for the outcomes that can lead to seller messages',
  Object.entries(copy.DIAL_RESULT_CONSEQUENCES).filter(([, v]) => v.confirm).map(([k]) => k).sort(), ['Follow Up', 'Requested Appointment']);
const ra = copy.DIAL_RESULT_CONSEQUENCES['Requested Appointment'].text;
check('Requested Appointment: booking-link text about 15 minutes later, no reply needed, may repeat',
  /booking link/.test(ra) && /15 minutes/.test(ra) && /even without a reply/.test(ra) && /again may text/.test(ra), true);
const fu = copy.DIAL_RESULT_CONSEQUENCES['Follow Up'].text;
check('Follow Up: names Seller Follow-Up, the day-37 move and seller email/text',
  /Seller Follow-Up/.test(fu) && /day 37/.test(fu) && /Long-Term Nurture/.test(fu) && /email and text/.test(fu), true);
check('Move to Long-Term Nurture: stated as possible and not yet verified',
  /may start/.test(copy.MOVE_TO_LTN_CONSEQUENCE) && /not yet verified/.test(copy.MOVE_TO_LTN_CONSEQUENCE), true);
check('no copy claims a seller reply is required',
  [ra, fu, copy.MOVE_TO_LTN_CONSEQUENCE, ...Object.values(copy.DIAL_RESULT_CONSEQUENCES).map((v) => v.text)]
    .some((t) => /(reply|replies) (is |are )?(needed|required)|after the seller replies|once the seller replies/i.test(t)), false);
check('outcomes with no observed seller messages say so',
  ['No Answer', 'Voicemail', 'Incorrect Number'].every((k) => /No seller messages/.test(copy.DIAL_RESULT_CONSEQUENCES[k].text)), true);
const ni = copy.DIAL_RESULT_CONSEQUENCES['Not Interested'].text;
check('Not Interested: stops only the Seller 6 path; already-scheduled messages (e.g. Seller 2 booking text) may still send',
  /Stops the Seller 6 follow-up path for this deal/.test(ni) && /already scheduled by another workflow/.test(ni)
  && /Seller 2's booking-link text/.test(ni) && /may still send/.test(ni), true);
check('Not Interested does not promise that no seller messages follow', /No seller messages/.test(ni), false);
check('Seller Call Follow-Up is contrasted with the contact-page Follow Up',
  /No stage change and no seller messages/.test(copy.SELLER_CALL_FOLLOW_UP_CONSEQUENCE) && /contact page/.test(copy.SELLER_CALL_FOLLOW_UP_CONSEQUENCE), true);

// ── Contact-page dial-result control wiring ──────────────────────────────
check('dial-result note is built by operatorCallNote', /operatorCallNote\(label as DialResult, callbackIso \? formatCallbackTime\(callbackIso\) : null\)/.test(dispositionCode), true);
check('the old unlabeled `Call: ${label}` note copy is gone', /`Call: \$\{label\}/.test(dispositionCode), false);
check('heading and subheading come from the copy module',
  /\{DIAL_RESULT_HEADING\}/.test(dispositionCode) && /\{DIAL_RESULT_SUBHEADING\} \{GHL_CALL_LOGGING_LINE\}/.test(dispositionCode), true);
check('every outcome shows its consequence before any click',
  /data-testid="disposition-consequences"/.test(dispositionCode) && /TRANCHE_A_DISPOSITIONS\.map\(\(label\) => \(\s*<li[\s\S]*DIAL_RESULT_CONSEQUENCES\[label\]\.text/.test(dispositionCode), true);
{
  // The consequence-line test IDs must normalize spaces exactly like the
  // existing disposition-option IDs (PR #113 review: a lost backslash made
  // the pattern /s+/, which strips the letter "s" instead).
  const m = dispositionCode.match(/data-testid=\{`disposition-consequence-\$\{label\.replace\((\/[^/]+\/g), "-"\)\.toLowerCase\(\)\}`\}/);
  const optionPattern = (dispositionCode.match(/data-testid=\{`disposition-option-\$\{label\.replace\((\/[^/]+\/g), "-"\)\.toLowerCase\(\)\}`\}/) || [])[1];
  check('consequence test IDs use the same space pattern as the option IDs', m ? m[1] : null, optionPattern ?? 'missing');
  const re = m ? new RegExp(m[1].slice(1, -2), 'g') : null;
  check('consequence test IDs resolve to the expected slugs',
    re ? trancheLabels.map((l) => `disposition-consequence-${l.replace(re, '-').toLowerCase()}`) : [],
    ['disposition-consequence-no-answer', 'disposition-consequence-voicemail', 'disposition-consequence-follow-up',
      'disposition-consequence-requested-appointment', 'disposition-consequence-not-interested', 'disposition-consequence-incorrect-number']);
}
check('confirm-required outcomes open the confirm step instead of writing',
  /onClick=\{\(\) => \(DIAL_RESULT_CONSEQUENCES\[label\]\.confirm \? setConfirming\(label\) : void run\(label\)\)\}/.test(dispositionCode), true);
check('confirm step shows the consequence and records only on the confirm button',
  /data-testid="disposition-confirm-text">\{DIAL_RESULT_CONSEQUENCES\[confirming\]\.text\}/.test(dispositionCode)
  && /data-testid="disposition-confirm-record" onClick=\{\(\) => void run\(confirming\)\}/.test(dispositionCode)
  && /data-testid="disposition-confirm-cancel" onClick=\{\(\) => setConfirming\(null\)\}/.test(dispositionCode), true);
check('Move to Long-Term Nurture opens its confirm step; only the confirm button moves',
  /data-testid="routing-move-ltn"\s*onClick=\{\(\) => setConfirmLtn\(true\)\}/.test(dispositionCode)
  && /data-testid="routing-move-ltn-confirm" onClick=\{\(\) => void moveToLtn\(\)\}/.test(dispositionCode)
  && /\{MOVE_TO_LTN_CONSEQUENCE\}/.test(dispositionCode), true);
check('moveToLtn is called only by the confirm button and the failure Retry',
  (dispositionCode.match(/void moveToLtn\(\)/g) || []).length, 2);
check('write sequence unchanged: one bell, still last after note and attempt',
  (dispositionCode.match(/setDispositionAt\(/g) || []).length === 1
  && dispositionCode.indexOf('ghl.notes.create(contactId, noteBody)') < dispositionCode.indexOf('setLastCallAttempt(contactId, attemptIso)')
  && dispositionCode.indexOf('setLastCallAttempt(contactId, attemptIso)') < dispositionCode.indexOf('setDispositionAt('), true);

// ── Seller Call conversation-outcome panel ───────────────────────────────
check('Seller Call heading and subheading come from the copy module',
  /\{CONVERSATION_OUTCOME_HEADING\}/.test(sellerCallCode) && /\{CONVERSATION_OUTCOME_SUBHEADING\} \{GHL_CALL_LOGGING_LINE\}/.test(sellerCallCode), true);
check('Seller Call points no-conversation results to this contact\'s page',
  /<Link data-testid="call-outcome-dial-result-pointer" to=\{`\/contacts\/\$\{contactId\}`\}/.test(sellerCallCode) && /\{DIAL_RESULT_POINTER\}/.test(sellerCallCode), true);
check('Seller Call Follow-Up and Pass show their consequence before the confirm button',
  sellerCallCode.indexOf('data-testid="call-outcome-follow-up-consequence"') !== -1
  && sellerCallCode.indexOf('data-testid="call-outcome-follow-up-consequence"') < sellerCallCode.indexOf('data-testid="call-outcome-follow-up-confirm"')
  && sellerCallCode.indexOf('data-testid="call-outcome-pass-consequence"') !== -1
  && sellerCallCode.indexOf('data-testid="call-outcome-pass-consequence"') < sellerCallCode.indexOf('data-testid="call-outcome-pass-confirm"'), true);
check('Seller Call never writes the Board #4 dial-result fields',
  /setCallDisposition|setCallRouting|setDispositionAt/.test(sellerCallCode), false);
check('the old "Record Call Outcome" heading is gone', /Record Call Outcome/.test(sellerCallCode), false);

// ── Seller Call Pass: an existing callback stays (Jess ruling 2026-10-02, option B) ──
check('Pass with no callback: wording unchanged', copy.sellerCallPassConsequence(null), 'Records the pass. No seller messages.');
check('Pass with a callback: names it, says Pass does not clear it, and where to clear it',
  copy.sellerCallPassConsequence({ text: 'Oct 6, 10:00 AM' }),
  "Records the pass. No seller messages. Your callback for Oct 6, 10:00 AM stays scheduled: Pass does not clear it. If you won't call back, clear it separately on the contact page.");
check('Pass with an unreadable callback time: still warns',
  copy.sellerCallPassConsequence({ text: null }),
  "Records the pass. No seller messages. Your scheduled callback stays scheduled: Pass does not clear it. If you won't call back, clear it separately on the contact page.");
{
  const ids = { precise: 'P', date: 'D' };
  check('callback: none present', copy.resolveScheduledCallback(null, [], ids), null);
  check('callback: empty values are none', copy.resolveScheduledCallback(null, [{ id: 'P', value: '' }, { id: 'D', value: null }], ids), null);
  check('callback: precise TEXT field read first', copy.resolveScheduledCallback(null,
    [{ id: 'D', value: 1790000000000 }, { id: 'P', value: '2026-10-06T15:00:00.000Z' }], ids), { iso: '2026-10-06T15:00:00.000Z' });
  check('callback: DATE field (unix ms) when no precise value', copy.resolveScheduledCallback(null, [{ id: 'D', value: 1791298800000 }], ids),
    { iso: new Date(1791298800000).toISOString() });
  check('callback: DATE field as a numeric string', copy.resolveScheduledCallback(null, [{ id: 'D', value: '1791298800000' }], ids),
    { iso: new Date(1791298800000).toISOString() });
  check('callback: present but unreadable is still a callback', copy.resolveScheduledCallback(null, [{ id: 'P', value: 'not a date' }], ids), { iso: null });
  check('callback: one scheduled on this page wins over the loaded detail',
    copy.resolveScheduledCallback('2026-10-09T15:00:00.000Z', [{ id: 'P', value: '2026-10-06T15:00:00.000Z' }], ids), { iso: '2026-10-09T15:00:00.000Z' });
  check('callback: this contact\'s record not loaded yet -> unknown, never another contact\'s answer',
    copy.resolveScheduledCallback(null, null, ids), 'unknown');
  check('callback: a callback saved on this page for this contact is known even before the record loads',
    copy.resolveScheduledCallback('2026-10-09T15:00:00.000Z', null, ids), { iso: '2026-10-09T15:00:00.000Z' });
}
check('Pass while this contact\'s record is loading: names no callback',
  copy.sellerCallPassConsequence('unknown'), 'Records the pass. No seller messages. Checking this contact for a scheduled callback…');
check('Seller Call Pass consequence uses only THIS contact\'s callback (session save and loaded record both contact-checked)',
  /data-testid="call-outcome-pass-consequence"[^>]*>\s*\{\(\(\) => \{\s*const cb = resolveScheduledCallback\(\s*sessionCallback\?\.contactId === contactId \? sessionCallback\.iso : null,\s*contact\?\.id === contactId \? contact\.customFields : null,\s*\{ precise: CONFIG\.fields\.callbackDatetimePrecise, date: CONFIG\.fields\.callbackDatetime \}\);\s*return sellerCallPassConsequence\(cb === "unknown" \? "unknown" : cb \? \{ text: cb\.iso \? formatCallbackTime\(cb\.iso\) : null \} : null\);/.test(sellerCallCode), true);
check('a Follow-Up saved on this page is recorded WITH the contact it was written for',
  /const cb = await scheduleCallbackGated\(ghl, contactId, followUpIso\);\s*if \(cb\.ok \|\| cb\.callbackPersisted\) setSessionCallback\(\{ contactId, iso: followUpIso \}\);/.test(sellerCallCode), true);
check('no unscoped session callback remains', /sessionCallbackIso/.test(sellerCallCode), false);
check('Pass writes stay note + attempt only: Seller Call never clears a callback',
  /setCallbackDatetime/.test(sellerCallCode), false);

// ── Contact page: a recorded dial result refreshes notes and the callback ──
check('dial-result control reports a saved note to its page',
  /try \{ await ghl\.notes\.create\(contactId, noteBody\); onNoteWritten\(\); \}/.test(dispositionCode), true);
check('dial-result control reports a saved Follow Up callback to its page',
  /await ghl\.contacts\.setCallbackDatetime\(contactId, callbackIso\);\s*onCallback\(callbackIso\);/.test(dispositionCode), true);
check('onNoteWritten and onCallback fire once each', [(dispositionCode.match(/onNoteWritten\(\)/g) || []).length, (dispositionCode.match(/onCallback\(callbackIso\)/g) || []).length], [1, 1]);
check('Contact page reloads its notes list and shows the callback, only for the contact still shown',
  /<DispositionControl[\s\S]*?onNoteWritten=\{loadNotes\}[\s\S]*?onCallback=\{\(iso\) => \{ if \(currentIdRef\.current === id\) setCallbackOverride\(iso\); \}\}[\s\S]*?\/>/.test(contactPageCode), true);
check('Contact page tracks the contact it currently shows',
  /const currentIdRef = useRef\(id\);\s*currentIdRef\.current = id;/.test(contactPageCode), true);
{
  const loadNotesSrc = (contactPageCode.match(/function loadNotes\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('loadNotes: skips a refresh started for a contact no longer shown',
    /const forId = id;\s*if \(currentIdRef\.current !== forId\) return;/.test(loadNotesSrc), true);
  check('loadNotes: drops a late notes answer or error for a contact no longer shown',
    /ghl\.notes\.list\(forId\)/.test(loadNotesSrc) && /\.then\(\(res\) => \{\s*if \(currentIdRef\.current !== forId\) return;/.test(loadNotesSrc)
    && /\.catch\(\(e: Error\) => \{ if \(currentIdRef\.current === forId\) setNotesError\(e\.message\); \}\)/.test(loadNotesSrc), true);
}

// ── Held changes stay untouched ──────────────────────────────────────────
check('webhook note copy unchanged (held: webhook behavior)', /\? `Call: \$\{disposition\} — \$\{duration\}s`/.test(webhook) && /: `Call: \$\{disposition\}`;/.test(webhook), true);
check('webhook still accepts exactly the six dispositions (Do Not Call refused)',
  (writeContracts.match(/export const dispositions = \[([^\]]*)\]/) || [])[1].split(',').length === 6 && !/Do Not Call/.test(writeContracts), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nB14-12 call-outcome copy: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
