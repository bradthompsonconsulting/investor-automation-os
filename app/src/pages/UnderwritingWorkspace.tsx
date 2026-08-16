import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, Lock } from "lucide-react";
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
import { toViewModel, type ScreenState, type SelectedOpportunity } from "../lib/underwriting/view-model";
import type { PolicyParseIssue } from "../lib/underwriting/resolver-types";
import type { UnderwritingResult } from "../lib/underwriting/types";

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

function Approve() {
  return (
    <div style={{
      display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 18px",
      background: "#0F172A", border: "1px dashed #334155", borderRadius: "10px", marginTop: "22px",
    }}>
      <Lock size={16} style={{ color: "#475569", flexShrink: 0, marginTop: "1px" }} />
      <div style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.5 }}>
        Approve is not available. Approved underwriting writes to the Opportunity,
        and no opportunity-model field has completed an inert proof — PB-D56
        prerequisite 5. This page is read-only until that gate clears.
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
      return { result: null as UnderwritingResult | null, askingPrice: null as number | null,
               issues: [] as PolicyParseIssue[], computeError: null as { field: string | null; message: string } | null };
    }
    const opp = opps.find((o) => o.id === selected.id);
    if (!opp) {
      return { result: null, askingPrice: null, issues: [],
               computeError: null as { field: string | null; message: string } | null };
    }
    try {
      const { policy, issues } = parsePolicy(policyValues, CV_IDS);
      const oppValues = parseOpportunityValues(opp.customFields, OPP_IDS);
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      const overrides = parseDealOverrides(opp.customFields);
      const facts = resolveDealFacts(oppValues, seeds);
      const inputs = resolveInputs(facts, overrides, policy);
      return { result: computeUnderwriting(inputs), askingPrice: facts.askingPrice, issues, computeError: null };
    } catch (e: any) {
      return {
        result: null, askingPrice: null, issues: [],
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
    askingPrice: pipeline.askingPrice,
    issues: pipeline.issues,
  });

  const arv = pipeline.result?.status === "resolved"
    ? pipeline.result.breakdown.find((l) => l.label === "ARV")?.amount ?? null : null;
  const repairs = pipeline.result?.status === "resolved"
    ? Math.abs(pipeline.result.breakdown.find((l) => l.label === "Repairs")?.amount ?? 0) : null;

  return (
    <Shell contactId={contactId}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0 }}>
          Underwriting
        </h1>
        <div style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
          {contactName(contact)}
          {screen.state === "resolved" || screen.state === "unresolved" || screen.state === "configuration_error"
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
          <Rail
            ask={screen.state === "resolved" ? pipeline.askingPrice : null}
            arv={arv}
            repairs={repairs}
            mao={screen.state === "resolved" ? screen.figures.sellerMAO : null}
            waiting={screen.state === "unresolved" ? "Waiting for " + screen.missing.join(", ") : null}
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

      {screen.state === "unresolved" ? (
        <Notice
          tone="warn"
          title="Underwriting cannot begin"
          body={`Missing: ${screen.missing.join(", ")}. Gate 1 requires ARV and repairs; every other input resolves from policy.`}
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
                  {key}: <span style={{ color: "#94A3B8" }}>{level === null ? "not used" : LEVEL_LABEL[level] ?? level}</span>
                </span>
              ))}
            </div>
          </div>

          <Approve />
        </>
      ) : null}
    </Shell>
  );
}
