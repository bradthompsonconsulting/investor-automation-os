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
 * r2 (Bones Phase 2 findings):
 *   1. Every asynchronous result is bound to the visit (contact + deal + generation) that asked for it; a result
 *      that returns after the operator moved to another deal is dropped -- deal A's answers never fill deal B.
 *   2. One save at a time (a synchronous guard, so rapid clicks cannot start two); figures identical to the
 *      latest saved calculation are not saved again; a save whose outcome was not confirmed blocks every new save
 *      on that deal until it is reconciled against GHL's notes: found (saved), impossible (a newer calculation
 *      exists or its 10-minute acceptance window has passed -- the server can never accept it), or resent
 *      deliberately as the IDENTICAL note (the server's Supersedes rule lets at most one copy land).
 *   4. Plain copy: figures typed on this page stay only on this page until saved; Save is not offered at all while
 *      the feature is off (`dealCalculationSave` runtime projection).
 *
 * Reads are the existing ones: the Seller Leads pipeline (deal picker), the contact's notes, and the selected
 * opportunity (its own ARV / Repairs / Current Offer fields, for the basis snapshot).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, Download, RefreshCw } from "lucide-react";
import { ghl, type OpportunityRow } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import { latestPropertyIdentityNoteForOpportunity } from "../lib/seller-call-readiness-carriers";
import {
  basisFromOpportunityFields, calculationsForOpportunity, calculationStaleness, formatDealCalculationNote,
  DEAL_CALCULATION_SAVED_SKEW_MS, validateDealCalculationAgainst,
  type DealCalculation, type DealCalculationAssignmentMode, type DealCalculationBasis,
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

type Evidence = { list: DealCalculation[]; latest: DealCalculation | null; basis: DealCalculationBasis; propertyIdentity: string | null; bodies: Set<string> };
/** A sent save whose outcome is not known: the exact note, so it can be found, ruled out, or resent unchanged. */
type Unconfirmed = { opportunityId: string; body: string; saved: string; supersedes: string | null };
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "newer"; latest: DealCalculation }
  | { kind: "unchanged"; at: string }
  | { kind: "unconfirmed"; checked: boolean }
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
  /* Same rule as the server boundary: an omitted customFields list is empty; malformed evidence is unreadable. */
  let basis: DealCalculationBasis;
  try { basis = basisFromOpportunityFields(opportunity.customFields === undefined ? [] : opportunity.customFields, { arv: ids.arv, repairs: ids.repairs, currentOffer: ids.currentOffer }); }
  catch { throw new Error("This deal's approved figures could not be read."); }
  const list = calculationsForOpportunity(notes, opportunityId);
  return {
    list, latest: list[0] ?? null, basis,
    propertyIdentity: latestPropertyIdentityNoteForOpportunity(notes, opportunityId)?.at ?? null,
    bodies: new Set(notes.map((n) => (typeof n?.body === "string" ? n.body : ""))),
  };
}

export function DealCalculationSavePanel({ contactId, figures, onLoad }: {
  contactId: string;
  figures: CalculatorFigures;
  onLoad: (next: CalculatorFigures) => void;
}) {
  /* r2 finding 4: never offer Save while the feature is off. Absent projection = off. */
  const saveEnabled = getRuntimeConfig().dealCalculationSave?.enabled === true;
  if (!saveEnabled) {
    return (
      <div style={PANEL} data-testid="deal-calc-save-panel">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Save Calculation to Deal</div>
        <div data-testid="deal-calc-save-disabled" style={{ fontSize: "11px", color: "#64748B" }}>
          Saving calculations to the deal in GHL is not turned on. The figures on this page stay only on this page and
          are lost if you leave or reload it.
        </div>
      </div>
    );
  }
  return <EnabledPanel contactId={contactId} figures={figures} onLoad={onLoad} />;
}

