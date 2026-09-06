import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion, Copy, ExternalLink, Home, AlertTriangle } from "lucide-react";
import { ghl, type ContactDetail } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import {
  parsePolicy,
  parseOpportunityValues,
  parseContactSeeds,
  parseDealOverrides,
  resolveDealFacts,
  resolveInputs,
} from "../lib/underwriting/resolver";
import { computeUnderwriting } from "../lib/underwriting/compute";
import { toViewModel, type ScreenState, type SelectedOpportunity } from "../lib/underwriting/view-model";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import type { DealFacts, PolicyParseIssue } from "../lib/underwriting/resolver-types";
import type { AssignmentResolution, UnderwritingResult } from "../lib/underwriting/types";
import { computeBoard8Economics, computeExpectedSpread, type Board8Economics, type ExpectedSpread } from "../lib/underwriting/board8-economics";
import { computeOfferReadiness, type ReadinessResult } from "../lib/underwriting/offer-readiness";
import { computeNextBestQuestion, type NextBestQuestion } from "../lib/underwriting/next-best-question";
import { buildDealBarCells, type DealBarCell } from "../lib/seller-call-deal-bar";
import { buildOfferReadinessInputs } from "../lib/seller-call-readiness-inputs";
import { latestArvApprovalForOpportunity, matchingArvApprovalForOpportunity } from "../lib/arv-approval-note";
import {
  subjectAddress, handoffToPropStream, copyAddressAgain, browserHandoffEnvironment,
  PROPSTREAM_LOGIN_URL, type HandoffResult,
} from "../lib/propstream";
import {
  computeNegotiationPosition, attemptOverride, isOverrideCurrent, requiresOverrideDecision,
  type NegotiationPosition, type NegotiationOverride,
} from "../lib/seller-call-negotiation";

/**
 * Seller Call Workspace -- B8-05 / INV-48, extended by B8-06 / INV-49.
 *
 * Route: /contacts/:id/seller-call. Same Contact-context sub-route
 * pattern UNDERWRITING_WORKSPACE_SPEC.md chose for /contacts/:id/underwriting
 * (decided 2026-08-14) and for the same reason: the deal bar is a
 * guardrail during a live call, and a guardrail that scrolls away is not
 * one. SELLER_ACQUISITION_WORKFLOW.md names this workspace as the surface
 * underwriting is one section of; B8-05 built the foundation and the
 * bar, B8-06 adds the single adaptive Next Best Question in its place.
 * Negotiation (INV-51) and the standalone calculator (INV-52) remain out
 * of scope here.
 *
 * NEXT BEST QUESTION (B8-06). `computeNextBestQuestion` (imported, never
 * reimplemented) picks ONE of B8-04's own readiness reasons to surface,
 * deterministically, from current facts alone -- no history, no script
 * pointer, no assumption about call order. See that module's own header
 * for the exact priority rule.
 *
 * READ ONLY. This page performs no writes of any kind -- not a note, not
 * last_call_attempt, not a callback, not an underwriting approval. It
 * fetches, resolves, computes, and renders. `ghl.notes.list` (B8-07 /
 * INV-50) is a read of the contact's existing note history -- the same
 * already-approved, already-used call `ContactWorkspace.tsx` and
 * `Conversations.tsx` already make -- to recover Board #7's own ARV
 * approval ledger entries via `arv-approval-note.ts`'s strict parser.
 *
 * CONSUME, DO NOT RECOMPUTE. The fetch-resolve-compute pipeline below
 * (contact + opportunities + policy -> parse -> resolve -> compute) is
 * copied verbatim in shape from UnderwritingWorkspace.tsx, because that
 * pipeline IS the one authoritative deal engine
 * (DEAL_ECONOMICS_OFFER_READINESS_V1.md's "one deal engine, three faces"),
 * and Board #6 (repairs) and Board #7 (ARV) already feed it through the
 * same resolver this page calls. computeBoard8Economics and
 * computeExpectedSpread (B8-03) and computeOfferReadiness (B8-04) are
 * imported and called, never reimplemented.
 *
 * START / RESUME. There is no separate call-session carrier to start or
 * resume -- SELLER_ACQUISITION_WORKFLOW.md is explicit that IAOS is
 * "stage-driven, not call-count-driven" and every interaction "resumes
 * from the last verified state." Because this page is a stateless-fresh
 * read of current GHL state on every visit, opening it always IS
 * resuming: there is nothing stale to catch up on and nothing to
 * explicitly "start." The entry links elsewhere are labelled
 * "Start / Resume Seller Call" for the operator's benefit; this page
 * itself does not distinguish the two.
 *
 * SELLER POSITION AND CURRENT OFFER, B8-08 / INV-51. INV-48 (above)
 * described a state that no longer holds: this issue is the "later
 * authorized implementation" that comment named. Both are now
 * OPERATOR-ENTERED SESSION STATE -- plain React state, initialized to
 * `null`/empty, changed ONLY by a human typing into the two negotiation
 * inputs below. IAOS assigns neither a default, a derived, or a
 * calculated value at any point; there is no code path that sets
 * `currentOffer` except the input's own `onChange`. This is still not a
 * GHL carrier of any kind -- it does not survive a page reload, and
 * `B8-11` (INV-54) remains the issue authorized to persist it durably.
 *
 * LIVE RECALCULATION, NO NEW ECONOMICS. Changing Current Offer only ever
 * changes what is fed into `computeExpectedSpread`'s existing
 * `referencePrice` parameter (B8-03, unchanged) -- Target Acquisition
 * Price and Max Supported Offer are read verbatim from `board8` and never
 * vary with negotiation strategy, exactly as `DEAL_ECONOMICS_OFFER_
 * READINESS_V1.md`'s "Opening offer... recalculates nothing upstream"
 * and `SELLER_ACQUISITION_WORKFLOW.md`'s "Negotiation pressure never
 * changes underwriting facts" both require.
 *
 * ABOVE-MAX OVERRIDE IS NOT OFFER READINESS'S HumanAction. This page's
 * `readiness` above stays wired exactly as B8-04 built it (`humanAction:
 * { kind: "none" }`, unchanged) -- it answers "is the evidence good
 * enough." The NEW `NegotiationOverride` (`seller-call-negotiation.ts`)
 * answers a different question, "does the operator want to proceed at a
 * PRICE above Max," and is tracked entirely separately. See that
 * module's own header for why the two must never merge.
 */

