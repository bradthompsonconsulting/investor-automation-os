/* Live verification — Dashboard Lead Queue, PB-D54 cold-outreach exclusion.
   Verifies PB-D54's exclusion predicates against the Lead Queue rendered on
   /dashboard. Runs against the LIVE deploy at app.investorautomationos.com,
   never localhost, and passes the §9.2 bundle gate FIRST — re-pin EXPECTED to
   the bundle under test on every run.

   Floor is 8. Success ONLY when checksRun === 8 AND every check passed.

   EVERY fixture check asserts its PRECONDITION from the endpoint before
   asserting absence from the queue. An absence with an unconfirmed
   precondition proves nothing — a contact missing from the queue because the
   fixture data changed, because the contact was deleted, or because the whole
   table failed to render, is indistinguishable from a working exclusion
   unless the precondition is read live and asserted in the same check
   (docs/TESTING_METHODOLOGY.md). Each check's cond is precondition AND
   assertion, and each detail string prints both halves so a failure says
   which one failed.

   Check 1 exists for the same reason: an empty extraction would make all six
   absence assertions pass vacuously. It is the check that makes the rest
   mean something.

   Check 7 is the positive control. Six absences prove nothing on their own —
   a memo returning an empty Set satisfies all of them. Neelima carries none
   of the six predicates, so she MUST be present.

   Check 8 is the INCLUSION half of check 5's exclusion, and the two are read
   as a pair. Check 5 alone proves only that a Seller Follow-Up contact is
   ABSENT from the Lead Queue — it cannot distinguish "correctly routed to
   the Follow Up section" from "vanished from every surface." That second
   state is not hypothetical: the app was in it between 3e1f152, which added
   the exclusion, and 5cb1329, which added the section. Together the pair
   asserts the whole invariant — a Seller Follow-Up opportunity means absent
   from the Lead Queue AND present in Follow Up. Both halves share ONE
   computed precondition so they can never disagree about whether the fixture
   still qualifies.

   UNEXERCISED BRANCH — recorded, not silently skipped. The offers-awaiting
   predicate (offer sent, response pending) has NO live fixture: no contact
   currently satisfies both the Seller Offer Sent stage and the offer-made
   tag. Manufacturing one would require a GHL write into a stage that triggers
   Seller 7, so the branch is deliberately not exercised and is covered by no
   check below. A passing 7/7 does NOT mean the offers-awaiting predicate
   works.

   Read-only: GET only, zero writes, no page interaction beyond navigation. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-D5pIVH_h.js"; // §9.2 — RE-PIN to the served bundle on every run

// ── Environment + fixture carrier (Gate 4C C4a) ──────────────────────────────
// NO config loader here, deliberately. This harness resolves contact-record
// fixtures ONLY and carries no locationId, so getConfig() would resolve nothing
// and would be dead infrastructure inside a gate instrument. require() reads the
// carrier JSON natively.
//
// Placed ABOVE the §9.2 bundle gate on purpose: a refusal must be genuinely
// offline — no browser launched, no network reached. The gate itself does not
// move.
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

// ── Fixtures, one per exclusion predicate plus the eligible control ──────────
const NEELIMA = CONTACTS.neelima; // eligible control — carries NO predicate
/* The unanswered-inbound fixture is SELECTED FROM THE LIVE ENDPOINT, not
   named here. `NISht1R60heBRhyeMyWp` (palermo) held that role until
   2026-08-17, when the check failed with
   precondition(inUnansweredEndpoint)=false -- his unanswered message had
   been answered or aged out, so the predicate under test no longer applied
   to him and his presence in the queue was CORRECT.

   That was fixture drift, not a regression, and every other fixture here
   is exposed to the same class: an unanswered inbound is transient state
   in a way a terminal stage or a phone status is not.

   WHAT ADAPTS AND WHAT DOES NOT. The invariant is fixed: a contact with
   an unanswered inbound must not appear in the Lead Queue. Only WHICH
   contact satisfies the precondition today is read from the wire. That is
   a different thing from a check that adapts its assertion to what the
   page renders -- this one still fails if the rule is broken, and still
   fails if no fixture exists to test it against. */
const ELLIS   = CONTACTS.nannetaEllis;        // terminal stage
const CARTER  = CONTACTS.summerCarter;        // scheduled callback
const BRADT75 = CONTACTS.bradt75;             // Seller Follow-Up
const PROBE   = CONTACTS.testPhoneStatusReset; // Phone Status = Incorrect Number

