/**
 * B15-17 (INV-126), Pass 1 F11 + F50 -- two engineer-facing labels.
 *
 *   F11  the shell header showed a "Phase A" build-phase badge;
 *   F50  the sidebar and header say "Conversations", the page heading said
 *        "History".
 *
 * Behaviour, rendered. Vite serves scripts/harness/shell-labels -- the REAL
 * Layout around the REAL Conversations page with the real GHL client -- in
 * headless Chromium; every /.netlify/functions request is answered here.
 * Proves: no "Phase A" anywhere on two routes; the Conversations heading
 * matches the sidebar and header and is not clipped beside its Read-only
 * pill; a thread still opens with its messages and its Reply in GHL link; the
 * page only reads.
 *
 * NEGATIVE CONTROL: `node scripts/test-b15-shell-labels.cjs --before=<rev>`
 * renders <rev>'s Header and Conversations page and must FAIL (exit 1) for a
 * revision with the old labels -- e.g. --before=4e4e7f9.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/shell-labels');
const HARNESS = '/scripts/harness/shell-labels/index.html';
const BEFORE_FILES = ['HeaderBefore.tsx', 'LayoutBefore.tsx', 'ConversationsBefore.tsx'].map((f) => path.join(HARNESS_DIR, f));
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 8;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const removeBefore = () => BEFORE_FILES.forEach((f) => { if (fs.existsSync(f)) fs.rmSync(f); });
removeBefore();
if (BEFORE_REV) {
  const show = (p) => execFileSync('git', ['show', `${BEFORE_REV}:app/${p}`], { cwd: APP, encoding: 'utf8' });
  const toSrc = (src, dir) => src.replace(/from "\.\.\//g, 'from "../../../src/').replace(/from "\.\//g, `from "../../../src/${dir}/`);
  fs.writeFileSync(BEFORE_FILES[0], toSrc(show('src/components/Header.tsx'), 'components'));
  fs.writeFileSync(BEFORE_FILES[1], toSrc(show('src/components/Layout.tsx'), 'components').replace('from "../../../src/components/Header"', 'from "./HeaderBefore"'));
  fs.writeFileSync(BEFORE_FILES[2], toSrc(show('src/pages/Conversations.tsx'), 'pages'));
  console.log(`NEGATIVE CONTROL: rendering the Header and Conversations page from ${BEFORE_REV}; this run must fail.`);
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const CONTACT = 'fixtureContactK1';
const THREADS = [{ conversationId: 'conv-1', contactId: CONTACT, contactName: 'Kay Fixture', phone: '+15555550100', email: 'kay@example.com',
  lastMessageDate: Date.parse('2026-10-07T15:00:00Z'), lastMessageDirection: 'inbound', preview: 'About the house', unreadCount: 0 }];
const MESSAGES = { contactId: CONTACT, conversationCount: 1, messages: [
  { id: 'm1', conversationId: 'conv-1', contactId: CONTACT, direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: 'Is the offer still open?', dateAdded: '2026-10-07T15:00:00.000Z' },
] };
const log = [];
const foreign = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => {
    clearTimeout(watchdog);
    await browser.close().catch(() => {}); await server.close().catch(() => {});
    removeBefore();
    process.exit(code);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      const method = route.request().method();
      log.push(`${method} ${fn}`);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (method !== 'GET') return json(405, { error: 'fixture: reads only' });
      if (fn === 'ghl-conversations') return json(200, THREADS);
      if (fn === 'ghl-contact-conversations') return json(200, MESSAGES);
      if (fn === 'ghl-proxy') return json(200, { notes: [] });
      return json(404, { error: `fixture: ${fn} not answered` });
    });

    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    check('harness renders the expected Header and Conversations source', (await page.evaluate(() => window.__iaosShellSource)) === (BEFORE_REV ? 'before' : 'current'));

    await go('/elsewhere');
    await page.getByTestId('elsewhere').waitFor();
    const phaseElsewhere = (await page.innerText('body')).includes('Phase A');
    await go('/conversations');
    await page.getByText('Kay Fixture').first().waitFor({ timeout: 30000 });
    const phaseConversations = (await page.innerText('body')).includes('Phase A');
    check('no "Phase A" badge anywhere, on either route', !phaseElsewhere && !phaseConversations, { phaseElsewhere, phaseConversations });

    const labels = {
      sidebar: (await page.locator('aside a[href="/conversations"]').innerText()).trim(),
      header: (await page.locator('header h2').innerText()).trim(),
      heading: (await page.locator('main h1').first().innerText()).trim(),
    };
    check('the page heading reads "Conversations", matching the sidebar and header',
      labels.heading === 'Conversations' && labels.sidebar === labels.heading && labels.header === labels.heading, labels);
    check('no heading says "History"', (await page.locator('main h1', { hasText: /^History$/ }).count()) === 0);

    const fit = await page.locator('main h1').first().evaluate((h1) => {
      const box = h1.parentElement.getBoundingClientRect();
      const pill = [...h1.parentElement.children].find((el) => el.textContent.trim() === 'Read-only');
      const p = pill ? pill.getBoundingClientRect() : null;
      return { headingClipped: h1.scrollWidth > h1.clientWidth || h1.getBoundingClientRect().right > box.right + 0.5,
        pillVisible: !!p && p.right <= box.right + 0.5 && p.width > 0 };
    });
    check('the heading is not clipped and its Read-only pill stays fully visible', !fit.headingClipped && fit.pillVisible, fit);

    await page.getByText('Kay Fixture').first().click();
    await page.getByText('Is the offer still open?').first().waitFor({ timeout: 30000 });
    const reply = await page.getByRole('link', { name: /Reply in GHL/ }).first().getAttribute('href');
    check('opening a thread still shows its messages and its Reply in GHL link to that contact',
      !!reply && reply.endsWith(`/contacts/detail/${CONTACT}`), reply);

    check('the page only reads (GET), and nothing left the machine', log.every((r) => r.startsWith('GET ')) && foreign.length === 0, { log: [...new Set(log)], foreign });
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
