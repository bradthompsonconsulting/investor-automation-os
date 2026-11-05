/**
 * B15-27b P2 -- contact / deal draft preservation (Captain decision 2026-11-04):
 * unfinished work stays with its own contact or deal, never moves to another,
 * comes back on return and after a reload, is never shown to another operator,
 * survives a failed save with its reason, and is never re-sent blindly.
 *
 * Offline, rendered (scripts/harness/b15-27b/runner.cjs, fixture twoContacts).
 * A "reload" is a full document load of the harness (new JS state; browser
 * storage kept). Drafts:
 *   D1-D7   Contact page note box
 *   D8-D9   Contact page call log (result + notes)
 *   D10-D13 Seller Call outcome form (Pass reason, Follow-Up time)
 *   D14     Seller Call readiness decision reason
 * Every case also checks that keeping a draft writes nothing.
 *
 * NEGATIVE CONTROLS: --before=<P3+P4 commit> (no draft preservation: D1-D14
 * restore checks fail) and --before=16bcf12 (main: A's text also shows on B).
 */
const { run, twoContacts } = require('./harness/b15-27b/runner.cjs');

const fixture = twoContacts();
run({
  title: 'B15-27b P2 draft preservation',
  floor: 43,
  fixture,
  scenarios: async (c) => {
    const { page, A, B, check, hold, isWrite, holdThenFail, opsFor, writes, doneWrites, text, settle, until, go, fresh, load, setOperator } = c;
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const scLoaded = (first) => until(async () => (await text()).includes(`${first} deal`), `${first} Seller Call`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const noteVal = () => noteBox().inputValue();
    const notice = async (testid) => { const el = page.getByTestId(testid); return (await el.count()) ? { state: await el.getAttribute('data-draft-state'), text: (await el.innerText()).trim() } : null; };
    const toA = async () => { await go(`/contacts/${A}`); await contactLoaded('Alpha'); await settle(200); };
    const toB = async () => { await go(`/contacts/${B}`); await contactLoaded('Bravo'); await settle(200); };
    const reloadTo = async (to, op) => { await load(to, op); };
    const NOTE = 'B15-27b Alpha unfinished note';

    // ── Contact page: the note box ─────────────────────────────────────────
    // D1 — typed on A (not left), A -> B -> A.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await noteBox().fill(NOTE);
    await settle(200);
    check('D1 a draft typed on A is marked as kept in this browser, not in GHL', (await notice('note-draft'))?.state === 'kept', await notice('note-draft'));
    await toB();
    check('D1 on B the note box is empty and shows no draft', (await noteVal()) === '' && (await notice('note-draft')) === null, await noteVal());
    await toA();
    check('D1 back on A, A\'s unfinished note is restored', (await noteVal()) === NOTE, await noteVal());
    check('D1 keeping the draft wrote nothing', writes().length === 0, opsFor());
    // D2 — reload survival, and still never on B.
    await reloadTo(`/contacts/${A}`);
    await contactLoaded('Alpha');
    check('D2 after a reload, A\'s unfinished note is restored', (await noteVal()) === NOTE, await noteVal());
    await reloadTo(`/contacts/${B}`);
    await contactLoaded('Bravo');
    check('D2 after a reload, B shows none of A\'s draft', (await noteVal()) === '');
    // D3 — operator isolation.
    await toA();
    await setOperator('operator-two');
    await settle(300);
    check('D3 another operator signed in: A\'s box shows none of operator one\'s draft', (await noteVal()) === '', await noteVal());
    await noteBox().fill('B15-27b operator two note');
    await settle(200);
    await setOperator('operator-one');
    await settle(300);
    check('D3 operator one again: operator one\'s own draft is back, operator two\'s is not shown', (await noteVal()) === NOTE, await noteVal());
    await reloadTo(`/contacts/${A}`, 'operator-two');
    await contactLoaded('Alpha');
    check('D3 after a reload as operator two: only operator two\'s draft', (await noteVal()) === 'B15-27b operator two note', await noteVal());
    check('D3 no write', writes().length === 0, opsFor());
    // D4 — a failed save keeps the text, with the reason, on A only.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let h = holdThenFail('note.create', A);
    await noteBox().fill(NOTE);
    await noteBox().press('Tab');
    await h.hit;
    await toB();
    h.release();
    await until(async () => c.log.some((r) => r.kind === 'write' && r.op === 'note.create' && r.status === 500), 'D4 failure');
    await settle(300);
    check('D4 A\'s failed save shows nothing on B', (await noteVal()) === '' && (await notice('note-draft')) === null);
    await toA();
    const d4 = await notice('note-draft');
    check('D4 back on A, the text is restored with why it was not saved', (await noteVal()) === NOTE && d4?.state === 'failed' && d4.text.includes('fixture: injected failure'), { val: await noteVal(), d4 });
    await reloadTo(`/contacts/${A}`);
    await contactLoaded('Alpha');
    check('D4 after a reload the failed text and its reason are still kept', (await noteVal()) === NOTE && (await notice('note-draft'))?.state === 'failed');
    await noteBox().press('Tab');   // focus and leave: retry
    await noteBox().focus(); await noteBox().press('Tab');
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'D4 retry').catch(() => {});
    await settle(400);
    check('D4 leaving the box retries the kept note once; then it is gone', opsFor(A).filter((o) => o === 'note.create').length === 2 && (await noteVal()) === '' && (await notice('note-draft')) === null, opsFor(A));
    // D5 — reloaded while the save was in flight: kept as "may already be in GHL", never re-sent blindly.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isWrite('note.create', A));
    await noteBox().fill(NOTE);
    await noteBox().press('Tab');
    await h.hit;
    await reloadTo(`/contacts/${A}`);
    h.release();
    await contactLoaded('Alpha');
    await settle(400);
    const d5 = await notice('note-draft');
    check('D5 after a reload mid-save the text is kept and marked "may already be in GHL"', (await noteVal()) === NOTE && d5?.state === 'sending', { val: await noteVal(), d5 });
    const n5 = opsFor(A).filter((o) => o === 'note.create').length;
    await noteBox().focus(); await noteBox().press('Tab');
    await settle(500);
    check('D5 leaving the box does not send it again', opsFor(A).filter((o) => o === 'note.create').length === n5, opsFor(A));
    await noteBox().fill(`${NOTE} (edited)`);
    await noteBox().press('Tab');
    await until(async () => opsFor(A).filter((o) => o === 'note.create').length === n5 + 1, 'D5 edited send').catch(() => {});
    check('D5 once edited, leaving the box saves it (one write)', opsFor(A).filter((o) => o === 'note.create').length === n5 + 1, opsFor(A));
    // let D5's own save finish before the next case, so none of its requests lands in D6's log
    await until(async () => c.log.filter((r) => r.kind === 'write' && r.contact === A && !r.done).length === 0 && (await noteVal()) === '', 'D5 settled').catch(() => {});
    await settle(400);
    // D6 — a saved note is not kept.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await noteBox().fill(NOTE);
    await noteBox().press('Tab');
    // D6's OWN save: its note, then its attempt, both answered
    await until(async () => { const w = c.log.filter((r) => r.kind === 'write' && r.contact === A); const i = w.findIndex((r) => r.op === 'note.create' && r.done); return i >= 0 && w.slice(i + 1).some((r) => r.op === 'contact.lastCallAttempt' && r.done); }, 'D6 save');
    await until(async () => (await noteVal()) === '', 'D6 box cleared');
    await reloadTo(`/contacts/${A}`);
    await contactLoaded('Alpha');
    check('D6 after a saved note, a reload shows no draft', (await noteVal()) === '' && (await notice('note-draft')) === null, { val: await noteVal(), n: await notice('note-draft'), ops: opsFor() });
    // D7 — saved while B is shown: A's draft is gone when A is shown again.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isWrite('note.create', A));
    await noteBox().fill(NOTE);
    await noteBox().press('Tab');
    await h.hit;
    await toB();
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'D7 A save');
    await toA();
    check('D7 A\'s note saved while B was shown: back on A no draft remains', (await noteVal()) === '' && (await notice('note-draft')) === null, await noteVal());
    check('D7 one note, one attempt, for A only', JSON.stringify(opsFor()) === JSON.stringify(['note.create', 'contact.lastCallAttempt']), opsFor());

    // ── Contact page: the call log ─────────────────────────────────────────
    const callNotes = () => page.getByTestId('call-log-notes');
    const pressed = async (slug) => (await page.getByTestId(`call-log-result-${slug}`).getAttribute('aria-pressed')) === 'true';
    // D8 — result + notes kept per contact; restored; reload; never on B.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-voicemail').click();
    await callNotes().fill('B15-27b Alpha call notes');
    await settle(200);
    check('D8 the call-log draft is marked as kept', (await notice('call-log-draft'))?.state === 'kept');
    await toB();
    check('D8 on B the call log shows no result and no notes from A', !(await pressed('voicemail')) && (await callNotes().inputValue()) === '');
    await toA();
    check('D8 back on A, A\'s result and call notes are restored', (await pressed('voicemail')) && (await callNotes().inputValue()) === 'B15-27b Alpha call notes');
    await reloadTo(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await callNotes().inputValue()) !== '', 'D8 restore after reload').catch(() => {});
    check('D8 after a reload, A\'s call-log draft is restored', (await pressed('voicemail')) && (await callNotes().inputValue()) === 'B15-27b Alpha call notes');
    check('D8 keeping it wrote nothing', writes().length === 0, opsFor());
    // D9 — saved: the draft goes; a reload shows none.
    await until(async () => !(await page.getByTestId('call-log-save').isDisabled()), 'D9 save enabled');
    await page.getByTestId('call-log-save').click();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'D9 call saved');
    await until(async () => (await page.getByTestId('call-log-done').count()) > 0, 'D9 done').catch(() => {});
    await reloadTo(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await settle(600);
    check('D9 after the call is saved, a reload shows no call-log draft', !(await pressed('voicemail')) && (await callNotes().inputValue()) === '' && (await notice('call-log-draft')) === null);
    check('D9 the call was saved once (result, note, last touch)', JSON.stringify(opsFor(A)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt']), opsFor(A));

    // ── Seller Call: the outcome form ──────────────────────────────────────
    const openPass = async () => {
      await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, 'Pass toggle');
      if ((await page.getByTestId('call-outcome-pass-reason').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
    };
    const reason = async () => ((await page.getByTestId('call-outcome-pass-reason').count()) ? page.getByTestId('call-outcome-pass-reason').inputValue() : null);
    const scA = async () => { await go(`/contacts/${A}/seller-call`); await scLoaded('Alpha'); await settle(300); };
    const scB = async () => { await go(`/contacts/${B}/seller-call`); await scLoaded('Bravo'); await settle(300); };
    // D10 — Pass reason kept per deal; restored; reload; never on B.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await openPass();
    await page.getByTestId('call-outcome-pass-reason').fill('B15-27b Alpha pass reason');
    await settle(200);
    check('D10 the outcome draft is marked as kept for this deal', (await notice('call-outcome-draft'))?.state === 'kept', await notice('call-outcome-draft'));
    await scB();
    check('D10 on B no Pass form holds A\'s reason', ((await reason()) ?? '') === '' && (await notice('call-outcome-draft')) === null);
    await scA();
    check('D10 back on A, A\'s Pass form is open with A\'s reason', (await reason()) === 'B15-27b Alpha pass reason', await reason());
    await reloadTo(`/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await settle(400);
    check('D10 after a reload, A\'s Pass reason is restored', (await reason()) === 'B15-27b Alpha pass reason', await reason());
    check('D10 keeping it wrote nothing', writes().length === 0, opsFor());
    // D11 — Follow-Up time kept the same way.
    await page.getByTestId('call-outcome-follow-up-toggle').click();
    await page.getByTestId('call-outcome-follow-up-at').fill('2026-10-06T10:00');
    await settle(200);
    await scB();
    check('D11 on B no Follow-Up time from A', (await page.getByTestId('call-outcome-follow-up-at').count()) === 0 || (await page.getByTestId('call-outcome-follow-up-at').inputValue()) === '');
    await scA();
    check('D11 back on A, A\'s Follow-Up time is restored', (await page.getByTestId('call-outcome-follow-up-at').count()) === 1 && (await page.getByTestId('call-outcome-follow-up-at').inputValue()) === '2026-10-06T10:00');
    // D12 — a recorded Pass clears the deal's draft, also when recorded while B is shown.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await openPass();
    await page.getByTestId('call-outcome-pass-reason').fill('B15-27b Alpha pass D12');
    await until(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()), 'D12 confirm');
    h = hold(isWrite('note.create', A));
    await page.getByTestId('call-outcome-pass-confirm').click();
    await h.hit;
    await scB();
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'D12 A pass');
    await scA();
    check('D12 A\'s Pass recorded while B was shown: back on A no Pass draft remains', ((await reason()) ?? '') === '' && (await notice('call-outcome-draft')) === null, await reason());
    await reloadTo(`/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await settle(400);
    check('D12 and none after a reload', ((await reason()) ?? '') === '');
    // D13 — a Pass that fails while B is shown keeps A's reason, with why.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await openPass();
    await page.getByTestId('call-outcome-pass-reason').fill('B15-27b Alpha pass D13');
    await until(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()), 'D13 confirm');
    h = holdThenFail('note.create', A);
    await page.getByTestId('call-outcome-pass-confirm').click();
    await h.hit;
    await scB();
    h.release();
    await until(async () => c.log.some((r) => r.kind === 'write' && r.op === 'note.create' && r.status === 500), 'D13 failure');
    await settle(800);
    check('D13 nothing of A\'s failed Pass shows on B', ((await reason()) ?? '') === '' && (await notice('call-outcome-draft')) === null);
    await scA();
    const d13 = await notice('call-outcome-draft');
    check('D13 back on A, A\'s Pass reason is restored with why it was not recorded', (await reason()) === 'B15-27b Alpha pass D13' && d13?.state === 'failed', { reason: await reason(), d13 });

    // ── Seller Call: the readiness decision reason ─────────────────────────
    const openDecision = async () => {
      const panel = page.getByTestId('readiness-human-action-panel');
      await panel.waitFor({ timeout: 15000 });
      if (!(await panel.evaluate((el) => el.open))) await panel.locator('summary').first().click();
    };
    const reasonInput = () => page.locator('input[placeholder="Reason for overriding (required)"], input[placeholder="Optional note"]');
    // D14 — kept per deal (it used to follow the operator to the next contact).
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await openDecision();
    await reasonInput().fill('B15-27b Alpha readiness reason');
    await settle(200);
    await scB();
    await openDecision();
    check('D14 on B the readiness reason input holds nothing from A', (await reasonInput().inputValue()) === '', await reasonInput().inputValue());
    await scA();
    await openDecision();
    check('D14 back on A, A\'s readiness reason is restored', (await reasonInput().inputValue()) === 'B15-27b Alpha readiness reason', await reasonInput().inputValue());
    check('D14 keeping it wrote nothing', writes().length === 0, opsFor());
  },
});
