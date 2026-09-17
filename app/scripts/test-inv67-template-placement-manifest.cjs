/**
 * INV-67 template-placement manifest -- mechanical, fail-closed validator
 * for `docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md`.
 *
 * Parses the manifest's own markdown table (never trusts its own prose
 * summary) and cross-checks it against the SAME programmatic sources of
 * truth the manifest itself cites: `contract-ghl-projection-model.ts`'s
 * key arrays, `shared/ghl-config.ts`'s committed `TEST.contractProjectionFields`
 * map, `contract-ghl-transport-formatting.ts`'s real transport functions,
 * and (new this pass) an independent, live, PER-PAGE `pdftotext -layout`
 * extraction of the source PDF.
 *
 * Manifest correction/regeneration (this pass, 118 keys / 133 placements):
 *  - TypeScript compilation now uses this repository's OWN pinned local
 *    TypeScript 5.6 toolchain (`app/node_modules/typescript/bin/tsc`,
 *    invoked directly via `node`, never `npx` -- npx can silently resolve
 *    or download a DIFFERENT, unpinned tsc). Fails closed with a clear
 *    prerequisite message ("Nothing tested") if `pnpm install --dir app`
 *    has not been run.
 *  - Removes the "one approved reused non-projection carrier" model
 *    entirely and asserts `opportunity.current_offer` never appears as
 *    any row's fieldKey.
 *  - Adds a live, independent, PER-PAGE PDF verification: for every row,
 *    its (page, paragraph) pair is looked up in a validator-OWNED anchor
 *    map (never the row's own free-text destination prose, which is not
 *    a trustworthy search key for "same clause"-style rows) and the
 *    exact anchor substring is confirmed present in a FRESH
 *    `pdftotext -layout -f N -l N` extraction of that ONE page, run live
 *    at test time -- never the prior whole-document header heuristic.
 *  - Adds page-11 broker-card symmetry, associate/supervisor-license
 *    line-binding, and single-blank-line proofs.
 *  - Adds the repeated property-address-header-exactly-once-per-page
 *    proof, the 3A/3C same-carrier proof, and the Paragraph 21
 *    out-of-scope proof.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md');
const TMP = path.join(APP, '.tmp-inv67-manifest-validator-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

// ---- Correction 7: pinned local TypeScript, never npx ----
const LOCAL_TSC_ENTRY = path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(LOCAL_TSC_ENTRY)) {
  console.error(
    'ABORT: prerequisite missing -- ' + LOCAL_TSC_ENTRY + ' does not exist.\n' +
    'This validator requires the repository\'s OWN pinned TypeScript toolchain\n' +
    '(never an unpinned `npx tsc`, which can silently resolve or download a\n' +
    'different compiler). Run `pnpm install --dir app` first. Nothing tested.',
  );
  cleanup();
  process.exit(11);
}
try {
  execSync(
    `node "${LOCAL_TSC_ENTRY}" "${path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}
const {
  CONTRACT_PROJECTION_FIELD_KEYS,
  CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS,
  CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS,
  CONTRACT_PROJECTION_RETIRED_KEYS,
} = require(path.join(TMP, 'contract-ghl-projection-model.js'));

const FLOOR = 312;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name);
    console.log('      expected: ' + JSON.stringify(expected));
    console.log('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

/* ==================================================================== */
/* Parse the manifest's own markdown table -- CRLF-safe, reusable        */
/* ==================================================================== */

function normalizeLine(line) { return line.replace(/\r$/, ''); }