// Stage ids — hardcoded here per the verification-only rule (never imported
// from app code), and per PB-D51's deliberate exclusion of stage UUIDs from
// the shared config. Same treatment as Dashboard.tsx's own copies.
const SELLER_FOLLOW_UP_STAGE_ID = "71227a30-2303-4165-aa58-e56860146959";
const TERMINAL_STAGE_IDS = [
  "0c45ee3d-7be7-4651-97a4-6df53f53481b", // Seller Closed-Won
  "f1960b50-8aa2-4a69-ba58-a7a0dc66ce82", // Lost / Not Interested
];

// Endpoint URLs. The unanswered signal comes from ghl-conversations with NO
// query param — read from ghl.ts conversations.unansweredInbound(), not
// guessed. `?scope=all` is the DIFFERENT, unfiltered branch the Conversations
// page uses; passing it here would silently read the wrong set.
const CONTACTS_URL      = `${ORIGIN}/.netlify/functions/ghl-contacts`;
const OPPORTUNITIES_URL = `${ORIGIN}/.netlify/functions/ghl-opportunities`;
const UNANSWERED_URL    = `${ORIGIN}/.netlify/functions/ghl-conversations`;

// A GHL record id — 20 alphanumeric characters. Used by check 1 to prove the
// extraction produced real ids rather than hrefs that merely parsed.
const GHL_ID_RE = /^[A-Za-z0-9]{20}$/;

let checksRun = 0;
const failures = [];
function check(name, cond, detail = "") {
  checksRun++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!cond) failures.push(name);
}

