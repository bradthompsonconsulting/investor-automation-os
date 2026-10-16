/**
 * AirDroid call eligibility -- the decision rule, offline (pure; no I/O).
 * Scope: IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md §1, §2 and §6 A.
 *
 * Every case names its rule row. Phone forms are only ones the existing
 * test-airdroid-prepare-call.cjs already accepts or refuses: no new number policy.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(parent.filename), name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

const { evaluateCallEligibility } = require(path.join(APP, 'netlify/functions/lib/call-eligibility-rule.ts'));
const { airdroidCallDigits } = require(path.join(APP, 'src/lib/airdroid-prepare-call.ts'));
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const TEST = getConfig('test');
const PROD = getConfig('production');
const ID = 'NAGtUZ9aOE5C1GatJzpT';
const EXPECT = { locationId: TEST.locationId, phoneStatusFieldId: TEST.fields.phoneStatus };
const PS = TEST.fields.phoneStatus;
const contact = (over = {}) => ({ id: ID, locationId: TEST.locationId, phone: '+12025550147', customFields: [], ...over });
const decide = (c, expect = EXPECT) => evaluateCallEligibility({ contact: c }, ID, expect).decision;
const without = (o, key) => { const c = { ...o }; delete c[key]; return c; };

// Field identity pinned (scope §2).
check('pin: Production Phone Status field id', PROD.fields.phoneStatus, '6WJG2a40490bW0c62YFT');
check('pin: Test Phone Status field id', TEST.fields.phoneStatus, 'aLqIaUk3UwvSeu1ijFL8');
check('pin: Test location id', TEST.locationId, 'SoTgVoaFGHtBdRFvXWQV');

// Row 1: precondition.
check('row 1: body not an object', evaluateCallEligibility(null, ID, EXPECT).decision, 'unknown');
check('row 1: body is an array', evaluateCallEligibility([], ID, EXPECT).decision, 'unknown');
check('row 1: no contact object', evaluateCallEligibility({}, ID, EXPECT).decision, 'unknown');
check('row 1: contact is null', evaluateCallEligibility({ contact: null }, ID, EXPECT).decision, 'unknown');
check('row 1: wrong contact id', decide(contact({ id: 'someoneElse12345678' })), 'mismatch');
check('row 1: wrong location (Production location on a Test read)', decide(contact({ locationId: PROD.locationId })), 'mismatch');
check('row 1: location missing', decide(without(contact(), 'locationId')), 'mismatch');

// Row 2 and explicit-suppression precedence.
check('row 2: contact-wide dnd true with Call inactive', decide(contact({ dnd: true, dndSettings: { Call: { status: 'inactive' } } })), 'suppressed');
check('row 2: contact-wide dnd true with dndSettings absent', decide(contact({ dnd: true })), 'suppressed');

// Row 3: present-malformed is not absent.
check('row 3: dndSettings null', decide(contact({ dndSettings: null })), 'unknown');
check('row 3: dndSettings array', decide(contact({ dndSettings: [] })), 'unknown');
check('row 3: dndSettings string', decide(contact({ dndSettings: 'Call' })), 'unknown');

// Row 4.
check('row 4: Call active', decide(contact({ dndSettings: { Call: { status: 'active', message: 'x' } } })), 'suppressed');
check('row 4: Call permanent', decide(contact({ dndSettings: { Call: { status: 'permanent' } } })), 'suppressed');
check('row 4: Voice active', decide(contact({ dndSettings: { Voice: { status: 'active' } } })), 'suppressed');
check('row 4 precedence: Call inactive + Voice active', decide(contact({ dndSettings: { Call: { status: 'inactive' }, Voice: { status: 'active' } } })), 'suppressed');
check('row 4 precedence: malformed Call + Voice permanent', decide(contact({ dndSettings: { Call: null, Voice: { status: 'permanent' } } })), 'suppressed');
check('row 4 precedence: Call active + Phone Status unreadable', decide(contact({ dndSettings: { Call: { status: 'active' } }, customFields: 'x' })), 'suppressed');

// Row 5.
check('row 5: Call inactive + Voice "weird"', decide(contact({ dndSettings: { Call: { status: 'inactive' }, Voice: { status: 'weird' } } })), 'unknown');
check('row 5: Call null', decide(contact({ dndSettings: { Call: null } })), 'unknown');
check('row 5: Call {}', decide(contact({ dndSettings: { Call: {} } })), 'unknown');
check('row 5: Call status not exact ("Active")', decide(contact({ dndSettings: { Call: { status: 'Active' } } })), 'unknown');

// Row 6.
check('row 6: dnd "yes"', decide(contact({ dnd: 'yes' })), 'unknown');
check('row 6: dnd null', decide(contact({ dnd: null })), 'unknown');

// Rows 7 and 8: Phone Status, identity and sparse semantics.
check('row 7: customFields missing', decide(without(contact(), 'customFields')), 'unknown');
check('row 7: customFields not an array', decide(contact({ customFields: {} })), 'unknown');
check('row 7: a malformed customFields entry', decide(contact({ customFields: [null] })), 'unknown');
check('row 7: matching entry with no value', decide(contact({ customFields: [{ id: PS }] })), 'unknown');
check('row 7: matching entry with a non-string value', decide(contact({ customFields: [{ id: PS, value: ['Incorrect Number'] }] })), 'unknown');
check('row 7: duplicate matching entries', decide(contact({ customFields: [{ id: PS, value: 'Callable' }, { id: PS, value: 'Callable' }] })), 'unknown');
check('row 7: configured id blank', decide(contact(), { ...EXPECT, phoneStatusFieldId: '' }), 'unknown');
check('row 7: configured id a sentinel', decide(contact(), { ...EXPECT, phoneStatusFieldId: 'NOT_PROVISIONED' }), 'unknown');
check('row 8: "Incorrect Number"', decide(contact({ customFields: [{ id: PS, value: 'Incorrect Number' }] })), 'incorrect_number');
check('row 8: "incorrect number " (trim, case)', decide(contact({ customFields: [{ id: PS, value: 'incorrect number ' }] })), 'incorrect_number');
check('row 8: value carried as fieldValue', decide(contact({ customFields: [{ id: PS, fieldValue: 'Incorrect Number' }] })), 'incorrect_number');
check('rows 7-8: Phone Status absent from a valid array (unpopulated)', decide(contact({ customFields: [{ id: 'otherField123456789', value: 'x' }] })), 'eligible');
check('rows 7-8: "Callable"', decide(contact({ customFields: [{ id: PS, value: 'Callable' }] })), 'eligible');
check('row 8 precedence: Incorrect Number with Call suppressed is suppressed', decide(contact({ dndSettings: { Call: { status: 'active' } }, customFields: [{ id: PS, value: 'Incorrect Number' }] })), 'suppressed');

// R1 (Bones) / Brad's Phone Status clarification: ambiguity never picks a value.
const IN = 'Incorrect Number';
check('R1: identical duplicate entries "Callable" -> unknown (never pick one)', decide(contact({ customFields: [{ id: PS, value: 'Callable' }, { id: PS, value: 'Callable' }] })), 'unknown');
check('R1: identical duplicate entries "Incorrect Number" -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: IN }, { id: PS, value: IN }] })), 'incorrect_number');
check('R1: conflicting duplicates, Callable first -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: 'Callable' }, { id: PS, value: IN }] })), 'incorrect_number');
check('R1: conflicting duplicates, Incorrect Number first -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: IN }, { id: PS, value: 'Callable' }] })), 'incorrect_number');
check('R1: conflicting duplicates, Callable and another value -> unknown', decide(contact({ customFields: [{ id: PS, value: 'Callable' }, { id: PS, value: 'Do Not Use' }] })), 'unknown');
check('R1: value "Callable" vs fieldValue "Incorrect Number" -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: 'Callable', fieldValue: IN }] })), 'incorrect_number');
check('R1: value "Incorrect Number" vs fieldValue "Callable" -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: IN, fieldValue: 'Callable' }] })), 'incorrect_number');
check('R1: value "Callable" vs fieldValue "Other" -> unknown', decide(contact({ customFields: [{ id: PS, value: 'Callable', fieldValue: 'Other' }] })), 'unknown');
check('R1: value and fieldValue identical "Callable" -> not incorrect (eligible)', decide(contact({ customFields: [{ id: PS, value: 'Callable', fieldValue: 'Callable' }] })), 'eligible');
check('R1: malformed value, usable fieldValue "Callable" -> unknown', decide(contact({ customFields: [{ id: PS, value: null, fieldValue: 'Callable' }] })), 'unknown');
check('R1: malformed value, usable fieldValue "Incorrect Number" -> incorrect_number', decide(contact({ customFields: [{ id: PS, value: 42, fieldValue: IN }] })), 'incorrect_number');
check('R1: malformed matching entry beside a valid "Callable" entry -> unknown', decide(contact({ customFields: [{ id: PS }, { id: PS, value: 'Callable' }] })), 'unknown');
check('R1: an unidentifiable entry (no string id) beside unrelated fields -> unknown', decide(contact({ customFields: [{ value: 'Callable' }, { id: 'otherField123456789', value: 'x' }] })), 'unknown');
check('R1: an unidentifiable entry beside a valid "Incorrect Number" entry -> incorrect_number', decide(contact({ customFields: [{ value: 'x' }, { id: PS, value: IN }] })), 'incorrect_number');
check('R1: well-formed unrelated fields only -> not incorrect (eligible)', decide(contact({ customFields: [{ id: 'otherField123456789', value: IN }, { id: 'another1234567890', fieldValue: 'y' }] })), 'eligible');
check('R1: valid empty array -> eligible', decide(contact({ customFields: [] })), 'eligible');

// T1 (Bones): precedence combinations that catch premature returns.
check('T1: dnd true + malformed dndSettings -> suppressed', decide(contact({ dnd: true, dndSettings: null })), 'suppressed');
check('T1: dnd true + unreadable customFields -> suppressed', decide(contact({ dnd: true, customFields: 'x' })), 'suppressed');
check('T1: Voice malformed + Call active (reverse arrangement) -> suppressed', decide(contact({ dndSettings: { Voice: { status: 'weird' }, Call: { status: 'active' } } })), 'suppressed');
check('T1: Call unknown status + Voice permanent -> suppressed', decide(contact({ dndSettings: { Call: { status: 'unknown' }, Voice: { status: 'permanent' } } })), 'suppressed');
check('T1: non-boolean dnd + Call active -> suppressed (row 4 before row 6)', decide(contact({ dnd: 'yes', dndSettings: { Call: { status: 'active' } } })), 'suppressed');
check('T1: wrong contact id + dnd true -> mismatch (row 1 first; shown as "could not verify")', decide(contact({ id: 'someoneElse12345678', dnd: true })), 'mismatch');
check('T1: wrong location + dnd true -> mismatch (row 1 first)', decide(contact({ locationId: PROD.locationId, dnd: true })), 'mismatch');
check('T1: no contact object + dnd elsewhere -> unknown (row 1)', evaluateCallEligibility({ dnd: true }, ID, EXPECT).decision, 'unknown');
check('T1: valid sparse settings, every other check satisfied -> eligible', decide(contact({ dndSettings: { SMS: { status: 'active' }, Email: { status: 'active' } }, customFields: [{ id: PS, value: 'Callable' }] })), 'eligible');

// T2 (Bones): environment binding of the Phone Status id.
check('T2: Test config ignores Incorrect Number stored only under the Production id', decide(contact({ customFields: [{ id: PROD.fields.phoneStatus, value: IN }] })), 'eligible');
const PROD_EXPECT = { locationId: PROD.locationId, phoneStatusFieldId: PROD.fields.phoneStatus };
const prodContact = (over = {}) => contact({ locationId: PROD.locationId, ...over });
check('T2: Production config ignores Incorrect Number stored only under the Test id', decide(prodContact({ customFields: [{ id: PS, value: IN }] }), PROD_EXPECT), 'eligible');
check('T2: Production config honours its own id', decide(prodContact({ customFields: [{ id: PROD.fields.phoneStatus, value: ' INCORRECT number' }] }), PROD_EXPECT), 'incorrect_number');

// Row 9: the unchanged helper's own refused forms.
for (const [name, raw] of [['empty', ''], ['7 digits', '555-0147'], ['11 digits not starting 1', '22025550147'], ['UK number', '+44 20 7946 0958'], ['exchange starts 1', '2021550147']]) {
  check(`row 9: invalid phone (${name})`, decide(contact({ phone: raw })), 'invalid_phone');
}
check('row 9: phone missing', decide(without(contact(), 'phone')), 'invalid_phone');

// Row 10: the recorded sparse representation.
check('row 10: dndSettings absent', decide(contact()), 'eligible');
check('row 10: dndSettings {}', decide(contact({ dndSettings: {} })), 'eligible');
check('row 10: SMS permanent only (Call absent)', decide(contact({ dndSettings: { SMS: { status: 'permanent', message: 'STOP_KEYWORD' } } })), 'eligible');
check('row 10: Call inactive', decide(contact({ dndSettings: { Call: { status: 'inactive' } } })), 'eligible');
check('row 10: dnd false', decide(contact({ dnd: false })), 'eligible');

// phoneDigits: the unchanged helper's result, only on eligible.
for (const [name, raw] of [['10 digits', '2025550147'], ['dashed', '202-555-0147'], ['parenthesised', '(202) 555-0147'], ['dotted', '202.555.0147'], ['+1 E.164', '+12025550147'], ['1 prefix', '1 202 555 0147']]) {
  const r = evaluateCallEligibility({ contact: contact({ phone: raw }) }, ID, EXPECT);
  check(`phoneDigits = airdroidCallDigits (${name})`, [r.decision, r.phoneDigits], ['eligible', airdroidCallDigits(raw)]);
}
const blocked = evaluateCallEligibility({ contact: contact({ dnd: true }) }, ID, EXPECT);
check('phoneDigits is null when not eligible; contactId is always the expected id', [blocked.phoneDigits, blocked.contactId], [null, ID]);

console.log(`\nCall eligibility rule: ${checks - failures}/${checks} checks passed`);
process.exitCode = failures ? 1 : 0;