function parseRow(rawLine) {
  const line = normalizeLine(rawLine);
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function extractRows(src) {
  const rowLines = src.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(normalizeLine(l)));
  const rows = rowLines.map(parseRow);
  rows.forEach((r, i) => {
    if (r.length !== 19) throw new Error(`row ${i} (ordinal ${r[0]}) has ${r.length} cells, expected 19`);
  });
  const strip = (s) => s.replace(/`/g, '');
  const parsed = rows.map((r) => ({
    ordinal: Number(r[0]),
    page: r[1],
    para: r[2],
    destination: r[3],
    key: strip(r[4]),
    sourceFact: r[5],
    id: strip(r[7]),
    fieldKey: strip(r[8]),
    mergeTag: strip(r[9]),
    valueShape: r[11],
    guidance: r[14],
    applicability: r[15],
    duplicateNote: r[16],
    cls: r[17],
  }));
  return { rowLines, rows, parsed };
}

checkTrue('the manifest file exists at its documented path', fs.existsSync(MANIFEST_PATH));
const manifestSrc = fs.readFileSync(MANIFEST_PATH, 'utf8');

const { rowLines, rows, parsed } = extractRows(manifestSrc);
check('exactly 133 placement rows exist', rowLines.length, 133);

/* ==================================================================== */
/* Correction 3: opportunity.current_offer never appears as a fieldKey; */
/* paragraph 3A and 3C use the SAME formatted carrier                    */
/* ==================================================================== */

checkTrue(
  'opportunity.current_offer never appears as any row\'s fieldKey (the reused non-projection carrier model is fully removed)',
  parsed.every((r) => r.fieldKey !== 'opportunity.current_offer' && r.key !== 'opportunityFacts.currentOffer'),
);
{
  const para3A = parsed.filter((r) => r.para === '3A');
  const para3B = parsed.filter((r) => r.para === '3B');
  const para3C = parsed.filter((r) => r.para === '3C');
  check('paragraph 3A has exactly one placement', para3A.length, 1);
  check('paragraph 3B has exactly one placement', para3B.length, 1);
  check('paragraph 3C has exactly one placement', para3C.length, 1);
  if (para3A.length === 1 && para3C.length === 1) {
    check('paragraph 3A uses sales_price_amount_text', para3A[0].key, 'sales_price_amount_text');
    check('paragraph 3C uses sales_price_amount_text', para3C[0].key, 'sales_price_amount_text');
    check('3A and 3C carry the EXACT same id', para3A[0].id, para3C[0].id);
    check('3A and 3C carry the EXACT same fieldKey', para3A[0].fieldKey, para3C[0].fieldKey);
    check('3A and 3C carry the EXACT same merge tag', para3A[0].mergeTag, para3C[0].mergeTag);
  }
  if (para3B.length === 1) check('paragraph 3B uses financing_sum_amount_text', para3B[0].key, 'financing_sum_amount_text');
}

/* ==================================================================== */
/* 1-2. Row and unique-key counts                                        */
/* ==================================================================== */

const uniqueKeys = [...new Set(parsed.map((r) => r.key))];
check('exactly 118 unique active keys exist', uniqueKeys.length, 118);
check(
  'the manifest key set exactly equals CONTRACT_PROJECTION_FIELD_KEYS (same 118, no missing/extra)',
  [...uniqueKeys].sort(),
  [...CONTRACT_PROJECTION_FIELD_KEYS].sort(),
);

/* ==================================================================== */
/* 4-5. Every manifest ID matches TEST config; all 118 unique             */
/* ==================================================================== */

const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
const testBlockMatch = configSrc.match(/contractProjectionFields: \{([\s\S]*?)\r?\n  \},\r?\n  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI"/);
checkTrue('shared/ghl-config.ts TEST.contractProjectionFields block is present', !!testBlockMatch);
const testIdEntries = testBlockMatch
  ? Array.from(testBlockMatch[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)).map((m) => ({ key: m[1], id: m[2] }))
  : [];
const testIdMap = new Map(testIdEntries.map((e) => [e.key, e.id]));

checkTrue(
  'every manifest ID exactly matches the committed TEST.contractProjectionFields id for its key',
  parsed.every((r) => testIdMap.get(r.key) === r.id),
);
check('all 118 keys\' ids are themselves unique (no id reused across two DIFFERENT keys)', new Set(uniqueKeys.map((k) => testIdMap.get(k))).size, 118);

/* ==================================================================== */
/* 6-7. No sentinel, no Production id                                    */
/* ==================================================================== */

const SENTINEL = 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED';
checkTrue('no sentinel id appears in the manifest', parsed.every((r) => r.id !== SENTINEL));
checkTrue('no Production/source-template id (6aa417de09c51fa0927e77cd) appears in the manifest', parsed.every((r) => r.id !== '6aa417de09c51fa0927e77cd'));

/* ==================================================================== */
/* 8-9. No retired key; the two specific retired compound keys absent    */
/* ==================================================================== */

checkTrue('no retired key appears in the manifest', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !parsed.some((r) => r.key === k)));
checkTrue(
  'the two retired compound keys are specifically absent',
  !parsed.some((r) => r.key === 'earnestMoneyOption.additionalEarnestMoney') && !parsed.some((r) => r.key === 'closingPossession.closingDate'),
);

/* ==================================================================== */
/* 10 (task requirement). Three repeated destinations remain the only    */
/*     repetitions -- FIVE, now that Correction 3 and Correction 4 each   */
/*     add one more approved repeated key                                */
/* ==================================================================== */

const REPEATED_KEYS = {
  lease_residential_mark: 2,
  lease_fixture_mark: 2,
  possession_leaseback_mark: 2,
  sales_price_amount_text: 2,
  'identity.propertyStreetAddress': 12,
};
check('exactly 5 approved repeated-destination keys are named', Object.keys(REPEATED_KEYS).length, 5);
for (const [key, expectedCount] of Object.entries(REPEATED_KEYS)) {
  const matches = parsed.filter((r) => r.key === key);
  check(`repeated key "${key}" appears exactly ${expectedCount} times`, matches.length, expectedCount);
  if (matches.length > 1) {
    checkTrue(`"${key}"'s every placement shares the SAME id`, matches.every((m) => m.id === matches[0].id));
    checkTrue(`"${key}"'s every placement shares the SAME merge tag`, matches.every((m) => m.mergeTag === matches[0].mergeTag));
  }
}
checkTrue(
  'every other active key (not one of the 5 repeated keys) appears exactly once',
  uniqueKeys.filter((k) => !(k in REPEATED_KEYS)).every((k) => parsed.filter((r) => r.key === k).length === 1),
);
{
  const repeatedTotal = Object.values(REPEATED_KEYS).reduce((a, b) => a + b, 0);
  const singleTotal = (uniqueKeys.length - Object.keys(REPEATED_KEYS).length) * 1;
  check('total placement count reconciles: 113 keys x1 + 4 keys x2 + 1 key x12 = 133', singleTotal + repeatedTotal, 133);
}

