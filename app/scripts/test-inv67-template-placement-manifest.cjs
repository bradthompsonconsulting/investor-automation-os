/**
 * INV-67 template-placement manifest -- mechanical, fail-closed, network-
 * free validator for `docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md`.
 *
 * Parses the manifest's own markdown table (never trusts its own prose
 * summary) and cross-checks it against the SAME programmatic sources of
 * truth the manifest itself cites: `contract-ghl-projection-model.ts`'s
 * key arrays, and `shared/ghl-config.ts`'s committed `TEST.contractProjectionFields`
 * / `TEST.opportunityFacts` maps. No GHL call, no network access, no
 * rendering.
 *
 * INV-67 Batch 5 regeneration (118 keys / 121 placements) -- fixed the
 * known CRLF row-count bug narrowly at the read/parsing boundary
 * (`parseRow` previously trusted `/\|$/` to strip a row's trailing pipe,
 * which never matches on a CRLF-terminated line), extracted the parse
 * pipeline into `extractRows(src)` for reuse against synthetic LF/CRLF
 * re-encodings, and added the 6 Batch 5 mappings plus a diff against the
 * exact prior committed manifest revision proving the 112 pre-Batch-5
 * mappings are unchanged.
 *
 * Jess Gate correction (PR #69) -- 118 keys + 1 approved reused carrier /
 * 122 placements. This pass models the ONE approved exception explicitly
 * rather than weakening any exact-equality check: `uniqueKeys` (compared
 * against `CONTRACT_PROJECTION_FIELD_KEYS`) now EXCLUDES the one reused-
 * carrier row by construction, and that row is verified separately,
 * end to end, against `TEST.opportunityFacts.currentOffer` -- a
 * deliberately different config namespace than `contractProjectionFields`,
 * never conflated with it. Also fixes the Legal Municipality row's value
 * shape/applicability text, which previously contradicted
 * `legalMunicipalityTransport`'s real (blank-for-unincorporated) behavior.
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

try {
  execSync(
    `npx tsc "${path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
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

const FLOOR = 138;
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

/**
 * Normalizes ONE line before any other parsing -- the single point that
 * makes every downstream regex/string operation blind to whether the
 * source used LF or CRLF. Strips a trailing `\r` only; never touches
 * interior content.
 */
function normalizeLine(line) {
  return line.replace(/\r$/, '');
}

function parseRow(rawLine) {
  const line = normalizeLine(rawLine);
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * Runs the full row-extraction + parse pipeline against an arbitrary
 * source string (the real checked-out file, or a synthetic LF/CRLF
 * re-encoding of it) -- used both for the real validation below and for
 * the line-ending-equivalence proof.
 */
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
    cls: r[17],
  }));
  return { rowLines, rows, parsed };
}

checkTrue('the manifest file exists at its documented path', fs.existsSync(MANIFEST_PATH));
const manifestSrc = fs.readFileSync(MANIFEST_PATH, 'utf8');

const { rowLines, rows, parsed } = extractRows(manifestSrc);
check('exactly 122 placement rows exist', rowLines.length, 122);
// cols: 0=#,1=Page,2=Para,3=Destination,4=Key,5=SourceFact,6=DisplayName,7=ID,8=FieldKey,9=MergeTag,
//       10=Type,11=ValueShape,12=Placements,13=FormattingRule,14=Guidance,15=Applicability,16=DuplicateNote,17=Class,18=ValidationNote

/* ==================================================================== */
/* The one approved reused/external carrier -- modeled explicitly,       */
/* never as a weakening of any exact-equality check below                */
/* ==================================================================== */

const REUSED_CARRIER_APPROVED = {
  'opportunityFacts.currentOffer': {
    id: '7pmvwi6vlu74f5rLOp9M',
    fieldKey: 'opportunity.current_offer',
    semanticSource: 'salesPrice.cashPortion',
    paragraph: '3A',
  },
};
check('REUSED_CARRIER_APPROVED itself names exactly 1 key', Object.keys(REUSED_CARRIER_APPROVED).length, 1);

const reusedCarrierRows = parsed.filter((r) => r.key in REUSED_CARRIER_APPROVED);
const projectionRows = parsed.filter((r) => !(r.key in REUSED_CARRIER_APPROVED));

