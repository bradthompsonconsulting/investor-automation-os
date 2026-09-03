/**
 * B7-02 PropStream browser handoff -- test runner.
 *
 * Compiles src/lib/propstream.ts to a temp directory, loads the emitted
 * JavaScript, and drives every branch against injected doubles. No GHL, no
 * network, no browser, no PropStream. Exits nonzero on any failure.
 *
 * app/package.json sets "type": "module", so the temp directory is given its
 * own package.json declaring commonjs -- same reason as
 * test-disposition-override.cjs, which this follows.
 *
 * WHY AN OFFLINE RUNNER IS THE RIGHT INSTRUMENT HERE. The branch that decides
 * whether this feature is honest is a REFUSAL: a clipboard that rejects, or is
 * not exposed at all. It cannot be provoked on demand in a real browser, since
 * it turns on permission state and document focus. Injected, it is one line.
 *
 * ⚠ PARTIAL VERIFICATION, STATED. This proves the MODULE behaves and that the
 * page holds exactly one call site. It does NOT prove what a browser does with
 * a real click, and it cannot. That is what verify-propstream-handoff.cjs is
 * for, and two of this feature's design decisions -- the synchronous call order
 * and the absence of a blocked-popup outcome -- exist BECAUSE that harness
 * contradicted the first implementation. Neither could have been caught here.
 *
 * It also does not reach PropStream, deliberately: a test that hit
 * login.propstream.com would make this suite depend on a third party's uptime
 * for no added guarantee.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-propstream-handoff-test');
const SRC = path.join(APP, 'src', 'lib', 'propstream.ts');
const PAGE = path.join(APP, 'src', 'pages', 'ContactWorkspace.tsx');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + SRC + '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict --lib es2020,dom',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const compiled = path.join(TMP, 'propstream.js');
if (!fs.existsSync(compiled)) {
  console.error('ABORT: expected compiled output at ' + compiled);
  cleanup();
  process.exit(11);
}

const {
  PROPSTREAM_LOGIN_URL, subjectAddress, handoffToPropStream, copyAddressAgain,
} = require(compiled);

const SRC_TEXT = fs.readFileSync(SRC, 'utf8');
const PAGE_TEXT = fs.readFileSync(PAGE, 'utf8');

/**
 * The boundary assertions below scan CODE, not prose.
 *
 * This module's comments explain at length what it deliberately does not do --
 * they name "password autofill", "DOM", "deep link" and PropStream's host. A
 * scan over the raw file would therefore fail on its own documentation, and the
 * only way to green it would be to delete the explanation. So comments are
 * stripped first and the assertions run against what actually executes.
 */