/* ==================================================================== */
/* 13. All 22 broker fields remain page 11 only (23 with the new header) */
/* ==================================================================== */

const brokerRows = parsed.filter((r) => r.key.startsWith('seller_broker_') || r.key.startsWith('buyer_broker_'));
check('exactly 22 broker-field rows exist', brokerRows.length, 22);
checkTrue('every broker-field row is on page 11', brokerRows.every((r) => r.page === '11'));
checkTrue(
  'no non-broker, non-header key appears on page 11',
  parsed.filter((r) => r.page === '11').every((r) => r.key.startsWith('seller_broker_') || r.key.startsWith('buyer_broker_') || r.key === 'identity.propertyStreetAddress'),
);

/* ==================================================================== */
/* Page-11 broker-card symmetry, single-blank-line, and license-line-    */
/* binding proofs (Correction 2)                                         */
/* ==================================================================== */

const BROKER_ROLES = [
  'firm_name_text', 'address_text', 'firm_license_no_text', 'associate_name_text',
  'team_name_text', 'associate_email_text', 'associate_phone_text',
  'associate_license_no_text', 'supervisor_name_text', 'supervisor_phone_text',
  'supervisor_license_no_text',
];
for (const prefix of ['seller_broker_', 'buyer_broker_']) {
  const cardRows = brokerRows.filter((r) => r.key.startsWith(prefix));
  check(`${prefix} card has exactly 11 rows (one per canonical role)`, cardRows.length, 11);
  checkTrue(
    `${prefix} card has EXACTLY the 11 canonical roles, each exactly once (page-11 symmetry proof)`,
    BROKER_ROLES.every((role) => cardRows.filter((r) => r.key === `${prefix}${role}`).length === 1),
  );

  const byRole = (role) => cardRows.find((r) => r.key === `${prefix}${role}`);
  const firmName = byRole('firm_name_text');
  const address = byRole('address_text');
  const associateName = byRole('associate_name_text');
  const teamName = byRole('team_name_text');
  const associatePhone = byRole('associate_phone_text');
  const associateLicense = byRole('associate_license_no_text');
  const supervisorPhone = byRole('supervisor_phone_text');
  const supervisorLicense = byRole('supervisor_license_no_text');

  checkTrue(`${prefix}firm_name_text\'s guidance places it on its OWN line, before the address`, /OWN.{0,20}line/i.test(firmName.guidance) && new RegExp(`ordinal ${address.ordinal}\\b`).test(firmName.guidance));
  checkTrue(`${prefix}address_text\'s guidance places it on the line FOLLOWING firm-name`, /FOLLOWING/i.test(address.guidance) && new RegExp(`ordinal ${firmName.ordinal}\\b`).test(address.guidance));
  checkTrue(`${prefix}associate_name_text is asserted as a SINGLE-BLANK line`, /SINGLE-BLANK/i.test(associateName.destination) || /SINGLE-BLANK/i.test(associateName.guidance));
  checkTrue(`${prefix}team_name_text is asserted as a SINGLE-BLANK line with no license blank`, /SINGLE-BLANK/i.test(teamName.destination) || /SINGLE-BLANK/i.test(teamName.guidance));
  checkTrue(
    `${prefix}associate_license_no_text binds to the associate_phone_text line (ordinal ${associatePhone.ordinal}), NOT the associate_name line`,
    new RegExp(`ordinal ${associatePhone.ordinal}\\b`).test(associateLicense.guidance) && !new RegExp(`ordinal ${associateName.ordinal}\\b`).test(associateLicense.guidance),
  );
  checkTrue(
    `${prefix}associate_phone_text\'s own guidance reciprocally names associate_license_no_text (ordinal ${associateLicense.ordinal})`,
    new RegExp(`ordinal ${associateLicense.ordinal}\\b`).test(associatePhone.guidance),
  );
  checkTrue(
    `${prefix}supervisor_license_no_text binds to the SAME supervisor_phone_text line (ordinal ${supervisorPhone.ordinal}), not a continuation line`,
    new RegExp(`ordinal ${supervisorPhone.ordinal}\\b`).test(supervisorLicense.guidance) && /not a continuation line/i.test(supervisorLicense.guidance),
  );
  checkTrue(
    `${prefix}supervisor_phone_text\'s own guidance reciprocally names supervisor_license_no_text (ordinal ${supervisorLicense.ordinal})`,
    new RegExp(`ordinal ${supervisorLicense.ordinal}\\b`).test(supervisorPhone.guidance),
  );
}

