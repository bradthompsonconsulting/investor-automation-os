/**
 * B15-08 (Spock G5 finding 2) follow-up, test-only (Captain GO 2026-11-19, on fc35053) -- the Dashboard link's thread
 * selection is applied ONCE per conversation id: a thread the operator picks by hand afterwards is not pulled back when
 * the thread list is re-read after a read-session recovery.
 *
 * Offline: the REAL App (scripts/harness/app-routes: router, Layout, ReadAccess, Dashboard, Conversations). The read
 * session is modelled exactly as tests/test-read-session-recovery.cjs does: while signed out every GHL read answers 401
 * with the read-auth marker; the page learns of it through the app's own `iaos-read-session-lost` event; "Sign in again"
 * opens the stub /app-read-login.html, which posts the real `iaos-app-read-signed-in` message. ReadAccess keeps the page
 * mounted (hidden) and bumps ReadRecovered, so Conversations re-reads its thread list.
 *
 *   R1  Ada opened from the Dashboard link (?conversation=cv-ada), then Bo picked by hand: Bo's thread shows
 *   R2  the recovery really happened: the recovery screen appeared; after "Sign in again" it is gone; a NEW signed-in
 *       thread-list read (ghl-conversations ?scope=all) was answered after the sign-in
 *   R3  after that re-read finished, Bo is still selected (Bo's words, never Ada's) and Ada's messages were not re-read
 *   W   reads only; nothing left the machine; no page errors
 *
 * CONTROL (run by the evidence runner, not CI): with the once-per-id guard removed, R3 must FAIL (back to Ada).
 */
'use strict';
const path = require('node:path');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
/** Literal check() call sites: R1-R3, W = 4. */
const FLOOR = 4;
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`); }
const note = (s) => console.log(`NOTE  ${s}`);

let signedIn = true;
const REFUSAL = { error: 'Read sign-in required.', by: 'iaos-app-read-auth' };
const POPUP = `<!doctype html><title>stub read sign-in</title><script>
  window.opener.postMessage({ type: "iaos-app-read-signed-in" }, location.origin);
</script>`;

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
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 4 minutes -- stopped'); process.exit(1); }, 4 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  /** Every function request: { seq, kind, signedIn, answeredAt } -- answeredAt set when the fixture has replied. */
  const log = []; const writes = [], foreign = [], pageErrors = [];
  let seq = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${base}/app-read-login.html`)) { signedIn = true; return route.fulfill({ status: 200, contentType: 'text/html', body: POPUP }); }
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const q = u.searchParams; const method = route.request().method();
      const entry = { seq: ++seq, kind: fn === 'ghl-conversations' ? `ghl-conversations${q.get('scope') ? `?scope=${q.get('scope')}` : ''}` : fn === 'ghl-contact-conversations' ? `ghl-contact-conversations:${q.get('id')}` : fn, signedIn, answered: false };
      log.push(entry);
      const json = async (b, s = 200) => { await route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) }); entry.answered = true; };
      if (fn === 'app-read-session') {
        if (method === 'DELETE') { signedIn = false; return json({ signedIn: false }); }
        return json(signedIn ? { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() } : { signedIn: false });
      }
      if (method !== 'GET') { writes.push(fn); return json({ error: 'fixture: reads only' }, 405); }
      if (!signedIn) return json(REFUSAL, 401);
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
    const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await page.waitForTimeout(150); } return null; };
    const strip = () => page.evaluate(() => document.querySelector('[data-testid="thread-latest-inbound"]')?.innerText?.replace(/\s+/g, ' ').trim() ?? null);
    const shown = (s, id) => !!s && s.includes(WORDS[id]) && Object.keys(WORDS).filter((k) => k !== id).every((k) => !s.includes(WORDS[k]));
    const recoveryVisible = () => page.getByRole('button', { name: 'Sign in again' }).isVisible().catch(() => false);

    // R1: Dashboard -> Ada's link -> Ada; then Bo by hand.
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent('/')}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 });
    await until(() => page.evaluate(() => !!document.querySelector('[data-testid="unanswered-open-cv-ada"]')));
    await page.locator('[data-testid="unanswered-open-cv-ada"]').click();
    const ada = await until(async () => { const s = await strip(); return s && /Ada here/.test(s) ? s : null; });
    await page.locator('button', { hasText: 'Bo Fixture' }).first().click();
    const bo = await until(async () => { const s = await strip(); return s && /Bo here/.test(s) ? s : null; });
    const url1 = await page.evaluate(() => location.pathname + location.search);
    note(`R1 url=${url1} ada=${JSON.stringify(ada)} bo=${JSON.stringify(bo)}`);
    check('R1 Ada opened from the Dashboard link, then Bo picked by hand: Bo\'s thread shows (URL still names cv-ada)', shown(ada, 'ada') && shown(bo, 'bo') && /conversation=cv-ada$/.test(url1), { ada, bo, url1 });

    // R2: lapse -> recovery screen -> Sign in again -> a NEW signed-in thread-list read answered after the sign-in.
    const mark = seq;
    signedIn = false;
    await page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
    const sawRecovery = await until(recoveryVisible, 10000);
    const signInSeq = seq;
    if (sawRecovery) await page.getByRole('button', { name: 'Sign in again' }).click();
    const recoveryGone = await until(async () => !(await recoveryVisible()), 15000);
    const reread = await until(async () => log.find((e) => e.seq > signInSeq && e.kind === 'ghl-conversations?scope=all' && e.signedIn && e.answered) || null, 15000);
    await page.waitForTimeout(1500);   // let the re-read's result render and every effect run
    const after = log.filter((e) => e.seq > mark).map((e) => `${e.kind}${e.signedIn ? '' : ' (signed out)'}`);
    note(`R2 sawRecovery=${!!sawRecovery} recoveryGone=${!!recoveryGone} reread=${JSON.stringify(reread)} requests after the lapse: ${JSON.stringify(after)}`);
    check('R2 the recovery really happened: the recovery screen appeared, "Sign in again" cleared it, and a NEW signed-in thread-list read (?scope=all) was answered after the sign-in',
      !!sawRecovery && !!recoveryGone && !!reread, { sawRecovery: !!sawRecovery, recoveryGone: !!recoveryGone, reread, after });

    // R3: after the re-read, Bo is still selected; Ada's messages were not re-read.
    const s3 = await strip();
    const adaReread = log.filter((e) => e.seq > signInSeq && e.kind === 'ghl-contact-conversations:c-ada');
    note(`R3 strip after the re-read: ${JSON.stringify(s3)}; Ada message reads after the sign-in: ${adaReread.length}`);
    check('R3 after the thread-list re-read finished, Bo is still selected (Bo\'s words, never Ada\'s) and Ada\'s messages were not re-read',
      shown(s3, 'bo') && adaReread.length === 0, { s3, adaReread });

    check('W reads only; nothing left the machine; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-08 thread link across read recovery: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
