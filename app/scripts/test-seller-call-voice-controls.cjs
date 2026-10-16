/**
 * INV-91/INV-92, revised by B14-11 / INV-93: offline acceptance and
 * preservation proof for Seller Call calling options.
 *
 * B14-11 replaced the retired Twilio-era "Call with IAOS" softphone with a
 * read-only GHL Phone handoff. The softphone availability checks that used
 * to live here asserted UI that no longer exists and were retired with it;
 * the server-side voice foundation keeps its own suite
 * (test-voice-foundation.cjs).
 *
 * B14-13 adds "Call with AirDroid" as the first, primary option. It launches
 * through the AirDroid launch interface (src/lib/airdroid-launch.ts, which
 * opens the iaos-airdroid: link once); rendered behaviour: test-seller-call-airdroid.cjs.
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
    path.join(APP, 'src/lib/airdroid-prepare-call.ts'),
    path.join(APP, 'src/lib/airdroid-launch.ts'),
    path.join(APP, 'src/components/GhlHandoffNotice.tsx'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck', '--jsx', 'react-jsx',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const contract = require(path.join(TMP, 'shared/voice-call-contract.js'));
const handoff = require(path.join(TMP, 'src/lib/ghl-call-handoff.js'));
const airdroid = require(path.join(TMP, 'src/lib/airdroid-launch.js'));
const { GhlHandoffNotice } = require(path.join(TMP, 'src/components/GhlHandoffNotice.js'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const renderNotice = (result) => renderToStaticMarkup(React.createElement(GhlHandoffNotice, { result, ghlUrl: 'https://app.gohighlevel.com/v2/location/loc/contacts/detail/contact-1' }));
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

// GHL handoff helper: isolate a blank window BEFORE navigating it to GHL.
const URL = 'https://app.gohighlevel.com/v2/location/loc/contacts/detail/contact-1';
function fakeWindow(overrides = {}) {
  const log = [];
  const win = {
    _opener: 'iaos',
    get opener() { log.push(['get-opener']); return this._opener; },
    set opener(v) { log.push(['set-opener', v]); this._opener = v; },
    location: { replace(url) { log.push(['navigate', url]); } },
    close() { log.push(['close']); },
    ...overrides,
  };
  return { win, log };
}
{
  const opens = [];
  const { win, log } = fakeWindow();
  check('handoff reports opened when isolation is verified',
    handoff.openGhlContactWindow(URL, (url, target) => { opens.push([url, target]); return win; }), 'opened');
  check('handoff opens a blank window first, never GHL directly', opens, [['about:blank', '_blank']]);
  check('handoff clears and verifies opener before navigating to the exact GHL URL',
    log, [['set-opener', null], ['get-opener'], ['navigate', URL]]);
}
check('handoff reports blocked when the browser returns null', handoff.openGhlContactWindow(URL, () => null), 'blocked');
{
  const log = [];
  const win = {
    get opener() { return 'iaos'; }, set opener(_) { throw new Error('cross-origin'); },
    location: { replace(url) { log.push(['navigate', url]); } }, close() { log.push(['close']); },
  };
  check('handoff fails closed when clearing opener throws', handoff.openGhlContactWindow(URL, () => win), 'isolation-failed');
  check('failed isolation closes the window and never navigates to GHL', log, [['close']]);
}
{
  const log = [];
  const win = {
    get opener() { return 'iaos'; }, set opener(_) { /* silently ignored */ },
    location: { replace(url) { log.push(['navigate', url]); } }, close() { log.push(['close']); },
  };
  check('handoff fails closed when opener silently stays attached', handoff.openGhlContactWindow(URL, () => win), 'isolation-failed');
  check('silently attached opener closes the window and never navigates', log, [['close']]);
}
{
  const log = [];
  const win = {
    get opener() { throw new Error('unreadable'); }, set opener(_) {},
    location: { replace(url) { log.push(['navigate', url]); } }, close() { log.push(['close']); },
  };
  check('handoff fails closed when opener cannot be verified', handoff.openGhlContactWindow(URL, () => win), 'isolation-failed');
  check('unverifiable opener closes the window and never navigates', log, [['close']]);
}
{
  const log = [];
  const win = { opener: 'iaos', location: { replace() { throw new Error('nav'); } }, close() { log.push(['close']); } };
  check('handoff fails closed and closes when navigation throws', [handoff.openGhlContactWindow(URL, () => win), log], ['isolation-failed', [['close']]]);
}
{
  const win = { get opener() { return 'iaos'; }, set opener(_) {}, location: { replace() {} }, close() { throw new Error('close'); } };
  check('handoff still fails closed when close itself throws', handoff.openGhlContactWindow(URL, () => win), 'isolation-failed');
}