(async () => {
  // ── Bundle gate (§9.2) — prod serves the code under test, FIRST, before any
  //    check. A hard abort, not a check(), so the floor stays exactly 7.
  const idx = await (await fetch(`${ORIGIN}/index.html?cb=${Math.random()}`, { headers: { "Cache-Control": "no-cache" } })).text();
  const liveHash = (idx.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "NONE";
  if (liveHash !== EXPECTED) { console.log(`ABORT — bundle gate: live=${liveHash} expected=${EXPECTED}`); process.exit(1); }
  console.log(`bundle-gate OK  live=${liveHash}`);

  // ── Ground truth from the endpoints ─────────────────────────────────────────
  // Direct Node fetches, BEFORE the browser exists — so they cannot appear in
  // any page-side request capture and cannot be mistaken for a browser read.
  // Same placement and rationale as verify-conversations.cjs. GET only.
  const contacts      = await (await fetch(CONTACTS_URL)).json();
  const pipeline      = await (await fetch(OPPORTUNITIES_URL)).json();
  const unanswered    = await (await fetch(UNANSWERED_URL)).json();
  const opportunities = (pipeline && pipeline.opportunities) || [];

  const byId          = new Map((Array.isArray(contacts) ? contacts : []).map((c) => [c.id, c]));
  const unansweredIds = new Set((Array.isArray(unanswered) ? unanswered : []).map((r) => r.contactId));
  const oppsFor       = (id) => opportunities.filter((o) => o.contactId === id);
  const hasCallback   = (c) => !!(c && ((c.callbackDatetimePrecise || "").trim() || (c.callbackDatetime || "").trim()));

  console.log(`ground-truth  contacts=${Array.isArray(contacts) ? contacts.length : "(none)"} opportunities=${opportunities.length} unanswered=${unansweredIds.size}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const page = await ctx.newPage();

  await page.goto(`${ORIGIN}/dashboard`, { waitUntil: "load" });

  // The Lead Queue table is located by its HEADER ROW, not by position — the
  // Dashboard renders several tables and their order is a layout decision that
  // has changed before. This header set is unique to the Lead Queue.
  const LQ_HEADERS = ["Name", "Phone", "Tier", "Score", "Address", "Last Contact", "", "Notes"];

  // DONE when the Lead Queue table has left its "Loading…" state: that state
  // renders ONE cell spanning all columns, so waiting on a row carrying a
  // /contacts/ link is the precise signal, not a timeout.
  await page.waitForFunction((headers) => {
    const table = [...document.querySelectorAll("table")].find((t) => {
      const ths = [...t.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
      return ths.length === headers.length && ths.every((h, i) => h === headers[i]);
    });
    return !!table && table.querySelectorAll('tbody a[href^="/contacts/"]').length > 0;
  }, LQ_HEADERS, { timeout: 45000 });

  // Every Lead Queue row is MOUNTED — the scroll container is overflow:auto
  // with a maxHeight, not a windowed slice — so this collects the complete
  // queue without scrolling, and absence from the result is meaningful.
  const domIds = await page.evaluate((headers) => {
    const table = [...document.querySelectorAll("table")].find((t) => {
      const ths = [...t.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
      return ths.length === headers.length && ths.every((h, i) => h === headers[i]);
    });
    if (!table) return null;
    return [...table.querySelectorAll('tbody a[href^="/contacts/"]')]
      .map((a) => (a.getAttribute("href") || "").replace(/^\/contacts\//, "").split(/[/?#]/)[0])
      .filter(Boolean);
  }, LQ_HEADERS);

  const inQueue = new Set(domIds || []);

  // The Follow Up section is NOT a table — it renders <Card> divs, each with a
  // Link to /contacts/{id}. Located by its SectionHeading's h2 text, EXACTLY
  // matched: Waiting on Me renders four sections and their order is a layout
  // decision that has already changed once, so document order is not a locator.
  // Exact match rather than substring — "Follow Up" collides with nothing else
  // today, but a substring match would silently start matching a future
  // heading that merely contains those words.
  //
  // An EMPTY section is a legitimate DOM state: it renders a muted Card with no
  // links. That yields an empty array here rather than throwing, and check 8
  // then fails on its assertion half, which is the correct outcome — an empty
  // Follow Up section when the fixture qualifies IS the regression.
  const followUpIds = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")].find((h) => (h.textContent || "").trim() === "Follow Up");
    if (!h2) return null;
    const block = h2.parentElement && h2.parentElement.nextElementSibling;
    if (!block) return [];
    return [...block.querySelectorAll('a[href^="/contacts/"]')]
      .map((a) => (a.getAttribute("href") || "").replace(/^\/contacts\//, "").split(/[/?#]/)[0])
      .filter(Boolean);
  });

  const inFollowUp = new Set(followUpIds || []);

  // ── 1 — extraction. Makes checks 2-8 non-vacuous. ──
  const allWellFormed = (domIds || []).every((id) => GHL_ID_RE.test(id));
  check("leadqueue-dom-extraction",
    Array.isArray(domIds) && domIds.length > 0 && allWellFormed,
    `tableFound=${Array.isArray(domIds)} rows=${domIds ? domIds.length : "(none)"} allIdsWellFormed=${allWellFormed}`);

  // ── 2 — unanswered inbound, fixture selected from the live endpoint ──
  {
    /* Take the first contact the unanswered endpoint reports. Sorted so a
       run is reproducible against a given endpoint state rather than
       depending on response order. */
    const candidates = [...unansweredIds].filter((id) => GHL_ID_RE.test(id)).sort();
    const fixture = candidates.length > 0 ? candidates[0] : null;

    /* No fixture is a FAILURE, not a skip. The endpoint reporting nobody
       unanswered means the rule cannot be exercised, and a check that
       silently passes when it tested nothing is worse than one that fails
       loudly. The detail names the count so the cause is legible. */
    const pre = fixture !== null && unansweredIds.has(fixture);
    const absent = pre && !inQueue.has(fixture);
    check("exclusion-unanswered", pre && absent,
      `fixture=${fixture === null ? "(none in endpoint)" : fixture}` +
      ` unansweredCount=${unansweredIds.size}` +
      ` precondition(inUnansweredEndpoint)=${pre} assertion(absentFromQueue)=${absent}`);
  }

  // ── 3 — terminal stage (ALL opportunities terminal, per PB-D49) ──
  {
    const opps = oppsFor(ELLIS);
    const pre = opps.length > 0 && opps.every((o) => TERMINAL_STAGE_IDS.includes(o.stageId));
    const absent = !inQueue.has(ELLIS);
    check("exclusion-terminal:ellis", pre && absent,
      `precondition(allOppsTerminal)=${pre} opps=${opps.length} assertion(absentFromQueue)=${absent}`);
  }

  // ── 4 — scheduled callback (any, future-dated included) ──
  {
    const c = byId.get(CARTER);
    const pre = hasCallback(c);
    const absent = !inQueue.has(CARTER);
    check("exclusion-callback:carter", pre && absent,
      `precondition(hasCallback)=${pre} cb=${JSON.stringify((c && (c.callbackDatetimePrecise || c.callbackDatetime)) || "")} assertion(absentFromQueue)=${absent}`);
  }

  // ── 5 + 8 — Seller Follow-Up (ANY such opportunity, per PB-D53). ONE
  //           precondition, computed once and shared: the exclusion and the
  //           inclusion must never disagree about whether the fixture still
  //           qualifies. Recomputing it per check would let them drift. ──
  const bradFollowUpOpps = oppsFor(BRADT75);
  const bradInFollowUpStage = bradFollowUpOpps.some((o) => o.stageId === SELLER_FOLLOW_UP_STAGE_ID);

  {
    const absent = !inQueue.has(BRADT75);
    check("exclusion-followup:bradt75", bradInFollowUpStage && absent,
      `precondition(anyOppInFollowUp)=${bradInFollowUpStage} opps=${bradFollowUpOpps.length} assertion(absentFromQueue)=${absent}`);
  }

  // ── 8 — the INCLUSION half of check 5. Same precondition, opposite
  //        assertion: absent from the Lead Queue is only correct if he is
  //        present HERE. Ordered immediately after its pair so a reader sees
  //        the invariant whole. ──
  {
    const present = inFollowUp.has(BRADT75);
    check("inclusion-followup:bradt75", bradInFollowUpStage && present,
      `precondition(anyOppInFollowUp)=${bradInFollowUpStage} assertion(presentInFollowUp)=${present} followUpRows=${followUpIds ? followUpIds.length : "(section not found)"}`);
  }

  // ── 6 — Phone Status EXACTLY "Incorrect Number" ──
  {
    const c = byId.get(PROBE);
    const pre = !!c && c.phoneStatus === "Incorrect Number";
    const absent = !inQueue.has(PROBE);
    check("exclusion-phonestatus:probe", pre && absent,
      `precondition(phoneStatus==="Incorrect Number")=${pre} got=${JSON.stringify(c && c.phoneStatus)} assertion(absentFromQueue)=${absent}`);
  }

  // ── 7 — eligible control. The positive that makes the six negatives mean
  //        something: a memo returning an empty Set passes 2-6 and fails here. ──
  {
    const c = byId.get(NEELIMA);
    const opps = oppsFor(NEELIMA);
    const pre = !!c
      && !!(c.phone || "").trim()
      && !unansweredIds.has(NEELIMA)
      && !hasCallback(c)
      && !(opps.length > 0 && opps.every((o) => TERMINAL_STAGE_IDS.includes(o.stageId)))
      && !opps.some((o) => o.stageId === SELLER_FOLLOW_UP_STAGE_ID)
      && c.phoneStatus !== "Incorrect Number";
    const present = inQueue.has(NEELIMA);
    check("eligible-control:neelima", pre && present,
      `precondition(carriesNoPredicate)=${pre} phone=${JSON.stringify((c && c.phone) || "")} opps=${opps.length} assertion(presentInQueue)=${present}`);
  }

  // ── 8 — OQ-6 (iii): the partial-write flag stays silent on consistent state ──
  //
  // WHAT IT ASSERTS. No Lead Queue row carries the ATTEMPT NOT RECORDED badge
  // while every contact's attempt and disposition event agree. That is the
  // failure the 30s tolerance exists to prevent: last_call_attempt is written
  // immediately BEFORE the bell in every disposition path, so a strict
  // comparison would flag every SUCCESSFUL disposition on all seven paths, and a
  // signal that cries wolf on the normal path teaches the operator to ignore the
  // one thing built to be trusted.
  //
  // ⚠ RECORDED, NOT SILENTLY SKIPPED. Until a disposition has actually been
  // recorded in Production, no contact carries iaos_disposition_at and this
  // assertion is UNEXERCISED — it would pass even if the badge could never
  // render. The detail line reports the exercised count so the output says so
  // rather than reading as coverage. It becomes a real regression guard the
  // moment the first disposition lands, and the positive case cannot be created
  // here: seeding one is a Production write, which this harness refuses.
  {
    const badges = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="partial-write-flag"]').length);
    const dispositioned = [...inQueue].filter((id) => {
      const c = byId.get(id);
      return !!(c && c.dispositionAt);
    }).length;
    check("partial-write-flag-silent-when-consistent", badges === 0,
      `badges=${badges} queueRows=${inQueue.size} rowsCarryingDispositionAt=${dispositioned}` +
      (dispositioned === 0 ? " — NOTE: 0, so this assertion is currently UNEXERCISED" : ""));
  }

  await browser.close();

  // ── Self-check: exactly 9, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (checksRun !== 9) { console.log(`ABORT — expected 9 checks, ran ${checksRun}`); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
