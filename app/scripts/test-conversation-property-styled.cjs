/**
 * B15-23 (INV-132) -- the Conversations property context with the APPLICATION'S
 * REAL STYLES, at 1100px and 1280px (Bones REVISE on 1b12955: at 1100px the
 * address truncated and the qualifier was hidden, with no full-text access).
 *
 * Offline. Vite serves scripts/harness/conversations-styled -- the REAL Layout
 * and Conversations page with the real GHL client and the app's real stylesheet
 * (src/index.css through the same Tailwind Vite plugin the app builds with) -- in
 * headless Chromium. Every /.netlify/functions request is answered here from
 * FICTIONAL data; nothing leaves the machine.
 *
 * Proves, at each width: the full address and the full qualifier are present,
 * laid out (non-zero size), not overflowing their own box, and not clipped by
 * any ancestor's overflow; the name and the Workspace / Reply / Call links stay
 * visible; no sideways page overflow. Also: a long Property-Address-field value
 * is fully shown; the row's tooltip carries the full text; reads only; no page
 * errors.
 *
 * NEGATIVE CONTROL: `node scripts/test-conversation-property-styled.cjs --before=<rev>`
 * renders <rev>'s Conversations page and must FAIL (exit 1) -- e.g. --before=1b12955,
 * the candidate Bones returned. Waits never throw, so the control fails its checks.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/conversations-styled/index.html';
const BEFORE_FILE = path.join(APP, 'scripts/harness/conversations-styled/ConversationsBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file: 4 single check() sites + 4 inside the width loop x 2 widths = 12. */
const FLOOR = 12;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const removeBefore = () => { if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE); };
removeBefore();
process.on('exit', removeBefore);
if (BEFORE) {
  const src = execFileSync('git', ['show', `${BEFORE}:app/src/pages/Conversations.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\//g, 'from "../../../src/').replace(/(from|import) "\.\//g, '$1 "../../../src/pages/'));
  console.log(`NEGATIVE CONTROL: rendering the Conversations page from ${BEFORE}; this run must fail.`);
}

// ── Fictional fixture ────────────────────────────────────────────────────────
const QUALIFIER = "From the contact's address fields; not confirmed as the property address";
const LONG_NATIVE = '12750 Fictional Meadowbrook Parkway Unit 214, Fort Worth, TX 76102';
const LONG_FIELD = '4821 Fictional Old Settlers Ranch Road, Building C, Round Rock, Texas 78665';
const mail = { mailingAddress: '700 Mailbox Way', mailing_city: 'Mailville', mailing_state: 'OK', mailing_zip: '73001' };
const ROWS = {
  cL: { id: 'cL', firstName: 'Lana', lastName: 'Longaddress', address1: '12750 Fictional Meadowbrook Parkway Unit 214', city: 'Fort Worth', state: 'TX', postalCode: '76102', propertyAddress: '' },
  cG: { id: 'cG', firstName: 'Gus', lastName: 'Longfield', address1: '', city: '', state: '', postalCode: '', propertyAddress: LONG_FIELD },
};
const THREADS = [
  { conversationId: 'conv-L', contactId: 'cL', contactName: 'Lana Longaddress', phone: '+15555550100', email: '', lastMessageDate: Date.parse('2026-10-30T15:00:00Z'), lastMessageDirection: 'inbound', preview: 'Fictional preview L', unreadCount: 1 },
  { conversationId: 'conv-G', contactId: 'cG', contactName: 'Gus Longfield', phone: '+15555550100', email: '', lastMessageDate: Date.parse('2026-10-29T15:00:00Z'), lastMessageDirection: 'inbound', preview: 'Fictional preview G', unreadCount: 1 },
];
const log = [];
const foreign = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); removeBefore(); process.exit(code); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com|leadconnectorhq\.com/, (r) => { foreign.push(r.request().url()); return r.abort(); });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const id = u.searchParams.get('id') || ''; const m = route.request().method();
      log.push(`${m} ${fn}`);
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (m !== 'GET') return json(405, { error: 'reads only' });
      if (fn === 'ghl-conversations') return json(200, THREADS);
      if (fn === 'ghl-contact-conversations') return json(200, { contactId: id, conversationCount: 1, messages: [{ id: `m-${id}`, conversationId: 'c', contactId: id, direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: `Fictional text ${id}`, dateAdded: '2026-10-30T15:00:00.000Z' }] });
      if (fn === 'ghl-proxy') return json(200, { notes: [] });
      if (fn === 'ghl-contact' && ROWS[id]) return json(200, { ...ROWS[id], phone: '+15555550100', email: '', dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {}, ...mail });
      return json(404, { error: `not answered: ${fn}` });
    });

    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/conversations'));
    await page.getByText('Lana Longaddress').first().waitFor({ timeout: 30000 });
    const styled = await page.evaluate(() => ({ boxSizing: getComputedStyle(document.body).boxSizing || getComputedStyle(document.querySelector('main')).boxSizing, font: getComputedStyle(document.body).fontFamily, source: window.__iaosConversationsSource }));
    check("harness renders the expected source with the app's real stylesheet", styled.source === (BEFORE ? 'before' : 'current') && /Inter/.test(styled.font), styled);

    const soft = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(50); } return false; };
    /** Is the element fully readable? Present, laid out, not overflowing its own box, not clipped by any ancestor. */
    const readable = (selector) => page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); let clippedBy = null;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(hidden|clip|auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) {
          const ar = a.getBoundingClientRect();
          if (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1) { clippedBy = a.tagName + (a.getAttribute('data-testid') ? `#${a.getAttribute('data-testid')}` : ''); break; }
        }
      }
      return { text: el.innerText.trim(), w: Math.round(r.width), h: Math.round(r.height), overflowing: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        inViewport: r.left >= -1 && r.right <= innerWidth + 1, visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0, clippedBy };
    }, selector);
    const ok = (x, text) => !!x && x.text === text && x.visible && !x.overflowing && !x.clippedBy && x.inViewport;
    const open = (name) => page.locator('button', { hasText: name }).first().click();

    await open('Lana Longaddress');
    await soft(async () => ((await readable('[data-testid="conv-property-context"]')) || {}).text?.includes('Meadowbrook'));
    for (const width of [1100, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const addr = await readable('[data-testid="conv-property-context"] > div:first-child');
      const note = await readable('[data-testid="conv-property-note"]');
      console.log(`INFO  ${width}px address ${JSON.stringify(addr)} note ${JSON.stringify(note)}`);
      check(`${width}px: the full address is readable (not truncated or clipped)`, ok(addr, LONG_NATIVE), addr);
      check(`${width}px: the complete qualifier is readable (not hidden, truncated or clipped)`, ok(note, QUALIFIER), note);
      const chrome = await page.evaluate(() => {
        const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1; };
        const a = [...document.querySelectorAll('main a')];
        return { name: vis([...document.querySelectorAll('main span')].find((s) => s.textContent.trim() === 'Lana Longaddress')),
          workspace: vis(a.find((x) => /Workspace/.test(x.textContent))), reply: vis(a.find((x) => /Reply in GHL/.test(x.textContent))), call: vis(a.find((x) => /Call in GHL/.test(x.textContent))) };
      });
      check(`${width}px: the name and the Workspace / Reply / Call links stay visible`, chrome.name && chrome.workspace && chrome.reply && chrome.call, chrome);
      const ov = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
      check(`${width}px: no sideways page overflow`, !ov.page, ov);
    }

    await page.setViewportSize({ width: 1100, height: 900 });
    const title = await page.evaluate(() => (document.querySelector('[data-testid="conv-property-context"]') || {}).title || null);
    check('the row tooltip carries the full address and the full qualifier', title === `${LONG_NATIVE} — ${QUALIFIER}`, title);
    await open('Gus Longfield');
    await soft(async () => ((await readable('[data-testid="conv-property-context"]')) || {}).text?.includes('Settlers'));
    const field = await readable('[data-testid="conv-property-context"] > div:first-child');
    check('1100px: a long Property Address field value is fully readable', ok(field, LONG_FIELD), field);
    check('reads only, nothing left the machine, no page errors', log.every((l) => l.startsWith('GET ')) && foreign.length === 0 && pageErrors.length === 0, { foreign, pageErrors });
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main().catch((e) => { console.error(`FAIL  startup: ${e && e.stack || e}`); removeBefore(); process.exit(2); });
