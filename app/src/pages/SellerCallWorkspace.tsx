import { useEffect, useMemo, useRef, useState } from "react";
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
import type { AssignmentResolution, UnderwritingResult, UnderwritingInputs } from "../lib/underwriting/types";
import { computeBoard8Economics, computeExpectedSpread, type Board8Economics, type ExpectedSpread } from "../lib/underwriting/board8-economics";
import { computeOfferReadiness, CATEGORY_LABEL, type ReadinessResult, type MaterialCategory, type HumanAction } from "../lib/underwriting/offer-readiness";
import { computeNextBestQuestion, computeQuestionQueue, CATEGORY_PRIORITY, type NextBestQuestion } from "../lib/underwriting/next-best-question";
import { FullScriptDrawer } from "../components/FullScriptDrawer";
import { buildDealBarCells, type DealBarCell } from "../lib/seller-call-deal-bar";
import { buildOfferReadinessInputs } from "../lib/seller-call-readiness-inputs";
import { latestArvApprovalForOpportunity, matchingArvApprovalForOpportunity } from "../lib/arv-approval-note";
import {
  subjectAddress, handoffToPropStream, copyAddressAgain, browserHandoffEnvironment,
  PROPSTREAM_LOGIN_URL, type HandoffResult,
} from "../lib/propstream";
import {
  computeNegotiationPosition, attemptOverride, isOverrideCurrent, requiresOverrideDecision,
  parseAcquisitionPriceInput, type NegotiationPosition, type NegotiationOverride,
} from "../lib/seller-call-negotiation";
import {
  latestOutcomeNoteForOpportunity, attemptRecordOutcome,
  type CallOutcomeKind, type OutcomeSnapshot,
} from "../lib/seller-call-outcome";
import {
  formatNegotiationOverrideNote, latestNegotiationOverrideNoteForOpportunity,
} from "../lib/seller-call-negotiation-override-note";
import { resolveResumeHydration, type DealHydrationRef } from "../lib/seller-call-resume";
import {
  formatPropertyIdentityConfirmationNote, currentPropertyIdentityConfirmationForOpportunity,
  latestPropertyIdentityNoteForOpportunity,
  formatTransactionAssumptionsNote, latestTransactionAssumptionsForOpportunity, type TransactionAssumptionField,
  formatSellerPricePositionNote, latestSellerPricePositionForOpportunity,
  formatReadinessHumanActionNote, latestReadinessHumanActionForOpportunity, isReadinessDecisionCurrent,
  type ReadinessEvidenceSnapshot, type DealEconomicsInputsSnapshot, type ResolvedInputSnapshot,
  formatReadinessDecisionInvalidationNote, isReadinessDecisionInvalidated,
  latestLegacyReadinessHumanActionV1ForOpportunity,
  formatContractReadyChecklistNote, currentContractReadyChecklistForOpportunity,
  CONTRACT_READY_ITEM_KEYS, type ContractReadyItemKey, type ContractReadyItems,
} from "../lib/seller-call-readiness-carriers";
import { scheduleCallbackGated } from "../lib/callbackWrite";

/**
 * Seller Call Workspace -- B8-05 / INV-48, extended by B8-06 / INV-49,
 * B8-07 / INV-50, B8-08 / INV-51, B8-10 / INV-53, and B8-12 / INV-55.
 *
 * Route: /contacts/:id/seller-call. Same Contact-context sub-route
 * pattern UNDERWRITING_WORKSPACE_SPEC.md chose for /contacts/:id/underwriting
 * (decided 2026-08-14) and for the same reason: the deal bar is a
 * guardrail during a live call, and a guardrail that scrolls away is not
 * one. SELLER_ACQUISITION_WORKFLOW.md names this workspace as the surface
 * underwriting is one section of; B8-05 built the foundation and the
 * bar, B8-06 added the single adaptive Next Best Question, B8-07 added
 * the Repairs/ARV entry points, B8-08 added the live negotiation
 * experience, and B8-10 (below) adds resume context and the three
 * bounded call outcomes (Accept / Follow-Up / Pass) plus the Contract
 * Ready handoff. The standalone calculator (INV-52) is its own separate
 * page and remains out of scope here, as does durable negotiation-state
 * persistence (INV-54).
 *
 * NEXT BEST QUESTION (B8-06). `computeNextBestQuestion` (imported, never
 * reimplemented) picks ONE of B8-04's own readiness reasons to surface,
 * deterministically, from current facts alone -- no history, no script
 * pointer, no assumption about call order. See that module's own header
 * for the exact priority rule.
 *
 * CONVERSATION-FIRST HIERARCHY (B8-12 / INV-55, Brad-approved usability
 * correction locked 2026-09-07). "The script guides the conversation. MSK
 * governs readiness." This board changes PRESENTATION only, never the
 * engine: `computeQuestionQueue` (`next-best-question.ts`, same module,
 * same priority rule as `computeNextBestQuestion`) supplies "Other Useful
 * Questions" as everything past index 0 of the identical ordered list;
 * `OfferReadinessChecklist` renders the SAME `readiness.categories`
 * ReadinessBadge already reads, just as a compact six-item checklist
 * (satisfied categories checkmarked rather than omitted) instead of
 * paragraph text; and `FullScriptDrawer` renders Brad's approved script
 * verbatim from the new, pure `seller-call-script.ts` data module. No new
 * tracked fact, no new readiness input, no new write: `readiness.
 * effectiveStatus` remains the only Offer Ready authority, exactly as
 * B8-04 built it. See `seller-call-script.ts`'s own header for why most of
 * Brad's approved lines live ONLY in the Full Script drawer and are not
 * wired into live MSK-driven question selection.
 *
 * NO LONGER READ-ONLY, AS OF B8-10 / INV-53. Every prior board on this
 * page (B8-05 through B8-08) was correctly read-only; recording a bounded
 * call outcome is this page's first write of any kind. It performs
 * EXACTLY the three sanctioned writes AGENTS.md names, through EXISTING,
 * unmodified helpers -- `ghl.notes.create` (directly, and via the
 * unmodified `scheduleCallbackGated` for Follow-Up), `ghl.contacts.
 * setLastCallAttempt`, and `ghl.contacts.setCallbackDatetime` (via
 * `scheduleCallbackGated` only) -- never a fourth, and never
 * `iaos_call_disposition`/`iaos_call_routing`/`iaos_disposition_at`
 * (Board 4's cold-outreach fields; see `seller-call-outcome.ts`'s own
 * header for why those are never touched from here). `ghl.notes.list`
 * (B8-07 / INV-50) is a read of the contact's existing note history --
 * the same already-approved, already-used call `ContactWorkspace.tsx`
 * and `Conversations.tsx` already make -- to recover Board #7's own ARV
 * approval ledger entries via `arv-approval-note.ts`'s strict parser, and
 * now also this page's own outcome ledger entries via
 * `seller-call-outcome.ts`'s equally strict parser.
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
 *
 * RESUME, B8-10 / INV-53. Opening this page always performs the full
 * fetch-resolve-compute pipeline above -- there is nothing additional to
 * "resume" for Known Facts, Offer Readiness, or Next Best Question, all
 * three already live-derived from current GHL state on every load. What
 * B8-10 adds is `latestOutcome` below: the most recent bounded call
 * outcome (Accept / Follow-Up / Pass), read back through
 * `seller-call-outcome.ts`'s strict parser from the SAME notes this page
 * already fetches. This is what lets "what was last discussed" resume
 * durably -- Seller Position and Current Offer at the moment of that
 * outcome are part of its recorded snapshot, even though the LIVE
 * negotiation inputs above them remain B8-08's session-only state and do
 * not themselves survive a reload (a real, already-documented gap; see
 * `seller-call-outcome.ts`'s header for exactly what is and is not
 * durable, and why closing the rest is INV-54's scope, not invented here).
 *
 * BOUNDED CALL OUTCOMES ARE NOT A NEW CALL-STATUS UNIVERSE. Accept,
 * Follow-Up, and Pass are `docs/SELLER_ACQUISITION_WORKFLOW.md`'s own
 * three words from its master flow, recorded through the three EXISTING
 * sanctioned writes only (see the module's write-boundary note above).
 * No pipeline stage is read or written by any of the three -- moving an
 * Opportunity's stage has unproven workflow side effects (AGENTS.md: "no
 * field is written before its own inert-proof") and is not attempted.
 *
 * ACCEPTED PRICE IS THE EXISTING CURRENT OFFER. Accept records whatever
 * `currentOffer` already holds at the moment it is clicked -- there is no
 * second "accepted price" input, and this page invents no new field for
 * it. The write is a durable, resumable NOTE (an authoritative existing
 * mechanism, per `seller-call-outcome.ts`'s own header), not a new
 * carrier; a pipeline-level, bulk-queryable "Agreement Reached" field
 * does not exist and is not created here -- that gap is named explicitly
 * for INV-54 rather than closed by inventing one.
 *
 * AGREEMENT REACHED IS NOT UNDER CONTRACT, AND OFFER READY IS NOT
 * CONTRACT READY. `ReadinessBadge` above continues to render B8-04's
 * OFFER_READY/REVIEW_NEEDED/NOT_READY exactly as before -- Accept does
 * not change it, hide it, or fold into it. `AgreementBanner` and the
 * Contract Ready checklist below are a SEPARATE, ADDITIONAL surface,
 * shown only once the latest outcome is `accept`, and both remain purely
 * informational: no checklist item is required before anything else on
 * this page works, and Contract Readiness's own detailed definition
 * remains "distinct, detail deferred" to Board #9, unimplemented here.
 * The checklist's own check-state is session-only (never persisted) --
 * only the fact that agreement was reached, and the price it was reached
 * at, durably resume via the outcome note itself.
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

/** `null`-safe money, for a snapshot field that may have been unavailable at the moment of the outcome. */
function moneyOrUnknown(n: number | null): string {
  return n === null ? "unknown" : money(n);
}

/**
 * Jess Gate correction, 2026-09-08 -- adapts B8-03's `UnderwritingInputs`
 * (the RESOLVED policy assumptions `pipeline` already computed via
 * `resolveInputs`, imported, never reimplemented) into the plain,
 * JSON-serializable shape `seller-call-readiness-carriers.ts`'s
 * `DealEconomicsInputsSnapshot` expects. "Include the material economics
 * inputs AND outputs" -- this is the inputs half; `board8` supplies the
 * outputs half in `liveReadinessEvidenceSnapshot` below. Pure adaptation
 * only: no value here is computed, only read and reshaped.
 */
function resolvedInputSnapshot(r: { kind: "value"; value: number; level: string } | { kind: "unresolved"; reason: string } | undefined): ResolvedInputSnapshot {
  if (!r || r.kind !== "value") return null;
  return { value: r.value, level: r.level };
}