/* ==================================================================== */
/* 14. No forbidden field appears                                        */
/* ==================================================================== */

const rowText = rows.map((r) => r.join(' | ')).join('\n');
const FORBIDDEN_KEY_SUBSTRINGS = ['buyerSignerName', 'buyerSignerRole', 'possessionDetails'];
checkTrue('no buyerSignerName/buyerSignerRole/possessionDetails key appears as an actual placement row', FORBIDDEN_KEY_SUBSTRINGS.every((s) => !parsed.some((r) => r.key.includes(s))));
checkTrue('representation.representation is not an active placement key', !parsed.some((r) => r.key === 'representation.representation'));
checkTrue('no row\'s own destination/guidance text places anything in the printed "Intermediary" block', !/\bIntermediary\b/.test(rowText));
checkTrue('no city/state/ZIP broker-split field key appears (no "_city_"/"_state_"/"_zip_" broker key)', !parsed.some((r) => /_(city|state|zip)_/.test(r.key)));

/* ==================================================================== */
/* Paragraph 21 agent-notice disposition -- audited, correctly OMITTED   */
/* (Correction 5)                                                        */
/* ==================================================================== */

checkTrue(
  'no agent-notice (Buyer\'s-agent / Seller\'s-agent) address/phone/email key exists anywhere in the codebase\'s active projection set (nothing was invented to fill the omission)',
  // Anchored to (buyer|seller)Agent specifically -- a bare /[Aa]gent(Address|Phone|Email)/
  // would false-positive on the UNRELATED earnestMoneyOption.escrowAgentAddress key,
  // which is a real, already-placed field with no connection to paragraph 21.
  !CONTRACT_PROJECTION_FIELD_KEYS.some((k) => /(buyer|seller)Agent(Address|Phone|Email)/i.test(k)),
);
checkTrue(
  'the manifest\'s own "Deliberately out of scope" section documents the Paragraph 21 agent-notice omission by name',
  manifestSrc.includes('Paragraph 21 agent-notice destinations') && manifestSrc.includes('no authoritative active carrier exists'),
);
{
  const para21Rows = parsed.filter((r) => r.para === '21');
  check('paragraph 21 carries exactly the 6 already-placed Buyer/Seller notice-contact keys -- no agent-notice row added', para21Rows.length, 6);
  checkTrue(
    'every paragraph-21 row is one of the 6 Buyer/Seller notice-contact keys',
    para21Rows.every((r) => r.key.startsWith('noticeContact.')),
  );
}

