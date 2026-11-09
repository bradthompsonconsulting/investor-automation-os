import { useEffect, useMemo, useRef, useState } from "react";
import { useReadRecovered } from "../components/access-status";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calculator, ChevronDown, ChevronUp, ExternalLink, Link2, Unlink, Loader2, RotateCcw,
} from "lucide-react";
import { ghl } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { parseContactSeeds, parsePolicy } from "../lib/underwriting/resolver";
import { IAOS_STARTERS } from "../lib/underwriting/starters";
import { computeUnderwriting } from "../lib/underwriting/compute";
import {
  computeBoard8Economics, computeExpectedSpread,
  type Board8Economics, type ExpectedSpread,
} from "../lib/underwriting/board8-economics";
import {
  buildDealCalculatorInputs, parseNonNegativeAmountInput, DEFAULT_ASSIGNMENT_MODE,
  type DealCalculatorAssignment,
} from "../lib/deal-calculator-inputs";
import { buildDealCalculatorBarCells, buildSpreadStatus, type DealCalcBarCell, type SpreadStatus } from "../lib/deal-calculator-bar";
import type { RepairCompleteness } from "../lib/provisional-repairs";
import { parseAcquisitionPriceInput } from "../lib/seller-call-negotiation";
import {
  OPERATOR_ROWS, EMPTY_ANSWER, applyCondition, applyAmount, applyQuantity,
  quantitySpecFor, operatorEstimate, EMPTY_MISC, clearRepairAnswers, transferQuickTotal,
  parseKnownAmount, UNANSWERED_ALLOWANCE_LABEL,
  type Answers, type MiscAnswer, type OperatorCondition,
} from "../lib/repair-estimation/operator-model";
import { MiscRepairRow, RepairEstimateSummary } from "../components/RepairEstimateSummary";
import { NetProceedsPanel } from "../components/NetProceedsPanel";
import { DealCalculationSavePanel, type CalculatorFigures } from "../components/DealCalculationSavePanel";
import { computeRepairEstimate } from "../lib/repair-estimation/compute";
import type { AssignmentModeName } from "../lib/underwriting/resolver-types";
import { appWriteIdentity, subscribeAppWriteSession } from "../lib/app-write-session";
import type { OpportunityRow } from "../lib/ghl";
import {
  FIELDS as DRAFT_FIELDS, NO_GHL, assess, canResolve, keepMine, openStore, parseRepairItems, recordEdit,
  seedEvidence, serializeRepairItems, useGhl as discardForGhl, withoutField,
  type Draft, type DraftField, type DraftIdentity, type FieldState, type GhlNow,
} from "../lib/calculator-drafts";

/**
 * Standalone Deal Calculator -- B8-09 / INV-52.
 *
 * Route: /deal-calculator. A brand-new numbers-first face over the SAME
 * authoritative Board #8 engine Seller Call and Underwriting already
 * consume -- `resolveInputs`, `computeUnderwriting`, `computeBoard8Economics`,
 * and `computeExpectedSpread` (all imported, none reimplemented). This
 * page creates NO second economics engine: `deal-calculator-inputs.ts` is
 * the ONLY new logic, and its entire job is constructing the same
 * `UnderwritingInputs` shape from scratchpad state instead of a GHL
 * Opportunity, because a standalone calculator has neither by default.
 *
 * NO CONTACT/OPPORTUNITY REQUIRED. Opening this page cold performs no GHL
 * read that blocks rendering -- the only network call is a background,
 * non-blocking read of location-level Investor Policy (`ghl.underwriting
 * .policy()`, the SAME call Seller Call and Underwriting already make),
 * and even that read failing or being slow does not prevent the six
 * primary numbers from calculating: `buildDealCalculatorInputs` falls
 * through to IAOS Starter defaults exactly as `resolveInputs` already
 * does for any real deal with no configured Investor Policy.
 *
 * REFERENCE PRICE IS "test_price", NOT "current_offer". B8-01/B8-02
 * reserved this exact name for this exact surface -- see
 * `board8-economics.ts`'s own `ReferenceKind` and
 * `deal-calculator-bar.ts`'s header. This is a materially different
 * surface from Seller Call's live negotiation (B8-08 / INV-51): there is
 * no Max-crossing warning, no bounded-action flow, no override here --
 * INV-52 is explicit that downstream negotiation work is out of scope.
 *
 * ASSIGNMENT MODE, WHY IT EXISTS HERE AT ALL. See
 * `deal-calculator-inputs.ts`'s header for the full reasoning: Target and
 * Max do not mathematically depend on assignment mode, but
 * `computeUnderwriting`'s own gate will not resolve ANY figure without
 * one, and no Investor Policy or IAOS Starter level exists for it. Per
 * Brad's Jess Gate correction (2026-09-06), the selector defaults to
 * `profit_share` -- the existing 25% Buyer Profit Share target with the
 * existing $5,000 Standard Minimum as its floor, both EXISTING Investor
 * Policy values, no new dollar amount or formula -- and lives under More
 * Detail alongside the eleven read-only Investor Policy figures, with
 * Standard and Manual fully selectable there too.
 *
 * QUICK REPAIRS, OPTIONAL DEEPER ESTIMATOR -- NO SECOND REPAIR ENGINE.
 * "Quick" is a single operator-typed number. "Detailed" reuses Board 6's
 * OWN pure functions verbatim -- `OPERATOR_ROWS`, `applyCondition`,
 * `buildLines` (via `operatorEstimate`), `computeRepairEstimate` -- the
 * exact functions `UnderwritingWorkspace.tsx`'s real repair estimator
 * calls. The two modes are mutually exclusive by construction: exactly
 * one produces the `repairs` figure fed into economics, per the same
 * "no silent double-count" rule Board 6's own UI already enforces.
 *
 * OPTIONAL LINKING IS CONTACT-LEVEL, NOT OPPORTUNITY-LEVEL. Reading
 * `parseContactSeeds` off a linked Contact's own custom fields (the SAME
 * PB-D55 "seed" concept Seller Call/Underwriting already read) is enough
 * to prepopulate ARV/Repairs, ONLY into fields still empty -- linking
 * never overwrites a value already typed. `/contacts/:id/underwriting`
 * (linked to, never embedded) already handles multi-opportunity selection
 * internally, so this page does not need to resolve one itself.
 *
 * NEITHER ARV NOR REPAIRS IS EVER SAVED BACK FROM HERE -- A DELIBERATE,
 * DOCUMENTED SCOPE BOUNDARY, NOT AN OVERSIGHT. INV-70 / B9-07A Phase 2
 * correction round 3 REMOVED this page's Repairs save-back entirely
 * (`persist.ts`'s `persistApprovedRepairTotal` call and the
 * "Save Repairs to {contact}" action), extending to Repairs the SAME
 * reasoning ARV's own save-back already didn't have: this scratchpad has
 * no Opportunity context, `contact.estimated_repairs` is now a read-only
 * legacy fallback/migration input (Family 3's approved ruling), and Board
 * 6's real repair estimator already persists to the authoritative
 * Opportunity carrier from `UnderwritingWorkspace.tsx`. Board 7's
 * authoritative ARV write (`arv-persist.ts`'s `persistApprovedArv`)
 * separately requires real comp evidence -- evidence state, reconciliation
 * outcome, accepted comp count, search level -- none of which a bare typed
 * number on this scratchpad ever has; fabricating that evidence to unlock
 * a write here would violate PB-D61's evidence doctrine. When linked, this
 * page instead links to the real Underwriting workspace for BOTH figures,
 * exactly as Seller Call (B8-07) already does for ARV.
 *
 * READ ONLY, WITH ONE NAMED EXCEPTION (B15-25 Phase 2, Jess RULING 2026-10-30;
 * Captain approved P2-1..P2-5). This page itself performs no GHL write; its
 * network calls are reads (contact detail, investor policy, and -- B15-25 --
 * the existing pipeline read, to find a linked contact's deals). The one write
 * surface is the linked-contact `DealCalculationSavePanel`: an explicit "Save
 * Calculation to Deal" button that appends ONE `IAOS DEAL CALCULATION` note --
 * a working calculation, never an approval, never ARV, Repairs or Current
 * Offer (docs/INV95_WRITE_BOUNDARIES.md; refused in Production). It saves for
 * the deal chosen HERE (integration ruling I1).
 *
 * B15-25 (INV-133) PHASE 1 -- LOCAL AUTOSAVE. The figures and modes are kept
 * in THIS BROWSER (lib/calculator-drafts.ts), never sent to GHL, never an
 * approval. Unlinked work is a scratch draft (per GHL location and
 * operator); a linked contact's work is kept only once a deal is chosen, per
 * location, operator, contact, property (the deal: one property per deal in
 * V1) and deal. A contact seed is GHL evidence, not a draft: only a value
 * different from it is kept, and a seed that changed under a kept value
 * shows both until the operator chooses. Saves and removals are confirmed;
 * a failure is said plainly.
 */