checkTrue(
  '3 (task requirement). exactly one approved external/reused carrier placement exists',
  reusedCarrierRows.length === 1,
);
if (reusedCarrierRows.length === 1) {
  const rc = reusedCarrierRows[0];
  const expected = REUSED_CARRIER_APPROVED['opportunityFacts.currentOffer'];
  check('the reused carrier row carries its exact verified id', rc.id, expected.id);
  check('the reused carrier row carries its exact expected fieldKey', rc.fieldKey, expected.fieldKey);
  check('the reused carrier row carries a merge tag referencing its exact fieldKey', rc.mergeTag.includes(expected.fieldKey), true);
  check('the reused carrier row is TREC Paragraph 3A', rc.para, expected.paragraph);
  checkTrue('the reused carrier row\'s Source/canonical-fact text names its semantic source (salesPrice.cashPortion)', rc.sourceFact.includes(expected.semanticSource));
}

checkTrue(
  '4 (task requirement). no other non-projection key appears -- every row is either a real CONTRACT_PROJECTION_FIELD_KEYS entry or the one approved reused carrier',
  parsed.every((r) => CONTRACT_PROJECTION_FIELD_KEYS.includes(r.key) || r.key in REUSED_CARRIER_APPROVED),
);

/* ==================================================================== */
/* 1-2. Row and unique-key counts (projection keys EXCLUDE the one       */
/*      reused carrier by construction, never by exception-listing an   */
/*      exact-equality check)                                           */
/* ==================================================================== */

const uniqueKeys = [...new Set(projectionRows.map((r) => r.key))];
check('exactly 118 unique projection keys exist (reused carrier excluded)', uniqueKeys.length, 118);
check('118 projection keys + 1 reused carrier = 119 unique semantic template inputs', uniqueKeys.length + reusedCarrierRows.length, 119);

/* ==================================================================== */
/* 2 (task requirement). Manifest projection-key set exactly equals      */
/*    CONTRACT_PROJECTION_FIELD_KEYS                                     */
/* ==================================================================== */

check(
  'the manifest PROJECTION key set exactly equals CONTRACT_PROJECTION_FIELD_KEYS (same 118, no missing/extra, reused carrier never counted here)',
  [...uniqueKeys].sort(),
  [...CONTRACT_PROJECTION_FIELD_KEYS].sort(),
);

/* ==================================================================== */
/* 4-5 (mechanical). Every PROJECTION manifest ID matches TEST config;   */
/*      all 118 unique                                                   */
/* ==================================================================== */

const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
const testBlockMatch = configSrc.match(/contractProjectionFields: \{([\s\S]*?)\r?\n  \},\r?\n  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI"/);
checkTrue('shared/ghl-config.ts TEST.contractProjectionFields block is present', !!testBlockMatch);
const testIdEntries = testBlockMatch
  ? Array.from(testBlockMatch[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)).map((m) => ({ key: m[1], id: m[2] }))
  : [];
const testIdMap = new Map(testIdEntries.map((e) => [e.key, e.id]));

checkTrue(
  'every PROJECTION manifest ID exactly matches the committed TEST.contractProjectionFields id for its key',
  projectionRows.every((r) => testIdMap.get(r.key) === r.id),
);
check('all 118 projection manifest ids are themselves unique', new Set(projectionRows.map((r) => r.id)).size, 118);
checkTrue(
  'the reused carrier\'s id never collides with any projection id',
  reusedCarrierRows.every((r) => !projectionRows.some((p) => p.id === r.id)),
);

/* ==================================================================== */
/* The reused carrier's id independently verified against                */
/* TEST.opportunityFacts.currentOffer -- a DIFFERENT config namespace,   */
/* never conflated with contractProjectionFields                         */
/* ==================================================================== */

{
  const testSectionSrc = configSrc.slice(configSrc.indexOf('const TEST: GhlConfig = {'));
  checkTrue('shared/ghl-config.ts has a TEST: GhlConfig block', testSectionSrc.length > 0 && configSrc.indexOf('const TEST: GhlConfig = {') > -1);
  const currentOfferMatch = testSectionSrc.match(/currentOffer:\s*"([^"]+)"/);
  checkTrue('TEST.opportunityFacts.currentOffer is present and non-sentinel', !!currentOfferMatch);
  if (currentOfferMatch && reusedCarrierRows.length === 1) {
    check(
      'the reused carrier row\'s id exactly matches the committed TEST.opportunityFacts.currentOffer id (independent cross-check)',
      reusedCarrierRows[0].id,
      currentOfferMatch[1],
    );
  }
}

