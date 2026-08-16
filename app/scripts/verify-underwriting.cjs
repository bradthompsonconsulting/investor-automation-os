/* Live verification — Underwriting Workspace, /contacts/:id/underwriting.
   UNDERWRITING_WORKSPACE_SPEC.md + SELLER_ACQUISITION_WORKFLOW.md.

   Runs against the LIVE deploy at app.investorautomationos.com (never
   localhost) at Brad's WIDE viewport, and passes the bundle gate FIRST --
   re-pin EXPECTED to the bundle under test on every run.

   WHY THIS HARNESS EXISTS. On 2026-08-16 the page shipped with 186 unit
   checks green and three presentation defects reached production: the
   header printed the contact name twice, the rail blanked ARV and repairs
   in exactly the state where the operator needed them, and the unresolved
   copy showed the raw key `assignmentMode` alongside a sentence claiming
   every non-Gate-1 input resolves from policy -- false for that very key.
   All three were found by looking at the page. This harness is the machine
   looking first.

   FIXTURES, one per production-reachable state:
     NEELIMA -- one opportunity, deal facts present. Exercises whichever of
                unresolved / resolved production currently exposes.
     PROBE   -- no opportunity on any pipeline. Exercises no_opportunity.

   STATE IS DETECTED FROM THE PAGE, NOT ASSUMED FROM GHL. Neelima's
   Assignment Mode is absent today, so she renders unresolved. Setting that
   field in GHL would flip her to resolved -- which is a legitimate state
   change, not a regression. The harness reads which state the page is in
   and asserts the contract for THAT state. One check reports which branch
   ran, so a green run says what it verified.

   UNEXERCISED IN PRODUCTION -- recorded, not silently skipped.
   awaiting_selection has NO fixture: OBSERVED 2026-08-16, no contact in
   this location holds more than one opportunity (42 opportunities, zero
   contacts with 2+). configuration_error and orchestration_error likewise
   have no production trigger. All three are covered by the resolver
   runner's view-model cases and are NOT covered here. Closing them needs
   a contact with two opportunities.

   All identifiers below are VERIFICATION-ONLY: hardcoded here, never
   imported from app code, per the rule verify-contacts.cjs states. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-DrOo607N.js"; // §9.2 — RE-PIN to the served bundle after every app-code deploy
const NEELIMA  = "FiIT0hUaxVCIuokQpZuc"; // one opportunity, deal facts present
const PROBE    = "HGZAby6snRZfpl0go2Yb"; // no opportunity on any pipeline

/** The four rail positions, in render order. Labels are the durable contract. */
const RAIL_LABELS = ["SELLER ASK", "ARV", "REPAIRS", "SELLER MAO"];

/** Internal identifiers that must NEVER reach the screen. The 2026-08-16
    defect rendered `assignmentMode` verbatim; these are every key
    compute.ts can push into `missing`. */
const RAW_KEYS = [
  "assignmentMode", "sellingCostPct", "closingCost", "monthlyCarry",
  "holdMonths", "buyerProfitPct", "standardMinimum", "profitSharePct",
  "financing.ltv", "financing.rate", "financing.points",
];

/* FLOORS — literal call-site counts taken from the finished file, partitioned
   by branch, never back-filled from a passing run.

     shared      9   before the state branch, plus the branch check itself
     unresolved  4   inside if (isUnresolved)
     resolved    3   inside the else
     probe       4   after the branch

   Two literals rather than one variable. A floor that adapted to whichever
   branch ran could not detect a DELETED branch check, which is the whole
   point of the gate. The branch is known before the count is compared, so
   each branch is gated against its own literal. */
const FLOOR_UNRESOLVED = 17; // 9 + 4 + 4
const FLOOR_RESOLVED   = 16; // 9 + 3 + 4

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

/** Reads the whole page as data. No test ids exist, so everything is
    located structurally or by visible text. */
