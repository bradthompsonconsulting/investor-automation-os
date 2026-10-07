/**
 * B15-07 / Pass 1 F47 — Calendars shows an operator sentence, not GHL's raw
 * 401 JSON, when GHL refuses the calendar read.
 *
 * Offline. Compiles the real ghl-calendar-events function, replaces ONLY the
 * read-session gate with a pass-through stub (the gate is covered by its own
 * tests), and drives the handler with a mocked GHL fetch. No network, no
 * secrets: the token is a dummy string and fetch never leaves the process.
 * The page wiring is checked by source text, following the repository's
 * convention for UI (see test-seller-call-workspace-wiring.cjs).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-calendar-unavailable-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'netlify/functions/ghl-calendar-events.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--skipLibCheck', '--esModuleInterop',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('tsc failed');
  process.exit(10);
}

// Stub the read-session gate only.
fs.writeFileSync(path.join(TMP, 'netlify/functions/lib/app-read-auth.js'),
  'exports.readAuthRefusal = () => null;\n');

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

process.env.IAOS_GHL_TOKEN_V2 = 'dummy-offline-token';
process.env.IAOS_ENV = 'test';
const mod = require(path.join(TMP, 'netlify/functions/ghl-calendar-events.js'));

function mockGhl({ calendarsStatus = 200, eventsStatus = 200 }) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/calendars/events?')) {
      return { ok: eventsStatus < 400, status: eventsStatus,
        json: async () => eventsStatus < 400 ? { events: [] } : { statusCode: eventsStatus, message: 'The token is not authorized for this scope.' } };
    }
    if (u.includes('/calendars/?')) {
      return { ok: calendarsStatus < 400, status: calendarsStatus,
        json: async () => calendarsStatus < 400 ? { calendars: [{ id: 'cal1', name: 'Seller Calls' }] } : { statusCode: calendarsStatus, message: 'The token is not authorized for this scope.' } };
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}
const get = () => mod.handler({ httpMethod: 'GET', queryStringParameters: { startTime: '1', endTime: '2' }, headers: {} });

(async () => {
  const origError = console.error;
  console.error = () => {}; // the handler logs failures; keep test output literal

  check('the response code constant is the string the page matches', mod.CALENDAR_ACCESS_DENIED, 'ghl_calendar_access_denied');

  for (const status of [401, 403]) {
    mockGhl({ calendarsStatus: status });
    const r = await get();
    const body = JSON.parse(r.body);
    check(`GHL ${status} on GET /calendars/ -> 502 with the access-denied code`, [r.statusCode, body.code], [502, 'ghl_calendar_access_denied']);
    check(`GHL ${status} keeps GHL's text as detail`, /not authorized for this scope/.test(body.error), true);
  }

  mockGhl({ eventsStatus: 401 });
  {
    const r = await get();
    check('GHL 401 on the per-calendar events read -> 502 with the access-denied code', [r.statusCode, JSON.parse(r.body).code], [502, 'ghl_calendar_access_denied']);
  }

  mockGhl({ calendarsStatus: 500 });
  {
    const r = await get();
    const body = JSON.parse(r.body);
    check('any other GHL failure keeps the previous 500 shape, with no access-denied code', [r.statusCode, body.code], [500, undefined]);
  }

  mockGhl({});
  {
    const r = await get();
    check('a successful read is unchanged (200, events array)', [r.statusCode, Array.isArray(JSON.parse(r.body).events)], [200, true]);
  }

  console.error = origError;

  // ── Page wiring (source text) ────────────────────────────────────────────
  const page = fs.readFileSync(path.join(APP, 'src/pages/Calendars.tsx'), 'utf8');
  const client = fs.readFileSync(path.join(APP, 'src/lib/ghl.ts'), 'utf8');
  check('client carries the server code on the thrown error',
    /throw Object\.assign\(new Error\(`ghl-calendar-events → \$\{res\.status\}: \$\{text\}`\), \{ code \}\)/.test(client), true);
  check('page recognises the access-denied code', /e\.code === "ghl_calendar_access_denied"/.test(page), true);
  check('page no longer prints the raw error as the message', /Failed to load appointments: \{error\}/.test(page), false);
  check('page explains a permission refusal in operator words',
    page.includes("Appointments can't be shown here: GHL refused IAOS access to calendars for this account."), true);
  check('page keeps the raw text only as collapsed technical detail',
    /<summary[^>]*>Technical detail<\/summary>[\s\S]{0,200}\{error\.detail\}/.test(page), true);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nB15-07 calendar unavailable state: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error(e);
  process.exit(1);
});