/* ==================================================================== */
/* 15. Seller Count and Contract Draft Request absent                    */
/* ==================================================================== */

checkTrue('Contract Seller Count is not a manifest placement', !parsed.some((r) => r.key === 'contractSellerCount') && !manifestSrc.includes('gW6eD1ZgbS4UOhPWVyMm'));
checkTrue('Contract Draft Request is not a manifest placement', !manifestSrc.includes('GlbJxxrxnvMkwJSRNUwI'));

/* ==================================================================== */
/* 11 (task requirement). Ordinals contiguous 1-133; page order never    */
/*     decreases                                                         */
/* ==================================================================== */

const sortedByOrdinal = [...parsed].sort((a, b) => a.ordinal - b.ordinal);
check('ordinals are contiguous 1-133', sortedByOrdinal.map((r) => r.ordinal), Array.from({ length: 133 }, (_, i) => i + 1));
checkTrue('page order never decreases across ordinals', sortedByOrdinal.every((r, i) => i === 0 || Number(r.page) >= Number(sortedByOrdinal[i - 1].page)));

/* ==================================================================== */
/* Correction 1 (task requirement). Known corrected ordinal ranges       */
/* assert their exact pages                                              */
/* ==================================================================== */

const EXPECTED_PAGE_FOR_PARA = {
  '7B(1)': '4', '7B(2)': '4', '7B(3)': '4',
  '7D(1)': '5', '7D(2)': '5', '7H': '5', '7I(1)': '5', '7I(2)': '5', '7I(3)': '5', '7I(3)(e)': '5',
  '9A': '6', '10A': '6', '11': '6', '12A(1)(b)': '6',
  '12B(1)': '7', '12B(2)': '7',
};
for (const [para, page] of Object.entries(EXPECTED_PAGE_FOR_PARA)) {
  const matches = parsed.filter((r) => r.para === para);
  checkTrue(`every row with paragraph "${para}" is on the corrected page ${page}`, matches.length > 0 && matches.every((r) => r.page === page));
}
checkTrue(
  // The substantive proof is that page 4 REALLY carries 5 placements (the
  // EXPECTED_PAGE_FOR_PARA checks above already prove this exhaustively);
  // the phrase itself may still appear, in quotes, as part of this
  // correction's own retraction record -- banning the substring outright
  // would fail on that legitimate historical quotation.
  'page 4 carries real placements (the false "zero projected fields" claim is substantively disproven, not merely absent as a string)',
  parsed.filter((r) => r.page === '4').length === 5,
);

/* ==================================================================== */
/* Correction 4 (task requirement). The repeated property-address header */
/* exists exactly once on each of pages 2-12                             */
/* ==================================================================== */

