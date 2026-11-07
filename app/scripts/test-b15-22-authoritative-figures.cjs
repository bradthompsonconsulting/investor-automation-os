/**
 * Board #15 B15-22 / INV-131 (F41, F42, F44) -- which repair / offer / ARV
 * figure counts, labelled per surface. Offline; no network, no GHL.
 *
 *   U  pure wording: recorded-vs-live Seller MAO, ARV on record, deal-bar notes
 *   R  rendered (react-dom/server) from the REAL components: the Underwriting
 *      rail cell and decision-panel figure, the ARV workspace with and without
 *      a property address, the ARV-on-record line
 *   T  r3 (Bones REVISE): read-generation binding of the ARV confirmation and
 *      the submitted-snapshot binding of the recorded Seller MAO, as sequences
 *      over the REAL helpers the components call (wiring pinned in S9/S10)
 *   S  source wiring: each page uses them; Approve, the write paths and the
 *      disposition note format are byte-identical to the base (a55ead5)
 *   N  zero non-GET requests: rendering issues none; the one new read is the
 *      existing GET ghl.notes.list
 *
 * PORTABLE: base identity is checked against committed SHA-256 pins
 * (scripts/fixtures/b15-22-base-pins-a55ead5.json, base
 * a55ead578a81f2c04644306d948dc9a1a95b978c), extracted exactly as below, so
 * no git object or history is needed and the suite runs on any clone.
 *
 * Bundled with esbuild (as test-generate-contract-pdf-adapter.cjs does) so the
 * real component import graph loads in Node; React stays external so one
 * React instance renders.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PINS = JSON.parse(fs.readFileSync(path.join(APP, 'scripts', 'fixtures', 'b15-22-base-pins-a55ead5.json'), 'utf8'));
/* A missing pin section never passes silently: it is empty, and every check that relies on it FAILs. */
for (const k of ['functions', 'protected', 'writeCounts']) if (!PINS[k] || typeof PINS[k] !== 'object') PINS[k] = {};
if (!Array.isArray(PINS.arvBaseGhlCalls)) PINS.arvBaseGhlCalls = [];
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const TMP = path.join(APP, '.tmp-b15-22-authoritative-test');
const esbuild = require(path.join(APP, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'));

/** Literal check() call-site count in this file. */
const FLOOR = 99;   // Board #15 integration r2: + S8a (the reviewed combined-integration delta); Release 15-B: + S8b (Release 15-A delta); Integration 15-C: + S8c (F5 R2 delta)
let checks = 0; let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

// ── network accounting: every fetch during this run is counted ───────────────
const requests = [];
globalThis.fetch = async (url, init) => { requests.push({ url: String(url), method: (init && init.method) || 'GET' }); throw new Error('offline'); };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
function bundle(entry, out) {
  esbuild.buildSync({
    entryPoints: [path.join(APP, entry)], outfile: path.join(TMP, out), bundle: true, platform: 'node', format: 'cjs',
    jsx: 'automatic', target: 'es2022', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom'],
    define: { 'import.meta.env': '{}' },
  });
  return require(path.join(TMP, out));
}
let F, C, DB, ARVW;
try {
  F = bundle('src/lib/authoritative-figures.ts', 'figures.cjs');
  C = bundle('src/components/AuthoritativeFigures.tsx', 'components.cjs');
  DB = bundle('src/lib/seller-call-deal-bar.ts', 'deal-bar.cjs');
  /* The workspace reads the runtime configuration at module scope (as in the
     browser, after iaos-runtime-config answers), so a wrapper sets the Test
     projection first and only then loads the REAL component. */
  const fwd = (p) => p.replace(/\\/g, '/');
  fs.writeFileSync(path.join(TMP, 'arv-entry.ts'),
    `import { setRuntimeConfig, projectRuntimeConfig, getConfig } from "${fwd(path.join(APP, 'shared', 'ghl-config'))}";\n` +
    `setRuntimeConfig(projectRuntimeConfig(getConfig("test")));\n` +
    `export const load = () => require("${fwd(path.join(APP, 'src', 'components', 'ArvCompsWorkspace.tsx'))}");\n`);
  esbuild.buildSync({
    entryPoints: [path.join(TMP, 'arv-entry.ts')], outfile: path.join(TMP, 'arv-workspace.cjs'), bundle: true, platform: 'node', format: 'cjs',
    jsx: 'automatic', target: 'es2022', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom'], define: { 'import.meta.env': '{}' },
  });
  ARVW = require(path.join(TMP, 'arv-workspace.cjs')).load();
} catch (e) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('ABORT: bundling failed. Nothing tested.\n' + (e && e.message));
  process.exit(10);
}
const React = require(path.join(APP, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(path.join(APP, 'node_modules', 'react-dom', 'server'));
const h = React.createElement;
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
function testId(html, id) {
  const m = new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</(span|div|button)>`).exec(html);
  return m ? text(m[1]) : null;
}

// ═══ U -- pure wording ═══════════════════════════════════════════════════════
const none = F.compareSellerMao({ recorded: null, live: 165000 });
check('U1 no recorded MAO: rail says none recorded yet', none.recordedText, 'None recorded yet');
check('U1 no recorded MAO: live figure is not yet approved', none.liveNote, 'Not yet approved — no approved underwriting recorded yet');
const same = F.compareSellerMao({ recorded: 165000, live: 165000 });
check('U2 equal: rail shows the recorded figure', same.recordedText, '$165,000');
check('U2 equal: live matches the record', [same.token, same.liveNote], ['matches', 'Matches the approved underwriting on record']);
const diff = F.compareSellerMao({ recorded: 150000, live: 165000 });
check('U3 differs: live note names the approved figure', diff.liveNote, 'Not yet approved — differs from approved $150,000');
check('U3 differs: rail shows the RECORDED figure, not the live one', diff.recordedText, '$150,000');
const noLive = F.compareSellerMao({ recorded: 150000, live: null });
check('U4 nothing calculated: no live note, record still shown', [noLive.liveNote, noLive.recordedText, noLive.token], [null, '$150,000', 'no_live']);
check('U5 a recorded 0 is a value, not absence', F.compareSellerMao({ recorded: 0, live: 1 }).recordedText, '$0');
check('U6 contact rail provenance says approved underwriting', F.railSellerMaoProvenance('Alpha Deal'), 'Approved underwriting · Alpha Deal');
check('U7 ARV matched ledger -> approved', F.arvOnRecordState({ latestLedgerArv: 250000, matchedArv: 250000, currentArv: 250000 }), { kind: 'approved', amount: 250000 });
check('U7 ARV ledger differs from ARV on file -> mismatch, not approved', F.arvOnRecordState({ latestLedgerArv: 240000, matchedArv: null, currentArv: 250000 }).kind, 'mismatch');
check('U7 ARV ledger but no ARV on file -> not approved', F.arvOnRecordState({ latestLedgerArv: 240000, matchedArv: null, currentArv: null }).kind, 'no_arv_on_file');
check('U7 no ledger -> none', F.arvOnRecordState({ latestLedgerArv: null, matchedArv: null, currentArv: 250000 }).kind, 'none');
check('U8 approved text', F.arvOnRecordText({ kind: 'approved', amount: 250000 }), "Approved ARV on record $250,000 — the comps below are this session's working evidence");
check('U8 none text', F.arvOnRecordText({ kind: 'none' }), "No approved ARV on record — the comps below are this session's working evidence");
check('U8 mismatch text never says approved on record', /Approved ARV on record/.test(F.arvOnRecordText({ kind: 'mismatch', ledgerAmount: 1, currentArv: 2 })), false);
check('U9 disposition labels match the AGREEMENT REACHED banner', [F.DISPOSITION_ARV_LABEL, F.DISPOSITION_REPAIRS_LABEL], ['ARV at acceptance', 'Repairs at acceptance']);

// Deal bar: notes only; labels and numbers unchanged.
const board8 = { status: 'calculated', maxSupportedOffer: 180000, target: { status: 'calculated', targetAcquisitionPrice: 160000 } };
const base = { arv: 250000, repairs: 40000, sellerPosition: null, currentOffer: null, currentOfferStatus: 'recorded', board8, expectedSpread: null };
const plain = DB.buildDealBarCells(base);
const noted = DB.buildDealBarCells({ ...base, arvApproval: 'approved', repairsApproval: 'unverified' });
const cell = (cells, k) => cells.find((c) => c.key === k);
check('U10 deal bar labels unchanged', noted.map((c) => c.label), DB.DEAL_BAR_LABELS);
check('U10 deal bar numbers unchanged by the notes', noted.map((c) => c.value.text), plain.map((c) => c.value.text));
check('U11 ARV note: approved', cell(noted, 'arv').value.note, 'Approved');
check('U11 Repairs note: on file, not verified', cell(noted, 'repairs').value.note, 'On file, not verified as operator-approved');
check('U11 ARV note: no ledger entry', cell(DB.buildDealBarCells({ ...base, arvApproval: 'unverified' }), 'arv').value.note, 'On file, no approval ledger entry found');
check('U11 ARV note: ledger mismatch', cell(DB.buildDealBarCells({ ...base, arvApproval: 'ledger_mismatch' }), 'arv').value.note, 'On file — approval ledger does not match this amount');
check('U12 Target and Max say calculated now', [cell(noted, 'target').value.note, cell(noted, 'max').value.note], ['Calculated now from these inputs', 'Calculated now from these inputs']);
check('U12 a waiting Target/Max carries no note', [cell(DB.buildDealBarCells({ ...base, board8: null }), 'max').value.kind, cell(DB.buildDealBarCells({ ...base, board8: null }), 'max').value.note], ['waiting', undefined]);
check('U13 a waiting ARV carries no approval note', cell(DB.buildDealBarCells({ ...base, arv: null, arvApproval: 'approved' }), 'arv').value.note, undefined);

// ═══ R -- rendered ═══════════════════════════════════════════════════════════
{
  const rail = renderToStaticMarkup(h(C.RecordedSellerMaoCell, { comparison: diff, waiting: null }));
  check('R1 rail cell label: recorded approved underwriting', testId(rail, 'underwriting-rail-recorded-mao-label'), 'Seller MAO · Approved underwriting (recorded)');
  check('R1 rail cell value: the recorded figure', testId(rail, 'underwriting-rail-recorded-mao-value'), '$150,000');
  const railNone = renderToStaticMarkup(h(C.RecordedSellerMaoCell, { comparison: none, waiting: 'Waiting for Assignment Mode' }));
  check('R2 rail cell with nothing recorded says so', testId(railNone, 'underwriting-rail-recorded-mao-value'), 'None recorded yet');
  check('R2 rail cell keeps the calculation wait', testId(railNone, 'underwriting-rail-calculated-waiting'), 'Calculated now: Waiting for Assignment Mode');
  const live = renderToStaticMarkup(h(C.LiveSellerMaoFigure, { text: '$165,000', comparison: diff }));
  check('R3 live figure label: calculated now', testId(live, 'underwriting-live-mao-label'), 'Seller MAO — calculated now');
  check('R3 live figure label never claims approval', /approved|recorded/i.test(testId(live, 'underwriting-live-mao-label') || ''), false);
  check('R3 live figure value', testId(live, 'underwriting-live-mao-value'), '$165,000');
  check('R4 live figure says it differs from the approved figure', testId(live, 'underwriting-live-mao-note'), 'Not yet approved — differs from approved $150,000');
  check('R4 rail and decision-panel labels differ (the live label carries no part of the recorded label)',
    testId(rail, 'underwriting-rail-recorded-mao-label') !== testId(live, 'underwriting-live-mao-label')
      && !(testId(live, 'underwriting-live-mao-label') || '').includes(F.RECORDED_SELLER_MAO_LABEL), true);
  const liveNone = renderToStaticMarkup(h(C.LiveSellerMaoFigure, { text: '$165,000', comparison: none }));
  check('R5 live figure with nothing recorded: not yet approved', testId(liveNone, 'underwriting-live-mao-note'), 'Not yet approved — no approved underwriting recorded yet');
  const arvLine = renderToStaticMarkup(h(C.ArvOnRecordLine, { state: { kind: 'approved', amount: 250000 } }));
  check('R6 ARV-on-record line renders the approved figure', testId(arvLine, 'arv-on-record'), "Approved ARV on record $250,000 — the comps below are this session's working evidence");
}
{
  const noAddress = { id: 'c-1', firstName: 'Alpha', lastName: 'Fixture', address1: '', city: '', state: '', postalCode: '', customFields: [] };
  const withAddress = { ...noAddress, address1: '12 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
  const html = renderToStaticMarkup(h(ARVW.default, { contact: noAddress, opportunityId: 'opp-1', currentArv: null }));
  check('R7 no address: the subject-fact grid is collapsed', /data-testid="arv-subject-facts"/.test(html), false);
  check('R7 no address: no subject-fact inputs render', /data-testid="arv-subject-(propertyType|squareFeet|subdivision|beds|baths|yearBuilt)"/.test(html), false);
  check('R7 no address: says add the address first', testId(html, 'arv-address-first'), 'Add the property address first — comps and property facts need it.');
  check('R7 no address: the facts are still reachable on request', testId(html, 'arv-show-subject-facts'), 'Enter property facts anyway (this session only)');
  check('R7 no address: Get Comps still disabled (unchanged)', /data-testid="arv-get-comps" disabled=""/.test(html), true);
  check('R8 ARV-on-record line sits above the session comps', html.indexOf('data-testid="arv-on-record"') > 0 && html.indexOf('data-testid="arv-on-record"') < html.indexOf('data-testid="arv-summary"'), true);
  check('R8 before the ledger read answers it says it is reading', testId(html, 'arv-on-record'), 'Reading the ARV approval record…');
  const html2 = renderToStaticMarkup(h(ARVW.default, { contact: withAddress, opportunityId: 'opp-1', currentArv: 250000 }));
  check('R9 with an address: the subject-fact grid renders', /data-testid="arv-subject-facts"/.test(html2) && /data-testid="arv-subject-squareFeet"/.test(html2), true);
  check('R9 with an address: no address-first notice', /data-testid="arv-subject-facts-collapsed"/.test(html2), false);
}

// ═══ T -- r3: confirmations bound to the read / operation they supplement ════
{
  /* ARV. The component derives its read generation with nextArvReadGeneration,
     tags each ledger read with it, and renders arvOnRecordFor; these are those
     REAL helpers driven through the reviewed sequences. fromLedger is the
     component's own composition (latest/matching ledger readers -> state),
     modelled here by a ledger of { amount } entries. */
  const K = 'c-1|opp-1'; const K2 = 'c-1|opp-2';
  const ledgerState = (currentArv) => (notes) => F.arvOnRecordState({
    latestLedgerArv: notes.length ? notes[notes.length - 1].amount : null,
    matchedArv: notes.length && notes[notes.length - 1].amount === currentArv ? currentArv : null,
    currentArv,
  });
  const contact0 = { id: 'c-1' };
  let g = F.nextArvReadGeneration(null, contact0, 200000);
  check('T1 read generation: a repeated render of the same read keeps it (no ledger re-read)', F.nextArvReadGeneration(g, contact0, 200000) === g && g.gen === 0, true);
  // Save X = 250,000 starts and confirms on read generation 0.
  const conf = F.arvConfirmationOnSave({ started: { key: K, gen: 0 }, key: K, gen: 0, amount: 250000, basisArv: 200000 });
  const ledger0 = { key: K, gen: 0, notes: [] }; // read before the save: no approval yet
  check('T2 save X confirmed on this read: approved X (the page has not re-read)',
    F.arvOnRecordFor({ key: K, gen: 0, confirmation: conf, ledger: ledger0, fromLedger: ledgerState(200000) }), { kind: 'approved', amount: 250000 });
  // Same-deal refresh reads ARV Y = 260,000: a new contact object AND a changed ARV.
  const contact1 = { id: 'c-1' };
  const g1 = F.nextArvReadGeneration(g, contact1, 260000);
  check('T3 a newer read (new contact object, changed ARV) moves the generation', g1.gen, 1);
  check('T3 newer read Y: the older confirmation is RETIRED and the old ledger answer is not reused -- the line waits for the ledger re-read',
    F.arvOnRecordFor({ key: K, gen: g1.gen, confirmation: conf, ledger: ledger0, fromLedger: ledgerState(260000) }), { kind: 'loading' });
  check('T3 ledger re-read for Y (latest approval X): reconciled -- mismatch, never "approved X"',
    F.arvOnRecordFor({ key: K, gen: 1, confirmation: conf, ledger: { key: K, gen: 1, notes: [{ amount: 250000 }] }, fromLedger: ledgerState(260000) }), { kind: 'mismatch', ledgerAmount: 250000, currentArv: 260000 });
  check('T3 ledger re-read for Y (latest approval Y): approved Y from the ledger',
    F.arvOnRecordFor({ key: K, gen: 1, confirmation: conf, ledger: { key: K, gen: 1, notes: [{ amount: 250000 }, { amount: 260000 }] }, fromLedger: ledgerState(260000) }), { kind: 'approved', amount: 260000 });
  // Same value re-read: a refresh that reads X itself.
  const gSame = F.nextArvReadGeneration(g, { id: 'c-1' }, 250000);
  check('T4 same-value re-read: the ledger re-read agrees -- approved X, consistent',
    F.arvOnRecordFor({ key: K, gen: gSame.gen, confirmation: conf, ledger: { key: K, gen: gSame.gen, notes: [{ amount: 250000 }] }, fromLedger: ledgerState(250000) }), { kind: 'approved', amount: 250000 });
  check('T4 a changed ARV alone (same contact object) is a newer read too', F.nextArvReadGeneration(g, contact0, 250000).gen, 1);
  check('T5 other deal: neither the confirmation nor the other deal\'s ledger is shown',
    F.arvOnRecordFor({ key: K2, gen: 0, confirmation: conf, ledger: ledger0, fromLedger: ledgerState(200000) }), { kind: 'loading' });
  check('T5 other deal, its own ledger read: its own record only',
    F.arvOnRecordFor({ key: K2, gen: 0, confirmation: conf, ledger: { key: K2, gen: 0, notes: [] }, fromLedger: ledgerState(200000) }), { kind: 'none' });
  check('T6 ledger re-read fails on the newer read: unavailable (the retired confirmation is not a fallback)',
    F.arvOnRecordFor({ key: K, gen: 1, confirmation: conf, ledger: { key: K, gen: 1, notes: null }, fromLedger: ledgerState(260000) }), { kind: 'unavailable' });
  const g2 = F.nextArvReadGeneration(g1, { id: 'c-1' }, 260000);
  check('T6 recovery: a later successful re-read (next generation) re-reads the ledger and recovers',
    [g2.gen, F.arvOnRecordFor({ key: K, gen: g2.gen, confirmation: conf, ledger: { key: K, gen: g2.gen, notes: [{ amount: 260000 }] }, fromLedger: ledgerState(260000) })],
    [2, { kind: 'approved', amount: 260000 }]);
  check('T6 until that re-read answers, the failed answer of the previous generation is not shown',
    F.arvOnRecordFor({ key: K, gen: 2, confirmation: null, ledger: { key: K, gen: 1, notes: null }, fromLedger: ledgerState(260000) }), { kind: 'loading' });
  check('T7 a newer read while the save was in flight: no confirmation (the newer read is the record)',
    F.arvConfirmationOnSave({ started: { key: K, gen: 0 }, key: K, gen: 1, amount: 250000, basisArv: 260000 }), null);
  check('T7 a save that started on another deal: no confirmation',
    F.arvConfirmationOnSave({ started: { key: K2, gen: 0 }, key: K, gen: 0, amount: 250000, basisArv: 200000 }), null);

  /* Seller MAO. onApprove captures submittedApprovalSnapshot before it awaits
     and applies confirmSubmittedApproval on result.ok; the page renders
     recordedSellerMaoFor -> compareSellerMao -> the REAL rail cell and live
     figure. Delayed-confirmation regression with a changed calculation: */
  const readA = [{ id: 'opp-1' }]; const readB = [{ id: 'opp-1' }]; // the pipeline read when Approve started / after a mode change re-read
  const A = 150000; const B = 165000;
  const sub = F.submittedApprovalSnapshot(1, 'opp-1', { sellerMAO: A, endBuyerMaxPrice: 180000, sellerAsk: 1 }, 'Assignment');
  check('M1 the snapshot is exactly the submitted identity and figures (no other screen value)', sub, { op: 1, opportunityId: 'opp-1', sellerMAO: A, endBuyerMaxPrice: 180000, assignmentMode: 'Assignment' });
  // While pending: the mode changes, the page re-reads (readB) and the calculation becomes B; the record read holds no MAO yet.
  const confirmed = F.confirmSubmittedApproval(null, sub, 1, readB);
  const recorded = F.recordedSellerMaoFor({ confirmed, selectedId: 'opp-1', read: readB, fromRead: null });
  const cmp = F.compareSellerMao({ recorded, live: B });
  const railHtml = renderToStaticMarkup(h(C.RecordedSellerMaoCell, { comparison: cmp, waiting: null }));
  const liveHtml = renderToStaticMarkup(h(C.LiveSellerMaoFigure, { text: F.money(B), comparison: cmp }));
  check('M2 delayed confirmation after the calculation changed to B: the rail records the SUBMITTED A',
    [testId(railHtml, 'underwriting-rail-recorded-mao-label'), testId(railHtml, 'underwriting-rail-recorded-mao-value')], ['Seller MAO · Approved underwriting (recorded)', '$150,000']);
  check('M2 ...and calculated-now B says it differs from approved A',
    [testId(liveHtml, 'underwriting-live-mao-value'), testId(liveHtml, 'underwriting-live-mao-note')], ['$165,000', 'Not yet approved — differs from approved $150,000']);
  check('M3 a confirmation for another Opportunity is ignored (the selected one\'s own read counts)',
    F.recordedSellerMaoFor({ confirmed, selectedId: 'opp-2', read: readB, fromRead: 99000 }), 99000);
  check('M4 a superseded operation\'s confirmation changes nothing (newer Approve op 2 started)',
    [F.confirmSubmittedApproval(null, sub, 2, readB), F.confirmSubmittedApproval(confirmed, F.submittedApprovalSnapshot(1, 'opp-1', { sellerMAO: 1, endBuyerMaxPrice: 1 }, 'x'), 2, readA)],
    [null, confirmed]);
  check('M5 the next pipeline read retires it: what the Opportunity read holds',
    F.recordedSellerMaoFor({ confirmed, selectedId: 'opp-1', read: [{ id: 'opp-1' }], fromRead: A }), A);
  check('M5 with no confirmation the read is the record', F.recordedSellerMaoFor({ confirmed: null, selectedId: 'opp-1', read: readA, fromRead: 120000 }), 120000);
}

// ═══ S -- source wiring and unchanged authority ══════════════════════════════
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const fnText = (src, start, end = '\n}\n') => { const i = src.indexOf(start); if (i < 0) return null; const j = src.indexOf(end, i); return j < 0 ? null : src.slice(i, j); };
const uw = read('src/pages/UnderwritingWorkspace.tsx');
check('S1 Underwriting rail renders the recorded cell', uw.includes('<RecordedSellerMaoCell comparison={maoComparison} waiting={waiting} />'), true);
check('S1 Underwriting decision panel renders the live figure', uw.includes('<LiveSellerMaoFigure text={money(screen.figures.sellerMAO)} comparison={maoComparison} />'), true);
check('S1 no plain same-name "Seller MAO" figure label remains on the page', /cell\("Seller MAO"|>Seller MAO</.test(uw), false);
check('S2 recorded MAO is the Opportunity field, read with the rail\'s reader (no new request)',
  uw.includes('readOpportunityNumber(opp.customFields, CONFIG.opportunityFields.sellerMAO)') && !/ghl\.[a-zA-Z.]+\(/.test(uw.slice(uw.indexOf('const recordedSellerMAO'), uw.indexOf('const screen: ScreenState'))), true);
check('S2 the rail is handed the comparison, the live figure the same comparison', uw.includes('maoComparison={maoComparison}') && uw.includes('    recorded: recordedForScreen,') && uw.includes('live: screen.state === "resolved" ? screen.figures.sellerMAO : null'), true);
/* r3: Approve gains exactly two lines, each marked "// B15-22 snapshot", that
   only RECORD what it sends (Bones REVISE P2 #2 asks for the capture in the
   operation itself). With them removed the handler must hash to the base pin,
   so its gating, request and outcome handling are byte-identical. */
const SNAP = '// B15-22 snapshot';
const onApproveNow = fnText(uw, '  async function onApprove()', '\n  }\n') || '';
const snapLines = onApproveNow.split('\n').filter((l) => l.includes(SNAP));
check('S3 Approve handler, minus its two marked snapshot lines, byte-identical to base (SHA-256 pin)',
  sha(onApproveNow.split('\n').filter((l) => !l.includes(SNAP)).join('\n')), PINS.functions.onApprove);
check('S3 the two snapshot lines: the capture before the request (same screen values it sends), the confirmation on result.ok; neither calls GHL or writes',
  snapLines.length === 2
    && snapLines[0].trim() === `const submitted = submittedApprovalSnapshot(++approveOp.current, screen.opportunity.id, screen.figures, OPTION_BY_MODE[screen.assignment.kind]); ${SNAP}`
    && snapLines[1].trim() === `setApprovedThisVisit((prev) => confirmSubmittedApproval(prev, submitted, approveOp.current, oppsRef.current)); ${SNAP}`
    && onApproveNow.indexOf(snapLines[0]) < onApproveNow.indexOf('await ghl.underwriting.saveUnderwritingFields(')
    && onApproveNow.indexOf('if (result.ok) {') < onApproveNow.indexOf(snapLines[1])
    && onApproveNow.indexOf(snapLines[1]) < onApproveNow.indexOf('setApprove({ status: "succeeded" });')
    && !/ghl\.|persist|save[A-Z]/.test(snapLines.join('\n')), true);
check('S3 ApproveControl byte-identical to base (SHA-256 pin)', sha(fnText(uw, 'function ApproveControl(') || ''), PINS.functions.ApproveControl);
check('S3 RepairEstimator byte-identical to base (SHA-256 pin)', sha(fnText(uw, 'function RepairEstimator(') || ''), PINS.functions.RepairEstimator);
{
  const arvNow = read('src/components/ArvCompsWorkspace.tsx');
  const span = (s) => s.slice(s.indexOf('  async function persist('), s.indexOf('  const reconciliation = run?.reconciliation;'));
  check('S3 ARV persist / approve / override / Get Comps byte-identical to base (SHA-256 pin)', span(arvNow).length > 500 && sha(span(arvNow)) === PINS.functions.arvPersistSpan
    && arvNow.includes('data-testid="arv-get-comps" disabled={!address || handoffBusy}'), true);
}
check('S4 contact rail MAO provenance uses the shared wording', read('src/lib/rail.ts').includes('provenance: railSellerMaoProvenance(deal.opportunityName)'), true);
const sc = read('src/pages/SellerCallWorkspace.tsx');
check('S5 Seller Call deal bar gets the ARV approval state from the ledger reads',
  sc.includes('arvApproval: matchedArvApproval ? "approved" : latestArvLedgerEntry ? "ledger_mismatch" : "unverified"'), true);
check('S5 Seller Call deal bar gets the repairs approval state', sc.includes('repairsApproval: pipeline.repairsSourceIsApprovalGated ? "approved" : "unverified"'), true);
const ct = read('src/pages/ContractWorkspace.tsx');
check('S6 disposition preview: ARV / Repairs at acceptance', ct.includes('{DISPOSITION_ARV_LABEL}: {money(pkg.approvedArv.amount)}') && ct.includes('{DISPOSITION_REPAIRS_LABEL}: {money(pkg.approvedRepairs)}'), true);
check('S6 disposition preview: the old "Approved ARV:/Approved repairs:" labels are gone', /<li[^>]*>Approved ARV: |<li[^>]*>Approved repairs: /.test(ct), false);
const cw = read('src/pages/ContactWorkspace.tsx');
check('S7 Contact ARV row says which ARV governs, editor unchanged',
  cw.includes('if (f.id === ARV_ID) return <MonetaryRow f={f} contactId={contactId} save={ghl.contacts.setARV} note={CONTACT_ARV_SEED_NOTE} />;')
    && cw.includes('{note ? (') && F.CONTACT_ARV_SEED_NOTE === "Seed only — the linked Opportunity's ARV governs once it is set", true);
check('S7 the label is backed by the resolver: Opportunity ARV first, Contact only as a seed',
  /arv: seed\(opportunity\.arv, contact\.arv, "ARV"\)/.test(read('src/lib/underwriting/resolver.ts')) && /if \(opp\.kind === "value"\) return opp;/.test(read('src/lib/underwriting/resolver.ts')), true);
{
  const arvSrc = read('src/components/ArvCompsWorkspace.tsx');
  const count = (s, needle) => s.split(needle).length - 1;
  check('S9 ARV workspace: the read generation is derived from the contact object and the ARV on file',
    arvSrc.includes('readGenRef.current = nextArvReadGeneration(readGenRef.current, contact, currentArv);') && arvSrc.includes('const readGen = readGenRef.current.gen;'), true);
  check('S9 ARV workspace: the ledger is re-read per deal AND read generation, each answer tagged with both, stale answers cancelled',
    arvSrc.includes('}, [recordKey, readGen]);') && arvSrc.includes('const key = recordKey; const gen = readGen;')
      && arvSrc.includes('if (!cancelled) setArvLedger({ key, gen, notes: Array.isArray(body?.notes) ? body.notes : [] });')
      && arvSrc.includes('if (!cancelled) setArvLedger({ key, gen, notes: null });') && arvSrc.includes('return () => { cancelled = true; };') && count(arvSrc, 'ghl.notes.list(') === 1, true);
  check('S9 ARV workspace: the confirmation is set only through arvConfirmationOnSave, from the deal/generation noted when saving started',
    count(arvSrc, 'setSavedThisVisit(') === 1 && arvSrc.includes('setSavedThisVisit(arvConfirmationOnSave({ started: saveStartedFor.current, key: recordKey, gen: readGen, amount: persistState.value, basisArv: currentArv }));')
      && arvSrc.includes('if (persistState.stage === "saving") { saveStartedFor.current = { key: recordKey, gen: readGen }; return; }'), true);
  check('S9 ARV workspace: the line renders arvOnRecordFor (confirmation and ledger, both generation-bound)',
    arvSrc.includes('const arvOnRecord: ArvOnRecord = arvOnRecordFor({') && arvSrc.includes('key: recordKey, gen: readGen, confirmation: savedThisVisit, ledger: arvLedger,') && !/savedThisVisit\.amount/.test(arvSrc), true);
  check('S10 Underwriting: the recorded MAO is recordedSellerMaoFor over the confirmed SUBMITTED snapshot, bound to the pipeline read',
    uw.includes('const recordedForScreen = recordedSellerMaoFor({') && uw.includes('confirmed: approvedThisVisit, selectedId: selected ? selected.id : null, read: opps, fromRead: recordedSellerMAO,')
      && uw.includes('oppsRef.current = opps;'), true);
  check('S10 Underwriting: nothing derives the recorded figure from render state at completion (only onApprove sets it)',
    count(uw, 'setApprovedThisVisit(') === 1 && !/approvedFigure|\[approve\.status\]/.test(uw), true);
}
{
  /* Every file under the protected paths, in this tree, against the base
     manifest (LF-normalised SHA-256): none changed, none added, none removed. */
  const ROOTS = ['src/lib/ghl.ts', 'src/lib/arv-persist.ts', 'src/lib/arv-approval-note.ts', 'src/lib/repair-approval-client.ts',
    'src/lib/repair-estimation', 'src/lib/underwriting', 'src/lib/contract-disposition-handoff-model.ts',
    'src/lib/current-offer-carrier.ts', 'netlify', 'shared'];
  const seen = [];
  const walk = (rel) => {
    const abs = path.join(APP, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs)) { if (e === 'node_modules' || e.startsWith('.')) continue; walk(`${rel}/${e}`); }
    } else seen.push(rel);
  };
  ROOTS.forEach(walk);
  const hashOf = (rel) => { const buf = fs.readFileSync(path.join(APP, rel)); return buf.includes(0) ? 'bin:' + crypto.createHash('sha256').update(buf).digest('hex') : sha(buf.toString('utf8').replace(/\r\n/g, '\n')); };
  /* Board #15 integration r2 (Bones REVISE dea207e, FAILURE 2). The ORIGINAL manifest stays the feature's historical
     evidence, unchanged. The combined tree changes exactly three protected files (accepted B15-25 r4 additions and the
     reviewed parser/validator composition); they are listed, with reasons, in b15-22-combined-integration-dea207e.json.
     Each entry applies ONLY if its `from` is still the original pin. Every other protected file must match the
     original manifest exactly; none may be added or removed. */
  const COMBINED = JSON.parse(fs.readFileSync(path.join(APP, 'scripts', 'fixtures', 'b15-22-combined-integration-dea207e.json'), 'utf8'));
  const expected = { ...PINS.protected };
  const deltaProblems = [];
  for (const [rel, c] of Object.entries(COMBINED.changes || {})) {
    if (!(rel in PINS.protected)) deltaProblems.push(`not in the original manifest: ${rel}`);
    else if (!c || c.from !== PINS.protected[rel] || typeof c.to !== 'string' || c.to === c.from) deltaProblems.push(`not a reviewed change from the original pin: ${rel}`);
    else expected[rel] = c.to;
  }
  check('S8a the combined-integration delta is exactly the three reviewed files, each from its original pin',
    [Object.keys(COMBINED.changes || {}).sort(), deltaProblems],
    [['netlify/functions/lib/production-write-scope.ts', 'netlify/functions/lib/write-note-guard.ts', 'shared/ghl-config.ts'], []]);
  /* Release 15-B (Jeff, Release Track): Release 15-A (Bones G1 ACCEPT; on main as 59be788, PR #159) changes three
     protected files and adds one, none of which the combined integration touches. They are listed, with reasons, in
     b15-22-release-15a-delta-59be788.json. A change applies ONLY from its exact original pin and never to a file the
     combined delta already lists; an addition only for a file absent from the original manifest. */
  const R15A = JSON.parse(fs.readFileSync(path.join(APP, 'scripts', 'fixtures', 'b15-22-release-15a-delta-59be788.json'), 'utf8'));
  const r15aProblems = [];
  for (const [rel, c] of Object.entries(R15A.changes || {})) {
    if (!(rel in PINS.protected)) r15aProblems.push(`not in the original manifest: ${rel}`);
    else if (rel in (COMBINED.changes || {})) r15aProblems.push(`also in the combined delta: ${rel}`);
    else if (!c || c.from !== PINS.protected[rel] || typeof c.to !== 'string' || c.to === c.from) r15aProblems.push(`not a reviewed change from the original pin: ${rel}`);
    else expected[rel] = c.to;
  }
  for (const [rel, a] of Object.entries(R15A.additions || {})) {
    if (rel in PINS.protected) r15aProblems.push(`addition already in the original manifest: ${rel}`);
    else if (!a || typeof a.to !== 'string' || !/^[0-9a-f]{64}$/.test(a.to)) r15aProblems.push(`not a reviewed addition: ${rel}`);
    else expected[rel] = a.to;
  }
  check('S8b the Release 15-A delta is exactly its three reviewed changes and one addition, each from its original pin',
    [Object.keys(R15A.changes || {}).sort(), Object.keys(R15A.additions || {}).sort(), r15aProblems],
    [['netlify/functions/ghl-contact-conversations.ts', 'netlify/functions/ghl-conversations.ts', 'src/lib/ghl.ts'], ['shared/inbound-message.ts'], []]);
  /* Integration 15-C (Jeff, Release Track): F5 R2 (Bones ACCEPT 2026-11-06) changes ONE protected adapter further,
     netlify/functions/ghl-contact-conversations.ts. Listed, with its reason, in b15-22-f5-delta-327cc28.json. The
     entry is CHAINED: it applies only when its `from` is exactly the Release 15-A amendment's `to` (never the original
     pin, and never a file outside that amendment); the original manifest and both earlier amendments are unchanged. */
  const F5 = JSON.parse(fs.readFileSync(path.join(APP, 'scripts', 'fixtures', 'b15-22-f5-delta-327cc28.json'), 'utf8'));
  const f5Problems = [];
  for (const [rel, c] of Object.entries(F5.changes || {})) {
    const prior = (R15A.changes || {})[rel];
    if (!prior) f5Problems.push(`not in the Release 15-A amendment: ${rel}`);
    else if (!c || c.from !== prior.to || expected[rel] !== prior.to || typeof c.to !== 'string' || c.to === c.from) f5Problems.push(`not a reviewed change from the Release 15-A bytes: ${rel}`);
    else expected[rel] = c.to;
  }
  check('S8c the F5 R2 delta is exactly its one reviewed adapter change, chained from the Release 15-A bytes',
    [Object.keys(F5.changes || {}).sort(), Object.keys(F5.additions || {}).length, f5Problems],
    [['netlify/functions/ghl-contact-conversations.ts'], 0, []]);
  const drift = [];
  for (const rel of seen) { if (!(rel in expected)) drift.push(`added ${rel}`); else if (hashOf(rel) !== expected[rel]) drift.push(`changed ${rel}`); }
  for (const rel of Object.keys(expected)) if (!seen.includes(rel)) drift.push(`removed ${rel}`);
  check('S8 write paths, engines, ledger formats, functions and config unchanged vs base, except the reviewed combined-integration, Release 15-A and F5 R2 deltas (SHA-256 manifest of every protected file)',
    Object.keys(PINS.protected).length > 50 ? drift : 'manifest too small', []);
}

// ═══ N -- requests ═══════════════════════════════════════════════════════════
check('N1 rendering every surface above issued no request at all', requests.length, 0);
{
  const arvCalls = [...new Set(read('src/components/ArvCompsWorkspace.tsx').match(/ghl\.[a-zA-Z]+\.[a-zA-Z]+/g) || [])];
  check('N2 the only GHL call the ARV workspace gained is the notes read', arvCalls.filter((c) => !PINS.arvBaseGhlCalls.includes(c)), ['ghl.notes.list']);
}
check('N2 ghl.notes.list is a plain GET (no method, no body)',
  /list: \(contactId: string\) =>\n\s+request<\{ notes\?: \{ id: string; body: string; dateAdded: string \}\[\] \}>\(\n\s+`\/contacts\/\$\{contactId\}\/notes`,\n\s+\),/.test(read('src/lib/ghl.ts')), true);
check('N3 nothing added on any changed page calls create/save/persist/set', (() => {
  /* Per changed source file, the number of write-call sites must not grow
     (a call that only moved -- the Contact ARV editor -- counts the same). */
  const WRITE = /ghl\.[a-zA-Z]+\.(create|set[A-Z]\w*|save\w*|put\w*|update\w*)|persist[A-Z]\w*\(|saveRepairApproval\(|saveUnderwritingFields\(/g;
  /* The B15-22 source files, with their write-call counts at base pinned. */
  const grew = [];
  for (const [rel, before] of Object.entries(PINS.writeCounts)) {
    const now = fs.existsSync(path.join(APP, rel)) ? read(rel) : '';
    if ((now.match(WRITE) || []).length > before) grew.push(rel);
  }
  return Object.keys(PINS.writeCounts).length === 9 && grew.length === 0 ? false : grew;
})(), false);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