const CONFIG = getRuntimeConfig();
const CV_IDS = CONFIG.customValues;
const CONTACT_IDS = {
  arv: CONFIG.fields.arv,
  repairs: CONFIG.fields.estimatedRepairs,
  askingPrice: CONFIG.fields.askingPrice,
};

const PANEL_STYLE: React.CSSProperties = {
  padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px",
};
const LABEL_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#64748B" };
const INPUT_STYLE: React.CSSProperties = {
  background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px",
  padding: "8px 10px", color: "#E2E8F0", fontSize: "13px", width: "160px",
};
const COMPACT_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
  padding: "6px 10px", borderRadius: "7px", border: "1px solid rgba(30,200,255,0.35)",
  background: "rgba(30,200,255,0.08)", color: "#1EC8FF", textDecoration: "none", cursor: "pointer",
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Renders one Investor Policy row: the resolved value (or IAOS Starter fallback) and which level supplied it. */
function policyRow(
  label: string,
  resolved: { kind: "value"; value: number; level: "investor_policy" } | { kind: "unresolved"; reason: string },
  fallback: number,
  format: (n: number) => string,
) {
  const value = resolved.kind === "value" ? resolved.value : fallback;
  const level = resolved.kind === "value" ? "Investor Policy" : "IAOS Starter";
  return (
    <div key={label}>
      {label}: {format(value)} <span style={{ color: "#475569" }}>({level})</span>
    </div>
  );
}

/* B15-26: one color per spread status, always paired with the status text. */
const SPREAD_STATUS_COLOR: Record<SpreadStatus["kind"], string> = {
  negative: "#EF4444",
  short: "#F59E0B",
  meets: "#22C55E",
  neutral: "#64748B",
  provisional: "#F59E0B",
};

function BarCellView({ cell, valueColor }: { cell: DealCalcBarCell; valueColor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
      <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {cell.label}
      </span>
      {cell.value.kind === "value" ? (
        <span style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: valueColor ?? "#E2E8F0" }}>
          {cell.value.text}
        </span>
      ) : (
        <span style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 600, paddingTop: "4px", lineHeight: 1.4 }} title={cell.value.text}>
          {cell.value.text}
        </span>
      )}
    </div>
  );
}

const CONDITION_LABEL: Record<OperatorCondition, string> = {
  not_asked: "Not asked", good: "Good", repair: "Repair", severe: "",
};

/* B15-25: what each draft field shows when nothing is kept for it. ARV and quick repairs take the linked
   contact's seed instead, when there is one (see baselineFor in the component). */
const DRAFT_DEFAULTS: Record<DraftField, string> = {
  arv: "", repairsQuick: "", testPrice: "", assignmentMode: DEFAULT_ASSIGNMENT_MODE, manualAmount: "",
  repairsMode: "quick", repairItems: serializeRepairItems({}, EMPTY_MISC),
};
const DRAFT_STATUS_STYLE: React.CSSProperties = { fontSize: "10px", color: "#F59E0B", marginTop: "4px" };
/** The operator a draft belongs to: the write-session operator, else the last one seen, else this browser. */
function draftOperator(): string {
  const w = appWriteIdentity();
  return w.operator ?? w.lastOperator ?? "this-browser";
}
const scratchIdentity = (): DraftIdentity => ({ kind: "scratch", env: CONFIG.locationId, operator: draftOperator() });
const ghlText = (g: FieldState["ghl"]) => (g.kind === "value" ? g.value : g.kind === "none" ? "nothing recorded" : "could not be read");

