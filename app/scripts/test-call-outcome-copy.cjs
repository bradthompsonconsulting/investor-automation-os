/**
 * B14-12 / INV-94 — call-outcome copy and wiring: the recording-only
 * contact-page call log (Brad's design, ruled by Jess 2026-10-02), its note
 * format and queue placement, and Seller Call's conversation-outcome panel.
 *
 * Offline. Compiles the pure copy and queue modules and checks the surfaces
 * that use them by source text, following this repository's existing
 * convention for UI wiring (see test-seller-call-workspace-wiring.cjs).
 * Webhook behavior and the Production write scope are deliberately untouched
 * and are asserted unchanged here.
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
    path.join(APP, 'src/lib/call-log-queue.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const copy = require(path.join(TMP, 'src/lib/call-outcome-copy.js'));
const queue = require(path.join(TMP, 'src/lib/call-log-queue.js'));
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


const callLog = read('src/components/CallLogControl.tsx');
const callLogCode = stripBlockComments(callLog);
const sellerCall = read('src/pages/SellerCallWorkspace.tsx');
const sellerCallCode = stripBlockComments(sellerCall);
const noteGuard = read('netlify/functions/lib/write-note-guard.ts');
const webhook = read('netlify/functions/ghl-disposition.ts');
const writeContracts = read('netlify/functions/lib/write-contracts.ts');
const contactPageCode = stripBlockComments(read('src/pages/ContactWorkspace.tsx'));
const dashboardCode = stripBlockComments(read('src/pages/Dashboard.tsx'));
const ghlClient = read('src/lib/ghl.ts');
const listOf = (name) => [...((writeContracts.match(new RegExp('export const ' + name + ' = \\[([^\\]]*)\\]')) || [])[1] || '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const RESULTS = ['No Answer', 'Voicemail', 'Spoke with Seller', 'Follow Up', 'Not Interested', 'Incorrect Number'];

// ── Call log: results and the note ───────────────────────────────────────
check('six results in display order: Spoke with Seller added; Requested Appointment and Do Not Call are not results', [...copy.CALL_LOG_RESULTS], RESULTS);
check('server callLogResults matches the UI list exactly', listOf('callLogResults'), RESULTS);
check('dialer webhook list unchanged: the original six, no Spoke with Seller', listOf('dispositions'),
  ['No Answer', 'Voicemail', 'Follow Up', 'Requested Appointment', 'Not Interested', 'Incorrect Number']);
check('note without notes', copy.callLogNote('No Answer', '   '), 'Call (reported by Brad in IAOS): No Answer');
check('note with notes (trimmed, line breaks kept)', copy.callLogNote('Spoke with Seller', '  Wants 30 days.\nCall after 5.  '),
  'Call (reported by Brad in IAOS): Spoke with Seller\nWants 30 days.\nCall after 5.');
const guardPattern = (() => {
  const m = noteGuard.match(/if \((\/\^IAOS \(\?:[^/]+\/)\.test\(body\)\)/);
  return m ? new RegExp(m[1].slice(1, -1)) : null;
})();
check('note guard ledger-prefix pattern located in write-note-guard.ts', guardPattern instanceof RegExp, true);
const sampleNotes = RESULTS.map((r) => copy.callLogNote(r, 'IAOS ARV 250000 said the seller'));
check('no call-log note begins with IAOS + a ledger word, even when the notes do', sampleNotes.filter((b) => guardPattern && guardPattern.test(b)), []);
check('call-log notes differ from the GHL call-event form', sampleNotes.some((b) => /^Call: /.test(b)), false);
check('parse round-trips result and notes', copy.parseCallLogNote(copy.callLogNote('Spoke with Seller', 'a\nb')), { result: 'Spoke with Seller', notes: 'a\nb' });
check('parse reads an older dial-result note', copy.parseCallLogNote('Call (reported by Brad in IAOS): Follow Up — callback scheduled for Oct 6, 10:00 AM'), { result: 'Follow Up', notes: '' });
check('parse ignores GHL call events and callback notes', [copy.parseCallLogNote('Call: No Answer — 10s'), copy.parseCallLogNote('Callback scheduled for Oct 6, 10:00 AM')], [null, null]);
check('effect line, exact', copy.CALL_LOG_EFFECT, "Records this call: who, when, the result and your notes. It doesn't move the deal, start or stop workflows, or send messages.");
check('Follow Up hint, exact', copy.FOLLOW_UP_CALLBACK_HINT, "Follow Up doesn't set a callback. Use Set Callback to choose a date and time.");
check('notes limit', copy.CALL_NOTES_MAX, 4000);

// ── Call log control: what it may write ──────────────────────────────────
check('the control calls only getDetail, setCallLogResult, notes.create and setLastCallAttempt',
  [...new Set([...callLogCode.matchAll(/ghl\.(contacts|notes)\.(\w+)\(/g)].map((m) => m[1] + '.' + m[2]))].sort(),
  ['contacts.getDetail', 'contacts.setCallLogResult', 'contacts.setLastCallAttempt', 'notes.create']);
check('the control never names routing, the bell, the old disposition writer or a callback write',
  /setCallRouting|setDispositionAt|setCallDisposition|setCallbackDatetime|scheduleCallbackGated|dispositionAt|callRouting/.test(callLogCode), false);
check('choosing a result only sets state',
  /onClick=\{\(\) => \{ setResult\(r\); if \(submit\.status !== "in_flight"\) setSubmit\(\{ status: "idle" \}\); \}\}/.test(callLogCode), true);
{
  const at = (s) => callLogCode.indexOf(s);
  check('Save order: result -> readback -> note -> last touch',
    at('await ghl.contacts.setCallLogResult(contactId, chosen)') !== -1
    && at('await ghl.contacts.setCallLogResult(contactId, chosen)') < at('await ghl.contacts.getDetail(contactId)')
    && at('await ghl.contacts.getDetail(contactId)') < at('await writeNoteAndTouch(chosen, body)')
    && at('await ghl.notes.create(contactId, body)') < at('await ghl.contacts.setLastCallAttempt(contactId, at)'), true);
}
{
  const readback = (callLogCode.match(/const detail = await ghl\.contacts\.getDetail\(contactId\);[\s\S]*?\n      \}\n/) || [''])[0];
  check('ANY readback failure (sign-in, 500, network) is saved-but-unverified and stops before the note and last touch',
    /\} catch \(e\) \{\s*setSubmit\(\{ status: "saved_unverified", message: e instanceof ReadUnavailableError/.test(readback)
    && /Notes and last-touch time were not attempted\.` \}\);\s*return;\s*\}/.test(readback) && !/throw e/.test(readback), true);
}
check('no message ever claims "Nothing was written"', /Nothing was written/.test(callLogCode), false);
check('a failed result write is "not confirmed", not "not saved", and attempts nothing further',
  /status: "not_saved", message: `Result not confirmed \(\$\{\(e as Error\)\.message\}\)\. Notes and last-touch time were not attempted\./.test(callLogCode), true);
check('the result write appears exactly once (never retried automatically)', (callLogCode.match(/ghl\.contacts\.setCallLogResult\(/g) || []).length, 1);
check('a readback that does not match writes nothing further',
  /if \(!landed\) \{\s*setSubmit\(\{ status: "not_saved", message: "GHL did not confirm the result\. Nothing else was written\." \}\);\s*return;\s*\}/.test(callLogCode), true);
check('a failed note or last touch is reported as partial, never as saved',
  /status: "partial", result: saved, message: `Result saved; notes not saved/.test(callLogCode) && /status: "partial", result: saved, message: `Saved; last-touch time not updated/.test(callLogCode), true);
check('Follow Up shows the hint and a Set Callback that only opens the page control',
  /\{result === "Follow Up" \? \(/.test(callLogCode) && /data-testid="call-log-set-callback" onClick=\{onOpenCallback\}/.test(callLogCode), true);
check('ghl client: setCallLogResult uses the contact.callLogResult operation',
  /setCallLogResult: \(contactId: string, value: string\) =>\s*confirmedCommand\("contact\.callLogResult", contactId, \{ value \}\)/.test(ghlClient), true);
check('server: contact.callLogResult validates against callLogResults and plans the result field only',
  /case "contact\.callLogResult": \{ const v = single\(\); if \(!callLogResults\.includes\(v\)\) throw new Error\("Invalid call result"\); add\(c\.callDisposition, v\); break; \}/.test(writeContracts), true);
check('server: an operation-specific guard refuses any other field for the call log',
  /if \(operation === "contact\.callLogResult" && \(fields\.length !== 1 \|\| fields\[0\]\.id !== c\.callDisposition \|\| fields\.some\(x => x\.id === c\.dispositionAt \|\| x\.id === c\.callRouting\)\)\) throw new Error\("Call log writes only the call result"\);/.test(writeContracts), true);
check('Contact page renders the call log with its refresh and Set Callback wiring',
  /<CallLogControl[\s\S]*?notes=\{notes\}[\s\S]*?onNoteWritten=\{loadNotes\}[\s\S]*?onOpenCallback=\{\(\) => \{ setCallbackOpen\(true\); setCallbackError\(null\); \}\}[\s\S]*?\/>/.test(contactPageCode), true);
check('the old dial-result control is gone', fs.existsSync(path.join(APP, 'src/components/DispositionControl.tsx')) || /DispositionControl/.test(contactPageCode), false);
check('Set Callback stays a separate, explicit page action', /\{callback \? "Change Callback" : "Set Callback"\}/.test(contactPageCode), true);
{
  const dashboardSrc = stripBlockComments(read('src/pages/Dashboard.tsx'));
  check('explicit Set/Clear Callback (Contact page and Dashboard row) use the distinct explicit-callback operation',
    /scheduleCallbackGated\(explicitCallbackClient, id, iso\)/.test(contactPageCode) && /await ghl\.contacts\.setExplicitCallback\(id, null\)/.test(contactPageCode)
    && /scheduleCallbackGated\(explicitCallbackClient, contactId, iso\)/.test(dashboardSrc) && /await ghl\.contacts\.setExplicitCallback\(contactId, null\)/.test(dashboardSrc)
    && !/setCallbackDatetime\(/.test(contactPageCode) && !/setCallbackDatetime\(/.test(dashboardSrc), true);
  check('Seller Call Follow-Up keeps the generic callback operation (denied in Production) and never the explicit one',
    /scheduleCallbackGated\(ghl, contactId, followUpIso\)/.test(sellerCallCode) && !/explicitCallback|setExplicitCallback/.test(sellerCallCode), true);
  check('ghl client: explicit callback is its own operation; explicitCallbackClient routes only the callback write through it',
    /setExplicitCallback: \(contactId: string, iso: string \| null\) => confirmedCommand\("contact\.explicitCallback", contactId, \{ value: iso \}\)/.test(ghlClient)
    && /setCallbackDatetime: \(id: string, iso: string \| null\) => ghl\.contacts\.setExplicitCallback\(id, iso\)/.test(ghlClient), true);
}

// ── Queue placement (Jess ruling 2026-10-02) ─────────────────────────────
check('No Answer / Voicemail stay in the cold-call queue', [queue.callLogPlacement('No Answer', false), queue.callLogPlacement('Voicemail', true)], ['cold', 'cold']);
check('Not Interested / Incorrect Number leave it', [queue.callLogPlacement('Not Interested', false), queue.callLogPlacement('Incorrect Number', true)], ['out', 'out']);
check('Spoke with Seller / Follow Up with no callback -> Needs Next Step', [queue.callLogPlacement('Spoke with Seller', false), queue.callLogPlacement('Follow Up', false)], ['needs_next_step', 'needs_next_step']);
check('Spoke with Seller / Follow Up with a callback -> out (Callbacks shows them)', [queue.callLogPlacement('Spoke with Seller', true), queue.callLogPlacement('Follow Up', true)], ['out', 'out']);
check('no result, an older result, or Do Not Call (its own PR) change nothing here',
  [queue.callLogPlacement(null, false), queue.callLogPlacement('Requested Appointment', false), queue.callLogPlacement('Do Not Call', false)], ['cold', 'cold', 'cold']);
check('Dashboard places each contact by its latest result and its callback',
  /out\.set\(c\.id, callLogPlacement\(result, !!effectiveCallback\(c\)\)\);/.test(dashboardCode)
  && /const result = effectiveDisposition\(c\.callDisposition, c\.dispositionAt, dispositionOverrides\[c\.id\], now\);/.test(dashboardCode), true);
check('Lead Queue excludes every non-cold placement',
  /if \(callLogPlacementById\.get\(c\.id\) && callLogPlacementById\.get\(c\.id\) !== "cold"\) out\.add\(c\.id\);/.test(dashboardCode), true);
{
  const start = dashboardCode.indexOf('<SectionHeading count={needsNextStepRows.length}>Needs Next Step</SectionHeading>');
  const end = dashboardCode.indexOf('<SectionHeading count={followUpRows.length}>Follow Up</SectionHeading>');
  const section = start !== -1 && end > start ? dashboardCode.slice(start, end) : '';
  check('Needs Next Step section renders before the stage-based Follow Up section', section.length > 0, true);
  check('Needs Next Step is read-only: no write, no onClick, just a link to the contact', /ghl\.|onClick=/.test(section) === false && /<Link to=\{`\/contacts\/\$\{c\.id\}`\}/.test(section), true);
}
check('Needs Next Step rows: needs_next_step, not terminal, not already in the stage Follow Up list',
  /callLogPlacementById\.get\(c\.id\) === "needs_next_step"\s*&& !terminalContactIds\.has\(c\.id\) && !followUpContactIds\.has\(c\.id\)/.test(dashboardCode), true);

// ── Seller Call conversation-outcome panel ───────────────────────────────
check('Seller Call heading and subheading come from the copy module',
  /\{CONVERSATION_OUTCOME_HEADING\}/.test(sellerCallCode) && /\{CONVERSATION_OUTCOME_SUBHEADING\} \{GHL_CALL_LOGGING_LINE\}/.test(sellerCallCode), true);
check('Seller Call points no-conversation calls to this contact\'s call log', copy.DIAL_RESULT_POINTER, 'No conversation? Log the call on the contact page.');
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
check('Seller Call resolves ONE callback status from only THIS contact\'s data (session save and loaded record both contact-checked)',
  /const passCallback = resolveScheduledCallback\(\s*sessionCallback\?\.contactId === contactId \? sessionCallback\.iso : null,\s*contact\?\.id === contactId \? contact\.customFields : null,\s*\{ precise: CONFIG\.fields\.callbackDatetimePrecise, date: CONFIG\.fields\.callbackDatetime \}\);\s*const passCallbackKnown = passCallback !== "unknown";/.test(sellerCallCode)
  && (sellerCallCode.match(/resolveScheduledCallback\(/g) || []).length === 1, true);
check('Pass consequence text comes from that status',
  /data-testid="call-outcome-pass-consequence"[^>]*>\s*\{sellerCallPassConsequence\(passCallback === "unknown" \? "unknown"\s*: passCallback \? \{ text: passCallback\.iso \? formatCallbackTime\(passCallback\.iso\) : null \} : null\)\}/.test(sellerCallCode), true);
check('Confirm Pass is disabled until this contact\'s callback status is known',
  /data-testid="call-outcome-pass-confirm"\s*onClick=\{\(\) => void handleRecordOutcome\("pass"\)\}\s*disabled=\{recordingOutcome !== null \|\| passReasonInput\.trim\(\) === "" \|\| !passCallbackKnown\}/.test(sellerCallCode), true);
{
  const handler = (sellerCallCode.match(/async function handleRecordOutcome\(kind: CallOutcomeKind\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  const gate = handler.indexOf('if (kind === "pass" && !passCallbackKnown) {');
  const firstWrite = Math.min(...['ghl.', 'runConfirmAcceptWrites(', 'scheduleCallbackGated(', 'attemptRecordOutcome('].map((s) => { const i = handler.indexOf(s); return i === -1 ? Infinity : i; }));
  check('handleRecordOutcome refuses a Pass before any validation or write while the status is unknown',
    gate !== -1 && gate < firstWrite && /if \(kind === "pass" && !passCallbackKnown\) \{\s*setOutcomeActionError\([^)]*\);\s*return;\s*\}/.test(handler), true);
}
check('a Follow-Up saved on this page is recorded WITH the contact it was written for',
  /const cb = await scheduleCallbackGated\(ghl, contactId, followUpIso\);\s*if \(cb\.ok \|\| cb\.callbackPersisted\) setSessionCallback\(\{ contactId, iso: followUpIso \}\);/.test(sellerCallCode), true);
check('no unscoped session callback remains', /sessionCallbackIso/.test(sellerCallCode), false);
check('Pass writes stay note + attempt only: Seller Call never clears a callback',
  /setCallbackDatetime/.test(sellerCallCode), false);

// ── Contact page: late results stay with their contact ───────────────────
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
  listOf('dispositions').length === 6 && !listOf('dispositions').includes('Do Not Call'), true);

// ── Do Not Call wiring (B14-12) ──────────────────────────────────────────
{
  const dncCode = stripBlockComments(read('src/components/DncControl.tsx'));
  check('DNC control only READS GHL (contacts.getDetail) — no note, no contact write',
    [...new Set([...dncCode.matchAll(/ghl\.(\w+)\.(\w+)\(/g)].map((m) => m[1] + '.' + m[2]))].sort(), ['contacts.getDetail']);
  check('DNC hands Brad to THIS contact in GHL through the isolated 14-11 handoff, from the button itself',
    /const ghlUrl = ghlContactDetailUrl\(contactId\);/.test(dncCode) && /openGhlContactWindow\(ghlUrl, \(url, target\) => window\.open\(url, target\)\)/.test(dncCode)
    && /data-testid="dnc-open" onClick=\{openInGhl\}/.test(dncCode), true);
  check('DNC (Brad 2026-10-04): no reason field, no note, no recovery record, no "recorded" claim',
    /textarea|reason|notes\.create|sessionStorage|PENDING_PREFIX|Retry|recorded/i.test(dncCode), false);
  check('DNC check reads THIS contact fresh and drops a late answer for another contact',
    /const fresh = await ghl\.contacts\.getDetail\(cid\);\n\s+if \(currentId\.current !== cid\) return;\n\s+if \(fresh\.id !== cid\)/.test(dncCode), true);
  check('ghl client has no DND write method', /setDnc|contact\.dnc/.test(ghlClient), false);
  check("Contact page mounts the DNC control with only this contact's detail (and no note callback)",
    /<DncControl[\s\S]*?detail=\{detail && detail\.id === id \? detail : null\}\s*\/>/.test(contactPageCode), true);
  check('Dashboard keeps a Call-suppressed contact out of every calling list',
    /const doNotCallIds = useMemo\(\s*\(\) => new Set\(\(contacts \?\? \[\]\)\.filter\(\(c\) => isCallSuppressed\(c\.dndSettings\)\)/.test(dashboardCode)
    && /!!x\.cb && !doNotCallIds\.has\(x\.contact\.id\)/.test(dashboardCode) && /!!c && !doNotCallIds\.has\(c\.id\)/.test(dashboardCode)
    && /!followUpContactIds\.has\(c\.id\) && !doNotCallIds\.has\(c\.id\)/.test(dashboardCode) && /if \(doNotCallIds\.has\(c\.id\)\) out\.add\(c\.id\);/.test(dashboardCode), true);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nB14-12 call-outcome copy: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
