/**
 * INV-67 Phase 1 Jess re-gate correction (this session) -- direct, mocked-
 * fetch proof of `ghl.ts`'s `syncContractProjectionFields`'s NEW optional
 * `sellerCount` argument: the ONE atomic PUT + ONE atomic readback the 112
 * TREC projection fields already go through, now optionally also carrying
 * the Contract Seller Count transport field's own write.
 *
 * This is the first test in this repository to directly invoke `ghl.ts`
 * (mocking `global.fetch` and bootstrapping `setRuntimeConfig`) rather than
 * only statically scanning its source -- necessary here because the claim
 * "a Seller Count write/readback failure blocks Requested, without
 * weakening the 112 TREC fields' own guarantees" is a RUNTIME behavior
 * (the returned `ok`/`landed` booleans), not something regex over source
 * text can prove. Mirrors `test-contract-send-reserve.cjs`'s own
 * established "mock fetch + mutate the live TEST config before requiring
 * the module under test" pattern.
 *
 * ZERO real network calls -- `global.fetch` is fully mocked for every
 * scenario below; no GHL credential is read, no GHL environment is
 * contacted.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-ghl-seller-count-transport-write-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const SOURCES = [
  path.join(APP, 'shared', 'ghl-config.ts'),
  path.join(APP, 'src', 'lib', 'underwriting', 'resolver-types.ts'),
  path.join(APP, 'src', 'lib', 'ghl.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --rootDir "' + APP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const FLOOR = 16;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

const CONFIG_JS = path.join(TMP, 'shared', 'ghl-config.js');
const GHL_JS = path.join(TMP, 'src', 'lib', 'ghl.js');

const configModule = require(CONFIG_JS);

const REAL_TREC_KEY = 'identity.propertyStreetAddress';
const FAKE_TREC_FIELD_ID = 'FAKE-TREC-FIELD-ID-1';
const FAKE_SELLER_COUNT_FIELD_ID = 'FAKE-SELLER-COUNT-FIELD-ID';
const FAKE_CURRENT_OFFER_FIELD_ID = configModule.getConfig('test').opportunityFacts.currentOffer;

// Build a runtime payload from the REAL, currently-committed Test config,
// then mutate ONLY the two fields this test needs to be non-sentinel --
// exactly mirroring test-contract-send-reserve.cjs's own "mutate the
// projected payload, never the committed file" convention.
const payload = configModule.projectRuntimeConfig(configModule.getConfig('test'));
payload.contractProjectionFields = { ...payload.contractProjectionFields, [REAL_TREC_KEY]: FAKE_TREC_FIELD_ID };
payload.contractSellerCountField = FAKE_SELLER_COUNT_FIELD_ID;
configModule.setRuntimeConfig(payload);

// ghl.ts reads getRuntimeConfig() ONCE, at ITS OWN module-load time -- so
// setRuntimeConfig() above MUST run before this require().
const { ghl } = require(GHL_JS);

function makeMockFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
    if (i >= responses.length) throw new Error('mock fetch called more times than responses were queued');
    const r = responses[i++];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
  };
  fn.calls = calls;
  return fn;
}

const OPP_ID = 'OPP-1';
const ONE_ENTRY = [{ key: REAL_TREC_KEY, text: '123 Main St' }];

/* ==================================================================== */
/* 1. sellerCount omitted -- EXACT prior behavior, unaffected             */
/* ==================================================================== */