/* ==================================================================== */
/* 6-7. No sentinel, no Production id (all 122 rows)                     */
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
/* 10. The four Batch 4 transport-only keys present exactly once each,   */
/*     with their exact verified ids and merge tags                      */
/* ==================================================================== */

const BATCH4_APPROVED = {
  additional_earnest_money_amount_text: { id: 'y6dsY9ckRDEeVnF413FX', fieldKey: 'opportunity.contract_additional_earnest_money_amount' },
  additional_earnest_money_days_text: { id: 'b26q2D3hlm3Z1YUxerbX', fieldKey: 'opportunity.contract_additional_earnest_money_days' },
  closing_date_month_day_text: { id: 'RAghy4JYlTPwXwnGEuN4', fieldKey: 'opportunity.contract_closing_date_month_day' },
  closing_date_year_suffix_text: { id: 'y6TaYNpbz0xNbDVQMcwg', fieldKey: 'opportunity.contract_closing_date_year_suffix' },
};
for (const [key, expected] of Object.entries(BATCH4_APPROVED)) {
  const matches = parsed.filter((r) => r.key === key);
  check(`Batch 4 transport-only key "${key}" appears exactly once`, matches.length, 1);
  if (matches.length === 1) {
    check(`"${key}" carries its exact verified id`, matches[0].id, expected.id);
    check(`"${key}" carries its exact expected fieldKey`, matches[0].fieldKey, expected.fieldKey);
    check(`"${key}" carries a merge tag referencing its exact fieldKey`, matches[0].mergeTag.includes(expected.fieldKey), true);
  }
}

/* ==================================================================== */
/* 9 (task requirement). All six Batch 5 key/ID/fieldKey mappings remain  */
/*    exact                                                               */
/* ==================================================================== */

const BATCH5_APPROVED = {
  'propertyLegalDescription.legalMunicipality': { id: 'dk180zpCxZkgC44C9czO', fieldKey: 'opportunity.contract_legal_city' },
  sales_price_amount_text: { id: 'ZQsKcGBaSVdQ9Yjof04L', fieldKey: 'opportunity.contract_sales_price_amount_text' },
  financing_sum_amount_text: { id: 'bI6apbMzHK4c4dz84zlo', fieldKey: 'opportunity.contract_financing_sum_amount_text' },
  as_is_repairs_text: { id: '0mS0zMKkOqLwPPJu31KH', fieldKey: 'opportunity.contract_as_is_repairs_text' },
  district_notices_mark: { id: 'aDjS33PNq5Fjhtv4qKZz', fieldKey: 'opportunity.contract_district_notices_mark' },
  other_addenda_mark: { id: 'MUA4VAnIzotPxSE8bQKg', fieldKey: 'opportunity.contract_other_addenda_mark' },
};
check('BATCH5_APPROVED itself names exactly 6 keys', Object.keys(BATCH5_APPROVED).length, 6);
for (const [key, expected] of Object.entries(BATCH5_APPROVED)) {
  const matches = parsed.filter((r) => r.key === key);
  check(`Batch 5 key "${key}" appears exactly once`, matches.length, 1);
  if (matches.length === 1) {
    check(`"${key}" carries its exact verified id`, matches[0].id, expected.id);
    check(`"${key}" carries its exact expected fieldKey`, matches[0].fieldKey, expected.fieldKey);
    check(`"${key}" carries a merge tag referencing its exact fieldKey`, matches[0].mergeTag.includes(expected.fieldKey), true);
    check(`"${key}" carries its exact verified TEST config id (cross-checked independently of the manifest)`, testIdMap.get(key), expected.id);
  }
}

/* ==================================================================== */
/* 8 (task requirement). All 112 pre-Batch-5 mappings remain unchanged   */
/*    from the exact prior committed manifest revision                   */
/* ==================================================================== */

