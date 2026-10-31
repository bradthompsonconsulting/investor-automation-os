/**
 * B15-25 Phase 2 (INV-133) -- "Save Calculation to Deal" / "Load Saved Calculation" on the REAL Deal
 * Calculator page, offline. Jess RULING 2026-10-30, Captain approved P2-1..P2-5. r2: Bones's Phase 2 findings.
 *
 *   node scripts/test-deal-calculation-save.cjs                   the suite (exact FLOOR)
 *   node scripts/test-deal-calculation-save.cjs --mutate=<name>   a page negative control (in-memory Vite
 *                                                                 transform of DealCalculationSavePanel.tsx);
 *                                                                 the run must FAIL
 *
 * Vite serves scripts/harness/deal-calculation-save, which renders the real page in headless Chromium. Every
 * /.netlify/functions request is answered here from a fake GHL state; any other request is aborted and counted.
 * Proves: no panel unlinked; the OFF branch offers no Save and reads nothing; one deal auto-selects, two need a
 * choice (PB-D55); typing and navigation send nothing; one click sends exactly one note.create with a v1 carrier
 * and nothing else; unchanged figures are not saved again; a rapid double click sends one; a newer saved
 * calculation blocks the save (nothing sent) and offers Load Newer / Save as New; Load asks before replacing
 * unsaved figures; an unconfirmed save blocks new saves until reconciled (found, or the identical note resent);
 * deal A's late answers never reach deal B; staleness is flagged; itemized repairs are not saved; an unreadable
 * notes read is never shown as "none".
 *
 * Phase 1 + Phase 2 integration (Jess rulings I1-I4, 2026-10-31): the page has ONE deal picker and the panel saves
 * for its choice; a Load becomes this deal's browser draft through Phase 1's own keep path and is labelled as
 * loaded from GHL (a later browser restore is labelled as such); an operator change resets the panel, so neither
 * an unconfirmed save nor a late result crosses operators. Page negative controls carry file: 'page'.
 */
'use strict';
const path = require('node:path');
const APP = path.resolve(__dirname, '..');
const PANEL = path.join(APP, 'src', 'components', 'DealCalculationSavePanel.tsx');
const PAGE = path.join(APP, 'src', 'pages', 'DealCalculator.tsx');
const SEND = '    try { await ghl.notes.create(contactId, body, { requestId: crypto.randomUUID() }); return "confirmed"; }';

