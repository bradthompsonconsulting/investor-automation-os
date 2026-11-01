/**
 * Dashboard callback popover is VISIBLE where the operator opens it (B15 finding, 2026-10-31: the Lead Queue
 * calendar icon opened a popover that was clipped out of sight; the value was right, nobody could see it).
 *
 *   node scripts/test-dashboard-callback-popover.cjs     the suite (exact FLOOR)
 *
 * The REAL Dashboard and ContactWorkspace render on their real routes (scripts/harness/dashboard-callback-popover).
 * Every /.netlify/functions request is answered here from fictional fixtures; every write is refused (409) and
 * counted; every non-local request is aborted and counted. The browser clock is fixed (no Windows clock change).
 *
 * "Visible" is checked the way a person sees it, never with Playwright's notion of visible (an element clipped by an
 * overflow ancestor still has a box): after the click, with NO further scrolling, the point at the popover's centre
 * and five more points (the input, Save and Cancel, and two inner corners) must hit the popover itself
 * (document.elementFromPoint), inside the viewport. Then Cancel is clicked through a real mouse click at its own
 * visible point, and the popover must close with no write. Surfaces: Lead Queue (1-row and 20-row queues, first
 * and last row), Callbacks Overdue (Reschedule), and the Contact page (Set Callback / Change Callback), at two
 * viewports.
 */
'use strict';
const path = require('node:path');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/dashboard-callback-popover/index.html';
require(path.join(APP, 'scripts/harness/ts-loader.cjs'));
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const F = getConfig('test').fields;
const { createBarrierFixture } = require(path.join(APP, 'scripts/harness/current-offer-barrier-fixture.cjs'));

/* Negative controls: --mutate=<name> serves AnchoredPopover.tsx with one part of the fix undone (in memory, Vite
   transform); the run must FAIL. Each anchor must match exactly once. */
const ANCHORED = path.join(APP, 'src', 'components', 'AnchoredPopover.tsx');
const MUTATIONS = {
  'no-portal': [{ from: '  return createPortal(\n', to: '  return (\n' }, { from: '    </div>,\n    document.body,\n  );', to: '    </div>\n  );' },
    { from: 'position: "fixed", top: pos?.top ?? -10000, left: pos?.left ?? -10000,', to: 'position: "relative", top: 0, left: 0,' }],
  'no-flip': [{ from: 'if (a.bottom + GAP + h > window.innerHeight - EDGE && a.top - GAP - h >= EDGE) top = a.top - 2 * GAP - h;', to: 'void h;' }],
  'no-clamp': [{ from: 'if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, window.innerWidth - EDGE - w);', to: 'void w;' }],
  // Bones REVISE (be9ef7a) P2-1 and P2-2: the keyboard and the grown-popover corrections, undone one at a time.
  'no-focus': [{ from: '    first?.focus();\n', to: '    void first;\n' }],
  'no-tab': [{ from: 'if (e.key !== "Tab" || !anchor || !layer.current) return;', to: 'return;' }],
  'no-resize': [{ from: 'if (resized && child) resized.observe(child);', to: 'void resized;' }],
};
const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const mutationName = mutateArg ? mutateArg.slice('--mutate='.length) : null;
const mutation = mutationName ? MUTATIONS[mutationName] : null;
if (mutationName && !mutation) { console.error(`ABORT: unknown mutation ${mutationName}; known: ${Object.keys(MUTATIONS).join(', ')}`); process.exit(2); }
let mutationApplied = 0;
const mutate = { name: 'popover-mutation', enforce: 'pre', transform(code, id) {
  if (!mutation || path.resolve(id.split('?')[0]) !== ANCHORED) return null;
  let src = code.replace(/\r\n/g, '\n');
  for (const m of mutation) { const n = src.split(m.from).length - 1; if (n !== 1) throw new Error(`mutation anchor occurs ${n} times: ${m.from.slice(0, 50)}`); src = src.replace(m.from, () => m.to); }
  mutationApplied += 1; return src;
} };

const FLOOR = 59;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

/* Fictional fixtures. Queue contacts have no callback (so they sit in the Lead Queue); Sam's callback is in the
   past (so he sits in Callbacks -> Overdue). */
