/**
 * B15-23 (INV-132) -- property context in Conversations: unit and source checks.
 *
 * Unit checks of src/lib/conversation-property.ts: native address first with the
 * R-C1 qualifier, the Property Address field plain, none, loading, couldn't be
 * loaded, and a result for ANOTHER thread never shown (stale). Every string is
 * the Contacts/Pipeline module's own (no copy). Source checks on
 * Conversations.tsx: one read-only contact read per selection (R-C3), every
 * thread-pane read guarded by the current selection, the guarded name span
 * unchanged, no write.
 *
 * NEGATIVE CONTROL: `node scripts/test-conversation-property.cjs --before=<rev>`
 * checks <rev>'s Conversations page (via `git show`) with no property module
 * and must FAIL (exit 1) -- e.g. --before=3bbf49c, the base.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('./harness/ts-loader.cjs');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 19;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P = require('../src/lib/pipeline-property.ts');
let lib;
let page;
if (BEFORE) {
  console.log(`NEGATIVE CONTROL: the Conversations page from ${BEFORE}; this run must fail.`);
  page = execFileSync('git', ['show', `${BEFORE}:app/src/pages/Conversations.tsx`], { cwd: APP, encoding: 'utf8' });
  let has = true;
  try { execFileSync('git', ['cat-file', '-e', `${BEFORE}:app/src/lib/conversation-property.ts`], { cwd: APP, stdio: 'ignore' }); } catch { has = false; }
  lib = has ? require('../src/lib/conversation-property.ts') : { conversationPropertyLine: () => ({ kind: 'missing', text: 'conversationPropertyLine is missing', note: null }) };
} else {
  lib = require('../src/lib/conversation-property.ts');
  page = fs.readFileSync(path.join(APP, 'src/pages/Conversations.tsx'), 'utf8');
}
const { conversationPropertyLine: line } = lib;

// ── Unit: fictional contacts (every one also carries a mailing address that must never show) ──
const mail = { mailingAddress: '9 Mailing Rd', mailing_city: 'Mailtown', mailing_state: 'OK', mailing_zip: '73001' };
const c = (address1, city, state, postalCode, propertyAddress) => ({ address1, city, state, postalCode, propertyAddress, ...mail });
const loaded = (id, contact) => ({ contactId: id, kind: 'loaded', contact });
const NATIVE = c('417 Cedar Bend Rd', 'Waco', 'TX', '76701', '9 Customonly Ct');

check('native address first, with the R-C1 qualifier (and over a set Property Address field)',
  same(line(loaded('cI', NATIVE), 'cI'), { kind: 'native', text: '417 Cedar Bend Rd, Waco, TX 76701', note: P.NATIVE_ADDRESS_QUALIFIER }), line(loaded('cI', NATIVE), 'cI'));
check('no native street: the Property Address field, plain (no note)',
  same(line(loaded('cF', c('', 'Austin', 'TX', '', ' 77 Field Only Rd ')), 'cF'), { kind: 'field', text: '77 Field Only Rd', note: null }));
check('neither (a city alone is not an address): "The contact has no property address on record."',
  same(line(loaded('cN', c('', 'Frisco', 'TX', '75034', '')), 'cN'), { kind: 'none', text: P.PROPERTY_ADDRESS_NONE, note: null }));
check('read failed: "Property address couldn\'t be loaded." with no address',
  same(line({ contactId: 'cU', kind: 'failed', detail: 'ghl-contact → 500' }, 'cU'), { kind: 'unavailable', text: P.PROPERTY_ADDRESS_UNAVAILABLE, note: null }));
check('read in flight: loading', same(line({ contactId: 'cI', kind: 'loading' }, 'cI'), { kind: 'loading', text: P.PROPERTY_ADDRESS_LOADING, note: null }));
check('no read yet: loading', line(null, 'cI').kind === 'loading');
check('STALE: a loaded result for another thread is never shown (reads as loading)',
  same(line(loaded('cI', NATIVE), 'cF'), { kind: 'loading', text: P.PROPERTY_ADDRESS_LOADING, note: null }));
check('STALE: a failure for another thread never shows "couldn\'t be loaded" here', line({ contactId: 'cU', kind: 'failed', detail: 'x' }, 'cF').kind === 'loading');
check('no mailing text in any state', !/Mailing|Mailtown|73001/.test(JSON.stringify([
  line(loaded('a', c('', '', '', '', '')), 'a'), line(loaded('a', NATIVE), 'a'), line(loaded('a', c('', 'X', 'TX', '1', '')), 'a')])));
check('every string is the Contacts/Pipeline module\'s own (loading, unavailable, none, qualifier)',
  same([line(null, 'x').text, line({ contactId: 'x', kind: 'failed', detail: '' }, 'x').text, line(loaded('x', c('', '', '', '', '')), 'x').text, line(loaded('x', NATIVE), 'x').note],
    [P.PROPERTY_ADDRESS_LOADING, P.PROPERTY_ADDRESS_UNAVAILABLE, P.PROPERTY_ADDRESS_NONE, P.NATIVE_ADDRESS_QUALIFIER]));
check('the module does no I/O and duplicates no helper (it imports contactPropertyAddress)', (() => {
  try {
    const src = fs.readFileSync(path.join(APP, 'src/lib/conversation-property.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/fetch\(|\bghl\./.test(src) && /from "\.\/pipeline-property";/.test(src) && /contactPropertyAddress\(read\.contact\)/.test(src) && !/function formatNativeAddress|address1/.test(src);
  } catch { return false; }
})());

// ── Source: Conversations.tsx ──
const code = page.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const effect = (code.match(/useEffect\(\(\) => \{\s*if \(!selected\) return;[\s\S]*?\}, \[selected, readRecovered\]\);/) || [''])[0];
check('exactly one contact read on the page, inside the selection effect (R-C3)',
  (code.match(/ghl\.contacts\.getOne\(/g) || []).length === 1 && /ghl\.contacts\.getOne\(contactId\)/.test(effect));
check('the contact read runs only for a thread with a contact', /if \(contactId\) \{\s*ghl\.contacts\.getOne\(contactId\)/.test(effect));
check('every thread-pane read result is guarded by the current selection (messages, notes, contact; success and failure)',
  (effect.match(/if \(current\) set/g) || []).length === 6 && /let current = true;/.test(effect) && /return \(\) => \{ current = false; \};\s*\}, \[selected, readRecovered\]\);/.test(effect));
check('the line is computed from the read and the SELECTED contact only', /conversationPropertyLine\(contactRead, selected\.contactId\)/.test(code));
check('the line renders its text, state and (native only) the qualifier note',
  /data-testid="conv-property-context" data-property-state=\{property\.kind\}/.test(code) && /\{property\.text\}/.test(code) && /\{property\.note && \(/.test(code));
check('the guarded banner name span is unchanged (22px / 600, same node, same text)',
  /<span style=\{\{ minWidth: 0, fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>\s*\{selected\.contactName\}\s*<\/span>/.test(code));
check('the page still writes nothing and adds no send or call surface',
  !/appWriteFetch\(|ghl\.notes\.create\(|ghl\.contacts\.set[A-Za-z]*\(|ghl\.conversations\.send|sendMessage|placeCall|method:\s*"(POST|PUT|PATCH|DELETE)"/.test(code));
check('no mailing field is named on the page', !/mailing/i.test(code));

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
