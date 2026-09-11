/**
 * INV-70 / B9-07A Phase 2 correction round 3 -- repository-wide proof that
 * NO application writer targets `contact.estimated_repairs` anywhere.
 * Family 3's approved ruling makes it a read-only legacy fallback/
 * migration input only. Static source checks against the shipped tree --
 * no GHL, no network, no mocks needed, because the claim is an ABSENCE of
 * code, which a mock cannot demonstrate as convincingly as reading the
 * real tree (same reasoning as test-legacy-offer-fields-retired.cjs).
 *
 * THE MASTER PROOF is the comment-stripped, whole-`app/src`-tree scan for
 * the literal identifier `setEstimatedRepairs`: the method that WAS the
 * only writer no longer exists anywhere as code (only as historical prose
 * in comments, which this scan strips before matching) -- so there is
 * nothing left to call, repository-wide, not merely at the three call
 * sites this round happened to look at. The per-location checks below are
 * defense-in-depth, naming exactly where each of the three removals
 * landed, for a reader who wants the specific evidence rather than only
 * the aggregate guarantee.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const SRC = path.join(APP, 'src');
const GHL = path.join(SRC, 'lib', 'ghl.ts');
const PERSIST = path.join(SRC, 'lib', 'repair-estimation', 'persist.ts');
const DEAL_CALC = path.join(SRC, 'pages', 'DealCalculator.tsx');
const CONTACT_WORKSPACE = path.join(SRC, 'pages', 'ContactWorkspace.tsx');
const UNDERWRITING_WORKSPACE = path.join(SRC, 'pages', 'UnderwritingWorkspace.tsx');

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

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/* -------------------------------------------------------------- */
/* THE MASTER PROOF -- repository-wide, comment-stripped            */
/* -------------------------------------------------------------- */

const allSrcFiles = walk(SRC);
const filesStillReferencingTheIdentifier = allSrcFiles
  .map((f) => ({ f, code: stripComments(fs.readFileSync(f, 'utf8')) }))
  .filter(({ code }) => /setEstimatedRepairs/.test(code))
  .map(({ f }) => path.relative(APP, f));

check('MASTER PROOF: no file under app/src references the identifier setEstimatedRepairs outside a comment -- the method does not exist, so nothing can call it, repository-wide', filesStillReferencingTheIdentifier, []);

/* -------------------------------------------------------------- */
/* Defense in depth -- exactly where each removal landed             */
/* -------------------------------------------------------------- */

const ghlSrc = fs.readFileSync(GHL, 'utf8');
check('ghl.ts no longer defines contacts.setEstimatedRepairs', /setEstimatedRepairs:\s*\(/.test(stripComments(ghlSrc)), false);
check('ghl.ts still defines the authoritative Opportunity writer, setRepairEstimate', /setRepairEstimate:\s*async/.test(ghlSrc), true);
check('ghl.ts still defines _putMonetaryField, still used by the remaining setARV', /_putMonetaryField:\s*\(/.test(ghlSrc), true);

const persistSrc = fs.readFileSync(PERSIST, 'utf8');
check('persist.ts no longer exports persistApprovedRepairTotal (the Contact-targeted function)', /export async function persistApprovedRepairTotal\(/.test(persistSrc), false);
check('persist.ts no longer exports RepairPersistGhl (the Contact-targeted client interface)', /export interface RepairPersistGhl\b/.test(persistSrc), false);
check('persist.ts still exports the Opportunity-targeted persistApprovedRepairTotalToOpportunity', /export async function persistApprovedRepairTotalToOpportunity\(/.test(persistSrc), true);
check('persist.ts still exports persistGate, shared and unchanged', /export function persistGate\(/.test(persistSrc), true);

const dealCalcSrc = fs.readFileSync(DEAL_CALC, 'utf8');
check('DealCalculator.tsx no longer imports persistApprovedRepairTotal or persistGate', /persistApprovedRepairTotal|persistGate/.test(dealCalcSrc.split('\n').slice(0, 40).join('\n')), false);
check('DealCalculator.tsx no longer renders a "Save Repairs" action', /deal-calc-save-repairs/.test(dealCalcSrc), false);
check('DealCalculator.tsx no longer declares handleSaveRepairs', /function handleSaveRepairs/.test(dealCalcSrc), false);
check('DealCalculator.tsx still reads Contact seeds (parseContactSeeds) -- the seed READ path is unaffected, only the write is removed', /parseContactSeeds\(/.test(dealCalcSrc), true);

const contactWorkspaceSrc = fs.readFileSync(CONTACT_WORKSPACE, 'utf8');
check('ContactWorkspace.tsx dispatches ESTIMATED_REPAIRS_ID to the read-only ContactRepairsRow, not the editable MonetaryRow', /if \(f\.id === ESTIMATED_REPAIRS_ID\) return <ContactRepairsRow f=\{f\} \/>;/.test(stripComments(contactWorkspaceSrc)), true);
check('ContactWorkspace.tsx no longer wires MonetaryRow to ESTIMATED_REPAIRS_ID', /MonetaryRow f=\{f\} contactId=\{contactId\} save=\{ghl\.contacts\.setEstimatedRepairs\}/.test(contactWorkspaceSrc), false);
check('ContactWorkspace.tsx\'s ARV row is UNAFFECTED -- still the editable MonetaryRow (a deliberate PB-D55 seed input, not touched by this correction)', /if \(f\.id === ARV_ID\) return <MonetaryRow f=\{f\} contactId=\{contactId\} save=\{ghl\.contacts\.setARV\}/.test(contactWorkspaceSrc), true);

const underwritingWorkspaceSrc = fs.readFileSync(UNDERWRITING_WORKSPACE, 'utf8');
check('UnderwritingWorkspace.tsx (the real, Opportunity-bound approval flow) still calls the Opportunity-targeted function, unaffected by this round', /persistApprovedRepairTotalToOpportunity\(/.test(underwritingWorkspaceSrc), true);

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) {
  console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
  process.exit(2);
}
if (failures) { console.error('FAILED'); process.exit(1); }
console.log('OK');
