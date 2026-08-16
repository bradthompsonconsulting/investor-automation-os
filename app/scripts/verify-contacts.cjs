/* Live verification — Contacts surface, Phase A read-only (docs/CONTACTS_OPPORTUNITIES_SPEC.md
   §5.3 + docs/CONTACTS_DETAIL_SPEC.md). Authored ONCE at floor 119 (D1-reconciled),
   NOT split. Runs against the LIVE deploy at app.investorautomationos.com (§5.3, never
   localhost) at Brad's WIDE viewport, and passes the §9.2 bundle gate FIRST — re-pin
   EXPECTED to the bundle under test on every run.

   Floor 121 = grid (5) + six folder sections (6) + 98 custom fields (98)
             + four Additional Info subgroups (4) + three D1 identity-header renders (3)
             + four Phone N DNC adjacencies (4) + no-input (1).
   Phase B PB-D5/PB-D13: floor = 121 + 4N, N = unlocked field count. N=2, so 129.
   D5 conversation parity (CONTACTS_DETAIL_SPEC D5): + 9 = 138.
     Neelima (4): delta, long-email-collapsed, expand, collapse.
     Gordon  (5): delta, sms-rendered, sms-alignment, sms-never-collapses,
                  inbound-email-collapsed.
   Success ONLY when checksRun === 138 AND every check passed. Any throw exits nonzero.
   The 98-field list is STATIC + hardcoded here (verification-only) — never imported from
   app code, never derived from ADDITIONAL_INFO_SUBGROUPS. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-Ci2gNxwq.js"; // §9.2 — RE-PIN to the served bundle after every app-code deploy
const TARGET   = "FiIT0hUaxVCIuokQpZuc"; // detail-view fixture (checks 6-119)
const PROPERTY_NOTES_ID = "k7O0TYVMpqCpnMHRLPol"; // PB-D5 unlock allowlist, N=1. Hardcoded here per the verification-only rule above; never imported from app code.
const ARV_ID = "wMBTGWMs97yysQFx7Vad"; // PB-D16/PB-D17 unlock allowlist, N=2. Hardcoded per the same verification-only rule.
const BRADT75  = "9fbH2VCcZvzVNhsR9zjc"; // phone-format fixture — +12149146151 → 214-914-6151 (check 5)

// ── D5 conversation parity (CONTACTS_DETAIL_SPEC D5) ───────────────────────────
// TARGET/Neelima is the REGRESSION fixture: emails only, ZERO SMS, so D5 must not
// change her transcript at all. GORDON is the EXERCISE fixture: SMS in BOTH
// directions plus a long INBOUND email, the only fixture that covers left-aligned
// bubbles, both messageType branches, and the filtered remainder together.
const GORDON = "DUYVB1FdhFaAdqpa98hn"; // ronald gordon
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
    { name: "System", fields: ["Marketing Lists", "Date Added to List", "Motivation Score", "Deal Score", "Combined Score", "Data Completeness Score", "Callback Datetime Precise"] },
  ]},
  { folder: "IAOS Onboarding", fields: ["Business Phone", "Business Website", "Wholesaling Market", "SMS Sender Name", "Sending Domain", "Booking Calendar Link", "Onboarding Notes", "Has Sending Domain", "Has Booking Calendar", "Has Existing Leads", "Existing GHL Account"] },
  { folder: "Form | IAOS Client Intake Form", fields: ["Upload Your Lead CSV (if applicable)"] },
];
const FOLDER_ORDER = RECORD.map((g) => g.folder);
const SUBGROUP_EXPECT = [["Reachability", 23], ["Property", 30], ["Investor", 14], ["System", 7]];

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
  const page = await ctx.newPage();

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

  // 4 — sort behaves: click the Name header → column becomes ascending.
  await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find((t) => /Name/.test(t.textContent || ""));
    if (th) th.click();
  });
  await page.waitForTimeout(300);
  const sortOk = await page.evaluate(() => {
    const names = [...document.querySelectorAll("tbody tr")]
      .filter((tr) => tr.querySelector('a[href^="/contacts/"]'))
      .map((tr) => (tr.querySelector('a[href^="/contacts/"]').textContent || "").trim().toLowerCase());
    if (names.length < 2) return false;
    for (let i = 1; i < names.length; i++) if (names[i - 1].localeCompare(names[i]) > 0) return false;
    return true;
  });
  check("sort-behaves", sortOk, `nameColumnAscendingAfterHeaderClick=${sortOk}`);

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
    return { folders, identityName, identityPhone, identityAddress, identityInputs, strayInputs, allowlistedInputs, unlocked, unlockedId: UNLOCKED_ID, arv, arvId: ARV_ID_B, scopeMissing, folderCount: folders.length };
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

  // 110-113 — four Additional Info subgroups: order + count (23/30/14/7) counted from the DOM.
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
  // checks 126-127 are the LAST checks in this file and nothing follows them.
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

  // ═══ CHECKS 128-136 — D5 conversation parity ═══
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

  await browser.close();

  // ── Self-check: exactly 138, all unique, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} uniqueNames=${names.size} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (names.size !== checksRun) { console.log("ABORT — name-collision detected"); process.exit(4); }
  if (checksRun !== 138) { console.log(`ABORT — expected 138 checks, ran ${checksRun}`); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