function buildDealEconomicsInputsSnapshot(inputs: UnderwritingInputs | null): DealEconomicsInputsSnapshot {
  if (!inputs) {
    return {
      sellingCostPct: null, closingCost: null, monthlyCarry: null, holdMonths: null, buyerProfitPct: null,
      standardMinimum: null, profitSharePct: null, assignmentMode: "unresolved", assignmentAmount: null,
      financingKind: "unresolved", financingLtv: null, financingRate: null, financingPoints: null,
    };
  }
  return {
    sellingCostPct: resolvedInputSnapshot(inputs.sellingCostPct),
    closingCost: resolvedInputSnapshot(inputs.closingCost),
    monthlyCarry: resolvedInputSnapshot(inputs.monthlyCarry),
    holdMonths: resolvedInputSnapshot(inputs.holdMonths),
    buyerProfitPct: resolvedInputSnapshot(inputs.buyerProfitPct),
    standardMinimum: resolvedInputSnapshot(inputs.standardMinimum),
    profitSharePct: resolvedInputSnapshot(inputs.profitSharePct),
    assignmentMode: inputs.assignment.kind,
    assignmentAmount: inputs.assignment.kind === "manual" ? inputs.assignment.amount : null,
    financingKind: inputs.financing.kind,
    financingLtv: inputs.financing.kind === "on" ? resolvedInputSnapshot(inputs.financing.ltv) : null,
    financingRate: inputs.financing.kind === "on" ? resolvedInputSnapshot(inputs.financing.rate) : null,
    financingPoints: inputs.financing.kind === "on" ? resolvedInputSnapshot(inputs.financing.points) : null,
  };
}

const OUTCOME_LABEL: Record<CallOutcomeKind, string> = {
  accept: "Accepted",
  follow_up: "Follow-Up scheduled",
  pass: "Passed",
};

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

/**
 * B8-12 / INV-55 — "What We Still Need / Offer Readiness", as a compact
 * list rather than paragraph text. Renders ALL SIX `MaterialCategory`
 * keys (unlike `ReadinessBadge.reasons`, which omits a category the
 * moment it reaches SUPPORTED) so a satisfied objective is shown
 * checkmarked rather than disappearing — the ticket's own "showing
 * satisfied and unresolved objectives" wording. Reads `readiness.
 * categories` verbatim; computes no evidence level of its own.
 */
