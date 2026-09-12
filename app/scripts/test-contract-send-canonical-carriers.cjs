/**
 * B9-08 / INV-63 fresh-execution re-validation -- proves the ported/rebuilt
 * e-signature-send implementation touches NEITHER of the two carrier
 * families INV-70 / B9-07A's canonicalization ruling governs:
 *
 *   1. It reads none of the fourteen retired `offer_*` fields (Family 5) --
 *      the accepted price it ultimately transmits comes from B9-03's own
 *      already-approved chain (`deriveInheritedEconomics` ->
 *      `OutcomeSnapshot.currentOffer`, the FROZEN Agreement Reached Note
 *      snapshot -- see `board9-contract-model.ts`'s own header: "Agreement
 *      Reached's accepted price is exactly `OutcomeSnapshot.currentOffer`
 *      ... never a second, competing 'contract price' field"), never any
 *      `contact.offer_price` / `opportunity.offer_price` / sibling.
 *   2. It never reads `opportunity.current_offer` (Family 5's approved,
 *      LIVE Opportunity-owned carrier) directly, either -- that would be a
 *      SECOND, competing price source for a stage that has no independent
 *      pricing concern of its own. Contract Sent transmits the ALREADY
 *      Brad-authorized, ALREADY B9-06-populated document; it must never
 *      re-derive or re-read a price from anywhere at send time. This is
 *      deliberately a stricter check than (1): it is not merely "no
 *      RETIRED field," it is "no price read of any kind, retired or
 *      current, in code introduced by this issue."
 *
 * Static source checks only -- the claim being proven is an ABSENCE of a
 * read, which a mock cannot demonstrate as convincingly as scanning the
 * real, shipped tree. No GHL, no network.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');

const FILES = [
  path.join(APP, 'src', 'lib', 'contract-send-model.ts'),
  path.join(APP, 'src', 'lib', 'contract-send-carriers.ts'),
  path.join(APP, 'netlify', 'functions', 'lib', 'contract-send-guard.ts'),
  path.join(APP, 'netlify', 'functions', 'ghl-contract-send-reserve.ts'),
  path.join(APP, 'netlify', 'functions', 'ghl-contract-send-readback.ts'),
];

const FLOOR = 20;
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

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const LEGACY_OFFER_KEYS = [
  'offer_price', 'offer_mao', 'offer_wholesale_fee', 'offer_repair_total',
  'offer_margin', 'offer_arv', 'offer_date',
];
const LEGACY_OFFER_CAMEL_KEYS = [
  'offerPrice', 'offerMao', 'offerWholesaleFee', 'offerRepairTotal',
  'offerMargin', 'offerArv', 'offerDate', 'saveOfferFields',
];

/* -------------------------------------------------------------- */
/* 1. Zero access to any of the fourteen retired offer_* fields      */
/* -------------------------------------------------------------- */

for (const f of FILES) {
  const rel = path.relative(APP, f);
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const literalHits = LEGACY_OFFER_KEYS.filter((k) => src.includes(k));
  check(`${rel}: no legacy offer_* fieldKey literal outside comments`, literalHits, []);
  const camelHits = LEGACY_OFFER_CAMEL_KEYS.filter((k) => src.includes(k));
  check(`${rel}: no legacy offer_* camelCase identifier (config key, ContactRow field, or saveOfferFields) outside comments`, camelHits, []);
}

/* -------------------------------------------------------------- */
/* 2. ContractWorkspace.tsx's send section touches neither the       */
/*    retired offer_* family NOR opportunity.current_offer directly  */
/* -------------------------------------------------------------- */

