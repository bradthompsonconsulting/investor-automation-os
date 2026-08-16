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
     NEELIMA -- one opportunity, deal facts present, Assignment Mode absent.
                Exercises the unresolved contract.
     PROBE   -- IAOS Underwriting Test, a deliberately created fixture
                opportunity carrying ARV, Repair Estimate and Assignment
                Mode. Exercises the resolved contract.

   STATE IS DETECTED FROM THE PAGE, NOT ASSUMED FROM GHL. Either fixture
   may legitimately change state -- setting Assignment Mode on Neelima, or
   clearing a field on the probe -- and that is a data change, not a
   regression. Each fixture's branch is detected from its own rendered
   page, and the floors are selected from the pair of branches that
   actually ran.

   ARITHMETIC IS ASSERTED, VALUES ARE NOT. The resolved contract does not
   pin ARV=250000 or MAO=145143: those exist because someone typed them
   into a GHL dialog, and asserting them would fail as a regression the
   moment anyone edits the fixture. Instead the harness reads ARV and
   repairs off the rail and recomputes PB-D56's waterfall from the starter
   policy constants below, asserting the rendered Seller MAO matches. That
   survives a data change and still fails on a calculation defect.

   UNEXERCISED IN PRODUCTION -- recorded, not silently skipped.
   awaiting_selection has NO fixture: OBSERVED 2026-08-16, no contact in
   this location holds more than one opportunity. configuration_error and
   orchestration_error have no production trigger. no_opportunity lost its
   fixture when the probe gained IAOS Underwriting Test -- it was covered
   here until 2026-08-16 and is not now. All four are covered by the
   resolver runner's view-model cases and are NOT covered here. Closing
   no_opportunity needs a second contact with no opportunity; closing
   awaiting_selection needs a contact with two.

   All identifiers below are VERIFICATION-ONLY: hardcoded here, never
   imported from app code, per the rule verify-contacts.cjs states. */
const { chromium } = require("playwright");

const ORIGIN   = "https://app.investorautomationos.com";
const EXPECTED = "index-DrOo607N.js"; // §9.2 — RE-PIN to the served bundle after every app-code deploy
const NEELIMA  = "FiIT0hUaxVCIuokQpZuc"; // unresolved fixture: mode absent
const PROBE    = "HGZAby6snRZfpl0go2Yb"; // resolved fixture: OcGWOP9n666i4Q1MLd31

/* PB-D56 section IV starter policy, VERIFICATION-ONLY: hardcoded here,
   never imported from app code, per the rule verify-contacts.cjs states. A
   harness that imported the constants it checks could not detect drift in
   them. Consequence worth knowing: if a Custom Value is edited in GHL, the
   recomputation below stops matching and this harness fails -- correctly,
   because investor policy moved. */
const POL = {
  sellingCostPct: 0.10,
  closingCost:    2500,
  monthlyCarry:   500,
  holdMonths:     5,
  buyerProfitPct: 0.15,
  financingLtv:   0.70,
  financingRate:  0.12,
  financingPoints: 0.02,
  standardMinimum: 5000,
};

/** PB-D56's waterfall, recomputed independently of app code. */
function expectedMao(arv, repairs) {
  const base = arv - repairs
    - arv * POL.sellingCostPct
    - POL.closingCost
    - POL.monthlyCarry * POL.holdMonths
    - arv * POL.buyerProfitPct;
  const k = POL.financingLtv * (POL.financingPoints + POL.financingRate * POL.holdMonths / 12);
  return base / (1 + k) - POL.standardMinimum;
}