{
  const headerRows = parsed.filter((r) => r.key === 'identity.propertyStreetAddress');
  check('identity.propertyStreetAddress has exactly 12 placements total (page 1 original + 11 new headers)', headerRows.length, 12);
  for (let p = 2; p <= 12; p++) {
    const onThisPage = headerRows.filter((r) => r.page === String(p));
    check(`identity.propertyStreetAddress\'s repeated header appears EXACTLY ONCE on page ${p}`, onThisPage.length, 1);
  }
  checkTrue('page 1 still carries its ORIGINAL (non-header) identity.propertyStreetAddress placement, paragraph 2A', headerRows.some((r) => r.page === '1' && r.para === '2A'));
  checkTrue('none of the 11 new header rows appears on page 1 (page 1\'s own header blank remains deliberately unplaced)', headerRows.filter((r) => r.page === '1').length === 1);
}

/* ==================================================================== */
/* 18/13 (task requirement). Readiness classification and totals         */
/* ==================================================================== */

const APPROVED_CLASSES = new Set(['Ready', 'Visual judgment', 'Blocked']);
checkTrue('every readiness classification is from the approved closed set', parsed.every((r) => APPROVED_CLASSES.has(r.cls)));
check('zero rows are Blocked', parsed.filter((r) => r.cls === 'Blocked').length, 0);
check('98 rows are Ready', parsed.filter((r) => r.cls === 'Ready').length, 98);
check('35 rows are Visual judgment', parsed.filter((r) => r.cls === 'Visual judgment').length, 35);
check('98 + 35 + 0 = 133', parsed.filter((r) => r.cls === 'Ready').length + parsed.filter((r) => r.cls === 'Visual judgment').length + parsed.filter((r) => r.cls === 'Blocked').length, 133);
checkTrue('every one of the 11 new property-address header rows is classified Visual judgment', parsed.filter((r) => r.key === 'identity.propertyStreetAddress' && r.page !== '1').every((r) => r.cls === 'Visual judgment'));

/* ==================================================================== */
/* 19. No row left without a printed destination, value shape,           */
/*     formatting rule, or validation-relevant note                      */
/* ==================================================================== */

checkTrue('every row has a non-empty printed destination (col 4)', rows.every((r) => r[3].trim() !== ''));
checkTrue('every row has a non-empty value shape (col 12)', rows.every((r) => r[11].trim() !== ''));
checkTrue('every row has a non-empty formatting rule (col 14)', rows.every((r) => r[13].trim() !== ''));
checkTrue('every Visual-judgment row has a non-empty validation note (col 19)', rows.every((r) => r[17] !== 'Visual judgment' || r[18].trim() !== ''));

/* ==================================================================== */
/* Manifest hash sanity -- the source PDF referenced is unchanged        */
/* ==================================================================== */

const PDF_PATH = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');
const EXPECTED_PDF_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
{
  checkTrue('the source PDF exists at its documented path', fs.existsSync(PDF_PATH));
  const crypto = require('crypto');
  const actualSha256 = fs.existsSync(PDF_PATH) ? crypto.createHash('sha256').update(fs.readFileSync(PDF_PATH)).digest('hex') : null;
  check('the PDF SHA-256 referenced by the manifest matches the actual file', actualSha256, EXPECTED_PDF_SHA256);
}

/* ==================================================================== */
/* Preflight requirement #5/#6 (task requirement). Every row's page is   */
/* verified against an INDEPENDENT, live, PER-PAGE pdftotext extraction  */
/* -- never the prior whole-document header heuristic, and never the     */
/* row's own free-text destination prose treated as a searchable anchor. */
/* ==================================================================== */

