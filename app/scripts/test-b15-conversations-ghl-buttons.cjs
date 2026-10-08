/**
 * B15-23 (INV-132) / Pass 1 F49 -- Conversations GHL hand-off labels.
 *
 * Offline, source-text checks (no browser rendering harness exists; see
 * test-deal-calculator-wiring.cjs). Proves both thread actions name GHL
 * explicitly ("Reply in GHL", "Call in GHL") while keeping their existing
 * destination and behaviour: the same GHL contact-detail URL, a new tab
 * with no opener or referrer, pure navigation with no handler -- no IAOS
 * sending or calling.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const conv = fs.readFileSync(path.join(APP, 'src/pages/Conversations.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 12;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

// Every <a ...>...</a> whose href is the GHL contact-detail URL.
const ghlAnchors = conv.match(/<a\s+href=\{ghlContactDetailUrl\(selected\.contactId\)\}[\s\S]*?<\/a>/g) || [];
const reply = ghlAnchors.find((a) => /Reply in GHL/.test(a)) || '';
const call = ghlAnchors.find((a) => /Call in GHL/.test(a)) || '';

check('exactly two GHL hand-off anchors, as before', ghlAnchors.length, 2);
check('Reply button reads "Reply in GHL"', /<ExternalLink size=\{12\} \/> Reply in GHL\n/.test(reply), true);
check('Call button reads "Call in GHL"', /<Phone size=\{12\} \/> Call in GHL\n/.test(call), true);
check('no bare "Call" label remains', /<Phone size=\{12\} \/> Call\n/.test(conv), false);
check('Reply title says it opens GHL in a new tab and IAOS does not send', /title="Opens this contact in GHL in a new tab, to reply there\. IAOS does not send messages\."/.test(reply), true);
check('Call title says it opens GHL in a new tab and IAOS does not place calls', /title="Opens this contact in GHL in a new tab, to call with GHL's phone there\. IAOS does not place calls\."/.test(call), true);
for (const [name, a] of [['Reply', reply], ['Call', call]]) {
  check(`${name} keeps its new-tab, no-opener behaviour`, /target="_blank"\s+rel="noopener noreferrer"/.test(a), true);
  check(`${name} is pure navigation (no handler, no fetch, no write)`, /onClick|fetch\(|ghl\.[a-z]+\.(create|set|update|send)/.test(a), false);
}
check('Conversations adds no send or call surface', /ghl\.conversations\.send|ghl\.calls\.|sendMessage|placeCall/.test(conv), false);
check('the Workspace link is unchanged', /<ExternalLink size=\{12\} \/> Workspace\n/.test(conv), true);

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
