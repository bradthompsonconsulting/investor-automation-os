/* Live verification — Contacts surface, Phase A read-only (docs/CONTACTS_OPPORTUNITIES_SPEC.md
   §5.3 + docs/CONTACTS_DETAIL_SPEC.md). Authored ONCE at floor 119 (D1-reconciled),
   NOT split. Runs against the LIVE deploy at app.investorautomationos.com (§5.3, never
   localhost) at Brad's WIDE viewport, and passes the §9.2 bundle gate FIRST — re-pin
   EXPECTED to the bundle under test on every run.

   Floor 119 = grid (5) + six folder sections (6) + 96 custom fields (96)
             + four Additional Info subgroups (4) + three D1 identity-header renders (3)
             + four Phone N DNC adjacencies (4) + no-input (1).
   Phase B PB-D5/PB-D13: floor = 119 + 4N, N = unlocked field count. N=2, so 127.
   Success ONLY when checksRun === 127 AND every check passed. Any throw exits nonzero.
   The 96-field list is STATIC + hardcoded here (verification-only) — never imported from
   app code, never derived from ADDITIONAL_INFO_SUBGROUPS. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-jTo_MLbw.js"; // §9.2 — RE-PIN to the served bundle after every app-code deploy
const TARGET   = "FiIT0hUaxVCIuokQpZuc"; // detail-view fixture (checks 6-119)
const PROPERTY_NOTES_ID = "k7O0TYVMpqCpnMHRLPol"; // PB-D5 unlock allowlist, N=1. Hardcoded here per the verification-only rule above; never imported from app code.
const ARV_ID = "wMBTGWMs97yysQFx7Vad"; // PB-D16/PB-D17 unlock allowlist, N=2. Hardcoded per the same verification-only rule.
const BRADT75  = "9fbH2VCcZvzVNhsR9zjc"; // phone-format fixture — +12149146151 → 214-914-6151 (check 5)

// ── Static canonical record (VERIFICATION-ONLY; hardcoded, never imported) ──────
// Folder DISPLAY order (folder-names effect: Offer first, then remaining ascending by
// folder position). Within each folder/subgroup, fields are in GHL `position` order —
// the exact render order. Additional Info is the sole subdivided folder.
const RECORD = [
  { folder: "Offer", fields: ["Offer Price", "Offer MAO", "Offer Wholesale Fee", "Offer Repair Total", "Offer Margin", "Offer ARV", "Offer Date"] },
  { folder: "Contact", fields: ["Phone Type"] },
  { folder: "General Info", fields: ["Callback Datetime", "Last Call Attempt", "last_call_attempt_precise"] },
  { folder: "Additional Info", subgroups: [
    { name: "Reachability", fields: ["Phone 1 DNC", "Phone 2", "Phone 2 DNC", "Phone 3", "Phone 3 DNC", "Phone 4", "Phone 4 DNC", "Phone 5", "Phone 5 DNC", "Email 2", "Email 3", "Email 4", "Owner 2 First Name", "Owner 2 Last Name", "Litigator", "Mailing Care of Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Mailing County", "Do Not Mail"] },
    { name: "Property", fields: ["Property Address", "Loan Amount", "Interest Rate", "County", "APN", "Property Status", "Property Type", "Bedrooms", "Total Bathrooms", "Building Sqft", "Lot Size Sqft", "Effective Year Built", "Total Assessed Value", "Last Sale Date", "Last Sale Amount", "Total Open Loans", "Est. Remaining Loan Balance", "Est. Value", "Est. Loan-to-Value", "Est. Equity", "MLS Status", "MLS Date", "MLS Amount", "Lien Amount", "Foreclosure Factor", "Total Condition", "Interior Condition", "Bathroom Condition", "Kitchen Condition", "Exterior Condition"] },
    { name: "Investor", fields: ["Asking Price", "ARV", "Estimated Repairs", "Motivation Level", "Timeline to Sell", "Lead Source", "Occupancy Status", "Follow Up Date", "MAO Viability Flag", "Hold Months", "Carrying Cost", "Repair Line Items", "Owner Occupied", "Property Notes"] },
    { name: "System", fields: ["Marketing Lists", "Date Added to List", "Motivation Score", "Deal Score", "Combined Score", "Data Completeness Score", "Callback Datetime Precise"] },
  ]},
  { folder: "IAOS Onboarding", fields: ["Business Phone", "Business Website", "Wholesaling Market", "SMS Sender Name", "Sending Domain", "Booking Calendar Link", "Onboarding Notes", "Has Sending Domain", "Has Booking Calendar", "Has Existing Leads", "Existing GHL Account"] },
  { folder: "Form | IAOS Client Intake Form", fields: ["Upload Your Lead CSV (if applicable)"] },
];
const FOLDER_ORDER = RECORD.map((g) => g.folder);
const SUBGROUP_EXPECT = [["Reachability", 22], ["Property", 30], ["Investor", 14], ["System", 7]];

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

(async () => {
  // ── Bundle gate (§9.2) — prod serves the code under test, FIRST, before any check ──
  const idx = await (await fetch(`${ORIGIN}/index.html?cb=${Math.random()}`, { headers: { "Cache-Control": "no-cache" } })).text();
  const liveHash = (idx.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "NONE";
  if (liveHash !== EXPECTED) { console.log(`ABORT — bundle gate: live=${liveHash} expected=${EXPECTED}`); process.exit(1); }
  console.log(`bundle-gate OK  live=${liveHash}`);

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

  // 12-107 — the 96 custom fields: presence + correct section (+ subgroup) + RELATIVE ORDER.
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

  // 108-111 — four Additional Info subgroups: order + count (22/30/14/7) counted from the DOM.
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

  await browser.close();

  // ── Self-check: exactly 127, all unique, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} uniqueNames=${names.size} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (names.size !== checksRun) { console.log("ABORT — name-collision detected"); process.exit(4); }
  if (checksRun !== 127) { console.log(`ABORT — expected 127 checks, ran ${checksRun}`); process.exit(2); }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
