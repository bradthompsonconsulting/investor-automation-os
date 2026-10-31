/**
 * B15-25 Phase 2 -- "Save Calculation to Deal" / "Load Saved Calculation" (INV-133).
 *
 * Jess RULING 2026-10-30, Captain approved P2-1..P2-5:
 *   1. append-only, structured GHL calculation notes (deal-calculation-carrier.ts);
 *   2. ONE explicitly authorized write surface -- this panel's single `ghl.notes.create` -- Test only;
 *   3. the existing opportunity picker (`selectOpportunity`, PB-D55: more than one deal needs an explicit choice);
 *   4. figures and modes only (ARV, quick repairs, test price, assignment mode, manual amount); itemized repairs later;
 *   5. a stale save is refused -- the operator chooses Load Newer or Save as New. Nothing is ever overwritten.
 *
 * A saved calculation is NEVER an approval. This panel does not approve ARV or repairs, does not set or change
 * Current Offer, and writes nothing but the one Deal Calculation note, only when the operator presses Save. No
 * autosave, no write on typing or navigation. The server (`write-note-guard.ts`) re-checks every rule before
 * anything is sent and refuses while the committed switch is DISABLED.
 *
 * Reads are the existing ones: the Seller Leads pipeline (deal picker), the contact's notes, and the selected
 * opportunity (its own ARV / Repairs / Current Offer fields, for the basis snapshot).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Download } from "lucide-react";
import { ghl, type OpportunityRow } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import { latestPropertyIdentityNoteForOpportunity } from "../lib/seller-call-readiness-carriers";
import {
  basisFromOpportunityFields, calculationsForOpportunity, calculationStaleness, formatDealCalculationNote,
  validateDealCalculationAgainst, type DealCalculation, type DealCalculationAssignmentMode, type DealCalculationBasis,
} from "../lib/deal-calculation-carrier";
import { parseNonNegativeAmountInput } from "../lib/deal-calculator-inputs";
import { parseAcquisitionPriceInput } from "../lib/seller-call-negotiation";

/** The figures and modes this phase saves and loads. Strings exactly as the calculator holds them. */
export type CalculatorFigures = {
  arvInput: string;
  repairsQuickInput: string;
  testPriceInput: string;
  assignmentMode: DealCalculationAssignmentMode;
  manualAmountInput: string;
  repairsMode: "quick" | "detailed";
};

type Evidence = { list: DealCalculation[]; latest: DealCalculation | null; basis: DealCalculationBasis; propertyIdentity: string | null };
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "newer"; latest: DealCalculation }
  | { kind: "refused"; message: string };

const PANEL: React.CSSProperties = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px", padding: "14px 16px", marginTop: "16px" };
const BUTTON: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "6px", border: "1px solid #334155", background: "#1B2433", color: "#F5F7FA", fontSize: "12px", cursor: "pointer" };
const money = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("en-US")}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const sameFigures = (a: CalculatorFigures, b: CalculatorFigures) => JSON.stringify(a) === JSON.stringify(b);

/** A figure for the note: whole dollars or blank; anything else blocks the save (never rounded silently). */
function wholeDollars(parsed: { kind: string; value?: number }): number | null | "invalid" {
  if (parsed.kind === "empty") return null;
  if (parsed.kind !== "value" || typeof parsed.value !== "number" || !Number.isSafeInteger(parsed.value)) return "invalid";
  return parsed.value;
}

async function readEvidence(contactId: string, opportunityId: string): Promise<Evidence> {
  const ids = getRuntimeConfig().opportunityFacts;
  const [notesRes, oppRes] = await Promise.all([ghl.notes.list(contactId), ghl.opportunities.get(opportunityId)]);
  const notes = Array.isArray(notesRes?.notes) ? notesRes.notes : null;
  if (!notes) throw new Error("Saved calculations could not be read.");
  const opportunity = oppRes?.opportunity ?? oppRes;
  if (!opportunity || opportunity.contactId !== contactId) throw new Error("This deal could not be confirmed for the linked contact.");
  /* Same rule as the server boundary: an omitted customFields list is empty; any other non-array is unreadable. */
  const fields = opportunity.customFields === undefined ? [] : opportunity.customFields;
  if (!Array.isArray(fields)) throw new Error("This deal's approved figures could not be read.");
  const list = calculationsForOpportunity(notes, opportunityId);
  return {
    list,
    latest: list[0] ?? null,
    basis: basisFromOpportunityFields(fields, { arv: ids.arv, repairs: ids.repairs, currentOffer: ids.currentOffer }),
    propertyIdentity: latestPropertyIdentityNoteForOpportunity(notes, opportunityId)?.at ?? null,
  };
}

