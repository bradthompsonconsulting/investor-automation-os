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
 *   P2-1 (Bones). Condition offers the EXISTING repair estimator: this contact's
 *      /underwriting page, opened in a new tab; this page and its drafts stay.
 *   P2-2 (Bones). Summary recaps the eight earlier questions read-only: saved
 *      items with their sources, drafts labelled "Draft — not saved" verbatim,
 *      untouched questions Unanswered; no input, no offer wording.
 *   I. (Bones P2-3) Isolation between FULLY LOADED deals: A -> B -> A -> B with
 *      distinct recorded values and drafts; two deals on one contact (C); and a
 *      delayed old read (A's reads held, route moves to B, B loads, A released).
 *   SA. Slice A (Captain hosted Test 2026-11-03): calling controls compact at the top right and greyed when
 *      unavailable with no explanation text; thin deal strip; no Next objective; readiness a small chip;
 *      conversation first, Deal tools (all existing panels) collapsible below; the Captain's exact wording;
 *      exactly the approved controls per question; GHL-backed controls named + NOT SAVED; Call notes = every
 *      question in order sharing the card's draft state, blank stays blank, "Seller doesn't know" printed,
 *      headings navigate.
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
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const OCC_ID = getConfig('test').fields.occupancyStatus;
const { formatSellerPricePositionNote, formatTransactionAssumptionsNote, formatPropertyIdentityConfirmationNote } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

/* Bones P2-3: two more FULLY LOADED sellers, with distinct recorded values.
   B: one deal. C: two deals on the same contact (the page asks which one). */
const B = 'syn-conv-bella';
const N = 'syn-conv-nora-nophone';
const B_OPP = `${B}-opp`;
const C = 'syn-conv-cara';
const C1 = `${C}-opp-one`;
const C2 = `${C}-opp-two`;
const EXTRA = {
  [B]: { firstName: 'Bella', address1: '77 Second St', city: 'Waco', state: 'TX', postalCode: '76701', deals: [[B_OPP, 'Bella deal']] },
  [C]: { firstName: 'Cara', address1: '9 Third Ave', city: 'Tyler', state: 'TX', postalCode: '75701', deals: [[C1, 'Cara deal one'], [C2, 'Cara deal two']] },
  /* Slice A: a seller with NO phone number (no deal needed) -- the calling controls must be greyed, with no explanation text. */
  [N]: { firstName: 'Nora', address1: '11 Fourth Rd', city: 'Plano', state: 'TX', postalCode: '75024', deals: [], phone: '' },
};
const displayOf = (x) => [x.address1, [x.city, [x.state, x.postalCode].join(', ')].join(', ')].join(', ');
const n = (id, body) => ({ id, body, dateAdded: '2026-10-05T15:00:00.000Z' });
const EXTRA_NOTES = {
  [B]: [
    n('b-identity', formatPropertyIdentityConfirmationNote({ opportunityId: B_OPP, at: '2026-10-05T15:01:00.000Z', operator: null, status: 'confirmed', address: displayOf(EXTRA[B]) })),
    n('b-ta', formatTransactionAssumptionsNote({ opportunityId: B_OPP, at: '2026-10-05T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Bella structure' }, closingPossession: { kind: 'value', value: 'Bella closes in 60 days' }, titleComplications: { kind: 'value', value: 'Bella lien question' } })),
    n('b-price', formatSellerPricePositionNote({ opportunityId: B_OPP, at: '2026-10-05T15:03:00.000Z', operator: null, kind: 'price', price: 333000 })),
  ],
  [N]: [],
  [C]: [
    n('c1-price', formatSellerPricePositionNote({ opportunityId: C1, at: '2026-10-05T15:03:00.000Z', operator: null, kind: 'price', price: 210000 })),
    n('c2-price', formatSellerPricePositionNote({ opportunityId: C2, at: '2026-10-05T15:04:00.000Z', operator: null, kind: 'price', price: 290000 })),
  ],
};
const extraRows = () => Object.entries(EXTRA).flatMap(([cid, x]) => x.deals.map(([id, name]) => ({
  id, contactId: cid, contactName: x.firstName, opportunityName: name, phone: '', email: '', stageId: 'fixture-stage', customFields: [],
})));
function extraAnswer(req) {
  if (req.kind === 'ghl-opportunities') { const a = fx.answer(req); return { status: a.status, body: { ...a.body, opportunities: [...a.body.opportunities, ...extraRows()] } }; }
  const x = EXTRA[req.contact];
  if (req.kind === 'detail' && x) return { status: 200, body: { contact: { id: req.contact, firstName: x.firstName, lastName: 'Synthetic', phone: x.phone ?? '+15555550123', address1: x.address1, city: x.city, state: x.state, postalCode: x.postalCode, customFields: [] } } };
  if (req.kind === 'notes' && x) return { status: 200, body: { notes: EXTRA_NOTES[req.contact].map((y) => ({ ...y })) } };
  if (req.kind === 'row' && x) return { status: 200, body: { id: req.contact, firstName: x.firstName, lastName: 'Synthetic', phone: '+15555550123', tags: [] } };
  if (req.kind === 'opp-read' && extraRows().some((o) => o.id === req.target)) return { status: 200, body: { opportunity: { id: req.target, contactId: extraRows().find((o) => o.id === req.target).contactId, customFields: [] } } };
  return null;
}
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 12 minutes'); process.exit(1); }, 12 * 60_000);