const MUTATIONS = {
  autosave: [{ from: '  const dirty = !sameFigures(figures, clean);', to: '  const dirty = !sameFigures(figures, clean);\n  useEffect(() => { if (selected && figures.arvInput !== "") void handleSave(); }, [figures.arvInput]);' }],
  overwrite: [{ from: '=== "newer_calculation_exists" && l) {', to: '=== "never_refused" && l) {' }],
  'double-write': [{ from: SEND, to: '    try { await ghl.notes.create(contactId, body, { requestId: crypto.randomUUID() }); await ghl.notes.create(contactId, body, { requestId: crypto.randomUUID() }); return "confirmed"; }' }],
  'current-offer': [{ from: SEND, to: '    try { await ghl.notes.create(contactId, body, { requestId: crypto.randomUUID() }); await (await import("../lib/write-command")).writeCommand("opportunity.currentOffer", opportunityId, { value: 1 }); return "confirmed"; }' }],
  'no-visit-guard': [
    { from: '      if (myVisit !== visit.current) return "stale";\n      setEvidence(ev); setEvidenceError(null);', to: '      setEvidence(ev); setEvidenceError(null);' },
    { from: '      if (myVisit !== visit.current) return;   // the operator moved on: nothing from deal A reaches deal B\n', to: '' },
    { from: '      (ev) => { if (myVisit === visit.current) { setEvidence(ev);', to: '      (ev) => { if (true) { setEvidence(ev);' },
  ],
  'no-sending-guard': [
    { from: '    if (!selected || sending.current) return;', to: '    if (!selected) return;' },
    { from: 'disabled={blocked} style={{ ...BUTTON, opacity: blocked', to: 'disabled={false} style={{ ...BUTTON, opacity: blocked' },
  ],
  'blind-after-unconfirmed': [
    { from: '    if (unconfirmed.current.has(opportunityId)) { setSave({ kind: "unconfirmed", checked: false }); return; }\n', to: '' },
    { from: '  const blocked = save.kind === "saving" || save.kind === "unconfirmed";', to: '  const blocked = save.kind === "saving";' },
  ],
  'unchanged-resave': [{ from: '        setBasedOn(l.saved); setSave({ kind: "unchanged", at: l.saved }); return;   // nothing sent', to: '        void 0;' }],
  /* Integration controls (page). I1: the panel ignores the page's choice and takes the contact's first deal. */
  'panel-own-deal': [{ file: 'page', from: 'opportunityId={context && context.kind === "deal" && context.contactId === linkedContactId ? context.opportunityId : null}', to: 'opportunityId={deals && deals.length ? deals[0].id : null}' }],
  /* I3: a Load is labelled as if the figures had been restored from this browser. */
  'load-labelled-as-browser': [{ file: 'page', from: '    setRestoreNote(\x60Loaded the calculation saved in GHL on ', to: '    setRestoreNote(\x60Restored the figures kept in this browser. ' }],
  /* I3: a Load bypasses Phase 1's keep path (the loaded figures are not kept for this deal). */
  'load-not-kept': [{ file: 'page', from: '  function handleLoadCalculation(next: CalculatorFigures, savedAt: string) {\n', to: '  function handleLoadCalculation(next: CalculatorFigures, savedAt: string) {\n    skipKeep.current = true; setTimeout(() => { skipKeep.current = false; }, 1000);\n' },
    { file: 'page', from: '  const [restoreNote, setRestoreNote] = useState<string | null>(null);\n', to: '  const [restoreNote, setRestoreNote] = useState<string | null>(null);\n  const skipKeep = useRef(false);\n' },
    { file: 'page', from: '    const snap = snapshot();\n    let next = draft;\n', to: '    if (skipKeep.current) return;\n    const snap = snapshot();\n    let next = draft;\n' }],
  /* I4: the panel is keyed by the contact only, so it survives an operator change with its deal state. */
  'no-operator-reset': [{ file: 'page', from: '          key={\x60$\{linkedContactId}|$\{draftOperator()}\x60}', to: '          key={linkedContactId}' }],
};
const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const mutationName = mutateArg ? mutateArg.slice('--mutate='.length) : null;
const mutation = mutationName ? MUTATIONS[mutationName] : null;
if (mutationName && !mutation) { console.error('ABORT: unknown mutation ' + mutationName + '; known: ' + Object.keys(MUTATIONS).join(', ')); process.exit(2); }
let mutationApplied = 0;

