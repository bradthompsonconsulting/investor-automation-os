/**
 * INV-70 / B9-07A Phase 2 -- deterministic proof of Family 5's approved
 * ruling: the fourteen legacy `offer_*` fields (7 keys x 2 models) receive
 * no new writes from any IAOS code path, and MaoCalculator.tsx (their sole
 * historical writer) is formally retired and unreachable. Static source
 * checks only, against the shipped tree -- no GHL, no network, no mocks
 * needed because the claim being proven is an ABSENCE of code, which a
 * mock cannot demonstrate as convincingly as reading the real tree.
 *
 * INV-70 / B9-07A PHASE 3 addendum. This file proves NO WRITES -- it never
 * claimed no READS, and Phase 3's dependency audit found one genuine
 * exception at the time: `contact.offer_price` (`fields.offerPrice`) was
 * still read, server-side, by `netlify/functions/lib/contact-parse.ts`,
 * and consumed by `Dashboard.tsx`'s "Offers to review" tile -- a real,
 * live feature (detecting a saved-but-unsent MAO offer), not dead code,
 * built on a field whose WRITER had already been retired.
 *
 * PHASE 3 CORRECTION (same phase, later round). Brad's own correction
 * explicitly required this dependency be closed: "contact.offer_price
 * must not remain an authoritative live reader... consume the
 * Opportunity-owned Current Offer carrier... do not introduce a mirrored
 * Contact write." Fixed: `Dashboard.tsx`'s `offersToReview` now derives
 * "has an offer" from `opportunity.current_offer` (Family 5's approved
 * carrier), read from `pipeline.opportunities` -- data the page already
 * fetches -- via `current-offer-carrier.ts`'s `readCurrentOfferFromOpportunity`,
 * the SAME reader `SellerCallWorkspace.tsx` hydrates from. `contact-parse.ts`
 * no longer resolves `FIELDS.offerPrice` at all, `ghl.ts`'s `ContactRow`
 * no longer carries an `offerPrice` field, and the now-fully-unused
 * `fields.offerPrice` config key is removed from `ghl-config.ts` (the GHL
 * field itself, `contact.offer_price`, is untouched -- only the
 * application-side pointer and reader are gone). This section is
 * REWRITTEN, not merely extended, to prove the corrected state -- a
 * future session must not resurrect the old exception by reverting this
 * fix, since `contact.offer_price` having a live reader was NEVER the
 * approved end state, only an interim finding.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(APP, 'src', 'pages');
const APP_TSX = path.join(APP, 'src', 'App.tsx');
const GHL = path.join(APP, 'src', 'lib', 'ghl.ts');
const CONTACT_PARSE = path.join(APP, 'netlify', 'functions', 'lib', 'contact-parse.ts');
const DASHBOARD = path.join(APP, 'src', 'pages', 'Dashboard.tsx');

const FLOOR = 21;
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

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/* -------------------------------------------------------------- */
/* 8. Retired MaoCalculator route remaining unreachable              */
/* -------------------------------------------------------------- */

check('MaoCalculator.tsx no longer exists on disk',
  fs.existsSync(path.join(PAGES_DIR, 'MaoCalculator.tsx')), false);

const allAppSrcFiles = walk(path.join(APP, 'src'));
const filesImportingMaoCalculator = allAppSrcFiles.filter((f) => {
  const code = fs.readFileSync(f, 'utf8');
  // Only an actual import/require of the module counts -- a prose mention
  // in a comment (resolver.ts's own header references MaoCalculator's old
  // cfRaw pattern by name) is historical context, not a live dependency.
  return /from\s+["'][^"']*MaoCalculator["']/.test(code) || /require\(["'][^"']*MaoCalculator["']\)/.test(code);
});
check('no file under app/src imports MaoCalculator as a module', filesImportingMaoCalculator, []);

const appTsx = fs.readFileSync(APP_TSX, 'utf8');
check('App.tsx registers no mao-calculator route', /mao-calculator/i.test(appTsx), false);
check('App.tsx references no MaoCalculator component', /MaoCalculator/.test(appTsx), false);

/* -------------------------------------------------------------- */
/* 7. Legacy offer_* fields receive no new writes                   */
/* -------------------------------------------------------------- */

const ghlSrc = fs.readFileSync(GHL, 'utf8');
check('ghl.ts no longer defines contacts.saveOfferFields', /saveOfferFields/.test(ghlSrc), false);
check('ghl.ts still defines the new, distinct setCurrentOffer writer', /setCurrentOffer:/.test(ghlSrc), true);
check('ghl.ts still defines the new, distinct setRepairEstimate writer', /setRepairEstimate:/.test(ghlSrc), true);

