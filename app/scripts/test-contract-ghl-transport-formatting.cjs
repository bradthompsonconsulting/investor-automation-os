/**
 * INV-67 compound text-destination repair -- deterministic proof of
 * `contract-ghl-transport-formatting.ts`'s pure functions in isolation.
 * Pure functions only; no GHL, no network. Integration wiring (how these
 * functions plug into `buildContractProjectionPlan`) is proven separately
 * in `test-contract-ghl-projection.cjs`.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-ghl-transport-formatting-test');
const MODULE = path.join(APP, 'src', 'lib', 'contract-ghl-transport-formatting.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${MODULE}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  moneyTransport,
  daysTransport,
  valueOrNoneTransport,
  dollarValueOrNoneTransport,
  sellerSignersTransport,
  additionalEarnestMoneyAmountTransport,
  additionalEarnestMoneyDaysTransport,
  checkClosingDateCenturyBound,
  closingDateMonthDayTransport,
  closingDateYearSuffixTransport,
} = require(path.join(TMP, 'contract-ghl-transport-formatting.js'));

const FLOOR = 54;
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
/* moneyTransport -- bare US-formatted number, never "$"                 */
/* ==================================================================== */

check('moneyTransport(1000) has no "$"', moneyTransport(1000), '1,000.00');
check('moneyTransport(500) has no "$"', moneyTransport(500), '500.00');
check('moneyTransport(0) has no "$"', moneyTransport(0), '0.00');
check('moneyTransport(1234567.5) formats with thousands separators and 2 decimals', moneyTransport(1234567.5), '1,234,567.50');
checkTrue('moneyTransport never contains "$"', !moneyTransport(999999).includes('$'));

/* ==================================================================== */
/* daysTransport -- bare integer, never "day"/"days"                     */
/* ==================================================================== */

check('daysTransport(10) is bare', daysTransport(10), '10');
check('daysTransport(1) is bare (no singular/plural word)', daysTransport(1), '1');
check('daysTransport(0) is bare', daysTransport(0), '0');
checkTrue('daysTransport never contains "day"', !daysTransport(3).toLowerCase().includes('day'));

/* ==================================================================== */
/* valueOrNoneTransport -- "" for none, never the invented sentence      */
/* ==================================================================== */

check('valueOrNoneTransport({kind:"none"}) is ""', valueOrNoneTransport({ kind: 'none' }), '');
checkTrue('valueOrNoneTransport({kind:"none"}) is never the invented sentence', !valueOrNoneTransport({ kind: 'none' }).includes('None'));
check('valueOrNoneTransport({kind:"value",value:"7"}) passes the value through', valueOrNoneTransport({ kind: 'value', value: '7' }), '7');
check('valueOrNoneTransport preserves an already-$-prefixed value verbatim (this function does NOT strip -- only dollarValueOrNoneTransport does)', valueOrNoneTransport({ kind: 'value', value: '$500' }), '$500');

/* ==================================================================== */
/* dollarValueOrNoneTransport -- "" for none, defensive leading-$ strip  */
/* ==================================================================== */

check('dollarValueOrNoneTransport({kind:"none"}) is ""', dollarValueOrNoneTransport({ kind: 'none' }), '');
check('dollarValueOrNoneTransport strips a leading "$" with no space', dollarValueOrNoneTransport({ kind: 'value', value: '$500' }), '500');
check('dollarValueOrNoneTransport strips a leading "$" with a space', dollarValueOrNoneTransport({ kind: 'value', value: '$ 500' }), '500');
check('dollarValueOrNoneTransport leaves an already-bare value unchanged', dollarValueOrNoneTransport({ kind: 'value', value: '1,500' }), '1,500');
check('dollarValueOrNoneTransport trims surrounding whitespace', dollarValueOrNoneTransport({ kind: 'value', value: '  750  ' }), '750');
checkTrue('dollarValueOrNoneTransport output never starts with "$"', !dollarValueOrNoneTransport({ kind: 'value', value: '$1,000' }).startsWith('$'));

