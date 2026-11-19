/**
 * B15-08 (Spock G5 finding 1, 2026-11-05; Captain GO 2026-11-19) -- an ALREADY-OPEN conversation never tells the
 * operator to "open the conversation". Spock's exact case (no inbound -> "Latest inbound message not found — open the
 * conversation") was removed by F1 (afbb63c, in main: no strip). This suite covers the remaining states the open-thread
 * strip can still reach -- a failed messages read, an inbound with no text, an unsupported message type -- and checks
 * that the Dashboard, where the instruction is real (its row is not the conversation), keeps it.
 *
 * Offline: the REAL Layout + Conversations page (scripts/harness/conversations-styled, unchanged) and the REAL shared
 * InboundPreview; every /.netlify/functions request is answered here from fictional fixtures; reads only.
 *
 *   T1  failed messages read, thread open: says the text couldn't be read; no "open the conversation"
 *   T2  inbound SMS with no text, thread open: says the text isn't available; no "open the conversation"
 *   T3  unsupported inbound type, thread open: says the type isn't shown; no "open the conversation"
 *   S1  seller text preserved: an inbound text with punctuation, symbols and an apostrophe shows exactly
 *   S2  isolation: thread A (text) -> thread B (no text) -> back to A: each strip shows only its own thread
 *   S3  no thread pane anywhere in the walk says "open the conversation"
 *   D1  the Dashboard prompt is unchanged where it is an instruction: the same component, OUTSIDE a thread, still says
 *       "… — open the conversation" for every unavailable reason
 *   W   reads only; nothing left the machine; no page errors
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Conversations.tsx AND InboundPreview.tsx; with main c026442, T1, T2,
 * T3 and S3 must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/conversations-styled/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const SWAPPED = { [path.join(APP, 'src/pages/Conversations.tsx')]: 'app/src/pages/Conversations.tsx', [path.join(APP, 'src/components/InboundPreview.tsx')]: 'app/src/components/InboundPreview.tsx' };
const before = { name: 'b15-08-before', enforce: 'pre', load(id) {
  const rel = BEFORE && SWAPPED[path.resolve(id.split('?')[0])];
  return rel ? execFileSync('git', ['show', `${BEFORE}:${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }) : null;
} };
/** Literal check() call sites: T1-T3, S1-S3, D1, W = 8. */
const FLOOR = 8;
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`); }

const OPEN_PROMPT = /open the conversation/i;
const SELLER_TEXT = "Yes — I'd sell for $250k, call me @ 5pm! (not before) & thanks";
const T = (m) => new Date(Date.UTC(2026, 10, 5, 15, m)).toISOString();
const msg = (cid, conv, o) => ({ id: `${cid}-${o.messageType || 'sms'}-${o.dateAdded}`, conversationId: conv, contactId: cid, channel: 'SMS', messageType: 'TYPE_SMS', body: '', dateAdded: T(1), ...o });
const MESSAGES = {
  cText: [msg('cText', 'conv-text', { direction: 'inbound', body: SELLER_TEXT, dateAdded: T(3) }), msg('cText', 'conv-text', { direction: 'outbound', body: 'Thanks, noted', dateAdded: T(4) })],
  cBlank: [msg('cBlank', 'conv-blank', { direction: 'inbound', body: '', dateAdded: T(5) }), msg('cBlank', 'conv-blank', { direction: 'outbound', body: 'Did your text come through?', dateAdded: T(6) })],
  cOdd: [msg('cOdd', 'conv-odd', { direction: 'inbound', messageType: 'TYPE_REVIEW_FIXTURE', channel: 'Other', body: '', dateAdded: T(7) }), msg('cOdd', 'conv-odd', { direction: 'outbound', body: 'We saw your message', dateAdded: T(8) })],
};
const THREADS = [
  ['conv-text', 'cText', 'Tina Text'], ['conv-blank', 'cBlank', 'Bea Blank'], ['conv-odd', 'cOdd', 'Otis Odd'], ['conv-fail', 'cFail', 'Fay Failure'],
].map(([conversationId, contactId, contactName], i) => ({ conversationId, contactId, contactName, phone: '+15555550100', email: '', lastMessageDate: Date.parse(T(10 - i)), lastMessageDirection: 'inbound', preview: 'preview', unreadCount: 0 }));

async function main() {
  if (BEFORE) console.log(`NEGATIVE CONTROL: serving Conversations.tsx and InboundPreview.tsx from ${BEFORE}; this run must fail.`);
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
        return json(200, { contactId: id, conversationCount: 1, messages: MESSAGES[id] || [] });
      }
      if (fn === 'ghl-proxy') return json(200, { notes: [] });
      if (fn === 'ghl-contact') return json(200, { id, firstName: id, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '', propertyAddress: '', dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {} });
      return json(404, { error: `not answered: ${fn}` });
    });
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/conversations'));
    await page.getByText('Tina Text').first().waitFor({ timeout: 30000 });
    const strip = async () => page.evaluate(() => { const el = document.querySelector('[data-testid="thread-latest-inbound"]'); return el ? { state: el.getAttribute('data-state'), text: el.textContent.replace(/\s+/g, ' ').trim(), seller: el.querySelector('[data-testid="thread-latest-inbound-preview-text"]')?.textContent ?? null } : null; });
    const open = async (name, waitText) => { await page.locator('button', { hasText: name }).first().click(); if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); };
    const pane = () => page.evaluate(() => { const el = document.querySelector('[data-testid="thread-latest-inbound"]'); const root = el ? el.closest('div[style*="flex: 1"]') : null; return (root || document.body).innerText; });
    const seen = [];

    await open('Fay Failure'); const t1 = await strip(); seen.push(['fail', t1, await pane()]);
    check('T1 failed messages read in the open thread: "couldn\'t be read", and no "open the conversation"', !!t1 && /couldn.t be read/i.test(t1.text) && !OPEN_PROMPT.test(t1.text), t1);
    await open('Bea Blank', 'Did your text come through?'); const t2 = await strip(); seen.push(['blank', t2, await pane()]);
    check('T2 inbound SMS with no text in the open thread: says the text isn\'t available, and no "open the conversation"', !!t2 && /isn.t available/i.test(t2.text) && !OPEN_PROMPT.test(t2.text), t2);
    await open('Otis Odd', 'We saw your message'); const t3 = await strip(); seen.push(['odd', t3, await pane()]);
    check('T3 unsupported inbound type in the open thread: says the type isn\'t shown, and no "open the conversation"', !!t3 && /isn.t shown/i.test(t3.text) && !OPEN_PROMPT.test(t3.text), t3);
    await open('Tina Text', 'Thanks, noted'); const s1 = await strip(); seen.push(['text', s1, await pane()]);
    check('S1 seller text preserved exactly in the strip (punctuation, symbols, apostrophe)', !!s1 && s1.seller === SELLER_TEXT, { got: s1 && s1.seller, want: SELLER_TEXT });
    await open('Bea Blank', 'Did your text come through?'); const s2b = await strip();
    await open('Tina Text', 'Thanks, noted'); const s2a = await strip();
    check('S2 isolation: thread B shows only its own state (never A\'s text); back on A, A\'s text returns', !!s2b && !s2b.text.includes(SELLER_TEXT) && /isn.t available/i.test(s2b.text) && !!s2a && s2a.seller === SELLER_TEXT, { s2b, s2a });
    check('S3 no open thread pane in the walk says "open the conversation"', seen.every(([, , p]) => !OPEN_PROMPT.test(p)), seen.map(([k, s, p]) => [k, s && s.text, OPEN_PROMPT.test(p)]));

    // D1: the same shared component OUTSIDE a thread (the Dashboard's Unanswered Inbound row) keeps the instruction.
    const d1 = await page.evaluate(async () => {
      const reactMod = await import('/node_modules/.vite/deps/react.js');
      const React = reactMod.createElement ? reactMod : reactMod.default;
      const clientMod = await import('/node_modules/.vite/deps/react-dom_client.js');
      const createRoot = clientMod.createRoot || (clientMod.default && clientMod.default.createRoot);
      const { InboundPreview, INBOUND_UNAVAILABLE_TEXT } = await import('/src/components/InboundPreview.tsx');
      const host = document.createElement('div'); document.body.appendChild(host);
      const reasons = Object.keys(INBOUND_UNAVAILABLE_TEXT);
      const root = createRoot(host);
      root.render(React.createElement('div', null, reasons.map((reason) => React.createElement(InboundPreview, { key: reason, li: { state: 'unavailable', reason, channel: null, at: null }, testId: `d1-${reason}` }))));
      await new Promise((r) => setTimeout(r, 300));
      const out = Object.fromEntries(reasons.map((r) => [r, host.querySelector(`[data-testid="d1-${r}-text"]`)?.textContent ?? null]));
      root.unmount(); host.remove();
      return out;
    });
    const dash = require('node:fs').readFileSync(path.join(APP, 'src/pages/Dashboard.tsx'), 'utf8');
    check('D1 outside a thread (the Dashboard row) every unavailable reason still ends "— open the conversation", and the Dashboard call site passes no in-thread option',
      Object.keys(d1).length === 7 && Object.values(d1).every((t) => /— open the conversation$/.test(t || '')) && /<InboundPreview li=\{r\.latestInbound\} testId=\{`unanswered-preview-\$\{r\.conversationId\}`\} \/>/.test(dash), d1);
    check('W reads only; nothing left the machine; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-08 open-thread prompt: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
