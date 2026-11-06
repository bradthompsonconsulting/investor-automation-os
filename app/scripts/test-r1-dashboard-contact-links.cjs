/**
 * R1 (Board #15 Captain walkthrough) -- every Dashboard list links an IDENTIFIABLE contact's name to that contact.
 *
 * Offline: the REAL Dashboard and ContactWorkspace (scripts/harness/dashboard-callback-popover, unchanged); every
 * /.netlify/functions request is answered here from fictional fixtures; any write is counted and refused.
 *
 *   L1-L7  the name is a link to /contacts/<id> in: Tasks due today, Offers to review, Unanswered Inbound, Callbacks
 *          (overdue and due today), Follow Up and Offers Awaiting Response
 *   L8     an Unanswered Inbound thread with NO contact id keeps a plain name (nothing is guessed)
 *   L9     Needs Next Step (needs a recorded call result to populate): its name span is the same ContactLink (source)
 *   N1     clicking a list name opens that contact's workspace; nothing is written
 *   W      no write, no foreign request, no page error
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Dashboard.tsx; with the base 9e8c8fd, L1-L7, L9 and N1 must FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
require(path.join(APP, 'scripts/harness/ts-loader.cjs'));
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const CFG = getConfig('test');
const { createBarrierFixture } = require(path.join(APP, 'scripts/harness/current-offer-barrier-fixture.cjs'));
const HARNESS = '/scripts/harness/dashboard-callback-popover/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const PAGE = path.join(APP, 'src/pages/Dashboard.tsx');
const before = { name: 'r1-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/Dashboard.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };

let checks = 0, failures = 0;
const FLOOR = 12;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const at = (dayOffset, hour) => { const d = new Date(`${TODAY}T00:00:00-06:00`); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(hour + 6, 0, 0, 0); return d.toISOString(); };
const P = {
  tsk: { first: 'Tasha', tags: [] },
  ofr: { first: 'Oren', tags: [] },
  una: { first: 'Uma', tags: [] },
  cbo: { first: 'Cora', tags: [], callback: at(-3, 10) },
  cbt: { first: 'Cal', tags: [], callback: at(0, 22) },
  fup: { first: 'Faye', tags: [] },
  ofa: { first: 'Otto', tags: ['offer-made'] },
};
const row = (id) => { const p = P[id]; return { id, firstName: p.first, lastName: 'Example', phone: '', email: '', address1: '1 Example St', city: 'Sampletown', state: 'TX', postalCode: '75000',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: p.tags, dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: p.callback ?? null, callbackDatetimePrecise: p.callback ?? null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null }; };
const OFFER_SENT = 'fixture-offer-sent';
const opp = (cid, stageId, offer) => ({ id: `${cid}-opp`, contactId: cid, contactName: P[cid].first, opportunityName: `${P[cid].first} deal`, phone: '', email: '', stageId,
  customFields: offer ? [{ id: CFG.opportunityFacts.currentOffer, fieldValueNumber: offer }] : [] });
const PIPELINE = { pipelineId: 'fixture-pipeline', stages: [{ id: OFFER_SENT, name: 'Seller Offer Sent' }, { id: CFG.stages.sellerFollowUp, name: 'Seller Follow Up' }],
  opportunities: [opp('ofr', 'fixture-stage', 250000), opp('fup', CFG.stages.sellerFollowUp), opp('ofa', OFFER_SENT, 260000)] };
const TASK = { taskId: 'task-1', contactId: 'tsk', contactName: 'Tasha Example', address: '', hasAddress: false, tier: 'low', mailerType: 'Letter', touchNumber: 2, dueDate: `${TODAY}T15:00:00.000Z`, dueDateCT: TODAY, completed: false, hasBusinessName: false, companyName: null };
const MAILERS = { weekStartCT: TODAY, weekEndCT: TODAY, thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [TASK], totals: { ready: 0, business: 0, overdue: 0, noAddress: 1, byMailerType: {} } };
const UNANSWERED = [
  { conversationId: 'conv-una', contactId: 'una', contactName: 'Uma Example', phone: '+15555550142', email: '', lastMessageDate: Date.parse(at(-1, 9)), preview: 'Is this still open?', unreadCount: 1 },
  { conversationId: 'conv-anon', contactId: '', contactName: 'Unknown Sender', phone: '+15555550199', email: '', lastMessageDate: Date.parse(at(-2, 9)), preview: 'Who is this?', unreadCount: 1 },
];
const bf = createBarrierFixture({ contactOf: () => null });

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/dashboard-callback-popover/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const writes = [], foreign = [], unmodelled = [], pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, ''); const id = u.searchParams.get('id') || '';
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.method() === 'GET' && fn === 'call-log-barrier') { const x = await bf.handleCallLog('GET', url, null); return json(x.status, x.body); }
      if (req.method() !== 'GET') { writes.push(fn); return json(409, { error: 'offline test: refused', outcome: 'not_sent' }); }
      if (fn === 'ghl-contacts') return json(200, Object.keys(P).map(row));
      if (fn === 'ghl-contact') return P[id] ? json(200, row(id)) : json(404, { error: 'unknown' });
      if (fn === 'ghl-opportunities') return json(200, PIPELINE);
      if (fn === 'ghl-conversations') return json(200, u.searchParams.get('scope') === 'all' ? [] : UNANSWERED);
      if (fn === 'ghl-mailers') return json(200, MAILERS);
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-contact-conversations') return json(200, { contactId: id, conversationCount: 0, messages: [] });
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path') || ''; let m;
        if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return json(200, { notes: [] });
        if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return json(200, { contact: { id: m[1], firstName: P[m[1]]?.first ?? 'X', lastName: 'Example', phone: '+15555550142', dndSettings: {}, customFields: [] } });
        if (/\/customFields\/[^/]+$/.test(p)) return json(200, { customField: { id: 'folder', name: 'Folder', position: 0 } });
        if (/\/customFields$/.test(p)) return json(200, { customFields: [] });
      }
      unmodelled.push(`${fn}${u.search}`); return json(404, { error: 'unmodelled' });
    });
    const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
    await page.goto(`${base}${HARNESS}`);
    await until(async () => (await page.getByText('Otto Example').count()) > 0 && (await page.getByText('Uma Example').count()) > 0);
    for (const tile of ['Tasks due today', 'Offers to review']) {
      const t = page.locator('button', { hasText: tile }).first();
      if (await t.count()) { await t.click(); await page.waitForTimeout(300); }
    }
    /** Every element showing exactly `text`: is it (or an ancestor) a link, and where does it go? */
    /* Outside the Lead Queue table (its names were already links), so a pass is the list under test. */
    const linkOf = (text) => page.evaluate((t) => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === t && !e.closest('table'))
      .map((e) => { const a = e.closest('a'); return a ? new URL(a.href).pathname.replace(/^.*\/contacts\//, '/contacts/') : null; }), text);
    // The two tiles expand one at a time: read Tasks with its tile open, then Offers to review.
    await page.locator('button', { hasText: 'Tasks due today' }).first().click(); await page.waitForTimeout(300);
    const tasha = await linkOf('Tasha Example');
    await page.locator('button', { hasText: 'Offers to review' }).first().click(); await page.waitForTimeout(300);
    const oren = await linkOf('Oren Example');
    check('L1 Tasks due today: the task contact name links to the contact', tasha.includes('/contacts/tsk'), tasha);
    check('L2 Offers to review: the name links to the contact', oren.includes('/contacts/ofr'), oren);
    check('L3 Unanswered Inbound: an identified thread\'s name links to the contact', (await linkOf('Uma Example')).includes('/contacts/una'), await linkOf('Uma Example'));
    check('L4 Callbacks overdue: the name links to the contact', (await linkOf('Cora Example')).includes('/contacts/cbo'), await linkOf('Cora Example'));
    check('L5 Callbacks due today: the name links to the contact', (await linkOf('Cal Example')).includes('/contacts/cbt'), await linkOf('Cal Example'));
    check('L6 Follow Up: the name links to the contact', (await linkOf('Faye Example')).includes('/contacts/fup'), await linkOf('Faye Example'));
    check('L7 Offers Awaiting Response: the name links to the contact', (await linkOf('Otto Example')).includes('/contacts/ofa'), await linkOf('Otto Example'));
    const anon = await linkOf('Unknown Sender');
    check('L8 an Unanswered Inbound thread with no contact id keeps a plain name (no guessed link)', anon.length > 0 && anon.every((x) => x === null), anon);
    const src = BEFORE ? execFileSync('git', ['show', `${BEFORE}:app/src/pages/Dashboard.tsx`], { cwd: APP, encoding: 'utf8' }) : fs.readFileSync(PAGE, 'utf8');
    const needs = src.slice(src.indexOf('Needs Next Step</SectionHeading>'), src.indexOf('Follow Up</SectionHeading>'));
    check('L9 Needs Next Step: its name is the same ContactLink (source; the list needs a recorded call result to populate)', /<ContactLink id=\{c\.id\}>\{contactName\(c\)\}<\/ContactLink>/.test(needs), needs.length);
    // N1 -- clicking a name opens the workspace; nothing written.
    const before0 = writes.length;
    const link = page.locator('a', { hasText: 'Cora Example' }).first();
    if (await link.count()) await link.click();
    await until(async () => (await page.evaluate(() => location.pathname)).endsWith('/contacts/cbo'), 8000);
    check('N1 clicking a list name opens that contact\'s workspace; nothing is written', (await page.evaluate(() => location.pathname)).endsWith('/contacts/cbo') && writes.length === before0, await page.evaluate(() => location.pathname));
    check('W no write; no foreign request; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
    check('W no unmodelled read', unmodelled.length === 0, unmodelled.slice(0, 5));
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nR1 Dashboard contact links: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
