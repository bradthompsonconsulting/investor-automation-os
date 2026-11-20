/**
 * B15-08 (Spock G5 finding 2; Captain GO 2026-11-19) -- the Dashboard's Unanswered Inbound row tells the operator to
 * "open the conversation"; the row now links to THAT conversation. The link reuses the existing Conversations route
 * (/conversations) with the row's own GHL conversation id; Conversations selects the matching thread from its own
 * existing thread list (the same ghl-conversations read, ?scope=all) -- no new read, no write.
 *
 * Offline: the REAL App (scripts/harness/app-routes: its own router, Layout, Dashboard and Conversations); every
 * /.netlify/functions request is answered here from fictional fixtures. Two synthetic sellers, Ada and Bo, plus an
 * unrelated thread Cy; each thread's seller text is unique, so the open thread is identified by what it shows.
 *
 *   L1  each Dashboard row has an "Open conversation" link to /conversations?conversation=<its own conversation id>
 *   O1  Ada's link opens Conversations with Ada's thread selected: Ada's words, Ada's messages read, nobody else's
 *   O2  back on the Dashboard, Bo's link opens Bo's thread: Bo's words, never Ada's
 *   O3  a direct visit / reload of Bo's link selects Bo's thread again
 *   M1  a conversation id not in the list: says so plainly and selects nothing (no guess)
 *   M2  (Bones REVISE R1) Cy's thread open, then the SAME mounted page is routed to a missing id: the notice shows, no
 *       thread is selected, and Cy's message is gone (no document load; the thread list is not re-read)
 *   N1  plain /conversations (the sidebar route) is unchanged: nothing selected
 *   S1  after arriving by link, choosing another thread by hand works (the link does not override it)
 *   P1  the row keeps its preview wording and the contact-name link to the workspace (R1)
 *   W   reads only; no new read kind; nothing left the machine; no page errors
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s App (AppBefore.tsx) with its Dashboard and Conversations; with main
 * c026442, L1 and O1-O3, M1 and S1 must FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/app-routes');
const HARNESS = '/scripts/harness/app-routes/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const PAGES = { [path.join(APP, 'src/pages/Dashboard.tsx')]: 'app/src/pages/Dashboard.tsx', [path.join(APP, 'src/pages/Conversations.tsx')]: 'app/src/pages/Conversations.tsx' };
const before = { name: 'b15-08-link-before', enforce: 'pre', load(id) {
  const rel = BEFORE && PAGES[path.resolve(id.split('?')[0])];
  return rel ? execFileSync('git', ['show', `${BEFORE}:${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }) : null;
} };
/** Literal check() call sites: L1, O1-O3, M1, M2, N1, S1, P1, W = 10. */
const FLOOR = 10;
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 500)}`}`); }
if (fs.existsSync(path.join(HARNESS_DIR, 'AppBefore.tsx'))) fs.rmSync(path.join(HARNESS_DIR, 'AppBefore.tsx'));

