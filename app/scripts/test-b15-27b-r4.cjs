/**
 * B15-27b r4 -- Bones REVISE (149a7a8) R3 P2, rendered: a RECENT pre-existing
 * identical note must not confirm an uncertain save.
 *
 * Offline (scripts/harness/b15-27b/runner.cjs, fixture twoContacts).
 *
 *   K1  Bones's case. A already holds "Left a voicemail", created 30 seconds
 *       ago (an earlier call). The operator saves the same text; the request is
 *       aborted, so it NEVER lands. Later reads of A's notes (A -> B -> A) and a
 *       full reload: the text is kept and still "may already be in GHL"; leaving
 *       the box sends nothing.
 *   K2  The same, with a server-shaped 409 {outcome: "indeterminate"} that never
 *       landed.
 *   K3  The explicit recovery still works: "Save it as a new note anyway" sends
 *       the kept text once; that attempt's own confirmed response clears it.
 *   K4  Positive, identity established: a save whose OWN response confirms it is
 *       cleared at once, with the same recent identical note present.
 *
 * NEGATIVE CONTROLS: --before=149a7a8 (2-minute skew window) and
 * --before=3289146 (any identical note) must fail K1 and K2.
 */
const { run, twoContacts } = require('./harness/b15-27b/runner.cjs');

const fixture = twoContacts();
run({
  title: 'B15-27b r4 no reconciliation by an identical note',
  floor: 14,
  fixture,
  scenarios: async (c) => {
    const { page, A, B, check, isWrite, opsFor, doneWrites, text, settle, until, go, fresh, load } = c;
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const notice = async () => { const el = page.getByTestId('note-draft'); return (await el.count()) ? await el.getAttribute('data-draft-state') : null; };
    const sends = () => opsFor(A).filter((o) => o === 'note.create').length;
    const inGhl = () => fixture.db[A].notes.filter((n) => n.body === X).length;
    const X = 'Left a voicemail';

    /** A fresh A holding an identical note created 30 s ago, loaded on A. */
    const freshWithRecentNote = async () => {
      await fresh({}, null);
      fixture.db[A].notes.push({ id: 'a-recent-x', body: X, dateAdded: new Date(Date.now() - 30 * 1000).toISOString() });
      await load(`/contacts/${A}`);
      await contactLoaded('Alpha');
      await until(async () => (await text()).includes(X), 'recent identical note shown');
    };
    const uncertainSave = async (label) => {
      await noteBox().fill(X); await noteBox().press('Tab');
      await until(async () => (await notice()) === 'sending' && !(await noteBox().isDisabled()), `${label} uncertain`).catch(() => {});
    };
    const survives = async (label) => {
      check(`${label} precondition: the attempt never landed (only the earlier note is in GHL), one send`, inGhl() === 1 && sends() === 1, { inGhl: inGhl(), sends: sends() });
      check(`${label} right after the uncertain save: text kept, "may already be in GHL"`, (await noteBox().inputValue()) === X && (await notice()) === 'sending');
      await go(`/contacts/${B}`); await contactLoaded('Bravo');
      await go(`/contacts/${A}`); await contactLoaded('Alpha');
      await settle(800);
      check(`${label} after a later read of A's notes (holding the identical note from 30 s before): still uncertain, text kept`,
        (await noteBox().inputValue()) === X && (await notice()) === 'sending', { v: await noteBox().inputValue(), n: await notice() });
      await load(`/contacts/${A}`); await contactLoaded('Alpha');
      await settle(800);
      check(`${label} after a reload: the stored notice and text survive`, (await noteBox().inputValue()) === X && (await notice()) === 'sending', { v: await noteBox().inputValue(), n: await notice() });
      await noteBox().focus(); await noteBox().press('Tab');
      await settle(500);
      check(`${label} leaving the box sends nothing (no blind re-send)`, sends() === 1, opsFor(A));
    };

    // ── K1: aborted request (network) ──
    await freshWithRecentNote();
    c.abortNext.push(isWrite('note.create', A));
    await uncertainSave('K1');
    await survives('K1');

    // ── K2: server-declared indeterminate (409), never landed ──
    await freshWithRecentNote();
    c.respondNext.push({ match: isWrite('note.create', A), status: 409, body: { outcome: 'indeterminate', error: 'fixture: write outcome unknown' } });
    await uncertainSave('K2');
    await survives('K2');

    // ── K3: the explicit recovery sends once; its own confirmed response clears it ──
    await page.getByTestId('note-draft-action').click();
    await until(async () => doneWrites(A, 'note.create') >= 2 && (await notice()) === null, 'K3 resent').catch(() => {});
    await settle(500);
    check('K3 "Save it as a new note anyway" sends the kept text once and its confirmed response clears it',
      sends() === 2 && inGhl() === 2 && (await notice()) === null && (await noteBox().inputValue()) === '', { sends: sends(), inGhl: inGhl(), n: await notice() });

    // ── K4: positive -- identity established by the save's own response ──
    await freshWithRecentNote();
    await noteBox().fill(X); await noteBox().press('Tab');
    await until(async () => doneWrites(A, 'note.create') >= 1, 'K4 saved');
    await settle(600);
    check('K4 a confirmed save is cleared at once (its own response), with the recent identical note present',
      (await noteBox().inputValue()) === '' && (await notice()) === null && sends() === 1 && inGhl() === 2, { v: await noteBox().inputValue(), n: await notice() });
    await load(`/contacts/${A}`); await contactLoaded('Alpha'); await settle(500);
    check('K4 and nothing is kept after a reload', (await noteBox().inputValue()) === '' && (await notice()) === null);
  },
});
