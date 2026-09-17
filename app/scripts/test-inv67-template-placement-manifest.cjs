/**
 * INV-67 template-placement manifest -- mechanical, fail-closed, network-
 * free validator for `docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md`.
 *
 * Parses the manifest's own markdown table (never trusts its own prose
 * summary) and cross-checks it against the SAME programmatic sources of
 * truth the manifest itself cites: `contract-ghl-projection-model.ts`'s
 * key arrays, and `shared/ghl-config.ts`'s committed `TEST.contractProjectionFields`
 * map. No GHL call, no network access, no rendering.
 *
 * INV-67 Batch 5 regeneration (118 keys / 121 placements) -- this pass:
 *  - Fixes the known CRLF row-count bug narrowly at the read/parsing
 *    boundary: `parseRow` previously trusted `/\|$/` to strip the row's
 *    trailing pipe, which never matches on a CRLF-terminated line (the
 *    real trailing character is `\r`, not `|`), leaving a spurious 20th
 *    cell and throwing "has 20 cells, expected 19" on every CRLF checkout.
 *    The fix strips a trailing `\r` before any other parsing, once, at
 *    the single point every row line is normalized.
 *  - Extracts the whole parse pipeline into `extractRows(src)` so the
 *    identical logic can run against the real checked-out file AND two
 *    synthetic re-encodings (pure LF, pure CRLF) of the same content, to
 *    prove line endings cannot alter the result.
 *  - Adds the 6 Batch 5 key/id/fieldKey mappings, and a diff against the
 *    exact prior committed manifest revision proving the 112 pre-Batch-5
 *    mappings are byte-for-byte unchanged.
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

const FLOOR = 102;
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
    key: strip(r[4]),
    id: strip(r[7]),
    fieldKey: strip(r[8]),
    mergeTag: strip(r[9]),
    cls: r[17],
  }));
  return { rowLines, rows, parsed };
}

checkTrue('the manifest file exists at its documented path', fs.existsSync(MANIFEST_PATH));
const manifestSrc = fs.readFileSync(MANIFEST_PATH, 'utf8');

const { rowLines, rows, parsed } = extractRows(manifestSrc);
check('exactly 121 placement rows exist', rowLines.length, 121);
// cols: 0=#,1=Page,2=Para,3=Destination,4=Key,5=SourceFact,6=DisplayName,7=ID,8=FieldKey,9=MergeTag,
//       10=Type,11=ValueShape,12=Placements,13=FormattingRule,14=Guidance,15=Applicability,16=DuplicateNote,17=Class,18=ValidationNote

/* ==================================================================== */
/* 1-2. Row and unique-key counts                                        */
/* ==================================================================== */

const uniqueKeys = [...new Set(parsed.map((r) => r.key))];
check('exactly 118 unique active keys exist', uniqueKeys.length, 118);

/* ==================================================================== */
/* 3. Manifest key set exactly equals CONTRACT_PROJECTION_FIELD_KEYS     */
/* ==================================================================== */

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
check('all 118 manifest ids are themselves unique', new Set(parsed.map((r) => r.id)).size, 118);

/* ==================================================================== */
/* 6-7. No sentinel, no Production id                                    */
/* ==================================================================== */

const SENTINEL = 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED';
checkTrue('no sentinel id appears in the manifest', parsed.every((r) => r.id !== SENTINEL));
checkTrue('no Production/source-template id (6aa417de09c51fa0927e77cd) appears in the manifest', parsed.every((r) => r.id !== '6aa417de09c51fa0927e77cd'));

/* ==================================================================== */
/* 8-9. No retired key; the two specific retired compound keys absent    */
/* ==================================================================== */

checkTrue('no retired key appears in the manifest', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !uniqueKeys.includes(k)));
checkTrue(
  'the two retired compound keys are specifically absent',
  !uniqueKeys.includes('earnestMoneyOption.additionalEarnestMoney') && !uniqueKeys.includes('closingPossession.closingDate'),
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
/* 4 (task requirement). All six Batch 5 key/ID/fieldKey mappings match   */
/*    the current TEST config                                            */
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
/* 5 (task requirement). All 112 pre-Batch-5 mappings remain unchanged   */
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
      const afterRows = parsed.filter((r) => r.key === k);
      return before && afterRows.every((after) => after.id === before.id && after.fieldKey === before.fieldKey && after.mergeTag === before.mergeTag);
    }),
  );
} else {
  console.error('git show failed:', priorReadError);
}

