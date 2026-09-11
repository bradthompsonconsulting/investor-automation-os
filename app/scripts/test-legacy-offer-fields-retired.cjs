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
 * claimed no READS, and Phase 3's dependency audit found one genuine,
 * intentional exception: `contact.offer_price` (`fields.offerPrice`) IS
 * still read, server-side, by `netlify/functions/lib/contact-parse.ts`,
 * and consumed by `Dashboard.tsx`'s "Offers to review" tile. This is NOT
 * a stray leftover to clean up -- it is a real, live, documented feature
 * (detecting a saved-but-unsent MAO offer) that happens to be built on
 * one of the fourteen fields this family's WRITER was retired from. Its
 * existence is exactly why `contact.offer_price` fails Phase 3's "zero
 * live application readers" deletion gate while the other thirteen
 * `offer_*` fields do not -- see
 * `docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md`'s Phase 3 section.
 * Pinned here as its own section so a future session cannot assume this
 * field is fully dead and eligible for deletion merely because its WRITER
 * (proven above) is gone.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(APP, 'src', 'pages');
const APP_TSX = path.join(APP, 'src', 'App.tsx');
const GHL = path.join(APP, 'src', 'lib', 'ghl.ts');
const CONTACT_PARSE = path.join(APP, 'netlify', 'functions', 'lib', 'contact-parse.ts');
const DASHBOARD = path.join(APP, 'src', 'pages', 'Dashboard.tsx');

const FLOOR = 14;
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
/* 9. contact.offer_price's ONE genuine live reader -- pinned, not   */
/*    a regression to fix (INV-70 / B9-07A Phase 3)                 */
/* -------------------------------------------------------------- */

{
  const contactParseSrc = fs.readFileSync(CONTACT_PARSE, 'utf8');
  check('contact-parse.ts still resolves OFFER_PRICE_ID from fields.offerPrice',
    /OFFER_PRICE_ID\s*=\s*FIELDS\.offerPrice/.test(contactParseSrc), true);
  check('contact-parse.ts still maps offerPrice onto the parsed ContactRow (read-only, never written here)',
    /offerPrice:\s*cfValue\(cf, OFFER_PRICE_ID\)/.test(contactParseSrc), true);
}
{
  const dashboardSrc = fs.readFileSync(DASHBOARD, 'utf8');
  check('Dashboard.tsx still consumes c.offerPrice for its "Offers to review" tile',
    /c\.offerPrice\s*!=\s*null/.test(dashboardSrc), true);
}
{
  // The other thirteen offer_* fields have no equivalent -- fields.offerPrice
  // is the ONLY one of the fourteen with a config key at all, which is
  // exactly why it is the only one with a live reader to pin.
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  const otherOfferKeys = ['offerMao', 'offerWholesaleFee', 'offerRepairTotal', 'offerMargin', 'offerArv', 'offerDate'];
  check('no OTHER offer_* stem has ever been promoted to a named config key (offerPrice remains the sole exception)',
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
