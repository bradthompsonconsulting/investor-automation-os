import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Calculator, Search, X } from "lucide-react";
import repairBidSheet from "../data/repair_bid_sheet.json";
import { ghl, type ContactRow, type OpportunityRow } from "../lib/ghl";

/**
 * MAO Deal Calculator — standalone by design (docs/specs/mao_calculator_spec.md §0).
 * Phases 2-4: page shell, Deal Summary header, Wholesale + Flip sections, shared
 * repair estimator. Zero GHL involvement — pure client-side calculation.
 * Phase 5: GHL search + prepopulate (this pass). Save (Phase 6) and the
 * Contacts/Pipeline handoff button (Phase 7) come next.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

type Num = number | "";
type FinancingType = "cash" | "hard_money" | "private_money";

interface RepairItem { label: string; unit: string; cost: number; note?: string }
interface RepairCategory { name: string; items: RepairItem[] }

const CATEGORIES = repairBidSheet.categories as RepairCategory[];
const FUDGE_FACTOR = 1 + (repairBidSheet._meta.fudge_factor_pct as number) / 100;

// Known SOURCE custom field IDs (spec §1) — read FROM these for prepopulate,
// never written to. Opportunity-side only; the old Wholesale Fee %/Closing
// Costs/MAO/Viability Flag fields belonged to the dropped §2a formula and
// have no home in the new model, so they're intentionally not read here.
const SOURCE_FIELD_IDS = {
  arv:                 "cBkygqcHRseZUGCYYeba",
  assignmentFeeTarget: "xwbPw1JVkgJevJTPNmxa",
  repairEstimate:      "hId4Yog6u5GP1Iwz1aNx",
};

// offer_ fields (Phase 1) — created on BOTH Contact and Opportunity, same 7
// field names, different IDs per model. Opportunity-side is read for
// prepopulate (preferred over the source fields above when present, since
// they reflect the last actual saved calculator state). Save (Phase 6)
// writes both sides, overwriting each save — no history, latest only.
const OFFER_FIELD_IDS = {
  opportunity: {
    offer_price:         "4YiACDV4uB3zOlAdNIBb",
    offer_mao:           "9jm2SoN2aDtUtbesL0kG",
    offer_wholesale_fee: "GxChepYArmgPllhKPq0R",
    offer_repair_total:  "XbW0B973nuaLtIjMkzO9",
    offer_margin:        "eY5BOqE9juGpBfqwacWT",
    offer_arv:           "Nm1LZvQzaCGvXDq7TRCh",
    offer_date:          "73oLHWnVjmOGSrBo5sC6",
  },
  contact: {
    offer_price:         "v2VO2wUwTYRojmU7VXyZ",
    offer_mao:           "aAMFPmgxGZT422uGAQOx",
    offer_wholesale_fee: "qYzkp66x87rG7Pbs36GP",
    offer_repair_total:  "2EpRGXb8rj4RtHfFhYbB",
    offer_margin:        "ec06A3RId4Isorc97jeQ",
    offer_arv:           "Z88Y6IqCK1i7hObZcrQM",
    offer_date:          "SJ6x7OqUxTKg1ri8ltb7",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────────

function n(v: Num): number {
  return v === "" ? 0 : v;
}

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(v);
}

function fmtPct(v: number | null, digits = 1): string {
  return v === null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function parseInput(raw: string): Num {
  return raw === "" ? "" : parseFloat(raw);
}

// GHL's opportunity customFields shape varies by field dataType — NUMERICAL/DATE
// fields come back as fieldValueNumber/fieldValueDate rather than value/fieldValue
// (confirmed live; not just the value/fieldValue pair the rest of the repo assumes).
function cfRaw(cf: OpportunityRow["customFields"], id: string): unknown {
  const f = cf.find((x) => x.id === id) as any;
  if (!f) return null;
  return f.value ?? f.fieldValue ?? f.fieldValueNumber ?? f.fieldValueString ?? f.fieldValueDate ?? null;
}

function cfNum(cf: OpportunityRow["customFields"], id: string): number | null {
  const raw = cfRaw(cf, id);
  if (raw === null || raw === undefined || raw === "") return null;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  return isNaN(num) ? null : num;
}

function cfText(cf: OpportunityRow["customFields"], id: string): string | null {
  const raw = cfRaw(cf, id);
  if (raw === null || raw === undefined) return null;
  // fieldValueDate is a unix-ms timestamp number, not a string
  if (typeof raw === "number") return new Date(raw).toISOString();
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

// ── Shared field atoms ───────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: "10px", color: "#334155" }}>{hint}</span>}
    </div>
  );
}

function NumInput({
  value, onChange, placeholder, prefix, suffix, disabled,
}: {
  value: Num; onChange: (v: Num) => void; placeholder?: string; prefix?: string; suffix?: string; disabled?: boolean;
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      {prefix && (
        <span style={{ position: "absolute", left: "10px", fontSize: "13px", color: "#475569", pointerEvents: "none" }}>
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        placeholder={placeholder ?? "0"}
        disabled={disabled}
        onChange={(e) => onChange(parseInput(e.target.value))}
        style={{
          width: "100%", background: disabled ? "#07142E" : "#0A0E1A",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px",
          color: disabled ? "#475569" : "#F1F5F9", fontSize: "13px",
          padding: `8px ${suffix ? "26px" : "10px"} 8px ${prefix ? "22px" : "10px"}`,
          cursor: disabled ? "not-allowed" : "text",
        }}
      />
      {suffix && (
        <span style={{ position: "absolute", right: "10px", fontSize: "13px", color: "#475569", pointerEvents: "none" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function ReadonlyValue({ value }: { value: string }) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)", color: "#94A3B8", fontSize: "13px",
      fontFamily: "Space Grotesk, monospace",
    }}>
      {value}
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
      padding: "18px 20px", marginBottom: "16px",
    }}>
      <div style={{ marginBottom: "14px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
          {title}
        </h2>
        {subtitle && <p style={{ fontSize: "11px", color: "#334155", margin: "3px 0 0" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const GRID_STYLE: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px",
};

// ── Search & Link Contact (Phase 5) ──────────────────────────────────────────────
// Purely additive to the standalone calc — search/select only ever fills fields
// or links a contact; it never creates one (spec §0: no "Create New Contact").

function ContactLinkPanel({
  query, onQueryChange, results, onSelect, error,
  linked, onUnlink, lastSavedDate,
  pendingContact, onConfirmOverwrite,
  onSave, saving, saveError, justSaved,
}: {
  query: string; onQueryChange: (q: string) => void;
  results: ContactRow[]; onSelect: (c: ContactRow) => void; error: string | null;
  linked: { id: string; name: string; address: string } | null; onUnlink: () => void;
  lastSavedDate: string | null;
  pendingContact: ContactRow | null; onConfirmOverwrite: (yes: boolean) => void;
  onSave: () => void; saving: boolean; saveError: string | null; justSaved: boolean;
}) {
  if (pendingContact) {
    const name = `${pendingContact.firstName} ${pendingContact.lastName}`.trim() || "this contact";
    return (
      <SectionCard title="Load Saved Info?">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "#F1F5F9" }}>
            Load {name}'s saved info into the calculator? Typed values stay put — only fields the contact
            actually has data for get filled.
          </span>
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <button
              onClick={() => onConfirmOverwrite(true)}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "7px 14px", borderRadius: "6px",
                border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.12)", color: "#22C55E", cursor: "pointer",
              }}
            >
              Yes, load
            </button>
            <button
              onClick={() => onConfirmOverwrite(false)}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "7px 14px", borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#64748B", cursor: "pointer",
              }}
            >
              No, just link
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (linked) {
    return (
      <SectionCard title="Linked Contact">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#F1F5F9" }}>{linked.name}</div>
            {linked.address && <div style={{ fontSize: "12px", color: "#64748B" }}>{linked.address}</div>}
            {lastSavedDate && (
              <div style={{ fontSize: "11px", color: "#334155", marginTop: "4px" }}>
                Last saved {new Date(lastSavedDate).toLocaleDateString(undefined, { timeZone: "UTC" })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {justSaved && <span style={{ fontSize: "12px", color: "#22C55E" }}>Saved ✓</span>}
            {saveError && <span style={{ fontSize: "11px", color: "#F87171" }}>{saveError}</span>}
            <button
              onClick={onSave}
              disabled={saving}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "7px 14px", borderRadius: "6px",
                border: "1px solid rgba(30,200,255,0.4)", background: "rgba(30,200,255,0.12)",
                color: "#1EC8FF", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save Offer to GHL"}
            </button>
            <button
              onClick={onUnlink}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600,
                padding: "7px 12px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent", color: "#64748B", cursor: "pointer",
              }}
            >
              <X size={12} /> Unlink
            </button>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Search & Link Contact" subtitle="Optional — the calculator works fully without a linked contact.">
      <div style={{ position: "relative" }}>
        <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by seller name or property address…"
          style={{
            width: "100%", background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px",
            color: "#F1F5F9", fontSize: "13px", padding: "9px 12px 9px 34px",
          }}
        />
      </div>
      {error && <p style={{ fontSize: "11px", color: "#F87171", margin: "8px 0 0" }}>{error}</p>}
      {results.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              style={{
                textAlign: "left", padding: "8px 10px", borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.08)", background: "#0A0E1A", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "13px", color: "#F1F5F9" }}>{c.firstName} {c.lastName}</div>
              <div style={{ fontSize: "11px", color: "#64748B" }}>
                {[c.address1, c.city].filter(Boolean).join(", ")}{c.phone && ` · ${c.phone}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── Deal Summary header ──────────────────────────────────────────────────────────

function DealSummaryHeader({
  offerToSeller, onOfferChange, assignmentFee, arvN, buyerProfit,
}: {
  offerToSeller: Num; onOfferChange: (v: Num) => void; assignmentFee: number;
  arvN: number; buyerProfit: number;
}) {
  const profitPositive = buyerProfit >= 0;
  return (
    <div style={{
      background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
      padding: "20px 22px", marginBottom: "16px",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "18px", alignItems: "start" }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            Offer to Seller
          </div>
          <NumInput value={offerToSeller} onChange={onOfferChange} prefix="$" placeholder="0" />
          <div style={{ fontSize: "10px", color: "#334155", marginTop: "4px" }}>Defaults to MAO — clear to resync</div>
        </div>

        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            Assignment Fee
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#F1F5F9", fontFamily: "Space Grotesk, monospace", padding: "6px 0" }}>
            {fmtCurrency(assignmentFee)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            Total Potential Resale
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#F1F5F9", fontFamily: "Space Grotesk, monospace", padding: "6px 0" }}>
            {fmtCurrency(arvN)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            Buyer's Expected Profit
          </div>
          <div style={{
            fontSize: "26px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", padding: "6px 0",
            color: profitPositive ? "#22C55E" : "#EF4444",
          }}>
            {fmtCurrency(buyerProfit)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section A — Wholesale (buyer-profit-first MAO) ──────────────────────────────

function MetricGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px",
      margin: "14px 0", padding: "12px 14px", borderRadius: "8px",
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {items.map((it) => (
        <div key={it.label}>
          <div style={{ fontSize: "10px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>
            {it.label}
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: it.color ?? "#F1F5F9", fontFamily: "Space Grotesk, monospace" }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasonablenessBadge({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const color = ok === null ? "#475569" : ok ? "#22C55E" : "#EF4444";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "8px",
      background: `${color}0F`, border: `1px solid ${color}33`,
    }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: "12px", color: "#94A3B8" }}>{label}</span>
      {detail && <span style={{ fontSize: "11px", color: "#475569", marginLeft: "auto", fontFamily: "monospace" }}>{detail}</span>}
    </div>
  );
}

function WholesaleSection({
  arv, setArv, askingPrice, setAskingPrice,
  sellingHolding, setSellingHolding,
  buyerProfitMode, buyerProfitInput, setBuyerProfitInput, onToggleBuyerProfitMode, buyerProfitDollarN,
  assignmentFeeTarget, setAssignmentFeeTarget, feeFloor, setFeeFloor, actualAssignmentFee,
  repairTotal, mao, buyerPurchasePrice, buyerExpectedProfit, buyerROI, profitMargin, spreadPct, assignmentPctOfContract,
  feeFloorOk, feeVsProfitOk, buyerReturnOk,
}: {
  arv: Num; setArv: (v: Num) => void;
  askingPrice: Num; setAskingPrice: (v: Num) => void;
  sellingHolding: Num; setSellingHolding: (v: Num) => void;
  buyerProfitMode: "$" | "%"; buyerProfitInput: Num; setBuyerProfitInput: (v: Num) => void;
  onToggleBuyerProfitMode: () => void; buyerProfitDollarN: number;
  assignmentFeeTarget: Num; setAssignmentFeeTarget: (v: Num) => void;
  feeFloor: Num; setFeeFloor: (v: Num) => void; actualAssignmentFee: number;
  repairTotal: number; mao: number; buyerPurchasePrice: number; buyerExpectedProfit: number;
  buyerROI: number | null; profitMargin: number | null; spreadPct: number | null; assignmentPctOfContract: number | null;
  feeFloorOk: boolean | null; feeVsProfitOk: boolean | null; buyerReturnOk: boolean | null;
}) {
  const profitPositive = buyerExpectedProfit >= 0;
  return (
    <SectionCard title="Section A — Wholesale" subtitle="Buyer-profit-first MAO. Drives the header Offer to Seller default.">
      <div style={{ ...GRID_STYLE, marginBottom: "16px" }}>
        <Field label="ARV — After Repair Value">
          <NumInput value={arv} onChange={setArv} prefix="$" />
        </Field>
        <Field label="Asking Price" hint="Reference only — not used in formulas">
          <NumInput value={askingPrice} onChange={setAskingPrice} prefix="$" />
        </Field>
        <Field label="Rehab" hint="From estimator below">
          <ReadonlyValue value={fmtCurrency(repairTotal)} />
        </Field>
        <Field label="Selling / Holding Costs" hint="Simplified lump-sum for this MAO calc">
          <NumInput value={sellingHolding} onChange={setSellingHolding} prefix="$" />
        </Field>
        <Field label="Assignment Fee Target">
          <NumInput value={assignmentFeeTarget} onChange={setAssignmentFeeTarget} prefix="$" placeholder="5000" />
        </Field>
        <Field label="Minimum Assignment Fee" hint="Floor — fee is whichever is higher">
          <NumInput value={feeFloor} onChange={setFeeFloor} prefix="$" placeholder="5000" />
        </Field>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "6px" }}>
          Target Buyer Profit
        </label>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ maxWidth: "220px" }}>
            <NumInput
              value={buyerProfitInput}
              onChange={setBuyerProfitInput}
              prefix={buyerProfitMode === "$" ? "$" : undefined}
              suffix={buyerProfitMode === "%" ? "%" : undefined}
            />
          </div>
          <button
            onClick={onToggleBuyerProfitMode}
            style={{
              fontSize: "11px", fontWeight: 600, padding: "8px 12px", borderRadius: "6px",
              border: "1px solid rgba(30,200,255,0.3)", background: "transparent", color: "#1EC8FF", cursor: "pointer",
            }}
          >
            Switch to {buyerProfitMode === "$" ? "% of ARV" : "$"}
          </button>
          <span style={{ fontSize: "11px", color: "#475569" }}>= {fmtCurrency(buyerProfitDollarN)}</span>
        </div>
      </div>

      <div style={{
        padding: "14px 16px", borderRadius: "8px", marginBottom: "6px",
        background: "rgba(30,200,255,0.05)", border: "1px solid rgba(30,200,255,0.2)",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Seller Offer (MAO)
        </div>
        <div style={{ fontSize: "26px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#1EC8FF" }}>
          {fmtCurrency(mao)}
        </div>
      </div>

      <MetricGrid items={[
        { label: "Assignment Fee", value: fmtCurrency(actualAssignmentFee) },
        { label: "Buyer Purchase Price", value: fmtCurrency(buyerPurchasePrice) },
        { label: "Buyer Expected Profit", value: fmtCurrency(buyerExpectedProfit), color: profitPositive ? "#22C55E" : "#EF4444" },
        { label: "Buyer ROI", value: fmtPct(buyerROI), color: profitPositive ? "#22C55E" : "#EF4444" },
        { label: "Profit Margin", value: fmtPct(profitMargin), color: profitPositive ? "#22C55E" : "#EF4444" },
        { label: "Wholesaler Spread %", value: fmtPct(spreadPct) },
        { label: "Assignment % of Contract", value: fmtPct(assignmentPctOfContract) },
      ]} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
        <ReasonablenessBadge label="Assignment fee ≥ $5,000" ok={feeFloorOk} detail={fmtCurrency(actualAssignmentFee)} />
        <ReasonablenessBadge
          label="Fee ≤ 25% of buyer profit"
          ok={feeVsProfitOk}
          detail={buyerProfitDollarN > 0 ? fmtPct(actualAssignmentFee / buyerProfitDollarN) : "—"}
        />
        <ReasonablenessBadge label="Buyer meets target profit" ok={buyerReturnOk} detail={fmtCurrency(buyerExpectedProfit)} />
      </div>
    </SectionCard>
  );
}

// ── Repair Estimator (shared, Phase 4) ───────────────────────────────────────────

function CategoryAccordion({
  category, ci, quantities, onQtyChange,
}: {
  category: RepairCategory; ci: number; quantities: Record<string, number>; onQtyChange: (key: string, qty: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const subtotal = category.items.reduce((s, item, ii) => s + (quantities[`${ci}-${ii}`] ?? 0) * item.cost, 0);

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", marginBottom: "8px", overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px",
          cursor: "pointer", background: "#07142E", userSelect: "none",
        }}
      >
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9" }}>{category.name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", color: subtotal > 0 ? "#1EC8FF" : "#334155", fontFamily: "Space Grotesk, monospace" }}>
            {fmtCurrency(subtotal)}
          </span>
          <ChevronDown size={14} style={{ color: "#64748B", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </div>
      </div>
      {open && (
        <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.015)" }}>
          {category.items.map((item, ii) => {
            const key = `${ci}-${ii}`;
            const qty = quantities[key] ?? 0;
            return (
              <div
                key={key}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 70px 90px 90px", gap: "10px", alignItems: "center",
                  padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <span style={{ fontSize: "12px", color: "#94A3B8" }}>{item.label}</span>
                <input
                  type="number"
                  value={qty || ""}
                  placeholder="0"
                  onChange={(e) => onQtyChange(key, parseFloat(e.target.value) || 0)}
                  style={{
                    width: "100%", background: "#0A0E1A", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "5px", color: "#F1F5F9", fontSize: "12px", padding: "5px 7px",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#475569" }}>{fmtCurrency(item.cost)}/{item.unit}</span>
                <span style={{ fontSize: "12px", color: "#F1F5F9", textAlign: "right", fontFamily: "Space Grotesk, monospace" }}>
                  {fmtCurrency(qty * item.cost)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RepairEstimator({
  mode, setMode, quickValue, setQuickValue, quantities, setQuantities, granularRaw, repairTotal,
}: {
  mode: "quick" | "granular"; setMode: (m: "quick" | "granular") => void;
  quickValue: Num; setQuickValue: (v: Num) => void;
  quantities: Record<string, number>; setQuantities: (fn: (q: Record<string, number>) => Record<string, number>) => void;
  granularRaw: number; repairTotal: number;
}) {
  function onQtyChange(key: string, qty: number) {
    setQuantities((q) => ({ ...q, [key]: qty }));
  }

  return (
    <SectionCard title="Repair Estimate" subtitle="Feeds both the Wholesale MAO and the Flip Analysis below — one total, no double-count.">
      <div style={{ display: "flex", alignItems: "flex-end", gap: "16px", flexWrap: "wrap", marginBottom: "10px" }}>
        <div style={{ flex: "1", minWidth: "200px" }}>
          <Field label="Total Repair Estimate" hint={mode === "granular" ? "Itemized total is driving repair_total" : undefined}>
            <NumInput
              value={quickValue}
              onChange={setQuickValue}
              prefix="$"
              disabled={mode === "granular"}
            />
          </Field>
        </div>
        <button
          onClick={() => setMode(mode === "quick" ? "granular" : "quick")}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
            padding: "9px 14px", borderRadius: "7px", border: "1px dashed rgba(30,200,255,0.35)",
            background: mode === "granular" ? "rgba(30,200,255,0.1)" : "transparent",
            color: "#1EC8FF", cursor: "pointer",
          }}
        >
          Itemize repairs <ChevronDown size={13} style={{ transform: mode === "granular" ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>
      </div>
      <p style={{ fontSize: "10px", color: "#334155", margin: "0 0 12px" }}>
        Quick mode uses the number above. Itemizing switches to the bid sheet below and disables the quick number.
      </p>

      {mode === "granular" && (
        <div>
          {CATEGORIES.map((cat, ci) => (
            <CategoryAccordion key={cat.name} category={cat} ci={ci} quantities={quantities} onQtyChange={onQtyChange} />
          ))}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px",
            marginTop: "6px", borderRadius: "8px", background: "rgba(30,200,255,0.06)", border: "1px solid rgba(30,200,255,0.2)",
          }}>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>
              Raw subtotal {fmtCurrency(granularRaw)} + 10% fudge factor
            </span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#1EC8FF", fontFamily: "Space Grotesk, monospace" }}>
              {fmtCurrency(repairTotal)}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Section B — Flip Analysis ────────────────────────────────────────────────────

function SummaryStrip({ items }: { items: [string, number][] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px",
      margin: "16px 0", padding: "12px 14px", borderRadius: "8px",
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {items.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: "10px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>
            {label}
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, monospace" }}>
            {fmtCurrency(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function FinancingTypeSelector({ value, onChange }: { value: FinancingType; onChange: (v: FinancingType) => void }) {
  const options: { key: FinancingType; label: string }[] = [
    { key: "cash", label: "Cash" },
    { key: "hard_money", label: "Hard Money" },
    { key: "private_money", label: "Private Money" },
  ];
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            fontSize: "12px", fontWeight: 600, padding: "7px 14px", borderRadius: "999px",
            border: `1px solid ${value === o.key ? "rgba(30,200,255,0.4)" : "rgba(255,255,255,0.1)"}`,
            background: value === o.key ? "rgba(30,200,255,0.12)" : "transparent",
            color: value === o.key ? "#1EC8FF" : "#64748B", cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProfitRoiTiles({ profit, roi }: { profit: number; roi: number | null }) {
  const positive = profit >= 0;
  return (
    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
          Profit
        </div>
        <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: positive ? "#22C55E" : "#EF4444" }}>
          {fmtCurrency(profit)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
          ROI
        </div>
        <div style={{ fontSize: "22px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: positive ? "#22C55E" : "#EF4444" }}>
          {fmtPct(roi)}
        </div>
      </div>
    </div>
  );
}

function FlipSection(props: {
  purchaseClosingPct: Num; setPurchaseClosingPct: (v: Num) => void;
  holdMonths: Num; setHoldMonths: (v: Num) => void;
  utilitiesMonthly: Num; setUtilitiesMonthly: (v: Num) => void;
  insuranceYearly: Num; setInsuranceYearly: (v: Num) => void;
  taxesYearly: Num; setTaxesYearly: (v: Num) => void;
  realtorPct: Num; setRealtorPct: (v: Num) => void;
  saleEscrowPct: Num; setSaleEscrowPct: (v: Num) => void;
  otherCosts: Num; setOtherCosts: (v: Num) => void;
  financingType: FinancingType; setFinancingType: (v: FinancingType) => void;
  allInCost: number; holdingCosts: number; sellingCosts: number; purchaseClosingCosts: number;
  escrowDeposit: number; totalProjectCost: number;
  cashProfit: number; cashROI: number | null;
  hmLTV: Num; setHmLTV: (v: Num) => void;
  hmRate: Num; setHmRate: (v: Num) => void;
  hmPoints: Num; setHmPoints: (v: Num) => void;
  hmAddlFees: Num; setHmAddlFees: (v: Num) => void;
  totalBorrowed: number; totalMoneyCost: number; hmProfit: number; hmROI: number | null;
  hmCashNeededUp: number; hmLtvCheck: boolean;
  pmLoanAmount: Num; setPmLoanAmount: (v: Num) => void;
  pmRate: Num; setPmRate: (v: Num) => void;
  pmAmortYears: Num; setPmAmortYears: (v: Num) => void;
  pmPoints: Num; setPmPoints: (v: Num) => void;
  pmInterestOnly: boolean; setPmInterestOnly: (v: boolean) => void;
  totalFinance: number; pmProfit: number; pmROI: number | null;
}) {
  return (
    <SectionCard title="Section B — Flip Analysis" subtitle="FMTM flip-cost formulas. Pick a financing type to see that type's profit + ROI.">
      <div style={{ ...GRID_STYLE, marginBottom: "6px" }}>
        <Field label="Purchase Closing Rate" hint="% of Offer to Seller">
          <NumInput value={props.purchaseClosingPct} onChange={props.setPurchaseClosingPct} suffix="%" placeholder="2" />
        </Field>
        <Field label="Est. Hold Period">
          <NumInput value={props.holdMonths} onChange={props.setHoldMonths} suffix="mo" placeholder="6" />
        </Field>
        <Field label="Utilities" hint="Monthly">
          <NumInput value={props.utilitiesMonthly} onChange={props.setUtilitiesMonthly} prefix="$" />
        </Field>
        <Field label="Insurance" hint="Yearly">
          <NumInput value={props.insuranceYearly} onChange={props.setInsuranceYearly} prefix="$" />
        </Field>
        <Field label="Taxes" hint="Yearly">
          <NumInput value={props.taxesYearly} onChange={props.setTaxesYearly} prefix="$" />
        </Field>
        <Field label="Realtor Commission" hint="% of ARV, default 5">
          <NumInput value={props.realtorPct} onChange={props.setRealtorPct} suffix="%" placeholder="5" />
        </Field>
        <Field label="Sale Escrow" hint="% of ARV, default 1.23">
          <NumInput value={props.saleEscrowPct} onChange={props.setSaleEscrowPct} suffix="%" placeholder="1.23" />
        </Field>
        <Field label="Other / Misc Costs">
          <NumInput value={props.otherCosts} onChange={props.setOtherCosts} prefix="$" />
        </Field>
      </div>

      <SummaryStrip items={[
        ["All-In Cost", props.allInCost],
        ["Holding Costs", props.holdingCosts],
        ["Selling Costs", props.sellingCosts],
        ["Purchase Closing Costs", props.purchaseClosingCosts],
        ["Escrow Deposit (info)", props.escrowDeposit],
        ["Total Project Cost", props.totalProjectCost],
      ]} />

      <FinancingTypeSelector value={props.financingType} onChange={props.setFinancingType} />

      {props.financingType === "cash" && (
        <ProfitRoiTiles profit={props.cashProfit} roi={props.cashROI} />
      )}

      {props.financingType === "hard_money" && (
        <div>
          <div style={{ ...GRID_STYLE, marginBottom: "16px" }}>
            <Field label="Lender LTV" hint="% of ARV">
              <NumInput value={props.hmLTV} onChange={props.setHmLTV} suffix="%" placeholder="70" />
            </Field>
            <Field label="Lender Rate">
              <NumInput value={props.hmRate} onChange={props.setHmRate} suffix="%" placeholder="12" />
            </Field>
            <Field label="Lender Points">
              <NumInput value={props.hmPoints} onChange={props.setHmPoints} suffix="%" placeholder="2" />
            </Field>
            <Field label="Lender Additional Fees">
              <NumInput value={props.hmAddlFees} onChange={props.setHmAddlFees} prefix="$" />
            </Field>
          </div>
          <SummaryStrip items={[
            ["Total Borrowed", props.totalBorrowed],
            ["Total Money Cost", props.totalMoneyCost],
            ["Cash Needed Up Front", props.hmCashNeededUp],
          ]} />
          <p style={{ fontSize: "11px", color: props.hmLtvCheck ? "#22C55E" : "#F59E0B", margin: "0 0 14px" }}>
            LTV covers all-in cost: {props.hmLtvCheck ? "Yes" : "No"}
          </p>
          <ProfitRoiTiles profit={props.hmProfit} roi={props.hmROI} />
        </div>
      )}

      {props.financingType === "private_money" && (
        <div>
          <div style={{ ...GRID_STYLE, marginBottom: "16px" }}>
            <Field label="Loan Amount">
              <NumInput value={props.pmLoanAmount} onChange={props.setPmLoanAmount} prefix="$" />
            </Field>
            <Field label="Annual Rate">
              <NumInput value={props.pmRate} onChange={props.setPmRate} suffix="%" placeholder="10" />
            </Field>
            <Field label="Amortization" hint="Years, default 30">
              <NumInput value={props.pmAmortYears} onChange={props.setPmAmortYears} suffix="yr" placeholder="30" disabled={props.pmInterestOnly} />
            </Field>
            <Field label="Lender Points">
              <NumInput value={props.pmPoints} onChange={props.setPmPoints} suffix="%" placeholder="2" />
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={props.pmInterestOnly}
              onChange={(e) => props.setPmInterestOnly(e.target.checked)}
            />
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>Interest-only</span>
          </label>
          <p style={{ fontSize: "10px", color: "#334155", margin: "-8px 0 14px" }}>
            Standard amortization (PMT) — not FMTM's private-money table, which referenced a lookup missing from the source file.
          </p>
          <SummaryStrip items={[
            ["Total Finance Cost", props.totalFinance],
          ]} />
          <ProfitRoiTiles profit={props.pmProfit} roi={props.pmROI} />
        </div>
      )}
    </SectionCard>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MaoCalculator() {
  // Phase 7 handoff — the ONLY thing that pre-loads a contact. Read once on
  // mount; opening this page any other way (nav link, direct URL) stays blank.
  const [searchParams, setSearchParams] = useSearchParams();

  // Section A — Wholesale (buyer-profit-first MAO)
  const [arv, setArv] = useState<Num>("");
  const [askingPrice, setAskingPrice] = useState<Num>("");
  const [sellingHolding, setSellingHolding] = useState<Num>(0);
  const [assignmentFeeTarget, setAssignmentFeeTarget] = useState<Num>(5000);
  const [feeFloor, setFeeFloor] = useState<Num>(5000);
  const [buyerProfitMode, setBuyerProfitMode] = useState<"$" | "%">("$");
  const [buyerProfitInput, setBuyerProfitInput] = useState<Num>(0);

  // Deal Summary header
  const [offerToSeller, setOfferToSeller] = useState<Num>("");
  const [offerManuallySet, setOfferManuallySet] = useState(false);

  // Search & Link Contact (Phase 5) — default state is blank/unlinked; nothing
  // pre-loads except via the Phase 7 handoff (not built yet).
  const [contactsCache, setContactsCache] = useState<ContactRow[] | null>(null);
  const contactsPromiseRef = useRef<Promise<ContactRow[]> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ContactRow[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingContact, setPendingContact] = useState<ContactRow | null>(null);
  const [linkedContact, setLinkedContact] = useState<{ id: string; name: string; address: string } | null>(null);
  const [linkedOpportunityId, setLinkedOpportunityId] = useState<string | null>(null);
  const [lastSavedDate, setLastSavedDate] = useState<string | null>(null);

  // Save Offer / Clear (Phase 6)
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessAt, setSaveSuccessAt] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Repair estimator (shared)
  const [repairMode, setRepairMode] = useState<"quick" | "granular">("quick");
  const [quickRepair, setQuickRepair] = useState<Num>(0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Section B — Flip Analysis
  const [purchaseClosingPct, setPurchaseClosingPct] = useState<Num>(2);
  const [holdMonths, setHoldMonths] = useState<Num>(6);
  const [utilitiesMonthly, setUtilitiesMonthly] = useState<Num>(0);
  const [insuranceYearly, setInsuranceYearly] = useState<Num>(0);
  const [taxesYearly, setTaxesYearly] = useState<Num>(0);
  const [realtorPct, setRealtorPct] = useState<Num>(5);
  const [saleEscrowPct, setSaleEscrowPct] = useState<Num>(1.23);
  const [otherCosts, setOtherCosts] = useState<Num>(0);
  const [financingType, setFinancingType] = useState<FinancingType>("cash");

  // Hard money inputs
  const [hmLTV, setHmLTV] = useState<Num>(70);
  const [hmRate, setHmRate] = useState<Num>(12);
  const [hmPoints, setHmPoints] = useState<Num>(2);
  const [hmAddlFees, setHmAddlFees] = useState<Num>(0);

  // Private money inputs
  const [pmLoanAmount, setPmLoanAmount] = useState<Num>(0);
  const [pmRate, setPmRate] = useState<Num>(10);
  const [pmAmortYears, setPmAmortYears] = useState<Num>(30);
  const [pmPoints, setPmPoints] = useState<Num>(2);
  const [pmInterestOnly, setPmInterestOnly] = useState(false);

  // ── Repair total (shared — drives both sections, no double-count) ────────────
  const granularRaw = useMemo(() => {
    let sum = 0;
    CATEGORIES.forEach((cat, ci) => {
      cat.items.forEach((item, ii) => {
        sum += (quantities[`${ci}-${ii}`] ?? 0) * item.cost;
      });
    });
    return sum;
  }, [quantities]);
  const granularTotal = granularRaw * FUDGE_FACTOR;
  const repairTotal = repairMode === "quick" ? n(quickRepair) : granularTotal;

  // ── Search & Link Contact (Phase 5) ───────────────────────────────────────────

  async function ensureContactsLoaded(): Promise<ContactRow[]> {
    if (contactsCache) return contactsCache;
    if (!contactsPromiseRef.current) {
      contactsPromiseRef.current = ghl.contacts.listAll().then((rows) => {
        setContactsCache(rows);
        return rows;
      });
    }
    return contactsPromiseRef.current;
  }

  async function handleSearchChange(q: string) {
    setSearchQuery(q);
    setSearchError(null);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const rows = await ensureContactsLoaded();
      const needle = q.trim().toLowerCase();
      const matches = rows.filter((c) => {
        const name = `${c.firstName} ${c.lastName}`.toLowerCase();
        const addr = `${c.address1} ${c.city}`.toLowerCase();
        return name.includes(needle) || addr.includes(needle);
      }).slice(0, 8);
      setSearchResults(matches);
    } catch (e) {
      setSearchError((e as Error).message);
    }
  }

  // Only checks the specific fields prepopulation would actually touch —
  // Section B is never prepopulated, so it's irrelevant to this guard.
  function hasTypedSectionAData(): boolean {
    return arv !== "" || repairTotal !== 0 || n(assignmentFeeTarget) !== 5000 || offerManuallySet;
  }

  function selectContact(c: ContactRow) {
    setSearchResults([]);
    setSearchQuery("");
    if (hasTypedSectionAData()) {
      setPendingContact(c);
    } else {
      applyContactData(c, true);
    }
  }

  // Phase 7 handoff (Contacts/Pipeline "Analyze in Deal Calculator") — runs once
  // on mount only. Reuses selectContact() exactly as the search results do; on a
  // fresh mount every field is still at its default, so hasTypedSectionAData()
  // is false and this fills directly with no overwrite popup — no separate
  // "pre-load" code path exists. Strips the query param immediately so a later
  // refresh opens blank; only the handoff link itself ever triggers a load.
  useEffect(() => {
    const handoffId = searchParams.get("contactId");
    if (!handoffId) return;
    setSearchParams({}, { replace: true });

    (async () => {
      try {
        const rows = await ensureContactsLoaded();
        const contact = rows.find((c) => c.id === handoffId);
        if (contact) selectContact(contact);
      } catch (e) {
        setSearchError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmOverwrite(yes: boolean) {
    if (!pendingContact) return;
    await applyContactData(pendingContact, yes);
    setPendingContact(null);
  }

  // fill=false ("No, just link"): links the contact for Save (Phase 6) but
  // touches no field — never blanks a value the user already typed.
  async function applyContactData(c: ContactRow, fill: boolean) {
    const name = `${c.firstName} ${c.lastName}`.trim();
    const address = [c.address1, c.city].filter(Boolean).join(", ");
    setLinkedContact({ id: c.id, name, address });

    let opp: OpportunityRow | undefined;
    try {
      const pipeline = await ghl.opportunities.listPipeline();
      opp = pipeline.opportunities.find((o) => o.contactId === c.id);
      setLinkedOpportunityId(opp?.id ?? null);
    } catch {
      setLinkedOpportunityId(null);
    }

    if (!fill) return;

    const cf = opp?.customFields ?? [];
    // offer_ fields (last actual saved state) win over the older source fields.
    const arvSource = cfNum(cf, OFFER_FIELD_IDS.opportunity.offer_arv) ?? cfNum(cf, SOURCE_FIELD_IDS.arv);
    const repairSource = cfNum(cf, OFFER_FIELD_IDS.opportunity.offer_repair_total) ?? cfNum(cf, SOURCE_FIELD_IDS.repairEstimate);
    const feeSource = cfNum(cf, SOURCE_FIELD_IDS.assignmentFeeTarget);
    const offerPriceSource = cfNum(cf, OFFER_FIELD_IDS.opportunity.offer_price);
    const offerDateSource = cfText(cf, OFFER_FIELD_IDS.opportunity.offer_date);

    if (arvSource !== null) setArv(arvSource);
    if (repairSource !== null) { setRepairMode("quick"); setQuickRepair(repairSource); }
    if (feeSource !== null) setAssignmentFeeTarget(feeSource);
    if (offerPriceSource !== null) { setOfferToSeller(offerPriceSource); setOfferManuallySet(true); }
    setLastSavedDate(offerDateSource);
  }

  function unlinkContact() {
    setLinkedContact(null);
    setLinkedOpportunityId(null);
    setLastSavedDate(null);
  }

  // ── Section A derived — buyer-profit-first MAO ────────────────────────────────
  // MAO = ARV − Rehab − Selling/Holding − Target Buyer Profit − Assignment Fee.
  // The assignment fee comes off the top exactly ONCE, here — never subtracted
  // again anywhere downstream (no double-count).
  const arvN = n(arv);
  const sellingHoldingN = n(sellingHolding);
  const buyerProfitDollarN = buyerProfitMode === "$" ? n(buyerProfitInput) : (arvN * n(buyerProfitInput)) / 100;
  const actualAssignmentFee = Math.max(n(feeFloor), n(assignmentFeeTarget));
  const mao = arvN - repairTotal - sellingHoldingN - buyerProfitDollarN - actualAssignmentFee;

  function toggleBuyerProfitMode() {
    if (buyerProfitMode === "$") {
      setBuyerProfitInput(arvN > 0 ? Math.round((buyerProfitDollarN / arvN) * 10000) / 100 : "");
      setBuyerProfitMode("%");
    } else {
      setBuyerProfitInput(Math.round(buyerProfitDollarN));
      setBuyerProfitMode("$");
    }
  }

  // Offer to Seller auto-follows MAO until the user types a value; clearing it resumes following.
  useEffect(() => {
    if (!offerManuallySet) setOfferToSeller(arvN > 0 ? Math.round(mao) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mao, arvN, offerManuallySet]);

  // "Saved ✓" is transient — clear it a few seconds after a successful save.
  useEffect(() => {
    if (saveSuccessAt === null) return;
    const t = setTimeout(() => setSaveSuccessAt(null), 3000);
    return () => clearTimeout(t);
  }, [saveSuccessAt]);

  function handleOfferChange(v: Num) {
    setOfferToSeller(v);
    setOfferManuallySet(v !== "");
  }

  const offerToSellerN = n(offerToSeller);

  // Downstream metrics all use the ACTUAL current Offer to Seller (which may have
  // been manually overridden away from MAO), so overriding gives live feedback.
  const buyerPurchasePrice = offerToSellerN + actualAssignmentFee;
  const buyerExpectedProfit = arvN - repairTotal - sellingHoldingN - actualAssignmentFee - offerToSellerN;
  const buyerAllInCostA = offerToSellerN + actualAssignmentFee + repairTotal + sellingHoldingN;
  const buyerROI = buyerAllInCostA > 0 ? buyerExpectedProfit / buyerAllInCostA : null;
  const profitMargin = arvN > 0 ? buyerExpectedProfit / arvN : null;
  const spreadPct = buyerPurchasePrice > 0 ? actualAssignmentFee / buyerPurchasePrice : null;
  const assignmentPctOfContract = offerToSellerN > 0 ? actualAssignmentFee / offerToSellerN : null;

  // Reasonableness checks — null (neutral) until there's a deal to evaluate.
  const hasDeal = arvN > 0;
  const feeFloorOk = hasDeal ? actualAssignmentFee >= 5000 : null;
  const feeVsProfitOk = hasDeal ? (buyerProfitDollarN > 0 ? actualAssignmentFee <= 0.25 * buyerProfitDollarN : true) : null;
  const buyerReturnOk = hasDeal ? buyerExpectedProfit >= buyerProfitDollarN - 0.5 : null;

  // ── Section B derived (§2c-2e) ────────────────────────────────────────────────
  const holdMonthsN = n(holdMonths);
  const purchaseClosingCosts = (offerToSellerN * n(purchaseClosingPct)) / 100;
  const escrowDeposit = Math.min(offerToSellerN * 0.01, 1000); // informational only
  const holdingCosts = (n(utilitiesMonthly) + n(insuranceYearly) / 12 + n(taxesYearly) / 12) * holdMonthsN;
  const sellingCosts = (arvN * n(realtorPct)) / 100 + (arvN * n(saleEscrowPct)) / 100;
  const otherCostsN = n(otherCosts);
  const allInCost = offerToSellerN + repairTotal + purchaseClosingCosts;
  const totalProjectCost = allInCost + holdingCosts + sellingCosts + otherCostsN;

  // Cash (§2d)
  const cashProfit = arvN - sellingCosts - allInCost;
  const cashROI = allInCost > 0 ? cashProfit / allInCost : null;

  // Hard Money (§2d)
  const hmLTVn = n(hmLTV), hmRateN = n(hmRate), hmPointsN = n(hmPoints), hmAddlFeesN = n(hmAddlFees);
  const totalBorrowed = Math.min(allInCost, (hmLTVn / 100) * arvN);
  const hmMonthlyPmt = (totalBorrowed * (hmRateN / 100)) / 12;
  const hmCostOfPoints = (totalBorrowed * hmPointsN) / 100;
  const totalMoneyCost = hmMonthlyPmt * holdMonthsN + hmAddlFeesN + hmCostOfPoints;
  const hmProfit = cashProfit - totalMoneyCost;
  const hmROI = allInCost > 0 ? hmProfit / allInCost : null;
  const hmCashNeededUp = (1 - hmLTVn / 100) * totalBorrowed;
  const hmLtvCheck = (hmLTVn / 100) * arvN > allInCost;

  // Private Money (§2d — standard PMT, not FMTM's missing lookup table)
  const pmLoanN = n(pmLoanAmount), pmRateN = n(pmRate), pmYearsN = n(pmAmortYears), pmPointsN = n(pmPoints);
  let pmMonthlyPmt: number;
  if (pmInterestOnly) {
    pmMonthlyPmt = (pmLoanN * (pmRateN / 100)) / 12;
  } else if (pmRateN === 0) {
    pmMonthlyPmt = pmYearsN > 0 ? pmLoanN / (pmYearsN * 12) : 0;
  } else {
    const r = pmRateN / 100 / 12;
    const nPeriods = pmYearsN * 12;
    pmMonthlyPmt = (pmLoanN * r) / (1 - Math.pow(1 + r, -nPeriods));
  }
  const pmPointsCost = (pmLoanN * pmPointsN) / 100;
  const totalFinance = pmMonthlyPmt * holdMonthsN + pmPointsCost;
  const pmProfit = cashProfit - totalFinance;
  const pmROI = allInCost > 0 ? pmProfit / allInCost : null;

  // ── Save Offer to GHL (Phase 6) ────────────────────────────────────────────────
  // CRITICAL GUARDRAIL: writes ONLY the offer_ fields, via saveOfferFields() which
  // sends nothing but a customFields array — no pipelineStageId, no tags. This can
  // never move the pipeline stage, add offer-made, or fire Seller 7 / mail-exit.
  // Saving an offer suggestion is deliberately separate from sending one (that's
  // the Pipeline page's "Move to Seller Offer Sent" action, V7 §14d).
  async function handleSave() {
    if (!linkedContact) return;
    setSaving(true);
    setSaveError(null);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const values: Record<string, unknown> = {
        offer_price: offerToSellerN,
        offer_mao: mao,
        offer_wholesale_fee: actualAssignmentFee,
        offer_repair_total: repairTotal,
        offer_margin: buyerExpectedProfit,
        offer_arv: arvN,
        offer_date: todayIso,
      };

      const contactFields = Object.entries(OFFER_FIELD_IDS.contact).map(([key, id]) => ({
        id, field_value: values[key],
      }));
      const writes = [ghl.contacts.saveOfferFields(linkedContact.id, contactFields)];

      if (linkedOpportunityId) {
        const oppFields = Object.entries(OFFER_FIELD_IDS.opportunity).map(([key, id]) => ({
          id, field_value: values[key],
        }));
        writes.push(ghl.opportunities.saveOfferFields(linkedOpportunityId, oppFields));
      }

      await Promise.all(writes);
      setLastSavedDate(todayIso);
      setSaveSuccessAt(Date.now());
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setArv(""); setAskingPrice(""); setSellingHolding(0);
    setAssignmentFeeTarget(5000); setFeeFloor(5000);
    setBuyerProfitMode("$"); setBuyerProfitInput(0);
    setOfferToSeller(""); setOfferManuallySet(false);
    setRepairMode("quick"); setQuickRepair(0); setQuantities({});
    setPurchaseClosingPct(2); setHoldMonths(6);
    setUtilitiesMonthly(0); setInsuranceYearly(0); setTaxesYearly(0);
    setRealtorPct(5); setSaleEscrowPct(1.23); setOtherCosts(0);
    setFinancingType("cash");
    setHmLTV(70); setHmRate(12); setHmPoints(2); setHmAddlFees(0);
    setPmLoanAmount(0); setPmRate(10); setPmAmortYears(30); setPmPoints(2); setPmInterestOnly(false);
    setSearchQuery(""); setSearchResults([]); setSearchError(null); setPendingContact(null);
    unlinkContact();
    setSaveError(null); setSaveSuccessAt(null);
    setConfirmingClear(false);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Calculator size={20} style={{ color: "#1EC8FF" }} />
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
            MAO Deal Calculator
          </h1>
        </div>
        {confirmingClear ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#F1F5F9" }}>Clear everything?</span>
            <button
              onClick={resetAll}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "6px 12px", borderRadius: "6px",
                border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.12)", color: "#EF4444", cursor: "pointer",
              }}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "6px 12px", borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#64748B", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingClear(true)}
            style={{
              fontSize: "12px", fontWeight: 600, padding: "6px 12px", borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#64748B", cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>
      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 18px" }}>
        Fully standalone — type numbers, get live MAO / margin / flip analysis. No contact required.
      </p>

      <ContactLinkPanel
        query={searchQuery}
        onQueryChange={handleSearchChange}
        results={searchResults}
        onSelect={selectContact}
        error={searchError}
        linked={linkedContact}
        onUnlink={unlinkContact}
        lastSavedDate={lastSavedDate}
        pendingContact={pendingContact}
        onConfirmOverwrite={confirmOverwrite}
        onSave={handleSave}
        saving={saving}
        saveError={saveError}
        justSaved={saveSuccessAt !== null}
      />

      <DealSummaryHeader
        offerToSeller={offerToSeller}
        onOfferChange={handleOfferChange}
        assignmentFee={actualAssignmentFee}
        arvN={arvN}
        buyerProfit={buyerExpectedProfit}
      />

      <WholesaleSection
        arv={arv} setArv={setArv}
        askingPrice={askingPrice} setAskingPrice={setAskingPrice}
        sellingHolding={sellingHolding} setSellingHolding={setSellingHolding}
        buyerProfitMode={buyerProfitMode} buyerProfitInput={buyerProfitInput} setBuyerProfitInput={setBuyerProfitInput}
        onToggleBuyerProfitMode={toggleBuyerProfitMode} buyerProfitDollarN={buyerProfitDollarN}
        assignmentFeeTarget={assignmentFeeTarget} setAssignmentFeeTarget={setAssignmentFeeTarget}
        feeFloor={feeFloor} setFeeFloor={setFeeFloor} actualAssignmentFee={actualAssignmentFee}
        repairTotal={repairTotal} mao={mao} buyerPurchasePrice={buyerPurchasePrice}
        buyerExpectedProfit={buyerExpectedProfit} buyerROI={buyerROI} profitMargin={profitMargin}
        spreadPct={spreadPct} assignmentPctOfContract={assignmentPctOfContract}
        feeFloorOk={feeFloorOk} feeVsProfitOk={feeVsProfitOk} buyerReturnOk={buyerReturnOk}
      />

      <RepairEstimator
        mode={repairMode} setMode={setRepairMode}
        quickValue={quickRepair} setQuickValue={setQuickRepair}
        quantities={quantities} setQuantities={setQuantities}
        granularRaw={granularRaw} repairTotal={repairTotal}
      />

      <FlipSection
        purchaseClosingPct={purchaseClosingPct} setPurchaseClosingPct={setPurchaseClosingPct}
        holdMonths={holdMonths} setHoldMonths={setHoldMonths}
        utilitiesMonthly={utilitiesMonthly} setUtilitiesMonthly={setUtilitiesMonthly}
        insuranceYearly={insuranceYearly} setInsuranceYearly={setInsuranceYearly}
        taxesYearly={taxesYearly} setTaxesYearly={setTaxesYearly}
        realtorPct={realtorPct} setRealtorPct={setRealtorPct}
        saleEscrowPct={saleEscrowPct} setSaleEscrowPct={setSaleEscrowPct}
        otherCosts={otherCosts} setOtherCosts={setOtherCosts}
        financingType={financingType} setFinancingType={setFinancingType}
        allInCost={allInCost} holdingCosts={holdingCosts} sellingCosts={sellingCosts}
        purchaseClosingCosts={purchaseClosingCosts} escrowDeposit={escrowDeposit} totalProjectCost={totalProjectCost}
        cashProfit={cashProfit} cashROI={cashROI}
        hmLTV={hmLTV} setHmLTV={setHmLTV}
        hmRate={hmRate} setHmRate={setHmRate}
        hmPoints={hmPoints} setHmPoints={setHmPoints}
        hmAddlFees={hmAddlFees} setHmAddlFees={setHmAddlFees}
        totalBorrowed={totalBorrowed} totalMoneyCost={totalMoneyCost} hmProfit={hmProfit} hmROI={hmROI}
        hmCashNeededUp={hmCashNeededUp} hmLtvCheck={hmLtvCheck}
        pmLoanAmount={pmLoanAmount} setPmLoanAmount={setPmLoanAmount}
        pmRate={pmRate} setPmRate={setPmRate}
        pmAmortYears={pmAmortYears} setPmAmortYears={setPmAmortYears}
        pmPoints={pmPoints} setPmPoints={setPmPoints}
        pmInterestOnly={pmInterestOnly} setPmInterestOnly={setPmInterestOnly}
        totalFinance={totalFinance} pmProfit={pmProfit} pmROI={pmROI}
      />
    </div>
  );
}