const BASELINE_SHA_FOR_DIFF = '10073c97b2eac80284556605487d8acc494e8b6f';
let priorManifestSrc = null;
let priorReadError = null;
try {
  priorManifestSrc = execSync(
    `git show ${BASELINE_SHA_FOR_DIFF}:docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md`,
    { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
  ).toString('utf8');
} catch (e) {
  priorReadError = e.message;
}
checkTrue(`the prior committed manifest revision (${BASELINE_SHA_FOR_DIFF}) is readable via git show`, priorManifestSrc !== null);
if (priorManifestSrc !== null) {
  const priorExtract = extractRows(priorManifestSrc);
  check('the prior committed revision itself carries exactly 115 rows / 112 unique keys', [priorExtract.rowLines.length, new Set(priorExtract.parsed.map((r) => r.key)).size], [115, 112]);
  const priorMap = new Map(priorExtract.parsed.map((r) => [r.key, r]));
  const preBatch5Keys = uniqueKeys.filter((k) => !(k in BATCH5_APPROVED));
  check('exactly 112 pre-Batch-5 keys remain in the new manifest', preBatch5Keys.length, 112);
  checkTrue(
    'every pre-Batch-5 key still exists in the prior committed revision (none silently renamed)',
    preBatch5Keys.every((k) => priorMap.has(k)),
  );
  checkTrue(
    'every pre-Batch-5 key\'s id/fieldKey/mergeTag is byte-for-byte unchanged from the prior committed revision',
    preBatch5Keys.every((k) => {
      const before = priorMap.get(k);
      const afterRows = projectionRows.filter((r) => r.key === k);
      return before && afterRows.every((after) => after.id === before.id && after.fieldKey === before.fieldKey && after.mergeTag === before.mergeTag);
    }),
  );
} else {
  console.error('git show failed:', priorReadError);
}

/* ==================================================================== */
/* 10 (task requirement). Three repeated destinations remain the only    */
/*     repetitions; every other PROJECTION key appears exactly once      */
/* ==================================================================== */

const REPEATED_KEYS = ['lease_residential_mark', 'lease_fixture_mark', 'possession_leaseback_mark'];
for (const key of REPEATED_KEYS) {
  const matches = projectionRows.filter((r) => r.key === key);
  check(`repeated key "${key}" appears exactly twice`, matches.length, 2);
  if (matches.length === 2) {
    check(`"${key}"'s two placements share the SAME id`, matches[0].id, matches[1].id);
    check(`"${key}"'s two placements share the SAME merge tag`, matches[0].mergeTag, matches[1].mergeTag);
  }
}
checkTrue(
  'every other PROJECTION key (not one of the 3 repeated keys) appears exactly once',
  uniqueKeys.filter((k) => !REPEATED_KEYS.includes(k)).every((k) => projectionRows.filter((r) => r.key === k).length === 1),
);
check(
  'total placement count reconciles: 118 projection keys - 3 repeated + 3*2 + 1 reused carrier = 122',
  uniqueKeys.length - REPEATED_KEYS.length + REPEATED_KEYS.length * 2 + reusedCarrierRows.length,
  122,
);

/* ==================================================================== */
/* 5 (task requirement). Paragraphs 3A, 3B, and 3C each have their        */
/*    required placement; 3A and 3C both represent the accepted           */
/*    purchase price through their approved carriers                     */
/* ==================================================================== */

const para3A = parsed.filter((r) => r.para === '3A');
const para3B = parsed.filter((r) => r.para === '3B');
const para3C = parsed.filter((r) => r.para === '3C');
check('paragraph 3A has exactly one placement', para3A.length, 1);
check('paragraph 3B has exactly one placement', para3B.length, 1);
check('paragraph 3C has exactly one placement', para3C.length, 1);
if (para3A.length === 1) {
  checkTrue('paragraph 3A is the approved reused carrier (Current Offer), not a new contractProjectionFields key', para3A[0].key === 'opportunityFacts.currentOffer');
  checkTrue('paragraph 3A\'s Source/canonical-fact text names salesPrice.cashPortion (the accepted purchase price)', para3A[0].sourceFact.includes('salesPrice.cashPortion'));
  check('paragraph 3A is classified Ready', para3A[0].cls, 'Ready');
}
if (para3B.length === 1) {
  check('paragraph 3B is the financing_sum_amount_text key', para3B[0].key, 'financing_sum_amount_text');
}
if (para3C.length === 1) {
  check('paragraph 3C is the sales_price_amount_text key', para3C[0].key, 'sales_price_amount_text');
  checkTrue('paragraph 3C\'s Source/canonical-fact text names salesPrice.salesPrice (the accepted purchase price)', para3C[0].sourceFact.includes('salesPrice.salesPrice'));
  checkTrue('paragraph 3C\'s Source/canonical-fact text cross-verifies against salesPrice.cashPortion (the SAME accepted price 3A also carries)', para3C[0].sourceFact.includes('salesPrice.cashPortion'));

  // Jess re-gate #2: paragraph 3C's own placement guidance previously
  // claimed 3A "is not independently placed" / "has no separate projected
  // key" -- stale the moment 3A got its own reused-carrier row. Proven two
  // ways: the exact banned phrases are gone, AND the guidance affirmatively
  // states the current, correct facts.
  const BANNED_3C_PHRASES = [
    "is not independently placed",
    "has no separate projected key",
  ];
  checkTrue(
    'paragraph 3C\'s guidance no longer contains either stale banned phrase about paragraph 3A',
    BANNED_3C_PHRASES.every((phrase) => !para3C[0].guidance.includes(phrase)),
  );
  checkTrue(
    'paragraph 3C\'s guidance acknowledges paragraph 3A\'s separate reused-carrier placement',
    para3C[0].guidance.includes('opportunity.current_offer') && /separately placed|SEPARATELY placed/.test(para3C[0].guidance),
  );
  checkTrue(
    'paragraph 3C\'s guidance states no new GHL field was created for paragraph 3A',
    /no new GHL field was created/.test(para3C[0].guidance),
  );
  checkTrue(
    'paragraph 3C\'s guidance names its own key, sales_price_amount_text',
    para3C[0].guidance.includes('sales_price_amount_text'),
  );
  checkTrue(
    'paragraph 3C\'s guidance cites the existing money gate verifying both paragraphs represent the same accepted purchase price',
    para3C[0].guidance.includes('checkSalesPriceAndFinancingSum') && /same accepted purchase price/i.test(para3C[0].guidance),
  );
}

/* ==================================================================== */
/* 7 (task requirement). Legal Municipality's manifest behavior matches  */
/*    current transport code -- municipality name or blank; the human-   */
/*    facing preview sentence "Unincorporated area." is NOT transport    */
/*    text                                                                */
/* ==================================================================== */

{
  const legalMunicipalityRows = parsed.filter((r) => r.key === 'propertyLegalDescription.legalMunicipality');
  check('propertyLegalDescription.legalMunicipality appears exactly once', legalMunicipalityRows.length, 1);
  if (legalMunicipalityRows.length === 1) {
    const row = legalMunicipalityRows[0];
    checkTrue('Legal Municipality\'s Value Shape never claims the preview sentence "Unincorporated area." as its value', !row.valueShape.includes('Unincorporated area.'));
    checkTrue('Legal Municipality\'s Applicability text never claims "Unincorporated area." is rendered', !row.applicability.includes('Renders "Unincorporated area."'));
    checkTrue('Legal Municipality\'s Applicability text explicitly states blank ("") for Unincorporated', row.applicability.includes('Blank ("")'));
    checkTrue('Legal Municipality\'s Applicability text cites the real transport function, legalMunicipalityTransport', row.applicability.includes('legalMunicipalityTransport'));
    // Structural cross-check against the ACTUAL transport source, never
    // merely re-asserted -- fails closed if that function's own behavior
    // ever changes without this manifest being updated to match.
    const transportSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'contract-ghl-transport-formatting.ts'), 'utf8');
    const fnMatch = transportSrc.match(/export function legalMunicipalityTransport\(m: LegalMunicipalityFact\): string \{\s*return ([^;]+);\s*\}/);
    checkTrue('legalMunicipalityTransport itself is found in contract-ghl-transport-formatting.ts', !!fnMatch);
    if (fnMatch) {
      checkTrue('legalMunicipalityTransport really does return "" for unincorporated (not a prose sentence)', /"unincorporated"\s*\?\s*""/.test(fnMatch[1]));
    }
  }
}