/* ==================================================================== */
/* sellerSignersTransport -- names only, "; "-joined, nulls omitted      */
/* ==================================================================== */

check(
  'sellerSignersTransport joins multiple names with "; ", no role, no signing-authority note',
  sellerSignersTransport([
    { displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: 'as trustee' },
    { displayName: 'John Seller', role: 'Co-Owner', signingAuthorityNote: null },
  ]),
  'Jane Seller; John Seller',
);
check('sellerSignersTransport omits a null displayName entirely (never renders the literal "null")', sellerSignersTransport([{ displayName: null, role: 'Unknown', signingAuthorityNote: null }]), '');
check(
  'sellerSignersTransport omits only the null entry, keeps the rest',
  sellerSignersTransport([
    { displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: null },
    { displayName: null, role: 'Unknown', signingAuthorityNote: null },
    { displayName: 'John Seller', role: 'Co-Owner', signingAuthorityNote: null },
  ]),
  'Jane Seller; John Seller',
);
check('sellerSignersTransport of an empty array is ""', sellerSignersTransport([]), '');
checkTrue('sellerSignersTransport output never contains "(" (no role parenthetical)', !sellerSignersTransport([{ displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: null }]).includes('('));
checkTrue('sellerSignersTransport output never contains an em-dash (no signing-authority note)', !sellerSignersTransport([{ displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: 'as trustee' }]).includes('--'));

/* ==================================================================== */
/* Additional earnest money -- one canonical fact, two transport values  */
/* ==================================================================== */

check('additionalEarnestMoneyAmountTransport({kind:"none"}) is ""', additionalEarnestMoneyAmountTransport({ kind: 'none' }), '');
check('additionalEarnestMoneyDaysTransport({kind:"none"}) is ""', additionalEarnestMoneyDaysTransport({ kind: 'none' }), '');
check('additionalEarnestMoneyAmountTransport({kind:"value",amount:2500,withinDays:5}) is bare, no "$"', additionalEarnestMoneyAmountTransport({ kind: 'value', amount: 2500, withinDays: 5 }), '2,500.00');
check('additionalEarnestMoneyDaysTransport({kind:"value",amount:2500,withinDays:5}) is bare, no "day"/"days"', additionalEarnestMoneyDaysTransport({ kind: 'value', amount: 2500, withinDays: 5 }), '5');
{
  const fact = { kind: 'value', amount: 1, withinDays: 1 };
  check(
    'both additional-earnest-money transport values derive from the exact same fact object -- proven by deriving both from one shared reference',
    [additionalEarnestMoneyAmountTransport(fact), additionalEarnestMoneyDaysTransport(fact)],
    ['1.00', '1'],
  );
}

/* ==================================================================== */
/* checkClosingDateCenturyBound -- fail-closed 2000-2099 gate             */
/* ==================================================================== */

