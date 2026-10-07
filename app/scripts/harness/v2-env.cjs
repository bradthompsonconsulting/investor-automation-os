/**
 * Storage correction -- the shared offline v2 environment for endpoint suites.
 *
 *  - the wire harness (real @netlify/blobs over an in-memory HTTP service) as
 *    the adapter's transport, with NETLIFY_BLOBS_CONTEXT pointing at it;
 *  - non-blob requests go to `ghlFetch` (each suite installs its GHL fake);
 *  - fixtures seed the authorization records a released v2 deployment has:
 *    a completed import owner + cutover record, a G5 table, and an OPEN
 *    admission record activated for the fixture deploy (fixtures only; the
 *    real records come from the separately authorized cutover and
 *    activation steps);
 *  - `invoke(mod, event)` calls a modern-runtime default export with a Request
 *    built from a Lambda-style event, and returns {statusCode, headers, body}.
 */
'use strict';
require('./ts-loader.cjs');
const { createWire } = require('./blob-wire.cjs');

const DEPLOY_ID = '6ac5f00d0000000000000001';
const OTHER_DEPLOY_ID = '6ac5f00d0000000000000002';
const ACTIVATION_ID = 'v2-act-fixture-0001';
const S = 'iaos-ownership-v2';

function setupV2Env(options = {}) {
  const hooks = { ghlFetch: null };
  const wire = createWire({ ownershipStores: ['site:' + S], next: (url, init) => {
    if (!hooks.ghlFetch) throw new Error('v2-env: no GHL fake installed for ' + url);
    return hooks.ghlFetch(url, init);
  } });
  process.env.NETLIFY_BLOBS_CONTEXT = wire.context();
  process.env.IAOS_ENV = process.env.IAOS_ENV || 'test';
  process.env.IAOS_GHL_TOKEN_V2 = 'offline-fixture-v2';
  delete process.env.GHL_PRIVATE_API_KEY;
  process.env.IAOS_ATTEST_SECRET_V2 = 'offline-attest-secret-fixture-0123456789abcdef';
  process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
  process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = options.origin || 'https://proof.example.invalid';
  process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
  process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
  process.env.IAOS_APP_READ_GOOGLE_CLIENT_ID = 'offline-read-client';
  process.env.IAOS_APP_READ_SESSION_SECRET = 'offline-read-fixture-only-not-a-real-secret';
  process.env.IAOS_APP_READ_BRAD_EMAILS = 'brad@example.invalid';
  process.env.IAOS_APP_READ_ALLOWED_ORIGIN = options.origin || 'https://proof.example.invalid';
  delete process.env.IAOS_V2_WRITES;
  global.fetch = wire.fetch;
  const vs = require('../../netlify/functions/lib/verified-store.ts');
  vs.transport.fetch = wire.fetch;
  const g5 = require('../../netlify/functions/lib/g5-gate.ts');
  const auth = require('../../netlify/functions/lib/app-write-auth.ts');
  const readAuth = require('../../netlify/functions/lib/app-read-auth.ts');

  const table = options.g5Table || { v: 1, entries: [], narrowings: ['fixture-n2'], updatedAt: '2026-10-07T00:00:00.000Z' };
  function seedAuthz(over = {}) {
    wire.seed(S, 'authz/import/owner', { v: 1, runId: 'run-fixture', ownerHash: 'h', startedAt: '2026-10-07T00:00:00.000Z', state: 'complete', manifestDigest: 'm'.repeat(64) });
    wire.seed(S, 'authz/cutover/v2', { v: 1, importComplete: true, ownerRunId: 'run-fixture', manifestDigest: 'm'.repeat(64), T_r: '2026-10-07T00:00:00.000Z', drainUntil: '2026-10-07T00:30:00.000Z', createdAt: '2026-10-07T00:31:00.000Z' });
    const t = over.table || table;
    wire.seed(S, 'authz/g5/table', t);
    wire.seed(S, 'authz/admission', {
      v: 3, epoch: 1, activationId: ACTIVATION_ID, deployId: DEPLOY_ID, state: 'open', g5Digest: g5.tableDigest(t), g5: t,
      activatedAt: '2026-10-07T01:00:00.000Z', activationMark: 'fixture', tickets: {}, publication: null, ...(over.admission || {}),
    });
  }
  function reset() { wire.clear(); seedAuthz(); }
  reset();

  const deployContext = (over = {}) => ({ deploy: { id: DEPLOY_ID, context: 'production', published: true, ...over }, site: { id: '00000000-0000-0000-0000-000000000000' } });
  /** Calls a modern-runtime handler module with a Lambda-style event. */
  async function invoke(mod, event, ctx = deployContext()) {
    const handler = mod.default || mod;
    const method = event.httpMethod || 'GET';
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(event.queryStringParameters || {})) qs.append(k, v);
    const fn = event.fn || 'fn';
    const url = `https://iaos-app-test.netlify.app/.netlify/functions/${fn}${[...qs].length ? '?' + qs.toString() : ''}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(event.headers || {})) if (v !== undefined && v !== null) headers.append(k, v);
    if (event.body !== undefined && event.body !== null && !headers.has('content-type') && event.json !== false) headers.set('content-type', 'application/json');
    const init = { method, headers };
    if (event.body !== undefined && event.body !== null && method !== 'GET' && method !== 'HEAD') init.body = event.body;
    const res = await handler(new Request(url, init), ctx);
    const outHeaders = {};
    res.headers.forEach((v, k) => { outHeaders[k] = v; });
    return { statusCode: res.status, headers: outHeaders, body: await res.text() };
  }
  const writeHeaders = (extra = {}) => ({ origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}`, 'x-iaos-activation': ACTIVATION_ID, ...extra });
  const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
  const admission = () => wire.json(S, 'authz/admission');
  return { wire, hooks, S, DEPLOY_ID, OTHER_DEPLOY_ID, ACTIVATION_ID, reset, seedAuthz, invoke, deployContext, writeHeaders, readCookie, admission, auth, readAuth, g5 };
}
module.exports = { setupV2Env, DEPLOY_ID, OTHER_DEPLOY_ID, ACTIVATION_ID };