async function readPage(page) {
  return page.evaluate((railLabels) => {
    // railLabels is passed in below: page.evaluate runs in the browser and
    // cannot see Node scope, the same constraint verify-contacts.cjs records
    // for its allowlist literals.
    const text = document.body.innerText || "";
    const h1 = document.querySelector("h1");

    // The rail is the element containing all four labels. Located by
    // content rather than position so a layout change does not break it.
    const rail = [...document.querySelectorAll("div")].find((d) => {
      const t = d.innerText || "";
      return railLabels.every((l) => t.includes(l)) &&
        ![...d.children].some((c) => railLabels.every((l) => (c.innerText || "").includes(l)));
    });

    // The subtitle line under the h1 carries contact and, when different,
    // the opportunity name.
    const subtitle = h1 && h1.parentElement
      ? [...h1.parentElement.children].filter((c) => c !== h1).map((c) => c.innerText || "").join(" ")
      : "";

    return {
      bodyText: text,
      h1: h1 ? (h1.textContent || "").trim() : null,
      subtitle: subtitle.trim(),
      railText: rail ? rail.innerText : null,
      railFound: !!rail,
    };
  }, RAIL_LABELS);
}

(async () => {
  // ── Bundle gate — FIRST, before any assertion ──
  const gateRes = await fetch(`${ORIGIN}/index.html`, { cache: "no-store" });
  const gateHtml = await gateRes.text();
  const m = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(gateHtml);
  const liveHash = m ? m[1] : "(none)";
  if (liveHash !== EXPECTED) {
    console.log(`ABORT — bundle gate: live=${liveHash} expected=${EXPECTED}`);
    process.exit(1);
  }
  console.log(`bundle-gate OK  live=${liveHash}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const page = await ctx.newPage();

  // ══ NEELIMA — one opportunity, calculable state ══════════════════════
  await page.goto(`${ORIGIN}/contacts/${NEELIMA}/underwriting`, { waitUntil: "load" });
  // Wait for the page to leave its loading state. Asserting before this
  // races three parallel fetches and reads an empty shell as a real one.
  await page.waitForFunction(() => {
    const t = document.body.innerText || "";
    return t.includes("Underwriting") && !t.includes("Loading underwriting");
  }, { timeout: 45000 });

  const nee = await readPage(page);

  check("shell-renders", nee.h1 === "Underwriting", `h1=${JSON.stringify(nee.h1)}`);

  check("rail-present", nee.railFound, `found=${nee.railFound}`);

  const railHasAll = nee.railText !== null && RAIL_LABELS.every((l) => nee.railText.includes(l));
  check("rail-four-positions", railHasAll,
    `labels=${JSON.stringify(RAIL_LABELS)} found=${railHasAll}`);

  // The 2026-08-16 header defect: opportunityName falls back to the contact
  // name when GHL carries none, and the header appended it unconditionally.
  const dupName = /^(.+?)\s+·\s+\1$/.test(nee.subtitle);
  check("header-no-duplicate-name", !dupName, `subtitle=${JSON.stringify(nee.subtitle)}`);

  // No internal identifier may appear anywhere on the page.
  const leaked = RAW_KEYS.filter((k) => nee.bodyText.includes(k));
  check("no-raw-keys-on-screen", leaked.length === 0,
    `leaked=${JSON.stringify(leaked)}`);

  // Approve is gated behind PB-D56 prerequisite 5 and must not render as an
  // actionable control.
  const approveButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => /approve/i.test(b.textContent || "")).length);
  check("approve-absent", approveButtons === 0, `approveButtons=${approveButtons}`);

  const writeControls = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")].length);
  check("no-write-controls", writeControls === 0, `inputs=${writeControls}`);

  // ── State detection from the PAGE, not from GHL ──
  const isUnresolved = /Underwriting cannot begin/.test(nee.bodyText);
  const isResolved = /How this was calculated/.test(nee.bodyText);
  check("neelima-state-is-one-of-two", isUnresolved !== isResolved,
    `unresolved=${isUnresolved} resolved=${isResolved}`);
  const branchRan = isUnresolved ? "UNRESOLVED" : isResolved ? "RESOLVED" : "NEITHER";
  console.log(`  → neelima branch: ${branchRan}`);

  // ── Known facts survive regardless of branch. This is the 2026-08-16
  //    rail defect: values the resolver has must not blank while the
  //    operator is being told what is missing. ──
  const railMoney = (nee.railText || "").match(/\$[\d,]+/g) || [];
  check("rail-shows-known-money", railMoney.length >= 2,
    `values=${JSON.stringify(railMoney)}`);

  if (isUnresolved) {
    // MAO communicates waiting rather than fabricating a number.
    const maoWaiting = /Waiting for /.test(nee.railText || "");
    check("unresolved-mao-waits", maoWaiting, `railMao=${JSON.stringify(nee.railText)}`);

    // Copy is operator language. The defect rendered "Missing: assignmentMode.
    // Gate 1 requires ARV and repairs; every other input resolves from
    // policy." -- which is false for assignmentMode specifically.
    const saysNotSet = /is not set for this opportunity/.test(nee.bodyText);
    check("unresolved-copy-is-operator-language", saysNotSet,
      `found=${saysNotSet}`);

    const claimsPolicy = /every other input resolves from policy/.test(nee.bodyText);
    check("unresolved-copy-drops-false-policy-claim", !claimsPolicy,
      `stillPresent=${claimsPolicy}`);

    // No MAO figure is manufactured while unresolved.
    const hasSellerMaoFigure = /SELLER MAO[\s\S]{0,40}\$[\d,]+/.test(nee.railText || "");
    check("unresolved-no-fabricated-mao", !hasSellerMaoFigure,
      `railMao=${JSON.stringify((nee.railText || "").slice(0, 200))}`);
  } else {
    // Resolved: the waterfall renders and the MAO is a number.
    const hasBreakdown = /Base Buyer Capacity/.test(nee.bodyText) && /Seller MAO/.test(nee.bodyText);
    check("resolved-breakdown-renders", hasBreakdown, `found=${hasBreakdown}`);

    const noWaiting = !/Waiting for /.test(nee.railText || "");
    check("resolved-mao-is-a-figure", noWaiting && railMoney.length >= 3,
      `waiting=${!noWaiting} values=${JSON.stringify(railMoney)}`);

    const hasProvenance = /Where each assumption came from/.test(nee.bodyText);
    check("resolved-provenance-renders", hasProvenance, `found=${hasProvenance}`);
  }

  // ══ PROBE — no opportunity ═══════════════════════════════════════════
  await page.goto(`${ORIGIN}/contacts/${PROBE}/underwriting`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const t = document.body.innerText || "";
    return t.includes("Underwriting") && !t.includes("Loading underwriting");
  }, { timeout: 45000 });

  const probe = await readPage(page);

  const saysNoOpp = /No opportunity on this contact/.test(probe.bodyText);
  check("probe-no-opportunity-state", saysNoOpp, `found=${saysNoOpp}`);

  // PB-D55: nothing is written to the Contact as a substitute, and the copy
  // says so rather than leaving the operator guessing why the page is empty.
  const explainsWhy = /Underwriting belongs to the deal/.test(probe.bodyText);
  check("probe-explains-pb-d55", explainsWhy, `found=${explainsWhy}`);

  // No rail and no fabricated figures without an opportunity.
  const probeMoney = (probe.bodyText.match(/\$[\d,]+/g) || []);
  check("probe-no-figures", probeMoney.length === 0,
    `values=${JSON.stringify(probeMoney)}`);

  const probeLeaked = RAW_KEYS.filter((k) => probe.bodyText.includes(k));
  check("probe-no-raw-keys", probeLeaked.length === 0, `leaked=${JSON.stringify(probeLeaked)}`);

  await browser.close();

  // ── Self-check: exact count, all unique, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} uniqueNames=${names.size} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (names.size !== checksRun) { console.log("ABORT — name-collision detected"); process.exit(4); }
  const expected = branchRan === "UNRESOLVED" ? FLOOR_UNRESOLVED
                 : branchRan === "RESOLVED"   ? FLOOR_RESOLVED
                 : null;
  if (expected === null) {
    console.log(`ABORT — neither branch ran; cannot select a floor (branch=${branchRan})`);
    process.exit(6);
  }
  console.log(`branch=${branchRan} floor=${expected}`);
  if (checksRun !== expected) {
    console.log(`ABORT — expected ${expected} checks on the ${branchRan} branch, ran ${checksRun}`);
    process.exit(2);
  }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
