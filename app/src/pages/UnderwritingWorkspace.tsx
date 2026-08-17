import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Check, Loader2 } from "lucide-react";
import { ghl, type ContactDetail, type OpportunityRow } from "../lib/ghl";
import { getConfig } from "../../shared/ghl-config";
import {
  parsePolicy,
  parseOpportunityValues,
  parseContactSeeds,
  parseDealOverrides,
  resolveDealFacts,
  resolveInputs,
} from "../lib/underwriting/resolver";
import { computeUnderwriting } from "../lib/underwriting/compute";
import { toViewModel, type ApproveState, type ScreenState, type SelectedOpportunity } from "../lib/underwriting/view-model";
import { OPTION_BY_MODE } from "../lib/underwriting/resolver-types";
import type { DealFacts, PolicyParseIssue } from "../lib/underwriting/resolver-types";
import type { AssignmentResolution, UnderwritingResult } from "../lib/underwriting/types";

/**
 * Underwriting Workspace — UNDERWRITING_WORKSPACE_SPEC.md.
 *
 * Route: /contacts/:id/underwriting. A Contact-context sub-route, decided
 * 2026-08-14: the persistent rail needs its own viewport, because Seller
 * MAO is a guardrail during live negotiation and a guardrail that scrolls
 * away is not one.
 *
 * READ ONLY. This page performs no writes of any kind. Approve is not
 * rendered — PB-D56 prerequisite 5, the opportunity-side inert proof, is
 * the gate and it is open. A disabled button would imply Approve is one
 * configuration away from working; it is not.
 *
 * Zones 1, 2 and 4 only. Zone 3 (Work the Deal) is editing, and every edit
 * is a write.
 *
 * All interpretation lives in view-model.ts. This component fetches,
 * selects an opportunity, runs the pipeline, and renders — it decides
 * nothing about what "unresolved" means.
 */

const CONTENT_MAX_WIDTH = "1600px";
const CONFIG = getConfig(import.meta.env.VITE_IAOS_ENV);

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

/** Local, not in format.ts — one consumer, so no shared abstraction yet. */
function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function contactName(c: ContactDetail | null): string {
  if (!c) return "—";
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

const LEVEL_LABEL: Record<string, string> = {
  deal_override: "Deal Override",
  investor_policy: "Investor Policy",
  iaos_starter: "IAOS Starter",
};

/**
 * Operator-facing labels for the Provenance keys. Internal identifiers must
 * never reach the screen -- the same rule the missing-input labels follow in
 * view-model.ts. This section rendered `sellingCostPct` and six others
 * verbatim until 2026-08-16, and survived because it only appears in the
 * resolved state, which had no production fixture until that day.
 *
 * Unmapped keys fall back to the raw name rather than disappearing.
 */
const ASSUMPTION_LABEL: Record<string, string> = {
  sellingCostPct: "Selling Cost Percentage",
  closingCost: "Closing Cost Estimate",
  monthlyCarry: "Monthly Holding Cost",
  holdMonths: "Hold Period",
  buyerProfitPct: "Buyer Profit Percentage",
  standardMinimum: "Standard Minimum Assignment Spread",
  financingEnabled: "Purchase Financing",
  financingLtv: "Financing LTV",
  financingRate: "Interest Rate",
  financingPoints: "Financing Points",
  profitSharePct: "Buyer Profit Share Percentage",
};

// ── Presentational pieces ────────────────────────────────────────────────────

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

/** The persistent rail. Four numbers, per SELLER_ACQUISITION_WORKFLOW.md. */
function Rail({ ask, arv, repairs, mao, waiting }: {
  ask: number | null; arv: number | null; repairs: number | null;
  mao: number | null; waiting: string | null;
}) {
  const cell = (label: string, value: string, accent?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
      <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{
        fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace",
        color: accent ?? "#E2E8F0",
      }}>{value}</span>
    </div>
  );
  return (
    <div style={{
      display: "flex", gap: "28px", flexWrap: "wrap", alignItems: "flex-start",
      padding: "16px 20px", background: "#0F172A", border: "1px solid #1E293B",
      borderRadius: "10px", marginBottom: "20px",
    }}>
      {cell("Seller Ask", money(ask))}
      {cell("ARV", money(arv))}
      {cell("Repairs", money(repairs))}
      {waiting
        ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller MAO</span>
            <span style={{ fontSize: "13px", color: "#F59E0B", fontWeight: 600, paddingTop: "3px" }}>{waiting}</span>
          </div>
        )
        : cell("Seller MAO", money(mao), "#1EC8FF")}
    </div>
  );
}