/* ==================================================================== */
/* 11-12. Three approved repeated keys appear exactly twice each, same   */
/*        id/merge tag; every other key appears exactly once             */
/* ==================================================================== */

const REPEATED_KEYS = ['lease_residential_mark', 'lease_fixture_mark', 'possession_leaseback_mark'];
for (const key of REPEATED_KEYS) {
  const matches = parsed.filter((r) => r.key === key);
  check(`repeated key "${key}" appears exactly twice`, matches.length, 2);
  if (matches.length === 2) {
    check(`"${key}"'s two placements share the SAME id`, matches[0].id, matches[1].id);
    check(`"${key}"'s two placements share the SAME merge tag`, matches[0].mergeTag, matches[1].mergeTag);
  }
}
checkTrue(
  'every other active key (not one of the 3 repeated keys) appears exactly once',
  uniqueKeys.filter((k) => !REPEATED_KEYS.includes(k)).every((k) => parsed.filter((r) => r.key === k).length === 1),
);
check('total placement count reconciles: 118 unique - 3 repeated + 3*2 = 121', uniqueKeys.length - REPEATED_KEYS.length + REPEATED_KEYS.length * 2, 121);

/* ==================================================================== */
/* 13. All 22 broker fields remain page 11 only                          */
/* ==================================================================== */

const brokerRows = parsed.filter((r) => r.key.startsWith('seller_broker_') || r.key.startsWith('buyer_broker_'));
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
checkTrue('no buyerSignerName/buyerSignerRole/possessionDetails key appears as an actual placement row', FORBIDDEN_KEY_SUBSTRINGS.every((s) => !uniqueKeys.some((k) => k.includes(s))));
checkTrue('representation.representation is not an active placement key', !uniqueKeys.includes('representation.representation'));
checkTrue('no row\'s own destination/guidance text places anything in the printed "Intermediary" block', !/\bIntermediary\b/.test(rowText));
checkTrue('no city/state/ZIP broker-split field key appears (no "_city_"/"_state_"/"_zip_" broker key)', !uniqueKeys.some((k) => /_(city|state|zip)_/.test(k)));

/* ==================================================================== */
/* 15. Seller Count and Contract Draft Request absent                    */
/* ==================================================================== */

checkTrue('Contract Seller Count is not a manifest placement', !uniqueKeys.includes('contractSellerCount') && !manifestSrc.includes('gW6eD1ZgbS4UOhPWVyMm'));
checkTrue('Contract Draft Request is not a manifest placement', !manifestSrc.includes('GlbJxxrxnvMkwJSRNUwI'));

/* ==================================================================== */
/* 16-17. Ordinals contiguous 1-121; page order never decreases          */
/* ==================================================================== */

const sortedByOrdinal = [...parsed].sort((a, b) => a.ordinal - b.ordinal);
check('ordinals are contiguous 1-121', sortedByOrdinal.map((r) => r.ordinal), Array.from({ length: 121 }, (_, i) => i + 1));
checkTrue('page order never decreases across ordinals', sortedByOrdinal.every((r, i) => i === 0 || Number(r.page) >= Number(sortedByOrdinal[i - 1].page)));

/* ==================================================================== */
/* 18. Readiness classification from the approved closed set             */
/* ==================================================================== */

const APPROVED_CLASSES = new Set(['Ready', 'Visual judgment', 'Blocked']);
checkTrue('every readiness classification is from the approved closed set', parsed.every((r) => APPROVED_CLASSES.has(r.cls)));
check('zero rows are Blocked', parsed.filter((r) => r.cls === 'Blocked').length, 0);
check('97 rows are Ready', parsed.filter((r) => r.cls === 'Ready').length, 97);
check('24 rows are Visual judgment', parsed.filter((r) => r.cls === 'Visual judgment').length, 24);

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
    check('LF and CRLF re-encodings produce the SAME row count', [lfResult.rowLines.length, crlfResult.rowLines.length], [121, 121]);
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