const component = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.tsx'), 'utf8');
const componentCode = component.replace(/\/\*[\s\S]*?\*\//g, '');
const workspace = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.css'), 'utf8');

// GHL Phone handoff.
check('GHL handoff uses the existing exact-contact URL builder with the page contact id', /ghlContactDetailUrl\(props\.contactId\)/.test(componentCode), true);
check('GHL handoff opens through the blocked-aware helper in a new window', /openGhlContactWindow\(ghlUrl,/.test(componentCode) && /window\.open\(url, target\)/.test(componentCode), true);
check('GHL handoff is labelled as GHL Phone, not IAOS calling', /Call with GHL Phone/.test(componentCode) && /Open seller in GHL/.test(componentCode), true);
const noticeSource = fs.readFileSync(path.join(APP, 'src/components/GhlHandoffNotice.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rendered = { idle: renderNotice(null), opened: renderNotice('opened'), blocked: renderNotice('blocked'), failed: renderNotice('isolation-failed') };
check('GHL handoff renders its status through GhlHandoffNotice', /<GhlHandoffNotice result=\{handoff\} ghlUrl=\{ghlUrl\} \/>/.test(componentCode), true);
check('rendered idle and opened notices deny that opening GHL places or records a call',
  /Opening GHL does not place or record a call/.test(rendered.idle) && /Opening GHL does not place or record a call/.test(rendered.opened), true);
check('rendered notices tell the operator to confirm the GHL contact before dialing',
  /Confirm the contact, then dial/.test(rendered.idle) && /Confirm the contact name and number there before dialing/.test(rendered.opened), true);
check('GHL handoff never claims a call was placed, connected, or completed',
  !/call (?:placed|started|connected|completed)|Calling seller|Connected/i.test((componentCode + noticeSource + Object.values(rendered).join('')).replace(/does not place or record a call/g, '')), true);
check('GHL handoff stays available without a valid seller number', /data-testid="open-ghl-contact"/.test(componentCode) && !/data-testid="open-ghl-contact"[^>]*disabled|disabled[^>]*data-testid="open-ghl-contact"/.test(componentCode), true);
check('no-number state is explained on the GHL handoff', /data-testid="ghl-handoff-no-number"/.test(componentCode) && /IAOS has no valid number for this seller/.test(componentCode), true);
const manualLink = '<a href="https://app.gohighlevel.com/v2/location/loc/contacts/detail/contact-1" target="_blank" rel="noopener noreferrer" data-testid="ghl-handoff-manual-link">Open the GHL record</a>';
check('rendered popup-blocked notice is an alert with the isolated manual link',
  /^<span role="alert"[^>]*data-testid="ghl-handoff-blocked"/.test(rendered.blocked) && rendered.blocked.includes(manualLink) && /blocked the new window/.test(rendered.blocked), true);
{
  // Bones finding 1: close() itself throws, so the blank window may remain open.
  const closeThrows = { get opener() { return 'iaos'; }, set opener(_) {}, location: { replace() { throw new Error('must not navigate'); } }, close() { throw new Error('close failed'); } };
  const result = handoff.openGhlContactWindow('https://app.gohighlevel.com/v2/location/loc/contacts/detail/contact-1', () => closeThrows);
  const html = renderNotice(result);
  check('close() throwing yields isolation-failed', result, 'isolation-failed');
  check('rendered isolation-failed notice is an alert with the isolated manual link',
    /^<span role="alert"[^>]*data-testid="ghl-handoff-isolation-failed"/.test(html) && html.includes(manualLink), true);
  check('rendered isolation-failed notice gives the exact recovery instruction',
    html.includes('IAOS could not safely open the GHL record. If a blank window remains open, close it and use the link below.'), true);
  check('rendered isolation-failed notice never claims the window was closed', !/was closed|has been closed|window closed/i.test(html), true);
  check('notice source carries no window-closed guarantee', !/was closed|has been closed/i.test(noticeSource + componentCode), true);
}

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

// B14-13: Call with AirDroid, through the real launch interface (the link is opened by an injected opener here).
check('AirDroid call target is the 10 US digits for any US format',
  ['(214) 555-0101', '+12145550101', '214.555.0101', '1-214-555-0101'].map(airdroid.airdroidCallTarget), Array(4).fill('2145550101'));
check('AirDroid call target is refused (null) for missing, short, non-US, or 0/1-leading area code or exchange',
  ['', null, undefined, '555', '+442071234567', '(114) 555-0101', '(014) 555-0101', '(214) 155-0101', '(214) 055-0101'].map(airdroid.airdroidCallTarget),
  Array(9).fill(null));
check('the provisional stand-in is gone at integration', fs.existsSync(path.join(APP, 'src/lib/airdroid-launch-stand-in.ts')), false);
{
  const opened = [];
  const result = airdroid.launchAirdroidCall('2145550101', (link) => opened.push(link));
  check('one launch opens the iaos-airdroid call link exactly once and reports only "handed off"',
    [result, opened], [{ ok: true }, ['iaos-airdroid:call?number=2145550101']]);
  const refused = [];
  check('a target the link builder refuses opens nothing and reports a known error',
    [['', '555', '1145550101'].map((t) => airdroid.launchAirdroidCall(t, (link) => refused.push(link))), refused],
    [Array(3).fill({ ok: false, error: "This number can't be called with AirDroid." }), []]);
  const launcher = fs.readFileSync(path.join(APP, 'src/lib/airdroid-launch.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the launcher navigates only by location.assign of the built link: no popup, fetch or write',
    /\(link\) => window\.location\.assign\(link\)/.test(launcher) && /const link = airdroidCallLink\(target\);/.test(launcher)
    && !/window\.open|fetch\(|XMLHttpRequest|sendBeacon/.test(launcher), true);
}
check('AirDroid is the first calling option; GHL Phone and Cell follow in that order',
  [componentCode.indexOf('data-testid="call-with-airdroid-mode"'), componentCode.indexOf('data-testid="call-with-ghl-mode"'), componentCode.indexOf('data-testid="call-with-cell-mode"')]
    .every((i, n, a) => i >= 0 && (n === 0 || i > a[n - 1])), true);
// Call eligibility (2026-10-16): the button is also disabled while its click-time eligibility check is in flight.
check('AirDroid is one primary button, disabled without a valid number or while its eligibility check is in flight; GHL Phone is no longer styled primary',
  /<button className="seller-call-button seller-call-button--primary" type="button" onClick=\{callWithAirdroid\} disabled=\{!airdroidTarget \|\| checking\}\s+aria-busy=\{checking\} data-testid="call-with-airdroid">/.test(componentCode)
  && !/seller-call-button--primary" type="button" onClick=\{openGhl\}/.test(componentCode), true);
// Call eligibility (2026-10-16): the launch is of the click's bound target only, after the eligibility read, which
// lives in lib/airdroid-eligibility.ts; the component still has no link, popup, navigation or fetch( of its own.
check('the AirDroid button only calls the launch interface (with the click\'s bound number, after the lib eligibility read): no link, popup, navigation or fetch of its own',
  /import \{ airdroidCallTarget, launchAirdroidCall, type AirdroidLaunchResult \} from "\.\.\/lib\/airdroid-launch";/.test(componentCode)
  && /import \{ EligibilityGate, ELIGIBILITY_COPY, handoffVerdict, readCallEligibility, type BlockReason \} from "\.\.\/lib\/airdroid-eligibility";/.test(componentCode)
  && /result = launchAirdroidCall\(bound\.target\);/.test(componentCode)
  && !/\bfetch\(/.test(componentCode)
  && !/iaos-airdroid:|href=\{airdroid|location\.(?:assign|replace|href)/.test(componentCode) && (componentCode.match(/window\.open\(/g) || []).length === 1, true);
check('no valid number shows the reason; a failed or throwing launch shows a known error as an alert, with GHL Phone or Cell as the way on',
  /data-testid="airdroid-no-number">\s*Unavailable: IAOS has no valid 10-digit US number for this seller\. Use GHL Phone or Cell\./.test(componentCode)
  && /role="alert" data-testid="airdroid-launch-error">\s*\{airdroidError\} Use GHL Phone or Cell\./.test(componentCode)
  && /catch \{\s*result = \{ ok: false, error: "AirDroid couldn't be started\." \};/.test(componentCode), true);
{
  const card = (componentCode.match(/data-testid="call-with-airdroid-mode"[\s\S]*?data-testid="call-with-ghl-mode"/) || [''])[0];
  check('the AirDroid card has no after-click explanation and never claims a call was prepared, dialled, connected or ended',
    card.length > 200 && !/prepared|dial(?:l)?ed|connected|ended|calling|call (?:placed|started)|Check AirDroid and your phone|handed|helper|press Make Call|aria-live/i.test(card), true);
}
check('the compact Call (B14-13 live test) runs the same callWithAirdroid through a portal into the page slot; launchAirdroidCall stays called in one place',
  (componentCode.match(/launchAirdroidCall\(/g) || []).length === 1
  && /createPortal\([\s\S]*onClick=\{callWithAirdroid\}[\s\S]*data-testid="call-with-airdroid-compact"[\s\S]*props\.compactCallSlot,/.test(componentCode)
  && /props\.compactCallSlot && airdroidTarget \? createPortal\(/.test(componentCode), true);
check('the compact Call is shown only while the full Call row is not wholly in view, and its space is always kept',
  /new IntersectionObserver\(\(\[entry\]\) => setCallButtonInView\(entry\.intersectionRatio >= 0\.99\)/.test(componentCode)
  && /data-shown=\{callButtonInView \? "false" : "true"\}/.test(componentCode)
  && /\.seller-call-compact\[data-shown="false"\] \{ visibility: hidden; \}/.test(css), true);
check('Seller Call gives the compact Call its slot inside the sticky deal bar',
  /<SellerCallVoiceControls[\s\S]*compactCallSlot=\{compactCallSlot\}/.test(workspace)
  && /data-testid="seller-call-sticky-bar"[\s\S]*ref=\{setCompactCallSlot\} data-testid="seller-call-compact-call-slot"/.test(workspace), true);
check('AirDroid card spans its own full row on desktop', /\.seller-call-mode--primary \{ grid-column: 1 \/ -1;/.test(css), true);

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