const SAM = 'fixtureSam', SAM_CALLBACK = '2026-10-31T01:00:00.000Z';
let people = {};
function setFixtures(queueCount) {
  people = {};
  for (let i = 1; i <= queueCount; i++) {
    const id = `fixtureQ${String(i).padStart(2, '0')}`;
    people[id] = { id, first: `Queue${String(i).padStart(2, '0')}`, last: 'Example', callback: null };
  }
  people[SAM] = { id: SAM, first: 'Sam', last: 'Sample', callback: SAM_CALLBACK };
}
const row = (p) => ({ id: p.id, firstName: p.first, lastName: p.last, phone: '+15555550142', email: '', address1: '123 Example St',
  city: 'Sampletown', state: 'TX', postalCode: '75000', dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {},
  motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null, callbackDatetime: p.callback,
  callbackDatetimePrecise: p.callback, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
const detail = (p) => ({ contact: { id: p.id, firstName: p.first, lastName: p.last, phone: '+15555550142', dndSettings: {},
  customFields: p.callback ? [{ id: F.callbackDatetimePrecise, value: p.callback }, { id: F.callbackDatetime, value: Date.parse(p.callback) }] : [] } });
const MAILERS = { weekStartCT: '2026-10-31', weekEndCT: '2026-11-06', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [],
  totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };
const bf = createBarrierFixture({ contactOf: (o) => (people[String(o).replace(/-opp$/, '')] ? String(o).replace(/-opp$/, '') : null) });

const counters = { writes: [], blocked: [], unmodelled: [] };
let expectedWrites = 0;   // the refused Saves of the error cases, each refused offline (409) and never sent
function answer(u) {
  const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, '');
  if (fn === 'ghl-contacts') return Object.values(people).map(row);
  if (fn === 'ghl-contact') { const p = people[u.searchParams.get('id')]; return p ? row(p) : undefined; }
  if (fn === 'ghl-opportunities') return { pipelineId: 'fixture-pipeline', stages: [], opportunities: Object.values(people).map((p) => ({
    id: `${p.id}-opp`, contactId: p.id, contactName: p.first, opportunityName: `${p.first} fictional deal`, phone: '', email: '', stageId: 'fixture-stage', customFields: [] })) };
  if (fn === 'ghl-conversations') return [];
  if (fn === 'ghl-mailers') return MAILERS;
  if (fn === 'ghl-underwriting-policy') return { values: [] };
  if (fn === 'ghl-contact-conversations') return { messages: [], conversations: [] };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || ''; let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return people[m[1]] ? { notes: [] } : undefined;
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return people[m[1]] ? detail(people[m[1]]) : undefined;
    if (/\/customFields\/[^/]+$/.test(p)) return { customField: { id: 'folder', name: 'Folder', position: 0 } };
    if (/\/customFields$/.test(p)) return { customFields: [] };
  }
  return undefined;
}

/* In the page: is the open popover visible to a person, with no further scrolling? */
function visibility() {
  const inputs = [...document.querySelectorAll('input[type="datetime-local"]')];
  if (inputs.length !== 1) return { ok: false, why: `popover inputs open: ${inputs.length}` };
  const pop = inputs[0].parentElement;
  const r = pop.getBoundingClientRect();
  const btn = (t) => [...pop.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
  const centre = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  const pts = { centre: [r.left + r.width / 2, r.top + r.height / 2], input: centre(inputs[0]), save: centre(btn('Save')), cancel: centre(btn('Cancel')),
    topLeft: [r.left + 6, r.top + 6], bottomRight: [r.right - 6, r.bottom - 6] };
  // A save error adds a red line at the bottom of the popover: when present, it must be visible too.
  const err = [...pop.querySelectorAll('div')].find((d) => getComputedStyle(d).color === 'rgb(248, 113, 113)' && d.textContent.trim());
  if (err) { const e = err.getBoundingClientRect(); pts.errorCentre = centre(err); pts.errorLeft = [e.left + 3, e.top + e.height / 2]; pts.errorBottom = [e.left + e.width / 2, e.bottom - 1]; }
  const misses = [];
  for (const [name, [x, y]] of Object.entries(pts)) {
    const inView = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const hit = inView ? document.elementFromPoint(x, y) : null;
    if (!inView || !hit || !pop.contains(hit)) misses.push({ point: name, x: Math.round(x), y: Math.round(y), inView, hit: hit ? `${hit.tagName}${hit.textContent ? ':' + hit.textContent.trim().slice(0, 30) : ''}` : null });
  }
  return { ok: misses.length === 0, rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }, misses,
    cancel: pts.cancel, error: err ? err.textContent.trim().slice(0, 80) : null };
}

