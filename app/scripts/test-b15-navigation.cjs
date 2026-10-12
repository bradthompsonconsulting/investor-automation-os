/**
 * Board 15 / Pass 1 — B2 navigation-only paths.
 *
 * Offline, source-text checks, following this repository's convention for UI
 * wiring (see test-seller-call-workspace-wiring.cjs). Every fix here is
 * navigation or copy: each section also asserts that it writes nothing.
 *
 *   F19  no-opportunity contact: a way to the contact in GHL (INV-109)
 *   F24  Pipeline rows open their contact (INV-108)
 *   F16  a nameless contact's link does not look disabled (INV-129)
 *   F54  Contract workspace reachable from the contact page (INV-130)
 *   F44  ARV says why Get Comps is disabled without an address (INV-131)
 *   F12  Import page says where leads are added today (INV-125; does not
 *        close F12 — Jess, 2026-10-04)
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
/* Write shapes in this app: named setters/savers on the ghl client, notes.create,
   the generic writeCommand, or a raw mutating fetch. Reads (list*, get*) are
   not writes. */
const WRITES = /\.(set|save|create|update|delete)[A-Z]\w*\(|notes\.create\(|writeCommand\(|method:\s*"(POST|PUT|PATCH|DELETE)"/;

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

// ── F19 ─────────────────────────────────────────────────────────────────────
const noDeal = read('src/components/NoDealYet.tsx');
check('F19 NoDealYet opens THIS contact in GHL via the existing URL helper',
  /window\.open\(ghlContactDetailUrl\(contactId\), "_blank", "noopener,noreferrer"\)/.test(noDeal), true);
check('F19 NoDealYet says IAOS does not create deals', /IAOS doesn't create deals\./.test(noDeal), true);
check('F19 NoDealYet writes nothing', WRITES.test(code(noDeal)), false);
const contactPage = read('src/pages/ContactWorkspace.tsx');
const sellerCall = read('src/pages/SellerCallWorkspace.tsx');
const underwriting = read('src/pages/UnderwritingWorkspace.tsx');
check('F19 contact page shows it when the rail has no opportunity',
  /\{railDeal\.state === "no_opportunity" \? \(\s*<div style=\{\{ marginBottom: "16px" \}\}>\s*<NoDealYet contactId=\{id\}/.test(contactPage), true);
check('F19 Seller Call no-opportunity state uses it',
  /screen\.state === "no_opportunity" \? \([\s\S]{0,120}<NoDealYet\s+contactId=\{id \?\? ""\}/.test(sellerCall), true);
check('F19 Underwriting no-opportunity state uses it',
  /screen\.state === "no_opportunity" \? \([\s\S]{0,120}<NoDealYet\s+contactId=\{id \?\? ""\}/.test(underwriting), true);
check('F19 the rail itself is unchanged (waiting states still carry no route)',
  /case "no_opportunity":[\s\S]{0,300}ask = mao = waiting\("no Opportunity on this contact"\);/.test(read('src/lib/rail.ts')), true);

// ── F24 ─────────────────────────────────────────────────────────────────────
const pipeline = read('src/pages/Pipeline.tsx');
check('F24 a Pipeline row links to its contact',
  /<Link\s+data-testid=\{`pipeline-row-contact-\$\{o\.id\}`\}\s+to=\{`\/contacts\/\$\{o\.contactId\}`\}/.test(pipeline), true);
check('F24 Pipeline stays read-only (no write call)', WRITES.test(code(pipeline)), false);

// ── F16 ─────────────────────────────────────────────────────────────────────
const contacts = read('src/pages/Contacts.tsx');
check('F16 a nameless contact reads "Unnamed contact", inside the link',
  /\{r\.name \|\| <span data-testid=\{`contacts-unnamed-\$\{r\.id\}`\}[^>]*>Unnamed contact<\/span>\}/.test(contacts), true);
check('F16 the old dim "Unknown" placeholder is gone from the name link',
  /\{r\.name \|\| <em style=\{\{ color: "#475569" \}\}>Unknown<\/em>\}/.test(contacts), false);

// ── F54 ─────────────────────────────────────────────────────────────────────
check('F54 the contact page links to its Contract workspace',
  /to=\{`\/contacts\/\$\{id\}\/contract`\}\s+data-testid="contact-contract-link"/.test(contactPage), true);
check('F54 the route it targets exists',
  /<Route path="contacts\/:id\/contract" element=\{<ContractWorkspace \/>\} \/>/.test(read('src/App.tsx')), true);

// ── F44 ─────────────────────────────────────────────────────────────────────
const arv = read('src/components/ArvCompsWorkspace.tsx');
check('F44 ARV explains a missing address beside the disabled Get Comps',
  /\{!address \? \(\s*<div data-testid="arv-needs-address"/.test(arv)
    && arv.includes('Add the property address (street, city and state) on this contact in GHL first'), true);
check('F44 Get Comps is still disabled without an address (unchanged)',
  /data-testid="arv-get-comps" disabled=\{!address \|\| handoffBusy\}/.test(arv), true);

// ── F12 ─────────────────────────────────────────────────────────────────────
const importPage = read('src/pages/Import.tsx');
check('F12 Import page says leads are added in GHL', /Leads are added in GHL, not here/.test(importPage), true);
check('F12 Import page writes nothing, and its only link is the verified GHL Contacts list',
  (code(importPage).match(/href=/g) || []).length === 1 && /href=\{ghlContactsListUrl\(\)\}/.test(code(importPage))
  && !/window\.open|<Link/.test(code(importPage)) && !WRITES.test(code(importPage)), true);

// -- INV-125 Walkthrough 2: "Add Leads" -- guidance only, route unchanged --
const sidebarSrc = read('src/components/Sidebar.tsx');
const headerSrc = read('src/components/Header.tsx');
check('INV-125 nav item reads "Add Leads" and still opens /import',
  /\{ label: "Add Leads",\s+to: "\/import",/.test(sidebarSrc) && !/label: "Import"/.test(sidebarSrc), true);
check('INV-125 header title for /import is "Add Leads"', /"\/import":\s+"Add Leads",/.test(headerSrc), true);
check('INV-125 page heading is "Add Leads"', />Add Leads<\/h1>/.test(importPage) && !/>Import<\/h1>/.test(importPage), true);
check('INV-125 the /import route is unchanged', /<Route path="import"\s+element=\{<Import \/>\} \/>/.test(read('src/App.tsx')), true);
check('INV-125 says IAOS does not import or create leads', /IAOS doesn't import or create leads\./.test(importPage), true);
{
  const steps = (importPage.replace(/\r\n/g, '\n').match(/<ol data-testid="add-leads-steps"[\s\S]*?<\/ol>/) || [''])[0];
  const items = [...steps.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
  check('INV-125 two numbered GHL steps: contact with property address, then its opportunity', items,
    ["In GHL Contacts, click the + button and add the seller as a contact, with the property's full address (street, city and state).",
     'Create an opportunity (deal) for that contact in the Seller Leads Pipeline.']);
}

console.log(`\nBoard 15 B2 navigation: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
