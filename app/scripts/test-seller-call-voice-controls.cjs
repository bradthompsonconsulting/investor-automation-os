/**
 * INV-91/INV-92, revised by B14-11 / INV-93: offline acceptance and
 * preservation proof for Seller Call calling options.
 *
 * B14-11 replaced the retired Twilio-era "Call with IAOS" softphone with a
 * read-only GHL Phone handoff. The softphone availability checks that used
 * to live here asserted UI that no longer exists and were retired with it;
 * the server-side voice foundation keeps its own suite
 * (test-voice-foundation.cjs).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-voice-controls-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'shared/voice-call-contract.ts'),
    path.join(APP, 'src/lib/ghl-call-handoff.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const contract = require(path.join(TMP, 'shared/voice-call-contract.js'));
const handoff = require(path.join(TMP, 'src/lib/ghl-call-handoff.js'));
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

check('formatted authoritative phone normalizes to E.164', contract.normalizeVoicePhone('(214) 555-0101'), '+12145550101');
check('already-normalized US phone remains stable', contract.normalizeVoicePhone('+12145550101'), '+12145550101');
check('non-US or malformed phone fails closed', contract.normalizeVoicePhone('555'), null);
check('missing phone fails closed', contract.normalizeVoicePhone(''), null);

// GHL handoff helper: popup opened vs blocked.
const URL = 'https://app.gohighlevel.com/v2/location/loc/contacts/detail/contact-1';
const opens = [];
const fakeWindow = { opener: 'iaos' };
check('handoff reports opened when the browser returns a window',
  handoff.openGhlContactWindow(URL, (url, target) => { opens.push([url, target]); return fakeWindow; }), 'opened');
check('handoff opens exactly the given GHL URL in a new browsing context', opens, [[URL, '_blank']]);
check('handoff severs window.opener on the GHL window', fakeWindow.opener, null);
check('handoff reports blocked when the browser returns null', handoff.openGhlContactWindow(URL, () => null), 'blocked');
const throwingWindow = { set opener(_) { throw new Error('cross-origin'); }, get opener() { return 'x'; } };
check('handoff still reports opened when severing opener throws', handoff.openGhlContactWindow(URL, () => throwingWindow), 'opened');

const component = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.tsx'), 'utf8');
const componentCode = component.replace(/\/\*[\s\S]*?\*\//g, '');
const workspace = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.css'), 'utf8');

// GHL Phone handoff.
check('GHL handoff uses the existing exact-contact URL builder with the page contact id', /ghlContactDetailUrl\(props\.contactId\)/.test(componentCode), true);
check('GHL handoff opens through the blocked-aware helper in a new window', /openGhlContactWindow\(ghlUrl,/.test(componentCode) && /window\.open\(url, target\)/.test(componentCode), true);
check('GHL handoff is labelled as GHL Phone, not IAOS calling', /Call with GHL Phone/.test(componentCode) && /Open seller in GHL/.test(componentCode), true);
check('GHL handoff states that opening GHL does not place or record a call', (componentCode.match(/Opening GHL does not place or record a call/g) || []).length, 2);
check('GHL handoff tells the operator to confirm the GHL contact before dialing', /Confirm the contact name and number there before dialing/.test(componentCode) && /Confirm the contact, then dial/.test(componentCode), true);
check('GHL handoff never claims a call was placed, connected, or completed', !/call (?:placed|started|connected|completed)|Calling seller|Connected/i.test(componentCode.replace(/does not place or record a call/g, '')), true);
check('GHL handoff stays available without a valid seller number', /data-testid="open-ghl-contact"/.test(componentCode) && !/data-testid="open-ghl-contact"[^>]*disabled|disabled[^>]*data-testid="open-ghl-contact"/.test(componentCode), true);
check('no-number state is explained on the GHL handoff', /data-testid="ghl-handoff-no-number"/.test(componentCode) && /IAOS has no valid number for this seller/.test(componentCode), true);
check('popup-blocked state is announced with a manual isolated link', /handoff === "blocked"/.test(componentCode) && /role="alert"/.test(componentCode) &&
  /href=\{ghlUrl\} target="_blank" rel="noopener noreferrer" data-testid="ghl-handoff-manual-link"/.test(componentCode), true);

// Retired Twilio-era entrance stays out of the browser.
check('component imports no Twilio SDK or IAOS voice session client', !/@twilio|twilio-browser-adapter|call-session|seller-call-voice-controls/.test(componentCode), true);
check('component makes no voice-session or other network fetch', !/fetch\(|netlify\/functions/.test(componentCode), true);
check('component loads no Google sign-in and requests no microphone', !/accounts\.google\.com|getUserMedia|Device\./.test(componentCode), true);
check('retired softphone entrance and controls are gone', !/Call with IAOS|Open softphone|voice-dial|voice-mute|voice-hang-up|iaos-softphone/.test(componentCode), true);
check('stylesheet carries no retired softphone styles', !/softphone|google-signin/.test(css), true);

// Writes and storage.
check('component contains no GHL or IAOS write path', !/\bghl\.|DispositionControl|CallbackPopover|setCallback|setLastCall|notes\.create|onOutcome|recordOutcome/.test(componentCode), true);
check('component stores nothing in browser storage', !/localStorage|sessionStorage|indexedDB/i.test(componentCode), true);
check('component contains no automatic retry loop', !/retry|setTimeout|setInterval/.test(componentCode), true);

// Cell fallback preserved.
check('cell mode uses authoritative normalized number for clipboard', /clipboard\.writeText\(destination\)/.test(componentCode), true);
check('mobile cell mode prefills native dialer without initiating it', /href=\{`tel:\$\{destination\}`\}/.test(componentCode) && /must press Send/i.test(componentCode), true);
check('cell mode is disabled and explained without a valid number', /disabled=\{!destination\}/.test(componentCode) && /Unavailable: no valid seller number/.test(componentCode), true);
check('both modes display seller identity', (componentCode.match(/props\.sellerName/g) || []).length >= 2, true);

// Seller Call page ownership is unchanged.
check('Seller Call mounts controls with exact contact identity and primary phone', /<SellerCallVoiceControls[\s\S]*contactId=\{contactId\}[\s\S]*sellerName=\{contactName\(contact\)\}[\s\S]*sellerPhone=\{contact\.phone\}/.test(workspace), true);
check('calling options precede and preserve resume context', workspace.indexOf('<SellerCallVoiceControls') < workspace.indexOf('data-testid="seller-call-resume-context"'), true);
check('existing script and outcome surfaces remain present', /<FullScriptDrawer/.test(workspace) && /data-testid="call-outcome-panel"/.test(workspace), true);
check('calling options remain isolated from script navigation state',
  !/set(?:ActiveStage|Script|Question)|on(?:Stage|Script|Question)/.test(componentCode), true);
check('existing notes, callbacks, dispositions, and GHL handoffs remain owned by Seller Call',
  /ghl\.notes\.create/.test(workspace) && /scheduleCallbackGated/.test(workspace) &&
  /data-testid="call-outcome-panel"/.test(workspace) && /handoffToPropStream/.test(workspace), true);
check('responsive layout switches to one column on mobile', /@media \(max-width: 767px\)[\s\S]*grid-template-columns: 1fr/.test(css), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nB14-11 Seller Call calling options: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