export function DealCalculationSavePanel({ contactId, figures, onLoad }: {
  contactId: string;
  figures: CalculatorFigures;
  onLoad: (next: CalculatorFigures) => void;
}) {
  /* Deal picker -- the existing pipeline read and the ONE selection rule (PB-D55). */
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [oppsError, setOppsError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOpps(null); setOppsError(null); setChosenId(null);
    ghl.opportunities.listPipeline()
      .then((p) => { if (!cancelled) setOpps(opportunitiesForContact(p.opportunities, contactId)); })
      .catch((e: Error) => { if (!cancelled) setOppsError(e.message); });
    return () => { cancelled = true; };
  }, [contactId]);
  const candidates = useMemo(() => opportunityCandidates(opps), [opps]);
  const selected = useMemo(() => selectOpportunity(candidates, chosenId), [candidates, chosenId]);

  /* Evidence for the selected deal; what this view's figures are based on (Supersedes). */
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [clean, setClean] = useState<CalculatorFigures>(figures);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [pendingLoad, setPendingLoad] = useState<DealCalculation | null>(null);
  const dirty = !sameFigures(figures, clean);

  const refresh = async (opportunityId: string): Promise<Evidence | null> => {
    try {
      const ev = await readEvidence(contactId, opportunityId);
      setEvidence(ev); setEvidenceError(null);
      return ev;
    } catch (e) {
      setEvidence(null); setEvidenceError(e instanceof Error ? e.message : "Saved calculations could not be read.");
      return null;
    }
  };
  useEffect(() => {
    setEvidence(null); setEvidenceError(null); setLoadedFrom(null); setSave({ kind: "idle" }); setPendingLoad(null);
    if (!selected) { setBasedOn(null); return; }
    let cancelled = false;
    void readEvidence(contactId, selected.id).then(
      (ev) => { if (!cancelled) { setEvidence(ev); setBasedOn(ev.latest?.saved ?? null); } },
      (e: Error) => { if (!cancelled) setEvidenceError(e.message); },
    );
    return () => { cancelled = true; };
  }, [contactId, selected?.id]);

  function applyLoad(c: DealCalculation) {
    const next: CalculatorFigures = {
      arvInput: c.arvInput === null ? "" : String(c.arvInput),
      repairsQuickInput: c.repairsQuick === null ? "" : String(c.repairsQuick),
      testPriceInput: c.testPrice === null ? "" : String(c.testPrice),
      assignmentMode: c.assignmentMode,
      manualAmountInput: c.manualAmount === null ? "" : String(c.manualAmount),
      repairsMode: "quick",
    };
    onLoad(next);
    setClean(next); setBasedOn(c.saved); setLoadedFrom(c.saved); setPendingLoad(null); setSave({ kind: "idle" });
  }
  /** Load never replaces unsaved figures without asking. */
  function requestLoad(c: DealCalculation) { if (dirty) setPendingLoad(c); else applyLoad(c); }

  /** Save Calculation to Deal: the ONE write, only on this explicit click. `supersedes` overrides for Save as New. */
  async function handleSave(supersedesOverride?: string | null) {
    if (!selected || save.kind === "saving") return;
    const arv = wholeDollars(parseAcquisitionPriceInput(figures.arvInput));
    const repairs = wholeDollars(parseNonNegativeAmountInput(figures.repairsQuickInput));
    const test = wholeDollars(parseAcquisitionPriceInput(figures.testPriceInput));
    const manual = wholeDollars(parseNonNegativeAmountInput(figures.manualAmountInput));
    if ([arv, repairs, test, manual].includes("invalid")) { setSave({ kind: "refused", message: "Fix the figures first: saved calculations keep whole-dollar amounts or blanks. Nothing was saved." }); return; }
    if (figures.repairsMode !== "quick") { setSave({ kind: "refused", message: "Itemized repairs are not saved yet. Switch Repairs to Quick number to save. Nothing was saved." }); return; }
    setSave({ kind: "saving" });
    const supersedes = supersedesOverride === undefined ? basedOn : supersedesOverride;
    const fresh = await refresh(selected.id);
    if (!fresh) { setSave({ kind: "refused", message: "The deal could not be read, so nothing was saved." }); return; }
    let savedMs = Date.now();
    if (fresh.latest && savedMs <= new Date(fresh.latest.saved).getTime()) savedMs = new Date(fresh.latest.saved).getTime() + 1;
    const calc: DealCalculation = {
      opportunityId: selected.id, saved: new Date(savedMs).toISOString(), operator: "brad", supersedes,
      propertyIdentity: fresh.propertyIdentity,
      arvInput: arv as number | null, repairsQuick: repairs as number | null, testPrice: test as number | null,
      assignmentMode: figures.assignmentMode, manualAmount: manual as number | null, basis: fresh.basis,
    };
    if (validateDealCalculationAgainst(calc, { latest: fresh.latest, basis: fresh.basis, propertyIdentity: fresh.propertyIdentity, nowMs: Date.now() }) === "newer_calculation_exists" && fresh.latest) {
      setSave({ kind: "newer", latest: fresh.latest });   // nothing sent
      return;
    }
    try {
      await ghl.notes.create(contactId, formatDealCalculationNote(calc));
      setBasedOn(calc.saved); setLoadedFrom(null); setClean(figures); setSave({ kind: "saved", at: calc.saved });
      void refresh(selected.id);
    } catch (e) {
      const after = await refresh(selected.id);
      if (after?.latest && after.latest.saved !== supersedes && after.latest.saved !== calc.saved) setSave({ kind: "newer", latest: after.latest });
      else setSave({ kind: "refused", message: `${e instanceof Error ? e.message : "The save was refused."} Nothing was saved unless the list below shows it.` });
    }
  }

  const staleOf = (c: DealCalculation) => (evidence ? calculationStaleness(c, evidence) : null);

  return (
    <div style={PANEL} data-testid="deal-calc-save-panel">
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Save Calculation to Deal (Test)</div>
      <div data-testid="deal-calc-save-explainer" style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>
        Saves these figures and modes to the deal as a working calculation note in GHL. It is not an approval: it does not
        approve ARV or Repairs and does not change Current Offer. Each save is a new note; nothing is overwritten.
      </div>

      {oppsError ? <div data-testid="deal-calc-deal-error" style={{ color: "#EF4444", fontSize: "11px" }}>Deals could not be read: {oppsError}</div> : null}
      {opps === null && !oppsError ? <div style={{ fontSize: "11px", color: "#64748B" }}><Loader2 size={11} className="animate-spin" /> Loading deals…</div> : null}
      {opps !== null && candidates.length === 0 ? <div data-testid="deal-calc-no-deal" style={{ fontSize: "11px", color: "#F59E0B" }}>This contact has no deal, so a calculation cannot be saved.</div> : null}
      {candidates.length > 1 ? (
        <label style={{ fontSize: "11px", color: "#94A3B8", display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
          Deal
          <select data-testid="deal-calc-deal-select" value={chosenId ?? ""} onChange={(e) => setChosenId(e.target.value || null)}
            style={{ background: "#1B2433", color: "#F5F7FA", border: "1px solid #334155", borderRadius: "6px", padding: "4px 6px", fontSize: "12px" }}>
            <option value="">Choose a deal…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      ) : null}
      {selected ? <div data-testid="deal-calc-deal-selected" style={{ fontSize: "12px", color: "#E2E8F0", marginBottom: "8px" }}>Deal: {selected.name}</div> : null}

      {selected ? (
        <>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button data-testid="deal-calc-save-calculation" onClick={() => void handleSave()} disabled={save.kind === "saving"} style={{ ...BUTTON, opacity: save.kind === "saving" ? 0.5 : 1 }}>
              {save.kind === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Calculation to Deal
            </button>
            {loadedFrom ? <span data-testid="deal-calc-loaded-from" style={{ fontSize: "11px", color: "#94A3B8" }}>Loaded calculation from {when(loadedFrom)} (not approved)</span> : null}
            {dirty ? <span data-testid="deal-calc-unsaved" style={{ fontSize: "11px", color: "#F59E0B" }}>Unsaved changes</span> : null}
          </div>
          <div data-testid="deal-calc-save-status" data-state={save.kind} style={{ fontSize: "11px", marginTop: "6px", color: save.kind === "refused" ? "#EF4444" : "#94A3B8" }}>
            {save.kind === "saved" ? `Saved to deal at ${when(save.at)} — working calculation, not an approval.` : null}
            {save.kind === "refused" ? save.message : null}
            {save.kind === "newer" ? (
              <span>
                A newer saved calculation exists ({when(save.latest.saved)}). Nothing was saved.{" "}
                <button data-testid="deal-calc-newer-load" onClick={() => requestLoad(save.latest)} style={BUTTON}><Download size={12} /> Load Newer</button>{" "}
                <button data-testid="deal-calc-save-as-new" onClick={() => void handleSave(save.latest.saved)} style={BUTTON}><Save size={12} /> Save as New</button>
              </span>
            ) : null}
          </div>

          {pendingLoad ? (
            <div data-testid="deal-calc-load-confirm-box" style={{ fontSize: "11px", color: "#F59E0B", marginTop: "8px" }}>
              Replace your unsaved figures with the calculation saved {when(pendingLoad.saved)}?{" "}
              <button data-testid="deal-calc-load-confirm" onClick={() => applyLoad(pendingLoad)} style={BUTTON}>Replace</button>{" "}
              <button data-testid="deal-calc-load-cancel" onClick={() => setPendingLoad(null)} style={BUTTON}>Keep mine</button>
            </div>
          ) : null}

          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", margin: "12px 0 6px" }}>Saved calculations</div>
          {evidenceError ? <div data-testid="deal-calc-saved-read-error" style={{ color: "#EF4444", fontSize: "11px" }}>{evidenceError}</div> : null}
          {evidence && evidence.list.length === 0 ? <div data-testid="deal-calc-saved-empty" style={{ fontSize: "11px", color: "#64748B" }}>No saved calculation for this deal yet.</div> : null}
          {evidence && evidence.list.length > 0 ? (
            <div data-testid="deal-calc-saved-list" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {evidence.list.map((c, i) => {
                const s = staleOf(c);
                return (
                  <div key={c.saved} data-testid={`deal-calc-saved-item-${i}`} style={{ fontSize: "11px", color: "#CBD5E1", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <span>{when(c.saved)}{i === 0 ? " (latest)" : ""}</span>
                    <span>ARV {money(c.arvInput)} · Repairs {money(c.repairsQuick)} · Test price {money(c.testPrice)} · {c.assignmentMode}{c.assignmentMode === "manual" ? ` ${money(c.manualAmount)}` : ""}</span>
                    {s?.arv ? <span data-testid={`deal-calc-stale-arv-${i}`} style={{ color: "#F59E0B" }}>approved ARV changed since</span> : null}
                    {s?.repairs ? <span data-testid={`deal-calc-stale-repairs-${i}`} style={{ color: "#F59E0B" }}>approved repairs changed since</span> : null}
                    {s?.currentOffer ? <span data-testid={`deal-calc-stale-offer-${i}`} style={{ color: "#F59E0B" }}>Current Offer changed since</span> : null}
                    {s?.property ? <span data-testid={`deal-calc-stale-property-${i}`} style={{ color: "#F59E0B" }}>saved for an earlier property identity</span> : null}
                    <button data-testid={`deal-calc-load-${i}`} onClick={() => requestLoad(c)} style={BUTTON}><Download size={12} /> Load</button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