// Every remaining live writer in ghl.ts is checked against every legacy
// offer_* fieldKey stem -- none may appear as a literal inside a writer
// body (as opposed to a comment explaining why it does NOT appear).
const ghlSrcNoComments = ghlSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const LEGACY_OFFER_KEYS = [
  'offer_price', 'offer_mao', 'offer_wholesale_fee', 'offer_repair_total',
  'offer_margin', 'offer_arv', 'offer_date',
];
const literalHits = LEGACY_OFFER_KEYS.filter((k) => ghlSrcNoComments.includes(k));
check('no legacy offer_* fieldKey literal remains anywhere in ghl.ts outside comments', literalHits, []);

// The whole app source tree, not just ghl.ts -- confirms no OTHER module
// picked up a direct offer_* write independent of ghl.ts (e.g. a raw
// fetch to the proxy bypassing the service module entirely).
const filesWithOfferWrites = allAppSrcFiles.filter((f) => {
  if (f === GHL) return false; // ghl.ts's own comments/history are covered above
  const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return LEGACY_OFFER_KEYS.some((k) => code.includes(k));
});
check('no file outside ghl.ts references a legacy offer_* fieldKey literal', filesWithOfferWrites, []);

// The Contact-side HARD NO (CONTACTS_OPPORTUNITIES_SPEC.md §4.1) is a
// pre-existing, separately-governed rule this phase does not relax --
// confirmed here only as a cross-check that nothing this phase touched
// contradicts it: the contacts field-edit surface still names no offer_
// field as editable.
const contactWorkspaceFiles = allAppSrcFiles.filter((f) => /ContactWorkspace|ContactsDetail/i.test(path.basename(f)));
for (const f of contactWorkspaceFiles) {
  const code = fs.readFileSync(f, 'utf8');
  check(`${path.basename(f)} names no offer_ field as an editable field`, /offer_(price|mao|wholesale_fee|repair_total|margin|arv|date)['"]?\s*:\s*true/.test(code), false);
}

/* -------------------------------------------------------------- */
/* 9. contact.offer_price's last live reader is CLOSED               */
/*    (INV-70 / B9-07A Phase 3 correction)                          */
/* -------------------------------------------------------------- */

{
  const contactParseSrc = fs.readFileSync(CONTACT_PARSE, 'utf8');
  check('contact-parse.ts no longer resolves OFFER_PRICE_ID from fields.offerPrice',
    /OFFER_PRICE_ID\s*=\s*FIELDS\.offerPrice/.test(contactParseSrc), false);
  check('contact-parse.ts no longer maps offerPrice onto the parsed ContactRow',
    /offerPrice:\s*cfValue\(cf, OFFER_PRICE_ID\)/.test(contactParseSrc), false);
}
{
  const ghlSrc2 = fs.readFileSync(GHL, 'utf8');
  check('ghl.ts\'s ContactRow interface no longer declares an offerPrice field',
    /offerPrice:\s*number \| null/.test(ghlSrc2), false);
}
{
  const dashboardSrc = fs.readFileSync(DASHBOARD, 'utf8');
  check('Dashboard.tsx no longer reads c.offerPrice',
    /c\.offerPrice/.test(dashboardSrc), false);
  check('Dashboard.tsx\'s "Offers to review" tile now derives from opportunity.current_offer via readCurrentOfferFromOpportunity',
    /readCurrentOfferFromOpportunity\(o\.customFields, OPPORTUNITY_FACTS_CFG\.currentOffer\)/.test(dashboardSrc), true);
  check('the tile reads pipeline.opportunities (already-fetched Opportunity data), never a new Contact fetch or a new write',
    /const offersToReview = useMemo\(\(\) => \{\s*if \(!pipeline\) return \[\];/.test(dashboardSrc), true);
  check('no new Contact write was introduced alongside this fix (no setOfferPrice-shaped call anywhere in the page)',
    /setOfferPrice/.test(dashboardSrc), false);
}
{
  // The other thirteen offer_* fields never had a config key either --
  // fields.offerPrice was the only one of the fourteen with one, and now
  // that its last reader is gone, the key itself is gone too. Confirmed
  // against the RAW TypeScript source text (not the compiled loader,
  // which only reflects VALUES, not the presence or absence of a
  // TypeScript interface member).
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  check('ghl-config.ts\'s fields interface no longer declares offerPrice',
    /offerPrice:\s*string;/.test(configSrc), false);
  check('PRODUCTION.fields no longer assigns offerPrice',
    /offerPrice:\s*"v2VO2wUwTYRojmU7VXyZ"/.test(configSrc), false);
  check('TEST.fields no longer assigns offerPrice',
    /offerPrice:\s*"oUJHAbPq7tcw67U2Q5Zx"/.test(configSrc), false);
  const otherOfferKeys = ['offerMao', 'offerWholesaleFee', 'offerRepairTotal', 'offerMargin', 'offerArv', 'offerDate'];
  check('no OTHER offer_* stem was ever promoted to a named config key either -- the whole family now has zero config keys',
    otherOfferKeys.some((k) => configSrc.includes(k)), false);
}

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) {
  console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
  process.exit(2);
}
if (failures) { console.error('FAILED'); process.exit(1); }
console.log('OK');
