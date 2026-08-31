/* Live verification — Contacts surface, Phase A read-only (docs/CONTACTS_OPPORTUNITIES_SPEC.md
   §5.3 + docs/CONTACTS_DETAIL_SPEC.md). Authored ONCE at floor 119 (D1-reconciled),
   NOT split. Runs against the LIVE deploy at app.investorautomationos.com (§5.3, never
   localhost) at Brad's WIDE viewport, and passes the §9.2 bundle gate FIRST — re-pin
   EXPECTED to the bundle under test on every run.

   Floor 124 = grid (5) + six folder sections (6) + 101 custom fields (101)
             + four Additional Info subgroups (4) + three D1 identity-header renders (3)
             + four Phone N DNC adjacencies (4) + no-input (1).
   The custom-field term moved 98 -> 101 at Board 4 S0: three carrier fields
   were created in Additional Info (iaos_call_disposition, iaos_call_routing,
   iaos_disposition_at). THE FIELD COUNT MOVES THE FLOOR WHETHER OR NOT A FIELD
   IS UNLOCKED -- this list enumerates every field by name, so creating one in
   GHL fails the folder-section checks BEFORE the floor is reached, which reads
   as an unrelated red. Field creation and this edit are one sitting.
   Phase B PB-D5/PB-D13: floor = <field term> + 4N, N = unlocked field count.
     N=1  property_notes  (PB-D5)
     N=2  arv             (PB-D16/PB-D17)
     N=3  estimated_repairs (board item #2B) — 124 + 4(3) = 136.
   The three Board 4 carriers are NOT unlocked: they are written by the
   disposition control, never inline-edited, so N stays 3.
   Each unlocked field costs FOUR checks: present, value-from-wire, and the two
   activation assertions. Keep the formula next to the number; a floor without
   its derivation is how the next unlock gets it wrong.
   D5 conversation parity (CONTACTS_DETAIL_SPEC D5): + 9 = 145.
     Neelima (4): delta, long-email-collapsed, expand, collapse.
     Gordon  (5): delta, sms-rendered, sms-alignment, sms-never-collapses,
                  inbound-email-collapsed.
   Board #5 S1+S2 persistent call rail: + 14 = 159.
     structure (5)  one rail · actually sticky (computed style) · z-index is 1
                    (its own check: the CallbackPopover at 20 must stay above it) ·
                    four cells in DOM order · identity equals the h1
     ask (4)        value · tone · provenance says "Contact fallback" ·
                    provenance is NOT "Opportunity"
     mao (3)        not-yet-approved text · waiting tone · NO provenance element
     carriers (2)   Position and Investor Offer verbatim
   NOT a per-unlock term. The PB-D5/PB-D13 4N formula prices an EDITOR unlock;
   the rail unlocks nothing and N stays 3. This is a structural render term,
   the same species as the four Additional Info subgroups and the three D1
   identity renders.
   REPLACES, does not extend, S1's proposed "rail carries no numeric content"
   check. That invariant expired when S2 gave the rail a legitimate figure.
   Board #5 S3 occupancy unlock: + 4 = 163. THE FIRST GENUINE PB-D5/PB-D13
   PER-UNLOCK TERM IN BOARD #5 -- occupancy is a real field unlock, so N goes
   3 -> 4 and 4N goes 12 -> 16. Template choice-single + immediate (PB-D11
   lists choice + immediate as the only permitted pair for this editor):
     1 choice-display-present       at rest, one display, text = label or ---,
                                    zero option controls
     2 choice-edit-reveals-options  activation swaps the display out; exactly
                                    the option set, GHL's order, all enabled
     3 choice-exactly-one-selected  one selected matching the wire, or zero
                                    when empty. Never two.
     4 choice-commit-surface        non-option controls are exactly {clear}
   The two decline-path proofs below the checks are HARD ABORTS, not check()
   sites -- harness preconditions, not field invariants. The floor stays 163.
   Board #5 D1 return revalidation: + 4 = 167.
     1 return-refetch-when-idle               idle return -> exactly one refresh
     2 return-coalesces-focus-and-visibility  three clauses: both signals -> one
                                              refresh; focus alone -> one;
                                              visibilitychange alone -> one.
                                              The last two are what stop the
                                              first passing against a dead
                                              listener on either side
     3 return-defers-while-editing            open editor -> zero refresh
     4 return-refetch-after-editor-exits      Escape -> exactly one deferred read
   NOT A FIELD UNLOCK. N stays 4 and 4N stays 16 -- these price a BEHAVIOUR,
   the same species as the rail's +14 above and expressly not the PB-D5/PB-D13
   per-unlock term.
   Board #5 4A asymmetric disclosure: + 3 = 170. ALSO NOT A FIELD UNLOCK --
   N stays 4, 4N stays 16. This is rail behaviour, not another editor.
     1 rail-ask-fallback-offers-route          the route EXISTS on the only
                                               branch that can reach it
     2 rail-ask-fallback-has-no-authority-note after §4B no rail state
                                               produces one; dormant-field guard
     3 harness-issued-no-writes                zero PUT/PATCH/DELETE across the
                                               WHOLE run -- the read-only
                                               contract made machine-readable,
                                               and the route's safety claim
   Board #5 §4B Opportunity Ask editor: + 3 = 173. ALSO NOT A FIELD UNLOCK --
   §4B unlocks an OPPORTUNITY field and leaves the Contact row display-only,
   so N stays 4 and 4N stays 16. PB-D13's 119 + 4N does not apply.
     1 contact-ask-row-states-governing-fallback  the Contact Ask row states
                                                  which carrier governs
     2 contact-ask-row-is-display-only            no input in that row --
                                                  §4B writes the Opportunity
                                                  value, never the fallback
     3 rail-ask-fallback-offers-origination       the origination affordance
                                                  exists in the branch every
                                                  Production contact reaches
   Board #5 §4C origination: + 5 = 178. ALSO NOT A FIELD UNLOCK -- §4C still
   unlocks an OPPORTUNITY field and leaves the Contact row display-only, so
   N stays 4 and 4N stays 16. PB-D13's 119 + 4N does not apply.
   ⚠ THE §4B ENTRY ABOVE WAS INVERTED, NOT ADDED TO. It asserted the fallback
   branch carried NO edit control -- true then, false now. 0 of 43 Production
   opportunities carry an Ask, so an editor reachable only from the
   Opportunity branch was unreachable by the operator on every deal.
     1 rail-ask-fallback-keeps-contact-route      the GHL hop survives beside
                                                  origination: the Contact
                                                  value still governs here and
                                                  IAOS cannot write it
     2 rail-ask-origination-draft-opens-empty     seed is null, so the draft
                                                  NEVER starts from the Contact
                                                  number -- the shadow-copy
                                                  guard at render level
     3 rail-ask-origination-does-not-swap-the-display
                                                  additive, not Model B: the
                                                  display is the CONTACT ask,
                                                  the edit targets the
                                                  OPPORTUNITY ask
     4 rail-ask-origination-escape-returns-to-display
                                                  decline path; PB-D22 makes an
                                                  empty draft a no-op exit
     5 d1-return-revalidation-does-not-increment-save-counter
                                                  two causes, two counters.
                                                  The converse needs a real
                                                  write and belongs to the
                                                  scripted proof
   Board #5 §4D authority correction: + 2 = 180. ALSO NOT A FIELD UNLOCK --
   §4D changes what the display-only row SAYS and unlocks nothing, so N stays 4
   and 4N stays 16.
     1 contact-ask-row-resolved-no-ask-states-no-value
                                                  the 42-of-47 Production state
     2 contact-ask-row-no-opportunity-states-contact-value-only
                                                  the 4-of-47 Production state
   ⚠ ONLY THREE OF THE SEVEN AUTHORITY SITUATIONS ARE REACHABLE HERE. A Step-0
   Production sweep of all 47 contacts measured exactly three: `contact` (1,
   Neelima, checks at :795-806), `resolved_no_ask` (42) and `no_opportunity`
   (4). loading, error, awaiting_selection and resolved-with-an-Opportunity-Ask
   have ZERO Production instances and are proven ONLY offline, in test-rail.cjs
   CASE 8. A green run here is evidence about the three states that ran.
   ⚠ The widened settle at :485 is a PRECONDITION FIX, not a check -- it adds
   record-section to the wait because two of the assertions read inside it. The
   floor does not move for it.
   ⚠ THE OPPORTUNITY BRANCH IS NOT HERE AND CANNOT BE. Measured 2026-08-29 by
   two independent readers: 0 of 43 Production opportunities carry
   opportunity.asking_price, so no fixture reaches that branch and
   manufacturing Production data to get one is forbidden. Since §4B the offline
   assertions in test-rail.cjs are the INVERSE of what they were: route-PRESENT
   (the in-place editor) and note-ABSENT. Do not read a green run here as
   covering both branches.
   Success ONLY when checksRun === 180 AND every check passed. Any throw exits nonzero.
   The 101-field list is STATIC + hardcoded here (verification-only) — never imported from
   app code, never derived from ADDITIONAL_INFO_SUBGROUPS. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-D5WvTOKA.js"; // §9.2 — RE-PIN to the served bundle after every app-code deploy

/* Environment + fixture carrier (Gate 4C C4a).

   NO config loader here, deliberately. This harness resolves contact-record
   fixtures ONLY and carries no locationId, so getConfig() would resolve
   nothing and would be dead infrastructure inside a gate instrument.
   require() reads the carrier JSON natively.

   Placed ABOVE the §9.2 bundle gate on purpose: a refusal must be genuinely
   offline -- no browser launched, no network reached. The gate does not move.

   CARVE-OUT, stated here so a later reader does not "finish the job":
   PROPERTY_NOTES_ID and ARV_ID below stay HARDCODED, as do their duplicates
   inside page.evaluate and the drift guards that compare the two scopes.
   They are the allowlist this harness CHECKS. A verifier that resolved its
   expectations from the source under test could not detect drift in that
   source -- converting them would delete a working control and install the
   exact circularity it exists to prevent. */
const FIXTURES = require("../../scripts/harness-fixtures.json");
const envArg = process.argv.slice(2).find((a) => a.startsWith("--env="));
if (!envArg) {
  console.log("ABORT — missing --env=<environment> (expected --env=production)");
  process.exit(4);
}
const ENV = envArg.slice("--env=".length);
const CARRIER = (FIXTURES[ENV] || {}).fixtureRecords;
if (!CARRIER || !CARRIER.contacts) {
  console.log(`ABORT — carrier has no fixtureRecords.contacts for environment "${ENV}" (scripts/harness-fixtures.json)`);
  process.exit(4);
}
const CONTACTS = CARRIER.contacts;

const TARGET   = CONTACTS.neelima; // detail-view fixture (checks 6-119)
const PROPERTY_NOTES_ID = "k7O0TYVMpqCpnMHRLPol"; // PB-D5 unlock allowlist, N=1. Hardcoded here per the verification-only rule above; never imported from app code.
const ARV_ID = "wMBTGWMs97yysQFx7Vad"; // PB-D16/PB-D17 unlock allowlist, N=2. Hardcoded per the same verification-only rule.
const ESTIMATED_REPAIRS_ID = "OQnud97MfdxMcTgMVTgf"; // Board item #2B unlock allowlist, N=3. Hardcoded per the same verification-only rule.
const BRADT75  = CONTACTS.bradt75; // phone-format fixture — +12149146151 → 214-914-6151 (check 5)

// ── D5 conversation parity (CONTACTS_DETAIL_SPEC D5) ───────────────────────────
// TARGET/Neelima is the REGRESSION fixture: emails only, ZERO SMS, so D5 must not
// change her transcript at all. GORDON is the EXERCISE fixture: SMS in BOTH
// directions plus a long INBOUND email, the only fixture that covers left-aligned
// bubbles, both messageType branches, and the filtered remainder together.
const GORDON = CONTACTS.ronaldGordon; // ronald gordon
const NEE_MSGS_URL = `${ORIGIN}/.netlify/functions/ghl-contact-conversations?id=${TARGET}`;
const GOR_MSGS_URL = `${ORIGIN}/.netlify/functions/ghl-contact-conversations?id=${GORDON}`;
const SHOWN_TYPES  = ["TYPE_EMAIL", "TYPE_SMS"]; // the D5 allowlist, mirrored here per the verification-only rule
// Gordon's long inbound email, identified by BODY CONTENT — never by bubble index,
// which reorders whenever GHL emits another activity row.
const GOR_INBOUND_EMAIL_MARK = "Your property information just came through";

