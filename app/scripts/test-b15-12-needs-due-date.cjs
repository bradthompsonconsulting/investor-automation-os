/**
 * Board 15 item 12 (Captain GO 2026-11-18) -- Mailers: undated tasks under "Needs due date"; dotted L.L.C. matching.
 *
 * Offline, synthetic, FICTIONAL records only. Nothing leaves the machine:
 *   S. the REAL classifier (netlify/functions/lib/mailer-shared.ts buildMailerDigest) with a fake GHL fetch, `now`
 *      Wed 2026-11-18 12:00 CT (window Sat 11-14 .. Fri 11-20): every incomplete row in exactly one list; an addressed
 *      task with no (or an unreadable) due date -> needsDueDate, never Overdue; No Address unchanged and first; the
 *      four existing lists unchanged; the address1-only address rule unchanged; L.L.C. variants business-flagged with
 *      no new false positives.
 *   D. the REAL Friday digest (netlify/functions/mailer-digest.ts handler) with global fetch stubbed: GHL reads answered
 *      locally, the Resend POST CAPTURED and answered locally (never sent); the email lists the Needs due date rows and
 *      count, and those rows are not under Overdue.
 *   P. the REAL Mailers page (scripts/harness/mailers) in headless Chromium, serving the digest from S: the "Needs due
 *      date" section lists exactly the undated rows (no checkboxes), no row appears in two sections; 0 non-GET.
 *
 * NEGATIVE CONTROL: run with this branch's source changes reverted (base c7b09bc) -- it must FAIL.
 *
 *   node scripts/test-b15-12-needs-due-date.cjs
 */
'use strict';
process.env.IAOS_ENV = process.env.IAOS_ENV || 'test';
const path = require('node:path');
const fs = require('node:fs');
require('./harness/ts-loader.cjs');
const APP = path.resolve(__dirname, '..');
const M = require(path.join(APP, 'netlify/functions/lib/mailer-shared.ts'));

const FLOOR = 38;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
}