const FLOOR = 44;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const CONTACT = 'conAAAA0001', DEAL1 = 'oppAAAA0001', DEAL2 = 'oppBBBB0002';
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'b15-25-page-mutation', enforce: 'pre',
    transform(code, id) {
      const file = path.resolve(id.split('?')[0]);
      if (!mutation || (file !== PANEL && file !== PAGE)) return null;
      const mine = mutation.filter((m) => (m.file === 'page' ? PAGE : PANEL) === file);
      if (mine.length === 0) return null;
      let src = code.replace(/\r\n/g, '\n');
      for (const m of mine) {
        const n = src.split(m.from).length - 1;
        if (n !== 1) throw new Error('mutation anchor occurs ' + n + ' times: ' + m.from.slice(0, 60));
        src = src.replace(m.from, () => m.to);
      }
      mutationApplied++; return src;
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [mutate, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculation-save/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  /* Fake GHL. writeMode: ok | refuse (409, nothing stored) | lost (stored, then 500). */
  const state = { notes: [], deals: [DEAL1], oppFields: [], notesFail: false, writeMode: 'ok', holdWrite: null, holdOpp: null };
  const writes = [], reads = [], foreign = [], unmodelled = [];
  let noteSeq = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') { reads.push('pipeline'); return json(200, { pipelineId: 'pipe', stages: [], opportunities: state.deals.map((id) => ({ id, contactId: CONTACT, contactName: 'Kay Fixture', opportunityName: 'Deal ' + id.slice(-1), phone: '', email: '', stageId: 's1', customFields: [] })) }); }
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path');
        if (p === `/contacts/${CONTACT}`) return json(200, { contact: { id: CONTACT, firstName: 'Kay', lastName: 'Fixture', customFields: [] } });
        if (p === `/contacts/${CONTACT}/notes`) { reads.push('notes'); return state.notesFail ? json(500, { error: 'fixture notes failure' }) : json(200, { notes: state.notes }); }
        if (p === `/opportunities/${DEAL1}` || p === `/opportunities/${DEAL2}`) {
          reads.push('opp'); const id = p.split('/')[2];
          if (state.holdOpp && state.holdOpp.id === id) { const g = state.holdOpp.gate; await g.p; }
          return json(200, { opportunity: { id, contactId: CONTACT, customFields: state.oppFields } });
        }
      }
      if (fn === 'ghl-write' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); writes.push(body);
        if (state.holdWrite) await state.holdWrite.p;
        if (state.writeMode === 'refuse') return json(409, { error: 'Write refused or unconfirmed; refresh and inspect before retrying' });
        if (body.operation === 'note.create') state.notes.push({ id: 'note-' + (++noteSeq), body: body.args.body, dateAdded: new Date().toISOString() });
        if (state.writeMode === 'lost') return json(500, { error: 'fixture: the response was lost' });
        return json(200, { id: 'note-' + noteSeq, confirmed: true });
      }
      unmodelled.push(fn + ' ' + req.method()); return json(404, { error: 'fixture does not model ' + fn });
    });
    const T = (id) => page.getByTestId(id);
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(50); } return false; };
    const parse = (body) => page.evaluate((b) => window.__dealCalc.parse(b), body);
    const format = (c) => page.evaluate((x) => window.__dealCalc.format(x), c);
    const visible = async (id) => (await T(id).count()) > 0 && (await T(id).first().isVisible());
    const stateOf = () => T('deal-calc-save-status').getAttribute('data-state');
    const waitState = (s) => until(async () => (await stateOf()) === s);
    const linked = (extra = '') => page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}${extra}`);

    // 1 -- unlinked: no panel.
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html`);
    await T('deal-calc-arv-input').waitFor({ timeout: 60000 });
    check('1 unlinked page shows no Save panel', (await T('deal-calc-save-panel').count()) === 0);

    // 2 -- r2 finding 4: the OFF branch offers no Save and reads nothing for it.
    reads.length = 0;
    await linked('&saveDisabled=1');
    await T('deal-calc-save-disabled').waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    /* Integration (I1): the page itself now reads the pipeline once to find the linked contact's deals (Phase 1);
       the OFF panel adds no read of its own -- no notes, no opportunity read. */
    check('2 saving OFF: no Save button, a plain notice, and no notes or opportunity read (only the page\'s own pipeline read)', (await T('deal-calc-save-calculation').count()) === 0 && reads.every((r) => r === 'pipeline') && reads.length <= 1 && /saved automatically in this browser\. Saving a working calculation to your deal in GHL is\s+not turned on/.test(await T('deal-calc-save-disabled').innerText()), reads);

    // 3 -- linked, one deal: auto-selected; empty list; copy distinguishes page vs GHL.
    await linked();
    await T('deal-calc-saved-empty').waitFor({ timeout: 60000 });
    check('3 one deal auto-selects (PB-D55); the explainer is the I2 copy (browser autosave vs Save Calculation to Deal)', (await visible('deal-calc-deal-selected')) && (await T('deal-calc-deal-select').count()) === 0 && (await T('deal-calc-save-explainer').innerText()).trim() === 'Your calculations are saved automatically in this browser. To save a working calculation to your deal in GHL, select Save Calculation to Deal.');

    // 4 -- typing and navigation send nothing.
    await T('deal-calc-arv-input').fill('250000');
    await T('deal-calc-repairs-quick-input').fill('30000');
    await T('deal-calc-test-price-input').fill('150000');
    await T('deal-calc-more-detail-toggle').click(); await T('deal-calc-more-detail-toggle').click();
    await page.waitForTimeout(400);
    check('4 typing figures and toggling panels sends no write (no GHL autosave); changes are labelled kept in this browser only, not in GHL', writes.length === 0 && /Changed since the last calculation saved in GHL \(kept in this browser only\)/.test(await T('deal-calc-unsaved').innerText()), writes.map((w) => w.operation));

    // 5-9 -- one click, one note.create with a v1 carrier and nothing else.
    await T('deal-calc-save-calculation').click();
    await waitState('saved');
    check('5 Save sends exactly one write request', writes.length === 1, writes.map((w) => w.operation));
    check('6 that write is note.create on the linked contact, with its own request id', writes[0]?.operation === 'note.create' && writes[0]?.targetId === CONTACT && typeof writes[0]?.requestId === 'string');
    const first = writes[0] ? await parse(writes[0].args.body) : null;
    check('7 its body is a v1 Deal Calculation carrier for the selected deal with these figures', !!first && first.opportunityId === DEAL1 && first.arvInput === 250000 && first.repairsQuick === 30000 && first.testPrice === 150000 && first.supersedes === null, first);
    check('8 the status says saved to GHL -- a working calculation, not an approval', /Saved to GHL at .* not an approval/.test(await T('deal-calc-save-status').innerText()));
    await T('deal-calc-saved-item-0').waitFor({ timeout: 15000 });
    check('9 the saved calculation is listed as the latest', /\(latest\)/.test(await T('deal-calc-saved-item-0').innerText()));

    // 10 -- r2 finding 2: unchanged figures are not saved again.
    await T('deal-calc-save-calculation').click();
    await waitState('unchanged');
    check('10 Save with unchanged figures sends nothing and says they are already saved', writes.length === 1 && /already saved in GHL/.test(await T('deal-calc-save-status').innerText()));

    // 11 -- r2 finding 2: a rapid double click sends one save.
    await T('deal-calc-arv-input').fill('252000');
    const b11 = writes.length;
    await page.evaluate(() => { const b = document.querySelector('[data-testid="deal-calc-save-calculation"]'); b.click(); b.click(); });
    await waitState('saved'); await page.waitForTimeout(400);
    check('11 two synchronous clicks send exactly one write', writes.length === b11 + 1, writes.slice(b11).map((w) => w.operation));
    const latestOne = writes[writes.length - 1] ? await parse(writes[writes.length - 1].args.body) : null;

    // 12-15 -- a newer saved calculation (another session) blocks the save; nothing sent; choices offered.
    const newerSaved = new Date(Date.now() + 2000).toISOString();
    state.notes.push({ id: 'note-x', body: await format({ ...latestOne, saved: newerSaved, supersedes: latestOne.saved, arvInput: 275000 }), dateAdded: newerSaved });
    await page.waitForTimeout(2100);
    await T('deal-calc-arv-input').fill('260000');
    const before = writes.length;
    await T('deal-calc-save-calculation').click();
    await waitState('newer');
    check('12 a stale save is blocked: nothing is sent', writes.length === before, writes.slice(before).map((w) => w.operation));
    check('13 it offers Load Newer and Save as New', (await visible('deal-calc-newer-load')) && (await visible('deal-calc-save-as-new')));
    await T('deal-calc-save-as-new').click();
    await waitState('saved');
    const asNew = writes[before] ? await parse(writes[before].args.body) : null;
    check('14 Save as New sends one new note that supersedes the newer calculation (no overwrite)', writes.length === before + 1 && !!asNew && asNew.supersedes === newerSaved && asNew.arvInput === 260000, asNew);
    check('15 every write so far is note.create (no ARV, repairs, Current Offer, underwriting or stage write)', writes.every((w) => w.operation === 'note.create'), writes.map((w) => w.operation));

    // 16-20 -- Load asks before replacing unsaved figures.
    await page.waitForTimeout(300);
    await T('deal-calc-arv-input').fill('199000');
    const items = await T('deal-calc-saved-list').locator('[data-testid^="deal-calc-saved-item-"]').count();
    await T(`deal-calc-load-${items - 1}`).click();
    check('16 Load over unsaved figures asks first and changes nothing yet', (await visible('deal-calc-load-confirm-box')) && (await T('deal-calc-arv-input').inputValue()) === '199000');
    await T('deal-calc-load-cancel').click();
    check('17 Keep mine leaves the figures as typed', (await T('deal-calc-arv-input').inputValue()) === '199000' && !(await visible('deal-calc-load-confirm-box')));
    await T(`deal-calc-load-${items - 1}`).click(); await T('deal-calc-load-confirm').click();
    check('18 Replace loads the saved figures and labels them as saved in GHL, not approved', (await T('deal-calc-arv-input').inputValue()) === '250000' && /saved in GHL .* \(not approved\)/.test(await T('deal-calc-loaded-from').innerText()));
    await T('deal-calc-load-0').click();
    check('19 Load over a clean form replaces directly (no prompt)', !(await visible('deal-calc-load-confirm-box')) && (await T('deal-calc-arv-input').inputValue()) === '260000');
    check('20 loading wrote nothing', writes.length === before + 1);

    // 21 -- staleness: approved ARV changed on the deal after the saves.
    const arvId = await page.evaluate(() => window.__dealCalc.arvField);
    state.oppFields = [{ id: arvId, fieldValue: 300000 }];
    await linked();
    await T('deal-calc-saved-item-0').waitFor({ timeout: 30000 });
    check('21 a calculation saved before an approved-ARV change is flagged', (await T('deal-calc-stale-arv-0').count()) === 1);

    // 22 -- itemized repairs are not saved in this phase.
    await T('deal-calc-repairs-mode-toggle').click();
    const b22 = writes.length;
    await T('deal-calc-save-calculation').click();
    await waitState('refused');
    check('22 itemized mode: Save refuses with nothing sent', writes.length === b22 && /Itemized repairs are not saved yet/.test(await T('deal-calc-save-status').innerText()));
    await T('deal-calc-repairs-mode-toggle').click();

    // 23-28 -- r2 finding 2: an unconfirmed save that never landed.
    state.writeMode = 'refuse';
    await T('deal-calc-arv-input').fill('261000');
    const b23 = writes.length;
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    const unconfBody = writes[b23]?.args?.body;
    check('23 an unconfirmed outcome is shown as "may or may not be in GHL", never as saved or refused', writes.length === b23 + 1 && /may or may not be in GHL/.test(await T('deal-calc-save-status').innerText()));
    await T('deal-calc-arv-input').fill('262000');
    await page.evaluate(() => document.querySelector('[data-testid="deal-calc-save-calculation"]').click());
    await page.waitForTimeout(400);
    check('24 no fresh save is possible while it is unreconciled (the button is disabled; a click sends nothing)', writes.length === b23 + 1 && (await T('deal-calc-save-calculation').isDisabled()));
    await T('deal-calc-unconfirmed-check').click();
    await until(async () => visible('deal-calc-unconfirmed-resend'));
    check('25 Check GHL: not found yet -> still blocked, offers to resend the same calculation, and sent nothing', writes.length === b23 + 1 && (await stateOf()) === 'unconfirmed' && (await visible('deal-calc-unconfirmed-resend')));
    state.writeMode = 'ok';
    await T('deal-calc-unconfirmed-resend').click();
    await waitState('saved');
    const resent = writes[b23 + 1];
    check('26 Resend sends the IDENTICAL note (same Saved) under a new request id', !!resent && resent.args.body === unconfBody && resent.requestId !== writes[b23].requestId, resent && resent.requestId);
    check('27 GHL holds exactly one copy of that note', state.notes.filter((n) => n.body === unconfBody).length === 1);
    check('28 after reconciling, the figures typed during the block (262000) were never sent', writes.every((w) => !/ARV input: 262000/.test(w.args?.body || '')));

    // 29-30 -- r2 finding 2: an unconfirmed save that DID land is reconciled without a second write.
    state.writeMode = 'lost';
    await T('deal-calc-arv-input').fill('263000');
    const b29 = writes.length;
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    state.writeMode = 'ok';
    await T('deal-calc-unconfirmed-check').click();
    await waitState('saved');
    check('29 Check GHL finds the landed note and shows it saved', /Saved to GHL/.test(await T('deal-calc-save-status').innerText()));
    check('30 reconciling a landed note sends nothing further', writes.length === b29 + 1);

    // 31 -- an unreadable notes read is never shown as "none".
    state.notesFail = true;
    await linked();
    await T('deal-calc-saved-read-error').waitFor({ timeout: 30000 });
    check('31 a notes read failure shows "could not be read", never the empty list', (await T('deal-calc-saved-empty').count()) === 0);
    state.notesFail = false;

    // 32-33 -- two deals need an explicit choice.
    state.deals = [DEAL1, DEAL2];
    await linked();
    await T('deal-calc-deal-select').waitFor({ timeout: 30000 });
    check('32 two deals: no Save until a deal is chosen (PB-D55)', (await T('deal-calc-save-calculation').count()) === 0);
    await T('deal-calc-deal-select').selectOption(DEAL2);
    await T('deal-calc-save-calculation').waitFor({ timeout: 15000 });
    check('33 after choosing, Save is offered for that deal', /Deal 2/.test(await T('deal-calc-deal-selected').innerText()));

    // 34-36 -- r2 finding 1: deal A's late SAVE completion never reaches deal B.
    await T('deal-calc-deal-select').selectOption(DEAL1);
    await until(async () => (await T('deal-calc-saved-list').count()) > 0);
    await T('deal-calc-arv-input').fill('264000');
    state.holdWrite = gate();
    const b34 = writes.length;
    await T('deal-calc-save-calculation').click();
    await until(async () => writes.length === b34 + 1);
    await T('deal-calc-deal-select').selectOption(DEAL2);
    await until(async () => /Deal 2/.test(await T('deal-calc-deal-selected').innerText()));
    state.holdWrite.open(); state.holdWrite = null;
    await page.waitForTimeout(800);
    const deal2Items = await page.locator('[data-testid^="deal-calc-saved-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-deal')));
    check('34 after A\'s save completes while B is shown, B\'s panel shows no "saved" state from A', (await stateOf()) !== 'saved' && !/Saved to GHL/.test(await T('deal-calc-save-status').innerText()), await stateOf());
    check('35 B\'s list never shows A\'s calculations', deal2Items.every((d) => d === DEAL2), deal2Items);
    await T('deal-calc-deal-select').selectOption(DEAL1);
    await until(async () => (await T('deal-calc-saved-list').count()) > 0);
    check('36 back on A: its save was confirmed (no unconfirmed block) and is listed', (await stateOf()) === 'idle' && /\$264,000/.test(await T('deal-calc-saved-item-0').innerText()), await stateOf());

    // 37 -- r2 finding 1: deal A's late EVIDENCE read never fills deal B.
    state.holdOpp = { id: DEAL1, gate: gate() };
    await T('deal-calc-deal-select').selectOption(DEAL2);
    await T('deal-calc-deal-select').selectOption(DEAL1);
    await page.waitForTimeout(200);
    await T('deal-calc-deal-select').selectOption(DEAL2);
    await until(async () => /Deal 2/.test(await T('deal-calc-deal-selected').innerText()));
    await page.waitForTimeout(300);
    state.holdOpp.gate.open(); state.holdOpp = null;
    await page.waitForTimeout(800);
    const after37 = await page.locator('[data-testid^="deal-calc-saved-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-deal')));
    check('37 A\'s late evidence read does not populate B (B shows only B or nothing)', after37.every((d) => d === DEAL2) && /Deal 2/.test(await T('deal-calc-deal-selected').innerText()), after37);

    // 38 -- I1: one deal picker on the page; the panel has none of its own.
    check('38 I1: the page shows exactly ONE deal picker (the panel has none of its own)', (await T('deal-calc-deal-select').count()) === 1 && (await page.locator('[data-testid="deal-calc-save-panel"] select').count()) === 0);

    // 39-41 -- I3: Load goes through Phase 1's keep path and is labelled as loaded from GHL.
    const keptArv = (deal) => page.evaluate((d) => Object.keys(localStorage).filter((k) => k.includes('|' + d)).map((k) => JSON.parse(localStorage.getItem(k)).fields.arv?.value ?? null), deal);
    await T('deal-calc-deal-select').selectOption(DEAL1);
    await until(async () => (await T('deal-calc-saved-list').count()) > 0);
    const items39 = await page.locator('[data-testid^="deal-calc-saved-item-"]').count();
    await T('deal-calc-load-' + (items39 - 1)).click();
    if (await visible('deal-calc-load-confirm-box')) await T('deal-calc-load-confirm').click();
    await page.waitForTimeout(600);
    const loadedArv = await T('deal-calc-arv-input').inputValue();
    const note39 = (await T('deal-calc-draft-restored').count()) ? await T('deal-calc-draft-restored').innerText() : '';
    check('39 I3: Load labels the figures as loaded from GHL and kept in this browser as this deal\'s draft', loadedArv === '250000' && /^Loaded the calculation saved in GHL on .*kept in this browser as this deal's draft/.test(note39), { loadedArv, note39 });
    const kept40 = await keptArv(DEAL1);
    check('40 I3: the loaded figures are this deal\'s browser draft (Phase 1\'s own keep path), and only this deal\'s', kept40.length === 1 && String(kept40[0]) === '250000' && (await keptArv(DEAL2)).every((v) => String(v) !== '250000'), { kept40 });
    await linked();
    await T('deal-calc-deal-select').waitFor({ timeout: 30000 });
    await T('deal-calc-deal-select').selectOption(DEAL1);
    await until(async () => (await T('deal-calc-arv-input').inputValue()) === '250000');
    const note41 = (await T('deal-calc-draft-restored').count()) ? await T('deal-calc-draft-restored').innerText() : '';
    check('41 I3: after a reload the same figures are restored from this browser and labelled so (not as saved in GHL)', (await T('deal-calc-arv-input').inputValue()) === '250000' && /^Restored the figures kept in this browser/.test(note41) && !/saved in GHL/.test(note41), note41);

    // 42-43 -- I4: an operator change resets the panel: no unconfirmed save and no late result crosses operators.
    const signIn = (sub) => page.evaluate(async (s) => {
      const m = await import('/src/lib/app-write-session.ts');
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      m.setAppWriteSession({ token: b64({ alg: 'none' }) + '.' + b64({ sub: s }) + '.x', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    }, sub);
    const chooseDeal1 = async () => { if (await visible('deal-calc-deal-select')) { await T('deal-calc-deal-select').selectOption(DEAL1); } await until(async () => (await T('deal-calc-saved-list').count()) > 0); };
    await signIn('op-a'); await page.waitForTimeout(300); await chooseDeal1();
    await T('deal-calc-arv-input').fill('271000');
    state.writeMode = 'lost';
    const b42 = writes.length;
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    state.writeMode = 'ok';
    await signIn('op-b'); await page.waitForTimeout(400); await chooseDeal1();
    await T('deal-calc-arv-input').fill('272000');
    await page.waitForTimeout(300);
    check('42 I4: after operator A\'s unconfirmed save, operator B sees no unconfirmed state from A and is not blocked', writes.length === b42 + 1 && (await stateOf()) !== 'unconfirmed' && !/may or may not be in GHL/.test(await T('deal-calc-save-status').innerText()) && !(await T('deal-calc-save-calculation').isDisabled()), await stateOf());
    await T('deal-calc-arv-input').fill('273000');
    state.holdWrite = gate();
    const b43 = writes.length;
    await T('deal-calc-save-calculation').click();
    await until(async () => writes.length === b43 + 1);
    await signIn('op-c'); await page.waitForTimeout(400); await chooseDeal1();
    state.holdWrite.open(); state.holdWrite = null;
    await page.waitForTimeout(800);
    check('43 I4: B\'s late save completion does not show as "saved" for operator C', (await stateOf()) !== 'saved' && !/Saved to GHL/.test(await T('deal-calc-save-status').innerText()), await stateOf());

    check('44 no page errors, no foreign or unmodelled requests', pageErrors.length === 0 && foreign.length === 0 && unmodelled.length === 0, { pageErrors, foreign, unmodelled });
  } catch (e) {
    failures += 1; console.error('FAIL  run aborted: ' + (e && e.stack || e));
  }
  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR + (mutation ? ' mutation=' + mutationName + ' applied=' + mutationApplied : ''));
  if (mutation && mutationApplied < 1) { console.error('ABORT: the mutation was not applied'); return exit(2); }
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks); return exit(failures ? 1 : 2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main();
