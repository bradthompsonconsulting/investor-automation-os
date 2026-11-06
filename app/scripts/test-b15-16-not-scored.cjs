/**
 * B15-16 (INV-116) -- a contact with no temperature tag has not been scored: it is shown as "Not scored", never as
 * "Low". Captain decision 2026-11-06: DISPLAY ONLY -- the Lead Queue order is unchanged (getBucketTag still places
 * untagged contacts with Low), and nothing is read or written that was not before.
 *
 * Offline: the REAL Dashboard and ContactWorkspace (scripts/harness/dashboard-callback-popover, unchanged), every
 * /.netlify/functions request answered here from fictional fixtures; any write is counted and refused.
 *
 *   D1  tier pills: Hot 1, Warm 1, Low 2 (tagged only), Not scored 4 (no tag; one without a phone).
 *   D2  the count note names Not scored, not "Low includes"; D2b r2: it makes no claim about where the Lead Queue
 *       lists them (Bones REVISE on 35810ff: the unchanged comparator does not put untagged contacts after Low).
 *   D3  Lead Queue tier column: tagged contacts show Hot / Warm / Low; untagged ones show "Not scored", none "Low".
 *   D4  Lead Queue ORDER is exactly the existing comparator's order -- also checked on the negative control, where it
 *       must still pass. r2: it includes an untagged contact with an overdue mailer, which the comparator lists
 *       ABOVE a tagged Low contact without one (overdue mail bubbles to the top of its tier band).
 *   C1  Contact page header: an untagged contact shows "Not scored"; Hot and Low contacts show Hot and Low.
 *   W   no write is attempted; no request leaves the machine; no page errors.
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s ghl.ts, Dashboard.tsx and ContactWorkspace.tsx (in memory); with
 * --before=16bcf12 the display checks (D1-D3, C1) must FAIL and D4 must PASS.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/dashboard-callback-popover/index.html';
require(path.join(APP, 'scripts/harness/ts-loader.cjs'));
const { createBarrierFixture } = require(path.join(APP, 'scripts/harness/current-offer-barrier-fixture.cjs'));

const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const SWAP = ['src/lib/ghl.ts', 'src/pages/Dashboard.tsx', 'src/pages/ContactWorkspace.tsx'];
const before = {
  name: 'b15-16-before', enforce: 'pre',
  load(id) {
    if (!BEFORE) return null;
    const file = path.resolve(id.split('?')[0]);
    const rel = SWAP.find((r) => path.resolve(APP, r) === file);
    return rel ? execFileSync('git', ['show', `${BEFORE}:app/${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }) : null;
  },
};

let checks = 0, failures = 0;
const FLOOR = 14;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

/* Fictional contacts, in the order the contacts read returns them. Tier/score -> expected Lead Queue position. */
const PEOPLE = [
  { id: 'fxHot', first: 'Hana', tags: ['hot'], score: 80 },
  { id: 'fxWarm', first: 'Wes', tags: ['warm'], score: 60 },
  { id: 'fxLowA', first: 'Lou', tags: ['low'], score: 30 },
  { id: 'fxLowB', first: 'Lia', tags: ['low', 'seller-lead'], score: null },
  { id: 'fxNone1', first: 'Nia', tags: ['seller-lead'], score: null },
  { id: 'fxNone2', first: 'Ned', tags: [], score: null },
  { id: 'fxNoPhone', first: 'Pat', tags: [], score: null, phone: '' },
  // r2: untagged, with an overdue mailer task -> the existing comparator lists it above the tagged Low contacts.
  { id: 'fxNoneOverdue', first: 'Ola', tags: [], score: null },
];
const byId = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
/* The Contact page reads its call-log status from the real barrier module (as the original harness suite does). */
const bf = createBarrierFixture({ contactOf: () => null });
const row = (p) => ({ id: p.id, firstName: p.first, lastName: 'Example', phone: p.phone ?? '+15555550142', email: '', address1: '123 Example St',
  city: 'Sampletown', state: 'TX', postalCode: '75000', dateAdded: '2026-09-01T00:00:00.000Z', tags: p.tags, dndSettings: {},
  motivationScore: p.score, dealScore: p.score, combinedScore: p.score, completenessScore: null, callbackDatetime: null,
  callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
const OVERDUE_TASK = { taskId: 'task-ola', contactId: 'fxNoneOverdue', contactName: 'Ola Example', address: '123 Example St', hasAddress: true, tier: 'low',
  mailerType: 'Primary', touchNumber: 2, dueDate: '2026-10-20T15:00:00.000Z', dueDateCT: '2026-10-20', completed: false, hasBusinessName: false, companyName: null };
const MAILERS = { weekStartCT: '2026-10-31', weekEndCT: '2026-11-06', thisWeekReady: [], thisWeekBusiness: [],
  overdue: [{ key: 'overdue-low', label: 'Overdue', rows: [OVERDUE_TASK] }], noAddress: [],
  totals: { ready: 0, business: 0, overdue: 1, noAddress: 0, byMailerType: {} } };
function answer(u) {
  const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, '');
  if (fn === 'ghl-contacts') return PEOPLE.map(row);
  if (fn === 'ghl-contact') { const p = byId[u.searchParams.get('id')]; return p ? row(p) : undefined; }
  if (fn === 'ghl-opportunities') return { pipelineId: 'fixture-pipeline', stages: [], opportunities: [] };
  if (fn === 'ghl-conversations') return [];
  if (fn === 'ghl-mailers') return MAILERS;
  if (fn === 'ghl-underwriting-policy') return { values: [] };
  if (fn === 'ghl-contact-conversations') return { messages: [], conversations: [] };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || ''; let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return byId[m[1]] ? { notes: [] } : undefined;
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return byId[m[1]] ? { contact: { id: m[1], firstName: byId[m[1]].first, lastName: 'Example', phone: '+15555550142', dndSettings: {}, customFields: [] } } : undefined;
    if (/\/customFields\/[^/]+$/.test(p)) return { customField: { id: 'folder', name: 'Folder', position: 0 } };
    if (/\/customFields$/.test(p)) return { customFields: [] };
  }
  return undefined;
}

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
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      if (req.method() === 'GET' && url.includes('/call-log-barrier')) { const res = await bf.handleCallLog('GET', url, null); return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) }); }
      if (req.method() !== 'GET') { writes.push(url.replace(base, '')); return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'offline test: refused', outcome: 'not_sent' }) }); }
      const body = answer(new URL(url));
      if (body === undefined) { unmodelled.push(url.replace(base, '')); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unmodelled"}' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
    await page.goto(`${base}${HARNESS}`);
    await until(async () => (await page.getByTestId('dashboard-count-notes').count()) > 0);

    // D1 / D2 -- the temperature strip and its note.
    const strip = await page.evaluate(() => {
      const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Contacts by temperature');
      if (!label) return null;
      const out = []; let el = label.nextElementSibling;
      while (el && el.textContent.trim() !== '' && !/Deals by stage/.test(el.textContent)) { out.push(el.textContent.trim()); el = el.nextElementSibling; }
      return out;
    });
    check('D1 tier pills count tagged contacts by their tier and untagged ones as Not scored', JSON.stringify(strip) === JSON.stringify(['Hot 1', 'Warm 1', 'Low 2', 'Not scored 4']), strip);
    const note = (await page.getByTestId('dashboard-count-notes').innerText()).replace(/\s+/g, ' ');
    check('D2 the count note names Not scored (4), not "Low includes"', /Not scored is 4 with no temperature tag yet/.test(note) && !/Low includes/.test(note), note.slice(0, 160));
    check('D2b r2: the note makes no claim about where the Lead Queue lists them (no "after Low")', !/after Low|lists them/i.test(note), note.slice(0, 200));

    // D3 / D4 -- the Lead Queue table (the one with a Tier column).
    await until(async () => (await page.evaluate(() => [...document.querySelectorAll('table')].some((t) => [...t.querySelectorAll('th')].some((h) => h.textContent.trim() === 'Tier') && t.querySelectorAll('tbody tr td').length > 8))));
    const queue = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => [...x.querySelectorAll('th')].some((h) => h.textContent.trim() === 'Tier'));
      const heads = [...t.querySelectorAll('th')].map((h) => h.textContent.trim());
      const ti = heads.indexOf('Tier');
      return [...t.querySelectorAll('tbody tr')].map((tr) => { const td = tr.querySelectorAll('td'); return { name: td[0].textContent.trim(), tier: td[ti] ? td[ti].textContent.trim() : null }; });
    });
    const tierOf = (first) => (queue.find((r) => r.name.includes(first)) || {}).tier;
    check('D3 Lead Queue: Hot, Warm and both Low contacts show their tier', tierOf('Hana') === 'Hot' && tierOf('Wes') === 'Warm' && tierOf('Lou') === 'Low' && tierOf('Lia') === 'Low', queue);
    check('D3 Lead Queue: the untagged contacts show "Not scored"', tierOf('Nia') === 'Not scored' && tierOf('Ned') === 'Not scored' && tierOf('Ola') === 'Not scored', queue);
    check('D3 Lead Queue: no untagged contact is labelled Low', !queue.some((r) => (r.name.includes('Nia') || r.name.includes('Ned') || r.name.includes('Ola')) && r.tier === 'Low'));
    check('D3 Lead Queue: the contact without a phone is not listed (filter unchanged)', !queue.some((r) => r.name.includes('Pat')));
    const order = queue.map((r) => r.name.split(' ')[0]);
    check('D4 Lead Queue order is the existing comparator\'s: Hot, Warm, then the Low band with its overdue-mailer contact first (untagged Ola above tagged Lou/Lia), then by score (stable)', JSON.stringify(order) === JSON.stringify(['Hana', 'Wes', 'Ola', 'Lou', 'Lia', 'Nia', 'Ned']), order);

    // C1 -- the Contact page header badge.
    const headerTier = async (id) => {
      await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${id}`);
      await until(async () => (await page.getByTestId('identity-scores').count()) > 0 && (await page.getByTestId('identity-scores').innerText()).length > 0);
      await page.waitForTimeout(300);
      return (await page.getByTestId('identity-scores').innerText()).split('\n')[0].trim();
    };
    const c1 = await headerTier('fxNone1');
    check('C1 Contact page: an untagged contact shows "Not scored"', /^Not scored/.test(c1), c1);
    const c2 = await headerTier('fxHot');
    check('C1 Contact page: a Hot contact shows Hot', /^Hot/.test(c2), c2);
    const c3 = await headerTier('fxLowA');
    check('C1 Contact page: a Low contact shows Low', /^Low/.test(c3), c3);

    check('W no write was attempted', writes.length === 0, writes);
    check('W no request left the machine; no unmodelled reads', foreign.length === 0 && unmodelled.length === 0, { foreign: foreign.slice(0, 3), unmodelled: unmodelled.slice(0, 5) });
    check('W no page errors', pageErrors.length === 0, pageErrors.slice(0, 3));
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-16 Not scored: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