const CONTENT_MAX_WIDTH = "1200px";
const CONFIG = getRuntimeConfig();

const CV_IDS = CONFIG.customValues;
const OPP_IDS = {
  arv: CONFIG.opportunityFacts.arv,
  repairs: CONFIG.opportunityFacts.repairs,
  askingPrice: CONFIG.opportunityFacts.askingPrice,
  assignmentMode: CONFIG.opportunityFields.assignmentMode,
};
const CONTACT_IDS = {
  arv: CONFIG.fields.arv,
  repairs: CONFIG.fields.estimatedRepairs,
  askingPrice: CONFIG.fields.askingPrice,
};

/** Shared small-button style for the B8-07 compact entry points, matching ContactWorkspace.tsx's own Underwriting/Get Comps button styling. */
const COMPACT_LINK_STYLE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
  padding: "6px 10px", borderRadius: "7px", border: "1px solid rgba(30,200,255,0.35)",
  background: "rgba(30,200,255,0.08)", color: "#1EC8FF", textDecoration: "none",
};
const COMPACT_BUTTON_STYLE: React.CSSProperties = { ...COMPACT_LINK_STYLE };

/** Page-local, one consumer -- same convention Dashboard.tsx and UnderwritingWorkspace.tsx each already follow for their own copies. */
function contactName(c: ContactDetail | null): string {
  if (!c) return "—";
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

function formatAddress(c: ContactDetail | null): string {
  if (!c) return "—";
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ") || "—";
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Parses a negotiation input field. Empty/whitespace and anything that
 * does not resolve to a finite number both return `null` -- an invalid
 * or not-yet-typed value is treated as "not entered," never coerced to
 * zero (PB-D56 section III's own rule: unknown is never a favorable
 * default) and never silently rounded to something the operator did not
 * type.
 */
function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function Shell({ contactId, children }: { contactId: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH }}>
      <Link to={`/contacts/${contactId}`} style={{
        display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px",
        color: "#64748B", marginBottom: "14px", textDecoration: "none",
      }}>
        <ArrowLeft size={13} /> Contact
      </Link>
      {children}
    </div>
  );
}

function Notice({ tone, title, body }: { tone: "error" | "warn" | "info"; title: string; body?: string }) {
  const color = tone === "error" ? "#EF4444" : tone === "warn" ? "#F59E0B" : "#64748B";
  return (
    <div style={{
      display: "flex", gap: "12px", alignItems: "flex-start", padding: "18px 20px",
      background: `${color}0F`, border: `1px solid ${color}33`, borderRadius: "10px",
    }}>
      <AlertCircle size={20} style={{ color, flexShrink: 0, marginTop: "1px" }} />
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>{title}</div>
        {body ? <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>{body}</div> : null}
      </div>
    </div>
  );
}

