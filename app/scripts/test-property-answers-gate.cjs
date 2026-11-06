/**
 * Board 15 R0b P2 (Bones, Production backlog review 2026-11-05) — the "Property answers (Test
 * evaluation)" panel, including its multi-deal selector, must not mount on the Contact page unless
 * the server-projected capability (runtime `propertyAnswerRecovery.enabled`: Test AND the evaluation
 * sentinel exactly ENABLED) says the evaluation applies to this deployment.
 *
 * Offline. Vite serves scripts/harness/property-answers-gate (the REAL ContactWorkspace with the
 * real GHL client) in headless Chromium under three runtime projections:
 *   production   -- Production as committed (IAOS_ENV=production);
 *   test         -- Test as committed (evaluation DISABLED);
 *   test-enabled -- Test with ONLY the evaluation sentinel set to ENABLED (positive control).
 * Contacts: Z (no deals), S (one deal), M (two deals), T (three deals). Every /.netlify/functions
 * request is answered here from an in-memory fixture; property-answer requests are counted and
 * refused (403). Anything not local is aborted and counted. No write is expected anywhere.
 *
 * Proves: in production and committed Test, no contact (0/1/2/3 deals) shows the selector or any
 * "Property answers" text, and the page sends ZERO property-answer requests, while the rest of the
 * Contact page (name, notes, deal stage) still renders. In test-enabled, the multi-deal selector is
 * offered with exactly this contact's deals, and a single-deal contact mounts the panel (its context
 * request is sent) -- the existing Test behaviour is unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const G = require(path.join(APP, 'shared/ghl-config.ts'));

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// The committed projections this test relies on (server side, same functions iaos-runtime-config uses).
check('committed Production projects the evaluation capability OFF',
  G.projectRuntimeConfig(G.getConfig('production'), 'production').propertyAnswerRecovery.enabled === false);
check('committed Test projects the evaluation capability OFF (evaluation DISABLED)',
  G.projectRuntimeConfig(G.getConfig('test'), 'test').propertyAnswerRecovery.enabled === false);
{
  const cfg = JSON.parse(JSON.stringify(G.getConfig('test'))); cfg.propertyAnswerEvaluation.enabled = G.PROPERTY_ANSWER_EVALUATION_ENABLED;
  check('Test with the evaluation ENABLED projects the capability ON', G.projectRuntimeConfig(cfg, 'test').propertyAnswerRecovery.enabled === true);
  check('the same ENABLED config projected for production stays OFF', G.projectRuntimeConfig(cfg, 'production').propertyAnswerRecovery.enabled === false);
}

const CONTACTS = {
  fxGateZ: { first: 'Zulu', deals: 0 },
  fxGateS: { first: 'Sierra', deals: 1 },
  fxGateM: { first: 'Mike', deals: 2 },
  fxGateT: { first: 'Tango', deals: 3 },
};
const STAGES = [{ id: 'stage-new', name: 'New Lead - Seller', position: 0 }];
const pipeline = () => ({
  pipelineId: 'fixture-pipeline', stages: STAGES,
  opportunities: Object.entries(CONTACTS).flatMap(([id, c]) => Array.from({ length: c.deals }, (_, i) => ({
    id: `${id}-opp${i + 1}`, contactId: id, contactName: c.first, opportunityName: `${c.first} deal ${i + 1}`,
    phone: '', email: '', stageId: 'stage-new', customFields: [] }))),
});
const row = (id) => ({ id, firstName: CONTACTS[id].first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
const detail = (id) => ({ contact: { id, firstName: CONTACTS[id].first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {}, customFields: [] } });

let log = [];
function classify(url, method) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write' };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'notes': return { status: 200, body: { notes: [{ id: `${req.contact}-n1`, body: `Seed note for ${CONTACTS[req.contact].first}`, dateAdded: '2026-09-30T12:00:00.000Z' }] } };
    case 'detail': return { status: 200, body: detail(req.contact) };
    case 'row': return { status: 200, body: row(req.contact) };
    case 'defs': return { status: 200, body: { customFields: [] } };
    case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    // The server refuses outside the controlled evaluation; the panel hides itself on a refusal.
    // The server's exact refusal when the evaluation is not enabled (property-answer.ts, evaluation_disabled).
    case 'property-answer': return { status: 403, body: { outcome: 'not_sent', code: 'evaluation_disabled', error: 'Property answers are not enabled in this environment' } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/property-answers-gate/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [];
  const pageErrors = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    for (const env of ['production', 'test', 'test-enabled']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
      page.on('pageerror', (e) => pageErrors.push(`${env}: ${String(e)}`));
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
        if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
        const req = classify(url, route.request().method());
        log.push(req);
        const res = answer(req);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      });
      await page.context().route(/gohighlevel\.com/, (route) => route.abort());
      await page.goto(`${base}/scripts/harness/property-answers-gate/index.html?env=${env}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
      const text = () => page.locator('body').innerText();
      const until = async (fn, label, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
        throw new Error(`${env}: timed out waiting for ${label}`);
      };
      const stageShown = async () => (await page.getByTestId('contact-deal-stage').count()) > 0;

      for (const [id, c] of Object.entries(CONTACTS)) {
        log = [];
        await go('/'); await page.waitForTimeout(200);
        await go(`/contacts/${id}`);
        await until(async () => (await text()).includes(`Seed note for ${c.first}`), `${c.first} notes`);
        await until(async () => log.some((r) => r.kind === 'ghl-opportunities'), `${c.first} pipeline read`);
        // A positive "this contact's deals are loaded" signal, so an absent panel is never a not-yet-loaded page.
        if (c.deals === 1) await until(stageShown, `${c.first} deal stage`);
        else if (c.deals > 1) await until(async () => (await text()).includes(`${c.deals} Opportunities`), `${c.first} ${c.deals} Opportunities`);
        else await until(async () => (await text()).includes('attach to a deal, not to the contact'), `${c.first} no-deal notice`);
        await page.waitForTimeout(800);   // let any panel mount and its first request leave
        const t = await text();
        const selector = await page.getByTestId('pa-select').count();
        const paRequests = log.filter((r) => r.kind === 'property-answer').length;
        const label = `${env} / ${c.deals} deal${c.deals === 1 ? '' : 's'} (${c.first})`;
        check(`${label}: the Contact page still renders (name and notes)`, t.includes(c.first) && t.includes(`Seed note for ${c.first}`));
        if (c.deals === 1) check(`${label}: the deal stage still renders`, await stageShown());
        if (c.deals > 1) check(`${label}: the page shows this contact's ${c.deals} deals are loaded`, t.includes(`${c.deals} Opportunities`));
        if (env === 'test-enabled' && c.deals >= 2) {
          check(`${label}: the multi-deal selector IS offered (Test behaviour preserved)`, selector === 1, { selector });
          const buttons = await page.getByTestId('pa-select').locator('button').allInnerTexts();
          const expected = Array.from({ length: c.deals }, (_, i) => `${c.first} deal ${i + 1}`);
          check(`${label}: the selector offers exactly this contact's ${c.deals} deals`, JSON.stringify(buttons) === JSON.stringify(expected), buttons);
          check(`${label}: no request before a deal is selected`, paRequests === 0, { paRequests });
        } else if (env === 'test-enabled' && c.deals === 1) {
          check(`${label}: the panel mounts for the single deal (its context request is sent)`, paRequests >= 1, { paRequests });
          check(`${label}: no selector for a single deal`, selector === 0, { selector });
        } else {
          check(`${label}: no property-answers selector`, selector === 0, { selector });
          check(`${label}: no "Property answers" / "Test evaluation" text`, !/Property answers|Test evaluation/i.test(t), t.match(/.{0,60}(Property answers|Test evaluation).{0,60}/i)?.[0]);
          check(`${label}: zero property-answer requests`, paRequests === 0, { paRequests });
        }
        check(`${label}: no write request`, !log.some((r) => r.kind === 'write'));
      }
      await page.close();
    }
    check('no request left the machine', foreign.length === 0, foreign.slice(0, 5));
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3));
  } catch (e) {
    check(`run completed: ${e.message}`, false);
  }
  console.log(`\n${checks} checks, ${failures} failures`);
  await exit(failures === 0 ? 0 : 1);
}
main();
