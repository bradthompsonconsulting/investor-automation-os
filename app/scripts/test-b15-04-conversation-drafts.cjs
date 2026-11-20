/**
 * B15-04 (Captain GO 2026-11-19, Scotty plan 2026-11-15 §3) -- the Seller Call conversation answers survive a reload,
 * a closed tab and a visit to another seller, kept per deal and per operator in the accepted B15-27b draft store
 * (lib/contact-drafts, scope "conversation"). Offline, rendered: the REAL Seller Call page (scripts/harness/b15-27b,
 * fixture twoContacts); every /.netlify/functions request is answered locally; every write is counted.
 *
 *   A1  choose the "inbound" opening and answer it, mark Address "Seller doesn't know", skip Ownership, add call notes:
 *       the Summary shows those answers; the page is left on Occupancy
 *   A2  reload: the same answers, marks, opening, call notes, current question and Summary; 0 writes
 *   A3  the tab closed and the call opened again: the document is unloaded (about:blank), this tab's sessionStorage is
 *       cleared, and a fresh document loads (the runner routes one page, so a second Playwright tab would have no
 *       fixture; this reproduces what a new tab of the same browser sees: no JS state, no sessionStorage, the same
 *       localStorage): the answers are back
 *   A4  leave for seller B (B's contact page, then B's Seller Call): B's conversation is empty and none of A's text is
 *       in the DOM; back to A's Seller Call: A's answers are back
 *   A5  account switch on the open page (operator-one -> operator-two): none of A's answers; operator-one's draft is
 *       not removed; back to operator-one: the answers are back
 *   A6  a corrupted or foreign stored record (unknown question id; a non-string answer value; deal 2's record stored
 *       under deal 1's key) is refused: an empty conversation, no page error, nothing partly applied
 *   A7  saving disabled (the committed configuration): Save at Summary reads "Saving not enabled" and is disabled; the
 *       draft persists through a reload; 0 writes
 *   D1  two deals of the SAME seller: answers on deal 1 never show on deal 2; deal 1's come back after a reload
 *   W   no write in the whole suite (plus the runner's: nothing left the machine, no page errors)
 */
'use strict';
const { run, twoContacts, A, B } = require('./harness/b15-27b/runner.cjs');

const PREFIX = 'iaos-contact-draft:v1:conversation|';
const OPEN_TEXT = 'Fixture: open to talking, inherited the house';
const NOTES_TEXT = 'Fixture call notes: prefers mornings';
const D2_TEXT = 'Fixture deal two answer';

