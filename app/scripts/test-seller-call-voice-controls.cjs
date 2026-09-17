/** INV-91: offline acceptance harness for responsive dual-mode Seller Call controls. */
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
    path.join(APP, 'src/lib/voice/seller-call-voice-controls.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const contract = require(path.join(TMP, 'shared/voice-call-contract.js'));
const controls = require(path.join(TMP, 'src/lib/voice/seller-call-voice-controls.js'));
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
check('every lifecycle state has an operator label', Object.keys(controls.VOICE_STATE_LABELS).sort(), [...contract.VOICE_STATES].sort());

const available = (overrides = {}) => controls.voiceControlAvailability({
  isMobile: false, browserSupported: true, featureEnabled: true,
  authenticated: true, state: 'idle', ...overrides,
});
check('desktop unsupported browser keeps IAOS mode visible but disabled', available({ browserSupported: false }), {
  showIaosMode: true, iaosDisabled: true, canDial: false, canMute: false, canHangUp: false,
});
check('mobile unsupported browser hides IAOS mode', available({ isMobile: true, browserSupported: false }).showIaosMode, false);
check('supported mobile browser exposes IAOS mode', available({ isMobile: true }).showIaosMode, true);
check('Dial requires enabled authenticated idle state', available().canDial, true);
check('Dial remains disabled before Brad authentication', available({ authenticated: false }).canDial, false);
check('connected state exposes Mute and Hang Up only', available({ state: 'connected' }), {
  showIaosMode: true, iaosDisabled: false, canDial: false, canMute: true, canHangUp: true,
});
check('uncertain provider state exposes no call action', available({ state: 'provider-unknown' }), {
  showIaosMode: true, iaosDisabled: false, canDial: false, canMute: false, canHangUp: false,
});
check('authorizing attempt blocks closing or retrying', controls.isVoiceAttemptActive('authorizing'), true);

const component = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'src/components/SellerCallVoiceControls.css'), 'utf8');
const sessionEndpoint = fs.readFileSync(path.join(APP, 'netlify/functions/voice-session.ts'), 'utf8');

check('cell mode uses authoritative normalized number for clipboard', /clipboard\.writeText\(destination\)/.test(component), true);
check('mobile cell mode prefills native dialer without initiating it', /href=\{`tel:\$\{destination\}`\}/.test(component) && /must press Send/i.test(component), true);
check('both modes display seller identity', (component.match(/props\.sellerName/g) || []).length >= 2, true);
check('IAOS mode checks SDK, secure context, and microphone capability', /Device\.isSupported/.test(component) && /window\.isSecureContext/.test(component) && /getUserMedia/.test(component), true);
check('Brad authentication uses Google identity and server session endpoint', /accounts\.google\.com\/gsi\/client/.test(component) && (component.match(/netlify\/functions\/voice-session/g) || []).length >= 2, true);
check('operator session is memory-only', !/localStorage|sessionStorage|indexedDB/i.test(component), true);
check('softphone exposes accessible Dial, Mute, and Hang Up controls', /data-testid="voice-dial"/.test(component) && /data-testid="voice-mute"/.test(component) && /data-testid="voice-hang-up"/.test(component), true);
check('lifecycle and failure text are announced', /role="status"/.test(component) && /aria-live="polite"/.test(component) && /role="alert"/.test(component), true);
check('ending a call leaves disposition and callback manual', /does not select a disposition or schedule a callback/i.test(component), true);
check('component contains no GHL write path', !/\bghl\b|DispositionControl|CallbackPopover|setCallback|setLastCall|notes\.create/.test(component), true);
check('component contains no automatic retry loop', !/retry|setTimeout/.test(component), true);
check('Seller Call mounts controls with exact contact identity and primary phone', /<SellerCallVoiceControls[\s\S]*contactId=\{contactId\}[\s\S]*sellerName=\{contactName\(contact\)\}[\s\S]*sellerPhone=\{contact\.phone\}/.test(workspace), true);
check('voice controls precede and preserve resume context', workspace.indexOf('<SellerCallVoiceControls') < workspace.indexOf('data-testid="seller-call-resume-context"'), true);
check('existing script and outcome surfaces remain present', /<FullScriptDrawer/.test(workspace) && /data-testid="call-outcome-panel"/.test(workspace), true);
check('responsive layout switches to one column on mobile', /@media \(max-width: 767px\)[\s\S]*grid-template-columns: 1fr/.test(css), true);
check('public bootstrap returns only enablement and Google client ID', /\{ enabled: true, googleClientId \}/.test(sessionEndpoint) && /\{ enabled: false, googleClientId: null \}/.test(sessionEndpoint), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nINV-91 Seller Call voice controls: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
