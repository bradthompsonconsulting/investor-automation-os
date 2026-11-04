/**
 * Board #15 B15-22 / INV-131 (F41, F42, F44) -- which repair / offer / ARV
 * figure counts, labelled per surface. Offline; no network, no GHL.
 *
 *   U  pure wording: recorded-vs-live Seller MAO, ARV on record, deal-bar notes
 *   R  rendered (react-dom/server) from the REAL components: the Underwriting
 *      rail cell and decision-panel figure, the ARV workspace with and without
 *      a property address, the ARV-on-record line
 *   S  source wiring: each page uses them; Approve, the write paths and the
 *      disposition note format are byte-identical to the base (a55ead5)
 *   N  zero non-GET requests: rendering issues none; the one new read is the
 *      existing GET ghl.notes.list
 *
 * Bundled with esbuild (as test-generate-contract-pdf-adapter.cjs does) so the
 * real component import graph loads in Node; React stays external so one
 * React instance renders.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..');
const BASE = 'a55ead5';
const TMP = path.join(APP, '.tmp-b15-22-authoritative-test');
const esbuild = require(path.join(APP, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'));

/** Literal check() call-site count in this file. */
const FLOOR = 67;
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

// ═══ S -- source wiring and unchanged authority ══════════════════════════════
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const atBase = (rel) => execFileSync('git', ['show', `${BASE}:app/${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r\n/g, '\n');
const fnText = (src, start, end = '\n}\n') => { const i = src.indexOf(start); if (i < 0) return null; const j = src.indexOf(end, i); return j < 0 ? null : src.slice(i, j); };
const uw = read('src/pages/UnderwritingWorkspace.tsx');
check('S1 Underwriting rail renders the recorded cell', uw.includes('<RecordedSellerMaoCell comparison={maoComparison} waiting={waiting} />'), true);
check('S1 Underwriting decision panel renders the live figure', uw.includes('<LiveSellerMaoFigure text={money(screen.figures.sellerMAO)} comparison={maoComparison} />'), true);
check('S1 no plain same-name "Seller MAO" figure label remains on the page', /cell\("Seller MAO"|>Seller MAO</.test(uw), false);
check('S2 recorded MAO is the Opportunity field, read with the rail\'s reader (no new request)',
  uw.includes('readOpportunityNumber(opp.customFields, CONFIG.opportunityFields.sellerMAO)') && !/ghl\.[a-zA-Z.]+\(/.test(uw.slice(uw.indexOf('const recordedSellerMAO'), uw.indexOf('const screen: ScreenState'))), true);
check('S2 the rail is handed the comparison, the live figure the same comparison', uw.includes('maoComparison={maoComparison}') && uw.includes('    recorded: recordedForScreen,') && uw.includes('live: screen.state === "resolved" ? screen.figures.sellerMAO : null'), true);
check('S3 Approve handler byte-identical to base', fnText(uw, '  async function onApprove()', '\n  }\n'), fnText(atBase('src/pages/UnderwritingWorkspace.tsx'), '  async function onApprove()', '\n  }\n'));
check('S3 ApproveControl byte-identical to base', fnText(uw, 'function ApproveControl('), fnText(atBase('src/pages/UnderwritingWorkspace.tsx'), 'function ApproveControl('));
check('S3 RepairEstimator byte-identical to base', fnText(uw, 'function RepairEstimator('), fnText(atBase('src/pages/UnderwritingWorkspace.tsx'), 'function RepairEstimator('));
{
  const arvNow = read('src/components/ArvCompsWorkspace.tsx'); const arvBase = atBase('src/components/ArvCompsWorkspace.tsx');
  const span = (s) => s.slice(s.indexOf('  async function persist('), s.indexOf('  const reconciliation = run?.reconciliation;'));
  check('S3 ARV persist / approve / override / Get Comps byte-identical to base', span(arvNow).length > 500 && span(arvNow) === span(arvBase)
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
const unchanged = execFileSync('git', ['diff', '--name-only', BASE, '--',
  'app/src/lib/ghl.ts', 'app/src/lib/arv-persist.ts', 'app/src/lib/arv-approval-note.ts', 'app/src/lib/repair-approval-client.ts',
  'app/src/lib/repair-estimation', 'app/src/lib/underwriting', 'app/src/lib/contract-disposition-handoff-model.ts',
  'app/src/lib/current-offer-carrier.ts', 'app/netlify', 'app/shared'], { cwd: REPO, encoding: 'utf8' }).trim();
check('S8 write paths, engines, ledger formats, functions and config unchanged vs base', unchanged, '');

// ═══ N -- requests ═══════════════════════════════════════════════════════════
check('N1 rendering every surface above issued no request at all', requests.length, 0);
const arvDiff = execFileSync('git', ['diff', BASE, '--', 'app/src/components/ArvCompsWorkspace.tsx'], { cwd: REPO, encoding: 'utf8' })
  .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
check('N2 the only GHL call the ARV workspace gained is the notes read', [...new Set(arvDiff.match(/ghl\.[a-zA-Z]+\.[a-zA-Z]+/g) || [])], ['ghl.notes.list']);
check('N2 ghl.notes.list is a plain GET (no method, no body)',
  /list: \(contactId: string\) =>\n\s+request<\{ notes\?: \{ id: string; body: string; dateAdded: string \}\[\] \}>\(\n\s+`\/contacts\/\$\{contactId\}\/notes`,\n\s+\),/.test(read('src/lib/ghl.ts')), true);
check('N3 nothing added on any changed page calls create/save/persist/set', (() => {
  /* Per changed source file, the number of write-call sites must not grow
     (a call that only moved -- the Contact ARV editor -- counts the same). */
  const WRITE = /ghl\.[a-zA-Z]+\.(create|set[A-Z]\w*|save\w*|put\w*|update\w*)|persist[A-Z]\w*\(|saveRepairApproval\(|saveUnderwritingFields\(/g;
  const files = execFileSync('git', ['diff', '--name-only', BASE, '--', 'app/src'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const grew = [];
  for (const f of files) {
    const rel = f.replace(/^app\//, '');
    let before = '';
    try { before = atBase(rel); } catch (_) { before = ''; }
    const now = fs.existsSync(path.join(APP, rel)) ? read(rel) : '';
    if ((now.match(WRITE) || []).length > (before.match(WRITE) || []).length) grew.push(rel);
  }
  return grew.length > 0 ? grew : false;
})(), false);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