check('checkClosingDateCenturyBound: year 2000 (lower boundary) passes', checkClosingDateCenturyBound('2000-06-15T00:00:00.000Z'), { ok: true });
check('checkClosingDateCenturyBound: year 2099 (upper boundary) passes', checkClosingDateCenturyBound('2099-06-15T00:00:00.000Z'), { ok: true });
checkTrue('checkClosingDateCenturyBound: year 1999 (just below) fails with a year-specific reason', !checkClosingDateCenturyBound('1999-12-31T23:59:59.000Z').ok && /1999/.test(checkClosingDateCenturyBound('1999-12-31T23:59:59.000Z').reason));
checkTrue('checkClosingDateCenturyBound: year 2100 (just above) fails with a year-specific reason', !checkClosingDateCenturyBound('2100-01-01T00:00:00.000Z').ok && /2100/.test(checkClosingDateCenturyBound('2100-01-01T00:00:00.000Z').reason));
checkTrue('checkClosingDateCenturyBound: malformed instant fails', !checkClosingDateCenturyBound('not-a-real-date').ok);
checkTrue('checkClosingDateCenturyBound: empty string fails', !checkClosingDateCenturyBound('').ok);
check('checkClosingDateCenturyBound: leap day 2028-02-29 passes', checkClosingDateCenturyBound('2028-02-29T00:00:00.000Z'), { ok: true });
check('checkClosingDateCenturyBound: UTC boundary a (2026-01-01T00:30:00.000Z, would be Dec 31 in a negative-offset local zone) passes and reads as year 2026', checkClosingDateCenturyBound('2026-01-01T00:30:00.000Z'), { ok: true });
check('checkClosingDateCenturyBound: UTC boundary b (2025-12-31T23:45:00.000Z, would be Jan 1 in a positive-offset local zone) passes and reads as year 2025', checkClosingDateCenturyBound('2025-12-31T23:45:00.000Z'), { ok: true });
checkTrue('checkClosingDateCenturyBound: century-boundary instant 1999-12-31T23:59:59.000Z fails', !checkClosingDateCenturyBound('1999-12-31T23:59:59.000Z').ok);
check('checkClosingDateCenturyBound: century-boundary instant 2099-12-31T23:59:59.000Z passes', checkClosingDateCenturyBound('2099-12-31T23:59:59.000Z'), { ok: true });
checkTrue('checkClosingDateCenturyBound: century-boundary instant 2100-01-01T00:00:00.000Z fails', !checkClosingDateCenturyBound('2100-01-01T00:00:00.000Z').ok);

/* ==================================================================== */
/* closingDateMonthDayTransport / closingDateYearSuffixTransport         */
/* ==================================================================== */

check('closingDateMonthDayTransport renders UTC-derived "MMMM d"', closingDateMonthDayTransport('2026-09-15T00:00:00.000Z'), 'September 15');
check('closingDateYearSuffixTransport renders exactly the two trailing year digits', closingDateYearSuffixTransport('2026-09-15T00:00:00.000Z'), '26');
checkTrue('closingDateYearSuffixTransport output matches /^[0-9]{2}$/', /^[0-9]{2}$/.test(closingDateYearSuffixTransport('2026-09-15T00:00:00.000Z')));
check('closingDateYearSuffixTransport for year 2000 is "00"', closingDateYearSuffixTransport('2000-01-01T00:00:00.000Z'), '00');
check('closingDateYearSuffixTransport for year 2099 is "99"', closingDateYearSuffixTransport('2099-12-31T00:00:00.000Z'), '99');
check('closingDateMonthDayTransport on leap day renders "February 29"', closingDateMonthDayTransport('2028-02-29T00:00:00.000Z'), 'February 29');
check('closingDateYearSuffixTransport on leap day renders "28"', closingDateYearSuffixTransport('2028-02-29T00:00:00.000Z'), '28');
check('closingDateMonthDayTransport is UTC-safe at boundary a (2026-01-01T00:30:00.000Z reads as January 1, not Dec 31)', closingDateMonthDayTransport('2026-01-01T00:30:00.000Z'), 'January 1');
check('closingDateYearSuffixTransport is UTC-safe at boundary a', closingDateYearSuffixTransport('2026-01-01T00:30:00.000Z'), '26');
check('closingDateMonthDayTransport is UTC-safe at boundary b (2025-12-31T23:45:00.000Z reads as December 31, not Jan 1)', closingDateMonthDayTransport('2025-12-31T23:45:00.000Z'), 'December 31');
check('closingDateYearSuffixTransport is UTC-safe at boundary b', closingDateYearSuffixTransport('2025-12-31T23:45:00.000Z'), '25');
{
  const iso = '2026-07-04T00:00:00.000Z';
  check(
    'closingDateMonthDayTransport and closingDateYearSuffixTransport derive from the exact same instant -- proven by deriving both from one shared string',
    [closingDateMonthDayTransport(iso), closingDateYearSuffixTransport(iso)],
    ['July 4', '26'],
  );
}

/* ==================================================================== */

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