{
  const contractTsx = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8');
  const noComments = stripComments(contractTsx);
  // Isolate exactly the send-related block this issue added: from the
  // `existingSend` memo through the end of `handleSend`, so this check
  // cannot accidentally pass merely because some OTHER part of the page
  // (e.g. a different B9 issue's own economics display) happens to be
  // clean.
  const start = noComments.indexOf('const existingSend = useMemo');
  const handleSendStart = noComments.indexOf('async function handleSend(');
  const handleSendEnd = noComments.indexOf('\n  }', handleSendStart);
  if (start === -1 || handleSendStart === -1 || handleSendEnd === -1) {
    check('could isolate the send-related block in ContractWorkspace.tsx (existingSend through end of handleSend)', false, true);
  } else {
    const sendBlock = noComments.slice(start, handleSendEnd);
    const legacyHits = [...LEGACY_OFFER_KEYS, ...LEGACY_OFFER_CAMEL_KEYS].filter((k) => sendBlock.includes(k));
    check('ContractWorkspace.tsx\'s send-related block (existingSend..handleSend) references no legacy offer_* field, key, or writer', legacyHits, []);
    check('ContractWorkspace.tsx\'s send-related block never reads opportunity.current_offer / opportunityFacts.currentOffer -- Send has no independent pricing concern, only B9-06\'s already-populated preview', /currentOffer/.test(sendBlock), false);
    check('ContractWorkspace.tsx\'s send-related block never calls readCurrentOfferFromOpportunity (the Family 5 Opportunity-field reader) -- that carrier belongs to negotiation/hydration, not to Contract Sent', /readCurrentOfferFromOpportunity/.test(sendBlock), false);
  }
}

/* -------------------------------------------------------------- */
/* 3. The accepted price this issue ultimately transmits still       */
/*    traces to the FROZEN Note snapshot, not a live re-read         */
/* -------------------------------------------------------------- */

{
  // contract-send-model.ts must not import anything from
  // current-offer-carrier.ts (the Family 5 live-field reader/writer
  // module) -- it has no business reading or writing that carrier; its
  // only economics input is the ALREADY-B9-03-derived preview/report.
  const modelSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'contract-send-model.ts'), 'utf8');
  check('contract-send-model.ts imports nothing from current-offer-carrier.ts', /from ["']\.\/current-offer-carrier["']/.test(modelSrc), false);
  check('contract-send-model.ts imports nothing from ghl.ts (no direct GHL client access from pure model code, matching every other B9 pure model)', /from ["']\.\/ghl["']/.test(modelSrc), false);
}
{
  const board9Src = fs.readFileSync(path.join(APP, 'src', 'lib', 'board9-contract-model.ts'), 'utf8');
  check('board9-contract-model.ts (B9-03, unmodified by this issue) still names OutcomeSnapshot.currentOffer as the exact accepted-price source -- confirming this issue built on top of, not around, the existing frozen-Note design', /OutcomeSnapshot\.currentOffer/.test(board9Src), true);
}

/* -------------------------------------------------------------- */
/* 4. ghl.ts's proposals namespace is equally clean                  */
/* -------------------------------------------------------------- */

{
  const ghlSrc = stripComments(fs.readFileSync(path.join(APP, 'src', 'lib', 'ghl.ts'), 'utf8'));
  const start = ghlSrc.indexOf('proposals: {');
  const end = ghlSrc.indexOf('\n  conversations: {', start);
  if (start === -1 || end === -1) {
    check('could isolate the proposals namespace in ghl.ts', false, true);
  } else {
    const block = ghlSrc.slice(start, end);
    const legacyHits = [...LEGACY_OFFER_KEYS, ...LEGACY_OFFER_CAMEL_KEYS].filter((k) => block.includes(k));
    check('ghl.ts\'s proposals namespace references no legacy offer_* field, key, or writer', legacyHits, []);
    check('ghl.ts\'s proposals namespace never reads opportunityFacts.currentOffer', /currentOffer/.test(block), false);
  }
}

/* -------------------------------------------------------------- */
/* 5. ghl-config.ts's documentsContracts group is its own, distinct  */
/*    key -- never a repurposed offer_* or currentOffer identifier   */
/* -------------------------------------------------------------- */

{
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  const groupStart = configSrc.indexOf('documentsContracts: {');
  const groupEnd = configSrc.indexOf('\n  }', groupStart);
  const interfaceBlock = configSrc.slice(groupStart, groupEnd);
  const legacyHits = [...LEGACY_OFFER_KEYS, ...LEGACY_OFFER_CAMEL_KEYS].filter((k) => interfaceBlock.includes(k));
  check('ghl-config.ts\'s documentsContracts interface block references no legacy offer_* identifier', legacyHits, []);
  check('documentsContracts.approvedTestContactId is a distinct config key from opportunityFacts.currentOffer and every legacy offer_* id', /approvedTestContactId: string;/.test(configSrc), true);
}

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) {
  console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
  process.exit(2);
}
if (failures) { console.error('FAILED'); process.exit(1); }
console.log('OK');
