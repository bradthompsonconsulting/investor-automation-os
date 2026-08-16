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
const EXPECTED = "index-DrOo607N.js"; // §9.2 — RE-PIN to the served bundle on every run

// ── Fixtures, one per exclusion predicate plus the eligible control ──────────
const NEELIMA = "FiIT0hUaxVCIuokQpZuc"; // eligible control — carries NO predicate
const PALERMO = "NISht1R60heBRhyeMyWp"; // unanswered inbound
const ELLIS   = "3saoIFpdnjvKE14Hghe0"; // terminal stage
const CARTER  = "yeMPDUExsxV6Zpf8ebTD"; // scheduled callback
const BRADT75 = "9fbH2VCcZvzVNhsR9zjc"; // Seller Follow-Up
const PROBE   = "YZJwNmyD6F1ire1jNFyu"; // Phone Status = Incorrect Number

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

  // ── 2 — unanswered inbound ──
  {
    const pre = unansweredIds.has(PALERMO);
    const absent = !inQueue.has(PALERMO);
    check("exclusion-unanswered:palermo", pre && absent,
      `precondition(inUnansweredEndpoint)=${pre} assertion(absentFromQueue)=${absent}`);
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

  await browser.close();

  // ── Self-check: exactly 8, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (checksRun !== 8) { console.log(`ABORT — expected 8 checks, ran ${checksRun}`); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
