/**
 * B15-19 (INV-128) -- Dashboard / Pipeline / Contacts counts (Pass 1 F6, F7,
 * F8, F26).
 *
 * Offline, synthetic fixtures only. Compiles the pure accounting module and
 * the current-read helper, reproduces each reported discrepancy, shows which
 * are intended differences, then checks the page wiring by source text
 * (this repository's convention; no browser harness here).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-19-count-accounting-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/count-accounting.ts'),
    path.join(APP, 'src/lib/current-read.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs', '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}
const A = require(path.join(TMP, 'src/lib/count-accounting.js'));
const { startCurrentRead } = require(path.join(TMP, 'src/lib/current-read.js'));
fs.rmSync(TMP, { recursive: true, force: true });

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`); }
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');

// Synthetic Seller Leads stages (positions as configured), ids invented.
const STAGES = [
  { id: 'st-new', name: 'New Lead - Seller', position: 0 },
  { id: 'st-sent', name: 'Seller Offer Sent', position: 6 },
  { id: 'st-won', name: 'Seller Closed-Won', position: 8 },
  { id: 'st-lost', name: 'Lost / Not Interested', position: 10 },
];
const TIERS = ['hot', 'warm', 'low'];
const contact = (id, tags = [], phone = '2145550100') => ({ id, tags, phone });
const deal = (contactId, stageId) => ({ contactId, stageId });

// ── 1. Empty data ────────────────────────────────────────────────────────────
{
  check('1 empty: stages all zero, nothing other', [A.stageAccounting(STAGES, []).otherStage, A.stageAccounting(STAGES, []).total, A.stageAccounting(STAGES, []).stages.every((s) => s.count === 0)], [0, 0, true]);
  check('1 empty: coverage', A.dealCoverage([], []), { deals: 0, contactsWithDeal: 0, contactsWithoutDeal: 0, dealsWithoutListedContact: 0 });
  check('1 empty: cold-call accounting', A.coldCallAccounting([], new Set()), { inQueue: 0, noPhone: 0, excluded: 0, total: 0 });
  check('1 empty: untagged', A.untaggedTemperatureCount([], TIERS), 0);
  check('1 empty: texts read naturally', [A.coldCallAccountingText(A.coldCallAccounting([], new Set())), A.dealCoverageText(A.dealCoverage([], []))],
    ['0 of 0 loaded contacts to cold-call; 0 handled elsewhere or left out, 0 with no phone.', '0 loaded deals for 0 loaded contacts; 0 loaded contacts have no Seller Leads deal in the loaded results.']);
}

// ── 2. F26 reproduction: 15 contacts, 6 deals, multiple deals per contact ────
const C15 = Array.from({ length: 15 }, (_, i) => contact(`c${i + 1}`));
const D6 = [deal('c1', 'st-new'), deal('c1', 'st-sent'), deal('c2', 'st-new'), deal('c3', 'st-won'), deal('c4', 'st-lost'), deal('c5', 'st-new')];
{
  const cov = A.dealCoverage(C15, D6);
  check('2 F26: 6 deals belong to 5 contacts (one has two)', [cov.deals, cov.contactsWithDeal], [6, 5]);
  check('2 F26: 10 contacts have no deal (Contacts 15 vs Pipeline 6 is intended)', cov.contactsWithoutDeal, 10);
  check('2 F26: the text says so', A.dealCoverageText(cov), '6 loaded deals for 5 loaded contacts; 10 loaded contacts have no Seller Leads deal in the loaded results.');
  check('2 Pipeline header contacts = distinct deal contacts', A.distinctDealContacts(D6), 5);
  // With six deals for six distinct contacts the Pass 1 numbers (15 / 6 / 9) reproduce exactly.
  const D6distinct = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((c) => deal(c, 'st-new'));
  check('2 F26: 15 contacts, 6 single-deal contacts -> 9 with no deal', A.dealCoverage(C15, D6distinct).contactsWithoutDeal, 9);
}

// ── 3. Closed / lost deals stay in their stage counts ────────────────────────
{
  const s = A.stageAccounting(STAGES, D6);
  const byName = Object.fromEntries(s.stages.map((x) => [x.stage.name, x.count]));
  check('3 closed-won and lost deals are counted in their stages', [byName['Seller Closed-Won'], byName['Lost / Not Interested']], [1, 1]);
  check('3 pills account for every loaded deal when every stage is known', s.stages.reduce((n, x) => n + x.count, 0) + s.otherStage, s.total);
  check('3 stages are in position order', s.stages.map((x) => x.stage.position), [0, 6, 8, 10]);
}

// ── 4. Unknown stage (a "Dashboard 2 deals vs Pipeline 6" mechanism) ─────────
{
  const D = [deal('c1', 'st-new'), deal('c2', 'st-sent'), deal('c3', 'gone-1'), deal('c4', 'gone-2'), deal('c5', ''), deal('c6', 'gone-1')];
  const s = A.stageAccounting(STAGES, D);
  check('4 reproduced defect (a possible F26 explanation, not its verified cause): configured pills alone show 2 of 6 deals', s.stages.reduce((n, x) => n + x.count, 0), 2);
  check('4 after: the other-stage pill carries the 4 missing deals', s.otherStage, 4);
  check('4 after: pills + other = every deal in the loaded set', s.stages.reduce((n, x) => n + x.count, 0) + s.otherStage, D.length);
}

// ── 5. Partial / lagging contacts read ───────────────────────────────────────
{
  const lagging = C15.filter((c) => c.id !== 'c5'); // list read missed c5
  const cov = A.dealCoverage(lagging, D6);
  check('5 a deal whose contact the list read lacks is counted, not dropped', [cov.deals, cov.dealsWithoutListedContact], [6, 1]);
  check('5 ...and said so', A.dealCoverageText(cov).endsWith("1 loaded deal's contact is not among the loaded contacts."), true);
  check('5 a deal with no contact id is counted the same way', A.dealCoverage(C15, [deal('', 'st-new')]).dealsWithoutListedContact, 1);
}

// ── 6. F7 reproduction: "Low 15" vs Lead Queue "1 of 1" ──────────────────────
{
  const people = [
    ...Array.from({ length: 13 }, (_, i) => contact(`u${i}`, [])),      // no temperature tag -> Low
    contact('l1', ['low']), contact('l2', ['low'], ''),                  // tagged low; one without phone
  ];
  check('6 F7: 15 contacts count as Low', people.filter((c) => !c.tags.includes('hot') && !c.tags.includes('warm')).length, 15);
  check('6 F7: 13 of those have no temperature tag', A.untaggedTemperatureCount(people, TIERS), 13);
  const withNoPhone = people.map((c, i) => (i < 2 ? { ...c, phone: '  ' } : c));
  const excluded = new Set(withNoPhone.filter((c, i) => i >= 2 && c.id !== 'l1' && c.phone.trim()).map((c) => c.id));
  const acct = A.coldCallAccounting(withNoPhone, excluded);
  check('6 F7: Lead Queue 1; the other 14 are accounted for', acct, { inQueue: 1, noPhone: 3, excluded: 11, total: 15 });
  check('6 accounting always adds up', acct.inQueue + acct.noPhone + acct.excluded, acct.total);
  check('6 text', A.coldCallAccountingText(acct), '1 of 15 loaded contacts to cold-call; 11 handled elsewhere or left out, 3 with no phone.');
  check('6 no phone wins over exclusion (Lead Queue checks phone first)', A.coldCallAccounting([contact('x', [], '')], new Set(['x'])), { inQueue: 0, noPhone: 1, excluded: 0, total: 1 });
}

// ── 7. Stale responses: only the current read applies ────────────────────────
(async () => {
  const applied = [];
  let resolveOld, resolveNew;
  const cancelOld = startCurrentRead(() => new Promise((r) => { resolveOld = r; }), { data: (v) => applied.push(v), error: () => {}, settled: () => {} });
  cancelOld(); // the effect cleanup runs when read recovery re-runs it
  startCurrentRead(() => new Promise((r) => { resolveNew = r; }), { data: (v) => applied.push(v), error: () => {}, settled: () => {} });
  resolveNew('new'); await new Promise((r) => setTimeout(r, 0));
  resolveOld('old'); await new Promise((r) => setTimeout(r, 0));
  check('7 a superseded read that settles late is ignored', applied, ['new']);

  // ── 8. Wiring ──────────────────────────────────────────────────────────────
  const dash = read('src/pages/Dashboard.tsx');
  check('8 Dashboard reads through startCurrentRead', /return startCurrentRead\(\(\) => Promise\.all\(\[\s*ghl\.contacts\.listAll\(\),/.test(dash), true);
  check('8 Dashboard keeps the read-recovery dependency', /\}, \[readRecovered\]\);/.test(dash), true);
  check('8 Dashboard stage pills come from stageAccounting', dash.includes('stageAccounting(pipeline.stages, pipeline.opportunities)') && dash.includes('const stageCounts = stageAcct?.stages ?? [];'), true);
  check('8 Dashboard shows the other-stage pill only when needed', /stageAcct && stageAcct\.otherStage > 0 && \(/.test(dash) && dash.includes('Other stage {stageAcct.otherStage}'), true);
  check('8 Dashboard labels the stage half of the strip', dash.includes('>Deals by stage<'), true);
  check('8 Dashboard notes untagged Low and deal coverage', dash.includes('Low includes ${untaggedLow.toLocaleString()} with no temperature tag') && dash.includes('{dealCoverageText(coverage)}'), true);
  check('8 Lead Queue accounting uses the queue exclusion set', dash.includes('coldCallAccounting(contacts ?? [], coldOutreachExcludedIds)') && dash.includes('{coldCallAccountingText(coldCall)}'), true);
  check('8 Lead Queue filter itself unchanged', /\.filter\(\(c\) => c\.phone\?\.trim\(\) && !coldOutreachExcludedIds\.has\(c\.id\)\)/.test(dash), true);
  check('8 tier counts unchanged (every contact)', /\(contacts \?\? \[\]\)\.forEach\(\(c\) => counts\[getBucketTag\(c\)\]\+\+\);/.test(dash), true);
  check('8 F8 both offer definitions shown', dash.includes('data-testid="dashboard-offers-awaiting-definition"') && dash.includes('data-testid="dashboard-offers-to-review-definition"'), true);
  check('8 F8 offer counts unchanged', dash.includes('count={offersToReview.length}') && dash.includes('<SectionHeading count={offersAwaiting.length}>Offers Awaiting Response</SectionHeading>'), true);
  check('8 Follow Up precedence and Waiting on Me untouched', dash.includes('!terminalContactIds.has(c.id) && !followUpContactIds.has(c.id) && !doNotCallIds.has(c.id))'), true);
  const pipe = read('src/pages/Pipeline.tsx');
  check('8 Pipeline header says deals and contacts', pipe.includes('{opportunities.length.toLocaleString()} {opportunities.length === 1 ? "deal" : "deals"} · {dealContacts.toLocaleString()}'), true);
  check('8 Pipeline still lists unknown stages as Unknown', pipe.includes('<StageBadge name={stageName.get(o.stageId) ?? "Unknown"} />'), true);
  const cts = read('src/pages/Contacts.tsx');
  check('8 Contacts reads through startCurrentRead', /return startCurrentRead\(\(\) => ghl\.contacts\.gridRows\(\), \{/.test(cts), true);
  check('8 Contacts badge names the unit and the total while searching', cts.includes('`${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} contacts`'), true);
  check('8 Contacts definition line', cts.includes('data-testid="contacts-count-definition"'), true);
  const lib = read('src/lib/count-accounting.ts');
  check('8 accounting module has no I/O', !/fetch\(|\bghl\.|localStorage|import (?!type)/.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')), true);
  /* No write added: the number of write call sites matches origin/main. */
  const WRITES = /appWriteFetch\(|ghl\.notes\.create\(|ghl\.contacts\.set[A-Za-z]*\(|ghl\.opportunities\.(update|set)[A-Za-z]*\(|scheduleCallbackGated\(/g;
  for (const f of ['src/pages/Dashboard.tsx', 'src/pages/Pipeline.tsx', 'src/pages/Contacts.tsx']) {
    const base = execFileSync('git', ['show', `origin/main:app/${f}`], { cwd: APP, encoding: 'utf8' });
    check(`8 no new write call in ${f}`, (read(f).match(WRITES) || []).length, (base.match(WRITES) || []).length);
  }

  console.log(`B15-19 count accounting: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