/* In the page: where is keyboard focus? "input"/button text inside the open popover, else OUT:<tag>. */
function focusSpot() {
  const a = document.activeElement;
  const input = document.querySelector('input[type="datetime-local"]');
  const pop = input && input.parentElement;
  if (pop && a && pop.contains(a)) return a.tagName === 'INPUT' ? 'input' : a.textContent.trim();
  return `OUT:${a ? a.tagName : 'none'}`;
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [mutate, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/dashboard-callback-popover/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const pageErrors = [];
  try {
    for (const vp of [{ width: 1360, height: 900 }, { width: 1100, height: 760 }]) {
      for (const queueCount of [1, 20]) {
        setFixtures(queueCount);
        const context = await browser.newContext({ viewport: vp, timezoneId: 'America/Chicago', locale: 'en-US' });
        await context.route('**/*', async (route) => {
          const req = route.request(); const url = req.url();
          if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
          if (!url.startsWith(base)) { counters.blocked.push(url); return route.abort(); }
          if (req.method() === 'GET' && url.includes('/call-log-barrier')) { const res = await bf.handleCallLog('GET', url, null); return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) }); }
          if (req.method() !== 'GET') {
            let post = null; try { post = req.postDataJSON(); } catch { post = null; }
            const readOnly = url.includes('/property-answer') && post && ['context', 'check', 'drafts', 'history'].includes(post.action);
            if (!readOnly) counters.writes.push(`${url.replace(base, '').split('?')[0]} ${post && (post.operation || post.action)}`);
            return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'offline test: refused, nothing sent', outcome: 'not_sent' }) });
          }
          const body = answer(new URL(url));
          if (body === undefined) { counters.unmodelled.push(url.replace(base, '')); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unmodelled"}' }); }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });
        const page = await context.newPage();
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.clock.setFixedTime(new Date('2026-11-02T16:12:00Z'));
        await page.goto(`${base}${HARNESS}`);
        await page.getByText('Queue01 Example').first().waitFor({ timeout: 60000 });
        const tag = `${vp.width}x${vp.height}, ${queueCount}-row queue`;

        const openAndCheck = async (label, opener) => {
          await opener.click();
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'attached', timeout: 15000 });
          await page.waitForTimeout(150);
          const v = await page.evaluate(visibility);
          // ...and it does not cover the control that opened it (the operator can still see and reach it).
          v.openerVisible = await opener.evaluate((a) => { const b = a.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && (hit === a || a.contains(hit)); });
          check(`${label} (${tag}): the popover is visible where it opened -- centre, input, Save, Cancel and corners hit the popover, no scrolling -- and does not cover its opener`, v.ok && v.openerVisible, v);
          const w0 = counters.writes.length;
          if (v.ok) await page.mouse.click(v.cancel[0], v.cancel[1]);
          else await page.getByRole('button', { name: 'Cancel', exact: true }).click({ force: true });
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'detached', timeout: 15000 });
          check(`${label} (${tag}): Cancel at its visible point closes it and sends no write`, counters.writes.length === w0, counters.writes.slice(w0));
        };

        /* Bones REVISE P2-1: the popover is reachable and usable by keyboard. */
        const keyboardCheck = async (label, opener, expected) => {
          const w0 = counters.writes.length;
          await opener.focus();
          await page.keyboard.press('Enter');
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'attached', timeout: 15000 });
          await page.waitForTimeout(150);
          check(`${label} (${tag}) keyboard: Enter on the control opens the popover with focus inside it`, (await page.evaluate(focusSpot)) === 'input', await page.evaluate(focusSpot));
          // Chromium's datetime-local keeps focus while Tab walks its own segments (month, day, year, hour, minute,
          // AM/PM): step past those first (capped), then record the popover's controls and the stop after them.
          let segments = 0;
          while ((await page.evaluate(focusSpot)) === 'input' && segments < 12) { await page.keyboard.press('Tab'); segments += 1; }
          const seq = [await page.evaluate(focusSpot)];
          for (let i = 1; i < expected.length + 1; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(focusSpot)); }
          check(`${label} (${tag}) keyboard: Tab reaches every popover control in order (${expected.join(', ')})`, JSON.stringify(seq.slice(0, expected.length)) === JSON.stringify(expected), seq);
          const after = await opener.evaluate((a) => { const f = document.activeElement; return !!f && f !== document.body && f !== a && !!(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING); });
          check(`${label} (${tag}) keyboard: Tab past the last control continues to the control after the opener (not the page top, not lost)`, seq[expected.length].startsWith('OUT:') && after, { seq, after });
          await page.locator('input[type="datetime-local"]').focus();
          await page.keyboard.press('Shift+Tab');
          check(`${label} (${tag}) keyboard: Shift+Tab from the first control returns to the opener`, await opener.evaluate((a) => document.activeElement === a));
          await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
          await page.keyboard.press('Enter');
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'detached', timeout: 15000 });
          check(`${label} (${tag}) keyboard: Enter on Cancel closes it and focus returns to the opener`, await opener.evaluate((a) => document.activeElement === a));
          check(`${label} (${tag}) keyboard: no write`, counters.writes.length === w0, counters.writes.slice(w0));
        };
        /* Bones REVISE P2-2: a save error grows the popover; the grown popover stays fully visible. The save is refused
           by the offline interceptor (409, nothing sent), which is a callback-stage failure: the popover stays open. */
        const errorCheck = async (label, opener) => {
          const w0 = counters.writes.length;
          await opener.click();
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'attached', timeout: 15000 });
          await page.waitForTimeout(150);
          await page.getByRole('button', { name: 'Save', exact: true }).click({ force: true });
          await page.waitForFunction(() => { const i = document.querySelector('input[type="datetime-local"]'); return !!i &&
            [...i.parentElement.querySelectorAll('div')].some((d) => getComputedStyle(d).color === 'rgb(248, 113, 113)' && d.textContent.trim()); }, null, { timeout: 15000 });
          await page.waitForTimeout(200);
          const v = await page.evaluate(visibility);
          check(`${label} (${tag}) after a refused Save: the grown popover, including its error line, is fully visible`, v.ok && !!v.error, v);
          if (v.ok) await page.mouse.click(v.cancel[0], v.cancel[1]); else await page.getByRole('button', { name: 'Cancel', exact: true }).click({ force: true });
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'detached', timeout: 15000 });
          const mine = counters.writes.slice(w0);
          expectedWrites += mine.length;
          check(`${label} (${tag}) after a refused Save: exactly one write was attempted (the callback), refused offline, nothing sent; Cancel closes`, mine.length === 1 && /callback/i.test(mine[0]), mine);
        };

        /* P2-2 at the edge: the opener sits so the popover JUST fits below it (fewer than 20 px to spare above the
           window's bottom margin). The error line (about 20 px) then cannot fit unless the popover is placed again. The
           precondition is asserted so this case cannot silently stop testing what it claims. */
        const edgeErrorCheck = async (label, opener) => {
          const h0 = 86, spare = 10;   // the popover's measured height without an error line; the slack left below it
          const target = vp.height - 8 - 4 - h0 - spare;
          await opener.scrollIntoViewIfNeeded();
          const want = async () => (await opener.boundingBox()).y + (await opener.boundingBox()).height - target;
          await page.evaluate((d) => window.scrollBy(0, d), await want());
          let d = await want();
          if (Math.abs(d) > 1) await opener.evaluate((el, dy) => { let p = el.parentElement; while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement; if (p) p.scrollTop += dy; }, d);
          d = await want();
          const w0 = counters.writes.length;
          await opener.click({ noWaitAfter: true, trial: false, force: true });
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'attached', timeout: 15000 });
          await page.waitForTimeout(150);
          const pre = await opener.evaluate((a) => { const i = document.querySelector('input[type="datetime-local"]'); const r = i.parentElement.getBoundingClientRect(); const b = a.getBoundingClientRect();
            return { below: r.top >= b.bottom, spareBelow: Math.round(innerHeight - r.bottom), h: Math.round(r.height) }; });
          check(`${label} (${tag}) edge precondition: the popover opened BELOW its opener with under 20 px to spare (so an error line cannot fit as placed)`, Math.abs(d) <= 1 && pre.below && pre.spareBelow >= 0 && pre.spareBelow < 8 + 20, { d, pre });
          await page.getByRole('button', { name: 'Save', exact: true }).click({ force: true });
          await page.waitForFunction(() => { const i = document.querySelector('input[type="datetime-local"]'); return !!i &&
            [...i.parentElement.querySelectorAll('div')].some((x) => getComputedStyle(x).color === 'rgb(248, 113, 113)' && x.textContent.trim()); }, null, { timeout: 15000 });
          await page.waitForTimeout(200);
          const v = await page.evaluate(visibility);
          check(`${label} (${tag}) edge: after a refused Save the grown popover, including its error line, is fully visible`, v.ok && !!v.error, v);
          if (v.ok) await page.mouse.click(v.cancel[0], v.cancel[1]); else await page.getByRole('button', { name: 'Cancel', exact: true }).click({ force: true });
          await page.locator('input[type="datetime-local"]').waitFor({ state: 'detached', timeout: 15000 });
          const mine = counters.writes.slice(w0);
          expectedWrites += mine.length;
          check(`${label} (${tag}) edge: exactly one write was attempted (the callback), refused offline, nothing sent; Cancel closes`, mine.length === 1 && /callback/i.test(mine[0]), mine);
        };

        const queueIcons = page.locator('button[title="Schedule a callback"]');
        const n = await queueIcons.count();
        check(`Lead Queue (${tag}) lists every fictional queue contact with a calendar icon`, n === queueCount, { n, queueCount });
        await openAndCheck('Lead Queue first row', queueIcons.first());
        if (queueCount > 1) await openAndCheck('Lead Queue last row', queueIcons.last());
        const reschedule = page.getByRole('button', { name: 'Reschedule', exact: true }).first();
        if (vp.width === 1360) {
          await keyboardCheck('Lead Queue first row', queueIcons.first(), ['Save', 'Cancel']);
          if (queueCount === 1) await keyboardCheck('Callbacks Overdue (Reschedule)', reschedule, ['Save', 'Clear', 'Cancel']);
        }
        await errorCheck(queueCount === 1 ? 'Lead Queue first row' : 'Lead Queue last row', queueCount === 1 ? queueIcons.first() : queueIcons.last());
        if (vp.width === 1360 && queueCount === 1) await errorCheck('Callbacks Overdue (Reschedule)', reschedule);
        if (queueCount > 1) await edgeErrorCheck('Lead Queue row placed at the edge', queueIcons.nth(9));
        if (vp.width === 1360) {
          await openAndCheck('Callbacks Overdue (Reschedule)', page.getByRole('button', { name: 'Reschedule', exact: true }).first());
          if (queueCount === 1) {
            await page.evaluate(() => window.__iaosNavigate('/contacts/fixtureQ01'));
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Set Callback/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
            await openAndCheck('Contact page Set Callback', page.getByRole('button', { name: /Set Callback/ }));
            await page.evaluate(() => window.__iaosNavigate('/contacts/fixtureSam'));
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Change Callback/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
            await openAndCheck('Contact page Change Callback', page.getByRole('button', { name: /Change Callback/ }));
          }
        }
        await context.close();
      }
    }
    check('no write except the refused-Save cases (each refused offline, nothing sent), no external request, no unmodelled read and no page error in the whole run',
      counters.writes.length === expectedWrites && expectedWrites === 7 && counters.blocked.length === 0 && counters.unmodelled.length === 0 && pageErrors.length === 0,
      { expectedWrites, counters, pageErrors });
  } catch (e) {
    failures += 1; console.error('FAIL  run aborted: ' + (e && e.stack || e));
  }
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${mutation ? ` mutation=${mutationName} applied=${mutationApplied}` : ""}`);
  if (mutation && mutationApplied < 1) { console.error("ABORT: the mutation was not applied"); process.exit(2); }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}`); process.exit(failures ? 1 : 2); }
  console.log(failures ? 'FAILED' : 'OK');
  process.exit(failures ? 1 : 0);
}
main();