/**
 * PB-D59 -- the Approve control and its outcomes.
 *
 * WARNINGS DO NOT BLOCK. A resolved deal carrying an out-of-parameters
 * warning is still approvable: PB-D56 flags and never blocks, and the
 * investor remains the decision authority. The warning renders above this
 * control, where the operator sees it before deciding. Nobody may later
 * tighten `disabled` to include warnings -- that would make IAOS override
 * an operator judgment for the first time.
 *
 * The only condition that disables the button is a write already in
 * flight, which prevents a second PUT over an outstanding one.
 */
function ApproveControl({ state, onApprove, warningCount }: {
  state: ApproveState;
  onApprove: () => void;
  warningCount: number;
}) {
  if (state.status === "succeeded") {
    return (
      <div style={{
        display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 18px",
        background: "#22C55E0F", border: "1px solid #22C55E33", borderRadius: "10px", marginTop: "22px",
      }}>
        <Check size={16} style={{ color: "#22C55E", flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5 }}>
          <strong>Underwriting approved.</strong> End-Buyer Maximum Purchase Price,
          Seller MAO and Assignment Mode were saved to the opportunity and
          confirmed on read-back.
        </div>
      </div>
    );
  }

  if (state.status === "partial") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px",
        background: "#F59E0B0F", border: "1px solid #F59E0B44", borderRadius: "10px", marginTop: "22px",
      }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <AlertCircle size={18} style={{ color: "#F59E0B", flexShrink: 0, marginTop: "1px" }} />
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>
              Partially saved — NOT approved
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>
              {state.message} Review the opportunity in GHL before trying again.
            </div>
          </div>
        </div>
        <div style={{ fontFamily: "Space Grotesk, monospace", fontSize: "12px", paddingLeft: "28px" }}>
          {state.carriers.map((c) => (
            <div key={c.key} style={{ display: "flex", gap: "10px", padding: "2px 0" }}>
              <span style={{ color: c.landed ? "#22C55E" : "#EF4444", width: "62px" }}>
                {c.landed ? "saved" : "not saved"}
              </span>
              <span style={{ color: "#94A3B8" }}>{c.key}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const failed = state.status === "failed";
  const inFlight = state.status === "in_flight";

  return (
    <div style={{ marginTop: "22px" }}>
      {failed ? (
        <div style={{
          display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 18px",
          background: "#EF44440F", border: "1px solid #EF444433", borderRadius: "10px",
          marginBottom: "12px",
        }}>
          <AlertCircle size={16} style={{ color: "#EF4444", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
            <span style={{ color: "#E2E8F0", fontWeight: 600 }}>Nothing was saved.</span>{" "}
            {state.message} The opportunity is unchanged, so trying again is safe.
          </div>
        </div>
      ) : null}

      <button
        onClick={onApprove}
        disabled={inFlight}
        style={{
          display: "inline-flex", alignItems: "center", gap: "8px",
          padding: "10px 18px", borderRadius: "8px", cursor: inFlight ? "default" : "pointer",
          background: inFlight ? "#1E293B" : "#1EC8FF",
          color: inFlight ? "#64748B" : "#0B1220",
          border: "none", fontSize: "13px", fontWeight: 700,
        }}
      >
        {inFlight ? "Saving…" : failed ? "Try again" : "Approve underwriting"}
      </button>

      <div style={{ fontSize: "11px", color: "#475569", marginTop: "8px", lineHeight: 1.5 }}>
        Writes End-Buyer Maximum Purchase Price, Seller MAO and Assignment Mode
        to the opportunity. Nothing else is written — not the stage, the status,
        or any offer field.
        {warningCount > 0
          ? " This deal carries a warning above; approving is permitted and the decision is yours."
          : ""}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UnderwritingWorkspace() {
  const { id } = useParams<{ id: string }>();
  const contactId = id ?? "";

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [policyValues, setPolicyValues] = useState<{ id: string; value: string }[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);

  /* PB-D59. The Approve attempt's state, held here because the view model
     owns the RESULT and never the call -- the page performs the write and
     hands the outcome in.

     Nothing sets this yet and nothing renders it. PB-D59 section VI as
     amended permits Approve to be built; this slice deliberately stops
     before the control, so the write method, its readback parser and these
     states are all provable before anything is browser-reachable. The
     setter is unused until the control lands. */
  const [approve, setApprove] = useState<ApproveState>({ status: "idle" });

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setFetchError(null);
    Promise.all([
      ghl.contacts.getDetail(contactId),
      ghl.opportunities.listPipeline(),
      ghl.underwriting.policy(),
    ])
      .then(([c, pipeline, policy]) => {
        if (cancelled) return;
        setContact(c);
        setOpps(pipeline.opportunities.filter((o) => o.contactId === contactId));
        setPolicyValues(policy.values);
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message); });
    return () => { cancelled = true; };
  }, [contactId]);

  const loading = fetchError === null && (contact === null || opps === null || policyValues === null);

  const candidates: SelectedOpportunity[] = useMemo(
    () => (opps ?? []).map((o) => ({ id: o.id, name: o.opportunityName || o.contactName || o.id })),
    [opps],
  );

  /**
   * Exactly one candidate auto-selects, derived rather than set through an
   * effect so a one-item selector never flashes. More than one requires an
   * explicit choice — PB-D55 forbids assuming the first is the deal.
   */
  const selected: SelectedOpportunity | null = useMemo(() => {
    if (candidates.length === 1) return candidates[0];
    if (chosenId === null) return null;
    return candidates.find((c) => c.id === chosenId) ?? null;
  }, [candidates, chosenId]);

  const pipeline = useMemo(() => {
    if (!contact || !opps || !policyValues || !selected) {
      return { result: null as UnderwritingResult | null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null,
               issues: [] as PolicyParseIssue[], computeError: null as { field: string | null; message: string } | null };
    }
    const opp = opps.find((o) => o.id === selected.id);
    if (!opp) {
      return { result: null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null, issues: [],
               computeError: null as { field: string | null; message: string } | null };
    }
    try {
      const { policy, issues } = parsePolicy(policyValues, CV_IDS);
      const oppValues = parseOpportunityValues(opp.customFields, OPP_IDS);
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      const overrides = parseDealOverrides(opp.customFields);
      const facts = resolveDealFacts(oppValues, seeds);
      const inputs = resolveInputs(facts, overrides, policy);
      /* The assignment travels alongside the result from the SAME
         resolveInputs call. Re-deriving it separately would let the two
         disagree -- a resolved calculation paired with an assignment that
         did not produce it -- which the view model would then have to
         treat as an orchestration error it could not diagnose. */
      return { result: computeUnderwriting(inputs), facts, assignment: inputs.assignment, issues, computeError: null };
    } catch (e: any) {
      return {
        result: null, facts: null as DealFacts | null,
        assignment: null as AssignmentResolution | null, issues: [],
        computeError: { field: null, message: e?.message ?? "A configured value could not be interpreted." },
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
    approve,
  });

  /**
   * PB-D59 -- the Approve write. THE ONLY place in the UI that initiates
   * an underwriting mutation.
   *
   * The page owns the call; the view model owns only its result. That
   * boundary matters most here, because this is the first
   * browser-reachable write in this feature and a pure view model cannot
   * accidentally issue one.
   *
   * PROVEN INERT BEFORE IT WAS REACHABLE. PB-D58 section II and PB-D59
   * Proofs A0, A and B: twenty proof steps, ten production mutations,
   * every one restored, the exact three-field payload proven on a
   * disposable fixture before this handler existed.
   */
  async function onApprove() {
    if (screen.state !== "resolved") return;
    if (screen.approve.status === "in_flight") return;

    setApprove({ status: "in_flight" });

    try {
      /* The domain discriminant maps to a GHL option label HERE, at the
         write boundary, through the single mapping in resolver-types.ts.
         The screen contract carries the discriminant and never the label. */
      const result = await ghl.underwriting.saveUnderwritingFields(screen.opportunity.id, {
        endBuyerMaxPrice: screen.figures.endBuyerMaxPrice,
        sellerMAO: screen.figures.sellerMAO,
        assignmentMode: OPTION_BY_MODE[screen.assignment.kind],
      });

      if (result.ok) {
        setApprove({ status: "succeeded" });
        return;
      }

      /* PARTIAL. Some carriers landed and some did not, so the record IS
         changed. PB-D59 section IV: reported, never silently compensated,
         and never represented to the operator as approved. No retry is
         offered -- a second write over a partially applied state needs a
         human deciding what the state should be. */
      setApprove({
        status: "partial",
        message: `${result.landed} of 3 fields were saved. The opportunity has changed and is not approved.`,
        landed: result.landed,
        carriers: result.carriers.map((c) => ({
          key: c.key,
          landed: c.landed,
          sent: c.sent,
          observed: c.observed,
        })),
      });
    } catch (e: any) {
      /* FAILED. The PUT threw or returned non-2xx, so nothing was written
         and the record is unchanged. A retry is meaningful and safe, which
         is exactly what distinguishes this from partial. */
      setApprove({
        status: "failed",
        message: e?.message ?? "The write could not be completed.",
      });
    }
  }

  return (
    <Shell contactId={contactId}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0 }}>
          Underwriting
        </h1>
        <div style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
          {contactName(contact)}
          {/* The opportunity name falls back to the contact name when GHL
              carries none, so the two are frequently identical. Showing
              "Name · Name" is noise; show the deal only when it differs. */}
          {(screen.state === "resolved" || screen.state === "unresolved" || screen.state === "configuration_error")
            && screen.opportunity.name !== contactName(contact)
            ? <> · <span style={{ color: "#94A3B8" }}>{screen.opportunity.name}</span></>
            : null}
        </div>
      </div>

      {screen.state === "loading" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748B", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading underwriting…
        </div>
      ) : null}

      {screen.state === "fetch_error" ? (
        <Notice tone="error" title="Could not load underwriting" body={screen.message} />
      ) : null}

      {screen.state === "orchestration_error" ? (
        <Notice tone="error" title="Underwriting could not be assembled" body={screen.detail} />
      ) : null}

      {screen.state === "no_opportunity" ? (
        <Notice
          tone="info"
          title="No opportunity on this contact"
          body="Underwriting belongs to the deal, not the person (PB-D55). Nothing is written to the contact as a substitute. Create an opportunity in GHL to underwrite this property."
        />
      ) : null}

      {screen.state === "awaiting_selection" ? (
        <div>
          <Notice
            tone="info"
            title="Select the deal to underwrite"
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
          title="Underwriting configuration error"
          body={`A configured value could not be interpreted safely${screen.field ? ` (${screen.field})` : ""}. ${screen.message}`}
        />
      ) : null}

      {screen.state === "unresolved" || screen.state === "resolved" ? (
        <>
          {/* Known facts show whether or not underwriting resolved. Being
              told what is missing while what is known is blank is the
              opposite of useful during a call. */}
          <Rail
            ask={screen.known.askingPrice}
            arv={screen.known.arv}
            repairs={screen.known.repairs}
            mao={screen.state === "resolved" ? screen.figures.sellerMAO : null}
            waiting={screen.state === "unresolved" ? "Waiting for " + screen.missingLabels.join(", ") : null}
          />

          {screen.banner.issues.length > 0 ? (
            <div style={{ marginBottom: "18px" }}>
              <Notice
                tone="warn"
                title={`${screen.banner.issues.length} investor-policy value${screen.banner.issues.length === 1 ? "" : "s"} could not be read`}
                body={screen.banner.issues.map((i) => `${i.key}: "${i.raw}" — ${i.reason}`).join("; ") +
                      ". IAOS Starter policy was used for these."}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {/* Operator language only -- `missing` carries internal keys and is
          never rendered. The previous copy claimed every non-Gate-1 input
          resolves from policy, which is false for Assignment Mode: it is a
          deal fact read from the Opportunity, has no starter fallback, and
          no policy value can clear it. */}
      {screen.state === "unresolved" ? (
        <Notice
          tone="warn"
          title="Underwriting cannot begin"
          body={
            screen.missingLabels.length === 1
              ? `${screen.missingLabels[0]} is not set for this opportunity.`
              : `Not set for this opportunity: ${screen.missingLabels.join(", ")}.`
          }
        />
      ) : null}

      {screen.state === "resolved" ? (
        <>
          {/* Zone 2 — Decision Panel */}
          <div style={{
            display: "flex", gap: "36px", flexWrap: "wrap", padding: "20px",
            background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px",
          }}>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>End-Buyer Maximum Purchase Price</div>
              <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0" }}>
                {money(screen.figures.endBuyerMaxPrice)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller MAO</div>
              <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#1EC8FF" }}>
                {money(screen.figures.sellerMAO)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Acquisition Position</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#94A3B8", paddingTop: "6px" }}>
                {screen.position.position === "asking_unknown" ? "Asking price unknown" : null}
                {screen.position.position === "within_range"
                  ? <span style={{ color: "#22C55E" }}>Within range · cushion {money(screen.position.acquisitionCushion)}</span> : null}
                {screen.position.position === "above_range"
                  ? <span style={{ color: "#F59E0B" }}>Above range · gap {money(screen.position.gapToUnderwriting)}</span> : null}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Assignment Spread</div>
              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0", paddingTop: "3px" }}>
                {money(screen.figures.assignmentSpread)}
              </div>
            </div>
          </div>

          {screen.warnings.map((w) => (
            <div key={w.code} style={{ marginTop: "14px" }}>
              <Notice
                tone="warn"
                title="Outside standard parameters"
                body={`The manual assignment spread of ${money(w.spread)} is below the configured standard minimum of ${money(w.minimum)}. This is permitted and is not blocked.`}
              />
            </div>
          ))}

          {/* Zone 4 — Explain the Math */}
          <div style={{ marginTop: "22px" }}>
            <div style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
              How this was calculated
            </div>
            <div style={{
              padding: "18px 20px", background: "#0F172A", border: "1px solid #1E293B",
              borderRadius: "10px", fontFamily: "Space Grotesk, monospace", fontSize: "13px",
            }}>
              {screen.breakdown.map((line) => (
                <div key={line.label} style={{
                  display: "flex", justifyContent: "space-between", gap: "24px", padding: "4px 0",
                  color: line.label === "Seller MAO" || line.label === "Base Buyer Capacity"
                    || line.label === "End-Buyer Maximum Purchase Price" ? "#E2E8F0" : "#94A3B8",
                  fontWeight: line.label === "Seller MAO" ? 700 : 400,
                  borderTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO"
                    ? "1px solid #1E293B" : "none",
                  marginTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO" ? "6px" : 0,
                  paddingTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO" ? "10px" : "4px",
                }}>
                  <span>{line.label}</span>
                  <span>{money(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", padding: "4px 0", color: "#475569", fontSize: "11px", marginTop: "8px" }}>
                <span>financing factor</span>
                <span>{screen.figures.financingFactor.toFixed(4)}</span>
              </div>
            </div>

            <div style={{ marginTop: "14px", fontSize: "11px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Where each assumption came from
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", fontSize: "12px", color: "#64748B" }}>
              {Object.entries(screen.provenance).map(([key, level]) => (
                <span key={key}>
                  {ASSUMPTION_LABEL[key] ?? key}: <span style={{ color: "#94A3B8" }}>{level === null ? "not used" : LEVEL_LABEL[level] ?? level}</span>
                </span>
              ))}
            </div>
          </div>

          <ApproveControl
            state={screen.approve}
            onApprove={onApprove}
            warningCount={screen.warnings.length}
          />
        </>
      ) : null}
    </Shell>
  );
}