// Validator-OWNED (page, paragraph) -> anchor-substring map. Deliberately
// NOT derived from any row's own "destination" column text -- a row whose
// destination says "same clause" or "same line" would otherwise be an
// unverifiable, self-referential anchor. Every entry here was itself
// confirmed present on its named page via a live extraction before being
// written (see the correction record above); this block re-proves it
// fresh, at test time, rather than trusting that one-time confirmation.
const PAGE_PARAGRAPH_ANCHORS = {
  '1||1': '1. PARTIES:',
  '1||2A': 'A. LAND: Lot',
  '1||2D': 'D. EXCLUSIONS:',
  '1||3A': 'A. Cash portion of Sales Price',
  '1||3B': 'B. Sum of all financing',
  '1||3C': 'C. Sales Price (Sum of A and B)',
  '1||4A': 'A. RESIDENTIAL LEASES:',
  '1||4B': 'B. FIXTURE LEASES:',
  '1||4C': 'C. NATURAL RESOURCE LEASES:',
  '1||4C(1)': 'Seller has delivered to Buyer a copy of all the Natural Resource Leases',
  '1||4C(2)': 'Seller has not delivered to Buyer a copy of all the Natural Resource Leases',
  '2||Header': 'Page 2 of 12',
  '2||5A': 'A. DELIVERY OF EARNEST MONEY AND OPTION FEE',
  '2||5(1)': 'Buyer shall deliver additional earnest money of',
  '2||5B': 'B. TERMINATION OPTION',
  '2||6A': "A. TITLE POLICY: Seller shall furnish",
  '2||6A(8)': 'shortages in area',
  '3||Header': 'Page 3 of 12',
  '3||6C(1)': 'existing survey of the Property and a Residential Real Property',
  '3||6C(2)': 'Buyer may obtain a new survey',
  '3||6C(3)': 'furnish a new survey to Buyer.',
  '3||6D': 'D. OBJECTIONS: Buyer may object',
  '3||6E(2)': 'MEMBERSHIP IN PROPERTY OWNERS ASSOCIATION(S)',
  '4||Header': 'Page 4 of 12',
  '4||7B(1)': "Buyer has received the Seller's Disclosure Notice.",
  '4||7B(2)': "Buyer has not received the Seller's Disclosure Notice",
  '4||7B(3)': "The Seller is not required to furnish the Seller's Disclosure Notice",
  '5||Header': 'Page 5 of 12',
  '5||7D(1)': 'Buyer accepts the Property As Is.',
  '5||7D(2)': 'following specific repairs and treatments:',
  '5||7H': 'H. RESIDENTIAL SERVICE CONTRACTS',
  '5||7I(1)': "Buyer has received the Seller's Water Disclosure.",
  '5||7I(2)': "Buyer has not received the Seller's Water Disclosure",
  '5||7I(3)': "Seller is not required to deliver the Seller's Water Disclosure",
  '5||7I(3)(e)': 'the following municipality (City), municipal utility',
  '6||Header': 'Page 6 of 12',
  '6||9A': '9. CLOSING:',
  '6||10A': '10. POSSESSION:',
  '6||11': '11. SPECIAL PROVISIONS:',
  '6||12A(1)(b)': 'an amount not to exceed $',
  '7||Header': 'Page 7 of 12',
  '7||12B(1)': 'Seller will pay (check one box only)',
  '7||12B(2)': 'Buyer will pay (check one box only)',
  '8||Header': 'Page 8 of 12',
  '8||21': '21. NOTICES:',
  '9||Header': 'Page 9 of 12',
  '9||22': '22. AGREEMENT OF PARTIES:',
  '9||22 "Other:"': 'q Other:',
  '10||Header': 'Page 10 of 12',
  '11||Header': 'Page 11 of 12',
  '11||Broker Contact Information': 'BROKER CONTACT INFORMATION',
  '12||Header': 'Page 12 of 12',
};

checkTrue(
  'every distinct (page, paragraph) pair actually used in the manifest has a validator-owned anchor entry',
  [...new Set(parsed.map((r) => `${r.page}||${r.para}`))].every((k) => k in PAGE_PARAGRAPH_ANCHORS),
);
check('the anchor map itself covers exactly the 52 distinct (page, paragraph) pairs the manifest uses', Object.keys(PAGE_PARAGRAPH_ANCHORS).length, [...new Set(parsed.map((r) => `${r.page}||${r.para}`))].length);