// UNEXERCISED BRANCH — recorded, not silently skipped. No email body on either
// fixture is short enough to fit inside CLAMP_LINES, so every email here overflows
// and every email bubble renders a control. The negative case — a short email that
// does NOT overflow and therefore renders NO control — has no fixture in this
// location and is NOT covered by any check below. SMS does not substitute for it:
// SMS is non-collapsible by construction, so it never reaches the measurement at
// all. Closing this needs a contact with a genuinely short email body.

// ── Static canonical record (VERIFICATION-ONLY; hardcoded, never imported) ──────
// Folder DISPLAY order (folder-names effect: Offer first, then remaining ascending by
// folder position). Within each folder/subgroup, fields are in GHL `position` order —
// the exact render order. Additional Info is the sole subdivided folder.
const RECORD = [
  { folder: "Offer", fields: ["Offer Price", "Offer MAO", "Offer Wholesale Fee", "Offer Repair Total", "Offer Margin", "Offer ARV", "Offer Date"] },
  { folder: "Contact", fields: ["Phone Type", "Phone Status"] },
  { folder: "General Info", fields: ["Callback Datetime", "Last Call Attempt", "last_call_attempt_precise"] },
  { folder: "Additional Info", subgroups: [
    { name: "Reachability", fields: ["Phone 1 DNC", "Phone 2", "Phone 2 DNC", "Phone 3", "Phone 3 DNC", "Phone 4", "Phone 4 DNC", "Phone 5", "Phone 5 DNC", "Email 2", "Email 3", "Email 4", "Owner 2 First Name", "Owner 2 Last Name", "Litigator", "Mailing Care of Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Mailing County", "Do Not Mail", "Previous Phone"] },
    { name: "Property", fields: ["Property Address", "Loan Amount", "Interest Rate", "County", "APN", "Property Status", "Property Type", "Bedrooms", "Total Bathrooms", "Building Sqft", "Lot Size Sqft", "Effective Year Built", "Total Assessed Value", "Last Sale Date", "Last Sale Amount", "Total Open Loans", "Est. Remaining Loan Balance", "Est. Value", "Est. Loan-to-Value", "Est. Equity", "MLS Status", "MLS Date", "MLS Amount", "Lien Amount", "Foreclosure Factor", "Total Condition", "Interior Condition", "Bathroom Condition", "Kitchen Condition", "Exterior Condition"] },
    { name: "Investor", fields: ["Asking Price", "ARV", "Estimated Repairs", "Motivation Level", "Timeline to Sell", "Lead Source", "Occupancy Status", "Follow Up Date", "MAO Viability Flag", "Hold Months", "Carrying Cost", "Repair Line Items", "Owner Occupied", "Property Notes"] },
    // Board 4 S0 — the three carriers append at the END of System. GHL positions
    // 4050/4100/4150 are the three highest in Additional Info (prior max 4000,
    // "Previous Phone"), so they render last. Their DISPLAY NAMES are lowercase
    // with underscores, matching what was created in GHL and read back from it —
    // the checks compare rendered name, so the sheet's title-case form would have
    // failed three named checks here.
    { name: "System", fields: ["Marketing Lists", "Date Added to List", "Motivation Score", "Deal Score", "Combined Score", "Data Completeness Score", "Callback Datetime Precise", "iaos_call_disposition", "iaos_call_routing", "iaos_disposition_at"] },
  ]},
  { folder: "IAOS Onboarding", fields: ["Business Phone", "Business Website", "Wholesaling Market", "SMS Sender Name", "Sending Domain", "Booking Calendar Link", "Onboarding Notes", "Has Sending Domain", "Has Booking Calendar", "Has Existing Leads", "Existing GHL Account"] },
  { folder: "Form | IAOS Client Intake Form", fields: ["Upload Your Lead CSV (if applicable)"] },
];
const FOLDER_ORDER = RECORD.map((g) => g.folder);
// ⚠ A SECOND, INDEPENDENT COUNT. These numbers are NOT derived from RECORD
// above, so the two can disagree — and did: Board 4 S1 added three names to
// RECORD's System subgroup and left this at 7, which failed subgroup-seq-4
// with the field checks all passing. Update BOTH when a field is added.
const SUBGROUP_EXPECT = [["Reachability", 23], ["Property", 30], ["Investor", 14], ["System", 10]];

// Harness-local copies of the app's display transforms (NOT imported) — used only to
// compute the expected identity renders for checks 113/114.
function formatPhone(raw) { const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw || ""); return m ? `${m[1]}-${m[2]}-${m[3]}` : (raw || ""); }
function formatAddress(c) {
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ") || "—";
}

// ── check() — counts, logs, fails-on-dup-name ──────────────────────────────────
let checksRun = 0;
const failures = [];
const names = new Set();
function check(name, cond, detail = "") {
  if (names.has(name)) throw new Error(`duplicate check name: ${name}`);
  names.add(name);
  checksRun++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!cond) failures.push(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── D5 helpers — conversation-pane DOM readers ─────────────────────────────────
// The pane has no data-testid hooks, so it is located structurally: the
// "Conversation History" h2, then the sibling scroller (the only child with
// overflowY:auto — the loading and empty states are plain divs). Bubbles are that
// scroller's direct children; child[0] is the label row, child[1] the body div.
// The locator is duplicated inside each page.evaluate because evaluate runs in the
// browser and cannot see Node scope — same constraint the UNLOCKED_ID literal has.
const PANE_JS = `
  const h2 = [...document.querySelectorAll("h2")].find((h) => /Conversation History/.test(h.textContent || ""));
  if (!h2) return null;
  const pane = h2.parentElement;
  const scroller = [...pane.children].find((c) => c !== h2 && c.style && c.style.overflowY === "auto");
`;

// Waits for the pane to LEAVE its loading state — asserting before this races the
// fetch and reads an empty scroller as a real zero.
async function waitForConversations(page) {
  await page.waitForFunction(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => /Conversation History/.test(h.textContent || ""));
    if (!h2) return false;
    const pane = h2.parentElement;
    if ([...pane.querySelectorAll("div")].some((d) => /Loading conversation history/.test(d.textContent || ""))) return false;
    const scroller = [...pane.children].find((c) => c !== h2 && c.style && c.style.overflowY === "auto");
    return !!scroller && scroller.children.length > 0;
  }, { timeout: 45000 });
}

// One row per rendered bubble. clientHeight/scrollHeight come from the BODY div —
// the element the clamp is applied to — so overflow is the DOM relationship
// scrollHeight > clientHeight + 1, never a count of visible text lines (hard
// newlines consume line boxes without producing that many nonblank lines).
async function readBubbles(page) {
  return page.evaluate(new Function(`${PANE_JS}
    if (!scroller) return null;
    return [...scroller.children].map((b) => {
      const label  = (b.children[0] && b.children[0].textContent) || "";
      const bodyEl = b.children[1] || null;
      const btn    = b.querySelector("button");
      return {
        alignSelf:    getComputedStyle(b).alignSelf,
        isSms:        /\\u00b7\\s*Sms/.test(label),
        isEmail:      /\\u00b7\\s*Email/.test(label),
        outbound:     /Sent/.test(label),
        body:         bodyEl ? (bodyEl.textContent || "") : "",
        clientHeight: bodyEl ? bodyEl.clientHeight : -1,
        scrollHeight: bodyEl ? bodyEl.scrollHeight : -1,
        control:      btn ? (btn.textContent || "").trim() : null,
      };
    });
  `));
}

// Clicks the control on the bubble whose body CONTAINS mark — content-addressed,
// never index-addressed. Returns whether a control was found and clicked.
async function clickControlByBody(page, mark) {
  return page.evaluate(new Function("mark", `${PANE_JS}
    if (!scroller) return false;
    const b = [...scroller.children].find((x) => (x.children[1] ? x.children[1].textContent || "" : "").replace(/\\s+/g, " ").includes(mark));
    const btn = b && b.querySelector("button");
    if (!btn) return false;
    btn.click();
    return true;
  `), mark);
}

