import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { ghl, type ContactDetail, type OpportunityRow } from "../lib/ghl";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import {
  formatContractReadyChecklistNote,
  CONTRACT_READY_ITEM_KEYS, type ContractReadyItemKey, type ContractReadyItems,
} from "../lib/seller-call-readiness-carriers";
import { computeContractScreenState, type ContractScreenState } from "../lib/contract-workspace-view";
import { CONTRACT_STATE_MEANING } from "../lib/board9-contract-model";

/**
 * Contract Workspace -- B9-04 / INV-59.
 *
 * Route: /contacts/:id/contract. The Board #9 "focused continuation from
 * Board #8" INV-59's own outcome names: a dedicated screen reached AFTER
 * the Seller Call, mirroring the same Contact-context sub-route pattern
 * `UnderwritingWorkspace.tsx` (/contacts/:id/underwriting) and
 * `SellerCallWorkspace.tsx` (/contacts/:id/seller-call) already use.
 *
 * CONSUMES B9-03 DIRECTLY; RECREATES NO READINESS LOGIC HERE. Every
 * judgment about what "Contract Ready" means, what counts as missing, or
 * what counts as a stale checklist comes from `contract-workspace-view.ts`
 * (pure, independently tested), which itself consumes
 * `board9-contract-model.ts`'s `deriveInheritedEconomics` and
 * `evaluateContractReady` -- this component only renders what that module
 * returns. It does not compute a Contract Ready boolean, does not decide
 * which checklist item is missing, and does not invent a second staleness
 * rule.
 *
 * NO INVENTED GHL-TO-DOMAIN MAPPING. Every read below (`ghl.contacts.
 * getDetail`, `ghl.opportunities.listPipeline`, `ghl.notes.list`) and every
 * selection helper (`opportunitiesForContact`, `opportunityCandidates`,
 * `selectOpportunity`) is the SAME already-authorized read/selection
 * `SellerCallWorkspace.tsx` and `UnderwritingWorkspace.tsx` already use --
 * nothing new is read from GHL, and no new custom field id is introduced.
 *
 * WRITES ONLY ON EXPLICIT OPERATOR ACTION. The one write this page can
 * perform -- toggling a Contract Ready checklist item -- happens
 * exclusively inside `handleToggleChecklistItem`, itself only ever called
 * from a checkbox's own `onChange`. Nothing here writes on mount, on
 * screen-state change, or as a side effect of loading -- the data-fetching
 * `useEffect` below only ever calls `ghl.contacts.getDetail`,
 * `ghl.opportunities.listPipeline`, and `ghl.notes.list`, all reads.
 * Reuses the EXISTING sanctioned write (`formatContractReadyChecklistNote`
 * -> `ghl.notes.create()`) `SellerCallWorkspace.tsx` already uses --  no
 * new carrier, no new write class.
 *
 * FAIL CLOSED ON UNAVAILABLE/UNMAPPABLE DATA. `contract-workspace-view.ts`
 * already refuses to reach `state: "ready"` unless the accepted economics
 * were verified derivable and a real Current Offer exists; this component
 * simply renders the operator-readable reason for every other state
 * (`fetch_error`, `no_agreement`, `conflicting_history`,
 * `economics_unavailable`) rather than guessing at a Contract Ready
 * checklist for data that cannot be trusted.
 */

const CONTENT_MAX_WIDTH = "1200px";

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

function Notice({ tone, title, body, testId }: { tone: "error" | "warn" | "info"; title: string; body?: string; testId?: string }) {
  const color = tone === "error" ? "#EF4444" : tone === "warn" ? "#F59E0B" : "#64748B";
  return (
    <div data-testid={testId} style={{
      display: "flex", gap: "12px", alignItems: "flex-start", padding: "18px 20px",
      background: `${color}0F`, border: `1px solid ${color}33`, borderRadius: "10px", marginBottom: "16px",
    }}>
      <AlertCircle size={20} style={{ color, flexShrink: 0, marginTop: "1px" }} />
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>{title}</div>
        {body ? <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>{body}</div> : null}
      </div>
    </div>
  );
}

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

function moneyOrUnknown(n: number | null): string {
  return n === null ? "unknown" : money(n);
}

/** Exactly `SellerCallWorkspace.tsx`'s own five items and labels -- SELLER_ACQUISITION_WORKFLOW.md's remaining Contract Readiness list, copied verbatim, never a second wording. */
const CONTRACT_CHECKLIST_ITEMS: { key: ContractReadyItemKey; label: string }[] = [
  { key: "legal_owners", label: "Correct legal owners confirmed" },
  { key: "closing_timeline", label: "Closing timeline set" },
  { key: "occupancy_possession", label: "Occupancy and possession confirmed" },
  { key: "liens_title", label: "Known liens and title complications reviewed" },
  { key: "delivery_signing", label: "Delivery and signing information collected" },
];