function EnabledPanel({ contactId, figures, onLoad }: { contactId: string; figures: CalculatorFigures; onLoad: (next: CalculatorFigures) => void }) {
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

  /* r2 finding 1: the visit. Bumped on every deal change; every async continuation checks it before touching state. */
  const visit = useRef(0);
  const visitDeal = useRef<string | null>(null);
  /* r2 finding 2: one save at a time, decided synchronously (state updates are too late for a double click). */
  const sending = useRef(false);
  /* r2 finding 2: unconfirmed attempts, per deal, for the life of this panel. */
  const unconfirmed = useRef(new Map<string, Unconfirmed>());

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [clean, setClean] = useState<CalculatorFigures>(figures);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [pendingLoad, setPendingLoad] = useState<DealCalculation | null>(null);
  const dirty = !sameFigures(figures, clean);

  /** Reads evidence for `opportunityId` and applies it ONLY if that visit is still current. */
  const refresh = async (opportunityId: string, myVisit: number): Promise<Evidence | null | "stale"> => {
    try {
      const ev = await readEvidence(contactId, opportunityId);
      if (myVisit !== visit.current) return "stale";
      setEvidence(ev); setEvidenceError(null);
      return ev;
    } catch (e) {
      if (myVisit !== visit.current) return "stale";
      setEvidence(null); setEvidenceError(e instanceof Error ? e.message : "Saved calculations could not be read.");
      return null;
    }
  };
  useEffect(() => {
    visit.current += 1; visitDeal.current = selected?.id ?? null;
    const myVisit = visit.current;
    setEvidence(null); setEvidenceError(null); setLoadedFrom(null); setPendingLoad(null);
    setSave(selected && unconfirmed.current.has(selected.id) ? { kind: "unconfirmed", checked: false } : { kind: "idle" });
    if (!selected) { setBasedOn(null); return; }
    const pending = unconfirmed.current.get(selected.id);
    void readEvidence(contactId, selected.id).then(
      (ev) => { if (myVisit === visit.current) { setEvidence(ev); setBasedOn(pending ? pending.supersedes : ev.latest?.saved ?? null); } },
      (e: Error) => { if (myVisit === visit.current) setEvidenceError(e.message); },
    );
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
    setClean(next); setBasedOn(c.saved); setLoadedFrom(c.saved); setPendingLoad(null);
    if (save.kind !== "unconfirmed") setSave({ kind: "idle" });
  }
  /** Load never replaces unsaved figures without asking. */
  function requestLoad(c: DealCalculation) { if (dirty) setPendingLoad(c); else applyLoad(c); }

  /** Sends exactly `body` once with a fresh request id; settles as confirmed or unconfirmed. Never decides "refused". */
  async function send(opportunityId: string, body: string): Promise<"confirmed" | "unconfirmed"> {
    try { await ghl.notes.create(contactId, body, { requestId: crypto.randomUUID() }); return "confirmed"; }
    catch { return "unconfirmed"; }
  }

  /** Reconcile an unconfirmed attempt against GHL's notes. `resend` sends the IDENTICAL note again when still possible. */
  async function reconcile(opportunityId: string, myVisit: number, resend: boolean) {
    const attempt = unconfirmed.current.get(opportunityId);
    if (!attempt || sending.current) return;
    sending.current = true;
    try {
      setSave({ kind: "saving" });
      const fresh = await refresh(opportunityId, myVisit);
      if (fresh === "stale") return;
      if (!fresh) { setSave({ kind: "unconfirmed", checked: true }); return; }
      if (fresh.bodies.has(attempt.body)) {
        unconfirmed.current.delete(opportunityId);
        setBasedOn(attempt.saved); setLoadedFrom(null); setClean(figures); setSave({ kind: "saved", at: attempt.saved });
        return;
      }
      const latestSaved = fresh.latest?.saved ?? null;
      const expired = Date.now() > new Date(attempt.saved).getTime() + DEAL_CALCULATION_SAVED_SKEW_MS;
      if (latestSaved !== attempt.supersedes || expired) {
        /* The server can never accept it now (Supersedes no longer the latest, or outside the Saved window). */
        unconfirmed.current.delete(opportunityId);
        if (fresh.latest && latestSaved !== attempt.supersedes) setSave({ kind: "newer", latest: fresh.latest });
        else setSave({ kind: "refused", message: "The earlier save did not reach GHL and can no longer be accepted. Nothing was saved. You can save again." });
        return;
      }
      if (!resend) { setSave({ kind: "unconfirmed", checked: true }); return; }
      const outcome = await send(opportunityId, attempt.body);
      if (myVisit !== visit.current) return;
      if (outcome === "confirmed") {
        unconfirmed.current.delete(opportunityId);
        setBasedOn(attempt.saved); setLoadedFrom(null); setClean(figures); setSave({ kind: "saved", at: attempt.saved });
        void refresh(opportunityId, myVisit);
      } else setSave({ kind: "unconfirmed", checked: true });
    } finally { sending.current = false; }
  }

  /** Save Calculation to Deal: the ONE write, only on an explicit click. `supersedesOverride` = Save as New. */
  async function handleSave(supersedesOverride?: string | null) {
    if (!selected || sending.current) return;
    const opportunityId = selected.id; const myVisit = visit.current;
    if (unconfirmed.current.has(opportunityId)) { setSave({ kind: "unconfirmed", checked: false }); return; }
    const arv = wholeDollars(parseAcquisitionPriceInput(figures.arvInput));
    const repairs = wholeDollars(parseNonNegativeAmountInput(figures.repairsQuickInput));
    const test = wholeDollars(parseAcquisitionPriceInput(figures.testPriceInput));
    const manual = wholeDollars(parseNonNegativeAmountInput(figures.manualAmountInput));
    if ([arv, repairs, test, manual].includes("invalid")) { setSave({ kind: "refused", message: "Fix the figures first: saved calculations keep whole-dollar amounts or blanks. Nothing was saved." }); return; }
    if (figures.repairsMode !== "quick") { setSave({ kind: "refused", message: "Itemized repairs are not saved yet. Switch Repairs to Quick number to save. Nothing was saved." }); return; }
    sending.current = true;
    try {
      setSave({ kind: "saving" });
      const supersedes = supersedesOverride === undefined ? basedOn : supersedesOverride;
      const fresh = await refresh(opportunityId, myVisit);
      if (fresh === "stale") return;
      if (!fresh) { setSave({ kind: "refused", message: "The deal could not be read, so nothing was saved." }); return; }
      const l = fresh.latest;
      if (l && l.arvInput === arv && l.repairsQuick === repairs && l.testPrice === test && l.assignmentMode === figures.assignmentMode && l.manualAmount === manual) {
        setBasedOn(l.saved); setSave({ kind: "unchanged", at: l.saved }); return;   // nothing sent
      }
      let savedMs = Date.now();
      if (l && savedMs <= new Date(l.saved).getTime()) savedMs = new Date(l.saved).getTime() + 1;
      const calc: DealCalculation = {
        opportunityId, saved: new Date(savedMs).toISOString(), operator: "brad", supersedes,
        propertyIdentity: fresh.propertyIdentity,
        arvInput: arv as number | null, repairsQuick: repairs as number | null, testPrice: test as number | null,
        assignmentMode: figures.assignmentMode, manualAmount: manual as number | null, basis: fresh.basis,
      };
      if (validateDealCalculationAgainst(calc, { latest: l, basis: fresh.basis, propertyIdentity: fresh.propertyIdentity, nowMs: Date.now() }) === "newer_calculation_exists" && l) {
        setSave({ kind: "newer", latest: l }); return;   // nothing sent
      }
      const body = formatDealCalculationNote(calc);
      /* Recorded BEFORE sending: whatever happens next, this deal is blocked until the attempt is reconciled. */
      unconfirmed.current.set(opportunityId, { opportunityId, body, saved: calc.saved, supersedes });
      const outcome = await send(opportunityId, body);
      if (outcome === "confirmed") unconfirmed.current.delete(opportunityId);
      if (myVisit !== visit.current) return;   // the operator moved on: nothing from deal A reaches deal B
      if (outcome === "confirmed") {
        setBasedOn(calc.saved); setLoadedFrom(null); setClean(figures); setSave({ kind: "saved", at: calc.saved });
        void refresh(opportunityId, myVisit);
      } else setSave({ kind: "unconfirmed", checked: false });
    } finally { sending.current = false; }
  }

  const staleOf = (c: DealCalculation) => (evidence ? calculationStaleness(c, evidence) : null);
  const blocked = save.kind === "saving" || save.kind === "unconfirmed";

  return (
    <div style={PANEL} data-testid="deal-calc-save-panel">
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Save Calculation to Deal (Test)</div>
      <div data-testid="deal-calc-save-explainer" style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>
        The figures you type stay only on this page: they are not in GHL, and they are lost if you leave or reload.
        Save Calculation to Deal stores them in GHL as a working-calculation note on the deal. Saving approves nothing:
        ARV, Repairs and Current Offer are not changed. Each save is a new note; nothing is overwritten.
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
            <button data-testid="deal-calc-save-calculation" onClick={() => void handleSave()} disabled={blocked} style={{ ...BUTTON, opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer" }}>
              {save.kind === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Calculation to Deal
            </button>
            {loadedFrom ? <span data-testid="deal-calc-loaded-from" style={{ fontSize: "11px", color: "#94A3B8" }}>Loaded the calculation saved in GHL {when(loadedFrom)} (not approved)</span> : null}
            {dirty ? <span data-testid="deal-calc-unsaved" style={{ fontSize: "11px", color: "#F59E0B" }}>Unsaved changes: only on this page, not in GHL</span> : null}
          </div>
          <div data-testid="deal-calc-save-status" data-state={save.kind} style={{ fontSize: "11px", marginTop: "6px", color: save.kind === "refused" || save.kind === "unconfirmed" ? "#EF4444" : "#94A3B8" }}>
            {save.kind === "saved" ? `Saved to GHL at ${when(save.at)} — a working calculation, not an approval.` : null}
            {save.kind === "unchanged" ? `These figures are already saved in GHL (${when(save.at)}). Nothing was saved again.` : null}
            {save.kind === "refused" ? save.message : null}
            {save.kind === "unconfirmed" ? (
              <span>
                The last save was not confirmed, so it may or may not be in GHL. No new save is possible on this deal until it is checked.{" "}
                <button data-testid="deal-calc-unconfirmed-check" onClick={() => void reconcile(selected.id, visit.current, false)} style={BUTTON}><RefreshCw size={12} /> Check GHL</button>
                {save.checked ? (
                  <>
                    {" "}Not found in GHL yet.{" "}
                    <button data-testid="deal-calc-unconfirmed-resend" onClick={() => void reconcile(selected.id, visit.current, true)} style={BUTTON}><Save size={12} /> Resend the same calculation</button>
                  </>
                ) : null}
              </span>
            ) : null}
            {save.kind === "newer" ? (
              <span>
                A newer calculation is already saved in GHL ({when(save.latest.saved)}). Nothing was saved.{" "}
                <button data-testid="deal-calc-newer-load" onClick={() => requestLoad(save.latest)} style={BUTTON}><Download size={12} /> Load Newer</button>{" "}
                <button data-testid="deal-calc-save-as-new" onClick={() => void handleSave(save.latest.saved)} style={BUTTON}><Save size={12} /> Save as New</button>
              </span>
            ) : null}
          </div>

          {pendingLoad ? (
            <div data-testid="deal-calc-load-confirm-box" style={{ fontSize: "11px", color: "#F59E0B", marginTop: "8px" }}>
              Replace the unsaved figures on this page with the calculation saved in GHL {when(pendingLoad.saved)}?{" "}
              <button data-testid="deal-calc-load-confirm" onClick={() => applyLoad(pendingLoad)} style={BUTTON}>Replace</button>{" "}
              <button data-testid="deal-calc-load-cancel" onClick={() => setPendingLoad(null)} style={BUTTON}>Keep mine</button>
            </div>
          ) : null}

          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", margin: "12px 0 6px" }}>Calculations saved in GHL for this deal</div>
          {evidenceError ? <div data-testid="deal-calc-saved-read-error" style={{ color: "#EF4444", fontSize: "11px" }}>{evidenceError}</div> : null}
          {evidence && evidence.list.length === 0 ? <div data-testid="deal-calc-saved-empty" style={{ fontSize: "11px", color: "#64748B" }}>No calculation is saved in GHL for this deal yet.</div> : null}
          {evidence && evidence.list.length > 0 ? (
            <div data-testid="deal-calc-saved-list" data-deal={selected.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {evidence.list.map((c, i) => {
                const s = staleOf(c);
                return (
                  <div key={c.saved} data-testid={`deal-calc-saved-item-${i}`} data-deal={c.opportunityId} style={{ fontSize: "11px", color: "#CBD5E1", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
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