export default function DealCalculator() {
  const [searchParams] = useSearchParams();
  const linkParam = searchParams.get("contactId");

  /* Primary What-If inputs. Raw strings so an in-progress keystroke is
     never lost to a parse; parseAcquisitionPriceInput (ARV, Test Price)
     and parseNonNegativeAmountInput (quick Repairs) are the ONE place
     either becomes a number. Neither ARV, Repairs, nor Test Price is ever
     assigned by anything except the operator's own typing -- IAOS invents
     none of the three, per this issue's own explicit requirement. */
  const [arvInput, setArvInput] = useState("");
  const [repairsQuickInput, setRepairsQuickInput] = useState("");
  const [testPriceInput, setTestPriceInput] = useState("");

  const arvParsed = useMemo(() => parseAcquisitionPriceInput(arvInput), [arvInput]);
  const repairsQuickParsed = useMemo(() => parseNonNegativeAmountInput(repairsQuickInput), [repairsQuickInput]);
  const testPriceParsed = useMemo(() => parseAcquisitionPriceInput(testPriceInput), [testPriceInput]);

  const arv = arvParsed.kind === "value" ? arvParsed.value : null;
  const testPrice = testPriceParsed.kind === "value" ? testPriceParsed.value : null;

  /* Repairs: quick (a single typed number) or detailed (Board 6's own
     operator model, reused verbatim) -- mutually exclusive by
     construction, exactly like Board 6's real UI. */
  const [repairsMode, setRepairsMode] = useState<"quick" | "detailed">("quick");
  const [repairAnswers, setRepairAnswers] = useState<Answers>({});
  /* Board 15 / PR #124 review (Jess, 2026-10-04): Miscellaneous / Other
     repairs, the same operator-model row Underwriting has, counted once. */
  const [repairMisc, setRepairMisc] = useState<MiscAnswer>(EMPTY_MISC);
  const [repairRevision, setRepairRevision] = useState(0);

  const detailedEstimate = useMemo(
    () => operatorEstimate(repairAnswers, (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } }), repairMisc),
    [repairAnswers, repairMisc],
  );

  /* October 19: itemized sums only known amounts, initially zero/incomplete. */
  const repairs =
    repairsMode === "quick"
      ? (repairsQuickParsed.kind === "value" ? repairsQuickParsed.value : null)
      : detailedEstimate.total;

  /* Jess ruling 2026-10-21 (B15-26 with B15-01): while the itemized estimate
     is incomplete, the spread, bar and net are presented as provisional.
     Completeness is the estimate's own flag -- never inferred from a $0
     total (explicit $0/Good answers are complete). A Quick total is an
     operator-entered whole figure, so it is not "incomplete"; a missing or
     invalid Quick total already leaves Repairs missing (neutral status). */
  const repairCompleteness: RepairCompleteness | null =
    repairsMode === "detailed" ? { incomplete: detailedEstimate.incomplete, knownRepairs: detailedEstimate.total } : null;

  function bumpRepairRevision() {
    setRepairRevision((r) => r + 1);
  }

  /* B15-01 (2026-10-07): quick -> itemized moves the quick total into
     Miscellaneous, preserving the total; it never lands beside existing
     itemized answers (no double counting), and the operator is told when
     it did not move. Itemized -> quick changes nothing. */
  const [repairTransferNote, setRepairTransferNote] = useState<string | null>(null);
  function handleRepairsModeToggle() {
    if (repairsMode === "detailed") {
      setRepairTransferNote(null);
      setRepairsMode("quick");
      return;
    }
    const quick = repairsQuickParsed.kind === "value" ? repairsQuickParsed.value : null;
    const moved = transferQuickTotal(quick, repairAnswers, repairMisc);
    if (moved) {
      setRepairMisc(moved);
      bumpRepairRevision();
      setRepairTransferNote(`Your quick total (${money(quick!)}) moved to Miscellaneous.`);
    } else {
      setRepairTransferNote(quick !== null
        ? `Itemized answers already exist, so your quick total (${money(quick)}) was not added to them.`
        : null);
    }
    setRepairsMode("detailed");
  }

  /* B15-01 repair-only Clear (2026-10-07): back to the known-only $0.
     ARV and Test Price are untouched; the Miscellaneous description is kept
     and its amount reset, so retained text cannot restore an old amount.
     The quick figure is a repair amount too, so it is cleared as well. */
  function handleRepairClear() {
    const cleared = clearRepairAnswers(repairMisc);
    setRepairAnswers(cleared.answers);
    setRepairMisc(cleared.misc);
    setRepairsQuickInput("");
    setRepairTransferNote(null);
    bumpRepairRevision();
  }

  function handleRowCondition(system: string, condition: OperatorCondition) {
    const row = OPERATOR_ROWS.find((r) => r.system === system);
    if (!row) return;
    setRepairAnswers((prev) => ({ ...prev, [system]: applyCondition(row, condition, prev[system] ?? EMPTY_ANSWER) }));
    bumpRepairRevision();
  }
  function handleRowAmount(system: string, raw: string) {
    setRepairAnswers((prev) => ({ ...prev, [system]: applyAmount(prev[system] ?? EMPTY_ANSWER, raw) }));
    bumpRepairRevision();
  }
  function handleRowQuantity(system: string, raw: string) {
    const row = OPERATOR_ROWS.find((r) => r.system === system);
    if (!row) return;
    setRepairAnswers((prev) => ({ ...prev, [system]: applyQuantity(row, prev[system] ?? EMPTY_ANSWER, raw) }));
    bumpRepairRevision();
  }

  /* Assignment mode. Defaults to profit_share (25% Buyer Profit Share,
     floored at the existing $5,000 Standard Minimum) per Brad's Jess Gate
     correction -- see deal-calculator-inputs.ts's header for why this
     default is a UI convenience over an enum with no real-world value to
     preserve, not an invented policy figure. */
  const [assignmentMode, setAssignmentMode] = useState<AssignmentModeName>(DEFAULT_ASSIGNMENT_MODE);
  const [manualAmountInput, setManualAmountInput] = useState("");
  const manualAmountParsed = useMemo(() => parseNonNegativeAmountInput(manualAmountInput), [manualAmountInput]);
  const assignment: DealCalculatorAssignment = useMemo(() => {
    if (assignmentMode === "manual") {
      return { mode: "manual", amount: manualAmountParsed.kind === "value" ? manualAmountParsed.value : null };
    }
    return { mode: assignmentMode };
  }, [assignmentMode, manualAmountParsed]);

  const [moreDetailOpen, setMoreDetailOpen] = useState(false);

  /* Investor Policy -- background, non-blocking. `null` means "not yet
     read"; buildDealCalculatorInputs treats that the same as an empty
     read (IAOS Starter fallback), so the six numbers never wait on this
     network call. */
  const [policyValues, setPolicyValues] = useState<{ id: string; value: string }[] | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  /* Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse. */
  const readRecovered = useReadRecovered();
  useEffect(() => {
    let cancelled = false;
    ghl.underwriting.policy()
      .then((p) => { if (!cancelled) { setPolicyValues(p.values); setPolicyError(null); } })
      .catch((e: Error) => { if (!cancelled) { setPolicyValues((v) => v ?? []); setPolicyError(e.message); } });
    return () => { cancelled = true; };
  }, [readRecovered]);

  const underwritingResult = useMemo(
    () => computeUnderwriting(buildDealCalculatorInputs({
      arv, repairs, assignment, policyValues: policyValues ?? [], policyIds: CV_IDS,
    })),
    [arv, repairs, assignment, policyValues],
  );
  const board8: Board8Economics = useMemo(() => computeBoard8Economics(underwritingResult), [underwritingResult]);
  const expectedSpread: ExpectedSpread = useMemo(
    () => computeExpectedSpread({ endBuyerMaxPrice: board8.status === "calculated" ? board8.endBuyerMaxPrice : 0, referenceKind: "test_price", referencePrice: board8.status === "calculated" ? testPrice : null }),
    [board8, testPrice],
  );

  /* Investor Policy, read-only display under More Detail. Reuses
     parsePolicy verbatim -- this page never edits these values (no
     Deal Override carrier exists for them anywhere in IAOS, per B8-02,
     and inventing an edit surface here would let this calculator's
     economics diverge from Seller Call/Underwriting's, which is exactly
     what INV-52's "same economics ... for identical inputs" forbids). */
  const parsedPolicy = useMemo(() => parsePolicy(policyValues ?? [], CV_IDS).policy, [policyValues]);

  const barCells = useMemo(
    () => buildDealCalculatorBarCells({ arv, repairs, testPrice, board8, expectedSpread, repairsIncomplete: repairCompleteness?.incomplete ?? false }),
    [arv, repairs, testPrice, board8, expectedSpread, repairCompleteness?.incomplete],
  );
  /* B15-26: the active mode's required spread is the engine's own resolved
     figures.assignmentSpread -- read, never recomputed. */
  const spreadStatus = useMemo(
    () => buildSpreadStatus(
      board8,
      expectedSpread,
      underwritingResult.status === "resolved"
        ? { mode: assignmentMode, requiredSpread: underwritingResult.figures.assignmentSpread }
        : null,
      assignmentMode,
      repairCompleteness,
    ),
    [board8, expectedSpread, underwritingResult, assignmentMode, repairCompleteness?.incomplete, repairCompleteness?.knownRepairs],
  );

  /* Optional linking. Contact-level only -- see module header for why no
     Opportunity resolution happens here at all. */
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null);
  const [linkedContactName, setLinkedContactName] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState(linkParam ?? "");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  /* ── B15-25: local drafts ─────────────────────────────────────────────
     `context` is where the figures on screen are kept: the scratch draft,
     a chosen deal's draft, or nowhere (null, with `notKept` saying why). */
  const [store] = useState(() => openStore(() => window.localStorage));
  const [context, setContext] = useState<DraftIdentity | null>(null);
  const [notKept, setNotKept] = useState<string | null>(linkParam ? "Linking the contact -- figures here are not kept until a deal is chosen." : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ghlNow, setGhlNow] = useState<GhlNow>(NO_GHL);
  const [persist, setPersist] = useState<null | "save-failed" | "remove-failed">(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [deals, setDeals] = useState<OpportunityRow[] | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [contactGhl, setContactGhl] = useState<GhlNow>(NO_GHL);

  const snapshot = (): Record<DraftField, string> => ({
    arv: arvInput, repairsQuick: repairsQuickInput, testPrice: testPriceInput, assignmentMode, manualAmount: manualAmountInput,
    repairsMode, repairItems: serializeRepairItems(repairAnswers, repairMisc),
  });
  /* Bones Phase 1 finding 3: the figures on screen NOW, read after an await (never a render-time copy). */
  const latest = useRef<Record<DraftField, string> | null>(null);
  latest.current = snapshot();
  const linkGeneration = useRef(0);
  /* Bones Phase 1 r2 finding 2: the fields the operator TOUCHED while a link was pending -- any change, even
     one later undone (typed, then cleared). Ownership follows the touch, not the final value. null = no
     link pending. `linkOperator` is the operator those touches belong to. */
  const linkTouched = useRef<Set<DraftField> | null>(null);
  const linkOperator = useRef<string | null>(null);
  const previousScreen = useRef<Record<DraftField, string> | null>(null);
  /* r2 finding 1: the operator the figures on a not-kept screen belong to. */
  const notKeptOwner = useRef<string | null>(null);
  useEffect(() => {
    const snap = latest.current ?? snapshot();
    const prev = previousScreen.current;
    if (linkTouched.current && prev) for (const f of DRAFT_FIELDS) if (snap[f] !== prev[f]) linkTouched.current.add(f);
    previousScreen.current = snap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arvInput, repairsQuickInput, testPriceInput, assignmentMode, manualAmountInput, repairsMode, repairAnswers, repairMisc]);
  /** What a field shows when nothing is kept for it: the contact's seed (ARV, quick repairs) or the default. */
  const baselineFor = (field: DraftField, ghl: GhlNow): string => {
    const g = ghl.kind === "ok" ? ghl.values[field] : undefined;
    return g && g.kind === "value" ? g.value : DRAFT_DEFAULTS[field];
  };
  /** Puts a full set of field values on screen. */
  function applyValues(v: Record<DraftField, string>) {
    setArvInput(v.arv);
    setRepairsQuickInput(v.repairsQuick);
    setTestPriceInput(v.testPrice);
    setAssignmentMode((["standard", "profit_share", "manual"] as string[]).includes(v.assignmentMode) ? v.assignmentMode as AssignmentModeName : DEFAULT_ASSIGNMENT_MODE);
    setManualAmountInput(v.manualAmount);
    setRepairsMode(v.repairsMode === "detailed" ? "detailed" : "quick");
    const items = parseRepairItems(v.repairItems) ?? { answers: {}, misc: EMPTY_MISC };
    setRepairAnswers(items.answers);
    setRepairMisc(items.misc);
    setRepairTransferNote(null);
    bumpRepairRevision();
  }
  /** Saves (or, for no draft, removes) and reports the outcome; never assumes either worked. */
  function commitDraft(next: Draft | null, where: DraftIdentity | null = context) {
    setDraft(next);
    if (!where) return;
    if (next) setPersist(store.save(next) ? null : "save-failed");
    else setPersist(store.remove(where) ? null : "remove-failed");
  }
  /**
   * Moves the screen to a draft context. A kept draft there is restored exactly (fields it does not hold
   * show their baseline). With none: figures carry over ONLY from scratch or not-kept work (typing before
   * linking survives linking, as before); leaving a deal never carries its figures into another deal or
   * into scratch work -- the target starts from its baseline. `overrides` (figures the operator edited
   * while a link was pending) win over both. Returns the values on screen and the fields that are
   * the operator's (restored or overridden) -- a seed never fills those, even when blank.
   */
  function enterContext(
    id: DraftIdentity, ghl: GhlNow, label: string, screen: Record<DraftField, string>,
    opts: { carry?: boolean; overrides?: Partial<Record<DraftField, string>> } = {},
  ): { values: Record<DraftField, string>; kept: Set<DraftField> } {
    const loaded = store.load(id);
    const carry = opts.carry ?? (!context || context.kind === "scratch");
    const overrides = opts.overrides ?? {};
    const kept = new Set(Object.keys(overrides) as DraftField[]);
    setContext(id);
    setNotKept(null);
    /* B15-25 S6: this screen is kept again -- a session change handled late (its render saw the not-kept screen) must
       not clear it as a previous operator's not-kept figures, which would blank the restored draft and delete it. */
    notKeptOwner.current = null;
    setGhlNow(ghl);
    setPersist(null);
    const baseline = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, baselineFor(f, ghl)])) as Record<DraftField, string>;
    if (loaded.ok && loaded.draft) {
      const stored = loaded.draft;
      for (const f of Object.keys(stored.fields) as DraftField[]) kept.add(f);
      const values = { ...Object.fromEntries(DRAFT_FIELDS.map((f) => [f, stored.fields[f]?.value ?? baseline[f]])), ...overrides } as Record<DraftField, string>;
      setDraft(stored);
      applyValues(values);
      setRestoreNote(`Restored the figures kept in this browser for ${label}.`);
      return { values, kept };
    }
    setDraft(null);
    setRestoreNote(loaded.ok ? null : `A kept draft for ${label} could not be read, so it was not used. Editing here replaces it.`);
    if (carry) return { values: { ...screen, ...overrides }, kept };
    const values = { ...baseline, ...overrides };
    applyValues(values);
    return { values, kept };
  }
  function leaveContext(reason: string) {
    setContext(null);
    setDraft(null);
    setGhlNow(NO_GHL);
    setPersist(null);
    setRestoreNote(null);
    setNotKept(reason);
    notKeptOwner.current = draftOperator();
  }
  function chooseDeal(deal: OpportunityRow, contactId: string, ghl: GhlNow, screen: Record<DraftField, string>, overrides?: Partial<Record<DraftField, string>>) {
    setSelectedDealId(deal.id);
    const id: DraftIdentity = { kind: "deal", env: CONFIG.locationId, operator: draftOperator(), contactId, propertyId: deal.id, opportunityId: deal.id };
    return enterContext(id, ghl, "this deal", screen, { overrides });
  }

  /* Bones Phase 1 finding 1: the draft belongs to the operator signed in NOW. When the write-session
     operator changes, the same deal (or scratch work) is re-keyed to the new operator, with no carry-over:
     operator B sees B's own kept figures or the baseline, never A's, and B's edits are never kept under A.
     A's draft stays kept for A. (Sign-out or expiry keeps the last operator, as app-write-session does.) */
  function rebindOperator(): boolean {
    if (!context) return clearNotKeptForNewOperator();
    const operator = draftOperator();
    if (context.operator === operator) return false;
    enterContext({ ...context, operator }, ghlNow, context.kind === "deal" ? "this deal" : "unlinked scratch work", latest.current ?? snapshot(), { carry: false });
    setRestoreNote("The signed-in operator changed, so the figures shown are the ones kept for the current operator. The previous operator's figures stay kept for them.");
    return true;
  }
  /* Bones Phase 1 r2 finding 1: figures on a screen where nothing is kept (a link pending, a deal not yet
     chosen) belong to the operator who typed them. When the operator changes there, they are cleared, so they
     can never carry into the new operator's deal; touches made during a pending link restart under the new
     operator (the new operator's own edits still win over the link's reads). */
  function clearNotKeptForNewOperator(): boolean {
    const operator = draftOperator();
    if (notKeptOwner.current === null || notKeptOwner.current === operator) return false;
    const defaults = { ...DRAFT_DEFAULTS };
    previousScreen.current = defaults;   // the reset itself is not a touch
    applyValues(defaults);
    notKeptOwner.current = operator;
    if (linkTouched.current) { linkTouched.current = new Set(); linkOperator.current = operator; }
    setRestoreNote("The signed-in operator changed, so the previous operator's figures, which were not kept, were cleared from the screen.");
    return true;
  }
  const [operatorTick, setOperatorTick] = useState(0);
  useEffect(() => subscribeAppWriteSession(() => setOperatorTick((t) => t + 1)), []);
  useEffect(() => { if (operatorTick > 0) rebindOperator(); }, [operatorTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Keeps every change to a figure or mode: a field is kept once it differs from its baseline (a seed is
     never kept as a draft), and a kept field follows every later edit. One place for every edit path --
     typing, mode toggles, the quick-to-itemized transfer, Clear repairs. */
  useEffect(() => {
    if (!context) return;
    /* Never keep an edit under an operator who is no longer signed in: re-key first (finding 1). */
    if (context.operator !== draftOperator()) { rebindOperator(); return; }
    const snap = snapshot();
    let next = draft;
    let changed = false;
    for (const f of DRAFT_FIELDS) {
      const kept = next ? next.fields[f] : undefined;
      if (kept && kept.value === snap[f]) continue;
      const atBaseline = snap[f] === baselineFor(f, ghlNow);
      if (!kept && atBaseline) continue;
      /* Back at the seed or default: nothing left to keep for this field (a GHL value is never labelled a draft). */
      next = atBaseline ? withoutField(next, f) : recordEdit(next, context, f, snap[f], ghlNow, new Date().toISOString());
      changed = true;
    }
    if (changed) commitDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arvInput, repairsQuickInput, testPriceInput, assignmentMode, manualAmountInput, repairsMode, repairAnswers, repairMisc, context, ghlNow]);

  const fieldStates = useMemo(() => assess(draft, ghlNow), [draft, ghlNow]);
  function handleKeepMine(field: DraftField) { commitDraft(keepMine(draft, field, ghlNow, new Date().toISOString())); }
  function handleUseGhl(field: DraftField) {
    if (!canResolve(ghlNow, field)) return;
    const value = baselineFor(field, ghlNow);
    commitDraft(discardForGhl(draft, field, ghlNow));
    if (field === "arv") setArvInput(value);
    if (field === "repairsQuick") setRepairsQuickInput(value);
  }
  /** The per-field line: Not saved to GHL, a conflict with both versions, or unchecked with disabled choices. */
  function draftStatus(field: DraftField) {
    const s = fieldStates[field];
    if (!context || !s) return null;
    if (s.state === "ghl") return <div data-testid={`deal-calc-draft-${field}`} style={{ ...DRAFT_STATUS_STYLE, color: "#64748B" }}>From the linked contact in GHL</div>;
    if (s.state === "draft") return <div data-testid={`deal-calc-draft-${field}`} style={DRAFT_STATUS_STYLE}>Draft -- Not saved to GHL</div>;
    if (s.state !== "conflict" && s.state !== "unchecked") return null;
    const allowed = canResolve(ghlNow, field);
    return (
      <div data-testid={`deal-calc-draft-${field}`} role="group" style={{ ...DRAFT_STATUS_STYLE, border: "1px solid rgba(245,158,11,0.4)", borderRadius: "6px", padding: "6px" }}>
        {s.state === "conflict" ? (
          <>
            <div data-testid={`deal-calc-draft-${field}-ghl`}>GHL now: {ghlText(s.ghl)} (changed since your draft)</div>
            <div data-testid={`deal-calc-draft-${field}-mine`}>Your draft: {s.draft} -- Not saved to GHL</div>
          </>
        ) : (
          <div>Draft -- Not saved to GHL (the GHL value could not be checked)</div>
        )}
        <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
          <button data-testid={`deal-calc-draft-${field}-keep`} disabled={!allowed} onClick={() => handleKeepMine(field)} style={{ ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "3px 7px", opacity: allowed ? 1 : 0.45 }}>Keep My Draft</button>
          <button data-testid={`deal-calc-draft-${field}-use-ghl`} disabled={!allowed} onClick={() => handleUseGhl(field)} style={{ ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "3px 7px", opacity: allowed ? 1 : 0.45 }}>Use GHL</button>
        </div>
        {!allowed ? <div style={{ color: "#94A3B8" }}>Choices are available once GHL can be read.</div> : null}
      </div>
    );
  }

  /* Bones Phase 1 finding 3: while the contact and deal reads are pending, figures are not kept anywhere
     (not in scratch work), and every figure the operator edits during the wait wins over the reads -- over
     a restored draft and over a seed. A response from an older link is ignored. */
  async function performLink(contactId: string) {
    if (contactId.trim() === "") return;
    const generation = ++linkGeneration.current;
    const start = latest.current ?? snapshot();
    /* r2 finding 2: every field touched during the wait, with its value now (typed-then-cleared included). */
    const editedSinceStart = (): Partial<Record<DraftField, string>> => {
      const now = latest.current ?? start;
      return Object.fromEntries([...(linkTouched.current ?? [])].map((f) => [f, now[f]]));
    };
    linkTouched.current = new Set();
    linkOperator.current = draftOperator();
    previousScreen.current = start;
    setLinkBusy(true);
    setLinkError(null);
    leaveContext("Linking the contact -- figures here are not kept until a deal is chosen.");
    try {
      const contact = await ghl.contacts.getDetail(contactId.trim());
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      const seedGhl: GhlNow = { kind: "ok", values: {
        arv: seedEvidence(contact.customFields, CONTACT_IDS.arv),
        repairsQuick: seedEvidence(contact.customFields, CONTACT_IDS.repairs),
      } };
      /* B15-25: the contact's deals, from the existing pipeline read. One deal is chosen for the operator;
         several need a choice (no first-deal guess); none, or an unreadable read, keeps nothing. */
      let mine: OpportunityRow[] | null;
      try { mine = (await ghl.opportunities.listPipeline()).opportunities.filter((o) => o.contactId === contact.id); } catch { mine = null; }
      if (generation !== linkGeneration.current) return;
      /* r2 finding 1 (backstop): if the operator changed during the wait without the reset above, nothing
         from the screen carries into the new operator's deal. */
      const operatorChanged = draftOperator() !== linkOperator.current;
      const edited = operatorChanged ? {} : editedSinceStart();
      linkTouched.current = null;
      if (operatorChanged) {
        const defaults = { ...DRAFT_DEFAULTS };
        previousScreen.current = defaults;
        applyValues(defaults);
        latest.current = defaults;
      }
      setLinkedContactId(contact.id);
      setLinkedContactName([contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.id);
      setDeals(mine);
      setSelectedDealId(null);
      setContactGhl(seedGhl);
      let screen = latest.current ?? start;
      let kept = new Set(Object.keys(edited) as DraftField[]);
      if (mine && mine.length === 1) ({ values: screen, kept } = chooseDeal(mine[0], contact.id, seedGhl, screen, edited));
      else leaveContext(mine === null ? "This contact's deals could not be loaded, so figures here are not kept."
        : mine.length === 0 ? "This contact has no deal, so figures here are not kept."
        : "Choose a deal below to keep these figures. Until then they are not kept.");
      // Prepopulate ONLY fields still empty -- linking is a one-time
      // convenience (PB-D55), never a silent overwrite of a typed value.
      // B15-25 (finding 2): nor of a value the operator owns -- a kept or
      // just-edited field, even one deliberately left blank.
      if (!kept.has("arv") && screen.arv.trim() === "" && seeds.arv !== null) setArvInput(String(seeds.arv));
      if (!kept.has("repairsQuick") && screen.repairsQuick.trim() === "" && seeds.repairs !== null) setRepairsQuickInput(String(seeds.repairs));
    } catch (e: any) {
      if (generation !== linkGeneration.current) return;
      setLinkError(e?.message ?? "Could not load that contact.");
      const sameOperator = draftOperator() === linkOperator.current;
      const overrides = sameOperator ? editedSinceStart() : {};
      linkTouched.current = null;
      if (!linkedContactId) enterContext(scratchIdentity(), NO_GHL, "unlinked scratch work", latest.current ?? start, { overrides, carry: sameOperator ? undefined : false });
    } finally {
      if (generation === linkGeneration.current) { setLinkBusy(false); linkTouched.current = null; }
    }
  }

  useEffect(() => {
    if (linkParam) void performLink(linkParam);
    else enterContext(scratchIdentity(), NO_GHL, "unlinked scratch work", snapshot());
    // Intentionally runs once, off the URL param only -- re-linking after
    // that is an explicit operator action via the Link button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChooseDeal(dealId: string) {
    const deal = deals?.find((d) => d.id === dealId);
    if (deal && linkedContactId) chooseDeal(deal, linkedContactId, contactGhl, snapshot());
  }

  function handleUnlink() {
    setLinkedContactId(null);
    setLinkedContactName(null);
    setLinkError(null);
    setDeals(null);
    setSelectedDealId(null);
    setContactGhl(NO_GHL);
    /* B15-25: back to the scratch draft; the deal's draft stays kept for when it is linked again. */
    enterContext(scratchIdentity(), NO_GHL, "unlinked scratch work", snapshot());
  }

  const [netPanelRevision, setNetPanelRevision] = useState(0);

  /* B15-25 Phase 2: the figures and modes the Save/Load panel works with -- figures only; itemized
     repair rows, Miscellaneous and the net-proceeds inputs are not saved in this phase. Loading a
     saved calculation replaces exactly these (the panel asks first when there are unsaved changes).
     Integration ruling I3: the setters below are ordinary edits, so Phase 1's keep-every-change effect
     keeps the loaded figures as THIS deal's browser draft (its existing preservation path), and the
     restore line says they came from GHL -- never "restored from this browser". */
  const calculatorFigures: CalculatorFigures = { arvInput, repairsQuickInput, testPriceInput, assignmentMode, manualAmountInput, repairsMode };
  function handleLoadCalculation(next: CalculatorFigures, savedAt: string) {
    setArvInput(next.arvInput);
    setRepairsMode(next.repairsMode);
    setRepairsQuickInput(next.repairsQuickInput);
    bumpRepairRevision();
    setTestPriceInput(next.testPriceInput);
    setAssignmentMode(next.assignmentMode);
    setManualAmountInput(next.manualAmountInput);
    setRestoreNote(`Loaded the calculation saved in GHL on ${new Date(savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. It is now kept in this browser as this deal's draft.`);
  }

  function handleClear() {
    setArvInput("");
    setRepairsQuickInput("");
    setTestPriceInput("");
    setRepairsMode("quick");
    setRepairAnswers({});
    /* PR #124 re-review (Bones / Jess): Clear must also reset Miscellaneous,
       or its description and amount reappear when itemized mode is reopened
       and silently add to the repairs figure. */
    setRepairMisc(EMPTY_MISC);
    setRepairRevision(0);
    setAssignmentMode(DEFAULT_ASSIGNMENT_MODE);
    setManualAmountInput("");
    /* B15-26: remounting the net proceeds panel resets its scratch inputs. */
    setNetPanelRevision((n) => n + 1);
    // Clear does not unlink -- clearing the scratchpad and severing the
    // link are two different bounded actions, matching this issue's own
    // "Clear/Reset" bullet, distinct from "optional linking."
    /* B15-25: Clear also discards this context's kept draft; a removal that
       fails is said plainly (the draft could come back). */
    setRestoreNote(null);
    commitDraft(null);
  }

  return (
    <div style={{ maxWidth: "1200px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Calculator size={20} style={{ color: "#1EC8FF" }} /> Deal Calculator
          </h1>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            <span data-testid="deal-calc-scratchpad-notice" style={{ color: "#F59E0B", fontWeight: 600 }}>Scratchpad -- nothing here is saved to GHL.</span>{" "}
            No contact or opportunity required -- type what you know.
          </div>
          {/* B15-25: exactly one line on where these figures are kept. "Kept" is said only after a save is confirmed. */}
          <div data-testid="deal-calc-draft-status" role="status" style={{ fontSize: "11px", marginTop: "4px", color: persist || !store.available ? "#F87171" : "#94A3B8" }}>
            {!store.available
              ? "This browser's storage is unavailable, so figures here are not kept: they are lost if you leave or reload. Not saved to GHL."
              : persist === "save-failed"
              ? "These figures could NOT be kept in this browser: storage refused them. They exist only on this screen and are lost if you leave or reload. Not saved to GHL."
              : persist === "remove-failed"
              ? "The cleared draft could not be removed from this browser, so it may come back after a reload."
              : notKept
              ? notKept
              : draft
              ? `Kept in this browser only${context?.kind === "deal" ? ", for this deal" : ", as unlinked scratch work"}. Not saved to GHL, and never an approval.`
              : "Figures you change here are kept in this browser only. Not saved to GHL."}
          </div>
          {restoreNote ? <div data-testid="deal-calc-draft-restored" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{restoreNote}</div> : null}
        </div>
        <button data-testid="deal-calc-clear" onClick={handleClear} style={{ ...COMPACT_BUTTON_STYLE }}>
          <RotateCcw size={12} /> Clear
        </button>
      </div>

      {/* Primary bar -- ARV | Repairs | Test Price | Target | Max | Spread. */}
      <div
        data-testid="deal-calc-primary-bar"
        style={{
          display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start",
          padding: "16px 20px", background: "#0F172A", border: "1px solid #1E293B",
          borderRadius: "10px", margin: "14px 0",
        }}
      >
        {barCells.map((cell) => (
          <BarCellView
            key={cell.key}
            cell={cell}
            valueColor={cell.key === "spread" && spreadStatus.kind !== "neutral" ? SPREAD_STATUS_COLOR[spreadStatus.kind] : undefined}
          />
        ))}
      </div>
      <div
        data-testid="deal-calc-spread-status"
        data-spread-status={spreadStatus.kind}
        role="status"
        style={{ fontSize: "12px", fontWeight: spreadStatus.kind === "neutral" ? 400 : 600, color: SPREAD_STATUS_COLOR[spreadStatus.kind], margin: "-6px 0 10px" }}
      >
        {spreadStatus.text}
      </div>
      <div data-testid="deal-calc-practice-figures-note" style={{ fontSize: "11px", color: "#64748B", margin: "-6px 0 14px" }}>
        Practice figures: the repairs, offer and spread here do not change the deal. The deal's repair total and
        Seller MAO are approved on the contact's Underwriting page.
      </div>

      {/* What-If editing. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        <div style={PANEL_STYLE}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>ARV</div>
          <input
            data-testid="deal-calc-arv-input"
            value={arvInput}
            onChange={(e) => setArvInput(e.target.value)}
            placeholder="Not yet entered"
            style={{ ...INPUT_STYLE, width: "100%" }}
          />
          {arvParsed.kind === "invalid" ? (
            <div data-testid="deal-calc-arv-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{arvParsed.reason}</div>
          ) : null}
          {draftStatus("arv")}
        </div>

        <div style={PANEL_STYLE}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8" }}>Repairs</span>
            <button
              data-testid="deal-calc-repairs-mode-toggle"
              onClick={handleRepairsModeToggle}
              style={{ ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "4px 8px" }}
            >
              {repairsMode === "quick" ? "Itemize repairs ▾" : "Quick number"}
            </button>
          </div>
          {repairsMode === "quick" ? (
            <>
              <input
                data-testid="deal-calc-repairs-quick-input"
                value={repairsQuickInput}
                onChange={(e) => { setRepairsQuickInput(e.target.value); bumpRepairRevision(); }}
                placeholder="Not yet entered"
                style={{ ...INPUT_STYLE, width: "100%" }}
              />
              {repairsQuickParsed.kind === "invalid" ? (
                <div data-testid="deal-calc-repairs-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{repairsQuickParsed.reason}</div>
              ) : null}
              {draftStatus("repairsQuick")}
            </>
          ) : (
            <div data-testid="deal-calc-repairs-detailed" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {OPERATOR_ROWS.map((row) => {
                const answer = repairAnswers[row.system] ?? EMPTY_ANSWER;
                const qSpec = quantitySpecFor(row);
                return (
                  <div key={row.system} style={{ display: "flex", flexDirection: "column", gap: "4px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontSize: "11px", color: "#94A3B8" }}>{row.label}</span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {(["not_asked", "good", "repair", "severe"] as OperatorCondition[]).map((c) => (
                        <button
                          key={c}
                          data-testid={`deal-calc-repair-${row.system}-${c}`}
                          onClick={() => handleRowCondition(row.system, c)}
                          style={{
                            ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "4px 7px",
                            background: answer.condition === c ? "rgba(30,200,255,0.25)" : COMPACT_BUTTON_STYLE.background,
                          }}
                        >
                          {c === "severe" ? row.severeLabel : CONDITION_LABEL[c]}
                        </button>
                      ))}
                      {qSpec ? (
                        <input
                          data-testid={`deal-calc-repair-${row.system}-quantity`}
                          value={answer.quantity}
                          onChange={(e) => handleRowQuantity(row.system, e.target.value)}
                          placeholder={qSpec.label}
                          style={{ ...INPUT_STYLE, width: "70px", fontSize: "11px" }}
                        />
                      ) : null}
                      <input
                        data-testid={`deal-calc-repair-${row.system}-amount`}
                        value={answer.amount}
                        onChange={(e) => handleRowAmount(row.system, e.target.value)}
                        placeholder="Known amount"
                        style={{ ...INPUT_STYLE, width: "100px", fontSize: "11px" }}
                      />
                      {/* Explanation, last (B15-02 field order). */}
                      {answer.condition === "not_asked" && parseKnownAmount(answer.amount).kind === "blank" ? (
                        <span data-testid={`deal-calc-repair-${row.system}-unknown`} style={{ fontSize: "10px", color: "#F59E0B", alignSelf: "center" }}>
                          {UNANSWERED_ALLOWANCE_LABEL} · unknown
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {/* PR #124 review: the same Miscellaneous row and the same
                  summary Underwriting renders. */}
              <MiscRepairRow
                misc={repairMisc}
                onChange={(next) => { setRepairMisc(next); bumpRepairRevision(); }}
                testIdPrefix="deal-calc-repair-misc"
              />
              <div data-testid="deal-calc-repairs-detailed-total">
                <RepairEstimateSummary result={detailedEstimate} />
              </div>
              {repairTransferNote ? (
                <div data-testid="deal-calc-repairs-transfer-note" style={{ fontSize: "10px", color: "#94A3B8" }}>{repairTransferNote}</div>
              ) : null}
              <button
                data-testid="deal-calc-repairs-clear"
                onClick={handleRepairClear}
                style={{ ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "4px 8px", alignSelf: "flex-start" }}
              >
                <RotateCcw size={11} /> Clear repairs
              </button>
              <div style={{ fontSize: "10px", color: "#475569" }}>
                Clear repairs returns to the known-only $0 and keeps ARV, Test Price and the Miscellaneous description.
              </div>
              {draftStatus("repairItems")}
            </div>
          )}
          {draftStatus("repairsMode")}
        </div>

        <div style={PANEL_STYLE}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Test Price</div>
          <input
            data-testid="deal-calc-test-price-input"
            value={testPriceInput}
            onChange={(e) => setTestPriceInput(e.target.value)}
            placeholder="What if we offered..."
            style={{ ...INPUT_STYLE, width: "100%" }}
          />
          {testPriceParsed.kind === "invalid" ? (
            <div data-testid="deal-calc-test-price-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{testPriceParsed.reason}</div>
          ) : null}
          {draftStatus("testPrice")}
          <div style={{ fontSize: "10px", color: "#475569", marginTop: "6px" }}>
            Operator-entered only -- IAOS never sets or defaults this.
          </div>
        </div>
      </div>

      {/* B15-26 (INV-134): wholesaler costs and estimated net. Reads only the
          existing Expected Spread above; gates nothing; saves nothing. */}
      <NetProceedsPanel key={netPanelRevision} grossSpread={expectedSpread} repairs={repairCompleteness} />

      {/* Optional linking. INV-70 / B9-07A Phase 2 correction round 3 --
          no save-back of any kind happens from this panel anymore (Repairs'
          own save-back removed alongside ARV's pre-existing absence). */}
      <div style={{ ...PANEL_STYLE, marginTop: "16px" }} data-testid="deal-calc-link-panel">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Link (optional)</div>
        {linkedContactId ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span data-testid="deal-calc-linked-badge" style={{ fontSize: "13px", color: "#E2E8F0" }}>
              Linked to: {linkedContactName}
            </span>
            <button data-testid="deal-calc-unlink" onClick={handleUnlink} style={COMPACT_BUTTON_STYLE}>
              <Unlink size={12} /> Unlink
            </button>
            <Link to={`/contacts/${linkedContactId}/underwriting`} data-testid="deal-calc-view-arv-workspace" style={COMPACT_BUTTON_STYLE}>
              <ExternalLink size={12} /> Underwriting workspace
            </Link>
            <div style={{ fontSize: "10px", color: "#475569" }}>
              Neither ARV nor Repairs is saved from here -- approve them in the Underwriting workspace (ARV with real comp evidence; Repairs against the linked Opportunity).
            </div>
            {/* B15-25: which deal these figures are kept for. Several deals need a choice; no first-deal guess. */}
            {deals && deals.length > 1 ? (
              <label style={{ ...LABEL_STYLE, flexDirection: "row", alignItems: "center", gap: "6px" }}>
                Keep figures for deal:
                <select data-testid="deal-calc-deal-select" value={selectedDealId ?? ""} onChange={(e) => handleChooseDeal(e.target.value)} style={{ ...INPUT_STYLE, width: "auto" }}>
                  <option value="" disabled>Choose a deal</option>
                  {deals.map((d) => <option key={d.id} value={d.id}>{d.opportunityName || d.id}</option>)}
                </select>
              </label>
            ) : deals && deals.length === 1 ? (
              <span data-testid="deal-calc-deal-name" style={{ fontSize: "11px", color: "#94A3B8" }}>Deal: {deals[0].opportunityName || deals[0].id}</span>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <input
              data-testid="deal-calc-link-input"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Contact ID"
              style={INPUT_STYLE}
            />
            <button
              data-testid="deal-calc-link-button"
              onClick={() => void performLink(linkInput)}
              disabled={linkBusy || linkInput.trim() === ""}
              style={{ ...COMPACT_BUTTON_STYLE, opacity: linkInput.trim() === "" ? 0.45 : 1, cursor: linkBusy || linkInput.trim() === "" ? "not-allowed" : "pointer" }}
            >
              {linkBusy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Link
            </button>
          </div>
        )}
        {linkError ? <div data-testid="deal-calc-link-error" style={{ color: "#EF4444", fontSize: "11px", marginTop: "8px" }}>{linkError}</div> : null}
      </div>

      {/* B15-25 Phase 2: Save Calculation to Deal / Load Saved Calculation -- linked contact only.
          I1: the panel saves for the deal chosen here. I4: remounted when the contact or the signed-in operator
          changes, so no deal-specific state, unconfirmed save or late result crosses operators. */}
      {linkedContactId ? (
        <DealCalculationSavePanel
          key={`${linkedContactId}|${draftOperator()}`}
          contactId={linkedContactId}
          opportunityId={context && context.kind === "deal" && context.contactId === linkedContactId ? context.opportunityId : null}
          dealName={context && context.kind === "deal" ? (deals?.find((d) => d.id === context.opportunityId)?.opportunityName || null) : null}
          figures={calculatorFigures}
          /* r4 P2-2: a kept browser draft (typed or restored) is unsaved work: Load asks before replacing it. */
          hasUnsavedWork={draft !== null}
          onLoad={handleLoadCalculation}
        />
      ) : null}

      {/* More Detail -- Assignment Mode + the eleven Investor Policy assumptions. */}
      <div style={{ marginTop: "16px" }}>
        <button
          data-testid="deal-calc-more-detail-toggle"
          onClick={() => setMoreDetailOpen((o) => !o)}
          style={{ ...COMPACT_BUTTON_STYLE }}
        >
          {moreDetailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} More Detail
        </button>
        {moreDetailOpen ? (
          <div style={{ ...PANEL_STYLE, marginTop: "10px" }} data-testid="deal-calc-more-detail-panel">
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Assignment Mode</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
              {(["standard", "profit_share", "manual"] as AssignmentModeName[]).map((m) => (
                <button
                  key={m}
                  data-testid={`deal-calc-assignment-${m}`}
                  onClick={() => setAssignmentMode(m)}
                  style={{ ...COMPACT_BUTTON_STYLE, background: assignmentMode === m ? "rgba(30,200,255,0.25)" : COMPACT_BUTTON_STYLE.background }}
                >
                  {m === "standard" ? "Standard Minimum" : m === "profit_share" ? "25% of Buyer Profit" : "Manual"}
                </button>
              ))}
            </div>
            {assignmentMode === "manual" ? (
              <input
                data-testid="deal-calc-manual-amount-input"
                value={manualAmountInput}
                onChange={(e) => setManualAmountInput(e.target.value)}
                placeholder="Manual assignment spread"
                style={{ ...INPUT_STYLE, marginBottom: "10px" }}
              />
            ) : null}
            {draftStatus("assignmentMode")}
            {assignmentMode === "manual" ? draftStatus("manualAmount") : null}

            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", margin: "14px 0 10px" }}>
              Investor Policy (read-only{policyError ? " -- could not load; using IAOS Starter defaults" : ""})
            </div>
            <div style={{ fontSize: "11px", color: "#475569", marginBottom: "8px" }}>
              {policyValues === null
                ? "Loading Investor Policy from GHL..."
                : policyError
                ? "Could not load Investor Policy -- every value below is an IAOS Starter default."
                : `${policyValues.length} Custom Value(s) read from GHL; any not configured resolve from IAOS Starter defaults.`}
            </div>
            <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }} data-testid="deal-calc-investor-policy">
              {policyRow("Selling Cost %", parsedPolicy.sellingCostPct, IAOS_STARTERS.sellingCostPct, pct)}
              {policyRow("Closing Cost", parsedPolicy.closingCost, IAOS_STARTERS.closingCost, money)}
              {policyRow("Monthly Carry", parsedPolicy.monthlyCarry, IAOS_STARTERS.monthlyCarry, money)}
              {policyRow("Hold Months", parsedPolicy.holdMonths, IAOS_STARTERS.holdMonths, (n) => String(n))}
              {policyRow("Buyer Profit %", parsedPolicy.buyerProfitPct, IAOS_STARTERS.buyerProfitPct, pct)}
              <div>
                Purchase Financing:{" "}
                {parsedPolicy.financingEnabled.kind === "value"
                  ? (parsedPolicy.financingEnabled.value ? "On" : "Off")
                  : (IAOS_STARTERS.financingEnabled ? "On" : "Off")}{" "}
                <span style={{ color: "#475569" }}>
                  ({parsedPolicy.financingEnabled.kind === "value" ? "Investor Policy" : "IAOS Starter"})
                </span>
              </div>
              {policyRow("Financing LTV", parsedPolicy.financingLtv, IAOS_STARTERS.financingLtv, pct)}
              {policyRow("Financing Rate", parsedPolicy.financingRate, IAOS_STARTERS.financingRate, pct)}
              {policyRow("Financing Points", parsedPolicy.financingPoints, IAOS_STARTERS.financingPoints, pct)}
              {policyRow("Standard Minimum Assignment Spread", parsedPolicy.standardMinimum, IAOS_STARTERS.standardMinimum, money)}
              {policyRow("Buyer Profit Share %", parsedPolicy.profitSharePct, IAOS_STARTERS.profitSharePct, pct)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
