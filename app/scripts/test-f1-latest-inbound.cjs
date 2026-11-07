/**
 * F1 (Board #15 Captain walkthrough) -- "Latest from seller" in the Conversations thread pane.
 *
 * Offline: the REAL Layout + Conversations page (scripts/harness/conversations-styled, unchanged); every
 * /.netlify/functions request is answered here from fictional fixtures; reads only.
 *
 *   H1  a thread with NO inbound message (only outbound): no "Latest from seller" at all
 *   H2  a thread with an inbound text: the strip shows that text (unchanged)
 *   H3  an inbound with no text (a call): the strip still shows, naming it (unchanged)
 *   L1  while the messages are loading: the strip says Loading -- not hidden, not "no inbound"
 *   E1  when the messages read fails: the strip says the text couldn't be read -- distinct from "no inbound"
 *   W   reads only; nothing left the machine; no page errors
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Conversations.tsx; with the base 9e8c8fd, H1, L1 and E1 must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/conversations-styled/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const PAGE = path.join(APP, 'src/pages/Conversations.tsx');
const before = { name: 'f1-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/Conversations.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };
let checks = 0, failures = 0;
const FLOOR = 8;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }

const T = (m) => new Date(Date.UTC(2026, 10, 5, 15, m)).toISOString();
const msg = (cid, conv, o) => ({ id: `${cid}-${o.body || o.messageType}-${o.dateAdded}`, conversationId: conv, contactId: cid, channel: 'SMS', messageType: 'TYPE_SMS', body: '', dateAdded: T(1), ...o });
const MESSAGES = {
  cOut: [msg('cOut', 'conv-out', { direction: 'outbound', body: 'Checking in on your house', dateAdded: T(2) })],
  cIn: [msg('cIn', 'conv-in', { direction: 'inbound', body: 'Yes I might sell', dateAdded: T(3) }), msg('cIn', 'conv-in', { direction: 'outbound', body: 'Great, when?', dateAdded: T(4) })],
  cCall: [msg('cCall', 'conv-call', { direction: 'inbound', messageType: 'TYPE_CALL', channel: 'Call', body: '', dateAdded: T(5) })],
};
const THREADS = [
  ['conv-out', 'cOut', 'Olive Outbound'], ['conv-in', 'cIn', 'Ivan Inbound'], ['conv-call', 'cCall', 'Carl Caller'],
  ['conv-fail', 'cFail', 'Fay Failure'], ['conv-slow', 'cSlow', 'Sam Slow'],
].map(([conversationId, contactId, contactName], i) => ({ conversationId, contactId, contactName, phone: '+15555550100', email: '', lastMessageDate: Date.parse(T(10 - i)), lastMessageDirection: 'inbound', preview: 'preview', unreadCount: 0 }));

async function main() {
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
  const writes = [], foreign = [], pageErrors = [];
  let releaseSlow; const slow = new Promise((r) => { releaseSlow = r; });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com|leadconnectorhq\.com/, (r) => { foreign.push(r.request().url()); return r.abort(); });
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, ''); const id = u.searchParams.get('id') || '';
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) }).catch(() => {});
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (req.method() !== 'GET') { writes.push(fn); return json(405, { error: 'reads only' }); }
      if (fn === 'ghl-conversations') return json(200, THREADS);
      if (fn === 'ghl-contact-conversations') {
        if (id === 'cFail') return json(500, { error: 'fixture: messages read failed' });
        if (id === 'cSlow') { await slow; return json(200, { contactId: id, conversationCount: 1, messages: [] }); }
        return json(200, { contactId: id, conversationCount: 1, messages: MESSAGES[id] || [] });
      }
      if (fn === 'ghl-proxy') return json(200, { notes: [] });
      if (fn === 'ghl-contact') return json(200, { id, firstName: id, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '', propertyAddress: '', dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {} });
      return json(404, { error: `not answered: ${fn}` });
    });
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/conversations'));
    await page.getByText('Olive Outbound').first().waitFor({ timeout: 30000 });
    const strip = async () => page.evaluate(() => { const el = document.querySelector('[data-testid="thread-latest-inbound"]'); return el ? { state: el.getAttribute('data-state'), text: el.textContent.replace(/\s+/g, ' ').trim() } : null; });
    const open = async (name, waitText) => { await page.locator('button', { hasText: name }).first().click(); if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500); };

    await open('Olive Outbound', 'Checking in on your house');
    const h1 = await strip();
    check('H1 a thread with no inbound message shows no "Latest from seller"', h1 === null && !(await page.locator('body').innerText()).includes('Latest from seller'), h1);
    await open('Ivan Inbound', 'Great, when?');
    const h2 = await strip();
    check('H2 an inbound text is still shown in the strip', !!h2 && h2.text.includes('Latest from seller:') && h2.text.includes('Yes I might sell'), h2);
    await open('Carl Caller');
    const h3 = await strip();
    check('H3 an inbound without text (a call) still shows the strip, naming it', !!h3 && h3.text.includes('Latest from seller:') && /call/i.test(h3.text), h3);
    await open('Sam Slow');
    const l1 = await strip();
    check('L1 while loading, the strip says Loading (not hidden, not "no inbound")', !!l1 && /Loading/.test(l1.text) && !/not found/i.test(l1.text), l1);
    releaseSlow();
    await page.waitForTimeout(800);
    const l1after = await strip();
    check('L1b once that thread loads with no inbound, the strip goes away', l1after === null, l1after);
    await open('Fay Failure');
    await page.waitForTimeout(500);
    const e1 = await strip();
    check('E1 a failed read says the text couldn\'t be read (distinct from no inbound and from loading)', !!e1 && /couldn.t be read/i.test(e1.text) && !/Loading/.test(e1.text), e1);
    check('E1b the three states are told apart (loading, failed, hidden)', !!l1 && !!e1 && l1.text !== e1.text && h1 === null);
    check('W reads only; nothing left the machine; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nF1 latest from seller: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