run({
  title: 'B15-04 Seller Call conversation drafts',
  floor: 17,
  fixture: twoContacts(),
  scenarios: async (ctx) => {
    const { page, check, fresh, load, go, settle, until } = ctx;
    const T = (id) => page.getByTestId(id);
    const ready = async (contact) => {
      await page.locator(`[data-testid="seller-conversation"][data-deal^="${contact}|"]`).waitFor({ timeout: 60000 });
      await settle(400);
    };
    const pickDeal = async (name) => { const b = page.getByRole('button', { name, exact: true }); await b.waitFor({ timeout: 30000 }); await b.click(); };
    const stored = () => page.evaluate((p) => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith(p)).sort().map((k) => [k, localStorage.getItem(k)])), PREFIX);
    /** What the operator sees: current question, status chips, call notes, opening (+ its text) and the Summary. */
    const snapshot = async () => {
      const current = await T('sc-card').getAttribute('data-question');
      const statuses = await page.locator('[data-testid^="sc-status-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}=${e.textContent.trim()}`));
      const notes = await T('sc-call-notes').inputValue().catch(() => null);
      await T('sc-nav-opening').click(); await settle(150);
      const opening = await page.locator('[data-testid^="sc-opening-"][aria-pressed="true"]').getAttribute('data-testid').catch(() => null);
      const openText = await T('sc-field-opening-response').inputValue().catch(() => null);
      await T('sc-nav-summary').click(); await settle(150);
      const summary = (await T('sc-card').innerText()).replace(/\s+/g, ' ');
      if (current) { await T(`sc-nav-${current}`).click(); await settle(300); }
      return { current, statuses, notes, opening, openText, summary };
    };
    const typeA = async () => {
      await T('sc-nav-opening').click();
      await T('sc-opening-inbound').click();
      await T('sc-field-opening-response').fill(OPEN_TEXT);
      await T('sc-next').click();          // Address
      await T('sc-dont-know').click();     // marks Address, moves to Ownership
      await T('sc-skip').click();          // marks Ownership, moves to Occupancy
      await T('sc-call-notes').fill(NOTES_TEXT);
      await settle(500);
    };
    const isEmpty = (s) => s.current === 'opening' && s.openText === '' && s.notes === '' && s.opening === 'sc-opening-cold' && !s.summary.includes(OPEN_TEXT);
    const aTextShown = async () => { const t = await ctx.allText(); return t.includes(OPEN_TEXT) || t.includes(NOTES_TEXT); };

    // ── A1 ──
    await fresh({}, `/contacts/${A}/seller-call`);
    await ready(A);
    await typeA();
    const s1 = await snapshot();
    check('A1 answers entered: on Occupancy, opening "inbound" with its text, Address "Seller doesn\'t know", Ownership skipped, call notes; the Summary shows the opening answer',
      s1.current === 'occupancy' && s1.opening === 'sc-opening-inbound' && s1.openText === OPEN_TEXT && s1.notes === NOTES_TEXT
      && s1.statuses.some((x) => /^sc-status-address=.*know/i.test(x)) && s1.statuses.some((x) => /^sc-status-ownership=Skipped/i.test(x)) && s1.summary.includes(OPEN_TEXT), s1);

    // ── A2: reload ──
    await load(`/contacts/${A}/seller-call`);
    await ready(A);
    const s2 = await snapshot();
    check('A2 after a reload: the same answers, marks, opening, call notes, current question and Summary', JSON.stringify(s2) === JSON.stringify(s1), { s1, s2 });

    // ── A3: tab closed, call opened again ──
    await page.goto('about:blank');
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* about:blank */ } }).catch(() => {});
    await load(`/contacts/${A}/seller-call`);
    await page.evaluate(() => sessionStorage.clear());
    await load(`/contacts/${A}/seller-call`);
    await ready(A);
    const s3 = await snapshot();
    check('A3 the tab closed and the call opened again (new document, no sessionStorage): the same answers and current question', JSON.stringify(s3) === JSON.stringify(s1), { s1, s3 });

    // ── A4: another seller and back ──
    await go(`/contacts/${B}`);
    await until(async () => (await ctx.allText()).includes('Bravo'), 'B contact page');
    await go(`/contacts/${B}/seller-call`);
    await ready(B);
    const sB = await snapshot();
    check('A4 seller B\'s conversation is empty and none of A\'s text is anywhere in the page', isEmpty(sB) && !(await aTextShown()), sB);
    await go(`/contacts/${A}`);
    await until(async () => (await ctx.allText()).includes('Alpha'), 'A contact page');
    await go(`/contacts/${A}/seller-call`);
    await ready(A);
    const s4 = await snapshot();
    check('A4 back on A\'s Seller Call: A\'s answers are back', JSON.stringify(s4) === JSON.stringify(s1), { s1, s4 });

    // ── A5: account switch on the open page ──
    const before5 = await stored();
    await ctx.setOperator('operator-two');
    await settle(800);
    const s5 = await snapshot();
    const after5 = await stored();
    check('A5 operator-two (account switch on the open page) sees none of operator-one\'s answers', isEmpty(s5) && !(await aTextShown()), s5);
    check('A5 operator-one\'s stored draft is not removed by the switch', Object.keys(before5).some((k) => k.includes('|operator-one|')) && Object.keys(before5).filter((k) => k.includes('|operator-one|')).every((k) => after5[k] === before5[k]), { before5: Object.keys(before5), after5: Object.keys(after5) });
    await ctx.setOperator('operator-one');
    await settle(800);
    const s5b = await snapshot();
    check('A5 back to operator-one: the answers are back', JSON.stringify(s5b) === JSON.stringify(s1), { s1, s5b });

    // ── A7: saving disabled (as committed) ──
    await T('sc-nav-summary').click(); await settle(200);
    const saveBtn = { text: (await T('sc-save').textContent().catch(() => null))?.trim() ?? null, disabled: await T('sc-save').isDisabled().catch(() => null) };
    await T('sc-nav-occupancy').click(); await settle(300);
    await load(`/contacts/${A}/seller-call`);
    await ready(A);
    const s7 = await snapshot();
    check('A7 saving disabled: Save at Summary reads "Saving not enabled" and is disabled, and the draft persists through a reload',
      saveBtn.text === 'Saving not enabled' && saveBtn.disabled === true && JSON.stringify(s7) === JSON.stringify(s1), { saveBtn, s7 });

    // ── A6: corrupted or foreign stored records ──
    const good = await stored();
    const aKey = Object.keys(good).find((k) => k.includes('|operator-one|') && k.includes(`|${A}|`));
    check('A6 setup: operator-one\'s draft for A\'s deal is stored under the conversation scope (env|operator|contact|deal)', !!aKey && /\|fixtureContactA\|fixtureContactA-opp$/.test(aKey), Object.keys(good));
    const variants = {
      unknownQuestion: (r) => { const v = JSON.parse(r.values.v); v.answers.not_a_question = { fields: { x: 'INJECTED-UNKNOWN' }, mark: null }; r.values.v = JSON.stringify(v); return r; },
      nonStringValue: (r) => { const v = JSON.parse(r.values.v); v.answers.opening = { fields: { response: 12345 }, mark: null }; v.notes = 'INJECTED-NONSTRING'; r.values.v = JSON.stringify(v); return r; },
      otherDealRecord: (r) => { r.identity = { ...r.identity, opportunityId: `${A}-opp-2` }; r.values.v = r.values.v.replace(OPEN_TEXT, 'INJECTED-OTHER-DEAL'); return r; },
    };
    const a6 = {};
    for (const [name, mutate] of Object.entries(aKey ? variants : {})) {   // no stored record (main): nothing to corrupt
      const rec = mutate(JSON.parse(good[aKey]));
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [aKey, JSON.stringify(rec)]);
      const errs = ctx.pageErrors.length;
      await load(`/contacts/${A}/seller-call`);
      await ready(A);
      const s = await snapshot();
      a6[name] = { empty: isEmpty(s), injected: (await ctx.allText()).includes('INJECTED'), pageErrors: ctx.pageErrors.length - errs };
    }
    if (aKey) await page.evaluate(([k, v]) => localStorage.setItem(k, v), [aKey, good[aKey]]);
    check('A6 every corrupted or foreign record is refused: an empty conversation, nothing injected shown, no page error',
      Object.keys(a6).length === 3 && Object.values(a6).every((x) => x.empty && !x.injected && x.pageErrors === 0), a6);

    check("W1 A1-A7: no write at all (typing, marks, navigation, reloads, seller and account switches)", ctx.writes().length === 0, ctx.opsFor());

    // ── D1: two deals of the same seller ──
    await fresh({ aDeals: 2 }, `/contacts/${A}/seller-call`);
    await pickDeal('Alpha deal');
    await ready(A);
    await typeA();
    const d1a = await snapshot();
    await load(`/contacts/${A}/seller-call`);
    await pickDeal('Alpha deal 2');
    await ready(A);
    const d2 = await snapshot();
    const d2empty = isEmpty(d2) && !(await aTextShown());
    await T('sc-nav-opening').click(); await T('sc-field-opening-response').fill(D2_TEXT); await settle(500);
    await load(`/contacts/${A}/seller-call`);
    await pickDeal('Alpha deal');
    await ready(A);
    const d1b = await snapshot();
    const d1noD2 = !(await ctx.allText()).includes(D2_TEXT);
    check('D1 two deals of the same seller: deal 2 starts empty (none of deal 1\'s text); deal 1\'s answers come back after a reload, without deal 2\'s',
      d2empty && JSON.stringify(d1b) === JSON.stringify(d1a) && d1noD2, { d2, d1a, d1b, d1noD2 });
    const dKeys = Object.keys(await stored());
    check('D1 each deal has its own stored record (keys end in -opp and -opp-2)', dKeys.some((k) => k.endsWith(`|${A}|${A}-opp`)) && dKeys.some((k) => k.endsWith(`|${A}|${A}-opp-2`)), dKeys);

    check('W2 D1: no write', ctx.writes().length === 0, ctx.opsFor());
  },
}).catch((e) => { console.error(e); process.exit(1); });