function OfferReadinessChecklist({ readiness }: { readiness: ReadinessResult }) {
  return (
    <ul data-testid="offer-readiness-checklist" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {CATEGORY_PRIORITY.map((category: MaterialCategory) => {
        const level = readiness.categories[category];
        const satisfied = level === "SUPPORTED";
        return (
          <li
            key={category}
            data-testid={`offer-readiness-item-${category}`}
            style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "4px 0",
              fontSize: "12px", color: satisfied ? "#64748B" : "#E2E8F0",
              textDecoration: satisfied ? "line-through" : "none",
            }}
          >
            <span aria-hidden="true" style={{ color: satisfied ? "#22C55E" : "#475569", fontWeight: 700, width: "14px" }}>
              {satisfied ? "✓" : "○"}
            </span>
            <span>
              {CATEGORY_LABEL[category]}
              {!satisfied ? ` — ${level === "UNKNOWN" ? "not yet established" : "preliminary, not yet defensible"}` : null}
            </span>
          </li>
        );
      })}
    </ul>
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
     partial value. IAOS sets neither field except through these two
     inputs' own `onChange` -- there is no other assignment to either
     state setter anywhere in this component.

     Jess Gate, 2026-09-06: `parseAcquisitionPriceInput` (imported, never
     reimplemented) is the ONE place either raw string becomes a
     classified result -- `empty` (nothing typed), `invalid` (malformed,
     NaN, non-finite, zero, or negative -- never reaches economics), or
     `value` (a strictly positive, finite number). `sellerPosition`/
     `currentOffer` below collapse `empty` and `invalid` to `null` for
     every economics-consuming callsite (buildDealBarCells,
     computeNegotiationPosition, computeExpectedSpread) -- an invalid
     value is withheld from all of them exactly like an absent one -- while
     the parsed result itself is kept separately so the UI can show
     truthful, DISTINCT feedback for the two cases rather than one silent
     `null`. */
  const [sellerPositionInput, setSellerPositionInput] = useState("");
  const [currentOfferInput, setCurrentOfferInput] = useState("");
  const sellerPositionParsed = useMemo(() => parseAcquisitionPriceInput(sellerPositionInput), [sellerPositionInput]);
  const currentOfferParsed = useMemo(() => parseAcquisitionPriceInput(currentOfferInput), [currentOfferInput]);
  const sellerPosition = sellerPositionParsed.kind === "value" ? sellerPositionParsed.value : null;
  const currentOffer = currentOfferParsed.kind === "value" ? currentOfferParsed.value : null;

  /* The one already-granted override, if any -- see seller-call-
     negotiation.ts's own header for why this is a DIFFERENT concept from
     `readiness.humanAction`. Never mutated in place: a new grant replaces
     it outright (`attemptOverride` always returns a fresh record), and
     staleness is DETECTED (`isOverrideCurrent`) rather than patched.

     B8-11 / INV-54: this is no longer session-only. `handleOverrideAndContinue`
     below now WRITES a durable `seller-call-negotiation-override-note.ts`
     ledger entry before setting this state (never after -- see that
     handler), and the resume effect further down restores it from that
     same durable record via `resolveResumeHydration`'s `restoreOverride`.
     The state setter, its shape, and every read of it below are otherwise
     UNCHANGED from B8-08 / INV-51. */
  const [negotiationOverride, setNegotiationOverride] = useState<NegotiationOverride | null>(null);
  const [overrideReasonDraft, setOverrideReasonDraft] = useState("");
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [overrideActionError, setOverrideActionError] = useState<string | null>(null);
  /* B8-11 / INV-54 -- the override ledger write in flight, mirroring
     B8-10's `recordingOutcome` busy-state pattern: disables the confirm
     button and prevents a double-submit while `ghl.notes.create` is
     outstanding. Session-only UI state, like `recordingOutcome`. */
  const [overrideWriteBusy, setOverrideWriteBusy] = useState(false);
  /* Collapses the bounded-action prompt to a slim persistent line without
     ever fully hiding that Current Offer is above Max -- "Keep
     Negotiating" sets this; any edit to Current Offer resets it, so a
     NEW above-Max value always re-prompts rather than inheriting a
     dismissal that applied to a different number. */
  const [warningDismissed, setWarningDismissed] = useState(false);

  /* B8-10 / INV-53 — bounded call outcomes (Accept / Follow-Up / Pass).
     `showOutcomeForm` is which action's confirm form is expanded, or
     `null` for none -- only one at a time, never a hard block on
     switching. `recordingOutcome` mirrors B8-08's `saveBusy`-style
     pattern: the one action in flight, disabling the others while a
     write is outstanding. Neither is persisted -- both reset on reload,
     which is correct: they are draft/UI state for an action not yet
     taken, not the outcome itself (the note is). */
  const [showOutcomeForm, setShowOutcomeForm] = useState<CallOutcomeKind | null>(null);
  const [recordingOutcome, setRecordingOutcome] = useState<CallOutcomeKind | null>(null);
  const [outcomeActionError, setOutcomeActionError] = useState<string | null>(null);
  const [followUpAtInput, setFollowUpAtInput] = useState("");
  const [passReasonInput, setPassReasonInput] = useState("");

  /* B8-13 / INV-68 -- the four Offer Readiness determination carriers'
     write-in-flight/error state, one pair per carrier, mirroring
     `overrideWriteBusy`/`overrideActionError`'s established pattern
     exactly: write-then-set (never the reverse), disable the control
     while busy, surface a failure verbatim rather than assuming success.
     None of the four durable values themselves live in useState -- each
     is read fresh from `notes` via useMemo below, the SAME "stateless-
     fresh read of current GHL state" pattern `matchedArvApproval` already
     uses, never a session-only mirror that could drift from what GHL
     actually holds. */
  const [propertyIdentityBusy, setPropertyIdentityBusy] = useState(false);
  const [propertyIdentityError, setPropertyIdentityError] = useState<string | null>(null);

  const [transactionStructureInput, setTransactionStructureInput] = useState("");
  const [transactionStructureNone, setTransactionStructureNone] = useState(false);
  const [closingPossessionInput, setClosingPossessionInput] = useState("");
  const [closingPossessionNone, setClosingPossessionNone] = useState(false);
  const [titleComplicationsInput, setTitleComplicationsInput] = useState("");
  const [titleComplicationsNone, setTitleComplicationsNone] = useState(false);
  const [transactionAssumptionsBusy, setTransactionAssumptionsBusy] = useState(false);
  const [transactionAssumptionsError, setTransactionAssumptionsError] = useState<string | null>(null);

  const [sellerPricePositionInput, setSellerPricePositionInput] = useState("");
  const [sellerPricePositionBusy, setSellerPricePositionBusy] = useState(false);
  const [sellerPricePositionError, setSellerPricePositionError] = useState<string | null>(null);

  const [readinessDecisionReasonInput, setReadinessDecisionReasonInput] = useState("");
  const [readinessDecisionBusy, setReadinessDecisionBusy] = useState(false);
  const [readinessDecisionError, setReadinessDecisionError] = useState<string | null>(null);

  /* Jess Gate correction, 2026-09-08 -- Edit/Save/Cancel for the two
     record-once carriers, and Withdraw for property identity. Editing is
     UI-only draft state; Cancel discards it and writes nothing. Save/
     Confirm/Withdraw all still go through the SAME format functions and
     `ghl.notes.create` call as the original write -- a correction is
     simply another append-only entry, per the carriers' own "latest wins"
     reader. */
  const [propertyIdentityWithdrawBusy, setPropertyIdentityWithdrawBusy] = useState(false);
  const [transactionAssumptionsEditing, setTransactionAssumptionsEditing] = useState(false);
  const [sellerPricePositionEditing, setSellerPricePositionEditing] = useState(false);

  /* Contract Ready checklist, B8-10 / INV-53, made durable by the Jess Gate
     correction, 2026-09-08. Address and Agreed Price are not checkboxes
     here: both are already known facts (the Contact's own address; the
     accepted price from the outcome note itself) and are rendered as
     such, never re-asked. The five items below are exactly
     `SELLER_ACQUISITION_WORKFLOW.md`'s own remaining Contract Readiness
     list ("correct legal owners... closing timeline, occupancy and
     possession, known liens and title complications, delivery and
     signing information") -- nothing added, nothing invented.

     NO LONGER SESSION-ONLY. Progress is now read fresh from `notes` via
     `currentContractReadyChecklistForOpportunity` below -- the SAME
     "stateless-fresh read" pattern every other B8-13 carrier already
     uses, never a local mirror. It is SCOPED to the CURRENT agreed price
     and property address (the carrier's own exact-match rule): a
     different Accept (a renegotiated price) or a different address reads
     back as no progress at all, never as a false start carried over from
     a different deal. `contractChecklistBusy` names which item's write is
     in flight, mirroring every other carrier's busy/error pair. */
  const [contractChecklistBusy, setContractChecklistBusy] = useState<ContractReadyItemKey | null>(null);
  const [contractChecklistError, setContractChecklistError] = useState<string | null>(null);
  const CONTRACT_CHECKLIST_ITEMS = [
    { key: "legal_owners", label: "Correct legal owners confirmed" },
    { key: "closing_timeline", label: "Closing timeline set" },
    { key: "occupancy_possession", label: "Occupancy and possession confirmed" },
    { key: "liens_title", label: "Known liens and title complications reviewed" },
    { key: "delivery_signing", label: "Delivery and signing information collected" },
  ] as const;

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
               assignment: null as AssignmentResolution | null, inputs: null as UnderwritingInputs | null,
               issues: [] as PolicyParseIssue[], computeError: null as { field: string | null; message: string } | null,
               repairsSourceIsApprovalGated: false };
    }
    const opp = opps.find((o) => o.id === selected.id);
    if (!opp) {
      return { result: null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null, inputs: null as UnderwritingInputs | null, issues: [],
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
      // Jess Gate correction, 2026-09-08 -- `inputs` (the resolved
      // UnderwritingInputs, previously local to this closure) is now
      // returned too: `liveReadinessEvidenceSnapshot` below needs the
      // RAW policy assumption inputs, not only board8's computed outputs,
      // to bind an Offer Readiness decision to inputs as well as outputs.
      return { result: computeUnderwriting(inputs), facts, assignment: inputs.assignment, inputs, issues, computeError: null, repairsSourceIsApprovalGated };
    } catch (e: any) {
      return {
        result: null, facts: null as DealFacts | null,
        assignment: null as AssignmentResolution | null, inputs: null as UnderwritingInputs | null, issues: [],
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
     `ok: false` honestly rather than assuming success.

     Jess Gate, 2026-09-06: `operator` is `null`, not a hardcoded name.
     This app has no authenticated-operator concept anywhere (confirmed
     absent: no `currentUser`, `useAuth`, or session-actor mechanism of
     any kind) -- inventing one here would fabricate provenance this
     record does not actually have, and building real authentication is
     explicitly out of this issue's scope. `null` is preserved through to
     the rendered acknowledgement banner honestly, rather than papered
     over with a name nobody confirmed.

     B8-11 / INV-54: this is now this page's SECOND write path (the first
     being `handleRecordOutcome`'s call-outcome ledger) -- still exactly
     `ghl.notes.create()`, one of AGENTS.md's three sanctioned writes,
     never a fourth. WRITE-THEN-SET, never the reverse: `attemptOverride`
     validates (unchanged, synchronous, against the CURRENT
     `negotiationPosition` at click time) before anything is written, and
     `setNegotiationOverride` is called ONLY after the durable ledger
     write succeeds -- an override is never shown as granted in the UI
     while GHL holds no record of it. On a write failure, the error is
     surfaced verbatim via `overrideActionError` (the SAME error surface
     the validation-failure path already used) and `negotiationOverride`
     is left exactly as it was (`null`, or whatever the last successful
     grant set) -- the above-Max warning stays up, requiring the operator
     to retry, rather than silently trusting an unconfirmed write.
     `screen.opportunity.id` scopes the note to THIS deal, the same
     PB-D55 rule every other note-ledger write on this page follows. A
     successful write is appended to local `notes` state immediately,
     mirroring `handleRecordOutcome`'s own convention, so
     `latestNegotiationOverrideNote` reflects it without a refetch. */
  async function handleOverrideAndContinue() {
    if (!negotiationPosition) return;
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    const result = attemptOverride({
      position: negotiationPosition,
      acknowledged: overrideAcknowledged,
      reason: overrideReasonDraft,
      operator: null,
      at: new Date().toISOString(),
    });
    if (!result.ok) {
      setOverrideActionError(result.error);
      return;
    }
    setOverrideActionError(null);
    setOverrideWriteBusy(true);
    const note = formatNegotiationOverrideNote({
      opportunityId: screen.opportunity.id,
      at: result.override.at,
      operator: result.override.operator,
      reason: result.override.reason,
      currentOfferAtOverride: result.override.currentOfferAtOverride,
      maxSupportedOfferAtOverride: result.override.maxSupportedOfferAtOverride,
      amountAboveMaxAtOverride: result.override.amountAboveMaxAtOverride,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: result.override.at }]);
      setNegotiationOverride(result.override);
      setWarningDismissed(false);
    } catch (e: any) {
      setOverrideActionError(e?.message ?? "Couldn't record this override -- it is not yet in effect. Try again.");
    } finally {
      setOverrideWriteBusy(false);
    }
  }

  /* B8-13 / INV-68 -- Property identity. WRITE-THEN-SET is moot here (there
     is no separate React state to set on success -- `propertyIdentityConfirmation`
     above is read fresh from `notes`), but the append-to-`notes` convention
     is identical to every other write on this page: the write must succeed
     before the UI can show it as confirmed. */
  async function handleConfirmPropertyIdentity() {
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    const address = formatAddress(contact);
    if (address === "—") return;
    setPropertyIdentityError(null);
    setPropertyIdentityBusy(true);
    const at = new Date().toISOString();
    const note = formatPropertyIdentityConfirmationNote({
      opportunityId: screen.opportunity.id, at, operator: null, status: "confirmed", address,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
    } catch (e: any) {
      setPropertyIdentityError(e?.message ?? "Couldn't record this confirmation -- it is not yet in effect. Try again.");
    } finally {
      setPropertyIdentityBusy(false);
    }
  }

  /* Jess Gate correction, 2026-09-08 -- withdraw an incorrect property
     confirmation WITHOUT requiring the address itself to change. Writes a
     NEW `Status: withdrawn` note for the address currently on file; per
     `currentPropertyIdentityConfirmationForOpportunity`'s "latest wins"
     rule this immediately blocks every older `confirmed` entry (this one
     included) from applying, and stays blocking no matter what a later
     confirmation attempt records, until a FRESH confirmation is made. */
  async function handleWithdrawPropertyIdentity() {
    if (!(screen.state === "resolved" || screen.state === "unresolved") || !propertyIdentityConfirmation) return;
    setPropertyIdentityError(null);
    setPropertyIdentityWithdrawBusy(true);
    const at = new Date().toISOString();
    const note = formatPropertyIdentityConfirmationNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      status: "withdrawn", address: propertyIdentityConfirmation.address,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
    } catch (e: any) {
      setPropertyIdentityError(e?.message ?? "Couldn't withdraw this confirmation -- it is still in effect. Try again.");
    } finally {
      setPropertyIdentityWithdrawBusy(false);
    }
  }

  /* B8-13 / INV-68 -- Transaction assumptions. Each of the three sub-facts
     must be either a real typed value or explicitly marked None -- a
     genuinely blank field refuses the save outright, per the locked
     addendum's "never left simply blank" rule. */
  function transactionFieldFromInput(text: string, markedNone: boolean): TransactionAssumptionField | null {
    if (markedNone) return { kind: "none" };
    if (text.trim() === "") return null;
    return { kind: "value", value: text.trim() };
  }

  async function handleSaveTransactionAssumptions() {
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    const transactionStructure = transactionFieldFromInput(transactionStructureInput, transactionStructureNone);
    const closingPossession = transactionFieldFromInput(closingPossessionInput, closingPossessionNone);
    const titleComplications = transactionFieldFromInput(titleComplicationsInput, titleComplicationsNone);
    if (!transactionStructure || !closingPossession || !titleComplications) {
      setTransactionAssumptionsError("Each item needs a value, or must be explicitly marked None -- it cannot be left blank.");
      return;
    }
    setTransactionAssumptionsError(null);
    setTransactionAssumptionsBusy(true);
    const at = new Date().toISOString();
    const note = formatTransactionAssumptionsNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      transactionStructure, closingPossession, titleComplications,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
      // Save appends a new record (Jess Gate, 2026-09-08) -- history is
      // preserved automatically (nothing here is ever overwritten); only
      // the editing UI itself closes.
      setTransactionAssumptionsEditing(false);
    } catch (e: any) {
      setTransactionAssumptionsError(e?.message ?? "Couldn't record this -- it is not yet in effect. Try again.");
    } finally {
      setTransactionAssumptionsBusy(false);
    }
  }

  /** Jess Gate correction, 2026-09-08 -- opens the form prefilled from the current record. Writes nothing. */
  function handleEditTransactionAssumptions() {
    if (!transactionAssumptionsRecord) return;
    const toInput = (f: TransactionAssumptionField) => (f.kind === "value" ? f.value : "");
    const toNone = (f: TransactionAssumptionField) => f.kind === "none";
    setTransactionStructureInput(toInput(transactionAssumptionsRecord.transactionStructure));
    setTransactionStructureNone(toNone(transactionAssumptionsRecord.transactionStructure));
    setClosingPossessionInput(toInput(transactionAssumptionsRecord.closingPossession));
    setClosingPossessionNone(toNone(transactionAssumptionsRecord.closingPossession));
    setTitleComplicationsInput(toInput(transactionAssumptionsRecord.titleComplications));
    setTitleComplicationsNone(toNone(transactionAssumptionsRecord.titleComplications));
    setTransactionAssumptionsError(null);
    setTransactionAssumptionsEditing(true);
  }

  /** Jess Gate correction, 2026-09-08 -- discards the draft. Writes nothing, per the requirement. */
  function handleCancelEditTransactionAssumptions() {
    setTransactionAssumptionsError(null);
    setTransactionAssumptionsEditing(false);
  }

  /* B8-13 / INV-68 -- Seller price position. Reuses `parseAcquisitionPriceInput`
     (imported, never reimplemented) for the price path -- the SAME
     strictly-positive-finite-number classification the negotiation inputs
     already use, not a second parser. The refusal path carries no number
     at all, per `seller-call-readiness-carriers.ts`'s own schema. */
  async function handleRecordSellerPricePosition(kind: "price" | "refused") {
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    const at = new Date().toISOString();
    let note: string;
    if (kind === "price") {
      const parsed = parseAcquisitionPriceInput(sellerPricePositionInput);
      if (parsed.kind !== "value") {
        setSellerPricePositionError("Enter a valid price, or record a documented refusal instead.");
        return;
      }
      note = formatSellerPricePositionNote({ opportunityId: screen.opportunity.id, at, operator: null, kind: "price", price: parsed.value });
    } else {
      note = formatSellerPricePositionNote({ opportunityId: screen.opportunity.id, at, operator: null, kind: "refused" });
    }
    setSellerPricePositionError(null);
    setSellerPricePositionBusy(true);
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
      setSellerPricePositionEditing(false);
    } catch (e: any) {
      setSellerPricePositionError(e?.message ?? "Couldn't record this -- it is not yet in effect. Try again.");
    } finally {
      setSellerPricePositionBusy(false);
    }
  }

  /** Jess Gate correction, 2026-09-08 -- opens the form prefilled from the current record. Writes nothing. */
  function handleEditSellerPricePosition() {
    if (!sellerPricePositionRecord) return;
    setSellerPricePositionInput(sellerPricePositionRecord.kind === "price" ? String(sellerPricePositionRecord.price) : "");
    setSellerPricePositionError(null);
    setSellerPricePositionEditing(true);
  }

  /** Jess Gate correction, 2026-09-08 -- discards the draft. Writes nothing. */
  function handleCancelEditSellerPricePosition() {
    setSellerPricePositionError(null);
    setSellerPricePositionEditing(false);
  }

  /* B8-13 / INV-68 -- Offer Ready's OWN human approval/override, DISTINCT
     from `handleOverrideAndContinue` above (that is negotiation's
     above-Max override; this is an evidence-quality decision -- see
     `offer-readiness.ts`'s header for why the two must never merge).
     APPROVED can only ever be attempted when `readiness.status` is
     already OFFER_READY -- mirrors `HumanAction`'s own rule that it never
     elevates a non-ready status; OVERRIDDEN requires a non-empty reason,
     enforced before any write is attempted. */
  async function handleReadinessDecision(kind: "approved" | "overridden") {
    if (!(screen.state === "resolved" || screen.state === "unresolved") || !readiness) return;
    if (kind === "approved" && readiness.status !== "OFFER_READY") return;
    const reason = readinessDecisionReasonInput.trim();
    if (kind === "overridden" && reason === "") {
      setReadinessDecisionError("A reason is required to override.");
      return;
    }
    setReadinessDecisionError(null);
    setReadinessDecisionBusy(true);
    const at = new Date().toISOString();
    // Jess Gate correction, 2026-09-08: every decision binds to
    // `liveReadinessEvidenceSnapshot` -- the SAME raw-facts object
    // `readinessDecisionCurrency` later compares against, taken at the
    // exact moment of this write.
    const note = formatReadinessHumanActionNote(
      kind === "approved"
        ? { opportunityId: screen.opportunity.id, at, operator: null, kind: "approved", reason: reason || null, snapshot: liveReadinessEvidenceSnapshot }
        : { opportunityId: screen.opportunity.id, at, operator: null, kind: "overridden", reason, snapshot: liveReadinessEvidenceSnapshot },
    );
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
      setReadinessDecisionReasonInput("");
    } catch (e: any) {
      setReadinessDecisionError(e?.message ?? "Couldn't record this decision -- it is not yet in effect. Try again.");
    } finally {
      setReadinessDecisionBusy(false);
    }
  }

  /* Jess Gate correction, 2026-09-08 -- Contract Ready checklist, made
     durable. Writes the FULL current item set (all five, with the toggled
     one flipped) as one new note on every toggle -- "latest wins" then
     always holds the complete, current state, never a delta someone has
     to replay. Scoped to the CURRENT agreed price and address (read back
     by `contractReadyChecklistRecord` above); this handler does not
     itself decide scope, it only records against whatever is current. */
  async function handleToggleContractReadyItem(key: ContractReadyItemKey, checked: boolean) {
    if (!(screen.state === "resolved" || screen.state === "unresolved") || latestOutcome?.kind !== "accept") return;
    if (latestOutcome.snapshot.currentOffer === null) return;
    setContractChecklistError(null);
    setContractChecklistBusy(key);
    const at = new Date().toISOString();
    const currentItems: ContractReadyItems = contractReadyChecklistRecord?.items ?? {
      legal_owners: false, closing_timeline: false, occupancy_possession: false, liens_title: false, delivery_signing: false,
    };
    const items: ContractReadyItems = { ...currentItems, [key]: checked };
    // Jess Gate correction, 2026-09-08 -- `agreementAt` is the accepted
    // outcome's OWN durable timestamp (`latestOutcome.at`,
    // `seller-call-outcome.ts`'s existing carrier identity), the primary
    // scope key. Price/address are still recorded too (defense in depth),
    // but a DIFFERENT agreement -- even at the identical price and
    // address -- never reads back this progress, because its `at` differs.
    const note = formatContractReadyChecklistNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      agreementAt: latestOutcome.at,
      agreedPrice: latestOutcome.snapshot.currentOffer, propertyAddress: formatAddress(contact),
      items,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
    } catch (e: any) {
      setContractChecklistError(e?.message ?? "Couldn't save this checklist item -- it is not yet in effect. Try again.");
    } finally {
      setContractChecklistBusy(null);
    }
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

  /* B8-13 / INV-68 -- the four new Offer Readiness determination carriers.
     Same "stateless-fresh read of current GHL state" pattern as
     `matchedArvApproval` above: read fresh from `notes` on every render,
     never mirrored into useState, so a durable record can never drift
     from what GHL actually holds. `propertyIdentityConfirmation` is
     additionally STALE-CHECKED against the CURRENT displayed address (the
     locked addendum's own rule) -- `formatAddress(contact)` is the exact
     same string the page header already renders, so "current" here means
     literally what the operator sees, not a second address computation. */
  const propertyIdentityConfirmation = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return currentPropertyIdentityConfirmationForOpportunity(notes, screen.opportunity.id, formatAddress(contact));
  }, [notes, screen, contact]);

  const transactionAssumptionsRecord = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestTransactionAssumptionsForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  const sellerPricePositionRecord = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestSellerPricePositionForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  const readinessHumanActionRecord = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestReadinessHumanActionForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  /* Jess Gate correction, 2026-09-08 -- the latest note of ANY kind
     (confirmed or withdrawn) for property identity, used ONLY as durable
     invalidation evidence below (`isReadinessDecisionCurrent`). Distinct
     from `propertyIdentityConfirmation` above, which is address-matched
     AND status-filtered for DISPLAY/readiness purposes; this one is
     neither -- its only job is "does a property-identity note exist after
     this decision's timestamp," regardless of what that note says. */
  const newestPropertyIdentityNote = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestPropertyIdentityNoteForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  /* Jess Gate correction, 2026-09-08 -- the raw facts and evidence states
     an Offer Readiness decision is bound to, for ALL SIX categories, built
     ONCE and shared by both the WRITE path (`handleReadinessDecision`
     snapshots exactly this) and the CHECK path (`readinessDecisionCurrency`
     compares the two field-backed categories against exactly this) -- so
     the two can never disagree about what "live" means. Mirrors the
     `known` object `readiness` below already builds, plus the two
     additional carrier reads (`matchedArvApproval`, `transactionAssumptionsRecord`,
     `sellerPricePositionRecord`) already available above. */
  const liveReadinessEvidenceSnapshot: ReadinessEvidenceSnapshot = useMemo(() => {
    const known = screen.state === "resolved" || screen.state === "unresolved" ? screen.known : null;
    return {
      propertyIdentity: {
        confirmed: propertyIdentityConfirmation !== null,
        address: propertyIdentityConfirmation?.address ?? null,
      },
      repairsCondition: {
        amount: known?.repairs ?? null,
        approved: pipeline.repairsSourceIsApprovalGated,
      },
      arv: {
        amount: known?.arv ?? null,
        evidenceState: matchedArvApproval?.evidenceState ?? null,
      },
      dealEconomics: board8 && board8.status === "calculated"
        ? {
            status: "calculated",
            maxSupportedOffer: board8.maxSupportedOffer,
            targetStatus: board8.target.status,
            targetValue: board8.target.status === "calculated" ? board8.target.targetAcquisitionPrice : null,
            inputs: buildDealEconomicsInputsSnapshot(pipeline.inputs),
          }
        : { status: "unavailable", maxSupportedOffer: null, targetStatus: null, targetValue: null, inputs: buildDealEconomicsInputsSnapshot(pipeline.inputs) },
      transactionAssumptions: transactionAssumptionsRecord
        ? {
            structure: transactionAssumptionsRecord.transactionStructure,
            closing: transactionAssumptionsRecord.closingPossession,
            title: transactionAssumptionsRecord.titleComplications,
          }
        : null,
      sellerPricePosition: sellerPricePositionRecord
        ? (sellerPricePositionRecord.kind === "price"
            ? { kind: "price", price: sellerPricePositionRecord.price }
            : { kind: "refused" })
        : null,
    };
  }, [screen, pipeline.repairsSourceIsApprovalGated, pipeline.inputs, matchedArvApproval, board8, propertyIdentityConfirmation, transactionAssumptionsRecord, sellerPricePositionRecord]);

  /* Jess Gate correction, 2026-09-08 (second round) -- whether the latest
     recorded Offer Readiness decision has EVER been durably invalidated
     (see `formatReadinessDecisionInvalidationNote`'s own header). Checked
     BEFORE any live comparison, and unconditionally: once true, always
     true, regardless of what the live facts say on this particular load. */
  const readinessDecisionInvalidatedDurably = useMemo(() => {
    if (!readinessHumanActionRecord || !notes || !(screen.state === "resolved" || screen.state === "unresolved")) return false;
    return isReadinessDecisionInvalidated(notes, screen.opportunity.id, readinessHumanActionRecord.at);
  }, [readinessHumanActionRecord, notes, screen]);

  /* Jess Gate correction, 2026-09-08 -- whether the latest recorded Offer
     Readiness decision (if any) still applies. `isReadinessDecisionCurrent`
     (imported, never reimplemented) does the actual comparison; this memo
     only assembles the "live" side of it from what this page already
     reads. `null` when there is no decision on record at all (nothing to
     be current or stale). */
  const readinessDecisionCurrency = useMemo(() => {
    if (!readinessHumanActionRecord) return null;
    return isReadinessDecisionCurrent(readinessHumanActionRecord, {
      snapshot: liveReadinessEvidenceSnapshot,
      newestPropertyIdentityNoteAt: newestPropertyIdentityNote?.at ?? null,
      newestTransactionAssumptionsNoteAt: transactionAssumptionsRecord?.at ?? null,
      newestSellerPricePositionNoteAt: sellerPricePositionRecord?.at ?? null,
      newestArvApprovalNoteAt: latestArvLedgerEntry?.approvedAt ?? null,
      durablyInvalidated: readinessDecisionInvalidatedDurably,
    });
  }, [readinessHumanActionRecord, liveReadinessEvidenceSnapshot, newestPropertyIdentityNote, transactionAssumptionsRecord, sellerPricePositionRecord, latestArvLedgerEntry, readinessDecisionInvalidatedDurably]);

  /* Jess Gate correction, 2026-09-08 -- the latest LEGACY v1 decision (no
     evidence snapshot at all), for DISPLAY ONLY. Never feeds
     `readinessHumanAction` below or `buildOfferReadinessInputs` -- see
     `parseLegacyReadinessHumanActionV1Note`'s own header. Shown whenever
     one exists, independent of whether a current v2/v3 decision is also
     present, so a genuine legacy record can never become silently
     invisible. */
  const legacyReadinessDecision = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestLegacyReadinessHumanActionV1ForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  /* `HumanAction.operator` (offer-readiness.ts, unchanged, locked) requires
     a `string` -- unlike this carrier's own honest `string | null` (this
     app has no authenticated-operator concept, per every sibling carrier's
     header). "UNAVAILABLE" is the SAME literal every carrier's own note
     serialization already uses for exactly this meaning (see `ledgerValue`
     in `seller-call-readiness-carriers.ts`) -- a truthful placeholder, not
     a fabricated name, bridging into a type this issue does not change.

     Jess Gate correction, 2026-09-08: a STALE decision (per
     `readinessDecisionCurrency` above) resolves to `{ kind: "none" }` for
     THIS live computation -- it stops elevating readiness -- while the
     record itself (`readinessHumanActionRecord`) remains completely
     unedited and is still rendered, marked stale, in the UI below. A
     fresh decision is the only thing that can produce a new, current one. */
  const readinessHumanAction: HumanAction = readinessHumanActionRecord === null || readinessDecisionCurrency?.current === false
    ? { kind: "none" }
    : readinessHumanActionRecord.kind === "approved"
      ? {
          kind: "approved", at: readinessHumanActionRecord.at,
          operator: readinessHumanActionRecord.operator ?? "UNAVAILABLE",
          reason: readinessHumanActionRecord.reason ?? undefined,
        }
      : {
          kind: "overridden", at: readinessHumanActionRecord.at,
          operator: readinessHumanActionRecord.operator ?? "UNAVAILABLE",
          reason: readinessHumanActionRecord.reason,
        };

  /* Jess Gate correction, 2026-09-08 (second round) -- "When IAOS observes
     a material mismatch, durably invalidate that specific readiness
     decision." A live comparison alone (`readinessDecisionCurrency`
     above) cannot guarantee PERMANENCE -- if the value moves away and
     back with no page load in between, nothing remembers it moved. The
     FIRST time this page observes `current === false` for a decision that
     has not yet been durably invalidated, it writes ONE invalidation note
     naming that decision's own timestamp. Once written, `notes` updates,
     `readinessDecisionInvalidatedDurably` becomes `true` on the next
     render, and this effect's own guard (`if (readinessDecisionInvalidatedDurably) return`)
     stops it from writing again -- self-terminating, no loop.

     GATING NEVER WAITS ON THIS WRITE. `readinessHumanAction` above is
     already `{ kind: "none" }` the instant `readinessDecisionCurrency.
     current` is `false`, regardless of whether this effect's write has
     started, is in flight, or has failed. "If saving invalidation fails,
     do not let the stale decision authorize readiness" is satisfied by
     construction -- the write below only affects PERMANENCE across a
     future reload, never THIS render's gate. A failure is surfaced
     (`invalidationWriteError`), never silently retried in a tight loop:
     the effect re-attempts only on the NEXT genuine change to its
     dependencies (e.g. the operator reloading), not automatically. */
  const [invalidationWriteError, setInvalidationWriteError] = useState<string | null>(null);
  const [invalidationWriteBusyForAt, setInvalidationWriteBusyForAt] = useState<string | null>(null);

  useEffect(() => {
    if (!readinessHumanActionRecord || !readinessDecisionCurrency) return;
    if (readinessDecisionCurrency.current) return;
    if (readinessDecisionInvalidatedDurably) return;
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    if (invalidationWriteBusyForAt === readinessHumanActionRecord.at) return;

    let cancelled = false;
    setInvalidationWriteBusyForAt(readinessHumanActionRecord.at);
    const at = new Date().toISOString();
    const note = formatReadinessDecisionInvalidationNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      decisionAt: readinessHumanActionRecord.at, reasons: readinessDecisionCurrency.staleBecause,
    });
    ghl.notes.create(contactId, note)
      .then(() => {
        if (cancelled) return;
        setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
        setInvalidationWriteError(null);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setInvalidationWriteError(
          e?.message ?? "Couldn't durably record this staleness. It is still treated as not-authorizing right now, but if the value reverts before this succeeds, a future reload could miss it. Reload to retry.",
        );
      })
      .finally(() => {
        if (!cancelled) setInvalidationWriteBusyForAt(null);
      });
    return () => { cancelled = true; };
  }, [readinessHumanActionRecord, readinessDecisionCurrency, readinessDecisionInvalidatedDurably, screen, contactId, invalidationWriteBusyForAt]);

  /* B8-04, consumed, via buildOfferReadinessInputs (B8-07 / INV-50,
     extended B8-13 / INV-68) -- that module's own header states exactly
     which categories now reflect real evidence: repairsCondition, gated on
     `repairsSourceIsApprovalGated` proving the value passed IAOS's
     approval gate rather than merely being present; arv, from
     `matchedArvApproval` above -- amount-matched, never a stale entry; and
     now propertyIdentity/transactionAssumptions/sellerPricePosition, each
     from its own durable carrier above. `humanAction` is the durable
     carrier's latest entry, or `{ kind: "none" }` when none is on record. */
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
      propertyIdentityConfirmed: propertyIdentityConfirmation !== null,
      transactionAssumptionsRecorded: transactionAssumptionsRecord !== null,
      sellerPricePositionRecorded: sellerPricePositionRecord !== null,
      humanAction: readinessHumanAction,
    }));
  }, [
    board8, screen, pipeline.repairsSourceIsApprovalGated, matchedArvApproval,
    propertyIdentityConfirmation, transactionAssumptionsRecord, sellerPricePositionRecord, readinessHumanAction,
  ]);

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

  /* B8-12 / INV-55 — "Other Useful Questions": everything else still open,
     same priority order, same inputs as nextBestQuestion above (never a
     second readiness/economics read) — just the rest of the same queue. */
  const otherUsefulQuestions = useMemo(() => {
    if (!readiness || !board8) return [];
    const known = {
      arv: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.arv : null,
      repairs: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.repairs : null,
      askingPrice: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.askingPrice : null,
    };
    return computeQuestionQueue(readiness, known, board8).slice(1);
  }, [readiness, board8, screen]);

  const [fullScriptOpen, setFullScriptOpen] = useState(false);

  /* B8-10 / INV-53 — the most recent bounded call outcome for THIS
     opportunity, read back through seller-call-outcome.ts's strict
     parser from the SAME notes already fetched for the ARV ledger above.
     Scoped to `screen.opportunity.id` for the same PB-D55 reason
     `latestArvLedgerEntry` is. */
  const latestOutcome = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestOutcomeNoteForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  /* Jess Gate correction, 2026-09-08 -- Contract Ready checklist progress,
     made durable. Scoped to `latestOutcome.at` -- the accepted outcome's
     OWN durable timestamp, an identity that ALREADY exists
     (`seller-call-outcome.ts`'s carrier), used here as the PRIMARY scope
     key rather than inventing a new one -- plus agreed price and property
     address as defense in depth (`currentContractReadyChecklistForOpportunity`'s
     own rule). A DIFFERENT agreement, even at the identical price and
     address, has a different `at` and never reads back this progress; the
     SAME agreement (same `at`) does, across any number of reloads. `null`
     whenever there is no accepted outcome at all. */
  const contractReadyChecklistRecord = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    if (latestOutcome?.kind !== "accept") return null;
    // An Accept is only ever recorded with a real Current Offer (B8-10's
    // own Accept-button gate); null here would mean a corrupt/foreign
    // record, not a real state to scope a checklist to.
    if (latestOutcome.snapshot.currentOffer === null) return null;
    return currentContractReadyChecklistForOpportunity(
      notes, screen.opportunity.id, latestOutcome.at, latestOutcome.snapshot.currentOffer, formatAddress(contact),
    );
  }, [notes, screen, latestOutcome, contact]);

  /* B8-11 / INV-54 -- the most recent durable above-Max override grant for
     THIS opportunity, read back through seller-call-negotiation-override-
     note.ts's strict parser from the SAME notes already fetched above.
     Scoped to `screen.opportunity.id` for the same PB-D55 reason
     `latestOutcome`/`latestArvLedgerEntry` are. Independent of
     `latestOutcome`: an override can exist with no outcome ever recorded
     (still negotiating) and an outcome can exist with no override ever
     granted (never went above Max) -- neither implies the other. */
  const latestNegotiationOverrideNote = useMemo(() => {
    if (!notes || !(screen.state === "resolved" || screen.state === "unresolved")) return null;
    return latestNegotiationOverrideNoteForOpportunity(notes, screen.opportunity.id);
  }, [notes, screen]);

  /* Jess Re-Gate correction, 2026-09-06 -- RESUME MUST BE SCOPED TO THE
     OPPORTUNITY, NOT THE CONTACT. The prior `contactId`-keyed guard had
     two defects Jess Re-Gate found: (1) it could be marked "done" while
     this contact's `screen.state` was still `awaiting_selection` (no
     opportunity chosen yet on a multi-opportunity contact) -- once
     marked, hydration was PERMANENTLY skipped for whatever opportunity
     the operator picked afterward; (2) it never cleared Seller
     Position/Current Offer on a genuine deal switch, so Deal A's
     negotiation values could remain visible on Deal B. `currentDealId`
     below is `screen.opportunity.id` when resolved, `null` while no
     opportunity is selected yet -- the EXACT SAME identity `latestOutcome`
     itself is already scoped to just above (PB-D55), so "the deal
     showing on screen" and "the deal this hydration restores" can never
     drift apart. `resolveResumeHydration` (imported, never reimplemented
     here) is the ONE place the clear/restore decision is made -- pure,
     independently unit-tested (`seller-call-resume.ts` /
     `test-seller-call-resume.cjs`), because this decision spans multiple
     renders and a source-text check alone cannot prove a multi-render
     state machine behaves correctly. This effect only applies exactly
     what that function's result names, in the order it names: clear,
     then restore. */
  const dealHydrationRef = useRef<DealHydrationRef>({ dealId: null, hydrated: false });
  const currentDealId = (screen.state === "resolved" || screen.state === "unresolved") ? screen.opportunity.id : null;

  useEffect(() => {
    const decision = resolveResumeHydration({
      prevRef: dealHydrationRef.current,
      currentDealId,
      loading,
      latestOutcome: latestOutcome
        ? { sellerPosition: latestOutcome.snapshot.sellerPosition, currentOffer: latestOutcome.snapshot.currentOffer }
        : null,
      latestOverrideNote: latestNegotiationOverrideNote,
      sellerPositionInput,
      currentOfferInput,
      currentOverride: negotiationOverride,
    });
    dealHydrationRef.current = decision.nextRef;

    /* CLEAR before restoring -- every deal-specific negotiation value
       reset together (the same atomic group `handleCancelAboveMax`
       already clears for the same reason) BEFORE either `restore*`
       field below is applied, so Deal A's Current Offer, Seller
       Position, or above-Max override can never be read while Deal B is
       what's on screen. `decision.clear` is `true` ONLY on the pass the
       selected opportunity identity actually changed -- never on an
       ordinary rerender of the SAME opportunity, so an operator's edit
       to the CURRENT deal is never touched by it. */
    if (decision.clear) {
      setSellerPositionInput("");
      setCurrentOfferInput("");
      setNegotiationOverride(null);
      setOverrideReasonDraft("");
      setOverrideAcknowledged(false);
      setOverrideActionError(null);
      setWarningDismissed(false);
    }
    if (decision.restoreSellerPosition !== null) {
      setSellerPositionInput(decision.restoreSellerPosition);
    }
    if (decision.restoreCurrentOffer !== null) {
      setCurrentOfferInput(decision.restoreCurrentOffer);
    }
    /* B8-11 / INV-54 -- restoring the durable override record. Whether it
       still APPLIES to the (also just-restored) Current Offer is
       deliberately not decided here: `isOverrideCurrent` (unchanged,
       B8-08 / INV-51) already compares this record's own
       `currentOfferAtOverride`/`maxSupportedOfferAtOverride` against the
       live `negotiationPosition` on every render, so a restored-but-now-
       stale override simply renders as "not yet acknowledged" for the
       current number -- the existing, already-proven safety net, not new
       code. `acknowledgedAboveMax: true` is added back here because the
       durable record (like the ledger note itself) carries only the
       fields that vary; the literal is `NegotiationOverride`'s own
       constant discriminant, unchanged from what `attemptOverride` always
       produces. */
    if (decision.restoreOverride !== null) {
      setNegotiationOverride({ acknowledgedAboveMax: true, ...decision.restoreOverride });
    }
  }, [loading, currentDealId, latestOutcome, latestNegotiationOverrideNote]);

  /* The facts a recorded outcome captures, taken verbatim from what this
     page has already computed -- no recomputation, no second source. */
  function buildOutcomeSnapshot(): OutcomeSnapshot {
    return {
      sellerPosition,
      currentOffer,
      targetAcquisitionPrice: board8 && board8.status === "calculated" && board8.target.status === "calculated" ? board8.target.targetAcquisitionPrice : null,
      maxSupportedOffer: board8 && board8.status === "calculated" ? board8.maxSupportedOffer : null,
      expectedSpread: expectedSpread && expectedSpread.status === "calculated" ? expectedSpread.expectedSpread : null,
      arv: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.arv : null,
      repairs: screen.state === "resolved" || screen.state === "unresolved" ? screen.known.repairs : null,
      readinessStatus: readiness ? readiness.effectiveStatus : "NOT_READY",
    };
  }

  /* The ONLY write path on this page. `attemptRecordOutcome` (imported,
     never reimplemented) validates and formats; this function performs
     the write(s) -- `scheduleCallbackGated` (imported, unmodified) for
     Follow-Up's callback+generic-note+attempt trio, plus this page's own
     structured outcome note in every case, then `setLastCallAttempt`
     directly for Accept/Pass (no callback to schedule). A successful
     write is appended to local `notes` state immediately so
     `latestOutcome` reflects it without a refetch -- safe because
     `latestOutcomeNoteForOpportunity` sorts by the note's OWN embedded
     timestamp, never by list position or `dateAdded`. */
  async function handleRecordOutcome(kind: CallOutcomeKind) {
    if (!(screen.state === "resolved" || screen.state === "unresolved")) return;
    const nowIso = new Date().toISOString();
    const attempt = attemptRecordOutcome({
      kind,
      opportunityId: screen.opportunity.id,
      operator: null,
      at: nowIso,
      snapshot: buildOutcomeSnapshot(),
      reason: passReasonInput,
      followUpAt: followUpAtInput,
    });
    if (!attempt.ok) {
      setOutcomeActionError(attempt.error);
      return;
    }
    setOutcomeActionError(null);
    setRecordingOutcome(kind);
    try {
      if (kind === "follow_up") {
        const cb = await scheduleCallbackGated(ghl, contactId, new Date(followUpAtInput).toISOString());
        if (!cb.ok) {
          setOutcomeActionError(cb.error);
          return;
        }
        await ghl.notes.create(contactId, attempt.note);
      } else {
        await ghl.notes.create(contactId, attempt.note);
        await ghl.contacts.setLastCallAttempt(contactId, nowIso);
      }
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: attempt.note, dateAdded: nowIso }]);
      setShowOutcomeForm(null);
      setFollowUpAtInput("");
      setPassReasonInput("");
    } catch (e: any) {
      setOutcomeActionError(e?.message ?? "Couldn't record this outcome.");
    } finally {
      setRecordingOutcome(null);
    }
  }

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
          not a persisted "call state." B8-10 / INV-53: when a prior
          bounded outcome exists, "what was last discussed" resumes from
          it directly -- the note's own recorded snapshot, never
          recomputed. */}
      {!loading && fetchError === null ? (
        <div style={{ fontSize: "12px", color: "#64748B", margin: "10px 0 4px" }} data-testid="seller-call-resume-context">
          {latestOutcome
            ? `Resuming — last discussed: ${OUTCOME_LABEL[latestOutcome.kind]} on ${new Date(latestOutcome.at).toLocaleString()}. `
              + `At that time — Seller Position: ${moneyOrUnknown(latestOutcome.snapshot.sellerPosition)}, `
              + `Current Offer: ${moneyOrUnknown(latestOutcome.snapshot.currentOffer)}, `
              + `Target: ${moneyOrUnknown(latestOutcome.snapshot.targetAcquisitionPrice)}, `
              + `Max: ${moneyOrUnknown(latestOutcome.snapshot.maxSupportedOffer)}, `
              + `Spread: ${moneyOrUnknown(latestOutcome.snapshot.expectedSpread)}, `
              + `Offer Readiness: ${latestOutcome.snapshot.readinessStatus.replace("_", " ")}.`
              + (latestOutcome.kind === "follow_up" && latestOutcome.followUpAt ? ` Follow-up set for ${new Date(latestOutcome.followUpAt).toLocaleString()}.` : "")
              + (latestOutcome.kind === "pass" && latestOutcome.reason ? ` Reason: ${latestOutcome.reason}` : "")
            : hasKnownFacts
              ? "Resuming — deal facts already on file for this contact."
              : "Starting fresh — no deal facts on file for this contact yet."}
        </div>
      ) : null}

      {!loading && fetchError === null ? (
        <div style={{ fontSize: "12px", color: "#94A3B8", margin: "0 0 18px" }} data-testid="seller-call-next-objective">
          <strong>Next objective:</strong>{" "}
          {latestOutcome?.kind === "accept"
            ? "Move this deal to Contract Ready — see the checklist below."
            : latestOutcome?.kind === "follow_up" && latestOutcome.followUpAt
              ? `Follow up by ${new Date(latestOutcome.followUpAt).toLocaleString()}.`
              : latestOutcome?.kind === "pass"
                ? "Reconsider on new information, or close out."
                : nextBestQuestion === null
                  ? "Underwriting must resolve before an objective can be set."
                  : nextBestQuestion.kind === "offer_ready"
                    ? "Offer Ready — move to presenting the offer."
                    : nextBestQuestion.question}
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

          {/* B8-13 / INV-68 — Offer Ready's OWN human approval/override,
              distinct from the negotiation above-Max override further
              below. Durable via `formatReadinessHumanActionNote`
              (`handleReadinessDecision`); the addendum's own rule: APPROVED
              only ever attempted when evidence is already OFFER_READY,
              OVERRIDDEN requires a non-empty reason and may elevate a
              non-ready status (visible in ReadinessBadge above as "raw
              evidence: ... -- overridden"). */}
          {readiness ? (
            <div
              data-testid="readiness-human-action-panel"
              style={{
                marginBottom: "16px", padding: "14px 16px", borderRadius: "10px",
                background: "#0F172A", border: "1px solid #1E293B",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "8px" }}>
                Offer Readiness decision
              </div>
              {readinessHumanActionRecord ? (
                <div data-testid="readiness-human-action-current" style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "10px" }}>
                  Last recorded: <strong style={{ color: readinessDecisionCurrency?.current === false ? "#64748B" : readinessHumanActionRecord.kind === "overridden" ? "#F59E0B" : "#22C55E" }}>
                    {readinessHumanActionRecord.kind.toUpperCase()}
                  </strong> at {new Date(readinessHumanActionRecord.at).toLocaleString()}
                  {readinessHumanActionRecord.reason ? ` — "${readinessHumanActionRecord.reason}"` : ""}
                  {/* Jess Gate correction, 2026-09-08: a stale decision stays
                      visible as history -- it is never hidden or edited --
                      but is explicitly marked as no longer authorizing
                      readiness, with the durable reason(s) it went stale. */}
                  {readinessDecisionCurrency?.current === false ? (
                    <div data-testid="readiness-human-action-stale" style={{ color: "#64748B", fontStyle: "italic", marginTop: "4px" }}>
                      STALE — no longer authorizes readiness ({readinessDecisionCurrency.staleBecause.join("; ")}). A fresh decision is required.
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* Jess Gate correction, 2026-09-08: surfaces a failed
                  durable-invalidation write. The live gate above is
                  already correctly non-authorizing regardless -- this is
                  purely an honesty signal that PERMANENCE across a future
                  reload is not yet guaranteed for this specific staleness. */}
              {invalidationWriteError ? (
                <div data-testid="readiness-invalidation-write-error" style={{ fontSize: "11px", color: "#EF4444", marginBottom: "10px" }}>
                  {invalidationWriteError}
                </div>
              ) : null}
              {/* Jess Gate correction, 2026-09-08: a genuine v1 legacy
                  decision (no evidence snapshot at all) stays visible as
                  history, explicitly labeled, and NEVER authorizes
                  readiness -- it is not read into `readinessHumanAction`
                  anywhere in this file. */}
              {legacyReadinessDecision ? (
                <div data-testid="readiness-human-action-legacy" style={{ fontSize: "12px", color: "#475569", fontStyle: "italic", marginBottom: "10px", paddingTop: "8px", borderTop: "1px solid rgba(148,163,184,0.1)" }}>
                  Legacy decision on record: {legacyReadinessDecision.kind.toUpperCase()} at {new Date(legacyReadinessDecision.at).toLocaleString()}
                  {legacyReadinessDecision.reason ? ` — "${legacyReadinessDecision.reason}"` : ""}. This predates the current evidence-snapshot system and cannot authorize readiness; a fresh decision is required.
                </div>
              ) : null}
              {readiness.status === "OFFER_READY" ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    value={readinessDecisionReasonInput}
                    onChange={(e) => setReadinessDecisionReasonInput(e.target.value)}
                    placeholder="Optional note"
                    disabled={readinessDecisionBusy}
                    style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                  />
                  <button
                    onClick={() => handleReadinessDecision("approved")}
                    disabled={readinessDecisionBusy}
                    data-testid="readiness-approve-button"
                    style={{ ...COMPACT_BUTTON_STYLE, opacity: readinessDecisionBusy ? 0.6 : 1, cursor: readinessDecisionBusy ? "not-allowed" : "pointer" }}
                  >
                    {readinessDecisionBusy ? <Loader2 size={12} className="animate-spin" /> : null} Approve
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    value={readinessDecisionReasonInput}
                    onChange={(e) => setReadinessDecisionReasonInput(e.target.value)}
                    placeholder="Reason for overriding (required)"
                    disabled={readinessDecisionBusy}
                    style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                  />
                  <button
                    onClick={() => handleReadinessDecision("overridden")}
                    disabled={readinessDecisionBusy || readinessDecisionReasonInput.trim() === ""}
                    data-testid="readiness-override-button"
                    style={{
                      ...COMPACT_BUTTON_STYLE,
                      opacity: readinessDecisionBusy || readinessDecisionReasonInput.trim() === "" ? 0.45 : 1,
                      cursor: readinessDecisionBusy || readinessDecisionReasonInput.trim() === "" ? "not-allowed" : "pointer",
                    }}
                  >
                    {readinessDecisionBusy ? <Loader2 size={12} className="animate-spin" /> : null} Override anyway
                  </button>
                </div>
              )}
              {readinessDecisionError ? (
                <div data-testid="readiness-decision-error" style={{ marginTop: "8px", fontSize: "11px", color: "#EF4444" }}>{readinessDecisionError}</div>
              ) : null}
            </div>
          ) : null}

          {/* B8-10 / INV-53 — Agreement Reached + Contract Ready handoff.
              A SEPARATE surface from ReadinessBadge above, never replacing
              it -- Offer Ready and Contract Ready are two different
              gates, and Agreement Reached is not Under Contract (that
              verification belongs to Board #9). Shown only when the
              latest recorded outcome is `accept`.

              Jess Gate correction, 2026-09-08: checklist progress is now
              DURABLE, via `contractReadyChecklistRecord` (read above,
              scoped to this exact agreed price + address) -- the
              `checked`/`onChange` below read/write that record instead of
              local state; nothing else in this banner changes. */}
          {latestOutcome?.kind === "accept" ? (
            <div
              data-testid="agreement-reached-banner"
              style={{
                marginBottom: "16px", padding: "16px 18px", borderRadius: "10px",
                background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.35)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                <ShieldCheck size={16} style={{ color: "#22C55E" }} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#22C55E", letterSpacing: "0.02em" }}>
                  AGREEMENT REACHED
                </span>
                <span style={{ fontSize: "11px", color: "#94A3B8" }}>
                  at {moneyOrUnknown(latestOutcome.snapshot.currentOffer)}, {new Date(latestOutcome.at).toLocaleString()} — not yet Under Contract
                </span>
              </div>

              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "8px" }}>
                Contract Ready checklist (Board #9 completes the transaction; this is a handoff, not contract software)
              </div>
              <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.9 }} data-testid="contract-ready-checklist">
                <div>✓ Agreed price: {moneyOrUnknown(latestOutcome.snapshot.currentOffer)} (from the Agreement Reached record)</div>
                <div>✓ Property address: {formatAddress(contact)}</div>
                {CONTRACT_CHECKLIST_ITEMS.map((item) => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: contractChecklistBusy ? "not-allowed" : "pointer" }}>
                    <input
                      type="checkbox"
                      data-testid={`contract-ready-item-${item.key}`}
                      checked={contractReadyChecklistRecord?.items[item.key] ?? false}
                      disabled={contractChecklistBusy !== null}
                      onChange={(e) => handleToggleContractReadyItem(item.key, e.target.checked)}
                    />
                    {item.label}
                    {contractChecklistBusy === item.key ? <Loader2 size={11} className="animate-spin" /> : null}
                  </label>
                ))}
              </div>
              {contractChecklistError ? (
                <div data-testid="contract-ready-checklist-error" style={{ fontSize: "11px", color: "#EF4444", marginTop: "8px" }}>{contractChecklistError}</div>
              ) : null}
              <div style={{ fontSize: "10px", color: "#475569", marginTop: "8px" }}>
                Checklist progress is durable and scoped to this agreed price and property address — it does not carry over to a different agreement or property. Board #9 completes the actual transaction; this checklist is a handoff aid only.
              </div>
            </div>
          ) : null}

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
                {/* Jess Gate, 2026-09-06: truthful feedback for an INVALID
                    entry, distinct from an EMPTY one -- empty renders no
                    message at all (the placeholder already says "Not yet
                    entered"); only a typed-but-unusable value gets this
                    line, and the value withheld from every downstream
                    calculation is proven by `sellerPosition` above being
                    `null` for both cases. */}
                {sellerPositionParsed.kind === "invalid" ? (
                  <span data-testid="negotiation-seller-position-error" style={{ color: "#EF4444", fontSize: "10px" }}>
                    {sellerPositionParsed.reason}
                  </span>
                ) : null}
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
                {currentOfferParsed.kind === "invalid" ? (
                  <span data-testid="negotiation-current-offer-error" style={{ color: "#EF4444", fontSize: "10px" }}>
                    {currentOfferParsed.reason}
                  </span>
                ) : null}
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
                      Acknowledged by {negotiationOverride!.operator ?? "an unidentified session actor (no authenticated operator identity in this build)"} at {negotiationOverride!.at}.
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
                          onClick={() => void handleOverrideAndContinue()}
                          disabled={!overrideAcknowledged || overrideReasonDraft.trim() === "" || overrideWriteBusy}
                          style={{
                            ...COMPACT_BUTTON_STYLE, alignSelf: "flex-start",
                            cursor: !overrideAcknowledged || overrideReasonDraft.trim() === "" || overrideWriteBusy ? "not-allowed" : "pointer",
                            opacity: !overrideAcknowledged || overrideReasonDraft.trim() === "" || overrideWriteBusy ? 0.45 : 1,
                            borderColor: "rgba(239,68,68,0.45)", color: "#EF4444", background: "rgba(239,68,68,0.1)",
                          }}
                        >
                          {overrideWriteBusy ? <Loader2 size={12} className="animate-spin" /> : null} Override &amp; Continue
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

          {/* B8-10 / INV-53 — bounded call outcomes. Accept, Follow-Up,
              and Pass are docs/SELLER_ACQUISITION_WORKFLOW.md's own three
              words, never a new call-status universe -- see the module
              header for the exact write boundary (notes.create,
              scheduleCallbackGated, setLastCallAttempt only; never a
              Board 4 disposition field). */}
          <div
            data-testid="call-outcome-panel"
            style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px", marginTop: "8px" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Record Call Outcome</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                data-testid="call-outcome-accept-toggle"
                onClick={() => setShowOutcomeForm(showOutcomeForm === "accept" ? null : "accept")}
                disabled={recordingOutcome !== null}
                title={
                  currentOffer === null
                    ? "Enter a Current Offer above before recording acceptance"
                    : readiness?.effectiveStatus !== "OFFER_READY"
                      ? "This deal is not yet Offer Ready"
                      : undefined
                }
                style={{ ...COMPACT_BUTTON_STYLE, borderColor: "rgba(34,197,94,0.4)", color: "#22C55E", background: "rgba(34,197,94,0.08)" }}
              >
                Accept
              </button>
              <button
                data-testid="call-outcome-follow-up-toggle"
                onClick={() => setShowOutcomeForm(showOutcomeForm === "follow_up" ? null : "follow_up")}
                disabled={recordingOutcome !== null}
                style={COMPACT_BUTTON_STYLE}
              >
                Follow-Up
              </button>
              <button
                data-testid="call-outcome-pass-toggle"
                onClick={() => setShowOutcomeForm(showOutcomeForm === "pass" ? null : "pass")}
                disabled={recordingOutcome !== null}
                style={{ ...COMPACT_BUTTON_STYLE, borderColor: "rgba(239,68,68,0.35)", color: "#EF4444", background: "rgba(239,68,68,0.08)" }}
              >
                Pass
              </button>
            </div>

            {showOutcomeForm === "accept" ? (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {currentOffer === null ? (
                  <div style={{ fontSize: "12px", color: "#F59E0B" }}>
                    Enter a Current Offer in the Negotiation panel above before recording acceptance.
                  </div>
                ) : readiness?.effectiveStatus !== "OFFER_READY" ? (
                  /* Jess Gate correction, 2026-09-06 -- ACCEPT MUST NOT BYPASS
                     OFFER READINESS. A Current Offer alone used to be
                     sufficient here, which let NOT_READY/REVIEW_NEEDED
                     economics become "Agreement Reached" and expose
                     Contract Ready. `readiness.effectiveStatus` (never the
                     raw `readiness.status`) is the one gate: it stays
                     exactly `status` unless a legitimate human OVERRIDDEN
                     action elevated it (offer-readiness.ts's own rule),
                     so a real override still unlocks Accept -- this only
                     blocks NOT_READY/REVIEW_NEEDED that were never
                     overridden. Follow-Up and Pass are UNCHANGED by this
                     gate -- neither reads `readiness` at all. */
                  <div data-testid="call-outcome-accept-not-ready" style={{ fontSize: "12px", color: "#F59E0B" }}>
                    This deal is not yet Offer Ready -- acceptance is unavailable until Offer Readiness reaches OFFER_READY.
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px" }}>
                    Records the seller's acceptance of the current Current Offer ({money(currentOffer)}).
                  </div>
                )}
                <button
                  data-testid="call-outcome-accept-confirm"
                  onClick={() => void handleRecordOutcome("accept")}
                  disabled={recordingOutcome !== null || currentOffer === null || readiness?.effectiveStatus !== "OFFER_READY"}
                  style={{
                    ...COMPACT_BUTTON_STYLE, borderColor: "rgba(34,197,94,0.4)", color: "#22C55E", background: "rgba(34,197,94,0.08)",
                    opacity: currentOffer === null || readiness?.effectiveStatus !== "OFFER_READY" ? 0.45 : 1,
                    cursor: recordingOutcome !== null || currentOffer === null || readiness?.effectiveStatus !== "OFFER_READY" ? "not-allowed" : "pointer",
                  }}
                >
                  {recordingOutcome === "accept" ? <Loader2 size={12} className="animate-spin" /> : null} Confirm Accept
                </button>
              </div>
            ) : null}

            {showOutcomeForm === "follow_up" ? (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "8px", maxWidth: "320px" }}>
                <label style={{ fontSize: "12px", color: "#94A3B8" }}>
                  Follow-up date/time
                  <input
                    type="datetime-local"
                    data-testid="call-outcome-follow-up-at"
                    value={followUpAtInput}
                    onChange={(e) => setFollowUpAtInput(e.target.value)}
                    style={{ display: "block", marginTop: "4px", background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px", padding: "8px 10px", color: "#E2E8F0", fontSize: "13px" }}
                  />
                </label>
                <button
                  data-testid="call-outcome-follow-up-confirm"
                  onClick={() => void handleRecordOutcome("follow_up")}
                  disabled={recordingOutcome !== null || followUpAtInput.trim() === ""}
                  style={{
                    ...COMPACT_BUTTON_STYLE, alignSelf: "flex-start",
                    opacity: followUpAtInput.trim() === "" ? 0.45 : 1, cursor: recordingOutcome !== null || followUpAtInput.trim() === "" ? "not-allowed" : "pointer",
                  }}
                >
                  {recordingOutcome === "follow_up" ? <Loader2 size={12} className="animate-spin" /> : null} Confirm Follow-Up
                </button>
              </div>
            ) : null}

            {showOutcomeForm === "pass" ? (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  data-testid="call-outcome-pass-reason"
                  value={passReasonInput}
                  onChange={(e) => setPassReasonInput(e.target.value)}
                  placeholder="Reason for passing (required)"
                  rows={2}
                  style={{ background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px", padding: "8px 10px", color: "#E2E8F0", fontSize: "12px", resize: "vertical" }}
                />
                <button
                  data-testid="call-outcome-pass-confirm"
                  onClick={() => void handleRecordOutcome("pass")}
                  disabled={recordingOutcome !== null || passReasonInput.trim() === ""}
                  style={{
                    ...COMPACT_BUTTON_STYLE, alignSelf: "flex-start", borderColor: "rgba(239,68,68,0.45)", color: "#EF4444", background: "rgba(239,68,68,0.1)",
                    opacity: passReasonInput.trim() === "" ? 0.45 : 1, cursor: recordingOutcome !== null || passReasonInput.trim() === "" ? "not-allowed" : "pointer",
                  }}
                >
                  {recordingOutcome === "pass" ? <Loader2 size={12} className="animate-spin" /> : null} Confirm Pass
                </button>
              </div>
            ) : null}

            {outcomeActionError ? (
              <div data-testid="call-outcome-error" style={{ marginTop: "8px", fontSize: "11px", color: "#EF4444" }}>{outcomeActionError}</div>
            ) : null}
          </div>

          {/* Conversation-first hierarchy -- B8-12 / INV-55, Brad-approved
              usability correction (locked 2026-09-07). "The script guides
              the conversation. MSK governs readiness." Next Best Question
              is the ONE visually primary element on this route; everything
              else here (Other Useful Questions, the Offer Readiness
              checklist, Known Facts) is deliberately smaller and quieter
              so the two never compete for attention during a live call.
              computeNextBestQuestion / computeQuestionQueue (imported,
              never reimplemented) are the SAME B8-06 engine as before --
              this section changes presentation, not what question gets
              picked or why. */}
          <div
            data-testid="next-best-question-panel"
            style={{
              marginTop: "8px", padding: "20px 22px", borderRadius: "12px",
              background: "linear-gradient(180deg, rgba(30,200,255,0.10), rgba(15,23,42,1))",
              border: "1px solid rgba(30,200,255,0.35)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#1EC8FF", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Next Best Question
              </div>
              <button
                onClick={() => setFullScriptOpen(true)}
                data-testid="view-full-script"
                style={{
                  fontSize: "11px", fontWeight: 600, color: "#94A3B8", background: "transparent",
                  border: "1px solid #334155", borderRadius: "6px", padding: "5px 10px", cursor: "pointer",
                }}
              >
                View Full Script
              </button>
            </div>

            {nextBestQuestion === null ? (
              <div style={{ fontSize: "14px", color: "#64748B", lineHeight: 1.6 }}>
                Underwriting must resolve before a question can be set.
              </div>
            ) : nextBestQuestion.kind === "offer_ready" ? (
              <div style={{ fontSize: "16px", color: "#22C55E", fontWeight: 700, lineHeight: 1.6 }}>
                {nextBestQuestion.message}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: "19px", color: "#F8FAFC", fontWeight: 700, lineHeight: 1.4 }}>
                  {nextBestQuestion.question}
                </div>
                <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, marginTop: "8px" }}>
                  Why it matters: {nextBestQuestion.whyItMatters}
                </div>
                <div style={{ fontSize: "11px", color: "#64748B", fontStyle: "italic", marginTop: "10px" }}>
                  Suggested — say it your way.
                </div>
              </div>
            )}

            {/* Other Useful Questions -- item 2 of the required hierarchy.
                Deliberately smaller and lower-contrast than the question
                above: relevant alternatives and follow-ups, never
                competing for primary attention. Same queue, everything
                after index 0. */}
            {otherUsefulQuestions.length > 0 ? (
              <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(148,163,184,0.15)" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748B", marginBottom: "8px" }}>
                  Other Useful Questions
                </div>
                <ul data-testid="other-useful-questions" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {otherUsefulQuestions.map((q, i) => (
                    <li key={i} style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, padding: "4px 0" }}>
                      • {q.question}
                    </li>
                  ))}
                </ul>
                <div style={{ fontSize: "11px", color: "#475569", fontStyle: "italic", marginTop: "6px" }}>
                  Suggested — say it your way.
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Known facts</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.8 }}>
                <div>ARV: {screen.known.arv !== null ? screen.known.arv.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
                <div>Repairs: {screen.known.repairs !== null ? screen.known.repairs.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
                <div>Seller Ask: {screen.known.askingPrice !== null ? screen.known.askingPrice.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not yet established"}</div>
              </div>
            </div>

            {/* What We Still Need / Offer Readiness -- item 3 of the
                required hierarchy. Compact list, not paragraph text; all
                six categories shown, satisfied ones checkmarked rather
                than disappearing. Reads the SAME `readiness` ReadinessBadge
                above renders -- no second computation. */}
            {readiness ? (
              <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>
                  What We Still Need / Offer Readiness
                </div>
                <OfferReadinessChecklist readiness={readiness} />
              </div>
            ) : null}

            {/* B8-13 / INV-68 — Property identity. Determination mechanism
                per the locked addendum: explicit operator confirmation,
                tied to the address on file at confirmation time. Reads
                `propertyIdentityConfirmation` (stale-checked against the
                CURRENT `formatAddress(contact)`, above) -- never a second
                confirmation state. */}
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="property-identity-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Property identity</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", marginBottom: "12px" }} data-testid="property-identity-status">
                {formatAddress(contact)}
                {propertyIdentityConfirmation ? (
                  <span style={{ color: "#22C55E", marginLeft: "8px" }}>✓ Confirmed {new Date(propertyIdentityConfirmation.at).toLocaleDateString()}</span>
                ) : (
                  <span style={{ color: "#94A3B8", marginLeft: "8px" }}>— not yet confirmed</span>
                )}
              </div>
              {!propertyIdentityConfirmation ? (
                <button
                  onClick={handleConfirmPropertyIdentity}
                  disabled={propertyIdentityBusy || formatAddress(contact) === "—"}
                  data-testid="confirm-property-identity"
                  style={{ ...COMPACT_BUTTON_STYLE, opacity: propertyIdentityBusy || formatAddress(contact) === "—" ? 0.45 : 1, cursor: propertyIdentityBusy ? "not-allowed" : "pointer" }}
                >
                  {propertyIdentityBusy ? <Loader2 size={12} className="animate-spin" /> : null} Confirm this is the right property
                </button>
              ) : (
                // Jess Gate correction, 2026-09-08: withdraw an incorrect
                // confirmation without needing the address to change.
                <button
                  onClick={handleWithdrawPropertyIdentity}
                  disabled={propertyIdentityWithdrawBusy}
                  data-testid="withdraw-property-identity"
                  style={{ ...COMPACT_LINK_STYLE, opacity: propertyIdentityWithdrawBusy ? 0.6 : 1, cursor: propertyIdentityWithdrawBusy ? "not-allowed" : "pointer" }}
                >
                  {propertyIdentityWithdrawBusy ? <Loader2 size={12} className="animate-spin" /> : null} Withdraw confirmation
                </button>
              )}
              {propertyIdentityError ? (
                <div data-testid="property-identity-error" style={{ marginTop: "8px", fontSize: "11px", color: "#EF4444" }}>{propertyIdentityError}</div>
              ) : null}
            </div>

            {/* B8-13 / INV-68 — Transaction assumptions. Determination
                mechanism per the locked addendum: three named sub-facts,
                each recorded or explicitly marked None -- never left
                blank. */}
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="transaction-assumptions-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Transaction assumptions</div>
              {transactionAssumptionsRecord && !transactionAssumptionsEditing ? (
                <div style={{ fontSize: "12px", color: "#94A3B8" }} data-testid="transaction-assumptions-status">
                  <div style={{ color: "#22C55E", marginBottom: "6px" }}>✓ Recorded {new Date(transactionAssumptionsRecord.at).toLocaleDateString()}</div>
                  <div>Structure: {transactionAssumptionsRecord.transactionStructure.kind === "none" ? "None" : transactionAssumptionsRecord.transactionStructure.value}</div>
                  <div>Closing/possession: {transactionAssumptionsRecord.closingPossession.kind === "none" ? "None" : transactionAssumptionsRecord.closingPossession.value}</div>
                  <div>Title complications: {transactionAssumptionsRecord.titleComplications.kind === "none" ? "None" : transactionAssumptionsRecord.titleComplications.value}</div>
                  {/* Jess Gate correction, 2026-09-08: correction entry point -- opens the SAME form below, prefilled. */}
                  <button
                    onClick={handleEditTransactionAssumptions}
                    data-testid="edit-transaction-assumptions"
                    style={{ ...COMPACT_LINK_STYLE, marginTop: "8px" }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      value={transactionStructureInput}
                      onChange={(e) => setTransactionStructureInput(e.target.value)}
                      disabled={transactionStructureNone || transactionAssumptionsBusy}
                      placeholder="Transaction structure"
                      style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                    />
                    <label style={{ fontSize: "11px", color: "#94A3B8", display: "flex", alignItems: "center", gap: "4px" }}>
                      <input type="checkbox" checked={transactionStructureNone} onChange={(e) => setTransactionStructureNone(e.target.checked)} /> None
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      value={closingPossessionInput}
                      onChange={(e) => setClosingPossessionInput(e.target.value)}
                      disabled={closingPossessionNone || transactionAssumptionsBusy}
                      placeholder="Closing/possession expectations"
                      style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                    />
                    <label style={{ fontSize: "11px", color: "#94A3B8", display: "flex", alignItems: "center", gap: "4px" }}>
                      <input type="checkbox" checked={closingPossessionNone} onChange={(e) => setClosingPossessionNone(e.target.checked)} /> None
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      value={titleComplicationsInput}
                      onChange={(e) => setTitleComplicationsInput(e.target.value)}
                      disabled={titleComplicationsNone || transactionAssumptionsBusy}
                      placeholder="Known title complications"
                      style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                    />
                    <label style={{ fontSize: "11px", color: "#94A3B8", display: "flex", alignItems: "center", gap: "4px" }}>
                      <input type="checkbox" checked={titleComplicationsNone} onChange={(e) => setTitleComplicationsNone(e.target.checked)} /> None
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleSaveTransactionAssumptions}
                      disabled={transactionAssumptionsBusy}
                      data-testid="save-transaction-assumptions"
                      style={{ ...COMPACT_BUTTON_STYLE, opacity: transactionAssumptionsBusy ? 0.6 : 1, cursor: transactionAssumptionsBusy ? "not-allowed" : "pointer" }}
                    >
                      {transactionAssumptionsBusy ? <Loader2 size={12} className="animate-spin" /> : null} Save
                    </button>
                    {/* Jess Gate correction, 2026-09-08: Cancel discards the draft and writes nothing -- only shown when there's an existing record to fall back to. */}
                    {transactionAssumptionsRecord ? (
                      <button
                        onClick={handleCancelEditTransactionAssumptions}
                        disabled={transactionAssumptionsBusy}
                        data-testid="cancel-transaction-assumptions"
                        style={{ ...COMPACT_LINK_STYLE, opacity: transactionAssumptionsBusy ? 0.6 : 1, cursor: transactionAssumptionsBusy ? "not-allowed" : "pointer" }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
              {transactionAssumptionsError ? (
                <div data-testid="transaction-assumptions-error" style={{ marginTop: "8px", fontSize: "11px", color: "#EF4444" }}>{transactionAssumptionsError}</div>
              ) : null}
            </div>

            {/* B8-13 / INV-68 — Seller price position. Determination
                mechanism per the locked addendum: a price, a
                counterposition, or an explicit documented refusal -- a
                refusal is valid evidence and must not remain UNKNOWN. */}
            <div style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }} data-testid="seller-price-position-panel">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Seller price position</div>
              {sellerPricePositionRecord && !sellerPricePositionEditing ? (
                <div style={{ fontSize: "12px", color: "#22C55E" }} data-testid="seller-price-position-status">
                  ✓ {sellerPricePositionRecord.kind === "price"
                    ? `${money(sellerPricePositionRecord.price)} recorded ${new Date(sellerPricePositionRecord.at).toLocaleDateString()}`
                    : `Documented refusal recorded ${new Date(sellerPricePositionRecord.at).toLocaleDateString()}`}
                  {/* Jess Gate correction, 2026-09-08: correction entry point. */}
                  <button
                    onClick={handleEditSellerPricePosition}
                    data-testid="edit-seller-price-position"
                    style={{ ...COMPACT_LINK_STYLE, marginLeft: "10px" }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      value={sellerPricePositionInput}
                      onChange={(e) => setSellerPricePositionInput(e.target.value)}
                      disabled={sellerPricePositionBusy}
                      placeholder="Seller's price"
                      style={{ ...COMPACT_LINK_STYLE, background: "rgba(255,255,255,0.04)", flex: 1, cursor: "text" }}
                    />
                    <button
                      onClick={() => handleRecordSellerPricePosition("price")}
                      disabled={sellerPricePositionBusy || sellerPricePositionInput.trim() === ""}
                      data-testid="record-seller-price"
                      style={{ ...COMPACT_BUTTON_STYLE, opacity: sellerPricePositionBusy || sellerPricePositionInput.trim() === "" ? 0.45 : 1, cursor: sellerPricePositionBusy ? "not-allowed" : "pointer" }}
                    >
                      Record
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      onClick={() => handleRecordSellerPricePosition("refused")}
                      disabled={sellerPricePositionBusy}
                      data-testid="record-seller-price-refused"
                      style={{ ...COMPACT_LINK_STYLE, opacity: sellerPricePositionBusy ? 0.6 : 1, cursor: sellerPricePositionBusy ? "not-allowed" : "pointer" }}
                    >
                      {sellerPricePositionBusy ? <Loader2 size={12} className="animate-spin" /> : null} Seller declined to give a price
                    </button>
                    {/* Jess Gate correction, 2026-09-08: Cancel discards the draft and writes nothing -- only shown when there's an existing record to fall back to. */}
                    {sellerPricePositionRecord ? (
                      <button
                        onClick={handleCancelEditSellerPricePosition}
                        disabled={sellerPricePositionBusy}
                        data-testid="cancel-seller-price-position"
                        style={{ ...COMPACT_LINK_STYLE, opacity: sellerPricePositionBusy ? 0.6 : 1, cursor: sellerPricePositionBusy ? "not-allowed" : "pointer" }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
              {sellerPricePositionError ? (
                <div data-testid="seller-price-position-error" style={{ marginTop: "8px", fontSize: "11px", color: "#EF4444" }}>{sellerPricePositionError}</div>
              ) : null}
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
      <FullScriptDrawer open={fullScriptOpen} onClose={() => setFullScriptOpen(false)} />
    </Shell>
  );
}