const NOW = new Date('2026-11-18T18:00:00.000Z');
const addr = (street) => ({ address1: street, city: 'Austin', state: 'TX', postalCode: '78701' });
const C = (id, name, a, extra) => Object.assign({ id, contactName: name, companyName: null }, a, extra || {});
const T = (id, title, dueDate, completed = false) => ({ id, title, dueDate, completed });
const contacts = [
  C('c-ready', 'Jane Ready', addr('1 Ready St')),
  C('c-biz', 'Woodleigh Holdings LLC', addr('3 Biz St')),
  C('c-overdue', 'Olive Overdue', addr('4 Late St')),
  C('c-noaddr', 'Nora Noaddress', { address1: '', city: 'Austin', state: 'TX', postalCode: '78701' }),
  C('u-undated', 'Dee Nodue', addr('20 Undated St')),
  C('u-unreadable', 'Una Readable', addr('21 Undated St')),
  C('u-undated-biz', 'Acme Rentals LLC', addr('22 Undated St')),
  C('u-undated-noaddr', 'Ned Nowhere', { address1: '  ', city: '', state: '', postalCode: '' }),
  C('u-undated-done', 'Dan Done', addr('23 Undated St')),
  C('s-street-only', 'Stu Streetonly', { address1: '24 Probe St', city: '', state: '', postalCode: '' }),
  C('l-end', 'Smith Family L.L.C.', addr('30 Llc St')),
  C('l-mid', 'Smith L.L.C. Trust', addr('31 Llc St')),
  C('l-lower', 'jones l.l.c.', addr('32 Llc St')),
  C('l-comma', 'Brown L.L.C., Managing Member', addr('33 Llc St')),
  C('n-incorvaia', 'Vince Incorvaia', addr('40 Person St')),
  C('n-alpine', 'Alpine Smith', addr('41 Person St')),
  C('n-ltdx', 'Ltdson Jones', addr('42 Person St')),
];
const tasks = {
  'c-ready': [T('t-ready', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'c-biz': [T('t-biz', 'Low mail — Touch 1 (PRIMARY)', '2026-11-19T15:00:00.000Z')],
  'c-overdue': [T('t-overdue', 'Low mail — Touch 3 (POSTCARD)', '2026-11-10T15:00:00.000Z')],
  'c-noaddr': [T('t-noaddr', 'Hot mail — Touch 2 (POSTCARD)', '2026-11-18T15:00:00.000Z')],
  'u-undated': [T('t-undated', 'Hot mail — Touch 1 (PRIMARY)', undefined)],
  'u-unreadable': [T('t-unreadable', 'Warm mail — Touch 2 (POSTCARD)', 'not-a-date')],
  'u-undated-biz': [T('t-undated-biz', 'Warm mail — Touch 1 (PRIMARY)', '')],
  'u-undated-noaddr': [T('t-undated-noaddr', 'Hot mail — Touch 1 (PRIMARY)', null)],
  'u-undated-done': [T('t-undated-done', 'Hot mail — Touch 1 (PRIMARY)', undefined, true)],
  's-street-only': [T('t-street-only', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'l-end': [T('t-l-end', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'l-mid': [T('t-l-mid', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'l-lower': [T('t-l-lower', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'l-comma': [T('t-l-comma', 'Hot mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'n-incorvaia': [T('t-n-incorvaia', 'Warm mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'n-alpine': [T('t-n-alpine', 'Warm mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
  'n-ltdx': [T('t-n-ltdx', 'Warm mail — Touch 1 (PRIMARY)', '2026-11-18T15:00:00.000Z')],
};
/* Negative-control aid only: the base classifier THROWS on the unreadable date, which would stop the run before the
   other checks. B1512_CONTROL_DROP_UNREADABLE=1 removes that one record so the remaining checks also run on base. */
if (process.env.B1512_CONTROL_DROP_UNREADABLE) delete tasks['u-unreadable'];
const RECIPIENT = 'digest-recipient@example.invalid';
function ghlAnswer(u) {
  if (u.pathname === '/contacts') return { contacts, meta: {} };
  const m = /^\/contacts\/([^/]+)\/tasks$/.exec(u.pathname);
  if (m) return { tasks: tasks[m[1]] || [] };
  if (/^\/locations\/[^/]+\/customValues\/[^/]+$/.test(u.pathname)) return { customValue: { value: RECIPIENT } };
  return null;
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

(async () => {
  /* ── S. classifier ── */
  const ghlCalls = [];
  const fakeFetch = async (url, init) => {
    const u = new URL(String(url)); ghlCalls.push(`${(init && init.method) || 'GET'} ${u.hostname}${u.pathname}`);
    const body = u.hostname === 'services.leadconnectorhq.com' ? ghlAnswer(u) : null;
    return body ? resp(200, body) : resp(404, { error: 'unmodelled' });
  };
  let d = null, threw = null;
  try { d = await M.buildMailerDigest('synthetic-token', NOW, fakeFetch); } catch (e) { threw = String(e); }
  check('S: the digest builds (an unreadable due date no longer throws)', !!d && threw === null, threw);
  if (!d) { console.log(`\nB15-12 needs due date: ${checks - failures}/${checks} checks passed (stopped: no digest)`); process.exit(1); }
  const ids = (groups) => groups.flatMap((g) => g.rows).map((r) => r.contactId).sort();
  const sec = { ready: ids(d.thisWeekReady), business: ids(d.thisWeekBusiness), overdue: ids(d.overdue), noAddress: d.noAddress.map((r) => r.contactId).sort(), needsDueDate: (d.needsDueDate || []).map((r) => r.contactId).sort() };
  const where = (id) => Object.entries(sec).filter(([, v]) => v.includes(id)).map(([k]) => k);
  console.log(`NOTE  sections ${JSON.stringify(sec)}`);
  check('S: the digest has a needsDueDate list and count', Array.isArray(d.needsDueDate) && d.totals.needsDueDate === sec.needsDueDate.length, { has: Array.isArray(d.needsDueDate), total: d.totals.needsDueDate });
  check('S: addressed, no due date -> Needs due date only (not Overdue)', JSON.stringify(where('u-undated')) === '["needsDueDate"]', where('u-undated'));
  check('S: addressed, unreadable due date -> Needs due date only', JSON.stringify(where('u-unreadable')) === '["needsDueDate"]', where('u-unreadable'));
  check('S: business-named, empty due date -> Needs due date only (not Business-Flagged)', JSON.stringify(where('u-undated-biz')) === '["needsDueDate"]', where('u-undated-biz'));
  check('S: no address AND no due date -> No Address only (existing rule first)', JSON.stringify(where('u-undated-noaddr')) === '["noAddress"]', where('u-undated-noaddr'));
  check('S: a completed undated task appears nowhere', where('u-undated-done').length === 0, where('u-undated-done'));
  check('S: Overdue holds only dated rows', d.overdue.flatMap((g) => g.rows).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.dueDateCT)), sec.overdue);
  check('S: Ready unchanged', JSON.stringify(where('c-ready')) === '["ready"]', where('c-ready'));
  check('S: Business-Flagged unchanged', JSON.stringify(where('c-biz')) === '["business"]', where('c-biz'));
  check('S: Overdue unchanged', JSON.stringify(where('c-overdue')) === '["overdue"]', where('c-overdue'));
  check('S: No Address unchanged', JSON.stringify(where('c-noaddr')) === '["noAddress"]', where('c-noaddr'));
  check('S: address rule unchanged -- a street with no city/state/ZIP still counts as addressed (Ready)', JSON.stringify(where('s-street-only')) === '["ready"]', where('s-street-only'));
  const all = Object.values(sec).flat();
  check('S: no row is in more than one list', all.length === new Set(all).size, all);
  const incompleteRows = Object.keys(tasks).filter((k) => !tasks[k].every((t) => t.completed));
  const due = (k) => tasks[k][0].dueDate; const future = (k) => typeof due(k) === 'string' && due(k) > '2026-11-21T06:00:00.000Z';
  check('S: every incomplete row lands in exactly one list (none dropped)', incompleteRows.filter((k) => !future(k)).every((k) => where(k).length === 1), incompleteRows.map((k) => [k, where(k)]));
  check('S: totals equal the list lengths', d.totals.ready === sec.ready.length && d.totals.business === sec.business.length && d.totals.overdue === sec.overdue.length && d.totals.noAddress === sec.noAddress.length, d.totals);
  check('S L.L.C.: at the end of the name -> Business-Flagged', JSON.stringify(where('l-end')) === '["business"]', where('l-end'));
  check('S L.L.C.: followed by a word -> Business-Flagged', JSON.stringify(where('l-mid')) === '["business"]', where('l-mid'));
  check('S L.L.C.: lower case -> Business-Flagged', JSON.stringify(where('l-lower')) === '["business"]', where('l-lower'));
  check('S L.L.C.: followed by a comma -> Business-Flagged', JSON.stringify(where('l-comma')) === '["business"]', where('l-comma'));
  check('S no new false positive: "Vince Incorvaia" (Inc inside a word) -> Ready', JSON.stringify(where('n-incorvaia')) === '["ready"]', where('n-incorvaia'));
  check('S no new false positive: "Alpine Smith" (LP inside a word) -> Ready', JSON.stringify(where('n-alpine')) === '["ready"]', where('n-alpine'));
  check('S no new false positive: "Ltdson Jones" (LTD at a word start) -> Ready', JSON.stringify(where('n-ltdx')) === '["ready"]', where('n-ltdx'));
  check('S: the classifier only READ GHL', ghlCalls.every((c) => c.startsWith('GET services.leadconnectorhq.com/contacts')), ghlCalls);

  /* ── D. Friday digest email (Resend captured, never sent) ── */
  const realFetch = globalThis.fetch;
  const sent = [], refused = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)); const method = (init && init.method) || 'GET';
    if (u.hostname === 'services.leadconnectorhq.com' && method === 'GET') { const b = ghlAnswer(u); return b ? resp(200, b) : resp(404, { error: 'unmodelled' }); }
    if (u.hostname === 'api.resend.com' && method === 'POST') { sent.push(JSON.parse(init.body)); return resp(200, { id: 'captured-not-sent' }); }
    refused.push(`${method} ${u.href}`); return resp(599, { error: 'offline test refuses' });
  };
  const env = { GHL_PRIVATE_API_KEY: process.env.GHL_PRIVATE_API_KEY, RESEND_API_KEY: process.env.RESEND_API_KEY };
  process.env.GHL_PRIVATE_API_KEY = 'synthetic-token'; process.env.RESEND_API_KEY = 'synthetic-resend-key';
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW.getTime()])); } static now() { return NOW.getTime(); } };
  let result = null;
  try { result = await require(path.join(APP, 'netlify/functions/mailer-digest.ts')).handler({}); }
  finally { global.Date = RealDate; globalThis.fetch = realFetch; process.env.GHL_PRIVATE_API_KEY = env.GHL_PRIVATE_API_KEY ?? ''; process.env.RESEND_API_KEY = env.RESEND_API_KEY ?? ''; if (!env.GHL_PRIVATE_API_KEY) delete process.env.GHL_PRIVATE_API_KEY; if (!env.RESEND_API_KEY) delete process.env.RESEND_API_KEY; }
  check('D: the digest handler ran to its (captured) send', !!result && result.statusCode === 200 && sent.length === 1, { status: result && result.statusCode, body: result && result.body, sent: sent.length });
  check('D: nothing else left the process (no other request)', refused.length === 0, refused);
  const email = sent[0] || { html: '', subject: '', to: [] };
  const html = email.html;
  const outDir = process.env.B1512_OUT || path.join(require('node:os').tmpdir(), 'b15-12-needs-due-date');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'friday-digest-email.html'), `<!doctype html><meta charset="utf-8"><title>Friday digest (captured)</title><p style="font-family:monospace">subject: ${email.subject}</p>${html}`);
  const sectionOf = (title, nextTitles) => { const a = html.indexOf(`>${title}</h2>`); if (a < 0) return ''; const ends = nextTitles.map((t) => html.indexOf(`>${t}</h2>`, a)).filter((i) => i > a); return html.slice(a, ends.length ? Math.min(...ends) : html.indexOf('This is a heads-up only', a)); };
  const nddHtml = sectionOf('Needs due date', []);
  const overdueHtml = sectionOf('Overdue', ['Needs due date']);
  check('D: the email has a "Needs due date" section', nddHtml.length > 0);
  check('D: it lists every undated addressed row', ['Dee Nodue', 'Una Readable', 'Acme Rentals LLC'].every((n) => nddHtml.includes(n)), nddHtml.slice(0, 300));
  check('D: it lists no dated or no-address row', !['Jane Ready', 'Olive Overdue', 'Ned Nowhere', 'Nora Noaddress', 'Dan Done'].some((n) => nddHtml.includes(n)));
  check('D: undated rows are no longer under Overdue in the email', !['Dee Nodue', 'Una Readable', 'Acme Rentals LLC'].some((n) => overdueHtml.includes(n)) && overdueHtml.includes('Olive Overdue'), overdueHtml.slice(0, 300));
  check('D: the header shows the Needs due date count', html.includes('Needs due date: <strong>3</strong>'));
  check('D: "Smith Family L.L.C." is under Business-Flagged in the email', sectionOf('This Week — Business-Flagged', ['Overdue']).includes('Smith Family L.L.C.'));

  /* ── P. rendered page ── */
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const HARNESS = '/scripts/harness/mailers/index.html';
  const server = await createServer({ root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    const nonGet = [], foreign = [], pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (rt) => {
      const r = rt.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return rt.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (r.method() !== 'GET') { nonGet.push(`${r.method()} ${fn}`); return json(405, { error: 'refused' }); }
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(NOW.getTime() + 3600_000).toISOString() });
      if (fn === 'ghl-mailers') return json(200, d);
      return json(404, { error: 'unmodelled' });
    });
    await page.goto(`${base}${HARNESS}`, { timeout: 120000 });
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/mailers'));
    await page.getByRole('heading', { name: 'No Address' }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    const rendered = await page.evaluate(() => {
      const res = {};
      for (const h of document.querySelectorAll('h2')) {
        const t = h.textContent.trim();
        const key = /Ready to Mail/.test(t) ? 'ready' : /Business-Flagged/.test(t) ? 'business' : /^Overdue/.test(t) ? 'overdue' : t === 'No Address' ? 'noAddress' : t === 'Needs due date' ? 'needsDueDate' : null;
        if (!key) continue;
        const root = h.parentElement.parentElement;
        res[key] = { ids: [...root.querySelectorAll('[data-testid="mailers-contact-link"]')].map((a) => a.getAttribute('data-contact-id')).sort(), checkboxes: root.querySelectorAll('svg.lucide-square, svg.lucide-square-check-big, svg.lucide-check-square, input[type="checkbox"], [role="checkbox"]').length };
      }
      res.order = [...document.querySelectorAll('h2')].map((h) => h.textContent.trim());
      return res;
    });
    console.log(`NOTE  rendered ${JSON.stringify(rendered)}`);
    await page.screenshot({ path: path.join(outDir, 'mailers-page.png'), fullPage: true });
    check('P: the page shows a "Needs due date" section listing exactly the undated rows', !!rendered.needsDueDate && JSON.stringify(rendered.needsDueDate.ids) === JSON.stringify(sec.needsDueDate), rendered.needsDueDate);
    check("P: Needs due date is informational (no checkboxes), like No Address; the detector does find Ready's checkboxes", !!rendered.needsDueDate && rendered.needsDueDate.checkboxes === 0 && !!rendered.ready && rendered.ready.checkboxes > 0, { ndd: rendered.needsDueDate && rendered.needsDueDate.checkboxes, ready: rendered.ready && rendered.ready.checkboxes });
    check('P: each other section lists exactly its classifier rows', ['ready', 'business', 'overdue', 'noAddress'].every((k) => rendered[k] && JSON.stringify(rendered[k].ids) === JSON.stringify(sec[k])), rendered);
    const pageAll = ['ready', 'business', 'overdue', 'noAddress', 'needsDueDate'].flatMap((k) => (rendered[k] ? rendered[k].ids : []));
    check('P: no contact row appears in two sections on the page', pageAll.length === new Set(pageAll).size, pageAll);
    check('P: section order -- Overdue, then Needs due date, then No Address', (() => { const o = rendered.order || []; const i = (t) => o.findIndex((x) => x === t || x.startsWith(t)); return i('Overdue') < i('Needs due date') && i('Needs due date') < i('No Address') && i('Overdue') >= 0; })(), rendered.order);
    check('P: zero non-GET, zero foreign requests, zero page errors', nonGet.length === 0 && foreign.length === 0 && pageErrors.length === 0, { nonGet, foreign, pageErrors });
  } finally { await browser.close(); await server.close(); }

  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
  console.log(`\nB15-12 needs due date: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL  crashed', e); process.exit(2); });