(async () => {
  // ── Bundle gate (§9.2) — prod serves the code under test, FIRST, before any check ──
  const idx = await (await fetch(`${ORIGIN}/index.html?cb=${Math.random()}`, { headers: { "Cache-Control": "no-cache" } })).text();
  const liveHash = (idx.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "NONE";
  if (liveHash !== EXPECTED) { console.log(`ABORT — bundle gate: live=${liveHash} expected=${EXPECTED}`); process.exit(1); }
  console.log(`bundle-gate OK  live=${liveHash}`);

  // ── D5 ground truth from the endpoints ────────────────────────────────────────
  // Direct Node fetches, BEFORE the browser exists — so they cannot appear in the
  // page's own response capture (fnBodies), cannot be mistaken for a browser-side
  // read, and cannot contaminate any request-derived assertion. Same placement and
  // same rationale as verify-conversations.cjs. GET only; zero writes.
  const neeGT = await (await fetch(NEE_MSGS_URL)).json();
  const gorGT = await (await fetch(GOR_MSGS_URL)).json();
  const counts = (gt) => {
    const all = (gt && gt.messages) || [];
    const shown = all.filter((m) => SHOWN_TYPES.includes(m.messageType)).length;
    return { total: all.length, shown, filtered: all.length - shown, messages: all };
  };
  const nee = counts(neeGT);
  const gor = counts(gorGT);
  console.log(`d5-ground-truth  neelima total=${nee.total} shown=${nee.shown} filtered=${nee.filtered}  gordon total=${gor.total} shown=${gor.shown} filtered=${gor.filtered}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  /* §4A point 4 — THIS HARNESS IS READ-ONLY BY CONTRACT, so prove it rather
     than assert it in a comment. Every mutating request the page issues is
     recorded across the ENTIRE run; the check below requires zero. It also
     covers the new route control, whose whole safety claim is that opening a
     GHL tab writes nothing. PB-D17 already forbids the harness modifying a
     value; this is the machine-readable version of that rule. */
  const mutatingRequests = [];
  const page = await ctx.newPage();
  ctx.on("request", (req) => {
    const m = req.method();
    if (m === "PUT" || m === "PATCH" || m === "DELETE") mutatingRequests.push(`${m} ${req.url().split("?")[0]}`);
  });

  // Capture the page's OWN netlify-function responses (no independent reads).
  const fnBodies = [];
  page.on("response", async (resp) => {
    if (!/\/\.netlify\/functions\//.test(resp.url())) return;
    try { fnBodies.push({ url: resp.url(), json: await resp.json() }); } catch { /* non-JSON */ }
  });

  // ═══ CHECKS 1-5 — /contacts grid ═══
  await page.goto(`${ORIGIN}/contacts`, { waitUntil: "load" });
  await page.waitForFunction(
    () => [...document.querySelectorAll("tbody tr")].some((tr) => tr.querySelector('a[href^="/contacts/"]')),
    { timeout: 45000 },
  );

  // Grid payload = the page's OWN ghl-contacts response (captured above), not a second read.
  let grid = null;
  for (let i = 0; i < 40 && !grid; i++) {
    grid = fnBodies.find((b) => /ghl-contacts/.test(b.url) && Array.isArray(b.json)) || null;
    if (!grid) await sleep(250);
  }
  const payload = grid ? grid.json : [];

  const domRowCount = await page.evaluate(
    () => [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector('a[href^="/contacts/"]')).length,
  );
  check("grid-renders", !!grid && domRowCount === payload.length,
    `domRows=${domRowCount} payload=${grid ? payload.length : "(none captured)"}`);

  // 2 — search narrows (digits-only → phone branch); bradt75's unique phone.
  await page.fill('input[placeholder="Search name, phone, email…"]', "2149146151");
  await page.waitForTimeout(300);
  const searchState = await page.evaluate((id) => {
    const rows = [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector('a[href^="/contacts/"]'));
    return { count: rows.length, hasTarget: rows.some((tr) => tr.querySelector(`a[href$="/contacts/${id}"]`)) };
  }, BRADT75);
  check("search-behaves", searchState.count >= 1 && searchState.count < payload.length && searchState.hasTarget,
    `filtered=${searchState.count} total=${payload.length} bradt75Present=${searchState.hasTarget}`);
  await page.fill('input[placeholder="Search name, phone, email…"]', "");
  await page.waitForTimeout(300);

  // 3 — filter ABSENCE: V1 has no filter control (a filter would be a <select> dropdown).
  const selectCount = await page.evaluate(() => document.querySelectorAll("select").length);
  check("filter-absent", selectCount === 0, `selects=${selectCount}`);

  /* 4 — sort behaves: click the Name header → the column becomes ascending.

     WHAT THIS USED TO ASSERT, AND WHY IT WAS WRONG. It compared the RENDERED
     text of every row. The app sorts on the UNDERLYING name, where an empty
     string collates first; a contact with no name renders as the placeholder
     "Unknown". So the old check compared a string the sort never saw, and one
     nameless contact made it fail while the sort was working correctly.

     ⚠ PLACEHOLDER ORDERING IS OBSERVED BEHAVIOUR, NOT A RULED PRODUCT DECISION.
     Nameless rows land first because "" collates first, and nobody decided
     that. Freezing "nameless rows sort first" into this check would assert a
     decision that has never been made, and a later decision to sort
     placeholders last would then read as a regression. So the position of the
     nameless block is deliberately NOT asserted. The looser assertion is the
     point, not an oversight.

     NAMELESSNESS COMES FROM THE PAYLOAD, never from matching the placeholder
     string. Matching "Unknown" would break the day a real contact is named
     Unknown, and it would couple this harness to a display transform instead
     of to data.

     Nameless contacts are a legitimate recurring shape, not bad data: an
     inbound call or text from a number not already in Contacts makes GHL
     auto-create a phone-only record. The callback path went live 2026-08-26,
     so more of these are expected. */
  const namelessIds = new Set(
    payload
      .filter((c) => c && !String(c.firstName || "").trim() && !String(c.lastName || "").trim())
      .map((c) => c.id),
  );

  await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find((t) => /Name/.test(t.textContent || ""));
    if (th) th.click();
  });
  await page.waitForTimeout(300);

  const sortedRows = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelector('a[href^="/contacts/"]'))
      .filter(Boolean)
      .map((a) => ({
        id: (a.getAttribute("href") || "").split("/").pop(),
        text: (a.textContent || "").trim().toLowerCase(),
      })));

  // (1) THE REAL INVARIANT — rows with a name are ascending among themselves.
  const named = sortedRows.filter((r) => !namelessIds.has(r.id));
  let firstBadPair = null;
  for (let i = 1; i < named.length; i++) {
    if (named[i - 1].text.localeCompare(named[i].text) > 0) {
      firstBadPair = [named[i - 1].text, named[i].text];
      break;
    }
  }

  // (2) Nameless rows form one contiguous block. WHERE it sits is not asserted.
  const namelessIdx = sortedRows.map((r, i) => (namelessIds.has(r.id) ? i : -1)).filter((i) => i !== -1);
  const contiguous =
    namelessIdx.length === 0 ||
    namelessIdx[namelessIdx.length - 1] - namelessIdx[0] + 1 === namelessIdx.length;

  check("sort-behaves",
    sortedRows.length >= 2 && named.length >= 2 && firstBadPair === null && contiguous,
    `rows=${sortedRows.length} named=${named.length} nameless=${namelessIdx.length} ` +
      `namedAscending=${firstBadPair === null}${firstBadPair ? ` firstBadPair=${JSON.stringify(firstBadPair)}` : ""} ` +
      `namelessContiguous=${contiguous}${namelessIdx.length ? ` atIndices=[${namelessIdx.join(",")}]` : ""}`);

  // 5 — phone-format: bradt75 confirmed in the captured payload, then its rendered cell.
  const bradInPayload = payload.some((c) => c && c.id === BRADT75);
  const bradCell = await page.evaluate((id) => {
    const link = document.querySelector(`a[href$="/contacts/${id}"]`);
    if (!link) return null;
    const tr = link.closest("tr");
    const tds = tr ? [...tr.children] : [];
    return tds[1] ? (tds[1].textContent || "").trim() : null; // column 2 = Phone
  }, BRADT75);
  check("phone-format", bradInPayload && bradCell === "214-914-6151",
    `inPayload=${bradInPayload} renderedPhone="${bradCell}"`);

  // ═══ CHECKS 6-127 — /contacts/:id detail ═══
  await page.goto(`${ORIGIN}/contacts/${TARGET}`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) =>
      [...b.querySelectorAll("span")].some((s) => /Space Grotesk/.test(s.style.fontFamily || "")));
    const h1 = document.querySelector("h1");
    return btns.length === 6 && h1 && h1.textContent.trim() !== "…" && h1.textContent.trim() !== "";
  }, { timeout: 45000 });

  /* Board #5 S2 — the rail's Opportunity read is a SEPARATE fetch from the
     contact read, so the h1 can be ready while the rail still says "reading
     Opportunity…". Wait for that state to clear before capturing, or the
     assertions race the fetch. This waits for the state to RESOLVE, not for a
     particular answer: an error or no_opportunity clears it too, and would be
     caught by the assertions rather than hidden by a timeout.

     ⚠ §4D — record-section IS PART OF THIS PRECONDITION, A THIRD FETCH. The
     settle above waits on the CONTACT read and this one on the OPPORTUNITIES
     read, but the capture at :532 reads INSIDE record-section, and the
     contact-ask-authority checks below assert on an element that lives there.
     record-section is gated on the FIELD-DEFS + folder-names fetch, which is
     neither of the two already waited on. It was green only because the defs
     happened to land first on this fixture; a Step-0 measurement sweep with
     exactly this gap captured "row absent" on 47 of 47 contacts and it was an
     artifact of the race, not a fact. A test owns its preconditions. */
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="rail-state-seller-ask"]');
    return s && (s.textContent || "").trim() !== "" && !/^reading Opportunity/.test((s.textContent || "").trim())
      && !!document.querySelector('[data-testid="record-section"]');
  }, { timeout: 45000 });

  const rec = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const btns = [...document.querySelectorAll("button")].filter((b) =>
      [...b.querySelectorAll("span")].some((s) => /Space Grotesk/.test(s.style.fontFamily || "")));
    const folders = btns.map((b) => {
      const nameSpan = [...b.querySelectorAll("span")].find((s) => /Space Grotesk/.test(s.style.fontFamily || ""));
      const name = norm(nameSpan ? nameSpan.textContent : "");
      const body = b.nextElementSibling;
      const display = body ? getComputedStyle(body).display : "MISSING";
      let flat = [], subgroups = [];
      if (body) {
        const kids = [...body.children];
        const firstGrand = kids[0] && kids[0].children[0];
        if (firstGrand && firstGrand.tagName === "SPAN") {
          flat = kids.map((k) => norm(k.children[0] ? k.children[0].textContent : ""));
        } else {
          subgroups = kids.map((sg) => {
            const sk = [...sg.children];
            return { name: norm(sk[0] ? sk[0].textContent : ""), fields: sk.slice(1).map((fr) => norm(fr.children[0] ? fr.children[0].textContent : "")) };
          });
        }
      }
      return { name, display, flat, subgroups };
    });

    // Identity header (D1) — h1 (name) + meta row (phone span, address span).
    const h1 = document.querySelector("h1");
    const identityName = norm(h1 ? h1.textContent : "");
    let identityPhone = "", identityAddress = "";
    if (h1) {
      const infoWrap = h1.parentElement;
      const metaRow = infoWrap ? [...infoWrap.children].find((c) => c !== h1 && c.tagName === "DIV") : null;
      if (metaRow) {
        const spans = [...metaRow.children].filter((c) => c.tagName === "SPAN");
        if (spans[0]) identityPhone = norm(spans[0].textContent);
        if (spans[1]) identityAddress = norm(spans[1].textContent);
      }
    }

    // No-input SCOPE (§5.3 SCOPED 2026-07-24, D1): target the stable data-testid hooks —
    // record-section container + identity header. A MISSING hook is a FAILURE (asserted at
    // the check() call), never a zero-input pass.
    const recordContainer = document.querySelector('[data-testid="record-section"]');
    const identityHeader = document.querySelector('[data-testid="identity-header"]');
    const scopeMissing = !recordContainer || !identityHeader;
    const SEL = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
    // PB-D5 allowlist, N=1. Literal repeated here because page.evaluate runs in
    // the browser and cannot see Node scope. Drift from PROPERTY_NOTES_ID is
    // caught by the unlockedId guard before any check runs.
    const UNLOCKED_ID = "k7O0TYVMpqCpnMHRLPol";
    const ARV_ID_B = "wMBTGWMs97yysQFx7Vad";
    const identityInputs = identityHeader ? identityHeader.querySelectorAll(SEL).length : 0;
    let allowlistedInputs = 0;
    let strayInputs = 0;
    const unlocked = { count: 0, tag: "", value: null, disabled: null, readOnly: null, saveCount: 0, cancelCount: 0 };
    if (recordContainer) {
      for (const el of recordContainer.querySelectorAll(SEL)) {
        if ((el.getAttribute("data-testid") || "") === "field-input-" + UNLOCKED_ID) allowlistedInputs++;
        else strayInputs++;
      }
      const uEls = recordContainer.querySelectorAll('[data-testid="field-input-' + UNLOCKED_ID + '"]');
      unlocked.count = uEls.length;
      if (uEls.length === 1) {
        unlocked.tag = uEls[0].tagName;
        unlocked.value = uEls[0].value;
        unlocked.disabled = uEls[0].disabled;
        unlocked.readOnly = uEls[0].readOnly;
      }
      unlocked.saveCount = recordContainer.querySelectorAll('[data-testid="field-save-' + UNLOCKED_ID + '"]').length;
      unlocked.cancelCount = recordContainer.querySelectorAll('[data-testid="field-cancel-' + UNLOCKED_ID + '"]').length;
    }
    // PB-D17 Model B — at rest ARV renders a DISPLAY span and NO input. The
    // display-to-edit swap means the at-rest no-input scan above passes for ARV
    // regardless of configuration, so editability is proven by activation below.
    const arv = { displayCount: 0, displayText: "", inputAtRest: 0 };
    if (recordContainer) {
      const dEls = recordContainer.querySelectorAll('[data-testid="field-display-' + ARV_ID_B + '"]');
      arv.displayCount = dEls.length;
      if (dEls.length === 1) arv.displayText = (dEls[0].textContent || "").trim();
      arv.inputAtRest = recordContainer.querySelectorAll('[data-testid="field-input-' + ARV_ID_B + '"]').length;
    }
    /* Board #5 S1/S2 — the persistent call rail. Read the RENDERED result:
       the four cells in DOM order, each cell's primary text, its tone, and
       its provenance line if one rendered at all. Position is read from the
       computed style, not the inline attribute, because "is it actually
       sticky" is the question. */
    const railEl = document.querySelectorAll('[data-testid="deal-rail"]');
    const rail = { count: railEl.length, position: "", top: "", zIndex: "", identity: "", cells: [] };
    if (railEl.length === 1) {
      const el = railEl[0];
      const cs = getComputedStyle(el);
      rail.position = cs.position;
      rail.top = cs.top;
      rail.zIndex = cs.zIndex;
      const nameEl = el.querySelector('[data-testid="rail-contact-name"]');
      rail.identity = norm(nameEl ? nameEl.textContent : "");
      for (const cell of el.querySelectorAll('[data-testid^="rail-cell-"]')) {
        const key = (cell.getAttribute("data-testid") || "").replace("rail-cell-", "");
        const stateEl = cell.querySelector('[data-testid="rail-state-' + key + '"]');
        const provEl = cell.querySelector('[data-testid="rail-provenance-' + key + '"]');
        const labelEl = cell.querySelector('[data-testid="rail-label-' + key + '"]');
        rail.cells.push({
          key,
          label: norm(labelEl ? labelEl.textContent : ""),
          primary: norm(stateEl ? stateEl.textContent : ""),
          tone: stateEl ? stateEl.getAttribute("data-rail-tone") : null,
          // null means NO provenance element rendered at all -- distinct from
          // one that rendered empty.
          provenance: provEl ? norm(provEl.textContent) : null,
          provenanceSource: provEl ? provEl.getAttribute("data-rail-source") : null,
          // §4A — null means the element did not render at all, which is the
          // assertion in the Opportunity branch. Distinct from an empty label.
          route: (() => { const e = cell.querySelector(`[data-testid="rail-route-${key}"]`); return e ? norm(e.textContent) : null; })(),
          routeKind: (() => { const e = cell.querySelector(`[data-testid="rail-route-${key}"]`); return e ? e.getAttribute("data-rail-route") : null; })(),
          authorityNote: (() => { const e = cell.querySelector(`[data-testid="rail-authority-note-${key}"]`); return e ? norm(e.textContent) : null; })(),
        });
      }
    }
    /* ── Board #5 §4B ─────────────────────────────────────────────────────
       The Contact Asking Price row's authority label, and whether that row is
       display-only. The row is located from the label element itself rather
       than from a field id, so the assertion needs no id plumbing and reads
       the structure it actually cares about: this row, containing no input. */
    const authEl = document.querySelector('[data-testid="contact-ask-authority"]');
    const askAuthority = authEl
      ? {
          text: norm(authEl.textContent),
          value: authEl.getAttribute("data-ask-authority"),
          // ContactAskRow: outer row div > inner flex div > this span.
          inputsInRow: authEl.parentElement && authEl.parentElement.parentElement
            ? authEl.parentElement.parentElement.querySelectorAll("input").length
            : -1,
        }
      : null;
    /* The rail editor must not exist in the Contact-fallback branch. Either
       testid appearing here means the editor rendered where no Opportunity Ask
       governs -- offering to write a value this branch does not own. */
    const railAskEditor = {
      display: document.querySelectorAll('[data-testid="rail-ask-display"]').length,
      input: document.querySelectorAll('[data-testid="rail-ask-input"]').length,
      /* §4C — origination IS offered in this branch. That is the inversion of
         the §4B check: the fallback branch now carries an edit control. */
      originate: document.querySelectorAll('[data-testid="rail-ask-originate"]').length,
      originateLabel: (() => { const e = document.querySelector('[data-testid="rail-ask-originate"]'); return e ? norm(e.textContent) : null; })(),
      warning: document.querySelectorAll('[data-testid="rail-ask-authority-unrefreshed"]').length,
    };
    const wsEl = document.querySelector('[data-testid="contact-workspace"]');
    const saveRefreshCount = wsEl ? wsEl.getAttribute('data-save-refresh-count') : null;
    return { folders, identityName, identityPhone, identityAddress, identityInputs, strayInputs, allowlistedInputs, unlocked, unlockedId: UNLOCKED_ID, arv, arvId: ARV_ID_B, scopeMissing, folderCount: folders.length, rail, askAuthority, railAskEditor, saveRefreshCount };
  });

  const byName = (n) => rec.folders.find((f) => f.name === n);

  // 6-11 — six folder sections: name at sequence position + collapse state (Offer open, rest none).
  FOLDER_ORDER.forEach((fname, i) => {
    const dom = rec.folders[i];
    const openOk = i === 0 ? (dom && dom.display !== "none") : (dom && dom.display === "none");
    check(`folder-seq-${i + 1}:${fname}`, !!dom && dom.name === fname && openOk,
      `got="${dom && dom.name}" display=${dom && dom.display}`);
  });

  // 12-109 — the 98 custom fields: presence + correct section (+ subgroup) + RELATIVE ORDER.
  for (const grp of RECORD) {
    const dom = byName(grp.folder);
    if (grp.subgroups) {
      for (const sg of grp.subgroups) {
        const domSg = dom && dom.subgroups.find((s) => s.name === sg.name);
        sg.fields.forEach((fname, j) => {
          check(`field:${grp.folder}/${sg.name}:${fname}`, !!domSg && domSg.fields[j] === fname,
            `pos ${j} got="${domSg && domSg.fields[j]}"`);
        });
      }
    } else {
      grp.fields.forEach((fname, j) => {
        check(`field:${grp.folder}:${fname}`, !!dom && dom.flat[j] === fname,
          `pos ${j} got="${dom && dom.flat[j]}"`);
      });
    }
  }

  // 110-113 — four Additional Info subgroups: order + count (23/30/14/10) counted from the DOM.
  const domAI = byName("Additional Info");
  SUBGROUP_EXPECT.forEach(([sgName, count], i) => {
    const domSg = domAI && domAI.subgroups[i];
    check(`subgroup-seq-${i + 1}:${sgName}`, !!domSg && domSg.name === sgName && domSg.fields.length === count,
      `got="${domSg && domSg.name}" domCount=${domSg && domSg.fields.length} expect=${count}`);
  });

  // 112-114 — D1 identity header: name, formatted phone, combined address.
  // Source the contact from the ghl-proxy single-record response ONLY. The page also
  // calls /ghl-contact (getOne), whose curated ContactRow satisfies the same id +
  // name predicate but carries NO customFields — a content-only match races between
  // the two and silently yields wire="" (OBSERVED 2026-07-28). Match the ENDPOINT,
  // as the grid capture at line 93 does, not the shape.
  const contact = fnBodies
    .filter((b) => /\/ghl-proxy\?/.test(b.url) && /%2Fcontacts%2F/i.test(b.url))
    .map((b) => (b.json && (b.json.contact || b.json)))
    .find((c) => c && c.id === TARGET && ("phone" in c || "firstName" in c || "lastName" in c)) || null;
  const wireNotes = (() => {
    const vals = (contact && contact.customFields) || [];
    const entry = vals.find((v) => v && v.id === PROPERTY_NOTES_ID);
    return entry == null || entry.value == null ? "" : String(entry.value);
  })();
  const expName = contact ? ([contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown") : null;
  const expPhone = contact ? (formatPhone(contact.phone) || "—") : null;
  const expAddr = contact ? formatAddress(contact) : null;
  check("identity-name-h1", !!contact && rec.identityName.length > 0 && rec.identityName.toLowerCase() === expName.toLowerCase(),
    `dom="${rec.identityName}" expect="${expName}"`);
  check("identity-phone-formatted", !!contact && rec.identityPhone === expPhone,
    `dom="${rec.identityPhone}" expect="${expPhone}" raw="${contact && contact.phone}"`);
  check("identity-address-combined", !!contact && rec.identityAddress === expAddr,
    `dom="${rec.identityAddress}" expect="${expAddr}"`);

  /* ═══ Board #5 S1 + S2 — THE PERSISTENT CALL RAIL ═══════════════════════
     REPLACES S1's proposed "rail carries no numeric content" check, which was
     written when the rail had no data path. It expires here by design: S2
     legitimately introduces a figure, so the invariant is no longer "no
     numbers" but "the RIGHT number, labelled with the source that supplied
     it". The five-item check-10 succession contract is NOT all provable here
     -- see the offline/live coverage map in the S2 report. This fixture takes
     ONE branch and only that branch is live-proven.

     ⚠ THE PREDICTION, RECORDED BEFORE THESE ASSERTIONS WERE WRITTEN and
     before any deploy. Four read-only Production measurements, 2026-08-28,
     on CONTACTS.neelima = FiIT0hUaxVCIuokQpZuc:

       1. Seller Leads Pipeline Opportunities belonging to Neelima : 1
          (id 1AP9BfFPJ2xYZ0RPTm9U, "Neelima Bale", status open)
       2. that Opportunity's Asking Price : ABSENT
          -- confirmed absent in BOTH the singular GET and, decisively, in the
             ghl-opportunities list payload the rail actually parses
       3. Neelima's CONTACT Asking Price : 115000
       4. that Opportunity's Seller MAO  : ABSENT (same two reads)

     Through the S2 contract those four facts predict the COMPLETE rail:

       Seller (identity)        "Neelima Bale", equal to the h1
       Seller Ask               "$115,000"   provenance "Contact fallback"   tone value
       Seller MAO               "not yet approved — run Underwriting"        tone waiting, NO provenance
       Current Seller Position  "WAITING on negotiation carrier"             tone waiting
       Current Investor Offer   "WAITING on negotiation semantics / carrier contract"  tone waiting
       container                position sticky, top 0, z-index 1

     Exactly one Opportunity, so it auto-selects and awaiting_selection is NOT
     the branch under test. Opportunity Ask absent + Contact Ask present is
     the CONTACT FALLBACK path -- the single most safety-critical branch,
     because that is where a contact value could pass as Opportunity-owned.
     That it is the branch this fixture takes is luck, not design, and the
     data was NOT altered to obtain it. */
  const railCellOf = (k) => rec.rail.cells.find((c) => c.key === k) || {};
  const railAsk = railCellOf("seller-ask");
  const railMao = railCellOf("seller-mao");

  check("rail-renders-exactly-one", rec.rail.count === 1, `count=${rec.rail.count}`);
  check("rail-is-sticky", rec.rail.position === "sticky" && rec.rail.top === "0px",
    `position="${rec.rail.position}" top="${rec.rail.top}"`);
  /* SEPARATE from rail-is-sticky, not a third condition on it. A combined
     assertion reports "sticky failed" without saying which property moved.
     z-index also has its own failure MEANING: at 1 the CallbackPopover
     (zIndex 20) draws over a stuck rail; raise this and the popover hides
     behind it. That is a different defect from "the rail stopped sticking". */
  check("rail-zindex-is-1", rec.rail.zIndex === "1", `zIndex="${rec.rail.zIndex}"`);
  check("rail-four-cells-in-order",
    JSON.stringify(rec.rail.cells.map((c) => c.key)) ===
      JSON.stringify(["seller-ask", "seller-mao", "seller-position", "investor-offer"]),
    `keys=${JSON.stringify(rec.rail.cells.map((c) => c.key))}`);
  // S1 risk (b): a sticky figures bar must never outlive the name it belongs to.
  check("rail-identity-matches-h1",
    rec.rail.identity.length > 0 && rec.rail.identity === rec.identityName,
    `rail="${rec.rail.identity}" h1="${rec.identityName}"`);

  check("rail-ask-value", railAsk.primary === "$115,000", `dom="${railAsk.primary}"`);
  check("rail-ask-tone-is-value", railAsk.tone === "value", `tone="${railAsk.tone}"`);
  // THE DISCLOSURE. A contact value must be labelled a contact value.
  /* §4A — the wording now states WHY the contact value governs, not merely
     that it does. "Contact fallback" alone read as a mysterious source label. */
  check("rail-ask-provenance-contact-fallback", railAsk.provenance === "Contact fallback — no Opportunity Ask",
    `dom="${railAsk.provenance}" source="${railAsk.provenanceSource}"`);
  check("rail-ask-provenance-not-opportunity", !String(railAsk.provenance).startsWith("Opportunity"),
    `dom="${railAsk.provenance}"`);
  /* §4A — THE ASYMMETRY, on the only branch Production can reach. In the
     contact-fallback state the Opportunity carries no Ask, so the contact
     record IS authoritative and the existing hop lands on the right field.
     The Opportunity branch -- since §4B, route PRESENT (the in-place editor)
     and authority note ABSENT -- is OFFLINE-ONLY: 0 of 43 Production
     opportunities carry an Ask, so no fixture reaches it and manufacturing one
     is forbidden. test-rail.cjs holds those. */
  check("rail-ask-fallback-offers-route",
    railAsk.route === "Edit on the Contact in GHL" && railAsk.routeKind === "contact-record",
    `label="${railAsk.route}" kind="${railAsk.routeKind}"`);
  /* ⚠ MESSAGE CORRECTED FOR §4B, CHECK UNCHANGED. It previously read "(a note
     belongs to the Opportunity branch, which has no route)" — false as of §4B,
     which gave that branch a route and removed its note. The assertion itself
     was always about THIS branch and still is; only the explanation was wrong.
     Kept as a dormant-field guard: authorityNote survives in RailCellView for
     future no-route states, so the fallback branch must keep proving it does
     not acquire one. */
  check("rail-ask-fallback-has-no-authority-note", railAsk.authorityNote === null,
    `note=${JSON.stringify(railAsk.authorityNote)} (the contact-fallback branch explains itself with provenance and a route, never a note)`);

  /* ── Board #5 §4B — three new checks ───────────────────────────────────────
     ⚠ ALL THREE ASSERT THE CONTACT-FALLBACK BRANCH, which is the only branch
     any Production contact reaches: 0 of 43 opportunities carry an Ask. The
     rail EDITOR itself is unreachable here by construction and is proven
     offline in test-rail plus, separately, by the Production wire proof. */
  check("contact-ask-row-states-governing-fallback",
    rec.askAuthority !== null
      && rec.askAuthority.value === "contact"
      && rec.askAuthority.text === "Contact Asking Price — governing fallback",
    `authority=${JSON.stringify(rec.askAuthority)}`);

  /* Item 7 is DISPLAY-ONLY. An input inside this row would mean §4B had made
     the fallback carrier editable — the first step toward the shadow copy the
     tranche exists to avoid. */
  check("contact-ask-row-is-display-only",
    rec.askAuthority !== null && rec.askAuthority.inputsInRow === 0,
    `inputsInRow=${rec.askAuthority ? rec.askAuthority.inputsInRow : "row absent"}`);

  /* ⚠ §4C INVERTS THE §4B CHECK, DELIBERATELY. §4B asserted the fallback
     branch carried NO edit control -- correct then, false now. Origination is
     the whole point: 0 of 43 Production opportunities carry an Ask, so if the
     editor were reachable only from the Opportunity branch the write authority
     would be unreachable by the operator on every deal. The editor is offered
     here, beside a truthfully-labelled Contact fallback. */
  check("rail-ask-fallback-offers-origination",
    rec.railAskEditor.originate === 1 && rec.railAskEditor.originateLabel === "Set Opportunity Ask"
      && rec.railAskEditor.input === 0 && rec.railAskEditor.warning === 0
      /* ⚠ AND THE VALUE IS NOT DUPLICATED. rail-ask-display is edit mode's
         clickable number; origination must not render a second copy of a value
         rail-state already shows. Additive means BESIDE the value, not a
         duplicate of it. */
      && rec.railAskEditor.display === 0,
    `originate=${rec.railAskEditor.originate} label=${JSON.stringify(rec.railAskEditor.originateLabel)} inputAtRest=${rec.railAskEditor.input} warning=${rec.railAskEditor.warning} duplicateValue=${rec.railAskEditor.display}`);

  /* Both affordances, doing different things. The GHL hop stays because in
     THIS state the Contact value genuinely governs and IAOS cannot write it --
     removing it would leave no path to correct the number being obeyed. */
  check("rail-ask-fallback-keeps-contact-route",
    railAsk.routeKind === "contact-record" && rec.railAskEditor.originate === 1,
    `routeKind=${railAsk.routeKind} originate=${rec.railAskEditor.originate}`);

  /* ── §4C ORIGINATION, ACTIVATED ────────────────────────────────────────
     ⚠ PB-D17 STILL BINDS: THE HARNESS MODIFIES NOTHING. It opens the editor,
     reads the draft, and Escapes. PB-D22 makes an empty draft a no-op exit, so
     no PUT is issued -- harness-issued-no-writes remains the machine check on
     that, across the whole run. Nothing is typed. */
  const askState = () => page.evaluate(() => {
    const q = (t) => document.querySelector(`[data-testid="${t}"]`);
    const input = q("rail-ask-input");
    /* ⚠ THE VALUE ELEMENT, not rail-ask-display. In ORIGINATION the value lives
       in rail-state-seller-ask and the affordance is a SIBLING outside it --
       that separation is the fix this run exists to prove. rail-ask-display is
       edit mode's clickable number and is deliberately absent here. */
    const value = q("rail-state-seller-ask");
    const display = q("rail-ask-display");
    const prov = q("rail-provenance-seller-ask");
    return {
      input: input ? 1 : 0,
      draft: input ? input.value : null,
      display: display ? 1 : 0,
      valueText: value ? (value.textContent || "").replace(/\s+/g, " ").trim() : null,
      provenance: prov ? (prov.textContent || "").replace(/\s+/g, " ").trim() : null,
      provenanceSource: prov ? prov.getAttribute("data-rail-source") : null,
      originate: q("rail-ask-originate") ? 1 : 0,
    };
  });
  const askBefore = await askState();
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="rail-ask-originate"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const askOpen = await askState();

  /* ⚠ THE SHADOW-COPY GUARD, AT RENDER LEVEL. seed is null in origination, so
     the draft MUST open EMPTY. If it opened on the Contact number, one Enter
     would write an Opportunity Ask equal to the Contact Ask -- a synchronized
     shadow copy created by the UI, which this tranche forbids outright. */
  check("rail-ask-origination-draft-opens-empty",
    askOpen.input === 1 && askOpen.draft === "",
    `input=${askOpen.input} draft=${JSON.stringify(askOpen.draft)}`);

  /* ⚠ ADDITIVE, NOT A SWAP. PB-D17 Model B swaps a display for an editor
     because they are the SAME value. Here they are different carriers: the
     display is the CONTACT ask, the edit targets the OPPORTUNITY ask. The
     fallback and its provenance must stay on screen, or the UI would be
     telling Brad he is editing the number he can see. */
  check("rail-ask-origination-does-not-swap-the-display",
    askOpen.valueText === askBefore.valueText && askOpen.valueText === "$115,000"
      && askOpen.provenance === "Contact fallback — no Opportunity Ask"
      && askOpen.provenanceSource === "contact",
    `value=${JSON.stringify(askOpen.valueText)} was=${JSON.stringify(askBefore.valueText)} prov=${JSON.stringify(askOpen.provenance)} src=${askOpen.provenanceSource}`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const askClosed = await askState();
  check("rail-ask-origination-escape-returns-to-display",
    askClosed.input === 0 && askClosed.originate === 1
      && askClosed.valueText === askBefore.valueText,
    `input=${askClosed.input} originate=${askClosed.originate} value=${JSON.stringify(askClosed.valueText)}`);
  check("rail-mao-not-yet-approved", railMao.primary === "not yet approved — run Underwriting",
    `dom="${railMao.primary}"`);
  check("rail-mao-tone-is-waiting", railMao.tone === "waiting", `tone="${railMao.tone}"`);
  // Absence discloses nothing -- there is no source to name.
  check("rail-mao-renders-no-provenance", railMao.provenance === null,
    `dom="${railMao.provenance}"`);
  check("rail-position-waiting-verbatim",
    railCellOf("seller-position").primary === "WAITING on negotiation carrier",
    `dom="${railCellOf("seller-position").primary}"`);
  check("rail-offer-waiting-verbatim",
    railCellOf("investor-offer").primary === "WAITING on negotiation semantics / carrier contract",
    `dom="${railCellOf("investor-offer").primary}"`);

  /* ═══ Board #5 S3 — OCCUPANCY, template choice-single + immediate ═══════════
     The first `choice` unlock. PB-D11 lists choice + immediate as the ONLY
     permitted pair for this editor, so the behaviour under test is the
     taxonomy's, not a local invention.

     ⚠ THESE FOUR ARE SCOPED TO THE RECOGNISED-OR-EMPTY STATE, which this
     fixture supplies. ChoiceRow has a THIRD state: a stored value that is not
     one of the field's options renders raw, marked read-only, with NO option
     controls, NO clear control and no activation — an early return, so the
     editing branch is structurally unreachable there. That branch renders
     NEITHER a label NOR — and is NOT described by these checks. Do not read it
     as a Check 1 violation, and do not "fix" it by loosening Check 1. It is
     inspection-proven only: exercising it live would require manufacturing a
     bad Production value, which is forbidden, and a seam would prove the
     classifier while proving nothing about the read-only enforcement.

     ⚠ PRE-RECORDED PREDICTION, measured before these assertions were written
     and before any deploy. ONE read-only GET, 2026-08-29:

       GET /contacts/FiIT0hUaxVCIuokQpZuc   (CONTACTS.neelima)
       occupancy_status : FIELD ABSENT — the key is not present on the record

     Bradt75's KEY_ABSENT was NOT reused: that measurement was taken for the S3c
     write fixture and is a different contact. Neelima was read on her own.

     Through the template those facts predict:
       at rest      field-display-{OCC} renders exactly "—"; zero option controls
       activated    display gone; exactly 3 options, GHL's own order
                    ["Owner Occupied","Tenant Occupied","Vacant"], each enabled
                    and not readonly
       selection    ZERO options selected — the empty branch of Check 3, not the
                    exactly-one branch
       controls     no field-save-{OCC}, no field-cancel-{OCC},
                    field-clear-{OCC} exactly once

     ⚠ HARNESS WRITE-SAFETY, PB-D17, AND IT MATTERS MORE HERE THAN ANYWHERE.
     Under `immediate` A CLICK IS A WRITE. This block activates the display,
     inspects, and exits with Escape. It NEVER clicks an option and NEVER clicks
     Clear. Check 3 reads selection state from the DOM rather than producing it.
     Nobody adds a "does clicking commit" assertion here — that is S3c's
     controlled write, and putting it in the harness would mutate a real contact
     on every run. */
  const OCC_ID = "op57wOVFSMRBFbHmD6ej"; // contact.occupancy_status — hardcoded per the verification-only rule
  const OCC_OPTIONS = ["Owner Occupied", "Tenant Occupied", "Vacant"];

  /* Settle an interaction on the EXPECTED STATE rather than a fixed timeout --
     this file's own convention, already used four times above.
     Playwright's signature is waitForFunction(pageFunction, arg, options); the
     id travels as `arg` and the timeout as `options`.
     The timeout is SWALLOWED on purpose: the assertion that follows then
     reports the OBSERVED counts, which diagnoses the failure, instead of a
     Playwright stack that only says something did not happen. */
  const settleFor = async (pred) => {
    try { await page.waitForFunction(pred, OCC_ID, { timeout: 5000 }); } catch (e) { /* the assertion after reports it */ }
  };

  const occRest = await page.evaluate((id) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const d = document.querySelectorAll(`[data-testid="field-display-${id}"]`);
    return {
      displayCount: d.length,
      displayText: d.length === 1 ? norm(d[0].textContent) : "",
      unrecognised: d.length === 1 ? d[0].getAttribute("data-unrecognised") : null,
      optionsAtRest: document.querySelectorAll(`[data-testid^="field-option-${id}-"]`).length,
      clearAtRest: document.querySelectorAll(`[data-testid="field-clear-${id}"]`).length,
    };
  }, OCC_ID);
  check("choice-display-present",
    occRest.displayCount === 1 && occRest.displayText === "—" &&
      occRest.optionsAtRest === 0 && occRest.clearAtRest === 0,
    `displayCount=${occRest.displayCount} text="${occRest.displayText}" optionsAtRest=${occRest.optionsAtRest} clearAtRest=${occRest.clearAtRest} unrecognised=${occRest.unrecognised}`);

  /* ACTIVATE. Inspect. Exit. No option is ever clicked.
     SETTLE FIRST, using this file's own convention (waitForFunction, already
     used four times here) rather than a fixed timeout. This activation would
     fail CLOSED if it raced -- checks 2-4 would see zero options and go red --
     but relying on that is relying on luck, and the decline block below has a
     failure mode where racing fails OPEN. Settle both. */
  /* IN-PAGE element.click(), NOT page.click(). The Occupancy row is MOUNTED but
     HIDDEN by its collapsed Investor parent (display:none), so a
     visibility-aware Playwright click times out -- observed on the first live
     run, 30s at this line. Identical to the ARV activation below and adopted
     from it.
     It also happens to be the SAFER dispatch here: element.click() fires only a
     `click`, never a `mousedown`, so it cannot trip this editor's
     document-level click-outside listener the way a real pointer gesture could. */
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="field-display-${id}"]`);
    if (el) el.click();
  }, OCC_ID);
  await settleFor((id) => document.querySelectorAll(`[data-testid^="field-option-${id}-"]`).length === 3);
  const occEdit = await page.evaluate((id) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const opts = [...document.querySelectorAll(`[data-testid^="field-option-${id}-"]`)];
    return {
      displayGone: document.querySelectorAll(`[data-testid="field-display-${id}"]`).length === 0,
      labels: opts.map((o) => norm(o.textContent)),
      testids: opts.map((o) => o.getAttribute("data-testid")),
      allEnabled: opts.every((o) => !o.disabled && o.getAttribute("aria-readonly") !== "true"),
      selected: opts.filter((o) => o.getAttribute("data-selected") === "true").map((o) => norm(o.textContent)),
      saveCount: document.querySelectorAll(`[data-testid="field-save-${id}"]`).length,
      cancelCount: document.querySelectorAll(`[data-testid="field-cancel-${id}"]`).length,
      clearCount: document.querySelectorAll(`[data-testid="field-clear-${id}"]`).length,
    };
  }, OCC_ID);

  check("choice-edit-reveals-options",
    occEdit.displayGone &&
      JSON.stringify(occEdit.labels) === JSON.stringify(OCC_OPTIONS) &&
      JSON.stringify(occEdit.testids) === JSON.stringify(OCC_OPTIONS.map((_, n) => `field-option-${OCC_ID}-${n}`)) &&
      occEdit.allEnabled,
    `displayGone=${occEdit.displayGone} labels=${JSON.stringify(occEdit.labels)} allEnabled=${occEdit.allEnabled}`);
  // Neelima is EMPTY, so the predicted branch is ZERO selected. Never two.
  check("choice-exactly-one-selected", occEdit.selected.length === 0,
    `selected=${JSON.stringify(occEdit.selected)} expect=[] (wire is empty)`);
  check("choice-commit-surface",
    occEdit.saveCount === 0 && occEdit.cancelCount === 0 && occEdit.clearCount === 1,
    `save=${occEdit.saveCount} cancel=${occEdit.cancelCount} clear=${occEdit.clearCount}`);

  /* ── DECLINE-PATH PROOFS — HARD ABORTS, NOT check() CALL SITES ─────────────
     Same shape as the bundle gate above: a precondition surrounding the four
     checks, not a fifth field invariant. THIS BLOCK ADDS NOTHING TO THE
     FLOOR -- stated as the invariant rather than a number, because the number
     has already moved once since this comment was written.

     Under `immediate` the only exits that do not write are Escape and clicking
     outside. Both are proven here, INDEPENDENTLY, because they are separate
     listeners and a working Escape says nothing about click-outside.

     ⚠ EACH EXIT IS PROVEN, NEVER ASSUMED, AND EACH RE-OPEN IS PROVEN TOO.
     An earlier draft dispatched the outside mousedown immediately after the
     re-open click. If that click had not rendered, editRef.current was still
     null, the handler did nothing, and the exit assertion then read the AT-REST
     state and PASSED — reporting "click-outside exited" when the editor had
     never opened. It FAILED OPEN, which is the one failure mode a hard abort
     must not have. Path 1 was safe only incidentally, because check 4 asserted
     clear === 1 immediately before it. Path 2 had no such anchor, so it gets an
     explicit one: the editor is proven OPEN before the dispatch.

     PB-D17 holds throughout: NO option is ever chosen and Clear is never
     clicked. Under `immediate`, click count is write count. */
  const occState = () => page.evaluate((id) => ({
    display: document.querySelectorAll(`[data-testid="field-display-${id}"]`).length,
    options: document.querySelectorAll(`[data-testid^="field-option-${id}-"]`).length,
    clear: document.querySelectorAll(`[data-testid="field-clear-${id}"]`).length,
  }), OCC_ID);


  // exit 6 — 1-5 are taken (bundle gate, floor, throw, carrier/env, allowlist
  // drift), so a runner can tell a decline-path failure from schema drift.
  const occAbortUnless = (ok, label, st, expected) => {
    if (!ok) {
      console.log(`ABORT — ${label}: expected ${expected}, observed display=${st.display} options=${st.options} clear=${st.clear}`);
      process.exit(6);
    }
    console.log(`decline-path OK  ${label}  display=${st.display} options=${st.options} clear=${st.clear}`);
  };

  const AT_REST = (st) => st.display === 1 && st.options === 0 && st.clear === 0;
  /* clear === 0 is a THIRD term beyond the ruling's display/options pair. It
     catches a half-exit where the options are gone but the clear affordance
     lingers. Strictly stronger than what was authorized; recorded as such. */
  const IS_OPEN = (st) => st.display === 0 && st.options === 3 && st.clear === 1;

  // PATH 1 — Escape. The editor is open: check 4 asserted clear === 1 above.
  await page.keyboard.press("Escape");
  await settleFor((id) => document.querySelectorAll(`[data-testid="field-display-${id}"]`).length === 1);
  let occSt = await occState();
  occAbortUnless(AT_REST(occSt), "Escape exited the occupancy editor", occSt, "at-rest (display=1 options=0 clear=0)");

  /* PATH 2 — click outside. Re-open, PROVE OPEN, then dispatch a bubbling
     mousedown on document.body.

     BODY IS INERT BY CONSTRUCTION, not by belief: no coordinates are involved
     so nothing is hit-tested onto a control, no node is injected into the page
     under test, and body is outside editRef by definition — which is the exact
     condition the handler tests. Under `immediate` some clicks on this page
     are writes, so "a control I believe is safe" is not the standard.

     This exercises the LISTENER. The hit-testing path it skips was measured
     separately at the ruling and is deliberately NOT restated here: that is
     point-in-time evidence at one SHA, not a product invariant, and it would
     become false the day someone adds a mousedown handler. */
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="field-display-${id}"]`);
    if (el) el.click();
  }, OCC_ID);
  await settleFor((id) => document.querySelectorAll(`[data-testid^="field-option-${id}-"]`).length === 3);
  occSt = await occState();
  occAbortUnless(IS_OPEN(occSt), "re-open before the outside dispatch", occSt, "editor open (display=0 options=3 clear=1)");

  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await settleFor((id) => document.querySelectorAll(`[data-testid="field-display-${id}"]`).length === 1);
  occSt = await occState();
  occAbortUnless(AT_REST(occSt), "click-outside exited the occupancy editor", occSt, "at-rest (display=1 options=0 clear=0)");

  /* Board #5 D1 - RETURN REVALIDATION.
     STRUCTURAL BEHAVIOUR, NOT A FIELD UNLOCK. N stays 4 and 4N stays 16; the
     rail's "+14 ... NOT a per-unlock term" note at the top of this file is the
     precedent. These four price a behaviour, not an editor.

     The defect: the contact fetch is keyed on [id] and nothing revalidated, so
     a tab-hop to GHL and back left PRE-CALL data on screen - including Seller
     Ask and Seller MAO on a sticky bar whose whole justification is that a
     guardrail you cannot see is not a guardrail.

     READ-ONLY THROUGHOUT. These checks simulate returning to the tab. A return
     must never write, and the editor used in checks 3-4 is closed with the
     already-proven ESCAPE decline path - no option click, no Clear. Under
     `immediate`, click count is write count. */
  const CW_SEL = '[data-testid="contact-workspace"]';
  const refreshState = () => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      count: el ? Number(el.getAttribute("data-refresh-count")) : -1,
      openEditors: el ? Number(el.getAttribute("data-open-editors")) : -1,
      deferred: el ? el.getAttribute("data-refresh-deferred") : null,
      /* §4C — the save-triggered read has its own cause and its own counter.
         D1 must never satisfy it and it must never satisfy D1. */
      saveCount: el ? Number(el.getAttribute("data-save-refresh-count")) : -1,
    };
  }, CW_SEL);

  /* Simulate leaving the tab. visibilityState is not writable, so it is
     redefined - the page reads document.visibilityState inside its handler, so
     the redefinition is what the handler actually sees. */
  const goHidden = () => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const signalVisible = () => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const signalFocus = () => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    window.dispatchEvent(new Event("focus"));
  });
  /* Wait for the SPECIFIC state each check asserts, never a page milestone.
     For "no refresh" there is nothing to wait FOR, so those settle on a bounded
     idle - the only case in this block where elapsed time is the evidence. */
  const settleRefresh = async (target) => {
    try {
      await page.waitForFunction((a) => {
        const el = document.querySelector(a.sel);
        return !!el && Number(el.getAttribute("data-refresh-count")) >= a.t;
      }, { sel: CW_SEL, t: target }, { timeout: 15000 });
    } catch (e) { /* the assertion reports the observed count */ }
  };

  // 1 - idle return refetches, exactly once.
  const r0 = await refreshState();
  await goHidden();
  await signalVisible();
  await settleRefresh(r0.count + 1);
  await page.waitForTimeout(1500); // a SECOND refresh would land in this window
  const r1 = await refreshState();
  check("return-refetch-when-idle", r0.openEditors === 0 && r1.count === r0.count + 1,
    `openEditors=${r0.openEditors} count ${r0.count} -> ${r1.count} (expect +1)`);

  /* §4C — D1 ISOLATION. A return revalidation is not a save, and must not be
     counted as one. The save path never touches refreshDeferred and never
     calls refreshAll, so a full return must move data-refresh-count and leave
     data-save-refresh-count exactly where it was. ⚠ The converse -- that a
     save does not increment the D1 counter -- needs an actual write, so it
     belongs to the scripted proof, not here. */
  check("d1-return-revalidation-does-not-increment-save-counter",
    r1.saveCount === r0.saveCount && r0.saveCount >= 0,
    `saveCount ${r0.saveCount} -> ${r1.saveCount} (expect unchanged) while refresh ${r0.count} -> ${r1.count}`);

  /* 2 - THE TWO RETURN SIGNALS COALESCE, AND BOTH ARE ALIVE.
     A REFRESH COUNTER ALONE CANNOT PROVE THIS. "both fired, one refresh" and
     "only one fired, one refresh" produce the same count, so a naive check
     passes for the wrong reason - the same shape as the click-outside
     fail-open hole. The dispatch has to be made observable, and it is made so
     by CONJUNCTION rather than by instrumenting production code.

     THREE CLAUSES, because two had a fail-open route that was the MIRROR of
     the one they fixed. Walk a DEAD visibilitychange listener through the
     original pair: both-dispatched handled only by focus gives +1 and passes,
     focus-alone gives +1 and passes. A dead visibilitychange satisfied the
     whole check - and visibilitychange is the MORE load-bearing signal here,
     because returning to a tab in an already-focused window may produce no
     useful focus transition at all. The check could have gone green while the
     signal carrying Brad's actual return from GHL was dead.

       A both        visibilitychange(visible) + focus -> exactly +1
       B focus       focus alone                       -> exactly +1
       C visibility  visibilitychange(visible) alone   -> exactly +1

     A proves they coalesce; B proves the focus path works; C proves the
     visibility path works. Each alternative explanation is excluded by a
     different clause rather than by the expected number appearing.

     EACH CLAUSE TAKES ITS OWN HIDE. The wasHidden latch is cleared by
     whichever handler runs first, so B and C cannot inherit A's transition.
     DELTAS, NEVER CUMULATIVE COUNTS: a cumulative assertion lets a missed
     refresh in one clause shift every later one, collapsing three independent
     clauses back into one.

     THE SIGNALS ARE SYNTHETIC, AND THE CLAIM IS BOUNDED TO MATCH. Each helper
     redefines document.visibilityState and dispatches a constructed event.
     These clauses prove the IAOS listeners respond correctly when the browser
     delivers the expected event. They do NOT prove that a real OS/browser
     tab-return gesture generates that event -- the same evidence boundary as
     the synthetic click-outside proof above: listener behaviour proven,
     physical gesture delivery not proven. Do not write these up as proof of
     the physical return.
     Clause C does genuinely isolate visibilitychange: it dispatches no focus
     event, and the only focus dispatch in this file is signalFocus.

     A DEAD LISTENER IS AN EXPECTED NEGATIVE CONDITION HERE, so settleRefresh
     SWALLOWS its timeout by design. The clause then resolves to a delta of 0
     and check() owns the failure with its own diagnostic -- "focus-alone=0"
     rather than an opaque HARNESS THREW. A negative-path test whose negative
     path crashes the machinery is weaker than it claims to be. Cost of that
     design: a genuinely dead listener spends the 15s settle before reporting. */
  const returnDelta = async (fire) => {
    const before = await refreshState();
    await goHidden();
    await fire();
    await settleRefresh(before.count + 1);
    await page.waitForTimeout(1500); // a SECOND refresh would land in this window
    const after = await refreshState();
    return after.count - before.count;
  };

  const dBoth  = await returnDelta(async () => { await signalVisible(); await signalFocus(); });
  const dFocus = await returnDelta(async () => { await signalFocus(); });
  const dVis   = await returnDelta(async () => { await signalVisible(); });
  check("return-coalesces-focus-and-visibility",
    dBoth === 1 && dFocus === 1 && dVis === 1,
    `both=${dBoth} (expect 1, not 2) focus-alone=${dFocus} (expect 1, proves focus is live) visibility-alone=${dVis} (expect 1, proves visibilitychange is live)`);

  // 3 - an open editor DEFERS the refresh.
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="field-display-${id}"]`);
    if (el) el.click();
  }, OCC_ID);
  await settleFor((id) => document.querySelectorAll(`[data-testid^="field-option-${id}-"]`).length === 3);
  const rOpen = await refreshState();
  await goHidden();
  await signalVisible();
  await page.waitForTimeout(2500);           // a refresh, if it came, lands here
  const rDeferred = await refreshState();
  check("return-defers-while-editing",
    rOpen.openEditors === 1 && rDeferred.count === rOpen.count && rDeferred.deferred === "true",
    `openEditors=${rOpen.openEditors} count ${rOpen.count} -> ${rDeferred.count} (expect unchanged) deferred=${rDeferred.deferred}`);

  /* 4 - exiting the editor releases exactly one deferred refresh.
     Closed with ESCAPE, the proven non-writing decline path. */
  await page.keyboard.press("Escape");
  await settleFor((id) => document.querySelectorAll(`[data-testid="field-display-${id}"]`).length === 1);
  await settleRefresh(rDeferred.count + 1);
  await page.waitForTimeout(1500);
  const rReleased = await refreshState();
  check("return-refetch-after-editor-exits",
    rReleased.count === rDeferred.count + 1 && rReleased.openEditors === 0 && rReleased.deferred === "false",
    `count ${rDeferred.count} -> ${rReleased.count} (expect +1) openEditors=${rReleased.openEditors} deferred=${rReleased.deferred}`);

  // 115-118 — Phone 2-5 DNC each adjacent to its Phone N in Reachability (position order).
  const reach = (domAI && domAI.subgroups.find((s) => s.name === "Reachability")) || { fields: [] };
  for (const n of [2, 3, 4, 5]) {
    const pi = reach.fields.indexOf(`Phone ${n}`);
    const di = reach.fields.indexOf(`Phone ${n} DNC`);
    check(`dnc-adjacent:Phone ${n}`, pi >= 0 && di === pi + 1, `Phone ${n}@${pi} Phone ${n} DNC@${di}`);
  }

  // 119 — allowlist: no inputs in scope except the unlocked field's. Checks 120-127 follow.
  // Targets the stable data-testid hooks; a MISSING hook is a FAILURE, never a zero-input pass.
  if (rec.unlockedId !== PROPERTY_NOTES_ID) { console.log("ABORT - allowlist ID drift between Node and browser scope"); process.exit(5); }

  check("no-input-outside-allowlist",
    !rec.scopeMissing && rec.identityInputs === 0 && rec.strayInputs === 0,
    `scopeMissing=${rec.scopeMissing} identityInputs=${rec.identityInputs} strayInputs=${rec.strayInputs} allowlisted=${rec.allowlistedInputs}`);

  check("unlocked-textarea-present",
    rec.unlocked.count === 1 && rec.unlocked.tag === "TEXTAREA" && rec.unlocked.disabled === false && rec.unlocked.readOnly === false,
    `count=${rec.unlocked.count} tag=${rec.unlocked.tag} disabled=${rec.unlocked.disabled} readOnly=${rec.unlocked.readOnly}`);

  check("unlocked-textarea-value-from-wire",
    wireNotes !== "" && rec.unlocked.value === wireNotes,
    `dom=${JSON.stringify(rec.unlocked.value)} wire=${JSON.stringify(wireNotes)}`);

  check("unlocked-save-present", rec.unlocked.saveCount === 1,
    `saveCount=${rec.unlocked.saveCount}`);

  check("unlocked-cancel-present", rec.unlocked.cancelCount === 1,
    `cancelCount=${rec.unlocked.cancelCount}`);

  // ── 124-127 — ARV, currency + inline (PB-D17). Node-side drift guard first. ──
  if (rec.arvId !== ARV_ID) { console.log("ABORT - ARV allowlist ID drift between Node and browser scope"); process.exit(5); }

  const wireArv = (() => {
    const vals = (contact && contact.customFields) || [];
    const entry = vals.find((v) => v && v.id === ARV_ID);
    if (entry == null || entry.value == null || entry.value === "") return "";
    const n = Number(entry.value);
    return Number.isNaN(n) ? "" : n;
  })();
  // Harness-local copy of the app's currency display transform (NOT imported).
  const expArvDisplay = wireArv === ""
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(wireArv);

  check("currency-display-present",
    rec.arv.displayCount === 1 && rec.arv.inputAtRest === 0,
    `displayCount=${rec.arv.displayCount} inputAtRest=${rec.arv.inputAtRest}`);

  check("currency-display-formatted",
    wireArv !== "" && rec.arv.displayText === expArvDisplay,
    `dom=${JSON.stringify(rec.arv.displayText)} expect=${JSON.stringify(expArvDisplay)} wire=${JSON.stringify(wireArv)}`);

  // ACTIVATION. The ARV row is MOUNTED but hidden by its collapsed Investor parent
  // (display:none, ContactWorkspace line 798), so a visibility-aware Playwright
  // click would time out. An in-page element.click() fires the React handler
  // regardless of visibility — same precedent as the sort-header click above.
  // PB-D17 harness write-safety: this harness types NOTHING and dispatches NO
  // blur. Blur is a commit path under inline, so manufacturing one inside a
  // read-only harness would be a write. The editor is deliberately left OPEN —
  // checks 126-127 are the last checks ON THIS PAGE and nothing further touches
  // it. (Until board item #2B this said "the last checks in this file", which
  // stopped being true when repairs and D5 parity were added. The invariant that
  // matters was always per-page, not per-file: every later check runs on a page
  // of its own precisely so this editor is never blurred.)
  await page.evaluate((id) => {
    const el = document.querySelector('[data-testid="field-display-' + id + '"]');
    if (el) el.click();
  }, ARV_ID);
  await sleep(300);

  const arvEdit = await page.evaluate((id) => {
    const container = document.querySelector('[data-testid="record-section"]');
    const out = { scopeMissing: !container, count: 0, tag: "", value: null, disabled: null, readOnly: null, saveCount: 0, cancelCount: 0 };
    if (!container) return out;
    const inputs = container.querySelectorAll('[data-testid="field-input-' + id + '"]');
    out.count = inputs.length;
    if (inputs.length === 1) {
      out.tag = inputs[0].tagName;
      out.value = inputs[0].value;
      out.disabled = inputs[0].disabled;
      out.readOnly = inputs[0].readOnly;
    }
    out.saveCount = container.querySelectorAll('[data-testid="field-save-' + id + '"]').length;
    out.cancelCount = container.querySelectorAll('[data-testid="field-cancel-' + id + '"]').length;
    return out;
  }, ARV_ID);

  check("currency-edit-raw-value",
    !arvEdit.scopeMissing && arvEdit.count === 1 && arvEdit.tag === "INPUT" &&
    arvEdit.disabled === false && arvEdit.readOnly === false &&
    wireArv !== "" && arvEdit.value === String(wireArv),
    `count=${arvEdit.count} tag=${arvEdit.tag} value=${JSON.stringify(arvEdit.value)} expect=${JSON.stringify(String(wireArv))} disabled=${arvEdit.disabled} readOnly=${arvEdit.readOnly}`);

  check("currency-no-commit-controls",
    arvEdit.saveCount === 0 && arvEdit.cancelCount === 0,
    `saveCount=${arvEdit.saveCount} cancelCount=${arvEdit.cancelCount}`);

  // ═══ CHECKS 128-131 — ESTIMATED REPAIRS, the N=3 unlock (board item #2B) ═══
  //
  // A DEDICATED PAGE, for the reason check 127 states about itself: an activated
  // inline editor is the LAST thing done on its page, because blur is a commit
  // path and clicking anything else on that page manufactures one. ARV's editor
  // is open on `page` right now. Repairs therefore gets its own page, is checked
  // at rest and then activated, and that page is likewise never touched again.
  //
  // Repairs shares ARV's row component in the app, so these four checks are the
  // SAME four, asserted against the second field. That is the point: sharing the
  // component is only safe if both consumers are observed, and a shared component
  // verified through one consumer is a component verified for one field.
  //
  // Node-side drift guard first, mirroring check 124's.
  if (typeof ESTIMATED_REPAIRS_ID !== "string" || ESTIMATED_REPAIRS_ID.length < 10) {
    console.log("ABORT - ESTIMATED_REPAIRS allowlist ID missing or malformed in Node scope");
    process.exit(5);
  }

  const wireRepairs = (() => {
    const vals = (contact && contact.customFields) || [];
    const entry = vals.find((v) => v && v.id === ESTIMATED_REPAIRS_ID);
    if (entry == null || entry.value == null || entry.value === "") return "";
    const n = Number(entry.value);
    return Number.isNaN(n) ? "" : n;
  })();
  // Harness-local copy of the app's currency display transform (NOT imported),
  // same rule as check 125's.
  const expRepairsDisplay = wireRepairs === ""
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(wireRepairs);

  const pageR = await ctx.newPage();
  await pageR.goto(`${ORIGIN}/contacts/${TARGET}`, { waitUntil: "load" });
  await sleep(2500);

  const repRest = await pageR.evaluate((id) => {
    const container = document.querySelector('[data-testid="record-section"]');
    const out = { scopeMissing: !container, displayCount: 0, displayText: "", inputAtRest: 0 };
    if (!container) return out;
    const dEls = container.querySelectorAll('[data-testid="field-display-' + id + '"]');
    out.displayCount = dEls.length;
    if (dEls.length === 1) out.displayText = (dEls[0].textContent || "").trim();
    out.inputAtRest = container.querySelectorAll('[data-testid="field-input-' + id + '"]').length;
    return out;
  }, ESTIMATED_REPAIRS_ID);

  check("repairs-display-present",
    !repRest.scopeMissing && repRest.displayCount === 1 && repRest.inputAtRest === 0,
    `scopeMissing=${repRest.scopeMissing} displayCount=${repRest.displayCount} inputAtRest=${repRest.inputAtRest}`);

  check("repairs-display-formatted",
    repRest.displayText === expRepairsDisplay,
    `dom=${JSON.stringify(repRest.displayText)} expect=${JSON.stringify(expRepairsDisplay)} wire=${JSON.stringify(wireRepairs)}`);

  // ACTIVATION. Same in-page element.click() as check 126 and for the same reason:
  // the row is mounted but hidden by its collapsed Investor parent, so a
  // visibility-aware Playwright click would time out. Types NOTHING, dispatches NO
  // blur. The editor is left OPEN and nothing follows on this page.
  await pageR.evaluate((id) => {
    const el = document.querySelector('[data-testid="field-display-' + id + '"]');
    if (el) el.click();
  }, ESTIMATED_REPAIRS_ID);
  await sleep(300);

  const repEdit = await pageR.evaluate((id) => {
    const container = document.querySelector('[data-testid="record-section"]');
    const out = { scopeMissing: !container, count: 0, tag: "", value: null, disabled: null, readOnly: null, saveCount: 0, cancelCount: 0 };
    if (!container) return out;
    const inputs = container.querySelectorAll('[data-testid="field-input-' + id + '"]');
    out.count = inputs.length;
    if (inputs.length === 1) {
      out.tag = inputs[0].tagName;
      out.value = inputs[0].value;
      out.disabled = inputs[0].disabled;
      out.readOnly = inputs[0].readOnly;
    }
    out.saveCount = container.querySelectorAll('[data-testid="field-save-' + id + '"]').length;
    out.cancelCount = container.querySelectorAll('[data-testid="field-cancel-' + id + '"]').length;
    return out;
  }, ESTIMATED_REPAIRS_ID);

  check("repairs-edit-raw-value",
    !repEdit.scopeMissing && repEdit.count === 1 && repEdit.tag === "INPUT" &&
    repEdit.disabled === false && repEdit.readOnly === false &&
    repEdit.value === (wireRepairs === "" ? "" : String(wireRepairs)),
    `count=${repEdit.count} tag=${repEdit.tag} value=${JSON.stringify(repEdit.value)} expect=${JSON.stringify(wireRepairs === "" ? "" : String(wireRepairs))} disabled=${repEdit.disabled} readOnly=${repEdit.readOnly}`);

  check("repairs-no-commit-controls",
    repEdit.saveCount === 0 && repEdit.cancelCount === 0,
    `saveCount=${repEdit.saveCount} cancelCount=${repEdit.cancelCount}`);

  // ═══ CHECKS 132-140 — D5 conversation parity ═══
  // Runs on a SEPARATE page, deliberately. Check 127 leaves the ARV inline editor
  // OPEN and possibly focused; blur is a commit path, so navigating THAT page — or
  // clicking anywhere on it — could manufacture a write inside a read-only harness.
  // A second page leaves page 1 in exactly the end state it has today, untouched
  // until browser.close(). Nothing below opens an editor or focuses any input, so
  // no blur-commit path is reachable here either.
  const page2 = await ctx.newPage();

  // ── 128-131 — Neelima, the regression fixture ──
  await page2.goto(`${ORIGIN}/contacts/${TARGET}`, { waitUntil: "load" });
  await waitForConversations(page2);
  const neeBubbles = await readBubbles(page2);
  const neeRendered = neeBubbles ? neeBubbles.length : -1;

  check("d5-neelima-delta",
    neeRendered === nee.shown && (nee.total - neeRendered) === nee.filtered,
    `rendered=${neeRendered} endpointShown=${nee.shown} total=${nee.total} filteredRemainder=${nee.filtered}`);

  // Longest email body from the ENDPOINT, then located in the DOM by content.
  const neeLongest = nee.messages
    .filter((m) => m.messageType === "TYPE_EMAIL")
    .sort((a, b) => String(b.body || "").length - String(a.body || "").length)[0] || null;
  const neeMark = neeLongest ? String(neeLongest.body || "").replace(/\s+/g, " ").trim().slice(0, 40) : " ";
  const neeTarget = (neeBubbles || []).find((b) => b.body.replace(/\s+/g, " ").includes(neeMark)) || null;

  check("d5-neelima-long-email-collapsed",
    !!neeTarget && neeTarget.isEmail && neeTarget.control === "Expand" &&
    neeTarget.scrollHeight > neeTarget.clientHeight + 1,
    `found=${!!neeTarget} control=${JSON.stringify(neeTarget && neeTarget.control)} scrollH=${neeTarget && neeTarget.scrollHeight} clientH=${neeTarget && neeTarget.clientHeight} bodyLen=${neeLongest && String(neeLongest.body || "").length}`);

  const neeClicked = await clickControlByBody(page2, neeMark);
  await sleep(250);
  const neeAfterExpand = ((await readBubbles(page2)) || []).find((b) => b.body.replace(/\s+/g, " ").includes(neeMark)) || null;

  check("d5-neelima-expand-grows",
    neeClicked && !!neeAfterExpand && neeAfterExpand.control === "Show less" &&
    !!neeTarget && neeAfterExpand.clientHeight > neeTarget.clientHeight,
    `clicked=${neeClicked} control=${JSON.stringify(neeAfterExpand && neeAfterExpand.control)} clientH ${neeTarget && neeTarget.clientHeight} -> ${neeAfterExpand && neeAfterExpand.clientHeight}`);

  const neeClicked2 = await clickControlByBody(page2, neeMark);
  await sleep(250);
  const neeAfterCollapse = ((await readBubbles(page2)) || []).find((b) => b.body.replace(/\s+/g, " ").includes(neeMark)) || null;

  check("d5-neelima-collapse-shrinks",
    neeClicked2 && !!neeAfterCollapse && neeAfterCollapse.control === "Expand" &&
    !!neeAfterExpand && neeAfterCollapse.clientHeight < neeAfterExpand.clientHeight,
    `clicked=${neeClicked2} control=${JSON.stringify(neeAfterCollapse && neeAfterCollapse.control)} clientH ${neeAfterExpand && neeAfterExpand.clientHeight} -> ${neeAfterCollapse && neeAfterCollapse.clientHeight}`);

  // ── 132-136 — Gordon, the exercise fixture ──
  await page2.goto(`${ORIGIN}/contacts/${GORDON}`, { waitUntil: "load" });
  await waitForConversations(page2);
  const gorBubbles = await readBubbles(page2);
  const gorRendered = gorBubbles ? gorBubbles.length : -1;

  // The delta is what proves TYPE_CALL and BOTH TYPE_ACTIVITY_ types stay filtered:
  // the remainder is asserted against the endpoint, not against a literal.
  check("d5-gordon-delta",
    gorRendered === gor.shown && (gor.total - gorRendered) === gor.filtered,
    `rendered=${gorRendered} endpointShown=${gor.shown} total=${gor.total} filteredRemainder=${gor.filtered}`);

  const gorSmsGT  = gor.messages.filter((m) => m.messageType === "TYPE_SMS");
  const gorSmsDom = (gorBubbles || []).filter((b) => b.isSms);

  check("d5-gordon-sms-rendered",
    gorSmsGT.length > 0 && gorSmsDom.length === gorSmsGT.length,
    `domSms=${gorSmsDom.length} endpointSms=${gorSmsGT.length}`);

  const smsOut = gorSmsDom.filter((b) => b.outbound);
  const smsIn  = gorSmsDom.filter((b) => !b.outbound);
  check("d5-gordon-sms-alignment",
    smsOut.length > 0 && smsIn.length > 0 &&
    smsOut.every((b) => b.alignSelf === "flex-end") && smsIn.every((b) => b.alignSelf === "flex-start"),
    `outbound=${smsOut.length}[${[...new Set(smsOut.map((b) => b.alignSelf))].join(",")}] inbound=${smsIn.length}[${[...new Set(smsIn.map((b) => b.alignSelf))].join(",")}]`);

  // SMS is non-collapsible by construction — including the long outbound one, which
  // is longer than several emails that DO collapse.
  const smsLongest = Math.max(0, ...gorSmsGT.map((m) => String(m.body || "").length));
  check("d5-gordon-sms-never-collapses",
    gorSmsDom.length > 0 && gorSmsDom.every((b) => b.control === null),
    `smsBubbles=${gorSmsDom.length} controls=${JSON.stringify(gorSmsDom.map((b) => b.control))} longestSmsChars=${smsLongest}`);

  const gorInEmail = (gorBubbles || []).find((b) => b.isEmail && b.body.includes(GOR_INBOUND_EMAIL_MARK)) || null;
  check("d5-gordon-inbound-email-collapsed",
    !!gorInEmail && !gorInEmail.outbound && gorInEmail.alignSelf === "flex-start" &&
    gorInEmail.control === "Expand" && gorInEmail.scrollHeight > gorInEmail.clientHeight + 1,
    `found=${!!gorInEmail} outbound=${gorInEmail && gorInEmail.outbound} alignSelf=${gorInEmail && gorInEmail.alignSelf} control=${JSON.stringify(gorInEmail && gorInEmail.control)} scrollH=${gorInEmail && gorInEmail.scrollHeight} clientH=${gorInEmail && gorInEmail.clientHeight}`);

  /* ── 179-180 — Board #5 §4D, the two OTHER Production-reachable authority
     states ───────────────────────────────────────────────────────────────────
     Neelima above covers `contact` (checks at :795-806, UNCHANGED). The Step-0
     Production sweep measured exactly three reachable states across all 47
     contacts, so these two close the live set:
       resolved_no_ask   42 of 47 contacts
       no_opportunity     4 of 47 contacts
     The other four situations -- loading, error, awaiting_selection, and
     resolved-with-an-Opportunity-Ask -- have ZERO Production instances and
     CANNOT be checked here. They are proven offline in test-rail.cjs CASE 8.
     Do not read these two greens as covering the mapping; they cover the three
     states Production can actually reach.

     ⚠ THE railSellerAskText TERM IS NOT DECORATION. The rail cell comes from
     railCells(deal) and the row from contactAskAuthority(deal) -- two
     INDEPENDENT projections of one deal read. Asserting they agree is an
     assertion about the state, not about a string existing somewhere. Without
     it these would pass against a row that renders the right words for the
     wrong reason. */
  const readAskAuthority = async (contactId) => {
    await page2.goto(`${ORIGIN}/contacts/${contactId}`, { waitUntil: "load" });
    /* The SAME precondition as :485 -- rail settled AND record-section mounted.
       ⚠ THREE-ARG FORM. waitForFunction(pageFunction, arg, options): passing
       the options object in the ARG slot silently discards the timeout and
       falls back to Playwright's 30s default. Do not author the 2-arg form. */
    await page2.waitForFunction(() => {
      const s = document.querySelector('[data-testid="rail-state-seller-ask"]');
      return s && (s.textContent || "").trim() !== "" && !/^reading Opportunity/.test((s.textContent || "").trim())
        && !!document.querySelector('[data-testid="record-section"]');
    }, null, { timeout: 45000 });
    return page2.evaluate(() => {
      const nz = (s) => (s || "").replace(/\s+/g, " ").trim();
      const authEl = document.querySelector('[data-testid="contact-ask-authority"]');
      const stateEl = document.querySelector('[data-testid="rail-state-seller-ask"]');
      // Located from the authority element and walked UP -- outer row div >
      // inner flex div -- then the display span inside it. Same structural walk
      // as the §4B capture at :613-620; no field id is plumbed in.
      const outerRow = authEl && authEl.parentElement && authEl.parentElement.parentElement;
      const disp = outerRow ? outerRow.querySelector('[data-testid^="field-display-"]') : null;
      return {
        value: authEl ? authEl.getAttribute("data-ask-authority") : null,
        text: authEl ? nz(authEl.textContent) : null,
        displayed: disp ? nz(disp.textContent) : null,
        railSellerAskText: stateEl ? nz(stateEl.textContent) : null,
      };
    });
  };

  const probeAuth = await readAskAuthority(CONTACTS.iaosTestProbe);
  check("contact-ask-row-resolved-no-ask-states-no-value",
    probeAuth.value === "resolved_no_ask"
      && probeAuth.text === "Contact Asking Price — no value"
      && probeAuth.displayed === "—"
      && probeAuth.railSellerAskText === "no ask on Opportunity or Contact",
    `authority=${JSON.stringify(probeAuth)}`);

  /* ⚠ THIS CHECK DELIBERATELY DOES NOT ASSERT `displayed`. All four
     no_opportunity contacts show "—" today, but "contact value only" is correct
     WHETHER OR NOT the contact carrier holds a value -- that independence is
     the entire point of the label. Asserting today's emptiness would turn a
     legitimate future state (an asking price on a contact with no Opportunity)
     into a red. The value is carried in the failure detail, where it informs
     without asserting. */
  const noOppAuth = await readAskAuthority(CONTACTS.testPhoneStatusReset);
  check("contact-ask-row-no-opportunity-states-contact-value-only",
    noOppAuth.value === "no_opportunity"
      && noOppAuth.text === "Contact Asking Price — contact value only"
      && noOppAuth.railSellerAskText === "no Opportunity on this contact",
    `authority=${JSON.stringify(noOppAuth)} (displayed is REPORTED, not asserted)`);

  await browser.close();

  check("harness-issued-no-writes", mutatingRequests.length === 0,
    `mutating requests observed=${mutatingRequests.length} ${JSON.stringify(mutatingRequests.slice(0, 4))}`);

  // ── Self-check: exactly 180, all unique, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} uniqueNames=${names.size} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (names.size !== checksRun) { console.log("ABORT — name-collision detected"); process.exit(4); }
  if (checksRun !== 180) { console.log(`ABORT — expected 180 checks, ran ${checksRun}`); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