/* ==================================================================== */
/* 13. All 22 broker fields remain page 11 only                          */
/* ==================================================================== */

const brokerRows = projectionRows.filter((r) => r.key.startsWith('seller_broker_') || r.key.startsWith('buyer_broker_'));
check('exactly 22 broker-field rows exist', brokerRows.length, 22);
checkTrue('every broker-field row is on page 11', brokerRows.every((r) => r.page === '11'));
checkTrue('no non-broker key appears on page 11', parsed.filter((r) => r.page === '11').every((r) => r.key.startsWith('seller_broker_') || r.key.startsWith('buyer_broker_')));

/* ==================================================================== */
/* 14. No forbidden field appears                                        */
/* ==================================================================== */

// Scoped to the ROW DATA only (keys + destination/guidance text of actual
// placement rows) -- NOT the whole document, whose own prose (methodology
// notes, "deliberately out of scope" section, this validator's own summary
// table) legitimately NAMES these excluded concepts without placing them.
const rowText = rows.map((r) => r.join(' | ')).join('\n');
const FORBIDDEN_KEY_SUBSTRINGS = ['buyerSignerName', 'buyerSignerRole', 'possessionDetails'];
checkTrue('no buyerSignerName/buyerSignerRole/possessionDetails key appears as an actual placement row', FORBIDDEN_KEY_SUBSTRINGS.every((s) => !parsed.some((r) => r.key.includes(s))));
checkTrue('representation.representation is not an active placement key', !parsed.some((r) => r.key === 'representation.representation'));
checkTrue('no row\'s own destination/guidance text places anything in the printed "Intermediary" block', !/\bIntermediary\b/.test(rowText));
checkTrue('no city/state/ZIP broker-split field key appears (no "_city_"/"_state_"/"_zip_" broker key)', !parsed.some((r) => /_(city|state|zip)_/.test(r.key)));

