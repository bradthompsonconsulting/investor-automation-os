/**
 * B15-29 (Bones REVISE R2 on bf83269, 2026-11-10) -- draft retention and isolation under ONE IAOS sign-in, on the REAL
 * Deal Calculator and the REAL Seller Call, offline (scripts/harness/one-login-drafts via the B15-27b runner).
 *
 * The REAL Layout mounts the REAL OneLoginAccess gate (runtime config `oneLogin: { active: true }`). The page learns
 * its operator ONLY from the status answers this test gives: synthetic operators A (tag "tagA") and B (tag "tagB"),
 * each with a saving token whose subject is a fictional address. A "re-authentication" of the same account is a new
 * session tag with the same operator tag (what the gate sees after Log In Again). A "reload" is a full document load
 * (new JS state, browser storage kept). Every removal of a draft key is recorded from inside the page.
 *
 *   C1-C3  Deal Calculator: A's unsaved ARV survives a reload and a same-account re-authentication; it is stored only
 *          under one-login:tagA (no email, no "this-browser"); it is never removed.
 *   C4-C6  Deal Calculator A->B in place: the account-changed notice; B's page shows none of A's figures (not even in the
 *          DOM); A's draft is not removed; B's own figure is kept under tagB; back to A (reload), A's figure is intact
 *          and B's is not shown.
 *   S1-S6  the same for the Seller Call Pass-reason draft (B15-27b outcome draft).
 *   L1-L3  legacy drafts (stored before one sign-in, under the e-mail or "this-browser" owner): never shown under
 *          one-login:tagA, never deleted, never re-attributed to the current operator.
 *   W      no ghl-write at all; nothing left the machine; no page errors (runner).
 */
'use strict';
const { run, twoContacts, A, B } = require('./harness/b15-27b/runner.cjs');

const fixture = twoContacts();
const OPS = { tagA: 'operator-a@example.invalid', tagB: 'operator-b@example.invalid' };
const ol = { operator: 'tagA', session: 'sessA1', signedIn: true };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

