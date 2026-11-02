/**
 * B15-03 / INV-103 -- Revision 6 guided seller conversation, slices 1-2, on
 * the REAL Seller Call page.
 *
 * OFFLINE, MOCKED BROWSER: the real App (app-routes harness: real Layout, real
 * index.css through the Tailwind plugin) on /contacts/:id/seller-call, with GHL
 * data from scripts/harness/seller-call-offer-ready-fixture.cjs. Every function
 * GET is answered from the fixture; every non-localhost request is aborted and
 * counted; EVERY NON-GET IS REFUSED AND COUNTED, and the suite requires zero.
 *
 * Checks:
 *   A. Openings: Cold / Inbound / Follow-up each show their line with the
 *      contact's first name and street.
 *   B. Never blocking: Next walks the opening and all nine questions with every
 *      answer blank; Previous returns; jump by the side list to any question;
 *      Skip and Seller doesn't know mark and move on; Return to unanswered goes
 *      to the next Unanswered/Skipped question; Next is never disabled before
 *      the last question.
 *   C. Statuses: On Record exactly where the fixture has a record, Unanswered
 *      elsewhere (never zero/false/assumed); Draft after typing; the existing
 *      answers are shown with their source; the seller's stated price and the
 *      asking price stay separate.
 *   D. Drafts: typed answers in four questions and the Call notes survive 20+
 *      moves and opening/closing Notes and Full Script; the existing autosaved
 *      fields below are unchanged and no "Save changes" appears; Enter in a
 *      draft field writes nothing.
 *   E. Readiness: the strip shows the existing engine's six category levels
 *      and status (fixture: all SUPPORTED / Offer ready); without the seller
 *      price note, Seller price position is UNKNOWN, status Not ready, and the
 *      engine's pick (star) is on Price; the strip never says "approved".
 *   F. Isolation: another contact never shows this deal's drafts.
 *   G. Layout (real CSS): at 1100x800, 1280x800, 1440x900, and 1440x900 with
 *      Full Script + Notes open, the conversation panel does not overflow
 *      sideways and its spoken line and controls are fully visible.
 *   H. Zero writes, zero foreign requests, zero page errors for the run.
 *
 * SC_CONV_MUTATION=<name> rewrites SellerConversation.tsx IN THE DEV SERVER
 * ONLY (no file is touched); scripts/test-seller-conversation-mutations.cjs
 * requires each mutation to fail this suite.
 *
 *   node scripts/test-seller-conversation-rendered.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const A = fx.CONTACT;
const B = 'syn-conv-other-contact';
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const OCC_ID = getConfig('test').fields.occupancyStatus;
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 12 minutes'); process.exit(1); }, 12 * 60_000);

const FLOOR = 66;
const TARGET = '/src/components/SellerConversation.tsx';
const MUTATIONS = {
  // An answer becomes required to advance.
  requireanswer: [['onClick={() => go(d.current + 1)} disabled={d.current === QUESTIONS.length - 1}',
    'onClick={() => go(d.current + 1)} disabled={d.current === QUESTIONS.length - 1 || statuses[d.current] === "unanswered"}']],
  // Moving writes to GHL.
  writeonnext: [['const go = (i: number) => update((p) => moveTo(p, i));',
    'const go = (i: number) => { void fetch("/.netlify/functions/ghl-write", { method: "POST", body: "{}" }); update((p) => moveTo(p, i)); };']],
  // Moving discards drafts.
  dropdrafts: [['const go = (i: number) => update((p) => moveTo(p, i));',
    'const go = (i: number) => update((p) => ({ ...moveTo(p, i), answers: {} }));']],
};
const MUTATION = process.env.SC_CONV_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown SC_CONV_MUTATION ${MUTATION}`); process.exit(2); }
if (MUTATION) {
  const srcText = fs.readFileSync(path.join(APP, TARGET), 'utf8').replace(/\r\n/g, '\n');
  for (const [from] of MUTATIONS[MUTATION]) if (srcText.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: target not found exactly once`); process.exit(2); }
}
let mutationApplied = false;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}

const ORDER = ['opening', 'address', 'ownership', 'occupancy', 'reason', 'timing', 'price', 'asis', 'condition', 'summary'];

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'seller-conversation-mutation', enforce: 'pre',
    transform(code, id) {
      if (!MUTATION || !id.replace(/\\/g, '/').endsWith(TARGET)) return null;
      let out = code.replace(/\r\n/g, '\n');
      for (const [from, to] of MUTATIONS[MUTATION]) out = out.replace(from, to);
      if (!mutationApplied) console.log(`NOTE  mutation ${MUTATION} applied`);
      mutationApplied = true;
      return out;
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [mutate, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = { writes: [], foreign: [], pageErrors: [], blockedClicks: [] };

  async function open(width, height) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Chicago', locale: 'en-US' });
    const page = await context.newPage();
    page.on('pageerror', (e) => log.pageErrors.push(`${width}x${height}: ${String(e)}`));
    await context.route('**/*', async (rt) => {
      const r = rt.request();
      const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const u = new URL(url);
      const fn = u.pathname.replace('/.netlify/functions/', '');
      if (r.method() !== 'GET') { log.writes.push(`${r.method()} ${fn}`); return rt.fulfill(json(405, { error: 'offline test refuses every write' })); }
      if (fn === 'app-read-session') return rt.fulfill(json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
      const a = fx.answer(fx.classify(url, 'GET', null));
      return rt.fulfill(json(a.status, a.body));
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${A}/seller-call`)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
    await page.getByTestId('sc-card').waitFor({ timeout: 60000 });
    await page.getByTestId('sc-readiness-status').waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    return { context, page };
  }
  const tid = (page, id) => page.getByTestId(id);
  /* A click that cannot happen (disabled or missing control) is recorded, never thrown: the check that depends on it then fails by name. */
  const press = async (page, id) => { try { await page.getByTestId(id).click({ timeout: 4000 }); return true; } catch { log.blockedClicks.push(id); return false; } };
  const cardQ = (page) => page.getByTestId('sc-card').getAttribute('data-question');
  const statusOf = (page, q) => tid(page, `sc-status-${q}`).textContent();
  const navigate = (page, to) => page.evaluate((p) => { window.history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, to);

  /* ===== main run, 1440x900, full fixture ===== */
  fx.reset();
  {
    const { context, page } = await open(1440, 900);

    // A. openings
    const say = async () => (await tid(page, 'sc-say').textContent()).trim();
    check('A: the card starts on the Opening with Cold Outreach selected', (await cardQ(page)) === 'opening' && (await tid(page, 'sc-opening-cold').getAttribute('aria-pressed')) === 'true');
    const cold = await say();
    check('A: Cold opening line with first name and street', cold.includes('Hey Ready, this is Brad Thompson.') && cold.includes('calling about your property on 123 Fixture Ln.') && cold.includes('Have you ever considered selling it?'), cold);
    await press(page, 'sc-opening-inbound');
    const inbound = await say();
    check('A: Inbound opening line', inbound.includes('following up on your inquiry about selling your property on 123 Fixture Ln.') && inbound.includes('What are you hoping to accomplish with the sale?'), inbound);
    await press(page, 'sc-opening-follow_up');
    const follow = await say();
    check('A: Follow-up opening line', follow.includes('We spoke about your property on 123 Fixture Ln, and I\x27m following up on our conversation.') && follow.includes("What's changed since we last talked?"), follow);
    check('A: the line is labelled a Test candidate', (await tid(page, 'sc-source').textContent()).includes('Rev 6 Test candidate'));
    await press(page, 'sc-opening-cold');

    // C. statuses before anything is typed (fixture: identity, transaction, price, repairs on record; no occupancy)
    const EXPECT = { opening: 'Unanswered', address: 'On Record', ownership: 'On Record', occupancy: 'Unanswered', reason: 'Unanswered', timing: 'On Record', price: 'On Record', asis: 'Unanswered', condition: 'On Record', summary: 'On Record' };
    const got = {};
    for (const q of ORDER) got[q] = (await statusOf(page, q)).trim();
    check('C: statuses are On Record exactly where the fixture has a record, Unanswered elsewhere', JSON.stringify(got) === JSON.stringify(EXPECT), got);

    // B. walk Next with everything blank
    const seen = [];
    for (let i = 0; i < ORDER.length; i++) {
      seen.push(await cardQ(page));
      if (i < ORDER.length - 1) {
        check(`B: Next is enabled on ${seen[i]} with nothing answered`, await tid(page, 'sc-next').isEnabled());
        await press(page, 'sc-next');
      }
    }
    check('B: Next walked the opening and all nine questions in order', JSON.stringify(seen) === JSON.stringify(ORDER), seen);
    check('B: Next is disabled only on the last question', !(await tid(page, 'sc-next').isEnabled()));
    await press(page, 'sc-prev');
    check('B: Previous goes back one question', (await cardQ(page)) === 'condition');
    await press(page, 'sc-nav-reason');
    check('B: jumping from the list opens that question', (await cardQ(page)) === 'reason');
    await press(page, 'sc-skip');
    check('B: Skip marks the question Skipped and moves on', (await statusOf(page, 'reason')).trim() === 'Skipped' && (await cardQ(page)) === 'timing');
    await press(page, 'sc-nav-asis');
    await press(page, 'sc-dont-know');
    check('B: Seller doesn\'t know marks it and moves on', (await statusOf(page, 'asis')).trim() === "Seller doesn't know" && (await cardQ(page)) === 'condition');
    await press(page, 'sc-nav-ownership');
    await press(page, 'sc-return-open');
    check('B: Return to unanswered goes to the next Unanswered question (Occupancy)', (await cardQ(page)) === 'occupancy');
    await press(page, 'sc-return-open');
    check('B: then to the Skipped one (Reason)', (await cardQ(page)) === 'reason');
    await press(page, 'sc-nav-asis');
    await press(page, 'sc-clear-mark');
    check('B: a mark can be cleared (back to Unanswered)', (await statusOf(page, 'asis')).trim() === 'Unanswered');

    // C. existing answers + sources
    await press(page, 'sc-nav-price');
    const priceRecord = await tid(page, 'sc-on-record').textContent();
    check('C: Price shows the seller price position and its source', priceRecord.includes('Seller price position: $425,000') && priceRecord.includes('Seller price position note'), priceRecord);
    check('C: the seller\'s stated price is not shown as the asking price', !/Asking price: \$425,000/.test(priceRecord), priceRecord);
    await press(page, 'sc-nav-timing');
    const timingRecord = await tid(page, 'sc-on-record').textContent();
    check('C: Timing shows the recorded closing/possession with its source', timingRecord.includes('Close in 30 days; vacant at closing') && timingRecord.includes('Transaction assumptions note'), timingRecord);
    await press(page, 'sc-nav-address');
    const addrRecord = await tid(page, 'sc-on-record').textContent();
    check('C: Address shows the contact address and the identity confirmation, each with a source', addrRecord.includes('123 Fixture Ln') && addrRecord.includes('GHL contact address') && addrRecord.includes('Property identity note'), addrRecord);
    await press(page, 'sc-nav-condition');
    const condRecord = await tid(page, 'sc-on-record').textContent();
    check('C: Condition shows the repairs figure with its provenance (not replaced by seller words)', condRecord.includes('$40,000') && /approved/i.test(condRecord), condRecord);
    await press(page, 'sc-nav-reason');
    check('C: a question with nothing recorded says so', (await tid(page, 'sc-on-record-none').count()) === 1);

    // D. drafts
    const taBefore = await page.evaluate(() => [...document.querySelectorAll('[data-testid="transaction-closing-input"],[data-testid="seller-price-position-input"],[data-testid="negotiation-seller-position-input"]')].map((e) => e.value));
    const DRAFTS = [['reason', 'reason', 'Inherited the house; carrying costs'], ['price', 'amount', '410000'], ['ownership', 'owners', 'Ready and a sibling'], ['summary', 'next', 'Send numbers Friday']];
    for (const [q, f, v] of DRAFTS) {
      await press(page, `sc-nav-${q}`);
      await tid(page, `sc-field-${q}-${f}`).fill(v, { timeout: 4000 }).catch(() => log.blockedClicks.push(`fill ${q}`));
    }
    await press(page, 'sc-nav-price');
    await tid(page, 'sc-field-price-amount').press('Enter');
    await tid(page, 'sc-field-price-amount').press('Tab');
    await tid(page, 'sc-call-notes').fill('Seller prefers mornings. Dog on site.');
    await press(page, 'sc-nav-occupancy');
    await tid(page, 'sc-field-occupancy-occupancy').selectOption('Tenant Occupied');
    for (let i = 0; i < 22; i++) await press(page, i % 2 ? 'sc-prev' : 'sc-next');
    await press(page, 'seller-call-notes-toggle');
    await page.getByTestId('view-full-script').click().catch(() => {});
    await page.waitForTimeout(300);
    await press(page, 'seller-call-notes-toggle');
    const kept = [];
    for (const [q, f, v] of DRAFTS) {
      await press(page, `sc-nav-${q}`);
      kept.push((await tid(page, `sc-field-${q}-${f}`).inputValue()) === v);
    }
    check('D: four typed draft answers survive 22 moves and the side panels', kept.every(Boolean), kept);
    await press(page, 'sc-nav-occupancy');
    check('D: the occupancy choice survives as a draft', (await tid(page, 'sc-field-occupancy-occupancy').inputValue()) === 'Tenant Occupied');
    check('D: Call notes survive every move', (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.');
    check('D: typed questions show Draft', (await statusOf(page, 'reason')).trim() === 'Draft' && (await statusOf(page, 'price')).trim() === 'Draft' && (await statusOf(page, 'occupancy')).trim() === 'Draft');
    const taAfter = await page.evaluate(() => [...document.querySelectorAll('[data-testid="transaction-closing-input"],[data-testid="seller-price-position-input"],[data-testid="negotiation-seller-position-input"]')].map((e) => e.value));
    check('D: the existing autosaved fields below are unchanged by the conversation drafts', JSON.stringify(taBefore) === JSON.stringify(taAfter) && taBefore.length >= 2, { taBefore, taAfter });
    check('D: no "Save changes" (nothing unsaved in the page autosave)', (await tid(page, 'seller-call-save-changes').count()) === 0);
    check('D: the card says drafts are not saved to GHL', (await tid(page, 'sc-draft-note').textContent()).includes('Nothing here is saved to GHL'));

    // E. readiness
    const levels = {};
    for (const c of ['property_identity', 'repairs_condition', 'arv', 'deal_economics', 'transaction_assumptions', 'seller_price_position']) levels[c] = await tid(page, `sc-readiness-${c}`).getAttribute('data-level');
    check('E: the readiness strip shows the engine\'s six levels (fixture: all SUPPORTED)', Object.values(levels).every((l) => l === 'SUPPORTED'), levels);
    check('E: status is the engine\'s effective status (Offer ready)', (await tid(page, 'sc-readiness-status').textContent()).trim() === 'Offer ready (evidence)');
    const strip = await tid(page, 'sc-readiness').textContent();
    check('E: the strip never calls a level "approved" and keeps the offer a human action', !/\bapproved\b(?! )/i.test(strip.replace('not that an offer is approved', '')) && strip.includes('Brad makes any offer'), strip);
    check('E: an offer-ready deal marks no question with the engine star', (await page.locator('[data-testid^="sc-recommended-"]').count()) === 0);
    check('E: the existing Offer Readiness badge and decision panel are still on the page', (await page.locator('[data-testid="readiness-human-action-panel"],[data-testid="readiness-human-action-panel-loading"]').count()) === 1);

    // F. isolation
    await navigate(page, `/contacts/${B}/seller-call`);
    await page.waitForTimeout(2500);
    const bodyB = await page.evaluate(() => document.body.innerText);
    check('F: another contact never shows this deal\'s drafts or notes', !bodyB.includes('Inherited the house') && !bodyB.includes('Dog on site') && !bodyB.includes('Send numbers Friday'));
    await navigate(page, `/contacts/${A}/seller-call`);
    await page.getByTestId('sc-card').waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    const back = await tid(page, 'sc-call-notes').inputValue().catch(() => '');
    console.log(`NOTE  F: after returning to the first contact, its in-session Call notes are ${back ? 'still present' : 'not kept (the page remounted)'}; drafts are in-session only by design (reload-durable drafts are slice 5).`);
    await context.close();
  }

  /* ===== readiness from the engine when a category is missing ===== */
  fx.reset();
  {
    const held = fx.state.notes.splice(fx.state.notes.findIndex((x) => x.id === 'ready-n-seller-price'), 1);
    fx.state.contactFields.push({ id: OCC_ID, value: ['Vacant'] });
    const { context, page } = await open(1440, 900);
    check('E2: without the seller price note, Seller price position is UNKNOWN', (await tid(page, 'sc-readiness-seller_price_position').getAttribute('data-level')) === 'UNKNOWN');
    check('E2: status is Not ready', (await tid(page, 'sc-readiness-status').textContent()).trim() === 'Not ready');
    check('E2: the engine\'s pick is starred on Price, and only there', (await tid(page, 'sc-recommended-price').count()) === 1 && (await page.locator('[data-testid^="sc-recommended-"]').count()) === 1);
    check('E2: Price is Unanswered when no price note exists (the asking price is not treated as the seller\'s answer)', (await statusOf(page, 'price')).trim() === 'Unanswered');
    await press(page, 'sc-nav-price');
    const rec = await tid(page, 'sc-on-record').textContent();
    check('E2: Price shows no seller price position when none is recorded', !rec.includes('Seller price position'), rec);
    check('E2: occupancy read from the contact is On Record with its source', (await statusOf(page, 'occupancy')).trim() === 'On Record');
    await press(page, 'sc-nav-occupancy');
    check('E2: occupancy shows "Vacant" from GHL contact Occupancy Status', (await tid(page, 'sc-on-record').textContent()).includes('Occupancy: Vacant') && (await tid(page, 'sc-on-record').textContent()).includes('GHL contact Occupancy Status'));
    fx.state.notes.push(...held);
    await context.close();
  }

  /* ===== G. layout with the real stylesheet ===== */
  fx.reset();
  for (const [w, h, panels] of [[1100, 800, false], [1280, 800, false], [1440, 900, false], [1440, 900, true]]) {
    const { context, page } = await open(w, h);
    if (panels) {
      await press(page, 'seller-call-notes-toggle');
      await page.getByTestId('view-full-script').click();
      await page.getByTestId('full-script-drawer').waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
    }
    const label = `${w}x${h}${panels ? ' + Full Script + Notes' : ''}`;
    for (const q of ['opening', 'ownership', 'summary']) {
      await press(page, `sc-nav-${q}`);
      await tid(page, 'sc-card').scrollIntoViewIfNeeded();
      if (process.env.SC_CONV_SHOTS && q === 'ownership') {   // review evidence only; never a check
        fs.mkdirSync(process.env.SC_CONV_SHOTS, { recursive: true });
        await page.evaluate(() => { const m = document.querySelector('main'); const el = document.querySelector('[data-testid="seller-conversation"]'); m.scrollTop += el.getBoundingClientRect().top - 330; });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(process.env.SC_CONV_SHOTS, `conversation-${w}x${h}${panels ? '-panels' : ''}.png`) });
      }
      const m = await page.evaluate(() => {
        const wrap = document.querySelector('[data-testid="seller-conversation"]');
        const wr = wrap.getBoundingClientRect();
        const over = [...wrap.querySelectorAll('*')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > wr.right + 1 || r.left < wr.left - 1);
        }).map((el) => el.getAttribute('data-testid') || el.tagName).slice(0, 5);
        const clipped = [...wrap.querySelectorAll('.sc-say,.sc-then,.sc-nav-title,.sc-controls button,.sc-record')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className).slice(0, 5);
        const main = document.querySelector('main');
        return { over, clipped, wrapW: Math.round(wr.width), pageX: main.scrollWidth > main.clientWidth + 1 };
      });
      check(`G: ${label} on ${q}: nothing in the panel overflows sideways or is clipped`, m.over.length === 0 && m.clipped.length === 0 && !m.pageX, m);
    }
    await context.close();
  }

  /* ===== H. totals ===== */
  check('H: zero GHL writes (every non-GET is refused and counted)', log.writes.length === 0, log.writes);
  check('H: zero foreign requests', log.foreign.length === 0, log.foreign.slice(0, 3));
  check('H: every intended click was possible (no control was disabled or missing)', log.blockedClicks.length === 0, log.blockedClicks.slice(0, 5));
  check('H: zero page errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 3));

  await browser.close();
  await server.close();
  clearTimeout(watchdog);
  if (MUTATION && !mutationApplied) { console.error('FAILED: mutation not applied'); process.exit(3); }
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR} ${failures === 0 ? 'OK' : 'FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL  ', e); process.exit(1); });