/* ==================================================================== */
/* 15. Seller Count and Contract Draft Request absent                    */
/* ==================================================================== */

checkTrue('Contract Seller Count is not a manifest placement', !parsed.some((r) => r.key === 'contractSellerCount') && !manifestSrc.includes('gW6eD1ZgbS4UOhPWVyMm'));
checkTrue('Contract Draft Request is not a manifest placement', !manifestSrc.includes('GlbJxxrxnvMkwJSRNUwI'));

/* ==================================================================== */
/* 11 (task requirement). Ordinals contiguous 1-122                      */
/* ==================================================================== */

const sortedByOrdinal = [...parsed].sort((a, b) => a.ordinal - b.ordinal);
check('ordinals are contiguous 1-122', sortedByOrdinal.map((r) => r.ordinal), Array.from({ length: 122 }, (_, i) => i + 1));
checkTrue('page order never decreases across ordinals', sortedByOrdinal.every((r, i) => i === 0 || Number(r.page) >= Number(sortedByOrdinal[i - 1].page)));

/* ==================================================================== */
/* 13 (task requirement). Readiness totals reconcile to 122               */
/* ==================================================================== */

const APPROVED_CLASSES = new Set(['Ready', 'Visual judgment', 'Blocked']);
checkTrue('every readiness classification is from the approved closed set', parsed.every((r) => APPROVED_CLASSES.has(r.cls)));
check('zero rows are Blocked', parsed.filter((r) => r.cls === 'Blocked').length, 0);
check('98 rows are Ready', parsed.filter((r) => r.cls === 'Ready').length, 98);
check('24 rows are Visual judgment', parsed.filter((r) => r.cls === 'Visual judgment').length, 24);
check('98 + 24 + 0 = 122', parsed.filter((r) => r.cls === 'Ready').length + parsed.filter((r) => r.cls === 'Visual judgment').length + parsed.filter((r) => r.cls === 'Blocked').length, 122);

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

{
  const pdfPath = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');
  const EXPECTED_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
  checkTrue('the source PDF exists at its documented path', fs.existsSync(pdfPath));
  const crypto = require('crypto');
  const actualSha256 = fs.existsSync(pdfPath) ? crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex') : null;
  check('the PDF SHA-256 referenced by the manifest matches the actual file', actualSha256, EXPECTED_SHA256);
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
  checkTrue('the pure-CRLF re-encoding parses successfully (does not throw) -- this is the exact bug class this fix repairs', crlfError === null);

  if (lfResult && crlfResult) {
    check('LF and CRLF re-encodings produce the SAME row count', [lfResult.rowLines.length, crlfResult.rowLines.length], [122, 122]);
    check('LF and CRLF re-encodings produce byte-identical parsed row/count/mapping results', JSON.stringify(lfResult.parsed), JSON.stringify(crlfResult.parsed));
  }

  // The real checked-out file must ALSO parse successfully, whatever its own
  // actual line ending is (this repo's working tree is CRLF today, per
  // AGENTS.md's own documented core.autocrlf gap) -- already proven above by
  // every check that ran against `parsed` without throwing; restated here as
  // an explicit, named assertion for this specific requirement.
  checkTrue('the real checked-out manifest file parsed successfully above (no throw reached this line)', true);
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