export default function ContractWorkspace() {
  const { id } = useParams<{ id: string }>();
  const contactId = id ?? "";

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [notes, setNotes] = useState<{ id: string; body: string; dateAdded: string }[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);

  const [checklistBusy, setChecklistBusy] = useState<ContractReadyItemKey | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);

  // READS ONLY. No write of any kind happens in this effect or as a
  // consequence of the state it sets.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setFetchError(null);
    Promise.all([
      ghl.contacts.getDetail(contactId),
      ghl.opportunities.listPipeline(),
      ghl.notes.list(contactId),
    ])
      .then(([c, pipeline, notesResult]) => {
        if (cancelled) return;
        setContact(c);
        setOpps(opportunitiesForContact(pipeline.opportunities, contactId));
        setNotes(notesResult.notes ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message); });
    return () => { cancelled = true; };
  }, [contactId]);

  const loading = fetchError === null && (contact === null || opps === null || notes === null);
  const candidates = useMemo(() => opportunityCandidates(opps), [opps]);
  const selected = useMemo(() => selectOpportunity(candidates, chosenId), [candidates, chosenId]);
  const propertyAddress = useMemo(() => formatAddress(contact), [contact]);

  const screen: ContractScreenState = useMemo(
    () => computeContractScreenState({ loading, fetchError, candidates, selected, notes, propertyAddress }),
    [loading, fetchError, candidates, selected, notes, propertyAddress],
  );

  /**
   * The ONLY write this page performs, and the ONLY place it is called
   * from is a checkbox's own `onChange` below -- never on load, never as
   * an effect of `screen` changing. Reuses the EXISTING sanctioned write
   * verbatim (`formatContractReadyChecklistNote` -> `ghl.notes.create()`),
   * the same pattern `SellerCallWorkspace.tsx`'s own
   * `handleToggleContractReadyItem` already uses -- no new carrier.
   */
  async function handleToggleChecklistItem(key: ContractReadyItemKey, checked: boolean) {
    if (screen.state !== "ready") return;
    setChecklistError(null);
    setChecklistBusy(key);
    const at = new Date().toISOString();
    const items: ContractReadyItems = { ...screen.checklistItems, [key]: checked };
    const note = formatContractReadyChecklistNote({
      opportunityId: screen.opportunity.id,
      at,
      operator: null,
      agreementAt: screen.economics.agreementAt,
      agreedPrice: screen.agreedPrice,
      propertyAddress: screen.propertyAddress,
      items,
    });
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: at }]);
    } catch (e: any) {
      setChecklistError(e?.message ?? "Couldn't save this checklist item -- it is not yet in effect. Try again.");
    } finally {
      setChecklistBusy(null);
    }
  }

  return (
    <Shell contactId={contactId}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0 }}>Contract Ready</h1>
        <div style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
          {contactName(contact)}
          {screen.state === "ready" && screen.opportunity.name !== contactName(contact)
            ? <> · <span style={{ color: "#94A3B8" }}>{screen.opportunity.name}</span></>
            : null}
        </div>
      </div>

      {screen.state === "loading" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748B", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : null}

      {screen.state === "fetch_error" ? (
        <Notice testId="contract-fetch-error" tone="error" title="Could not load this contact's deal data" body={screen.message} />
      ) : null}

      {screen.state === "no_opportunity" ? (
        <Notice
          testId="contract-no-opportunity"
          tone="info"
          title="No opportunity on this contact"
          body="A seller contract belongs to the deal, not the person. Create an opportunity in GHL first."
        />
      ) : null}

      {screen.state === "awaiting_selection" ? (
        <div>
          <Notice
            testId="contract-awaiting-selection"
            tone="info"
            title="Select the deal"
            body="This contact holds more than one opportunity. IAOS does not assume the first one is the deal."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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

      {screen.state === "no_agreement" ? (
        <Notice
          testId="contract-no-agreement"
          tone="info"
          title="No agreement reached yet"
          body="Board #9 begins once the seller has accepted a price in the Seller Call workspace. Nothing to show here until then."
        />
      ) : null}

      {screen.state === "conflicting_history" ? (
        <Notice
          testId="contract-conflicting-history"
          tone="warn"
          title="Conflicting contract history"
          body={
            `Contract Ready checklist progress exists for this opportunity (recorded ${new Date(screen.priorChecklistAt).toLocaleString()}), ` +
            `but there is currently no active Agreement Reached${screen.latestOutcomeKind ? ` -- the latest recorded outcome is "${screen.latestOutcomeKind}"` : ""}. ` +
            `A new agreement must be reached before Contract Ready can be shown again.`
          }
        />
      ) : null}

      {screen.state === "economics_unavailable" ? (
        <Notice testId="contract-economics-unavailable" tone="error" title="Agreement Reached economics could not be verified" body={screen.reason} />
      ) : null}

      {screen.state === "ready" ? (
        <>
          {/* Agreed economics + provenance -- copied verbatim from
              deriveInheritedEconomics, never recomputed. */}
          <div
            data-testid="contract-agreed-economics"
            style={{
              marginBottom: "16px", padding: "16px 18px", borderRadius: "10px",
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.35)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <ShieldCheck size={16} style={{ color: "#22C55E" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#22C55E", letterSpacing: "0.02em" }}>AGREEMENT REACHED</span>
              <span style={{ fontSize: "11px", color: "#94A3B8" }}>
                {money(screen.agreedPrice)}, agreed {new Date(screen.economics.agreementAt).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px" }}>{CONTRACT_STATE_MEANING.agreement_reached}</div>
            <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.8 }}>
              <div>Property address: {screen.propertyAddress}</div>
              <div>ARV at acceptance: {moneyOrUnknown(screen.economics.economics.arv)}</div>
              <div>Repairs at acceptance: {moneyOrUnknown(screen.economics.economics.repairs)}</div>
              <div>Max Supported Offer at acceptance: {moneyOrUnknown(screen.economics.economics.maxSupportedOffer)}</div>
              <div>Expected Spread at acceptance: {moneyOrUnknown(screen.economics.economics.expectedSpread)}</div>
              <div style={{ color: "#64748B", marginTop: "6px" }}>
                Provenance: {screen.economics.authority} -- captured verbatim at the moment of acceptance, never recomputed here.
              </div>
            </div>
          </div>

          {screen.isStale && screen.staleInfo ? (
            <Notice
              testId="contract-stale-warning"
              tone="warn"
              title="This agreement has changed since checklist work began"
              body={
                `Contract Ready progress was recorded for an earlier agreement -- ${money(screen.staleInfo.priorPrice)}, ` +
                `${screen.staleInfo.priorAddress}, agreed ${new Date(screen.staleInfo.priorAgreementAt).toLocaleString()}. ` +
                `That progress does not carry over to this agreement; the checklist below starts fresh.`
              }
            />
          ) : null}

          {/* Contract Ready status headline -- straight from evaluateContractReady, never re-derived. */}
          <div
            data-testid="contract-ready-status"
            style={{
              display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px",
              fontSize: "14px", fontWeight: 700, color: screen.readiness.ready ? "#22C55E" : "#F59E0B",
            }}
          >
            {screen.readiness.ready ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            {screen.readiness.ready
              ? "Contract Ready"
              : `Not Contract Ready — ${screen.readiness.reasons.length} item${screen.readiness.reasons.length === 1 ? "" : "s"} remaining`}
          </div>

          {/* Missing/conflicting facts -- each reason's message is rendered
              verbatim from the model; this component never writes its own
              wording for why something is missing. */}
          {screen.readiness.reasons.length > 0 ? (
            <ul data-testid="contract-ready-reasons" style={{ margin: "0 0 16px", padding: "0 0 0 18px", fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }}>
              {screen.readiness.reasons.map((r) => (
                <li key={r.code} data-testid={`contract-reason-${r.code}`}>{r.message}</li>
              ))}
            </ul>
          ) : null}

          {/* Checklist -- durable, via the EXISTING sanctioned carrier/write. */}
          <div
            data-testid="contract-ready-checklist"
            style={{ padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px", marginBottom: "16px" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "8px" }}>Contract Ready checklist</div>
            <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.9 }}>
              {CONTRACT_CHECKLIST_ITEMS.map((item) => (
                <label key={item.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: checklistBusy ? "not-allowed" : "pointer" }}>
                  <input
                    type="checkbox"
                    data-testid={`contract-ready-item-${item.key}`}
                    checked={screen.checklistItems[item.key]}
                    disabled={checklistBusy !== null}
                    onChange={(e) => handleToggleChecklistItem(item.key, e.target.checked)}
                  />
                  {item.label}
                  {checklistBusy === item.key ? <Loader2 size={11} className="animate-spin" /> : null}
                </label>
              ))}
            </div>
            {checklistError ? (
              <div data-testid="contract-checklist-error" style={{ fontSize: "11px", color: "#EF4444", marginTop: "8px" }}>{checklistError}</div>
            ) : null}
            <div style={{ fontSize: "10px", color: "#475569", marginTop: "8px" }}>
              Known liens and title complications above is a disclosure-level fact only -- confirming it means the topic was discussed and disclosed, not that title has cleared. Formal title/closing verification is later, separate work and is not shown on this page.
            </div>
          </div>

          {/* One obvious next action -- a truthful status statement, never a
              button to a step (document generation, e-sign) this issue's
              own HARD NO forbids building. */}
          <div data-testid="contract-next-action" style={{ fontSize: "12px", color: "#94A3B8" }}>
            {screen.readiness.ready
              ? "Contract Ready. Sending the agreement for signature is not yet built in IAOS — no further action is available here."
              : "Complete the checklist above to reach Contract Ready."}
          </div>
        </>
      ) : null}
    </Shell>
  );
}