run({
  title: 'B15-29 one IAOS sign-in: real-page draft retention and isolation',
  floor: 21,
  fixture,
  entry: 'scripts/harness/one-login-drafts/index.html',
  answer: (req, url, method) => {
    if (req.kind === 'app-read-session' && method === 'GET') {
      return ol.signedIn
        ? { status: 200, body: { clientId: 'offline-read-client', signedIn: true, state: 'signed_in', expiresAt: new Date(Date.now() + 20 * 86400_000).toISOString(),
            handle: 'h.' + b64({ fixture: ol.session }) + '.s', operator: ol.operator, session: ol.session } }
        : { status: 200, body: { clientId: 'offline-read-client', signedIn: false, state: 'signed_out' } };
    }
    if (req.kind === 'app-write-token' && method === 'POST') {
      return { status: 200, body: { token: 'h.' + b64({ sub: OPS[ol.operator] }) + '.s', expiresInSeconds: 900 } };
    }
    return null;
  },
  scenarios: async (ctx) => {
    const { page, check, until, settle, go, load } = ctx;
    await page.addInitScript(() => {
      const rem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (k) { if (/^iaos-(calculator|contact)-draft:/.test(String(k))) console.log('[draft-remove] ' + k); return rem.call(this, k); };
    });
    const removals = [];
    page.on('console', (m) => { const t = m.text(); if (t.startsWith('[draft-remove] ')) removals.push(t.slice(15)); });
    const as = (operator, session) => { ol.operator = operator; ol.session = session; ol.signedIn = true; };
    const recheck = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const signedIn = () => until(async () => (await page.getByTestId('read-access-signed-in').count()) > 0, 'signed in');
    const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => /^iaos-(calculator|contact)-draft:/.test(k)));
    const keysOf = async (needle) => (await keys()).filter((k) => k.includes(needle));
    const bodyHas = async (s) => ((await page.locator('body').textContent()) || '').includes(s) ||
      (await page.evaluate((v) => [...document.querySelectorAll('input,textarea')].some((e) => e.value === v), s));
    const removedOf = (needle) => removals.filter((k) => k.includes(needle)).length;
    const TAG_A = 'one-login%3AtagA', TAG_B = 'one-login%3AtagB';

    // ── Deal Calculator ────────────────────────────────────────────────────────
    const arv = () => page.getByTestId('deal-calc-arv-input');
    const dcOpen = async () => {
      await go(`/deal-calculator?contactId=${A}`);
      await arv().waitFor({ timeout: 30000 });
      if ((await page.getByTestId('deal-calc-deal-select').count()) && (await page.getByTestId('deal-calc-deal-select').isVisible())) {
        const v = await page.getByTestId('deal-calc-deal-select').locator('option').nth(1).getAttribute('value'); await page.getByTestId('deal-calc-deal-select').selectOption(v);
      }
      await settle(500);
    };
    as('tagA', 'sessA1');
    await ctx.fresh({}, null);
    await signedIn();
    await dcOpen();
    await arv().fill('333000'); await settle(500);
    check('C1 A types an unsaved ARV: it is kept under one-login:tagA only (no e-mail, no "this-browser" in any draft key)',
      (await keysOf(TAG_A)).some((k) => k.startsWith('iaos-calculator-draft:')) && (await keys()).every((k) => !k.includes('this-browser') && !k.includes('%40') && !k.includes('@')), await keys());
    await load(null); await signedIn(); await dcOpen();
    check('C2 reload: A\'s unsaved 333000 is back on the real Deal Calculator', (await arv().inputValue()) === '333000', await arv().inputValue());
    as('tagA', 'sessA2'); await recheck(); await settle(800);
    check('C3 same-account re-authentication (new session, same operator): the page keeps 333000, no account-changed notice, nothing removed',
      (await arv().inputValue()) === '333000' && (await page.getByTestId('one-login-account-changed').count()) === 0 && removedOf(TAG_A) === 0, { v: await arv().inputValue(), removed: removedOf(TAG_A) });
    await load(null); await signedIn(); await dcOpen();
    check('C3 reload after the re-authentication: still 333000', (await arv().inputValue()) === '333000');
    // A -> B in place
    as('tagB', 'sessB1'); await recheck();
    await until(async () => (await page.getByTestId('one-login-account-changed').count()) > 0, 'account changed');
    check('C4 A->B: the account-changed notice; A\'s 333000 is nowhere in B\'s page (DOM or inputs) while the notice is up', !(await bodyHas('333000')));
    await page.getByTestId('one-login-account-continue').click(); await dcOpen();
    check('C4 B\'s Deal Calculator shows none of A\'s figures; A\'s draft key was not removed', (await arv().inputValue()) !== '333000' && !(await bodyHas('333000')) && removedOf(TAG_A) === 0 && (await keysOf(TAG_A)).length >= 1,
      { v: await arv().inputValue(), removed: removedOf(TAG_A) });
    await arv().fill('444000'); await settle(500);
    check('C5 B\'s own unsaved figure is kept under one-login:tagB', (await keysOf(TAG_B)).some((k) => k.startsWith('iaos-calculator-draft:')));
    as('tagA', 'sessA3'); await load(null); await signedIn(); await dcOpen();
    check('C6 back to A (reload): A\'s 333000 is intact and B\'s 444000 is not shown', (await arv().inputValue()) === '333000' && !(await bodyHas('444000')), await arv().inputValue());

    // ── Seller Call: the Pass-reason draft ─────────────────────────────────────
    const REASON_A = 'R2 operator A unsaved pass reason', REASON_B = 'R2 operator B pass reason';
    const scLoaded = () => until(async () => ((await page.locator('body').innerText()) || '').includes('Alpha deal'), 'Alpha Seller Call');
    const openPass = async () => {
      await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, 'Pass toggle');
      if ((await page.getByTestId('call-outcome-pass-reason').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
    };
    const reason = async () => ((await page.getByTestId('call-outcome-pass-reason').count()) ? page.getByTestId('call-outcome-pass-reason').inputValue() : null);
    const scOpen = async () => { await go(`/contacts/${A}/seller-call`); await scLoaded(); await settle(400); };
    as('tagA', 'sessA4'); await load(null); await signedIn(); await scOpen(); await openPass();
    await page.getByTestId('call-outcome-pass-reason').fill(REASON_A); await settle(400);
    check('S1 A types an unsaved Pass reason on the real Seller Call: kept under one-login:tagA only',
      (await keysOf(TAG_A)).some((k) => k.startsWith('iaos-contact-draft:') && k.includes('outcome')) && (await keys()).every((k) => !k.includes('this-browser') && !k.includes('%40')), await keys());
    await load(null); await signedIn(); await scOpen();
    check('S2 reload: A\'s Pass form is back with A\'s reason', (await reason()) === REASON_A, await reason());
    as('tagA', 'sessA5'); await recheck(); await settle(800);
    check('S3 same-account re-authentication: the reason stays, no account-changed notice, nothing removed',
      (await reason()) === REASON_A && (await page.getByTestId('one-login-account-changed').count()) === 0 && removedOf(TAG_A) === 0);
    as('tagB', 'sessB2'); await recheck();
    await until(async () => (await page.getByTestId('one-login-account-changed').count()) > 0, 'account changed (Seller Call)');
    check('S4 A->B: A\'s reason is nowhere in B\'s page while the notice is up', !(await bodyHas(REASON_A)));
    await page.getByTestId('one-login-account-continue').click(); await scOpen();
    check('S4 B\'s Seller Call holds none of A\'s reason; A\'s draft key was not removed', ((await reason()) ?? '') !== REASON_A && !(await bodyHas(REASON_A)) && removedOf(TAG_A) === 0);
    await openPass(); await page.getByTestId('call-outcome-pass-reason').fill(REASON_B); await settle(400);
    check('S5 B\'s own reason is kept under one-login:tagB', (await keysOf(TAG_B)).some((k) => k.startsWith('iaos-contact-draft:') && k.includes('outcome')));
    as('tagA', 'sessA6'); await load(null); await signedIn(); await scOpen();
    check('S6 back to A (reload): A\'s reason is intact and B\'s is not shown', (await reason()) === REASON_A && !(await bodyHas(REASON_B)), await reason());

    // ── Legacy drafts (stored before one sign-in) ──────────────────────────────
    // Copies of A's current drafts re-keyed (and re-labelled) to the two pre-One-Login owners, with LEGACY values.
    const seeded = await page.evaluate(([tag]) => {
      const out = [];
      for (const k of Object.keys(localStorage)) {
        if (!/^iaos-(calculator|contact)-draft:/.test(k) || !k.includes(tag)) continue;
        for (const owner of ['this-browser', 'operator-a@example.invalid']) {
          const nk = k.split(tag).join(encodeURIComponent(owner)).split('one-login:tagA').join(owner);
          const text = localStorage.getItem(k).split('one-login:tagA').join(owner).replace(/333000/g, '999111').replace(/R2 operator A unsaved pass reason/g, 'LEGACY pre-one-login reason');
          localStorage.setItem(nk, text); out.push(nk);
        }
        localStorage.removeItem(k);   // A has no current draft now; only the legacy copies remain
      }
      return out;
    }, [TAG_A]);
    removals.length = 0;
    as('tagA', 'sessA7'); await load(null); await signedIn(); await dcOpen();
    const dcShown = await arv().inputValue();
    await scOpen();
    const reasonShown = await reason();
    check('L1 legacy drafts (e-mail / "this-browser" owners) are NOT shown under one-login:tagA on the Deal Calculator or the Seller Call',
      seeded.length >= 4 && dcShown !== '999111' && !(await bodyHas('999111')) && (reasonShown ?? '') !== 'LEGACY pre-one-login reason' && !(await bodyHas('LEGACY pre-one-login reason')),
      { seeded: seeded.length, dcShown, reasonShown });
    const left = await keys();
    check('L2 legacy drafts are NOT deleted: every seeded key is still stored and none was removed', seeded.every((k) => left.includes(k)) && removals.filter((k) => seeded.includes(k)).length === 0,
      { missing: seeded.filter((k) => !left.includes(k)), removed: removals });
    const reattributed = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('one-login%3AtagA')).some((k) => /999111|LEGACY pre-one-login reason/.test(localStorage.getItem(k) || '')));
    check('L3 legacy values are NOT re-attributed to the current operator: no one-login:tagA record carries them', !reattributed);

    check('W no ghl-write was sent during the whole suite (drafts only)', ctx.writes().length === 0, ctx.writes().slice(0, 3));
  },
});