// NOTE: this poppler build exits `pdftotext -v` with code 99 even though it
// prints valid version text to stdout -- a documented quirk of THIS specific
// binary, not a real failure. Relying on that flag's exit code would falsely
// report "unavailable." The real availability probe is the ACTUAL extraction
// command this validator needs (single-page, to stdout via `-`), which DOES
// exit 0 on success -- confirmed directly against this repo's own PDF before
// writing this check.
const pageTextCache = new Map();
function getPageText(page) {
  if (pageTextCache.has(page)) return pageTextCache.get(page);
  const text = execSync(`pdftotext -layout -f ${page} -l ${page} "${PDF_PATH}" -`, { maxBuffer: 5 * 1024 * 1024 }).toString('utf8');
  pageTextCache.set(page, text);
  return text;
}
let pdftotextAvailable = false;
try {
  getPageText('1');
  pdftotextAvailable = true;
} catch (_) {
  pdftotextAvailable = false;
}
checkTrue(
  'pdftotext (poppler-utils) is available -- REQUIRED prerequisite for this section; if this fails, every check below it is UNVERIFIED, not silently passed',
  pdftotextAvailable,
);

if (pdftotextAvailable) {
  for (const [key, anchor] of Object.entries(PAGE_PARAGRAPH_ANCHORS)) {
    const [page] = key.split('||');
    const text = getPageText(page);
    checkTrue(`independent live per-page extraction of page ${page} contains the anchor for "${key}"`, text.includes(anchor));
  }
  // Every row's (page, para) anchor is independently re-confirmed present
  // on that EXACT page, live, at test time -- not merely that the anchor
  // map entry exists (already proven above) but that every ROW correctly
  // cites it.
  for (const r of parsed) {
    const anchor = PAGE_PARAGRAPH_ANCHORS[`${r.page}||${r.para}`];
    checkTrue(`row ordinal ${r.ordinal} (page ${r.page}, ¶${r.para}) is confirmed present on that exact independently-extracted page`, anchor !== undefined && getPageText(r.page).includes(anchor));
  }
} else {
  console.error(
    'WARNING: pdftotext is not available in this environment -- the per-page anchor\n' +
    'verification above could not run. This is a REQUIRED prerequisite for this\n' +
    'validator\'s page-verification proof; its absence is reported honestly above\n' +
    'as a FAILING check, never silently skipped or treated as a pass.',
  );
}

/* ==================================================================== */
/* 12 (task requirement). Line endings cannot alter results              */
/* ==================================================================== */

{
  const pureLf = manifestSrc.replace(/\r\n/g, '\n');
  checkTrue('a pure-LF re-encoding of the manifest carries no \\r at all', !pureLf.includes('\r'));
  const pureCrlf = pureLf.replace(/\n/g, '\r\n');
  checkTrue('a pure-CRLF re-encoding of the manifest has one \\r per \\n (fully CRLF, no bare LF)', (pureCrlf.match(/\r\n/g) || []).length === (pureCrlf.match(/\n/g) || []).length);

  let lfResult;
  let lfError = null;
  try { lfResult = extractRows(pureLf); } catch (e) { lfError = e.message; }
  checkTrue('the pure-LF re-encoding parses successfully (does not throw)', lfError === null);

  let crlfResult;
  let crlfError = null;
  try { crlfResult = extractRows(pureCrlf); } catch (e) { crlfError = e.message; }
  checkTrue('the pure-CRLF re-encoding parses successfully (does not throw)', crlfError === null);

  if (lfResult && crlfResult) {
    check('LF and CRLF re-encodings produce the SAME row count', [lfResult.rowLines.length, crlfResult.rowLines.length], [133, 133]);
    check('LF and CRLF re-encodings produce byte-identical parsed row/count/mapping results', JSON.stringify(lfResult.parsed), JSON.stringify(crlfResult.parsed));
  }

  checkTrue('the real checked-out manifest file parsed successfully above (no throw reached this line)', true);
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