/** Renders exactly what `buildDealBarCells` returns -- no formatting decision is made here. */
function DealBar({ cells }: { cells: DealBarCell[] }) {
  return (
    <div style={{
      display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start",
      padding: "16px 20px", background: "#0F172A", border: "1px solid #1E293B",
      borderRadius: "10px", marginBottom: "16px",
    }}>
      {cells.map((cell) => (
        <div key={cell.key} style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
          <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {cell.label}
          </span>
          {cell.value.kind === "value" ? (
            <span style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0" }}>
              {cell.value.text}
            </span>
          ) : (
            <span style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 600, paddingTop: "4px", lineHeight: 1.4 }} title={cell.value.text}>
              {cell.value.text}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const READINESS_STYLE: Record<ReadinessResult["effectiveStatus"], { color: string; label: string; Icon: typeof ShieldCheck }> = {
  OFFER_READY: { color: "#22C55E", label: "OFFER READY", Icon: ShieldCheck },
  REVIEW_NEEDED: { color: "#F59E0B", label: "REVIEW NEEDED", Icon: ShieldAlert },
  NOT_READY: { color: "#EF4444", label: "NOT READY", Icon: ShieldQuestion },
};

/**
 * Offer Ready state, adjacent to the bar rather than inside it -- INV-48
 * is explicit that this is not another dollar tile. Renders exactly what
 * B8-04 (`computeOfferReadiness`) returned; no local readiness logic.
 */
function ReadinessBadge({ readiness }: { readiness: ReadinessResult }) {
  const style = READINESS_STYLE[readiness.effectiveStatus];
  const Icon = style.Icon;
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px",
        borderRadius: "8px", background: `${style.color}1A`, border: `1px solid ${style.color}44`,
      }}>
        <Icon size={16} style={{ color: style.color }} />
        <span style={{ fontSize: "13px", fontWeight: 700, color: style.color, letterSpacing: "0.02em" }}>
          {style.label}
        </span>
        {readiness.status !== readiness.effectiveStatus ? (
          <span style={{ fontSize: "11px", color: "#94A3B8" }}>
            (raw evidence: {readiness.status.replace("_", " ")} -- {readiness.humanAction.kind})
          </span>
        ) : null}
      </div>
      {readiness.reasons.length > 0 ? (
        <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
          {readiness.reasons.map((r, i) => (
            <li key={i} style={{ fontSize: "12px", color: "#94A3B8", padding: "3px 0" }}>
              {r.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SellerCallWorkspace() {
  const { id } = useParams<{ id: string }>();
  const contactId = id ?? "";

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [opps, setOpps] = useState<import("../lib/ghl").OpportunityRow[] | null>(null);
  const [policyValues, setPolicyValues] = useState<{ id: string; value: string }[] | null>(null);
  const [notes, setNotes] = useState<{ id: string; body: string; dateAdded: string }[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);

  /* B7-02 — Get Comps handoff state. SESSION-ONLY, same as
     ContactWorkspace.tsx's own copy: no note, no field, nothing persisted.
     This is the SAME `propstream.ts` module and the SAME functions that
     surface calls, reused verbatim -- not a second handoff implementation. */
  const [comps, setComps] = useState<HandoffResult | null>(null);
  const [compsBusy, setCompsBusy] = useState(false);

  /* B8-08 / INV-51 — live negotiation. SESSION-ONLY, operator-entered,
     cleared on reload. Raw string state (not `number | null` directly) so
     the input reflects exactly what was typed, including a mid-edit
     partial value; `parseMoneyInput` is the one place either becomes a
     number or `null`. IAOS sets neither field except through these two
     inputs' own `onChange` -- there is no other assignment to either
     state setter anywhere in this component. */
  const [sellerPositionInput, setSellerPositionInput] = useState("");
  const [currentOfferInput, setCurrentOfferInput] = useState("");
  const sellerPosition = useMemo(() => parseMoneyInput(sellerPositionInput), [sellerPositionInput]);
  const currentOffer = useMemo(() => parseMoneyInput(currentOfferInput), [currentOfferInput]);

  /* The one already-granted override, if any -- see seller-call-
     negotiation.ts's own header for why this is a DIFFERENT concept from
     `readiness.humanAction`. Never mutated in place: a new grant replaces
     it outright (`attemptOverride` always returns a fresh record), and
     staleness is DETECTED (`isOverrideCurrent`) rather than patched. */
  const [negotiationOverride, setNegotiationOverride] = useState<NegotiationOverride | null>(null);
  const [overrideReasonDraft, setOverrideReasonDraft] = useState("");
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [overrideActionError, setOverrideActionError] = useState<string | null>(null);
  /* Collapses the bounded-action prompt to a slim persistent line without
     ever fully hiding that Current Offer is above Max -- "Keep
     Negotiating" sets this; any edit to Current Offer resets it, so a
     NEW above-Max value always re-prompts rather than inheriting a
     dismissal that applied to a different number. */
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setFetchError(null);
    Promise.all([
      ghl.contacts.getDetail(contactId),
      ghl.opportunities.listPipeline(),
      ghl.underwriting.policy(),
      ghl.notes.list(contactId),
    ])
      .then(([c, pipeline, policy, notesResult]) => {
        if (cancelled) return;
        setContact(c);
        setOpps(opportunitiesForContact(pipeline.opportunities, contactId));
        setPolicyValues(policy.values);
        setNotes(notesResult.notes ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message); });
    return () => { cancelled = true; };
  }, [contactId]);

  const loading = fetchError === null && (contact === null || opps === null || policyValues === null || notes === null);

  const candidates: SelectedOpportunity[] = useMemo(() => opportunityCandidates(opps), [opps]);
  const selected: SelectedOpportunity | null = useMemo(
    () => selectOpportunity(candidates, chosenId),
    [candidates, chosenId],
  );

  const pipeline = useMemo(() => {
    if (!contact || !opps || !policyValues || !selected) {
      return { result: null as UnderwritingResult | null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null,
               issues: [] as PolicyParseIssue[], computeError: null as { field: string | null; message: string } | null,
               repairsSourceIsApprovalGated: false };
    }
    const opp = opps.find((o) => o.id === selected.id);
    if (!opp) {
      return { result: null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null, issues: [],
               computeError: null as { field: string | null; message: string } | null,
               repairsSourceIsApprovalGated: false };
    }
    try {
      const { policy, issues } = parsePolicy(policyValues, CV_IDS);
      const oppValues = parseOpportunityValues(opp.customFields, OPP_IDS);
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      const overrides = parseDealOverrides(opp.customFields);
      const facts = resolveDealFacts(oppValues, seeds);
      const inputs = resolveInputs(facts, overrides, policy);
      // Jess Gate, 2026-09-05: `facts.repairs` (seed-then-supersede, PB-D55)
      // resolves from the Opportunity side when present, the Contact-side
      // `estimated_repairs` seed otherwise. Only the Contact-side seed is
      // provably operator-approved -- Board 6's `persistGate` is the ONLY
      // writer of `contact.estimated_repairs`, whereas B8-02's own
      // inventory already found `opportunity.repair_estimate` has NO
      // writer anywhere in `ghl.ts`. Checking `oppValues.repairs.kind`
      // (computed above, BEFORE seed-then-supersede) rather than
      // `facts.repairs` itself is what lets this tell the two sources
      // apart: if the Opportunity side is absent, any non-null resolved
      // value necessarily came from the approval-gated Contact seed.
      const repairsSourceIsApprovalGated = oppValues.repairs.kind !== "value";
      return { result: computeUnderwriting(inputs), facts, assignment: inputs.assignment, issues, computeError: null, repairsSourceIsApprovalGated };
    } catch (e: any) {
      return {
        result: null, facts: null as DealFacts | null,
        assignment: null as AssignmentResolution | null, issues: [],
        computeError: { field: null, message: e?.message ?? "A configured value could not be interpreted." },
        repairsSourceIsApprovalGated: false,
      };
    }
  }, [contact, opps, policyValues, selected]);

  const screen: ScreenState = toViewModel({
    loading,
    fetchError,
    computeError: pipeline.computeError,
    candidates,
    selected,
    result: pipeline.result,
    facts: pipeline.facts,
    assignment: pipeline.assignment,
    issues: pipeline.issues,
    approve: { status: "idle" },
  });

  /* B8-03, consumed. `pipeline.result` is the same UnderwritingResult the
     line above feeds into toViewModel -- one computation, two readers,
     so the deal bar and the screen state can never disagree about it. */
  const board8: Board8Economics | null = useMemo(
    () => (pipeline.result ? computeBoard8Economics(pipeline.result) : null),
    [pipeline.result],
  );

  /* B8-08 / INV-51: `referencePrice` is now the REAL operator-entered
     Current Offer -- the exact line the pre-INV-51 comment here predicted
     would change once a carrier (session state, in this case) existed.
     `computeExpectedSpread` itself is untouched, imported, never
     reimplemented; this only supplies its input. */
  const expectedSpread: ExpectedSpread | null = useMemo(
    () => board8 && board8.status === "calculated"
      ? computeExpectedSpread({ endBuyerMaxPrice: board8.endBuyerMaxPrice, referenceKind: "current_offer", referencePrice: currentOffer })
      : null,
    [board8, currentOffer],
  );

  /* B8-08 / INV-51. Classifies Current Offer against board8's OWN
     `maxSupportedOffer` -- never a second Max calculation. `null` before
     an opportunity resolves, matching every other board8-derived useMemo
     on this page. */
  const negotiationPosition: NegotiationPosition | null = useMemo(
    () => (board8 ? computeNegotiationPosition({ currentOffer, board8 }) : null),
    [currentOffer, board8],
  );

  const negotiationOverrideIsCurrent = negotiationPosition
    ? isOverrideCurrent(negotiationOverride, negotiationPosition)
    : false;
  const negotiationNeedsDecision = negotiationPosition
    ? requiresOverrideDecision(negotiationPosition, negotiationOverride)
    : false;

  function handleSellerPositionChange(raw: string) {
    setSellerPositionInput(raw);
  }

  /* Every edit resets the override draft AND un-dismisses the warning --
     an acknowledgement or a dismissal made for one Current Offer value
     must never silently carry forward onto a different one typed next. */
  function handleCurrentOfferChange(raw: string) {
    setCurrentOfferInput(raw);
    setOverrideAcknowledged(false);
    setOverrideReasonDraft("");
    setOverrideActionError(null);
    setWarningDismissed(false);
  }

  function handleKeepNegotiating() {
    setWarningDismissed(true);
  }

  /* Abandons this above-Max entry outright -- clears Current Offer back
     to not-yet-entered, along with any override and draft state. This
     does not "rewrite" the negotiation position that existed: it is the
     same as the operator never having typed this number, one of the four
     bounded actions INV-51 names, not an edit to a recorded decision. */
  function handleCancelAboveMax() {
    setCurrentOfferInput("");
    setOverrideAcknowledged(false);
    setOverrideReasonDraft("");
    setOverrideActionError(null);
    setWarningDismissed(false);
    setNegotiationOverride(null);
  }

  /* The ONLY path that produces a NegotiationOverride -- `attemptOverride`
     itself enforces above-Max, acknowledgement, and a non-empty reason;
     this only supplies what the operator has entered and surfaces
     `ok: false` honestly rather than assuming success. */
  function handleOverrideAndContinue() {
    if (!negotiationPosition) return;
    const result = attemptOverride({
      position: negotiationPosition,
      acknowledged: overrideAcknowledged,
      reason: overrideReasonDraft,
      operator: "Brad Thompson",
      at: new Date().toISOString(),
    });
    if (!result.ok) {
      setOverrideActionError(result.error);
      return;
    }
    setOverrideActionError(null);
    setNegotiationOverride(result.override);
    setWarningDismissed(false);
  }

  /* B8-07 / INV-50, Jess Gate correction 2026-09-05, Jess Re-Gate
     correction 2026-09-05 (2nd round). Reads Board #7's EXISTING
     append-only ARV approval ledger note (arv-persist.ts's
     `formatArvApprovalNote`) back via the strict, fail-closed
     `arv-approval-note.ts` parser -- not a new carrier, a read of an
     already-approved, already-written record through the already-used
     `ghl.notes.list` capability. Scoped to THIS opportunity
     (`screen.opportunity.id`): a contact holding more than one deal's
     history must never have one deal's evidence attributed to another
     (PB-D55). Guarded on `screen.state` being resolved/unresolved so
     `screen.opportunity` exists; `notes` is never null here since
     `loading` already gates rendering on it.

     TWO separate reads, for two separate purposes:
       - `latestArvLedgerEntry`: the latest valid entry regardless of
         amount, used ONLY for truthful UI text (distinguishing "no
         ledger entry" from "an entry exists but doesn't match" below).
       - `matchedArvApproval`: the latest valid entry ONLY when its
         `Approved ARV` matches `screen.known.arv` exactly -- the ONLY
         one Offer Readiness is allowed to treat as usable evidence (Jess
         Re-Gate: a stale entry must never lend evidence to an amount it
         was not actually approved for). */
  const latestArvLedgerEntry = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestArvApprovalForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  const matchedArvApproval = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return matchingArvApprovalForOpportunity(notes, screen.opportunity.id, screen.known.arv);
  }, [notes, screen]);

  /* B8-04, consumed, via buildOfferReadinessInputs (B8-07 / INV-50) --
     that module's own header states exactly which categories now reflect
     real evidence (repairsCondition, gated on `repairsSourceIsApprovalGated`
     proving the value passed IAOS's approval gate rather than merely
     being present; arv, from `matchedArvApproval` above -- amount-matched,
     never a stale entry) and which still cannot (property_identity,
     transaction assumptions, seller price position -- no determination
     mechanism exists for any of them yet). No human action control
     exists in this build. */
  const readiness: ReadinessResult | null = useMemo(() => {
    if (!board8) return null;
    const known = {
      arv: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.arv : null,
      repairs: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.repairs : null,
      askingPrice: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.askingPrice : null,
    };
    return computeOfferReadiness(buildOfferReadinessInputs({
      known,
      dealEconomics: board8,
      repairsApprovalProven: pipeline.repairsSourceIsApprovalGated,
      arvEvidenceState: matchedArvApproval?.evidenceState ?? null,
    }));
  }, [board8, screen, pipeline.repairsSourceIsApprovalGated, matchedArvApproval]);

  const dealBarCells = useMemo(
    () => buildDealBarCells({
      arv: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.arv : null,
      repairs: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.repairs : null,
      sellerPosition,
      currentOffer,
      board8,
      expectedSpread,
    }),
    [screen, sellerPosition, currentOffer, board8, expectedSpread],
  );

  const hasKnownFacts = (screen.state === "resolved" || screen.state === "unresolved")
    && (screen.known.arv !== null || screen.known.repairs !== null || screen.known.askingPrice !== null);

  /* B8-06, consumed. computeNextBestQuestion reads the SAME readiness
     result rendered above (ReadinessBadge), the SAME board8 object the
     deal bar reads Target/Max from, and the same known facts rendered in
     the Known Facts panel -- one set of computations, shared, so the
     question can never name a category the badge itself calls SUPPORTED,
     ask for a number the Known Facts panel already shows, or diagnose a
     deal-economics cause the deal bar's own figures contradict. `board8`
     is guaranteed non-null here: `readiness` above is only ever set from
     a non-null `board8` (see the readiness useMemo). */
  const nextBestQuestion: NextBestQuestion | null = useMemo(() => {
    if (!readiness || !board8) return null;
    const known = {
      arv: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.arv : null,
      repairs: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.repairs : null,
      askingPrice: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.askingPrice : null,
    };
    return computeNextBestQuestion(readiness, known, board8);
  }, [readiness, board8, screen]);

  /* B7-02 — the subject address, from the SAME four native fields the
     identity header above already renders through formatAddress. null
     when incomplete, which disables Get Comps rather than handing
     PropStream a street line that resolves to the wrong county. Verbatim
     copy of ContactWorkspace.tsx's own derivation -- same fields, same
     function, same rule. */
  const compsAddress = contact ? subjectAddress(contact) : null;

  async function handleGetComps() {
    if (!compsAddress) return;
    setCompsBusy(true);
    try {
      setComps(await handoffToPropStream(compsAddress, browserHandoffEnvironment()));
    } finally {
      setCompsBusy(false);
    }
  }

  async function handleCopyAgain() {
    if (!comps) return;
    setCompsBusy(true);
    try {
      const clipboard = await copyAddressAgain(comps.address, browserHandoffEnvironment().clipboard);
      setComps({ ...comps, clipboard });
    } finally {
      setCompsBusy(false);
    }
  }

  return (
    <Shell contactId={contactId}>
      <div style={{ marginBottom: "6px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0 }}>
          Seller Call
        </h1>
        <div style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
          {contactName(contact)}
          {(screen.state === "resolved" || screen.state === "unresolved") && screen.opportunity.name !== contactName(contact)
            ? <> · <span style={{ color: "#94A3B8" }}>{screen.opportunity.name}</span></>
            : null}
        </div>
        <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
          {formatAddress(contact)}{contact?.phone ? ` · ${contact.phone}` : ""}
        </div>
      </div>

      {/* Call context. No call-session carrier exists (see module header):
          this is a one-line framing derived from what is already known,
          not a persisted "call state." */}
      {!loading && fetchError === null ? (
        <div style={{ fontSize: "12px", color: "#64748B", margin: "10px 0 18px" }}>
          {hasKnownFacts
            ? "Resuming — deal facts already on file for this contact."
            : "Starting fresh — no deal facts on file for this contact yet."}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748B", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading seller call context…
        </div>
      ) : null}

      {screen.state === "fetch_error" ? (
        <Notice tone="error" title="Could not load this deal" body={screen.message} />
      ) : null}

      {screen.state === "orchestration_error" ? (
        <Notice tone="error" title="Deal context could not be assembled" body={screen.detail} />
      ) : null}

      {screen.state === "no_opportunity" ? (
        <Notice
          tone="info"
          title="No opportunity on this contact"
          body="A seller call needs a deal to attach to (PB-D55). Create an opportunity in GHL before starting this call."
        />
      ) : null}

      {screen.state === "awaiting_selection" ? (
        <div>
          <Notice
            tone="info"
            title="Select the deal for this call"
            body="This contact holds more than one opportunity. IAOS does not assume the first one is the deal."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }}>
            {screen.candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => setChosenId(c.id)}
                style={{
                  textAlign: "left", padding: "12px 16px", background: "#0F172A",
                  border: "1px solid #1E293B", borderRadius: "8px", color: "#E2E8F0",
                  fontSize: "13px", cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {screen.state === "configuration_error" ? (
        <Notice
          tone="error"
          title="Deal configuration error"
          body={`A configured value could not be interpreted safely${screen.field ? ` (${screen.field})` : ""}. ${screen.message}`}
        />
      ) : null}

      {(screen.state === "resolved" || screen.state === "unresolved") ? (
        <>
          {/* Jess Gate, 2026-09-05: the deal bar and its adjacent Offer Ready
              guardrail must stay visible while the workspace scrolls -- the
              page's own header comment already calls this a guardrail, and
              a guardrail that scrolls away is not one (the same argument
              UNDERWRITING_WORKSPACE_SPEC.md makes for the call rail).
              `position: sticky` against `<main>` (Layout.tsx), the nearest
              scrolling ancestor, with an opaque background matching
              `<main>`'s own (#0A0E1A) so scrolled content never shows
              through, and a border to separate it from what scrolls
              beneath. DealBar's cell order/labels and ReadinessBadge's
              "adjacent, not an eighth tile" placement are UNCHANGED --
              this wraps them, it does not alter what either renders. */}
          <div
            data-testid="seller-call-sticky-bar"
            style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "#0A0E1A", paddingTop: "6px", paddingBottom: "2px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <DealBar cells={dealBarCells} />
            {readiness ? <ReadinessBadge readiness={readiness} /> : null}
          </div>

          {screen.state === "unresolved" ? (
            <Notice
              tone="warn"
              title="Underwriting has not resolved"
              body={"Waiting for " + screen.missingLabels.join(", ") + ". Known facts above are shown regardless."}
            />
          ) : null}

          {/* B8-08 / INV-51 — live negotiation. Two operator inputs
              (Seller Position, Current Offer); Target/Max/Spread are
              rendered above in the sticky DealBar from the SAME board8/
              expectedSpread objects computed once for this page -- no
              second display of the same figures, no recomputation of any
              of them here. This panel's only job is the inputs and the
              above-Max warning/bounded-action flow. */}
          <div
            data-testid="negotiation-panel"
            style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px", marginTop: "8px" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Negotiation</div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: negotiationPosition ? "14px" : 0 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#64748B" }}>
                Seller Position
                <input
                  data-testid="negotiation-seller-position-input"
                  value={sellerPositionInput}
                  onChange={(e) => handleSellerPositionChange(e.target.value)}
                  placeholder="Not yet entered"
                  style={{
                    background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px",
                    padding: "8px 10px", color: "#E2E8F0", fontSize: "13px", width: "150px",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#64748B" }}>
                Current Offer
                <input
                  data-testid="negotiation-current-offer-input"
                  value={currentOfferInput}
                  onChange={(e) => handleCurrentOfferChange(e.target.value)}
                  placeholder="Not yet entered — IAOS never sets this"
                  style={{
                    background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px",
                    padding: "8px 10px", color: "#E2E8F0", fontSize: "13px", width: "220px",
                  }}
                />
              </label>
            </div>

            {/* Ordinary within-Max negotiation renders NOTHING further here
                -- no warning, no bounded actions, no override control. */}
            {negotiationPosition && negotiationPosition.status === "above_max" ? (
              negotiationOverrideIsCurrent ? (
                <div
                  data-testid="negotiation-override-acknowledged"
                  style={{
                    display: "flex", gap: "10px", alignItems: "flex-start", padding: "12px 14px",
                    background: "#F59E0B0F", border: "1px solid #F59E0B33", borderRadius: "8px",
                  }}
                >
                  <AlertTriangle size={16} style={{ color: "#F59E0B", flexShrink: 0, marginTop: "1px" }} />
                  <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.6 }}>
                    <strong style={{ color: "#F59E0B" }}>Overridden — proceeding {money(negotiationOverride!.amountAboveMaxAtOverride)} above Max.</strong>
                    <div style={{ color: "#94A3B8", marginTop: "3px" }}>Reason: {negotiationOverride!.reason}</div>
                    <div style={{ color: "#64748B", marginTop: "2px", fontSize: "11px" }}>
                      Acknowledged by {negotiationOverride!.operator} at {negotiationOverride!.at}.
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="negotiation-above-max-warning"
                  style={{
                    display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px",
                    background: "#EF44440F", border: "1px solid #EF444444", borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <AlertTriangle size={16} style={{ color: "#EF4444", flexShrink: 0, marginTop: "1px" }} />
                    <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.6 }}>
                      <strong style={{ color: "#EF4444" }}>
                        Current Offer is {money(negotiationPosition.amountAboveMax)} above Max Supported Offer.
                      </strong>
                      <div style={{ color: "#94A3B8", marginTop: "3px", fontSize: "12px" }}>
                        Proceeding at this price gives up {money(negotiationPosition.amountAboveMax)} of the
                        wholesaler's minimum acceptable economics under current assumptions.
                      </div>
                    </div>
                  </div>

                  {!warningDismissed ? (
                    <>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          data-testid="negotiation-action-keep-negotiating"
                          onClick={handleKeepNegotiating}
                          style={{ ...COMPACT_BUTTON_STYLE, cursor: "pointer" }}
                        >
                          Keep Negotiating
                        </button>
                        <Link
                          to={`/contacts/${contactId}/underwriting`}
                          data-testid="negotiation-action-review-assumptions"
                          style={COMPACT_LINK_STYLE}
                        >
                          Review Assumptions
                        </Link>
                        <button
                          data-testid="negotiation-action-cancel"
                          onClick={handleCancelAboveMax}
                          style={{ ...COMPACT_BUTTON_STYLE, cursor: "pointer", borderColor: "rgba(239,68,68,0.35)", color: "#EF4444", background: "rgba(239,68,68,0.08)" }}
                        >
                          Cancel
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#94A3B8" }}>
                          <input
                            type="checkbox"
                            data-testid="negotiation-override-acknowledge-checkbox"
                            checked={overrideAcknowledged}
                            onChange={(e) => setOverrideAcknowledged(e.target.checked)}
                          />
                          I acknowledge this offer exceeds Max Supported Offer and intend to proceed anyway.
                        </label>
                        <textarea
                          data-testid="negotiation-override-reason-input"
                          value={overrideReasonDraft}
                          onChange={(e) => setOverrideReasonDraft(e.target.value)}
                          placeholder="Reason for proceeding above Max (required)"
                          rows={2}
                          style={{
                            background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px",
                            padding: "8px 10px", color: "#E2E8F0", fontSize: "12px", resize: "vertical",
                          }}
                        />
                        {overrideActionError ? (
                          <div style={{ fontSize: "11px", color: "#EF4444" }}>{overrideActionError}</div>
                        ) : null}
                        <button
                          data-testid="negotiation-action-override-continue"
                          onClick={handleOverrideAndContinue}
                          disabled={!overrideAcknowledged || overrideReasonDraft.trim() === ""}
                          style={{
                            ...COMPACT_BUTTON_STYLE, alignSelf: "flex-start",
                            cursor: !overrideAcknowledged || overrideReasonDraft.trim() === "" ? "not-allowed" : "pointer",
                            opacity: !overrideAcknowledged || overrideReasonDraft.trim() === "" ? 0.45 : 1,
                            borderColor: "rgba(239,68,68,0.45)", color: "#EF4444", background: "rgba(239,68,68,0.1)",
                          }}
                        >
                          Override &amp; Continue
                        </button>
                      </div>
                    </>
                  ) : (
                    <div data-testid="negotiation-warning-dismissed" style={{ fontSize: "11px", color: "#F59E0B" }}>
                      Still {money(negotiationPosition.amountAboveMax)} above Max — not yet acknowledged.{" "}
                      <button
                        data-testid="negotiation-action-reopen"
                        onClick={() => setWarningDismissed(false)}
                        style={{ background: "none", border: "none", color: "#1EC8FF", cursor: "pointer", fontSize: "11px", padding: 0, textDecoration: "underline" }}
                      >
                        Decide now
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : null}
          </div>

          {/* Known facts / Next Best Question -- the conversation-first
              content this route exists to show. B8-06 / INV-49: the
              objective panel is now ONE deterministic, prioritized
              question from computeNextBestQuestion, not a script and not
              a dump of every open reason. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "8px" }}>
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Known facts</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.8 }}>
                <div>ARV: {screen.known.arv !== null ? screen.known.arv.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
                <div>Repairs: {screen.known.repairs !== null ? screen.known.repairs.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
                <div>Seller Ask: {screen.known.askingPrice !== null ? screen.known.askingPrice.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
              </div>
            </div>
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="next-best-question-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>
                Next Best Question
              </div>
              {nextBestQuestion === null ? (
                <div style={{ fontSize: "13px", color: "#64748B", lineHeight: 1.6 }}>
                  Underwriting must resolve before a question can be set.
                </div>
              ) : nextBestQuestion.kind === "offer_ready" ? (
                <div style={{ fontSize: "13px", color: "#22C55E", fontWeight: 600, lineHeight: 1.6 }}>
                  {nextBestQuestion.message}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "14px", color: "#E2E8F0", fontWeight: 600, lineHeight: 1.5 }}>
                    {nextBestQuestion.question}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginTop: "8px" }}>
                    Why it matters: {nextBestQuestion.whyItMatters}
                  </div>
                </div>
              )}
            </div>

            {/* B8-07 / INV-50 — compact Estimate Repairs entry/resume.
                REUSES Board #6's approved-total carrier and estimator:
                this card shows the SAME `screen.known.repairs` value
                already read above (no second read, no recomputation) and
                links to /contacts/:id/underwriting, the existing
                dedicated surface where the full repair estimator (Not
                Asked/Good/Repair/Replace, category Major/Material,
                session-only row amounts, approved-total persistence)
                already lives. No repair calculation of any kind happens
                on this page. */}
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="repairs-entry-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Repairs</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", marginBottom: "12px" }} data-testid="repairs-provenance">
                {screen.known.repairs === null
                  ? "Not yet estimated."
                  : pipeline.repairsSourceIsApprovalGated
                  ? `Approved: ${money(screen.known.repairs)}`
                  : `${money(screen.known.repairs)} on file, not verified as operator-approved.`}
              </div>
              <Link
                to={`/contacts/${contactId}/underwriting`}
                data-testid="seller-call-estimate-repairs-link"
                style={COMPACT_LINK_STYLE}
              >
                <Home size={12} /> {screen.known.repairs !== null ? "Re-estimate Repairs" : "Estimate Repairs"}
              </Link>
            </div>

            {/* B8-07 / INV-50 — compact Get/View/Import Comps entry
                points. REUSES B7-02's browser-based PropStream handoff
                verbatim (same module, same functions, same session-only
                helper pattern as ContactWorkspace.tsx's own Get Comps) and
                links to /contacts/:id/underwriting for the full ARV comps
                workspace (CSV import, classification, reconciliation,
                Approve/Override) -- no comp engine or appraisal logic of
                any kind exists on this page. */}
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="arv-comps-entry-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>ARV &amp; Comps</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", marginBottom: "12px" }} data-testid="arv-provenance">
                {screen.known.arv === null
                  ? "Not yet established."
                  : matchedArvApproval
                  ? `Approved: ${money(screen.known.arv)} (evidence: ${matchedArvApproval.evidenceState})`
                  : latestArvLedgerEntry
                  ? `${money(screen.known.arv)} on file — ledger entry found but does not match this amount; evidence withheld.`
                  : `${money(screen.known.arv)} on file, no approval ledger entry found.`}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={handleGetComps}
                  disabled={compsBusy || !compsAddress}
                  data-testid="seller-call-get-comps"
                  title={compsAddress
                    ? `Copies ${compsAddress} and opens PropStream, where you paste it into the property search`
                    : "No complete subject-property address on this record (street, city and state are all required)"}
                  style={{ ...COMPACT_BUTTON_STYLE, opacity: compsAddress ? 1 : 0.45, cursor: compsBusy || !compsAddress ? "not-allowed" : "pointer" }}
                >
                  <Copy size={12} /> Get Comps
                </button>
                <Link to={`/contacts/${contactId}/underwriting`} data-testid="seller-call-view-import-comps" style={COMPACT_LINK_STYLE}>
                  <ExternalLink size={12} /> View / Import Comps
                </Link>
              </div>
              {comps && (
                <div
                  data-testid="seller-call-comps-helper"
                  data-comps-clipboard={comps.clipboard}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
                    background: "#0D1B3E", border: "1px solid rgba(30,200,255,0.25)",
                    borderRadius: "8px", padding: "8px 12px", marginTop: "10px", fontSize: "11px", color: "#94A3B8",
                  }}
                >
                  <span style={{ color: comps.clipboard === "copied" ? "#1EC8FF" : "#F59E0B", fontWeight: 600 }}>
                    {comps.clipboard === "copied" ? "Address copied" : "Couldn't copy — copy it here"}
                  </span>
                  <span style={{ color: "#F1F5F9", userSelect: "all" }}>{comps.address}</span>
                  <button onClick={handleCopyAgain} disabled={compsBusy} style={{ ...COMPACT_LINK_STYLE, cursor: compsBusy ? "not-allowed" : "pointer", border: "1px solid rgba(30,200,255,0.35)" }}>
                    <Copy size={11} /> Copy Again
                  </button>
                  <a href={PROPSTREAM_LOGIN_URL} target="_blank" rel="noopener noreferrer" style={COMPACT_LINK_STYLE}>
                    <ExternalLink size={11} /> Open PropStream
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </Shell>
  );
}