const SRC_CODE = SRC_TEXT
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Literal call-site count taken from the finished file, never back-filled from a passing run.
 *  29 = url(3) + subjectAddress(9) + handoff(10) + copyAgain(3) + boundary(4).
 *  Counted by enumerating the check( sites in this file, not from a run's output. */
const FLOOR = 29;

let checksRun = 0;
let failures = 0;
const names = new Set();
function check(name, ok, detail) {
  checksRun++;
  names.add(name);
  if (ok) console.log('PASS  ' + name + '  ' + (detail || ''));
  else { failures++; console.log('FAIL  ' + name + '  ' + (detail || '')); }
}

/** Clipboard doubles. `null` is the absent-API state, not a missing test seam. */
function okClipboard() {
  const written = [];
  return { writeText: (t) => { written.push(t); return Promise.resolve(); }, _written: () => written };
}
const rejectingClipboard = { writeText: () => Promise.reject(new Error('NotAllowedError')) };

/** window.open doubles. A blocked popup returns null in Chrome. */
function openSpy(result) {
  const calls = [];
  return {
    fn: (url) => { calls.push(url); if (result instanceof Error) throw result; return result; },
    _calls: () => calls,
  };
}

const ADDR = '4821 SW 12th Ter, Cape Coral, FL 33914';

// ── The URL contract. This is where "no invented deep link" is asserted. ─────

check('url-is-propstream-published-login',
  PROPSTREAM_LOGIN_URL === 'https://login.propstream.com/',
  PROPSTREAM_LOGIN_URL);

/* The whole URL, not just its host. A path, query string or fragment would be
   the undocumented address deep link B7-02 forbids, and would pass a host-only
   assertion silently. */
check('url-carries-no-path-query-or-fragment',
  /^https:\/\/login\.propstream\.com\/$/.test(PROPSTREAM_LOGIN_URL),
  'exact-match against origin + "/"');

check('module-declares-exactly-one-propstream-url',
  (SRC_CODE.match(/propstream\.com/g) || []).length === 1,
  'occurrences in executable code: ' + (SRC_CODE.match(/propstream\.com/g) || []).length);

// ── subjectAddress — completeness is a requirement, not a preference ────────

check('address-complete-with-zip',
  subjectAddress({ address1: '4821 SW 12th Ter', city: 'Cape Coral', state: 'FL', postalCode: '33914' }) === ADDR,
  ADDR);

check('address-complete-without-zip',
  subjectAddress({ address1: '4821 SW 12th Ter', city: 'Cape Coral', state: 'FL', postalCode: '' })
    === '4821 SW 12th Ter, Cape Coral, FL',
  'zip is optional; city + state already narrow the parcel');

check('address-refuses-missing-street',
  subjectAddress({ address1: '', city: 'Cape Coral', state: 'FL', postalCode: '33914' }) === null,
  'null, not a partial');

check('address-refuses-missing-city',
  subjectAddress({ address1: '4821 SW 12th Ter', city: '', state: 'FL', postalCode: '33914' }) === null,
  'a bare street resolves to the wrong county');

check('address-refuses-missing-state',
  subjectAddress({ address1: '4821 SW 12th Ter', city: 'Cape Coral', state: '', postalCode: '33914' }) === null,
  'null, not a partial');

check('address-refuses-whitespace-only',
  subjectAddress({ address1: '   ', city: 'Cape Coral', state: 'FL', postalCode: '33914' }) === null,
  'whitespace is absence');

check('address-refuses-null-parts',
  subjectAddress(null) === null && subjectAddress(undefined) === null,
  'a still-loading contact never yields an address');

check('address-trims-components',
  subjectAddress({ address1: ' 4821 SW 12th Ter ', city: ' Cape Coral ', state: ' FL ', postalCode: ' 33914 ' }) === ADDR,
  'no doubled separators from padded GHL values');

/* The real caller passes a whole ContactRow, not a four-key literal. Extra keys
   must be ignored rather than leaking into the copied string. */
check('address-ignores-unrelated-contact-fields',
  subjectAddress({
    address1: '4821 SW 12th Ter', city: 'Cape Coral', state: 'FL', postalCode: '33914',
    id: 'abc', phone: '+15550100', propertyAddress: 'SOMETHING ELSE', mailingCity: 'Naples',
  }) === ADDR,
  'ContactRow passed whole; only the four address fields are read');

// ── handoffToPropStream — both outcomes, independently ──────────────────────

(async () => {
  {
    const clip = okClipboard();
    const open = openSpy({});
    const r = await handoffToPropStream(ADDR, { clipboard: clip, openWindow: open.fn });
    check('handoff-happy-path',
      r.clipboard === 'copied' && r.url === PROPSTREAM_LOGIN_URL, JSON.stringify(r));
    check('handoff-copies-address-verbatim',
      clip._written().length === 1 && clip._written()[0] === ADDR,
      JSON.stringify(clip._written()));
    check('handoff-opens-login-url-once-and-unmodified',
      open._calls().length === 1 && open._calls()[0] === PROPSTREAM_LOGIN_URL,
      JSON.stringify(open._calls()));
    /* The address must never travel in the URL. If it ever did, that WOULD be
       the invented deep link, however it got there. */
    check('handoff-address-never-enters-the-url',
      !open._calls()[0].includes('4821') && !/12th/i.test(open._calls()[0]),
      open._calls()[0]);
  }

  {
    const open = openSpy({});
    const r = await handoffToPropStream(ADDR, { clipboard: rejectingClipboard, openWindow: open.fn });
    check('handoff-clipboard-denied-still-opens',
      r.clipboard === 'denied' && open._calls().length === 1, JSON.stringify(r));
  }

  {
    const open = openSpy({});
    const r = await handoffToPropStream(ADDR, { clipboard: null, openWindow: open.fn });
    check('handoff-clipboard-absent-still-opens',
      r.clipboard === 'denied' && open._calls().length === 1,
      'no Clipboard API outside a secure context');
  }

  {
    const clip = okClipboard();
    const r = await handoffToPropStream(ADDR, { clipboard: clip, openWindow: openSpy(null).fn });
    check('handoff-falsy-open-return-is-not-reported-as-blocked',
      r.clipboard === 'copied' && !('opened' in r),
      'noopener returns falsy on a tab that opened — see HandoffResult');
  }

  {
    const clip = okClipboard();
    const r = await handoffToPropStream(ADDR, { clipboard: clip, openWindow: openSpy(new Error('blocked')).fn });
    check('handoff-open-throwing-never-propagates',
      r.clipboard === 'copied' && r.address === ADDR, JSON.stringify(r));
  }

  {
    const r = await handoffToPropStream(ADDR, { clipboard: null, openWindow: openSpy(new Error('blocked')).fn });
    check('handoff-both-refused-never-throws',
      r.clipboard === 'denied' && r.address === ADDR && r.url === PROPSTREAM_LOGIN_URL,
      'the helper can always render the address for a manual copy');
  }

  {
    const r = await handoffToPropStream(ADDR, { clipboard: okClipboard(), openWindow: openSpy({}).fn });
    check('handoff-result-carries-address-for-the-helper',
      r.address === ADDR, r.address);
  }

  // ── copyAddressAgain — a retry, and never a second tab ────────────────────

  {
    const clip = okClipboard();
    check('copy-again-succeeds',
      (await copyAddressAgain(ADDR, clip)) === 'copied' && clip._written()[0] === ADDR,
      'same address, no reopen');
  }

  check('copy-again-denied-is-reported',
    (await copyAddressAgain(ADDR, rejectingClipboard)) === 'denied', 'still retryable');

  check('copy-again-with-no-clipboard-api',
    (await copyAddressAgain(ADDR, null)) === 'denied', 'manual copy is the fallback');

  // ── Boundary — the HARD NOs, asserted against source ──────────────────────

  /* copyAddressAgain takes only a clipboard, so it CANNOT open a tab. Asserted
     on arity rather than on behaviour, because the guarantee is structural: a
     retry that reopened PropStream every click is the failure mode. */
  check('copy-again-structurally-cannot-open-a-tab',
    copyAddressAgain.length === 2 && !/openWindow/.test(copyAddressAgain.toString()),
    'arity=' + copyAddressAgain.length);

  /* No API dependency. No request to PropStream is made by IAOS, on anyone's
     behalf, from this seam. */
  check('module-makes-no-network-request',
    !/\bfetch\s*\(|XMLHttpRequest|axios|EventSource|WebSocket/.test(SRC_CODE),
    'no fetch / XHR / socket in src/lib/propstream.ts');

  /* No credential handling and no PropStream DOM automation. The strings a
     login-driving implementation would need are absent, and their absence is
     asserted so a later edit reintroducing one fails here. */
  check('module-handles-no-credentials-and-no-propstream-dom',
    !/password|username|querySelector|dispatchEvent|document\.forms|\.click\s*\(/.test(SRC_CODE),
    'no credential field, no DOM driving');

  /* One seam, one call site. This is what makes a future authorized integration
     a module swap rather than a page rewrite -- so it is asserted, not assumed. */
  check('page-holds-exactly-one-handoff-call-site',
    (PAGE_TEXT.match(/handoffToPropStream\(/g) || []).length === 1,
    'invocations in ContactWorkspace.tsx: ' + (PAGE_TEXT.match(/handoffToPropStream\(/g) || []).length);

  console.log('');
  console.log('checksRun=' + checksRun + ' uniqueNames=' + names.size + ' failures=' + failures + ' floor=' + FLOOR);
  cleanup();
  if (names.size !== checksRun) { console.log('ABORT — name-collision detected'); process.exit(4); }
  if (checksRun !== FLOOR) { console.log('ABORT — expected ' + FLOOR + ' checks, ran ' + checksRun); process.exit(2); }
  if (failures > 0) { console.log('PROPSTREAM HANDOFF RED'); process.exit(1); }
  console.log('OK');
})();