/** Parses "$1,234" out of rail text by its label. */
function railMoney(railText, label) {
  const re = new RegExp(label + "\\s*\\n\\s*\\$([\\d,]+)");
  const m = re.exec(railText || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** The four rail positions, in render order. Labels are the durable contract. */
const RAIL_LABELS = ["SELLER ASK", "ARV", "REPAIRS", "SELLER MAO"];

/** Internal identifiers that must NEVER reach the screen. The 2026-08-16
    defect rendered `assignmentMode` verbatim; these are every key
    compute.ts can push into `missing`. */
const RAW_KEYS = [
  // Keys compute.ts pushes into `missing`.
  "assignmentMode", "sellingCostPct", "closingCost", "monthlyCarry",
  "holdMonths", "buyerProfitPct", "standardMinimum", "profitSharePct",
  "financing.ltv", "financing.rate", "financing.points",
  // Provenance keys, which differ: dotless, plus financingEnabled. Omitting
  // these under-detected the 2026-08-16 provenance leak -- eleven keys were
  // on screen and this list caught seven.
  "financingEnabled", "financingLtv", "financingRate", "financingPoints",
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
/* Floors are per-fixture-branch. Neelima runs 9 shared + her branch; the
   probe runs 9 shared + its branch. The probe's no_opportunity checks are
   gone -- it now carries an opportunity -- so that state is UNEXERCISED in
   production and recorded as such below. */
const SHARED = 8;
const NEE_UNRESOLVED = 4;
const NEE_RESOLVED   = 3;
const PROBE_UNRESOLVED = 4;
const PROBE_RESOLVED   = 6;

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
  // Case-insensitive: the section headings are styled textTransform:
  // uppercase, and innerText returns the RENDERED text. A case-sensitive
  // match classified a correctly-resolved page as NEITHER on 2026-08-16.
  const isUnresolved = /Underwriting cannot begin/i.test(nee.bodyText);
  const isResolved = /How this was calculated/i.test(nee.bodyText);
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
    const hasBreakdown = /Base Buyer Capacity/i.test(nee.bodyText) && /Seller MAO/i.test(nee.bodyText);
    check("resolved-breakdown-renders", hasBreakdown, `found=${hasBreakdown}`);

    const noWaiting = !/Waiting for /i.test(nee.railText || "");
    check("resolved-mao-is-a-figure", noWaiting && railMoney.length >= 3,
      `waiting=${!noWaiting} values=${JSON.stringify(railMoney)}`);

    const hasProvenance = /Where each assumption came from/i.test(nee.bodyText);
    check("resolved-provenance-renders", hasProvenance, `found=${hasProvenance}`);
  }

  // ══ PROBE — IAOS Underwriting Test, the resolved fixture ═════════════
  await page.goto(`${ORIGIN}/contacts/${PROBE}/underwriting`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const t = document.body.innerText || "";
    return t.includes("Underwriting") && !t.includes("Loading underwriting");
  }, { timeout: 45000 });

  const probe = await readPage(page);

  check("probe-shell-renders", probe.h1 === "Underwriting", `h1=${JSON.stringify(probe.h1)}`);
  check("probe-rail-present", probe.railFound, `found=${probe.railFound}`);

  const probeDup = /^(.+?)\s+·\s+\1$/.test(probe.subtitle);
  check("probe-header-no-duplicate-name", !probeDup, `subtitle=${JSON.stringify(probe.subtitle)}`);

  const probeLeaked = RAW_KEYS.filter((k) => probe.bodyText.includes(k));
  check("probe-no-raw-keys", probeLeaked.length === 0, `leaked=${JSON.stringify(probeLeaked)}`);

  const probeApprove = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => /approve/i.test(b.textContent || "")).length);
  check("probe-approve-absent", probeApprove === 0, `approveButtons=${probeApprove}`);

  const probeWrites = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")].length);
  check("probe-no-write-controls", probeWrites === 0, `inputs=${probeWrites}`);

  const probeUnresolved = /Underwriting cannot begin/i.test(probe.bodyText);
  const probeResolved = /How this was calculated/i.test(probe.bodyText);
  check("probe-state-is-one-of-two", probeUnresolved !== probeResolved,
    `unresolved=${probeUnresolved} resolved=${probeResolved}`);
  const probeBranch = probeUnresolved ? "UNRESOLVED" : probeResolved ? "RESOLVED" : "NEITHER";
  console.log(`  → probe branch: ${probeBranch}`);

  const probeRailMoney = (probe.railText || "").match(/\$[\d,]+/g) || [];
  check("probe-rail-shows-known-money", probeRailMoney.length >= 2,
    `values=${JSON.stringify(probeRailMoney)}`);

  if (probeResolved) {
    const hasBreakdown = /Base Buyer Capacity/i.test(probe.bodyText) && /Seller MAO/i.test(probe.bodyText);
    check("probe-breakdown-renders", hasBreakdown, `found=${hasBreakdown}`);

    const hasProvenance = /Where each assumption came from/i.test(probe.bodyText);
    check("probe-provenance-renders", hasProvenance, `found=${hasProvenance}`);

    const noWaiting = !/Waiting for /i.test(probe.railText || "");
    check("probe-no-waiting-copy", noWaiting, `railText=${JSON.stringify((probe.railText || "").slice(0, 160))}`);

    // ARITHMETIC, not values. Read the inputs off the rail, recompute
    // PB-D56's waterfall independently, compare to the rendered MAO.
    const arv = railMoney(probe.railText, "ARV");
    const rep = railMoney(probe.railText, "REPAIRS");
    const mao = railMoney(probe.railText, "SELLER MAO");
    check("probe-rail-carries-inputs", arv !== null && rep !== null && mao !== null,
      `arv=${arv} repairs=${rep} mao=${mao}`);

    const want = (arv !== null && rep !== null) ? expectedMao(arv, rep) : null;
    check("probe-mao-matches-pbd56-waterfall",
      want !== null && mao !== null && Math.abs(mao - want) <= 1,
      `rendered=${mao} recomputed=${want === null ? "n/a" : Math.round(want)} arv=${arv} repairs=${rep}`);

    const spreadShown = /ASSIGNMENT SPREAD[\s\S]{0,40}\$5,000/.test(probe.bodyText)
      || /Assignment Spread[\s\S]{0,40}-?\$5,000/.test(probe.bodyText);
    check("probe-assignment-spread-is-standard-minimum", spreadShown,
      `found=${spreadShown}`);
  } else {
    const maoWaiting = /Waiting for /.test(probe.railText || "");
    check("probe-unresolved-mao-waits", maoWaiting, `railMao=${JSON.stringify(probe.railText)}`);

    const saysNotSet = /is not set for this opportunity/.test(probe.bodyText);
    check("probe-unresolved-copy-is-operator-language", saysNotSet, `found=${saysNotSet}`);

    const claimsPolicy = /every other input resolves from policy/.test(probe.bodyText);
    check("probe-unresolved-drops-false-policy-claim", !claimsPolicy, `stillPresent=${claimsPolicy}`);

    const hasMaoFigure = /SELLER MAO[\s\S]{0,40}\$[\d,]+/.test(probe.railText || "");
    check("probe-unresolved-no-fabricated-mao", !hasMaoFigure,
      `railMao=${JSON.stringify((probe.railText || "").slice(0, 200))}`);
  }

  await browser.close();

  // ── Self-check: exact count, all unique, all passed — else nonzero ──
  console.log(`\nchecksRun=${checksRun} uniqueNames=${names.size} failures=${failures.length} ${failures.length ? JSON.stringify(failures) : ""}`);
  if (names.size !== checksRun) { console.log("ABORT — name-collision detected"); process.exit(4); }
  const neeFloor = branchRan === "UNRESOLVED" ? NEE_UNRESOLVED
                 : branchRan === "RESOLVED"   ? NEE_RESOLVED : null;
  const probeFloor = probeBranch === "UNRESOLVED" ? PROBE_UNRESOLVED
                   : probeBranch === "RESOLVED"   ? PROBE_RESOLVED : null;
  if (neeFloor === null || probeFloor === null) {
    console.log(`ABORT — a fixture matched neither branch (neelima=${branchRan} probe=${probeBranch})`);
    process.exit(6);
  }
  const expected = SHARED + neeFloor + SHARED + probeFloor;
  console.log(`neelima=${branchRan} probe=${probeBranch} floor=${expected}`);
  if (checksRun !== expected) {
    console.log(`ABORT — expected ${expected} checks (neelima ${branchRan}, probe ${probeBranch}), ran ${checksRun}`);
    process.exit(2);
  }
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS THREW:", (e && e.stack) || e); process.exit(3); });
