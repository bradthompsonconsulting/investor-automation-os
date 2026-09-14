/**
 * INV-67 checkbox-marker / broker-model repair -- deterministic proof of
 * `contract-broker-arrangement-model.ts`, the classifier over
 * `RepresentationFact`'s three kinds. Pure function, no I/O.
 *
 * Proves every one of the 6 classification states, most importantly the
 * MANDATORY ARCHITECT CORRECTION: `{kind:"represented", sellerAgent:null,
 * buyerAgent:null}` classifies as `represented_but_empty`, NEVER
 * `no_broker` -- only the explicit `{kind:"none"}` variant may produce
 * `no_broker`. Also proves both blocking states (`intermediary`,
 * `represented_but_empty`) are in `BROKER_ARRANGEMENT_BLOCKING`, each with
 * its own distinct message, and that every non-blocking state is not.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-broker-arrangement-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${MODEL}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  classifyBrokerArrangement,
  isBrokerArrangementBlocking,
  brokerArrangementBlockingReason,
  BROKER_ARRANGEMENT_BLOCKING,
} = require(path.join(TMP, 'contract-broker-arrangement-model.js'));

const FLOOR = 24;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name);
    console.log('      expected: ' + JSON.stringify(expected));
    console.log('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

const AGENT = {
  firmName: 'Firm', licenseNo: 'L1', associateName: 'A', associateLicenseNo: 'L2', email: 'e@x.com', phone: '555',
  address: { kind: 'none' }, teamName: { kind: 'none' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
};

/* ==================================================================== */
/* 1. The 6 classification states                                       */
/* ==================================================================== */

check('{kind:"none"} classifies as no_broker', classifyBrokerArrangement({ kind: 'none' }), 'no_broker');
check(
  'MANDATORY CORRECTION: {kind:"represented", sellerAgent:null, buyerAgent:null} classifies as represented_but_empty, NOT no_broker',
  classifyBrokerArrangement({ kind: 'represented', sellerAgent: null, buyerAgent: null }),
  'represented_but_empty',
);
check(
  '{kind:"represented", sellerAgent:AGENT, buyerAgent:null} classifies as seller_broker_only',
  classifyBrokerArrangement({ kind: 'represented', sellerAgent: AGENT, buyerAgent: null }),
  'seller_broker_only',
);
check(
  '{kind:"represented", sellerAgent:null, buyerAgent:AGENT} classifies as buyer_broker_only',
  classifyBrokerArrangement({ kind: 'represented', sellerAgent: null, buyerAgent: AGENT }),
  'buyer_broker_only',
);
check(
  '{kind:"represented", sellerAgent:AGENT, buyerAgent:AGENT} classifies as separate_brokers_both_sides',
  classifyBrokerArrangement({ kind: 'represented', sellerAgent: AGENT, buyerAgent: AGENT }),
  'separate_brokers_both_sides',
);
check('{kind:"intermediary", brokerFirm:AGENT} classifies as intermediary', classifyBrokerArrangement({ kind: 'intermediary', brokerFirm: AGENT }), 'intermediary');

/* ==================================================================== */
/* 2. Blocking set -- exactly {intermediary, represented_but_empty}      */
/* ==================================================================== */

check('BROKER_ARRANGEMENT_BLOCKING is exactly [intermediary, represented_but_empty]', [...BROKER_ARRANGEMENT_BLOCKING].sort(), ['intermediary', 'represented_but_empty'].sort());

checkTrue('no_broker is NOT blocking', isBrokerArrangementBlocking('no_broker') === false);
checkTrue('seller_broker_only is NOT blocking', isBrokerArrangementBlocking('seller_broker_only') === false);
checkTrue('buyer_broker_only is NOT blocking', isBrokerArrangementBlocking('buyer_broker_only') === false);
checkTrue('separate_brokers_both_sides is NOT blocking', isBrokerArrangementBlocking('separate_brokers_both_sides') === false);
checkTrue('intermediary IS blocking', isBrokerArrangementBlocking('intermediary') === true);
checkTrue('represented_but_empty IS blocking', isBrokerArrangementBlocking('represented_but_empty') === true);

/* ==================================================================== */
/* 3. Distinct, non-null messages for each blocking state; null for the  */
/*    4 non-blocking states                                              */
/* ==================================================================== */

check('brokerArrangementBlockingReason(no_broker) is null', brokerArrangementBlockingReason('no_broker'), null);
check('brokerArrangementBlockingReason(seller_broker_only) is null', brokerArrangementBlockingReason('seller_broker_only'), null);
check('brokerArrangementBlockingReason(buyer_broker_only) is null', brokerArrangementBlockingReason('buyer_broker_only'), null);
check('brokerArrangementBlockingReason(separate_brokers_both_sides) is null', brokerArrangementBlockingReason('separate_brokers_both_sides'), null);

const intermediaryReason = brokerArrangementBlockingReason('intermediary');
const emptyReason = brokerArrangementBlockingReason('represented_but_empty');
checkTrue('intermediary blocking reason is a non-empty string', typeof intermediaryReason === 'string' && intermediaryReason.length > 0);
checkTrue('represented_but_empty blocking reason is a non-empty string', typeof emptyReason === 'string' && emptyReason.length > 0);
checkTrue('the two blocking reasons are DISTINCT strings, never a shared generic message', intermediaryReason !== emptyReason);
checkTrue('intermediary reason names "intermediary"', /intermediary/i.test(intermediaryReason));
checkTrue('represented_but_empty reason explicitly distinguishes itself from "no broker"', /not the same fact as "no broker"/.test(emptyReason));
checkTrue('intermediary reason states V1 is unsupported', /unsupported in V1|not supported/i.test(intermediaryReason));

/* ==================================================================== */
/* 4. Exhaustiveness sanity -- every classification round-trips through  */
/*    isBrokerArrangementBlocking consistently with BROKER_ARRANGEMENT_  */
/*    BLOCKING's own membership                                          */
/* ==================================================================== */

const ALL_CLASSIFICATIONS = ['no_broker', 'seller_broker_only', 'buyer_broker_only', 'separate_brokers_both_sides', 'intermediary', 'represented_but_empty'];
for (const c of ALL_CLASSIFICATIONS) {
  check(`isBrokerArrangementBlocking("${c}") matches BROKER_ARRANGEMENT_BLOCKING membership`, isBrokerArrangementBlocking(c), BROKER_ARRANGEMENT_BLOCKING.includes(c));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