(async () => {
  global.fetch = makeMockFetch([
    { status: 200, body: '{}' },
    { status: 200, body: JSON.stringify({ opportunity: { customFields: [{ id: FAKE_TREC_FIELD_ID, fieldValue: '123 Main St' }, { id: FAKE_CURRENT_OFFER_FIELD_ID, fieldValue: 275000 }] } }) },
  ]);
  const r = await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY);
  checkTrue('sellerCount omitted: ok is true on a clean TREC-only write/readback', r.ok === true);
  check('sellerCount omitted: result.sellerCount is null', r.sellerCount, null);
  checkTrue('sellerCount omitted: exactly one customField sent (no Seller Count entry added)', global.fetch.calls[0].body.customFields.length === 1);

  /* ==================================================================== */
  /* 2. sellerCount provided, exact readback match -- folded into the SAME */
  /*    PUT + SAME readback, ok reflects BOTH landing                      */
  /* ==================================================================== */

  global.fetch = makeMockFetch([
    { status: 200, body: '{}' },
    {
      status: 200,
      body: JSON.stringify({
        opportunity: {
          customFields: [
            { id: FAKE_TREC_FIELD_ID, fieldValue: '123 Main St' },
            { id: FAKE_SELLER_COUNT_FIELD_ID, fieldValue: 'One Seller' },
            { id: FAKE_CURRENT_OFFER_FIELD_ID, fieldValue: 275000 },
          ],
        },
      }),
    },
  ]);
  const r2 = await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: FAKE_SELLER_COUNT_FIELD_ID, text: 'One Seller' });
  checkTrue('configured field + exact readback match: overall ok is true -- the seller gate MAY pass', r2.ok === true);
  check('configured field + exact readback match: sellerCount.sent', r2.sellerCount.sent, 'One Seller');
  check('configured field + exact readback match: sellerCount.observed', r2.sellerCount.observed, 'One Seller');
  checkTrue('configured field + exact readback match: sellerCount.landed is true', r2.sellerCount.landed === true);
  checkTrue('exactly ONE atomic PUT + ONE atomic readback -- never a second, separate write call for Seller Count', global.fetch.calls.length === 2);
  checkTrue('the Seller Count field is included in the SAME PUT body as the TREC entries', global.fetch.calls[0].body.customFields.some((f) => f.id === FAKE_SELLER_COUNT_FIELD_ID));

  /* ==================================================================== */
  /* 3. sellerCount provided, readback MISMATCH -- overall ok is false,   */
  /*    even though every TREC entry landed -- Requested becomes           */
  /*    impossible without weakening the TREC fields' own guarantee        */
  /* ==================================================================== */

  global.fetch = makeMockFetch([
    { status: 200, body: '{}' },
    {
      status: 200,
      body: JSON.stringify({
        opportunity: {
          customFields: [
            { id: FAKE_TREC_FIELD_ID, fieldValue: '123 Main St' },
            { id: FAKE_SELLER_COUNT_FIELD_ID, fieldValue: 'Two Sellers' }, // sent "One Seller"
            { id: FAKE_CURRENT_OFFER_FIELD_ID, fieldValue: 275000 },
          ],
        },
      }),
    },
  ]);
  const r3 = await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: FAKE_SELLER_COUNT_FIELD_ID, text: 'One Seller' });
  checkTrue('readback mismatch: sellerCount.landed is false', r3.sellerCount.landed === false);
  checkTrue('readback mismatch: overall ok is false -- Requested is impossible even though every TREC entry landed', r3.ok === false);
  checkTrue('readback mismatch: the TREC entry itself still independently reports landed:true -- its own guarantee is unweakened', r3.entries[0].landed === true);

  /* ==================================================================== */
  /* 4. Seller Count field id missing/sentinel -- refuses BEFORE any       */
  /*    network call, exactly like the 112 TREC fields already refuse      */
  /* ==================================================================== */

  global.fetch = makeMockFetch([]);
  let threwSentinel = false;
  try {
    await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED', text: 'One Seller' });
  } catch (e) {
    threwSentinel = /no configured id for the Seller Count field/.test(e.message);
  }
  checkTrue('a sentinel Seller Count field id refuses before any network call', threwSentinel && global.fetch.calls.length === 0);

  let threwBlank = false;
  try {
    await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: '', text: 'One Seller' });
  } catch (e) {
    threwBlank = /no configured id for the Seller Count field/.test(e.message);
  }
  checkTrue('a blank Seller Count field id refuses before any network call', threwBlank && global.fetch.calls.length === 0);

  /* ==================================================================== */
  /* 5. Seller Count field id collides with a projected TREC field id --   */
  /*    refuses before any network call                                    */
  /* ==================================================================== */

  global.fetch = makeMockFetch([]);
  let threwCollision = false;
  try {
    await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: FAKE_TREC_FIELD_ID, text: 'One Seller' });
  } catch (e) {
    threwCollision = /collides with a projected TREC field id/.test(e.message);
  }
  checkTrue('a Seller Count field id colliding with a TREC field id refuses before any network call', threwCollision && global.fetch.calls.length === 0);

  /* ==================================================================== */
  /* 6. A write failure (non-ok PUT) -- Requested impossible, no readback  */
  /*    is even attempted                                                  */
  /* ==================================================================== */

  global.fetch = makeMockFetch([{ status: 500, body: 'server error' }]);
  let threwPutFailure = false;
  try {
    await ghl.opportunities.syncContractProjectionFields(OPP_ID, ONE_ENTRY, { fieldId: FAKE_SELLER_COUNT_FIELD_ID, text: 'One Seller' });
  } catch (e) {
    threwPutFailure = /PUT/.test(e.message);
  }
  checkTrue('a failed PUT throws (surfaced to the caller, never silently "ok") and never attempts the readback', threwPutFailure && global.fetch.calls.length === 1);

  cleanup();
  console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
  if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
  if (failures > 0) process.exit(1);
  console.log('ALL PASS');
})().catch((e) => {
  console.error('ABORT (uncaught):', e);
  cleanup();
  process.exit(1);
});
