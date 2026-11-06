/**
 * B15-27b r3 -- Bones REVISE (3289146) R2-1 and R2-2, rendered.
 *
 * Offline (scripts/harness/b15-27b/runner.cjs, fixture twoContacts).
 *
 *   G1  Reconciliation is bound to the exact contact. A holds a note "X"; B holds
 *       an uncertain draft "X" (its save was aborted). The page goes A -> B with
 *       B's notes read HELD (and, in a second case, FAILED): A's notes are still on
 *       screen for the first render, yet B stays uncertain, text kept. After B's
 *       own read (no "X") it is still uncertain. An OLDER identical note on B
 *       proves nothing either. r4 (Bones R3 P2): neither does a later read of B
 *       holding an "X" created after the save began -- no read reconciles it.
 *   G2  Call-log operator ownership is bound before the reservation. Operator two
 *       holds a call-log draft on A. Operator one saves a call on A; its
 *       reservation is HELD; the session switches to operator two; the operation
 *       then completes. Operator two's result and notes stay on screen and in
 *       storage; operator one's submitted draft is cleaned up; the call is
 *       recorded once (result, note, last touch).
 *
 * NEGATIVE CONTROL: --before=3289146 must fail G1 and G2.
 */
const { run, twoContacts } = require('./harness/b15-27b/runner.cjs');

const fixture = twoContacts();
run({
  title: 'B15-27b r3 reconciliation and call-log operator binding',
  floor: 13,
  fixture,
  scenarios: async (c) => {
    const { page, A, B, check, hold, isWrite, opsFor, doneWrites, text, settle, until, go, fresh, load, setOperator } = c;
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const notice = async (testid) => { const el = page.getByTestId(testid); return (await el.count()) ? await el.getAttribute('data-draft-state') : null; };
    const X = 'Left a voicemail';

    // ── G1 ──
    for (const variant of ['held', 'failed']) {
      await fresh({}, `/contacts/${A}`);
      await contactLoaded('Alpha');
      await noteBox().fill(X); await noteBox().press('Tab');            // A really holds a note "X"
      await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1 && (await text()).includes(X), 'G1 A note');
      await go(`/contacts/${B}`);
      await contactLoaded('Bravo');
      c.abortNext.push(isWrite('note.create', B));
      await noteBox().fill(X); await noteBox().press('Tab');            // B's own "X" is uncertain
      await until(async () => (await notice('note-draft')) === 'sending' && !(await noteBox().isDisabled()), 'G1 B uncertain').catch(() => {});
      await go(`/contacts/${A}`);
      await contactLoaded('Alpha');                                       // A's notes (with "X") are on screen
      const h = hold((r) => r.kind === 'notes' && r.contact === B);
      if (variant === 'failed') c.failNext.push((r) => r.kind === 'notes' && r.contact === B);
      await go(`/contacts/${B}`);
      await h.hit;
      await settle(800);
      check(`G1 (${variant}) A -> B with B's notes read pending: A's notes never reconcile B's uncertain draft`,
        (await noteBox().inputValue()) === X && (await notice('note-draft')) === 'sending', { v: await noteBox().inputValue(), n: await notice('note-draft') });
      h.release();
      await settle(800);
      check(`G1 (${variant}) after B's own read (${variant === 'held' ? 'no "X" in it' : 'failed'}), B is still uncertain, text kept`,
        (await noteBox().inputValue()) === X && (await notice('note-draft')) === 'sending');
    }
    // an OLDER identical note on B proves nothing; r4: nor does a later one created after the save began
    fixture.db[B].notes.push({ id: 'b-old-x', body: X, dateAdded: '2026-09-29T12:00:00.000Z' });
    await load(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await settle(800);
    check('G1 an older identical note on B (before the save began) does not reconcile it', (await noteBox().inputValue()) === X && (await notice('note-draft')) === 'sending');
    fixture.applyWrite('note.create', B, { body: X });                   // B's "X" is now in GHL, created after the save began
    await load(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await settle(800);
    check('G1 r4: a later read of B holding an "X" created after the save began does not reconcile it either (text kept, uncertain; nothing re-sent)',
      (await noteBox().inputValue()) === X && (await notice('note-draft')) === 'sending' && opsFor(B).filter((o) => o === 'note.create').length === 1, { v: await noteBox().inputValue(), n: await notice('note-draft'), ops: opsFor(B) });

    // ── G2 ──
    const callNotes = () => page.getByTestId('call-log-notes');
    const pressed = async (slug) => (await page.getByTestId(`call-log-result-${slug}`).getAttribute('aria-pressed')) === 'true';
    await fresh({}, `/contacts/${A}`, 'operator-two');
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-voicemail').click();
    await callNotes().fill('G2 operator two call notes');
    await settle(300);
    await setOperator('operator-one');
    await settle(400);
    check('G2 operator one on A sees none of operator two\'s call-log draft', !(await pressed('voicemail')) && (await callNotes().inputValue()) === '');
    await page.getByTestId('call-log-result-no-answer').click();
    await callNotes().fill('G2 operator one call notes');
    await until(async () => !(await page.getByTestId('call-log-save').isDisabled()), 'G2 save enabled');
    const h = hold((r) => r.kind === 'call-log-barrier' && r.post && r.post.action === 'begin');
    await page.getByTestId('call-log-save').click();
    await h.hit;                                                           // operator one's reservation is pending
    await setOperator('operator-two');
    await settle(400);
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'G2 operation completes');
    await settle(1200);
    check('G2 after operator one\'s delayed save completes, operator two\'s result and notes are still shown',
      (await pressed('voicemail')) && (await callNotes().inputValue()) === 'G2 operator two call notes', { v: await callNotes().inputValue() });
    check('G2 the call was recorded once, for operator one\'s entry (result, note, last touch)',
      JSON.stringify(opsFor(A)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt'])
      && c.log.some((r) => r.kind === 'write' && r.op === 'note.create' && String(r.args.body).includes('G2 operator one call notes')), opsFor(A));
    await load(`/contacts/${A}`, 'operator-two');
    await contactLoaded('Alpha');
    await until(async () => (await callNotes().inputValue()) !== '', 'G2 op2 restore').catch(() => {});
    check('G2 operator two\'s call-log draft survives in storage (restored after a reload)', (await pressed('voicemail')) && (await callNotes().inputValue()) === 'G2 operator two call notes');
    await load(`/contacts/${A}`, 'operator-one');
    await contactLoaded('Alpha');
    await settle(800);
    check('G2 operator one\'s submitted draft was cleaned up by its operation', !(await pressed('no-answer')) && (await callNotes().inputValue()) === '' && (await notice('call-log-draft')) === null,
      { v: await callNotes().inputValue(), n: await notice('call-log-draft') });
  },
});
