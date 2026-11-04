/**
 * B15-23 (INV-132) -- property context in Conversations, RENDERED.
 *
 * Offline. Vite serves scripts/harness/shell-labels (the REAL Layout around the
 * REAL Conversations page, real GHL client) in headless Chromium; every
 * /.netlify/functions request is answered here from FICTIONAL threads and
 * contacts (each contact also carries a mailing address that must never show),
 * and any request can be HELD to make answers arrive late. Nothing leaves the
 * machine.
 *
 * Proves: the native address under the name with the R-C1 qualifier; the
 * Property Address field plain; none; couldn't be loaded (messages and the GHL
 * hand-off still work); a thread with no contact makes no contact read; a late
 * contact read for an earlier thread never labels the current one; a late
 * MESSAGES read for an earlier thread never replaces the current thread's
 * messages; exactly one contact GET per selection; no mailing text; the banner
 * name, Workspace and GHL links unchanged; reads only; no page errors.
 *
 * NEGATIVE CONTROL: `node scripts/test-conversation-property-rendered.cjs --before=<rev>`
 * renders <rev>'s Conversations page (via `git show`) and must FAIL (exit 1) --
 * e.g. --before=3bbf49c, the base. Waits never throw, so the control fails its checks.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/shell-labels/index.html';
const BEFORE_FILE = path.join(APP, 'scripts/harness/shell-labels/ConversationsBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
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
const mail = { mailingAddress: '700 Mailbox Way', mailing_city: 'Mailville', mailing_state: 'OK', mailing_zip: '73001' };
const CONTACTS = {
  cI: { first: 'Ivy', last: 'Imported', address1: '417 Cedar Bend Rd', city: 'Waco', state: 'TX', postalCode: '76701', propertyAddress: '9 Customonly Ct' },
  cF: { first: 'Fay', last: 'Field', address1: '', city: 'Austin', state: 'TX', postalCode: '', propertyAddress: '77 Field Only Rd' },
  cN: { first: 'Nia', last: 'None', address1: '', city: 'Frisco', state: 'TX', postalCode: '75034', propertyAddress: '' },
  cU: { first: 'Uno', last: 'Unread', address1: '5 Hidden Way', city: 'Tyler', state: 'TX', postalCode: '75701', propertyAddress: '' },
};
const row = (id) => { const p = CONTACTS[id]; return { id, firstName: p.first, lastName: p.last, phone: '+15555550100', email: '', address1: p.address1, city: p.city,
  state: p.state, postalCode: p.postalCode, propertyAddress: p.propertyAddress, dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {}, ...mail }; };
const thread = (id, name, n) => ({ conversationId: `conv-${n}`, contactId: id, contactName: name, phone: '+15555550100', email: '',
  lastMessageDate: Date.parse(`2026-10-${10 + n}T15:00:00Z`), lastMessageDirection: 'inbound', preview: `Fictional preview ${n}`, unreadCount: 0 });
const THREADS = [thread('cI', 'Ivy Imported', 5), thread('cF', 'Fay Field', 4), thread('cN', 'Nia None', 3), thread('cU', 'Uno Unread', 2), thread('', 'No Contact Thread', 1)];
const messagesFor = (id) => ({ contactId: id, conversationCount: 1, messages: [{ id: `m-${id}`, conversationId: 'c', contactId: id, direction: 'inbound', channel: 'SMS',
  messageType: 'TYPE_SMS', body: `Fictional text from ${id || 'nobody'}: is the offer still good?`, dateAdded: '2026-10-07T15:00:00.000Z' }] });

let log = [];
const foreign = [];
let holds = [];
const hold = (match) => { let release, onHit; const h = { match, used: false, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) }; h.release = release; h.onHit = onHit; holds.push(h); return h; };
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); removeBefore(); process.exit(code); };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com|leadconnectorhq\.com/, (route) => { foreign.push(route.request().url()); return route.abort(); });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const method = route.request().method();
      const req = { method, fn, id: u.searchParams.get('id') || '', path: u.searchParams.get('path') || '' };
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (method !== 'GET') return json(405, { error: 'fixture: reads only' });
      if (fn === 'ghl-conversations') return json(200, THREADS);
      if (fn === 'ghl-contact-conversations') return json(200, messagesFor(req.id));
      if (fn === 'ghl-proxy' && /\/notes$/.test(req.path)) return json(200, { notes: [] });
      if (fn === 'ghl-contact') return req.id === 'cU' ? json(500, { error: 'fixture: contact read failed' }) : CONTACTS[req.id] ? json(200, row(req.id)) : json(404, { error: 'no such contact' });
      return json(404, { error: `fixture: ${fn} not answered` });
    });

    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/conversations'));
    await page.getByText('Ivy Imported').first().waitFor({ timeout: 30000 });

    const prop = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="conv-property-context"]'); if (!el) return null;
      const note = document.querySelector('[data-testid="conv-property-note"]');
      return { state: el.getAttribute('data-property-state'), text: el.firstElementChild ? el.firstElementChild.innerText.trim() : '', note: note ? note.innerText.trim() : null };
    });
    const soft = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(50); } return false; };
    /** Click the thread-list BUTTON for a name (the banner also shows the selected name). */
    const openThread = async (name) => { await page.locator('button', { hasText: name }).first().click(); };
    const propIs = (want) => soft(async () => { const p = await prop(); return !!p && JSON.stringify(p) === JSON.stringify(want); });
    const contactGets = () => log.filter((r) => r.fn === 'ghl-contact').map((r) => r.id);

    // 1 native
    await openThread('Ivy Imported');
    const okI = await propIs({ state: 'native', text: '417 Cedar Bend Rd, Waco, TX 76701', note: QUALIFIER });
    check('native address under the name, with the qualifier (wins over a set Property Address field)', okI, await prop());
    // 2 field
    await openThread('Fay Field');
    check('Property Address field only: shown plain, no note', await propIs({ state: 'field', text: '77 Field Only Rd', note: null }), await prop());
    // 3 none
    await openThread('Nia None');
    check('neither (city only): "The contact has no property address on record."', await propIs({ state: 'none', text: 'The contact has no property address on record.', note: null }), await prop());
    // 4 unavailable, and the thread still works
    await openThread('Uno Unread');
    const okU = await propIs({ state: 'unavailable', text: "Property address couldn't be loaded.", note: null });
    const msgU = await soft(async () => (await page.innerText('main')).includes('Fictional text from cU'));
    const replyU = await page.getByRole('link', { name: /Reply in GHL/ }).first().getAttribute('href').catch(() => null);
    check('read failed: "couldn\'t be loaded", while the messages and Reply in GHL still work', okU && msgU && !!replyU && replyU.endsWith('/contacts/detail/cU'), { p: await prop(), msgU, replyU });
    // 5 no-contact thread
    const before5 = contactGets().length;
    await openThread('No Contact Thread');
    await soft(async () => (await page.innerText('main')).includes('Fictional text from nobody'));
    check('a thread with no contact shows no property line and makes no contact read', (await prop()) === null && contactGets().length === before5, { p: await prop(), gets: contactGets() });

    // 6 stale contact read: Ivy's read held, switch to Fay, then release Ivy's
    log = [];
    const heldI = hold((r) => r.fn === 'ghl-contact' && r.id === 'cI');
    await openThread('Ivy Imported');
    const hitI = await Promise.race([heldI.hit.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    await openThread('Fay Field');
    await propIs({ state: 'field', text: '77 Field Only Rd', note: null });
    heldI.release();
    await page.waitForTimeout(700);
    const p6 = await prop();
    check('STALE: a late contact read for the previous thread never labels the current one',
      hitI && !!p6 && p6.state === 'field' && p6.text === '77 Field Only Rd' && !(await page.innerText('main')).includes('Cedar Bend'), { hitI, p6 });

    // 7 stale messages read: Ivy's messages held, switch to Fay, release Ivy's
    const heldM = hold((r) => r.fn === 'ghl-contact-conversations' && r.id === 'cI');
    await openThread('Ivy Imported');
    const hitM = await Promise.race([heldM.hit.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    await openThread('Fay Field');
    await soft(async () => (await page.innerText('main')).includes('Fictional text from cF'));
    heldM.release();
    await page.waitForTimeout(700);
    const mainText = await page.innerText('main');
    check('STALE: a late MESSAGES read for the previous thread never replaces the current thread\'s messages',
      hitM && mainText.includes('Fictional text from cF') && !mainText.includes('Fictional text from cI'), { hitM, hasF: mainText.includes('Fictional text from cF'), hasI: mainText.includes('Fictional text from cI') });

    // 8 one contact GET per selection
    const gets = contactGets();
    check('exactly one contact GET per selection, for the selected contact (Ivy, Fay, Ivy, Fay)', JSON.stringify(gets) === JSON.stringify(['cI', 'cF', 'cI', 'cF']), gets);
    // 9 no mailing text
    check('no mailing address appears anywhere on the page', !/Mailbox|Mailville|73001/.test(mainText));
    // 10 banner unchanged
    const banner = await page.evaluate(() => {
      const name = [...document.querySelectorAll('main span')].find((s) => s.textContent.trim() === 'Fay Field');
      const cs = name ? getComputedStyle(name) : null;
      return { name: !!name, size: cs && cs.fontSize, weight: cs && cs.fontWeight,
        workspace: !!document.querySelector('a[href="/contacts/cF"]'), reply: [...document.querySelectorAll('a')].some((a) => /Reply in GHL/.test(a.textContent)),
        call: [...document.querySelectorAll('a')].some((a) => /Call in GHL/.test(a.textContent)) };
    });
    check('the banner name (22px / 600), Workspace link and GHL hand-off links are unchanged',
      banner.name && banner.size === '22px' && banner.weight === '600' && banner.workspace && banner.reply && banner.call, banner);
    // 11 reads only
    check('reads only (GET), and nothing left the machine', log.every((r) => r.method === 'GET') && foreign.length === 0, { methods: [...new Set(log.map((r) => r.method))], foreign });
    // 12 no page errors
    check('no page errors', pageErrors.length === 0, pageErrors);
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