const FLOOR = 136;
const TARGET = '/src/components/SellerConversation.tsx';
const PAGE = '/src/pages/SellerCallWorkspace.tsx';
/* [file, from, to]: each `from` must occur exactly once in its file. */
const MUTATIONS = {
  // An answer becomes required to advance.
  requireanswer: [[TARGET, 'onClick={() => go(d.current + 1)} disabled={d.current === QUESTIONS.length - 1}',
    'onClick={() => go(d.current + 1)} disabled={d.current === QUESTIONS.length - 1 || statuses[d.current] === "unanswered"}']],
  // Moving writes to GHL.
  writeonnext: [[TARGET, 'const go = (i: number) => update((p) => moveTo(p, i));',
    'const go = (i: number) => { void fetch("/.netlify/functions/ghl-write", { method: "POST", body: "{}" }); update((p) => moveTo(p, i)); };']],
  // Moving discards drafts.
  dropdrafts: [[TARGET, 'const go = (i: number) => update((p) => moveTo(p, i));',
    'const go = (i: number) => update((p) => ({ ...moveTo(p, i), answers: {} }));']],
  // Bones P2-3 wrong-key control: drafts in one shared store under one key, surviving a remount -- they leak across deals.
  sharedkey: [[TARGET, 'const [drafts, setDrafts] = useState<Record<string, ConversationDraft>>({});',
    'const [, force] = useState(0); const G = globalThis as unknown as { __scShared?: Record<string, ConversationDraft> }; const drafts = (G.__scShared ??= {}); const setDrafts = (fn: (all: Record<string, ConversationDraft>) => Record<string, ConversationDraft>) => { G.__scShared = fn(G.__scShared ?? {}); force((n) => n + 1); };'],
    [TARGET, 'const key = dealKey;', 'const key = "shared";']],
  // Bones P2-3 stale-source control: the page applies a contact's reads after the route has moved on.
  stalesource: [[PAGE, '      .then(([c, pipeline, policy, notesResult]) => {\n        if (cancelled) return;\n', '      .then(([c, pipeline, policy, notesResult]) => {\n']],
  // Bones P2-1: the repair estimate replaces this page instead of opening a new tab.
  sametab: [[TARGET, 'href={repairsHref} target="_blank" rel="noopener noreferrer"', 'href={repairsHref}']],
  // Bones P2-2: drafts are presented as saved in the recap.
  recapsaved: [[TARGET, '<span className="sc-chip sc-chip-draft">Draft — not saved</span>', '<span className="sc-chip sc-chip-record">Saved</span>']],
  // Slice A: the Call notes edit a separate copy (not the card's draft state).
  notesdiverge: [[TARGET, 'onChange={(v) => update((p) => withField(p, item.id, f.id, v))} />', 'onChange={() => {}} />']],
  // Slice A: GHL-backed controls stop saying NOT SAVED.
  unsavedlabel: [[TARGET, '<span className="sc-ghl-unsaved">NOT SAVED</span>', '']],
  // Slice A: a Call-notes heading no longer opens its question.
  headingnav: [[TARGET, 'aria-current={i === d.current ? "step" : undefined} onClick={() => go(i)}>\n                    {i === 0 ? item.title', 'aria-current={i === d.current ? "step" : undefined} onClick={() => {}}>\n                    {i === 0 ? item.title']],
};
const MUTATION = process.env.SC_CONV_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown SC_CONV_MUTATION ${MUTATION}`); process.exit(2); }
if (MUTATION) {
  for (const [file, from] of MUTATIONS[MUTATION]) {
    const srcText = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
    if (srcText.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: target not found exactly once in ${file}`); process.exit(2); }
  }
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
      if (!MUTATION) return null;
      const file = [TARGET, PAGE].find((f) => id.replace(/\\/g, '/').endsWith(f));
      const mine = file ? MUTATIONS[MUTATION].filter((m) => m[0] === file) : [];
      if (mine.length === 0) return null;
      let out = code.replace(/\r\n/g, '\n');
      for (const [, from, to] of mine) out = out.replace(from, to);
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
  /* A read hold for one contact (Bones P2-3 delayed-old-read case): its detail/notes reads wait until released. */
  let hold = null;
  const holdReads = (contact) => { let release; const released = new Promise((r) => { release = r; }); hold = { contact, released, release, seen: 0 }; return hold; };

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
      const req = fx.classify(url, 'GET', null);
      if (hold && (req.kind === 'detail' || req.kind === 'notes') && req.contact === hold.contact) { hold.seen += 1; await hold.released; }
      const a = extraAnswer(req) ?? fx.answer(req);
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

    // P2-1. Condition -> the existing repair estimator, in a new tab
    await press(page, 'sc-nav-condition');
    const link = tid(page, 'sc-repairs-link');
    check('P2-1: the Condition question offers the repair estimate link', (await link.count()) === 1);
    check('P2-1: it points at this contact\'s existing Underwriting page', (await link.getAttribute('href')) === `/contacts/${A}/underwriting`);
    check('P2-1: it opens in a new tab (target _blank, rel noopener)', (await link.getAttribute('target')) === '_blank' && /noopener/.test((await link.getAttribute('rel')) || ''));
    const pagesBefore = context.pages().length;
    const popupP = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await press(page, 'sc-repairs-link');
    const popup = await popupP;
    const popupPath = popup ? new URL(popup.url() === 'about:blank' ? (await popup.waitForURL(/underwriting/, { timeout: 8000 }).then(() => popup.url()).catch(() => 'about:blank')) : popup.url(), 'http://x').pathname : null;
    if (popup) await popup.close();
    check('P2-1: clicking it opens a NEW tab on the Underwriting page', popupPath === `/contacts/${A}/underwriting`, { popupPath, pagesBefore });
    check('P2-1: this page stays on Seller Call with the Condition question open', new URL(page.url()).pathname === `/contacts/${A}/seller-call` && (await cardQ(page)) === 'condition');
    await press(page, 'sc-nav-price');
    check('P2-1: drafts are intact after the repair estimate opened', (await tid(page, 'sc-field-price-amount').inputValue()) === '410000' && (await tid(page, 'sc-call-notes').inputValue()) === 'Seller prefers mornings. Dog on site.');
    await press(page, 'sc-nav-ownership');
    check('P2-1: no other question offers the repair link', (await tid(page, 'sc-repairs-link').count()) === 0);

    // P2-2. Summary recap: saved vs draft, read-only, nothing inferred
    await press(page, 'sc-nav-summary');
    const recapText = (id) => tid(page, `sc-recap-${id}`).textContent();
    check('P2-2: Summary shows a recap row for each of the eight earlier questions', (await page.locator('[data-testid^="sc-recap-"][data-status]').count()) === 8);
    const priceRow = await recapText('price');
    check('P2-2: Price lists the saved seller price position with its source AND the unsaved draft, each labelled',
      priceRow.includes('Saved') && priceRow.includes('Seller price position: $425,000') && priceRow.includes('Seller price position note')
      && priceRow.includes('Draft — not saved') && priceRow.includes("Seller's stated price ($): 410000"), priceRow);
    check('P2-2: the draft price is shown verbatim, not formatted or merged into a saved figure', !priceRow.includes('$410,000') && !/Asking price: \$410/.test(priceRow), priceRow);
    const ownRow = await recapText('ownership');
    check('P2-2: Ownership lists the saved title note and the unsaved owners draft', ownRow.includes('Title complications: None (recorded)') && ownRow.includes('Draft — not saved') && ownRow.includes('Ready and a sibling'), ownRow);
    const reasonRow = await recapText('reason');
    check('P2-2: Reason is draft only (nothing saved claimed)', reasonRow.includes('Draft — not saved') && !reasonRow.includes('Saved'), reasonRow);
    const occRow = await recapText('occupancy');
    check('P2-2: Occupancy shows the draft choice as a draft', occRow.includes('Draft — not saved') && occRow.includes('Tenant Occupied') && !occRow.includes('Saved'), occRow);
    const asisRow = await recapText('asis');
    check('P2-2: an untouched question reads Unanswered, with nothing filled in', asisRow.includes('Unanswered') && !asisRow.includes('Saved') && !asisRow.includes('Draft'), asisRow);
    check('P2-2: every draft line in the recap is labelled "Draft — not saved"', (await page.locator('[data-testid="sc-recap-draft"]').count()) === (await page.locator('[data-testid="sc-recap-draft"]', { hasText: 'Draft — not saved' }).count()) && (await page.locator('[data-testid="sc-recap-draft"]').count()) >= 4);
    check('P2-2: the recap has no input and no button (read-only)', (await tid(page, 'sc-recap').locator('input,textarea,select,button').count()) === 0);
    check('P2-2: the recap names no offer or commitment', !/offer|commit|agree/i.test((await tid(page, 'sc-recap').textContent()).replace(/Seller price position/g, '')));

    // E. readiness
    const levels = {};
    for (const c of ['property_identity', 'repairs_condition', 'arv', 'deal_economics', 'transaction_assumptions', 'seller_price_position']) levels[c] = await tid(page, `sc-readiness-${c}`).getAttribute('data-level');
    check('E: the readiness strip shows the engine\'s six levels (fixture: all SUPPORTED)', Object.values(levels).every((l) => l === 'SUPPORTED'), levels);
    check('E: status is the engine\'s effective status (Offer ready)', (await tid(page, 'sc-readiness-status').textContent()).trim() === 'Offer ready (evidence)');
    const strip = await tid(page, 'sc-readiness').textContent();
    check('E: the strip never calls a level "approved" and keeps the offer a human action', !/\bapproved\b(?! )/i.test(strip.replace('not that an offer is approved', '')) && strip.includes('Brad makes any offer'), strip);
    check('E: an offer-ready deal marks no question with the engine star', (await page.locator('[data-testid^="sc-recommended-"]').count()) === 0);
    check('E: the existing Offer Readiness badge and decision panel are still on the page', (await page.locator('[data-testid="readiness-human-action-panel"],[data-testid="readiness-human-action-panel-loading"]').count()) === 1);

    await context.close();
  }

  /* ===== I. isolation between fully loaded deals (Bones P2-3) ===== */
  fx.reset();
  {
    const { context, page } = await open(1440, 900);
    const panelFor = (key) => page.locator(`[data-testid="seller-conversation"][data-deal="${key}"]`).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    const panelText = () => tid(page, 'seller-conversation').textContent();
    const priceRecord = async () => { await press(page, 'sc-nav-price'); return tid(page, 'sc-on-record').textContent({ timeout: 4000 }).catch(() => ''); };
    // A: type drafts.
    await press(page, 'sc-nav-price');
    await tid(page, 'sc-field-price-amount').fill('A-410000');
    await tid(page, 'sc-call-notes').fill('A-notes only');
    // A -> B (fully loaded, its own deal).
    await navigate(page, `/contacts/${B}/seller-call`);
    check('I: B loads its own conversation (deal key B)', await panelFor(`${B}|${B_OPP}`));
    await press(page, 'sc-nav-opening');
    check('I: B\'s opening names Bella and her street', (await tid(page, 'sc-say').textContent()).includes('Hey Bella,') && (await tid(page, 'sc-say').textContent()).includes('77 Second St'));
    const bPrice = await priceRecord();
    check('I: B shows its own recorded price ($333,000), never A\'s ($425,000)', bPrice.includes('$333,000') && !(await panelText()).includes('$425,000'), bPrice);
    check('I: B\'s price draft field is empty (A\'s draft does not appear)', (await tid(page, 'sc-field-price-amount').inputValue()) === '');
    check('I: B\'s Call notes are empty (A\'s notes do not appear)', (await tid(page, 'sc-call-notes').inputValue()) === '');
    await press(page, 'sc-nav-timing');
    check('I: B\'s timing record is B\'s own', (await tid(page, 'sc-on-record').textContent()).includes('Bella closes in 60 days'));
    await press(page, 'sc-nav-price');
    await tid(page, 'sc-field-price-amount').fill('B-333-draft');
    await tid(page, 'sc-call-notes').fill('B-notes only');
    // B -> A: A's drafts and records return, B's do not appear.
    await navigate(page, `/contacts/${A}/seller-call`);
    check('I: back on A (deal key A)', await panelFor(`${A}|${fx.OPP}`));
    const aPrice = await priceRecord();
    check('I: A shows its own recorded price, never B\'s', aPrice.includes('$425,000') && !(await panelText()).includes('$333,000'), aPrice);
    check('I: A\'s own draft is back; B\'s draft is absent', (await tid(page, 'sc-field-price-amount').inputValue()) === 'A-410000');
    check('I: A\'s own Call notes are back; B\'s are absent', (await tid(page, 'sc-call-notes').inputValue()) === 'A-notes only');
    // A -> B again: B's drafts are B's.
    await navigate(page, `/contacts/${B}/seller-call`);
    await panelFor(`${B}|${B_OPP}`);
    await press(page, 'sc-nav-price');
    check('I: returning to B shows B\'s draft and notes only', (await tid(page, 'sc-field-price-amount').inputValue()) === 'B-333-draft' && (await tid(page, 'sc-call-notes').inputValue()) === 'B-notes only');

    // Two deals on one contact (the page asks which deal; it offers no switch once chosen, so each deal is a fresh choice).
    await navigate(page, `/contacts/${C}/seller-call`);
    await page.getByRole('button', { name: 'Cara deal one' }).click({ timeout: 30000 }).catch(() => log.blockedClicks.push('choose C1'));
    check('I: C deal one loads under its own deal key', await panelFor(`${C}|${C1}`));
    const c1Price = await priceRecord();
    check('I: C deal one shows its price ($210,000), not deal two\'s ($290,000)', c1Price.includes('$210,000') && !c1Price.includes('$290,000'), c1Price);
    check('I: C deal one starts with no draft (not B\'s, not A\'s)', (await tid(page, 'sc-field-price-amount').inputValue()) === '' && (await tid(page, 'sc-call-notes').inputValue()) === '');
    await tid(page, 'sc-field-price-amount').fill('C1-draft');
    await navigate(page, `/contacts/${C}`);
    await page.waitForTimeout(800);
    await navigate(page, `/contacts/${C}/seller-call`);
    await page.getByRole('button', { name: 'Cara deal two' }).click({ timeout: 30000 }).catch(() => log.blockedClicks.push('choose C2'));
    check('I: C deal two loads under its own deal key', await panelFor(`${C}|${C2}`));
    const c2Price = await priceRecord();
    check('I: C deal two shows its price ($290,000), not deal one\'s', c2Price.includes('$290,000') && !c2Price.includes('$210,000'), c2Price);
    check('I: C deal two does not show deal one\'s draft', (await tid(page, 'sc-field-price-amount').inputValue()) === '');

    // Delayed old read: A's reads are held, the route moves on to B, B loads, then A's reads are released.
    await navigate(page, `/contacts/${B}/seller-call`);
    await panelFor(`${B}|${B_OPP}`);
    const h = holdReads(A);
    await navigate(page, `/contacts/${A}/seller-call`);
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && h.seen < 2; i++) await page.waitForTimeout(100);
    check('I: A\'s reads were in flight (held) when the route moved on', h.seen >= 2, { seen: h.seen });
    await navigate(page, `/contacts/${B}/seller-call`);
    check('I: B loads while A\'s reads are still held', await panelFor(`${B}|${B_OPP}`));
    h.release();
    hold = null;
    await page.waitForTimeout(2000);
    // (Passing through a loading contact unmounts the panel, so B's earlier in-session draft is not expected here; slice 5.)
    const afterKey = await tid(page, 'seller-conversation').getAttribute('data-deal');
    const afterPrice = await priceRecord();
    check('I: after A\'s late reads land, the panel is still B\'s (deal key and B\'s recorded price only)', afterKey === `${B}|${B_OPP}` && afterPrice.includes('$333,000') && !(await panelText()).includes('$425,000'), { afterKey, afterPrice });
    await press(page, 'sc-nav-opening');
    check('I: B\'s opening still names Bella, and no A draft or notes appear', (await tid(page, 'sc-say').textContent()).includes('Hey Bella,') && (await tid(page, 'sc-call-notes').inputValue()) !== 'A-notes only');
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

  /* ===== SA. Slice A (Captain hosted Test, 2026-11-03): layout, wording, one control per question, GHL names, Call notes ===== */
  fx.reset();
  {
    const { context, page } = await open(1440, 900);
    const box = (id) => page.getByTestId(id).boundingBox();
    // Layout
    const head = await box('seller-call-header-row');
    const calls = await box('seller-call-calltop');
    check('SA layout: calling controls share the title row, at its right', !!head && !!calls && calls.y < head.y + 40 && calls.x + calls.width > head.x + head.width - 20 && calls.x > head.x + head.width / 3, { head, calls });
    check('SA layout: AirDroid, GHL Phone and Cell are all there, compact (no seller identity lines shown)',
      (await page.locator('[data-testid="seller-call-calltop"] [data-testid$="-mode"]').count()) === 3
      && (await page.locator('[data-testid="seller-call-calltop"] .seller-call-mode__identity:visible').count()) === 0);
    check('SA layout: no idle explanation text under the calling controls', (await page.locator('[data-testid="seller-call-calltop"] .seller-call-mode__hint:visible').count()) === 0);
    check('SA layout: the deal strip is the thin (compact) strip', (await tid(page, 'seller-call-deal-strip').getAttribute('data-compact')) === 'true' && (await box('seller-call-deal-strip')).height < 80, await box('seller-call-deal-strip'));
    check('SA layout: "Next objective" is gone', (await page.locator('[data-testid="seller-call-next-objective"]').count()) === 0);
    const chip = await box('seller-call-readiness-chip');
    check('SA layout: readiness is one small chip in the strip (not a large badge)', !!chip && chip.height < 40, chip);
    const strip = await box('seller-call-deal-strip');
    const conv = await box('seller-conversation');
    const tools = await box('seller-call-deal-tools');
    check('SA layout: the conversation comes first, directly under the strip; Deal tools follow it', conv.y > strip.y && conv.y - (strip.y + strip.height) < 80 && tools.y > conv.y + conv.height - 2, { strip, conv, tools });
    check('SA layout: the conversation question is visible without scrolling at 1440x900', conv.y < 450);
    check('SA layout: Deal tools hold the existing decision, negotiation, outcome and underwriting panels',
      (await page.locator('[data-testid="seller-call-deal-tools"] [data-testid="call-outcome-panel"]').count()) === 1
      && (await page.locator('[data-testid="seller-call-deal-tools"] [data-testid="negotiation-panel"]').count()) === 1
      && (await page.locator('[data-testid="seller-call-deal-tools"] [data-testid="repairs-entry-panel"]').count()) === 1
      && (await page.locator('[data-testid="seller-call-deal-tools"] [data-testid="readiness-human-action-panel"],[data-testid="seller-call-deal-tools"] [data-testid="readiness-human-action-panel-loading"]').count()) === 1);
    await press(page, 'seller-call-deal-tools-summary');
    check('SA layout: Deal tools collapse (panels hidden, conversation stays)', !(await tid(page, 'call-outcome-panel').isVisible()) && (await tid(page, 'sc-card').isVisible()));
    await press(page, 'seller-call-deal-tools-summary');
    check('SA layout: Deal tools reopen with the panels intact', await tid(page, 'call-outcome-panel').isVisible());

    // Wording (Captain, exact)
    await press(page, 'sc-nav-ownership');
    check('SA wording: Ownership line', (await tid(page, 'sc-say').textContent()) === '“Is the property owned in your name, or is anyone else involved in making the decision to sell?”');
    await press(page, 'sc-nav-price');
    check('SA wording: Price shows the Captain\'s alternate line', (await tid(page, 'sc-alternate').textContent()) === 'Or: “What would you need to walk away with from the sale for this to make sense?”');
    await press(page, 'sc-nav-asis');
    check('SA wording: As-is main line and its follow-up',
      (await tid(page, 'sc-say').textContent()) === "“What if you could sell it exactly as it sits, with no repairs or cleanup, leave behind anything you don't want, and close on a timeline that works for you? Would that take some weight off your shoulders?”"
      && (await tid(page, 'sc-then').textContent()).includes("Is that something you'd consider?"));
    await press(page, 'sc-nav-reason');
    check('SA wording: the Reason answer is labelled "Reason for selling"', (await page.locator('label[for="sc-reason-reason"]').textContent()).startsWith('Reason for selling'));

    // One control per question (in the card)
    const EXPECT = { opening: 1, address: 5, ownership: 1, occupancy: 2, reason: 1, timing: 1, price: 2, asis: 1, condition: 1, summary: 2 };
    const counts = {};
    for (const q of ORDER) { await press(page, `sc-nav-${q}`); counts[q] = await page.locator('[data-testid="sc-card"] [data-testid^="sc-field-"]').count(); }
    check('SA controls: each question shows exactly its approved controls (no duplicate boxes)', JSON.stringify(counts) === JSON.stringify(EXPECT), counts);

    // GHL-backed controls are named and NOT SAVED
    await press(page, 'sc-nav-occupancy');
    const occGhl = await tid(page, 'sc-ghl-occupancy-occupancy').textContent();
    check('SA GHL: the Occupancy control names its GHL field and says NOT SAVED', occGhl.includes('GHL · Contact · Occupancy Status') && occGhl.includes('NOT SAVED'), occGhl);
    check('SA GHL: the GHL-backed control is drawn differently (dashed border); its notes field is not', (await tid(page, 'sc-field-occupancy-occupancy').evaluate((e) => getComputedStyle(e).borderTopStyle)) === 'dashed'
      && (await tid(page, 'sc-field-occupancy-lease').evaluate((e) => getComputedStyle(e).borderTopStyle)) !== 'dashed');
    await press(page, 'sc-nav-price');
    check('SA GHL: the seller\'s price names "Seller price position" and says NOT SAVED', (await tid(page, 'sc-ghl-price-amount').textContent()).includes('GHL · Seller price position') && (await tid(page, 'sc-ghl-price-amount').textContent()).includes('NOT SAVED'));
    await press(page, 'sc-nav-ownership');
    check('SA GHL: a non-GHL answer has no GHL label', (await page.locator('[data-testid="sc-card"] [data-testid^="sc-ghl-"]').count()) === 0);

    // Call notes = the same draft state, in order, blank stays blank, "Seller doesn't know" printed, heading navigates
    const noteIds = await page.locator('[data-testid="sc-notes-panel"] > ol > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    check('SA notes: every question in order, then General notes', JSON.stringify(noteIds) === JSON.stringify([...ORDER.map((q) => `sc-note-${q}`), 'sc-note-general']), noteIds);
    check('SA notes: blank answers are blank (no "Unanswered" text) and the panel says NOT SAVED',
      !(await tid(page, 'sc-notes-panel').textContent()).includes('Unanswered') && (await tid(page, 'sc-notes-unsaved').textContent()).includes('NOT SAVED')
      && (await tid(page, 'sc-note-field-reason-reason').inputValue()) === '');
    await press(page, 'sc-nav-price');
    await tid(page, 'sc-field-price-amount').fill('412000');
    check('SA notes: typing in the card shows in the notes (same state)', (await tid(page, 'sc-note-field-price-amount').inputValue()) === '412000');
    await tid(page, 'sc-note-field-reason-reason').fill('Relocating for work', { timeout: 4000 }).catch(() => log.blockedClicks.push('fill note reason'));
    await press(page, 'sc-nav-reason');
    check('SA notes: typing in the notes shows in the card (same state)', (await tid(page, 'sc-field-reason-reason').inputValue()) === 'Relocating for work');
    check('SA notes: the edit made in the notes marks the question Draft', (await statusOf(page, 'reason')).trim() === 'Draft');
    await press(page, 'sc-nav-asis');
    await press(page, 'sc-dont-know');
    check('SA notes: "Seller doesn\'t know" is printed as the answer in the notes', (await tid(page, 'sc-note-dk-asis').textContent({ timeout: 4000 }).catch(() => '')) === "Seller doesn't know");
    await press(page, 'sc-note-heading-timing');
    check('SA notes: selecting a note heading opens that question', (await cardQ(page)) === 'timing');
    await press(page, 'sc-note-heading-summary');
    check('SA notes: and another', (await cardQ(page)) === 'summary');
    check('SA notes: the Summary recap shows the notes-entered draft', (await tid(page, 'sc-recap-reason').textContent({ timeout: 4000 }).catch(() => '')).includes('Relocating for work'));

    // Safety
    check('SA safety: no "Save changes" appeared (page autosave untouched)', (await tid(page, 'seller-call-save-changes').count()) === 0);
    await context.close();

    // Greyed calling controls for a seller with no phone number
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => log.pageErrors.push(`nophone: ${String(e)}`));
    await ctx2.route('**/*', async (rt) => {
      const r = rt.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      if (r.method() !== 'GET') { log.writes.push(`${r.method()} ${fn}`); return rt.fulfill(json(405, { error: 'offline test refuses every write' })); }
      if (fn === 'app-read-session') return rt.fulfill(json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
      const req = fx.classify(url, 'GET', null);
      const a = extraAnswer(req) ?? fx.answer(req);
      return rt.fulfill(json(a.status, a.body));
    });
    await p2.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${N}/seller-call`)}`);
    await p2.getByTestId('seller-call-calltop').waitFor({ timeout: 60000 }).catch(() => {});
    const air = p2.getByTestId('call-with-airdroid');
    const cell = p2.getByTestId('call-with-cell-copy');
    const greyed = async (l) => l.evaluate((e) => { const cs = getComputedStyle(e); return e.disabled && Number(cs.opacity) < 0.6 && /grayscale/.test(cs.filter); }).catch(() => false);
    check('SA calls: with no seller number, AirDroid and Cell are disabled and greyed', (await air.count()) === 1 && (await greyed(air)) && (await greyed(cell)));
    check('SA calls: no explanatory text is shown for the unavailable controls', (await p2.locator('[data-testid="seller-call-calltop"] .seller-call-mode__hint:visible').count()) === 0);
    check('SA calls: GHL Phone stays available', await p2.getByTestId('open-ghl-contact').isEnabled().catch(() => false));
    await ctx2.close();
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