const T = (m) => new Date(Date.UTC(2026, 10, 5, 15, m)).toISOString();
const WORDS = { ada: 'Ada here: the roof leaks, call me Tuesday', bo: 'Bo here: yes, still selling the duplex', cy: 'Cy here: unrelated thread' };
const contactRow = (id, first) => ({ id, firstName: first, lastName: 'Fixture', phone: '+15555550142', email: '', address1: '1 Example St', city: 'Sampletown', state: 'TX', postalCode: '75000',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
const CONTACTS = [contactRow('c-ada', 'Ada'), contactRow('c-bo', 'Bo'), contactRow('c-cy', 'Cy')];
const unRow = (id, min) => ({ conversationId: `cv-${id}`, contactId: `c-${id}`, contactName: `${id[0].toUpperCase()}${id.slice(1)} Fixture`, phone: '+15555550142', email: '', lastMessageDate: Date.parse(T(min)), preview: WORDS[id], unreadCount: 1,
  latestInbound: { state: 'text', channel: 'SMS', text: WORDS[id], at: T(min), source: 'thread' } });
const UNANSWERED = [unRow('ada', 3), unRow('bo', 4)];
const THREADS = ['cy', 'bo', 'ada'].map((id, i) => ({ conversationId: `cv-${id}`, contactId: `c-${id}`, contactName: `${id[0].toUpperCase()}${id.slice(1)} Fixture`, phone: '+15555550142', email: '',
  lastMessageDate: Date.parse(T(9 - i)), lastMessageDirection: 'inbound', preview: WORDS[id], unreadCount: 1 }));
const MESSAGES = Object.fromEntries(['ada', 'bo', 'cy'].map((id, i) => [`c-${id}`, [{ id: `m-${id}`, conversationId: `cv-${id}`, contactId: `c-${id}`, direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: WORDS[id], dateAdded: T(3 + i) }]]));

async function main() {
  if (BEFORE) {
    fs.writeFileSync(path.join(HARNESS_DIR, 'AppBefore.tsx'), execFileSync('git', ['show', `${BEFORE}:app/src/App.tsx`], { cwd: APP, encoding: 'utf8' }).replace(/from "\.\//g, 'from "../../../src/'));
    console.log(`NEGATIVE CONTROL: serving App, Dashboard and Conversations from ${BEFORE}; this run must fail.`);
  }
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [before, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const reads = [], writes = [], foreign = [], pageErrors = [];
  const cleanup = () => { const f = path.join(HARNESS_DIR, 'AppBefore.tsx'); if (fs.existsSync(f)) fs.rmSync(f); };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const q = u.searchParams;
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json({ signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (route.request().method() !== 'GET') { writes.push(fn); return json({ error: 'fixture: reads only' }, 405); }
      reads.push(fn === 'ghl-conversations' ? `ghl-conversations${q.get('scope') ? `?scope=${q.get('scope')}` : ''}` : fn === 'ghl-contact-conversations' ? `ghl-contact-conversations:${q.get('id')}` : fn);
      if (fn === 'ghl-contacts') return json(CONTACTS);
      if (fn === 'ghl-mailers') return json({ weekStartCT: '2026-11-01', weekEndCT: '2026-11-07', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } });
      if (fn === 'ghl-opportunities') return json({ pipelineId: 'p', stages: [], opportunities: [] });
      if (fn === 'ghl-conversations') return json(q.get('scope') === 'all' ? THREADS : UNANSWERED);
      if (fn === 'ghl-contact-conversations') return json({ contactId: q.get('id'), conversationCount: 1, messages: MESSAGES[q.get('id')] || [] });
      if (fn === 'ghl-proxy' && /\/notes$/.test(q.get('path') || '')) return json({ notes: [] });
      if (fn === 'ghl-contact') return json({ id: q.get('id'), firstName: q.get('id'), lastName: 'Fixture', phone: '+15555550142', email: '', address1: '', city: '', state: '', postalCode: '', propertyAddress: '', dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {} });
      if (fn === 'ghl-calendar-events') return json({ events: [] });
      if (fn === 'ghl-underwriting-policy') return json({ values: [] });
      return json({ error: `fixture: ${fn} not answered` }, 404);
    });
    const start = async (p) => { await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(p)}`); await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 }); };
    const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await page.waitForTimeout(150); } return null; };
    const strip = () => page.evaluate(() => document.querySelector('[data-testid="thread-latest-inbound"]')?.innerText?.replace(/\s+/g, ' ').trim() ?? null);
    const pathNow = () => page.evaluate(() => location.pathname + location.search);
    const linkFor = (id) => page.evaluate((cv) => { const a = document.querySelector(`[data-testid="unanswered-open-${cv}"]`); return a ? { href: new URL(a.href).pathname.replace(/^.*(\/conversations)/, '$1') + new URL(a.href).search, text: a.textContent.trim() } : null; }, `cv-${id}`);
    const toDashboard = async () => { await start('/'); await until(() => page.evaluate(() => !!document.querySelector('[data-testid="unanswered-preview-cv-bo"]'))); await page.waitForTimeout(300); };
    const shown = (s, id) => !!s && s.includes(WORDS[id]) && Object.keys(WORDS).filter((k) => k !== id).every((k) => !s.includes(WORDS[k]));

    // L1
    await toDashboard();
    const la = await linkFor('ada'), lb = await linkFor('bo');
    check('L1 each Unanswered Inbound row links to its own conversation: /conversations?conversation=cv-ada and cv-bo',
      !!la && !!lb && la.href === '/conversations?conversation=cv-ada' && lb.href === '/conversations?conversation=cv-bo' && /Open conversation/.test(la.text), { la, lb });
    // P1
    const p1 = await page.evaluate(() => ({ preview: document.querySelector('[data-testid="unanswered-preview-cv-ada"]')?.innerText?.trim(), name: [...document.querySelectorAll('[data-testid="contact-link"], a')].filter((a) => a.textContent.trim() === 'Ada Fixture').map((a) => new URL(a.href).pathname.replace(/^.*\/contacts\//, '/contacts/'))[0] ?? null }));
    check('P1 the row keeps its preview (the seller\'s words) and the contact name still links to the contact workspace (R1)', /Ada here/.test(p1.preview || '') && p1.name === '/contacts/c-ada', p1);
    // O1
    const r0 = reads.length;
    if (la) await page.locator('[data-testid="unanswered-open-cv-ada"]').click();
    const o1 = await until(async () => { const s = await strip(); return s && /Ada here/.test(s) ? { path: await pathNow(), strip: s } : null; }) || { path: await pathNow(), strip: await strip() };
    const o1reads = reads.slice(r0).filter((r) => r.startsWith('ghl-contact-conversations:'));
    check('O1 Ada\'s link opens Conversations with Ada\'s thread selected: Ada\'s words only, and only Ada\'s messages were read',
      /\/conversations\?conversation=cv-ada$/.test(o1.path) && shown(o1.strip, 'ada') && o1reads.length >= 1 && o1reads.every((r) => r === 'ghl-contact-conversations:c-ada'), { ...o1, o1reads });
    // O2
    await toDashboard(); const r1 = reads.length;
    if (lb) await page.locator('[data-testid="unanswered-open-cv-bo"]').click();
    const o2 = await until(async () => { const s = await strip(); return s && /Bo here/.test(s) ? { path: await pathNow(), strip: s } : null; }) || { path: await pathNow(), strip: await strip() };
    const o2reads = reads.slice(r1).filter((r) => r.startsWith('ghl-contact-conversations:'));
    check('O2 Bo\'s link opens Bo\'s thread: Bo\'s words, never Ada\'s; only Bo\'s messages were read',
      /\/conversations\?conversation=cv-bo$/.test(o2.path) && shown(o2.strip, 'bo') && o2reads.length >= 1 && o2reads.every((r) => r === 'ghl-contact-conversations:c-bo'), { ...o2, o2reads });
    // O3
    await start('/conversations?conversation=cv-bo');   // a fresh document load straight onto Bo's link (direct visit / reload)
    const o3 = await until(async () => { const s = await strip(); return s && /Bo here/.test(s) ? s : null; });
    check('O3 a direct visit (fresh load) of Bo\'s link selects Bo\'s thread', shown(o3, 'bo'), { o3, path: await pathNow() });
    // M1
    await start('/conversations?conversation=cv-gone');
    await until(() => page.evaluate(() => /\d+ threads?/.test(document.body.innerText)));
    await page.waitForTimeout(600);
    const m1 = { notice: await page.evaluate(() => document.querySelector('[data-testid="conv-link-missing"]')?.innerText?.trim() ?? null), strip: await strip(), anyWords: await page.evaluate((w) => Object.values(w).some((x) => document.querySelector('[data-testid="thread-latest-inbound"]')?.innerText.includes(x)), WORDS) };
    check('M1 an id not in the list: a plain notice, and no thread is selected (no guess)', !!m1.notice && /isn.t in the list/i.test(m1.notice) && m1.strip === null && !m1.anyWords, m1);
    // M2 (Bones REVISE R1 on fc35053): Cy's thread OPEN, then the real router (same mounted page, no document load) goes to
    // a missing id. Afterwards: the notice, no thread selected, and nothing of Cy's left.
    await start('/conversations?conversation=cv-ada');
    await until(async () => { const s = await strip(); return s && /Ada here/.test(s); });
    await page.locator('button', { hasText: 'Cy Fixture' }).first().click();
    const m2cy = await until(async () => { const s = await strip(); return s && /Cy here/.test(s) ? s : null; });
    await page.evaluate(() => { window.__b1508SameDocument = 'cy-open'; });
    const m2mark = reads.length;
    await page.evaluate(() => { window.history.pushState(null, '', '/conversations?conversation=cv-gone'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await until(() => page.evaluate(() => !!document.querySelector('[data-testid="conv-link-missing"]')), 8000);
    await page.waitForTimeout(1000);   // let every effect settle
    const m2 = { cyBefore: m2cy, path: await pathNow(), sameDocument: await page.evaluate(() => window.__b1508SameDocument === 'cy-open'),
      threadListReread: reads.slice(m2mark).includes('ghl-conversations?scope=all'),
      notice: await page.evaluate(() => document.querySelector('[data-testid="conv-link-missing"]')?.innerText?.trim() ?? null), strip: await strip(),
      cyAnywhereInPane: await page.evaluate((w) => { const el = document.querySelector('[data-testid="thread-latest-inbound"]'); return !!el || [...document.querySelectorAll('div')].some((d) => d.children.length === 0 && d.textContent.includes(w)); }, WORDS.cy) };
    check('M2 Cy open, then the same mounted page navigates to a missing id: the notice shows, NO thread is selected, and Cy\'s message is gone',
      shown(m2cy, 'cy') && /conversation=cv-gone$/.test(m2.path) && m2.sameDocument && !m2.threadListReread && !!m2.notice && /isn.t in the list/i.test(m2.notice) && m2.strip === null && !m2.cyAnywhereInPane, m2);
    // N1
    await start('/conversations');
    await until(() => page.evaluate(() => /\d+ threads?/.test(document.body.innerText)));
    await page.waitForTimeout(600);
    const n1 = { strip: await strip(), notice: await page.evaluate(() => !!document.querySelector('[data-testid="conv-link-missing"]')) };
    check('N1 plain /conversations (the sidebar route) is unchanged: nothing selected, no notice', n1.strip === null && n1.notice === false, n1);
    // S1
    await start('/conversations?conversation=cv-ada');
    await until(async () => { const s = await strip(); return s && /Ada here/.test(s); });
    await page.locator('button', { hasText: 'Cy Fixture' }).first().click();
    const s1 = await until(async () => { const s = await strip(); return s && /Cy here/.test(s) ? s : null; });
    await page.waitForTimeout(800); const s1later = await strip();
    check('S1 after arriving by link, choosing another thread by hand shows that thread, and the link does not pull it back', shown(s1, 'cy') && shown(s1later, 'cy'), { s1, s1later });
    // W
    const kinds = [...new Set(reads.map((r) => r.replace(/:.*$/, '')))];
    check('W reads only; no new read kind (contacts, mailers, opportunities, conversations unanswered/all, contact messages, notes, contact, calendar, policy); nothing external; no page errors',
      writes.length === 0 && foreign.length === 0 && pageErrors.length === 0 && kinds.every((k) => ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations', 'ghl-conversations?scope=all', 'ghl-contact-conversations', 'ghl-proxy', 'ghl-contact', 'ghl-calendar-events', 'ghl-underwriting-policy'].includes(k)),
      { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3), kinds });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  await browser.close().catch(() => {}); await server.close().catch(() => {}); cleanup();
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-08 Dashboard thread link: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
