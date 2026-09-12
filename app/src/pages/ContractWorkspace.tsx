import { useMemo, useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { ghl, type ContactDetail, type OpportunityRow } from "../lib/ghl";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import {
  formatContractReadyChecklistNote,
  CONTRACT_READY_ITEM_KEYS, type ContractReadyItemKey, type ContractReadyItems,
} from "../lib/seller-call-readiness-carriers";
import { computeContractScreenState, type ContractScreenState } from "../lib/contract-workspace-view";
import { CONTRACT_STATE_MEANING, initialVersionIdentity, evaluateContractSentEligibility } from "../lib/board9-contract-model";
import {
  computeSellerContractFactsReport, computeSellerContractFactsReadiness,
  type SellerContractFactsReport, type FieldDisposition,
} from "../lib/contract-facts-model";
import {
  buildContractDocumentPreview, type ContractDocumentPreview,
  CONTRACT_DOCUMENT_GROUP_LABEL,
} from "../lib/contract-document-model";
import {
  evaluateBradAuthorizationCurrency, evaluateAuthorizationEligibility,
  buildAuthorizationRecordArgs, computeDifferencesFromLastAuthorized,
} from "../lib/contract-authorization-model";
import {
  formatBradContractAuthorizationNote, latestBradContractAuthorizationForOpportunity,
} from "../lib/contract-authorization-carriers";
import {
  evaluateSendEligibility, buildSendAttemptArgs, buildSendResultArgs,
  buildReadbackResultArgs, classifyProviderSendResponse, buildContractSentEvidence,
} from "../lib/contract-send-model";
import {
  formatContractSendNote, latestContractSendForOpportunity,
} from "../lib/contract-send-carriers";
import { getRuntimeConfig } from "../../shared/ghl-config";
import {
  formatBuyerEntityOverrideNote,
  formatPartySignerFactsNote, type SellerSignerFact,
  formatPropertyLegalDescriptionFactsNote, type ReservationsFact,
  formatLeaseDisclosureFactsNote, type NaturalResourceLeaseFact,
  formatEarnestMoneyOptionFactsNote, type AdditionalEarnestMoneyFact,
  formatTitleSurveyFactsNote, type ExpenseParty, type ShortageAmendmentElection, type SurveyElection,
  formatPropertyConditionFactsNote, type SellerDisclosureNoticeFact, type AsIsElectionFact, type WaterDisclosureFact,
  formatClosingPossessionFactsNote,
  formatSettlementExpenseFactsNote, type BrokerageContribution,
  formatRepresentationFactsNote, type RepresentationFact, type BrokerInfo,
  formatAddendaApplicabilityFactsNote, ADDENDA_APPLICABILITY_ITEM_KEYS, type AddendaApplicabilityItemKey, type AddendaApplicabilityItems,
  formatSellerEquitableInterestDisclosureNote, type EquitableInterestDisposition,
  formatAttorneyManualFieldDispositionNote, type AttorneyManualFieldDisposition, type AttorneyManualFieldSlot,
  latestAttorneyManualFieldDispositionForOpportunity,
  formatSellerNoticeConfirmationFactsNote, type SellerNoticeSource,
  formatBuyerBusinessConfigFactsNote,
  type ValueOrNone, type AmountOrNone, type DaysOrNone,
} from "../lib/seller-contract-facts-carriers";

/**
 * Contract Workspace -- B9-04 / INV-59, extended by B9-05 / INV-60.
 *
 * Route: /contacts/:id/contract.
 *
 * CONSUMES B9-03 DIRECTLY; RECREATES NO READINESS LOGIC HERE. Every
 * judgment about what "Contract Ready" means comes from
 * `contract-workspace-view.ts`; every judgment about a TREC 20-19 fact's
 * disposition (populated / not applicable / unresolved) comes from
 * `contract-facts-model.ts`. This component renders what those modules
 * return -- it does not compute a readiness boolean and does not decide a
 * disposition itself anywhere below.
 *
 * NO INVENTED GHL-TO-DOMAIN MAPPING. Reads are the same
 * `ghl.contacts.getDetail` / `ghl.opportunities.listPipeline` /
 * `ghl.notes.list` every sibling workspace already uses.
 *
 * WRITES ONLY ON EXPLICIT OPERATOR ACTION, ALL THROUGH THE SAME SANCTIONED
 * CALL. Every save handler below (`handleSaveX`) is wired ONLY to its own
 * group's Save button `onClick`; none runs on mount, on `screen` change, or
 * as a side effect of another group's save. Every one calls the SAME
 * sanctioned write, `ghl.notes.create()`, through that group's own
 * durable-carrier `formatXNote` -- no new write class, no fourth write.
 *
 * JESS GATE CORRECTION ROUND (2026-09-10) implemented here:
 *  1. Every applicable ¶B/C/D/E field gets its OWN explicit operator
 *     control -- populated / intentionally not-applicable / unresolved --
 *     not a read-only report plus one form. See the per-group sections
 *     below; each maps 1:1 to a carrier in `seller-contract-facts-carriers.ts`.
 *  2. ¶5 no longer forces a positive earnest money / option fee / option
 *     period -- `AmountOrNoneField` / `DaysOrNoneField` below let the
 *     operator pick "amount" or explicit "none," never a silent default.
 *     Additional earnest money requires its own explicit applicable/
 *     not-applicable choice before Save is even attempted.
 *  3. The seller's ¶21 notice address/phone/email is its OWN explicit
 *     confirmation form ("Seller Notice (¶21)" below) -- the property
 *     address is shown only as read-only CANDIDATE data the operator may
 *     copy in, never written as the notice value automatically.
 *  4. BTC LLC's own notice/signer info gets a real capture form
 *     ("Buyer Business Configuration" below) instead of a hardcoded `null`.
 *  5. The read-only summary above each form renders human labels and
 *     plain-English values (`FIELD_LABELS`, `renderFieldValue`) -- never a
 *     raw camelCase key or a JSON blob.
 */

const CONTENT_MAX_WIDTH = "1200px";

/* ==================================================================== */
/* Small shared style tokens + input primitives                          */
/* ==================================================================== */

const inputStyle: React.CSSProperties = { background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px", padding: "6px 8px", color: "#E2E8F0", fontSize: "12px" };
const smallInputStyle: React.CSSProperties = { ...inputStyle, width: "100px" };
const selectStyle: React.CSSProperties = { ...inputStyle };
const groupCardStyle: React.CSSProperties = { padding: "10px 14px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "8px" };
const formBoxStyle: React.CSSProperties = { marginTop: "10px", padding: "14px 16px", background: "#0B1330", border: "1px solid #1E293B", borderRadius: "8px" };
const rowStyle: React.CSSProperties = { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "8px" };
const saveButtonStyle: React.CSSProperties = { background: "#005CE6", border: "none", borderRadius: "6px", padding: "6px 14px", color: "#F5F7FA", fontSize: "12px", cursor: "pointer" };
const smallLabelStyle: React.CSSProperties = { fontSize: "10px", color: "#64748B", marginBottom: "2px" };

function ErrorText({ testId, children }: { testId: string; children: string | null }) {
  if (!children) return null;
  return <div data-testid={testId} style={{ fontSize: "11px", color: "#EF4444", marginTop: "6px" }}>{children}</div>;
}

function Field({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId}>
      <div style={smallLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

function TextField({ testId, value, onChange, placeholder, width }: { testId: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: string }) {
  return <input data-testid={testId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: width ?? "auto" }} />;
}

function SelectField<K extends string>({ testId, value, onChange, options }: { testId: string; value: K; onChange: (v: K) => void; options: { value: K; label: string }[] }) {
  return (
    <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value as K)} style={selectStyle}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Btn({ testId, onClick, busy, disabled, children }: { testId: string; onClick: () => void; busy: boolean; disabled?: boolean; children: string }) {
  const isDisabled = busy || (disabled ?? false);
  return (
    <button data-testid={testId} onClick={onClick} disabled={isDisabled} style={{ ...saveButtonStyle, cursor: isDisabled ? "not-allowed" : "pointer", opacity: isDisabled && !busy ? 0.5 : 1 }}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : children}
    </button>
  );
}

/** "Has a value" vs. explicit "None" -- never a blank standing in for either. */
type VNDraft = { mode: "value" | "none"; text: string };
const VN_UNSET: VNDraft = { mode: "value", text: "" };
function ValueOrNoneField({ testId, value, onChange }: { testId: string; value: VNDraft; onChange: (v: VNDraft) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
      <SelectField testId={`${testId}-mode`} value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[{ value: "value", label: "Has a value" }, { value: "none", label: "None (explicit)" }]} />
      {value.mode === "value" ? <TextField testId={`${testId}-text`} value={value.text} onChange={(text) => onChange({ ...value, text })} /> : null}
    </span>
  );
}
function valueOrNoneToFact(v: VNDraft): ValueOrNone | null {
  if (v.mode === "none") return { kind: "none" };
  if (v.text.trim() === "") return null;
  return { kind: "value", value: v.text };
}

/** "Entered amount" vs. explicit "none/$0" -- Jess Gate correction: never forced positive. */
type AONDraft = { mode: "amount" | "none"; text: string };
const AON_UNSET: AONDraft = { mode: "amount", text: "" };
function AmountOrNoneField({ testId, value, onChange }: { testId: string; value: AONDraft; onChange: (v: AONDraft) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
      <SelectField testId={`${testId}-mode`} value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[{ value: "amount", label: "Amount" }, { value: "none", label: "None / $0 (explicit)" }]} />
      {value.mode === "amount" ? <TextField testId={`${testId}-text`} value={value.text} onChange={(text) => onChange({ ...value, text })} placeholder="$" width="90px" /> : null}
    </span>
  );
}
function amountOrNoneToFact(v: AONDraft): AmountOrNone | null {
  if (v.mode === "none") return { kind: "none" };
  const n = Number(v.text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { kind: "amount", amount: n };
}

/** Same pattern, an integer day count. */
type DONDraft = { mode: "days" | "none"; text: string };
const DON_UNSET: DONDraft = { mode: "days", text: "" };
function DaysOrNoneField({ testId, value, onChange }: { testId: string; value: DONDraft; onChange: (v: DONDraft) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
      <SelectField testId={`${testId}-mode`} value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[{ value: "days", label: "Days" }, { value: "none", label: "No option period (explicit)" }]} />
      {value.mode === "days" ? <TextField testId={`${testId}-text`} value={value.text} onChange={(text) => onChange({ ...value, text })} placeholder="days" width="80px" /> : null}
    </span>
  );
}
function daysOrNoneToFact(v: DONDraft): DaysOrNone | null {
  if (v.mode === "none") return { kind: "none" };
  const n = Number(v.text);
  if (!Number.isInteger(n) || n <= 0) return null;
  return { kind: "days", days: n };
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

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function renderValueOrNone(v: ValueOrNone): string {
  return v.kind === "none" ? "None (explicitly confirmed)" : v.value;
}

/**
 * Operator-readable rendering for every populated field value -- never a
 * raw JSON blob. Falls back to a plain "Key: value" join (still no braces
 * or quotes) for anything not explicitly handled below.
 */
function renderFieldValue(group: string, field: string, d: FieldDisposition<unknown>): { text: string; color: string } {
  if (d.kind === "unresolved") return { text: "Unresolved", color: "#F59E0B" };
  if (d.kind === "not_applicable") return { text: "Not applicable" + (d.note ? ` — ${d.note}` : ""), color: "#64748B" };
  const v: any = d.value;
  const key = `${group}.${field}`;
  switch (key) {
    case "salesPrice.cashPortion":
    case "salesPrice.financingSum":
    case "salesPrice.salesPrice":
      return { text: money(v as number), color: "#22C55E" };
    case "parties.sellerSigners":
      return { text: (v as SellerSignerFact[]).map((s) => `${s.displayName} (${s.role})${s.signingAuthorityNote ? ` — ${s.signingAuthorityNote}` : ""}`).join("; "), color: "#22C55E" };
    case "propertyLegalDescription.lot":
    case "propertyLegalDescription.block":
    case "propertyLegalDescription.addition":
    case "propertyLegalDescription.county":
    case "propertyLegalDescription.exclusions":
    case "titleSurvey.objectionsText":
    case "propertyCondition.serviceContractCap":
    case "closingPossession.possessionDetails":
    case "settlementExpense.sellerCreditCap":
    case "addendaApplicability.districtNotices":
      return { text: renderValueOrNone(v as ValueOrNone), color: "#22C55E" };
    case "propertyLegalDescription.reservations": {
      const r = v as ReservationsFact;
      return { text: r.kind === "none" ? "None" : `Applies — ${r.addendumNote}`, color: "#22C55E" };
    }
    case "leaseDisclosure.naturalResourceLeases": {
      const n = v as NaturalResourceLeaseFact;
      return { text: n.kind === "none" ? "None" : n.kind === "delivered" ? "Delivered" : `Not yet delivered — within ${n.terminateWithinDays} days`, color: "#22C55E" };
    }
    case "earnestMoneyOption.earnestMoney":
    case "earnestMoneyOption.optionFee":
      return { text: money(v as number), color: "#22C55E" };
    case "earnestMoneyOption.optionPeriodDays":
    case "titleSurvey.objectionsDays":
      return { text: `${v} days`, color: "#22C55E" };
    case "earnestMoneyOption.additionalEarnestMoney": {
      const a = v as AdditionalEarnestMoneyFact;
      return { text: a.kind === "none" ? "None" : `${money(a.amount)} within ${a.withinDays} days`, color: "#22C55E" };
    }
    case "titleSurvey.shortageAmendmentElection": {
      const s = v as ShortageAmendmentElection;
      return { text: s.kind === "not_amended" ? "Not amended" : `Amended — ${s.expenseParty} pays`, color: "#22C55E" };
    }
    case "titleSurvey.surveyElection": {
      const s = v as SurveyElection;
      if (s.option === "seller_existing_survey") return { text: `Seller furnishes existing survey within ${s.sellerFurnishDays} days; if rejected, ${s.ifRejectedExpenseParty} pays for new survey`, color: "#22C55E" };
      if (s.option === "buyer_new_survey") return { text: `Buyer obtains new survey within ${s.buyerObtainDays} days`, color: "#22C55E" };
      return { text: `Seller furnishes new survey within ${s.sellerFurnishDays} days`, color: "#22C55E" };
    }
    case "propertyCondition.sellerDisclosureNotice": {
      const s = v as SellerDisclosureNoticeFact;
      return { text: s.kind === "received" ? "Received" : s.kind === "not_required" ? "Not required" : `Not yet received — within ${s.deliverWithinDays} days`, color: "#22C55E" };
    }
    case "propertyCondition.asIsElection": {
      const a = v as AsIsElectionFact;
      return { text: a.kind === "as_is" ? "As-is" : `As-is with repairs — ${a.repairsText}`, color: "#22C55E" };
    }
    case "propertyCondition.waterDisclosure": {
      const w = v as WaterDisclosureFact;
      if (w.kind === "received") return { text: "Received", color: "#22C55E" };
      if (w.kind === "not_yet_received") return { text: `Not yet received — within ${w.deliverWithinDays} days`, color: "#22C55E" };
      return { text: `Exempt — no well, no pond/lake/tank, no surface water certificate, no severed mineral rights; water source: ${w.waterSource}`, color: "#22C55E" };
    }
    case "closingPossession.closingDate":
      return { text: new Date(v as string).toLocaleDateString(), color: "#22C55E" };
    case "closingPossession.possessionElection":
      return { text: v === "upon_closing_and_funding" ? "Upon closing and funding" : "Leaseback", color: "#22C55E" };
    case "settlementExpense.sellerPaysBuyerBroker":
    case "settlementExpense.buyerPaysSellerBroker": {
      const b = v as BrokerageContribution;
      return { text: b.kind === "none" ? "None" : b.kind === "dollar" ? money(b.amount) : `${b.percent}%`, color: "#22C55E" };
    }
    case "representation.representation": {
      const r = v as RepresentationFact;
      if (r.kind === "none") return { text: "No representation", color: "#22C55E" };
      const sellerText = r.sellerAgent ? `seller's agent: ${r.sellerAgent.firmName}` : "no seller's agent on file";
      const buyerText = r.buyerAgent ? `buyer's agent: ${r.buyerAgent.firmName}` : "no buyer's agent on file";
      return { text: `Represented — ${sellerText}; ${buyerText}`, color: "#22C55E" };
    }
    case "addendaApplicability.items": {
      const items = v as AddendaApplicabilityItems;
      const selected = ADDENDA_APPLICABILITY_ITEM_KEYS.filter((k) => items[k]).map(humanizeKey);
      return { text: selected.length > 0 ? selected.join(", ") : "None selected", color: "#22C55E" };
    }
    case "sellerEquitableInterest.disposition": {
      const e = v as EquitableInterestDisposition;
      return { text: e.kind === "not_yet_made" ? "Not yet made" : `Made — ${new Date(e.at).toLocaleString()}`, color: "#22C55E" };
    }
    case "attorneyManualFields.specialProvisions":
    case "attorneyManualFields.otherAddendaText":
      return { text: (v as { kind: string }).kind === "provided_verbatim" ? "Provided verbatim (see text below)" : humanizeKey(String((v as { kind: string }).kind)), color: "#22C55E" };
    default:
      if (typeof v === "string" || typeof v === "number") return { text: String(v), color: "#22C55E" };
      if (typeof v === "boolean") return { text: v ? "Yes" : "No", color: "#22C55E" };
      if (v && typeof v === "object") return { text: Object.entries(v).map(([k, val]) => `${humanizeKey(k)}: ${val}`).join(", "), color: "#22C55E" };
      return { text: String(v), color: "#22C55E" };
  }
}

const FIELD_LABELS: Record<string, string> = {
  "parties.buyerEntityName": "Buyer entity", "parties.buyerCapacity": "Buyer capacity",
  "parties.buyerTexasLicenseStatus": "Buyer Texas real-estate license status", "parties.sellerSigners": "Seller signer(s)",
  "salesPrice.cashPortion": "Cash portion (¶3A)", "salesPrice.financingSum": "Financing sum (¶3B)", "salesPrice.salesPrice": "Sales price (¶3C)",
  "propertyLegalDescription.lot": "Lot", "propertyLegalDescription.block": "Block", "propertyLegalDescription.addition": "Addition",
  "propertyLegalDescription.county": "County", "propertyLegalDescription.exclusions": "Exclusions from conveyance", "propertyLegalDescription.reservations": "Reservations",
  "leaseDisclosure.residentialLeases": "Residential leases", "leaseDisclosure.fixtureLeases": "Fixture leases", "leaseDisclosure.naturalResourceLeases": "Natural resource leases",
  "earnestMoneyOption.escrowAgentName": "Escrow agent name", "earnestMoneyOption.escrowAgentAddress": "Escrow agent address",
  "earnestMoneyOption.earnestMoney": "Earnest money", "earnestMoneyOption.optionFee": "Option fee",
  "earnestMoneyOption.optionPeriodDays": "Option period (days)", "earnestMoneyOption.additionalEarnestMoney": "Additional earnest money",
  "titleSurvey.titlePolicyExpenseParty": "Title policy expense paid by", "titleSurvey.titleCompanyName": "Title company",
  "titleSurvey.shortageAmendmentElection": "Title policy shortage amendment", "titleSurvey.surveyElection": "Survey",
  "titleSurvey.objectionsText": "Title objections", "titleSurvey.objectionsDays": "Title objection days", "titleSurvey.poaMembership": "Property Owners Association membership",
  "propertyCondition.sellerDisclosureNotice": "Seller's disclosure notice", "propertyCondition.asIsElection": "As-is election",
  "propertyCondition.serviceContractCap": "Residential service contract cap", "propertyCondition.waterDisclosure": "Water/wastewater disclosure",
  "closingPossession.closingDate": "Closing date", "closingPossession.possessionElection": "Possession", "closingPossession.possessionDetails": "Possession details",
  "settlementExpense.sellerCreditCap": "Seller expense credit cap", "settlementExpense.sellerPaysBuyerBroker": "Seller pays buyer's broker",
  "settlementExpense.buyerPaysSellerBroker": "Buyer pays seller's broker", "representation.representation": "Broker/agent representation",
  "addendaApplicability.items": "Addenda selected", "addendaApplicability.districtNotices": "District notices", "addendaApplicability.financingAddenda": "Financing addenda",
  "noticeContact.buyerNoticeAddress": "Buyer notice address", "noticeContact.buyerNoticePhone": "Buyer notice phone", "noticeContact.buyerNoticeEmail": "Buyer notice email",
  "noticeContact.buyerSignerName": "Buyer authorized signer", "noticeContact.buyerSignerRole": "Buyer signer role",
  "noticeContact.sellerNoticeAddress": "Seller notice address", "noticeContact.sellerNoticePhone": "Seller notice phone", "noticeContact.sellerNoticeEmail": "Seller notice email",
  "sellerEquitableInterest.disposition": "Seller equitable-interest disclosure",
  "attorneyManualFields.specialProvisions": "Special provisions (¶11)", "attorneyManualFields.otherAddendaText": "Other addenda (¶22 \"Other:\")",
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

const SELLER_CONTRACT_FACT_GROUPS: { key: keyof SellerContractFactsReport; label: string }[] = [
  { key: "parties", label: "Parties (¶1)" },
  { key: "salesPrice", label: "Sales Price (¶3)" },
  { key: "propertyLegalDescription", label: "Property Legal Description (¶2)" },
  { key: "leaseDisclosure", label: "Leases (¶4)" },
  { key: "earnestMoneyOption", label: "Earnest Money and Option (¶5)" },
  { key: "titleSurvey", label: "Title Policy and Survey (¶6)" },
  { key: "propertyCondition", label: "Property Condition (¶7)" },
  { key: "closingPossession", label: "Closing and Possession (¶9, ¶10)" },
  { key: "settlementExpense", label: "Settlement and Other Expenses (¶12)" },
  { key: "representation", label: "Broker/Agent Representation (¶8, ¶12B, ¶21, p.11)" },
  { key: "addendaApplicability", label: "Addenda Applicability (¶22)" },
  { key: "noticeContact", label: "Notices (¶21)" },
  { key: "sellerEquitableInterest", label: "Seller Equitable-Interest Disclosure" },
  { key: "attorneyManualFields", label: "Attorney/Manual Fields (¶11, ¶22 \"Other\")" },
];
const GROUP_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(SELLER_CONTRACT_FACT_GROUPS.map((g) => [String(g.key), g.label]));

const CONTRACT_CHECKLIST_ITEMS: { key: ContractReadyItemKey; label: string }[] = [
  { key: "legal_owners", label: "Correct legal owners confirmed" },
  { key: "closing_timeline", label: "Closing timeline set" },
  { key: "occupancy_possession", label: "Occupancy and possession confirmed" },
  { key: "liens_title", label: "Known liens and title complications reviewed" },
  { key: "delivery_signing", label: "Delivery and signing information collected" },
];

/* ==================================================================== */
/* Draft shapes for every group's entry form                             */
/* ==================================================================== */

type BrokerDraft = { firmName: string; licenseNo: string; associateName: string; associateLicenseNo: string; email: string; phone: string };
const BROKER_DRAFT_EMPTY: BrokerDraft = { firmName: "", licenseNo: "", associateName: "", associateLicenseNo: "", email: "", phone: "" };
const BROKER_FIELDS: { key: keyof BrokerDraft; label: string }[] = [
  { key: "firmName", label: "Firm name" }, { key: "licenseNo", label: "License #" },
  { key: "associateName", label: "Associate name" }, { key: "associateLicenseNo", label: "Associate license #" },
  { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
];

type Drafts = {
  buyerOverride: { active: boolean; buyerName: string; reason: string };
  signer: { role: string; displayName: string; signingAuthorityNote: string };
  legalDesc: { lot: VNDraft; block: VNDraft; addition: VNDraft; county: VNDraft; exclusions: VNDraft; reservationsKind: "none" | "applies"; reservationsNote: string };
  lease: { residentialLeases: "none" | "applies"; fixtureLeases: "none" | "applies"; naturalKind: "none" | "delivered" | "not_yet_delivered"; naturalDays: string };
  earnest: { escrowAgentName: string; escrowAgentAddress: string; earnestMoney: AONDraft; optionFee: AONDraft; optionPeriodDays: DONDraft; additionalKind: "unset" | "none" | "value"; additionalAmount: string; additionalWithinDays: string };
  titleSurvey: {
    titlePolicyExpenseParty: ExpenseParty; titleCompanyName: string;
    shortageKind: "not_amended" | "amended"; shortageExpenseParty: ExpenseParty;
    surveyOption: "seller_existing_survey" | "buyer_new_survey" | "seller_new_survey";
    sellerFurnishDays: string; buyerObtainDays: string; ifRejectedExpenseParty: ExpenseParty;
    objectionsText: VNDraft; objectionsDays: string; poaMembership: "is_subject" | "is_not_subject";
  };
  propertyCondition: {
    disclosureKind: "received" | "not_yet_received" | "not_required"; disclosureDays: string;
    asIsKind: "as_is" | "as_is_with_repairs"; repairsText: string;
    serviceContractCap: VNDraft;
    waterKind: "received" | "not_yet_received" | "exempt"; waterDays: string; waterSource: string;
  };
  closingPossession: { closingDate: string; possessionElection: "upon_closing_and_funding" | "leaseback"; possessionDetails: VNDraft };
  settlement: { sellerCreditCap: VNDraft; sellerPaysKind: "none" | "dollar" | "percent"; sellerPaysAmount: string; sellerPaysPercent: string; buyerPaysKind: "none" | "dollar" | "percent"; buyerPaysAmount: string; buyerPaysPercent: string };
  representation: { kind: "none" | "represented"; sellerAgentPresent: boolean; sellerAgent: BrokerDraft; buyerAgentPresent: boolean; buyerAgent: BrokerDraft };
  addenda: { items: Record<AddendaApplicabilityItemKey, boolean>; districtNotices: VNDraft };
  sellerEquitable: { kind: "not_yet_made" | "made" };
  attorneySpecial: { kind: "not_applicable" | "attorney_will_draft" | "provided_verbatim"; text: string };
  attorneyOther: { kind: "not_applicable" | "attorney_will_draft" | "provided_verbatim"; text: string };
  buyerBusinessConfig: { noticeAddress: string; noticePhone: string; noticeEmail: string; signerName: string; signerRole: string };
  sellerNotice: { noticeAddress: string; noticePhone: VNDraft; noticeEmail: VNDraft };
};

const INITIAL_DRAFTS: Drafts = {
  buyerOverride: { active: false, buyerName: "", reason: "" },
  signer: { role: "", displayName: "", signingAuthorityNote: "" },
  legalDesc: { lot: VN_UNSET, block: VN_UNSET, addition: VN_UNSET, county: VN_UNSET, exclusions: VN_UNSET, reservationsKind: "none", reservationsNote: "" },
  lease: { residentialLeases: "none", fixtureLeases: "none", naturalKind: "none", naturalDays: "" },
  earnest: { escrowAgentName: "", escrowAgentAddress: "", earnestMoney: AON_UNSET, optionFee: AON_UNSET, optionPeriodDays: DON_UNSET, additionalKind: "unset", additionalAmount: "", additionalWithinDays: "" },
  titleSurvey: { titlePolicyExpenseParty: "seller", titleCompanyName: "", shortageKind: "not_amended", shortageExpenseParty: "seller", surveyOption: "seller_existing_survey", sellerFurnishDays: "", buyerObtainDays: "", ifRejectedExpenseParty: "buyer", objectionsText: VN_UNSET, objectionsDays: "", poaMembership: "is_not_subject" },
  propertyCondition: { disclosureKind: "received", disclosureDays: "", asIsKind: "as_is", repairsText: "", serviceContractCap: VN_UNSET, waterKind: "received", waterDays: "", waterSource: "" },
  closingPossession: { closingDate: "", possessionElection: "upon_closing_and_funding", possessionDetails: VN_UNSET },
  settlement: { sellerCreditCap: VN_UNSET, sellerPaysKind: "none", sellerPaysAmount: "", sellerPaysPercent: "", buyerPaysKind: "none", buyerPaysAmount: "", buyerPaysPercent: "" },
  representation: { kind: "none", sellerAgentPresent: false, sellerAgent: BROKER_DRAFT_EMPTY, buyerAgentPresent: false, buyerAgent: BROKER_DRAFT_EMPTY },
  addenda: { items: Object.fromEntries(ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])) as Record<AddendaApplicabilityItemKey, boolean>, districtNotices: VN_UNSET },
  sellerEquitable: { kind: "not_yet_made" },
  attorneySpecial: { kind: "not_applicable", text: "" },
  attorneyOther: { kind: "not_applicable", text: "" },
  buyerBusinessConfig: { noticeAddress: "", noticePhone: "", noticeEmail: "", signerName: "", signerRole: "" },
  sellerNotice: { noticeAddress: "", noticePhone: VN_UNSET, noticeEmail: VN_UNSET },
};

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

  // B9-05 / INV-60 -- one draft object, one entry per group form below.
  // Nothing here is written until its OWN group's Save button is clicked.
  const [drafts, setDrafts] = useState<Drafts>(INITIAL_DRAFTS);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [groupErrors, setGroupErrors] = useState<Record<string, string | null>>({});

  function updateDraft<K extends keyof Drafts>(key: K, patch: Partial<Drafts[K]>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }
  function setGroupError(key: string, msg: string) {
    setGroupErrors((prev) => ({ ...prev, [key]: msg }));
  }
  async function commitNote(key: string, note: string) {
    setGroupErrors((prev) => ({ ...prev, [key]: null }));
    setBusyGroup(key);
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: new Date().toISOString() }]);
    } catch (e: any) {
      setGroupErrors((prev) => ({ ...prev, [key]: e?.message ?? "Couldn't save -- not yet in effect. Try again." }));
    } finally {
      setBusyGroup(null);
    }
  }

  // READS ONLY. No write of any kind happens in this effect.
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

  // Candidate/inherited seller notice data -- READ-ONLY reference for the
  // operator. Jess Gate correction: never written as the notice value.
  const sellerNoticeCandidate = useMemo(() => ({
    address: propertyAddress === "—" ? "" : propertyAddress,
    phone: contact?.phone || "",
    email: contact?.email || "",
  }), [propertyAddress, contact]);

  const sellerContractFactsReport: SellerContractFactsReport | null = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return computeSellerContractFactsReport({
      opportunityId: screen.opportunity.id,
      notes,
      agreedPrice: screen.agreedPrice,
      agreementAt: screen.economics.agreementAt,
      propertyAddress: propertyAddress === "—" ? null : propertyAddress,
    });
  }, [screen, notes, propertyAddress]);

  const sellerContractFactsReadiness = useMemo(
    () => (sellerContractFactsReport ? computeSellerContractFactsReadiness(sellerContractFactsReport) : null),
    [sellerContractFactsReport],
  );

  /**
   * B9-07 / INV-62 -- Contract Review & Send-Authorization Gate.
   *
   * `documentVersion` is `initialVersionIdentity(agreementAt)` -- no
   * Correction-tracking carrier/UI exists yet anywhere in this codebase
   * (B9-03 defined `ContractVersionIdentity`/`nextVersionIdentity` for a
   * future Correction issue to use; none has), so `versionSeq` is always
   * 1 today. Deriving it this way, rather than inventing a placeholder,
   * means this section is already correct the day a Correction issue
   * starts actually bumping it.
   */
  const documentVersion = useMemo(
    () => (screen.state === "ready" ? initialVersionIdentity(screen.economics.agreementAt) : null),
    [screen],
  );

  const propertyStreetAddressDisposition: FieldDisposition<string> = useMemo(() => {
    if (propertyAddress === "—" || propertyAddress === "") return { kind: "unresolved" };
    return { kind: "populated", value: propertyAddress, authority: "operator_attested", recordedAt: null };
  }, [propertyAddress]);

  const contractDocumentPreview: ContractDocumentPreview | null = useMemo(() => {
    if (!sellerContractFactsReport || !documentVersion || screen.state !== "ready") return null;
    return buildContractDocumentPreview({
      opportunityId: screen.opportunity.id,
      version: documentVersion,
      report: sellerContractFactsReport,
      propertyStreetAddress: propertyStreetAddressDisposition,
    });
  }, [sellerContractFactsReport, documentVersion, screen, propertyStreetAddressDisposition]);

  const bradAuthorizationRecord = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestBradContractAuthorizationForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const bradAuthorizationStatus = useMemo(() => {
    if (!contractDocumentPreview) return null;
    return evaluateBradAuthorizationCurrency(bradAuthorizationRecord, contractDocumentPreview);
  }, [bradAuthorizationRecord, contractDocumentPreview]);

  const authorizationEligibility = useMemo(() => {
    if (!contractDocumentPreview || !documentVersion) return null;
    return evaluateAuthorizationEligibility(contractDocumentPreview, documentVersion);
  }, [contractDocumentPreview, documentVersion]);

  const differencesFromLastAuthorized = useMemo(() => {
    if (!contractDocumentPreview) return null;
    return computeDifferencesFromLastAuthorized(bradAuthorizationRecord, contractDocumentPreview);
  }, [bradAuthorizationRecord, contractDocumentPreview]);

  const [authorizeBusy, setAuthorizeBusy] = useState(false);
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);

  /**
   * The ONLY write in this section, gated on `evaluateAuthorizationEligibility`
   * both here (before attempting) and again inside
   * `buildAuthorizationRecordArgs` itself (never trusts a single check).
   * Records a fact only -- no e-sign send, no pipeline-stage write, no
   * Contract Sent/Under Contract transition. Uses the SAME sanctioned
   * `ghl.notes.create()` write every other group on this page already uses.
   */
  async function handleAuthorize() {
    if (screen.state !== "ready" || !contractDocumentPreview || !documentVersion) return;
    setAuthorizeError(null);
    const built = buildAuthorizationRecordArgs({
      opportunityId: screen.opportunity.id,
      at: new Date().toISOString(),
      preview: contractDocumentPreview,
      currentVersion: documentVersion,
    });
    if (!built.ok) {
      setAuthorizeError(built.reasons.map((r) => r.message).join(" "));
      return;
    }
    setAuthorizeBusy(true);
    const note = formatBradContractAuthorizationNote(built.value);
    try {
      await ghl.notes.create(contactId, note);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: note, dateAdded: built.value.at }]);
    } catch (e: any) {
      setAuthorizeError(e?.message ?? "Couldn't save the authorization -- it is not yet in effect. Try again.");
    } finally {
      setAuthorizeBusy(false);
    }
  }

  /**
   * B9-08 / INV-63 -- Contract Sent: e-signature sending via GHL Documents
   * & Contracts, and recording Contract Sent only after verified provider
   * acceptance.
   *
   * `existingSend` is read fresh from notes every render, same "latest
   * wins scoped to one Opportunity" discipline as every other B9 carrier
   * on this page -- never a component-owned copy that could drift from
   * what is actually durable.
   */
  const existingSend = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestContractSendForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const sendEligibility = useMemo(() => {
    if (!contractDocumentPreview) return null;
    return evaluateSendEligibility({
      authRecord: bradAuthorizationRecord,
      preview: contractDocumentPreview,
      existingSend,
      populationVerification: getRuntimeConfig().documentsContracts.populationVerification,
    });
  }, [contractDocumentPreview, bradAuthorizationRecord, existingSend]);

  /**
   * INV-63 correction round -- item 2 pre-flight drift check. Compares the
   * locked, config-projected `templateId`/`expectedTemplateName` (never
   * client-chosen; `ghl-proxy.ts`'s GATE 2 enforces the same id server-side
   * regardless) against a live `listTemplates()` lookup, so a renamed,
   * deleted, or missing GHL template surfaces BEFORE Send is offered,
   * instead of only as an opaque provider failure. Runs once per mount
   * (and again if the opportunity changes) -- a live template rename
   * between this check and an actual click is still possible and is not
   * claimed to be closed; the readback stage (`classifyDocumentReadback`)
   * is the actual authoritative, send-time check.
   */
  const [templateDriftCheck, setTemplateDriftCheck] = useState<
    { kind: "checking" } | { kind: "ok" } | { kind: "problem"; message: string }
  >({ kind: "checking" });
  useEffect(() => {
    let cancelled = false;
    setTemplateDriftCheck({ kind: "checking" });
    const { templateId, expectedTemplateName } = getRuntimeConfig().documentsContracts;
    ghl.proposals
      .listTemplates({ name: expectedTemplateName })
      .then((found) => {
        if (cancelled) return;
        const match = (found.data ?? []).find((t) => t.id === templateId);
        if (!match) {
          setTemplateDriftCheck({ kind: "problem", message: `The locked GHL template id (${templateId}) was not found in IAOS Test -- it may have been deleted or the Test location has changed. Sending is refused until this is resolved.` });
        } else if (match.deleted) {
          setTemplateDriftCheck({ kind: "problem", message: `The locked GHL template has been deleted in GHL. Sending is refused until a template is restored or the configuration is updated.` });
        } else if (match.name !== expectedTemplateName) {
          setTemplateDriftCheck({ kind: "problem", message: `The locked GHL template's name is now "${match.name}", not the expected "${expectedTemplateName}" -- this could mean the wrong template is configured. Verify in GHL before sending.` });
        } else {
          setTemplateDriftCheck({ kind: "ok" });
        }
      })
      .catch((e: any) => {
        if (!cancelled) setTemplateDriftCheck({ kind: "problem", message: e?.message ?? "Could not verify the GHL template's identity before offering Send." });
      });
    return () => { cancelled = true; };
  }, [screen.state === "ready" ? screen.opportunity.id : null]);

  const contractSentEvidence = useMemo(() => {
    if (!contractDocumentPreview || screen.state !== "ready") return null;
    return buildContractSentEvidence({
      contractReady: screen.readiness.ready,
      authRecord: bradAuthorizationRecord,
      currentPreview: contractDocumentPreview,
      send: existingSend,
    });
  }, [contractDocumentPreview, screen, bradAuthorizationRecord, existingSend]);

  const contractSentStatus = useMemo(() => {
    if (!contractSentEvidence) return null;
    return evaluateContractSentEligibility(contractSentEvidence);
  }, [contractSentEvidence]);

  const [sendExpirationDraft, setSendExpirationDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  /**
   * The ONLY write path that reaches GHL Documents & Contracts. Correction
   * round, 2026-09-11 -- now THREE stages instead of two:
   *
   * (1) RESERVE. The "in_progress" note is written via
   *     `ghl.proposals.reserveSend()` -- a dedicated server-side function
   *     that re-checks for a conflicting pending/accepted send against
   *     FRESH notes before writing, closing (narrowing -- GHL's Notes API
   *     has no compare-and-swap primitive) the two-tabs-both-send race a
   *     purely client-side check could not (item 7). `ghl.notes.create()`
   *     is never called directly for this note.
   * (2) SEND. The provider POST. `templateId` is the LOCKED, config-
   *     verified id (item 2 -- never a live name search); `contactId`/
   *     `userId`/`templateId` are all still unconditionally overwritten
   *     server-side by `ghl-proxy.ts`'s GATE 2 regardless of what is sent
   *     here, and that same GATE refuses the call outright while template
   *     population is unverified (see `sendEligibility`'s own
   *     `TEMPLATE_POPULATION_NOT_VERIFIED` check, which mirrors it
   *     client-side for an honest UI, but the server enforces it
   *     independently). `classifyProviderSendResponse` can only ever
   *     yield `"provider_accepted_pending_readback"`, never `"accepted"`
   *     (item 5 -- "a successful POST response is not sufficient").
   * (3) READBACK. Only reached if (2) provisionally succeeded: an
   *     independent `GET /proposals/document` confirms the actual
   *     created document -- its recipient, its sender, its environment,
   *     and whether it carries any real fillable field at all
   *     (`classifyDocumentReadback`). Contract Sent can only ever be
   *     recorded from THIS stage's own "accepted" verdict.
   */
  async function handleSend() {
    if (screen.state !== "ready" || !contractDocumentPreview || !sellerContractFactsReport) return;
    setSendError(null);

    const expirationAtIso = sendExpirationDraft ? new Date(sendExpirationDraft).toISOString() : "";
    if (!sendExpirationDraft || Number.isNaN(new Date(sendExpirationDraft).getTime())) {
      setSendError("An explicit expiration date/time is required before sending -- it is never assumed or defaulted.");
      return;
    }

    const { templateId: requestedTemplateId } = getRuntimeConfig().documentsContracts;
    const requestAt = new Date().toISOString();
    const built = buildSendAttemptArgs({
      opportunityId: screen.opportunity.id,
      operator: null,
      requestAt,
      report: sellerContractFactsReport,
      preview: contractDocumentPreview,
      authRecord: bradAuthorizationRecord,
      existingSend,
      requestedTemplateId,
      expirationAt: expirationAtIso,
      populationVerification: getRuntimeConfig().documentsContracts.populationVerification,
    });
    if (!built.ok) {
      setSendError(built.reasons.map((r) => r.message).join(" "));
      return;
    }

    setSendBusy(true);
    const attempt = built.value;
    const attemptNote = formatContractSendNote(attempt);

    // Stage 1: RESERVE, server-side, best-effort (NOT atomic --
    // single-user V1 protection only, see ghl-contract-send-reserve.ts)
    // check-then-write.
    const reservation = await ghl.proposals.reserveSend({
      contactId,
      opportunityId: screen.opportunity.id,
      versionRaw: JSON.stringify(attempt.version),
      noteBody: attemptNote,
    });
    if (!reservation.ok) {
      setSendError(
        reservation.status === 409
          ? "A pending or accepted send already exists for this exact revision (confirmed server-side just now) -- refusing to start a second one."
          : `Couldn't reserve the send attempt (HTTP ${reservation.status}): ${reservation.reason} -- refusing to call the provider without a durable, server-confirmed in-progress record.`,
      );
      setSendBusy(false);
      return;
    }
    setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: attemptNote, dateAdded: attempt.at }]);

    // Stage 2: SEND -- redeems the reservation ticket just created above.
    // versionRaw/attemptId must be the EXACT SAME values the reservation
    // note itself carries, so the server-side execute function's ticket
    // lookup resolves to this same attempt.
    const sendOutcome = await ghl.proposals.send({
      templateId: requestedTemplateId,
      opportunityId: screen.opportunity.id,
      versionRaw: JSON.stringify(attempt.version),
      attemptId: attempt.attemptId,
    });
    const postObservedAt = new Date().toISOString();
    const postClassification = classifyProviderSendResponse(sendOutcome);
    const provisionalArgs = buildSendResultArgs({ attempt, operator: null, observedAt: postObservedAt, classification: postClassification });
    const provisionalNote = formatContractSendNote(provisionalArgs);
    try {
      await ghl.notes.create(contactId, provisionalNote);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: provisionalNote, dateAdded: provisionalArgs.at }]);
    } catch (e: any) {
      setSendError(
        `The provider call resolved (${postClassification.status}) but recording the result failed: ${e?.message ?? "unknown error"} -- reload and check GHL notes directly before retrying.`,
      );
      setSendBusy(false);
      return;
    }

    if (postClassification.status !== "provider_accepted_pending_readback") {
      setSendError(postClassification.failureReason ?? "The provider did not accept this send.");
      setSendBusy(false);
      return;
    }

    // Stage 3: READBACK -- the only path to "accepted" (item 5). Server-side
    // (`ghl-contract-send-readback.ts`): the cross-checks against the TRUE
    // expected sender/recipient require secrets this browser is never
    // given, so classification happens there, never here.
    const documentId = postClassification.summary?.documentId ?? "";
    const readbackObservedAt = new Date().toISOString();
    const readbackClassification = documentId
      ? await ghl.proposals.readback({ documentId })
      : { status: "ambiguous" as const, summary: null, failureReason: "The provider response carried no documentId to read back." };
    const finalArgs = buildReadbackResultArgs({
      attempt,
      provisional: provisionalArgs,
      operator: null,
      observedAt: readbackObservedAt,
      classification: readbackClassification,
    });
    const finalNote = formatContractSendNote(finalArgs);
    try {
      await ghl.notes.create(contactId, finalNote);
      setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: finalNote, dateAdded: finalArgs.at }]);
      if (readbackClassification.status !== "accepted") {
        setSendError(readbackClassification.failureReason ?? "Readback did not confirm acceptance.");
      } else {
        setSendExpirationDraft("");
      }
    } catch (e: any) {
      setSendError(
        `Readback resolved (${readbackClassification.status}) but recording the final result failed: ${e?.message ?? "unknown error"} -- reload and check GHL notes directly before retrying.`,
      );
    } finally {
      setSendBusy(false);
    }
  }

  // Read-only display of the operator's own verbatim attorney/manual text
  // -- shown back exactly as supplied, never interpreted, never drafted.
  const attorneySpecialProvisionsText = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    const rec = latestAttorneyManualFieldDispositionForOpportunity(notes, screen.opportunity.id, "special_provisions");
    return rec && rec.disposition.kind === "provided_verbatim" ? rec.disposition.text : null;
  }, [screen, notes]);
  const attorneyOtherAddendaText = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    const rec = latestAttorneyManualFieldDispositionForOpportunity(notes, screen.opportunity.id, "other_addenda_text");
    return rec && rec.disposition.kind === "provided_verbatim" ? rec.disposition.text : null;
  }, [screen, notes]);

  const nextUnresolvedAction = useMemo(() => {
    if (!sellerContractFactsReadiness) return null;
    if (sellerContractFactsReadiness.unresolvedFields.length > 0) {
      const first = sellerContractFactsReadiness.unresolvedFields[0];
      return { group: first.group, label: `${GROUP_LABEL_BY_KEY[first.group] ?? first.group} — ${FIELD_LABELS[`${first.group}.${first.field}`] ?? first.field}` };
    }
    if (sellerContractFactsReport && sellerContractFactsReport.priceConflicts.length > 0) {
      return { group: "salesPrice", label: `Resolve ${sellerContractFactsReport.priceConflicts.length} price/property conflict(s) against the authoritative accepted agreement` };
    }
    return null;
  }, [sellerContractFactsReadiness, sellerContractFactsReport]);

  /* ------------------------------------------------------------------ */
  /* Per-group save handlers -- each wired ONLY to its own group's Save   */
  /* button below, each calling the SAME sanctioned write.                */
  /* ------------------------------------------------------------------ */

  async function handleSaveSigner() {
    if (screen.state !== "ready") return;
    if (drafts.signer.role.trim() === "" || drafts.signer.displayName.trim() === "") {
      setGroupError("parties", "Role and name are both required.");
      return;
    }
    const at = new Date().toISOString();
    const note = formatPartySignerFactsNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      signers: [{ role: drafts.signer.role, displayName: drafts.signer.displayName, signingAuthorityNote: drafts.signer.signingAuthorityNote.trim() === "" ? null : drafts.signer.signingAuthorityNote }],
    });
    await commitNote("parties", note);
  }

  async function handleSaveBuyerOverride() {
    if (screen.state !== "ready") return;
    if (!drafts.buyerOverride.active) return;
    if (drafts.buyerOverride.buyerName.trim() === "" || drafts.buyerOverride.reason.trim() === "") {
      setGroupError("parties", "An override needs both a buyer name and a reason -- never a silent substitution.");
      return;
    }
    const at = new Date().toISOString();
    const note = formatBuyerEntityOverrideNote({ opportunityId: screen.opportunity.id, at, operator: null, buyerName: drafts.buyerOverride.buyerName, reason: drafts.buyerOverride.reason });
    await commitNote("parties", note);
  }

  async function handleSaveLegalDesc() {
    if (screen.state !== "ready") return;
    const lot = valueOrNoneToFact(drafts.legalDesc.lot);
    const block = valueOrNoneToFact(drafts.legalDesc.block);
    const addition = valueOrNoneToFact(drafts.legalDesc.addition);
    const county = valueOrNoneToFact(drafts.legalDesc.county);
    const exclusions = valueOrNoneToFact(drafts.legalDesc.exclusions);
    if (!lot || !block || !addition || !county || !exclusions) {
      setGroupError("propertyLegalDescription", "Every field needs a value, or select None explicitly.");
      return;
    }
    let reservations: ReservationsFact;
    if (drafts.legalDesc.reservationsKind === "none") {
      reservations = { kind: "none" };
    } else {
      if (drafts.legalDesc.reservationsNote.trim() === "") {
        setGroupError("propertyLegalDescription", "Describe the reservation, or select None.");
        return;
      }
      reservations = { kind: "applies", addendumNote: drafts.legalDesc.reservationsNote };
    }
    const at = new Date().toISOString();
    const note = formatPropertyLegalDescriptionFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, lot, block, addition, county, exclusions, reservations });
    await commitNote("propertyLegalDescription", note);
  }

  async function handleSaveLease() {
    if (screen.state !== "ready") return;
    let naturalResourceLeases: NaturalResourceLeaseFact;
    if (drafts.lease.naturalKind === "not_yet_delivered") {
      const days = Number(drafts.lease.naturalDays);
      if (!Number.isInteger(days) || days <= 0) {
        setGroupError("leaseDisclosure", "Enter a positive whole number of days, or choose None/Delivered.");
        return;
      }
      naturalResourceLeases = { kind: "not_yet_delivered", terminateWithinDays: days };
    } else {
      naturalResourceLeases = { kind: drafts.lease.naturalKind };
    }
    const at = new Date().toISOString();
    const note = formatLeaseDisclosureFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, residentialLeases: drafts.lease.residentialLeases, fixtureLeases: drafts.lease.fixtureLeases, naturalResourceLeases });
    await commitNote("leaseDisclosure", note);
  }

  async function handleSaveEarnest() {
    if (screen.state !== "ready") return;
    if (drafts.earnest.escrowAgentName.trim() === "" || drafts.earnest.escrowAgentAddress.trim() === "") {
      setGroupError("earnestMoneyOption", "Escrow agent name and address are both required.");
      return;
    }
    const earnestMoney = amountOrNoneToFact(drafts.earnest.earnestMoney);
    if (!earnestMoney) { setGroupError("earnestMoneyOption", "Earnest money needs a positive amount, or select None/$0 explicitly."); return; }
    const optionFee = amountOrNoneToFact(drafts.earnest.optionFee);
    if (!optionFee) { setGroupError("earnestMoneyOption", "Option fee needs a positive amount, or select None/$0 explicitly."); return; }
    const optionPeriodDays = daysOrNoneToFact(drafts.earnest.optionPeriodDays);
    if (!optionPeriodDays) { setGroupError("earnestMoneyOption", "Option period needs a positive whole number of days, or select No option period explicitly."); return; }
    if (drafts.earnest.additionalKind === "unset") {
      setGroupError("earnestMoneyOption", "Additional earnest money needs an explicit applicable/not-applicable decision -- it is never assumed.");
      return;
    }
    let additionalEarnestMoney: AdditionalEarnestMoneyFact;
    if (drafts.earnest.additionalKind === "none") {
      additionalEarnestMoney = { kind: "none" };
    } else {
      const amount = Number(drafts.earnest.additionalAmount);
      const withinDays = Number(drafts.earnest.additionalWithinDays);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(withinDays) || withinDays <= 0) {
        setGroupError("earnestMoneyOption", "Additional earnest money needs a positive amount and a positive whole number of days.");
        return;
      }
      additionalEarnestMoney = { kind: "value", amount, withinDays };
    }
    const at = new Date().toISOString();
    const note = formatEarnestMoneyOptionFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, escrowAgentName: drafts.earnest.escrowAgentName, escrowAgentAddress: drafts.earnest.escrowAgentAddress, earnestMoney, optionFee, optionPeriodDays, additionalEarnestMoney });
    await commitNote("earnestMoneyOption", note);
  }

  async function handleSaveTitleSurvey() {
    if (screen.state !== "ready") return;
    if (drafts.titleSurvey.titleCompanyName.trim() === "") { setGroupError("titleSurvey", "Title company name is required."); return; }
    const objectionsText = valueOrNoneToFact(drafts.titleSurvey.objectionsText);
    if (!objectionsText) { setGroupError("titleSurvey", "Title objections needs a value, or select None explicitly."); return; }
    const objectionsDays = Number(drafts.titleSurvey.objectionsDays);
    if (!Number.isInteger(objectionsDays) || objectionsDays < 0) { setGroupError("titleSurvey", "Objection days must be a whole number (0 or more)."); return; }
    const shortageAmendmentElection: ShortageAmendmentElection = drafts.titleSurvey.shortageKind === "not_amended" ? { kind: "not_amended" } : { kind: "amended", expenseParty: drafts.titleSurvey.shortageExpenseParty };
    let surveyElection: SurveyElection;
    if (drafts.titleSurvey.surveyOption === "seller_existing_survey") {
      const days = Number(drafts.titleSurvey.sellerFurnishDays);
      if (!Number.isInteger(days) || days <= 0) { setGroupError("titleSurvey", "Seller-furnish days must be a positive whole number."); return; }
      surveyElection = { option: "seller_existing_survey", sellerFurnishDays: days, ifRejectedExpenseParty: drafts.titleSurvey.ifRejectedExpenseParty };
    } else if (drafts.titleSurvey.surveyOption === "buyer_new_survey") {
      const days = Number(drafts.titleSurvey.buyerObtainDays);
      if (!Number.isInteger(days) || days <= 0) { setGroupError("titleSurvey", "Buyer-obtain days must be a positive whole number."); return; }
      surveyElection = { option: "buyer_new_survey", buyerObtainDays: days };
    } else {
      const days = Number(drafts.titleSurvey.sellerFurnishDays);
      if (!Number.isInteger(days) || days <= 0) { setGroupError("titleSurvey", "Seller-furnish days must be a positive whole number."); return; }
      surveyElection = { option: "seller_new_survey", sellerFurnishDays: days };
    }
    const at = new Date().toISOString();
    const note = formatTitleSurveyFactsNote({
      opportunityId: screen.opportunity.id, at, operator: null,
      titlePolicyExpenseParty: drafts.titleSurvey.titlePolicyExpenseParty, titleCompanyName: drafts.titleSurvey.titleCompanyName,
      shortageAmendmentElection, surveyElection, objectionsText, objectionsDays, poaMembership: drafts.titleSurvey.poaMembership,
    });
    await commitNote("titleSurvey", note);
  }

  async function handleSavePropertyCondition() {
    if (screen.state !== "ready") return;
    let sellerDisclosureNotice: SellerDisclosureNoticeFact;
    if (drafts.propertyCondition.disclosureKind === "not_yet_received") {
      const days = Number(drafts.propertyCondition.disclosureDays);
      if (!Number.isInteger(days) || days <= 0) { setGroupError("propertyCondition", "Disclosure delivery days must be a positive whole number."); return; }
      sellerDisclosureNotice = { kind: "not_yet_received", deliverWithinDays: days };
    } else {
      sellerDisclosureNotice = { kind: drafts.propertyCondition.disclosureKind };
    }
    let asIsElection: AsIsElectionFact;
    if (drafts.propertyCondition.asIsKind === "as_is_with_repairs") {
      if (drafts.propertyCondition.repairsText.trim() === "") { setGroupError("propertyCondition", "Describe the specified repairs, or select plain As-is."); return; }
      asIsElection = { kind: "as_is_with_repairs", repairsText: drafts.propertyCondition.repairsText };
    } else {
      asIsElection = { kind: "as_is" };
    }
    const serviceContractCap = valueOrNoneToFact(drafts.propertyCondition.serviceContractCap);
    if (!serviceContractCap) { setGroupError("propertyCondition", "Service contract cap needs a value, or select None explicitly."); return; }
    let waterDisclosure: WaterDisclosureFact;
    if (drafts.propertyCondition.waterKind === "not_yet_received") {
      const days = Number(drafts.propertyCondition.waterDays);
      if (!Number.isInteger(days) || days <= 0) { setGroupError("propertyCondition", "Water disclosure delivery days must be a positive whole number."); return; }
      waterDisclosure = { kind: "not_yet_received", deliverWithinDays: days };
    } else if (drafts.propertyCondition.waterKind === "exempt") {
      if (drafts.propertyCondition.waterSource.trim() === "") { setGroupError("propertyCondition", "Name the water source to confirm the exemption."); return; }
      waterDisclosure = { kind: "exempt", noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: drafts.propertyCondition.waterSource };
    } else {
      waterDisclosure = { kind: "received" };
    }
    const at = new Date().toISOString();
    const note = formatPropertyConditionFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, sellerDisclosureNotice, asIsElection, serviceContractCap, waterDisclosure });
    await commitNote("propertyCondition", note);
  }

  async function handleSaveClosingPossession() {
    if (screen.state !== "ready") return;
    if (drafts.closingPossession.closingDate.trim() === "") { setGroupError("closingPossession", "Closing date is required."); return; }
    const closingDate = new Date(`${drafts.closingPossession.closingDate}T00:00:00.000Z`).toISOString();
    const possessionDetails = valueOrNoneToFact(drafts.closingPossession.possessionDetails);
    if (!possessionDetails) { setGroupError("closingPossession", "Possession details needs a value, or select None explicitly."); return; }
    const at = new Date().toISOString();
    const note = formatClosingPossessionFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, closingDate, possessionElection: drafts.closingPossession.possessionElection, possessionDetails });
    await commitNote("closingPossession", note);
  }

  async function handleSaveSettlement() {
    if (screen.state !== "ready") return;
    const sellerCreditCap = valueOrNoneToFact(drafts.settlement.sellerCreditCap);
    if (!sellerCreditCap) { setGroupError("settlementExpense", "Seller expense credit cap needs a value, or select None explicitly."); return; }
    function toContribution(kind: "none" | "dollar" | "percent", amountText: string, percentText: string): BrokerageContribution | null {
      if (kind === "none") return { kind: "none" };
      if (kind === "dollar") { const n = Number(amountText); return Number.isFinite(n) && n > 0 ? { kind: "dollar", amount: n } : null; }
      const n = Number(percentText); return Number.isFinite(n) && n > 0 && n <= 100 ? { kind: "percent", percent: n } : null;
    }
    const sellerPaysBuyerBroker = toContribution(drafts.settlement.sellerPaysKind, drafts.settlement.sellerPaysAmount, drafts.settlement.sellerPaysPercent);
    if (!sellerPaysBuyerBroker) { setGroupError("settlementExpense", "Seller-pays-buyer's-broker needs a valid amount or percent, or select None."); return; }
    const buyerPaysSellerBroker = toContribution(drafts.settlement.buyerPaysKind, drafts.settlement.buyerPaysAmount, drafts.settlement.buyerPaysPercent);
    if (!buyerPaysSellerBroker) { setGroupError("settlementExpense", "Buyer-pays-seller's-broker needs a valid amount or percent, or select None."); return; }
    const at = new Date().toISOString();
    const note = formatSettlementExpenseFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, sellerCreditCap, sellerPaysBuyerBroker, buyerPaysSellerBroker });
    await commitNote("settlementExpense", note);
  }

  async function handleSaveRepresentation() {
    if (screen.state !== "ready") return;
    let representation: RepresentationFact;
    if (drafts.representation.kind === "none") {
      representation = { kind: "none" };
    } else {
      function toBrokerInfo(present: boolean, d: BrokerDraft): BrokerInfo | null | "invalid" {
        if (!present) return null;
        for (const f of BROKER_FIELDS) if (d[f.key].trim() === "") return "invalid";
        return { ...d };
      }
      const sellerAgent = toBrokerInfo(drafts.representation.sellerAgentPresent, drafts.representation.sellerAgent);
      if (sellerAgent === "invalid") { setGroupError("representation", "Seller's agent needs every field filled in, or uncheck \"agent present.\""); return; }
      const buyerAgent = toBrokerInfo(drafts.representation.buyerAgentPresent, drafts.representation.buyerAgent);
      if (buyerAgent === "invalid") { setGroupError("representation", "Buyer's agent needs every field filled in, or uncheck \"agent present.\""); return; }
      representation = { kind: "represented", sellerAgent, buyerAgent };
    }
    const at = new Date().toISOString();
    const note = formatRepresentationFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, representation });
    await commitNote("representation", note);
  }

  async function handleSaveAddenda() {
    if (screen.state !== "ready") return;
    const districtNotices = valueOrNoneToFact(drafts.addenda.districtNotices);
    if (!districtNotices) { setGroupError("addendaApplicability", "District notices needs a value, or select None explicitly."); return; }
    const at = new Date().toISOString();
    const note = formatAddendaApplicabilityFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, items: drafts.addenda.items, districtNotices });
    await commitNote("addendaApplicability", note);
  }

  async function handleSaveSellerEquitable() {
    if (screen.state !== "ready") return;
    const at = new Date().toISOString();
    const disposition: EquitableInterestDisposition = drafts.sellerEquitable.kind === "made" ? { kind: "made", at } : { kind: "not_yet_made" };
    const note = formatSellerEquitableInterestDisclosureNote({ opportunityId: screen.opportunity.id, at, operator: null, disposition });
    await commitNote("sellerEquitableInterest", note);
  }

  async function handleSaveAttorneyField(slot: AttorneyManualFieldSlot) {
    if (screen.state !== "ready") return;
    const draft = slot === "special_provisions" ? drafts.attorneySpecial : drafts.attorneyOther;
    const groupKey = "attorneyManualFields";
    let disposition: AttorneyManualFieldDisposition;
    if (draft.kind === "provided_verbatim") {
      if (draft.text.trim() === "") { setGroupError(groupKey, "Paste the exact verbatim text, or choose a different disposition."); return; }
      disposition = { kind: "provided_verbatim", text: draft.text };
    } else {
      disposition = { kind: draft.kind };
    }
    const at = new Date().toISOString();
    const note = formatAttorneyManualFieldDispositionNote({ opportunityId: screen.opportunity.id, at, operator: null, slot, disposition });
    await commitNote(groupKey, note);
  }

  async function handleSaveBuyerBusinessConfig() {
    if (screen.state !== "ready") return;
    const { noticeAddress, noticePhone, noticeEmail, signerName, signerRole } = drafts.buyerBusinessConfig;
    if ([noticeAddress, noticePhone, noticeEmail, signerName, signerRole].some((v) => v.trim() === "")) {
      setGroupError("buyerBusinessConfig", "Every field is required -- BTC LLC's real notice and signer info, not a placeholder.");
      return;
    }
    const at = new Date().toISOString();
    const note = formatBuyerBusinessConfigFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, noticeAddress, noticePhone, noticeEmail, signerName, signerRole });
    await commitNote("buyerBusinessConfig", note);
  }

  async function handleSaveSellerNotice() {
    if (screen.state !== "ready") return;
    if (drafts.sellerNotice.noticeAddress.trim() === "") { setGroupError("sellerNotice", "Notice address is required."); return; }
    const noticePhone = valueOrNoneToFact(drafts.sellerNotice.noticePhone);
    if (!noticePhone) { setGroupError("sellerNotice", "Notice phone needs a value, or select None explicitly."); return; }
    const noticeEmail = valueOrNoneToFact(drafts.sellerNotice.noticeEmail);
    if (!noticeEmail) { setGroupError("sellerNotice", "Notice email needs a value, or select None explicitly."); return; }
    const phoneMatchesCandidate = sellerNoticeCandidate.phone === "" ? noticePhone.kind === "none" : (noticePhone.kind === "value" && noticePhone.value === sellerNoticeCandidate.phone);
    const emailMatchesCandidate = sellerNoticeCandidate.email === "" ? noticeEmail.kind === "none" : (noticeEmail.kind === "value" && noticeEmail.value === sellerNoticeCandidate.email);
    const addressMatchesCandidate = sellerNoticeCandidate.address !== "" && drafts.sellerNotice.noticeAddress === sellerNoticeCandidate.address;
    const source: SellerNoticeSource = addressMatchesCandidate && phoneMatchesCandidate && emailMatchesCandidate ? "confirmed_from_contact_record" : "operator_corrected";
    const at = new Date().toISOString();
    const note = formatSellerNoticeConfirmationFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, noticeAddress: drafts.sellerNotice.noticeAddress, noticePhone, noticeEmail, source });
    await commitNote("sellerNotice", note);
  }

  /**
   * The ONLY write this page performs outside the groups above, wired
   * exclusively to a checkbox's own `onChange` below. Reuses the EXISTING
   * sanctioned write verbatim -- no new carrier.
   */
  async function handleToggleChecklistItem(key: ContractReadyItemKey, checked: boolean) {
    if (screen.state !== "ready") return;
    setChecklistError(null);
    setChecklistBusy(key);
    const at = new Date().toISOString();
    const items: ContractReadyItems = { ...screen.checklistItems, [key]: checked };
    const note = formatContractReadyChecklistNote({
      opportunityId: screen.opportunity.id, at, operator: null, agreementAt: screen.economics.agreementAt,
      agreedPrice: screen.agreedPrice, propertyAddress: screen.propertyAddress, items,
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

          {screen.readiness.reasons.length > 0 ? (
            <ul data-testid="contract-ready-reasons" style={{ margin: "0 0 16px", padding: "0 0 0 18px", fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }}>
              {screen.readiness.reasons.map((r) => (
                <li key={r.code} data-testid={`contract-reason-${r.code}`}>{r.message}</li>
              ))}
            </ul>
          ) : null}

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

          <div data-testid="contract-next-action" style={{ fontSize: "12px", color: "#94A3B8" }}>
            {screen.readiness.ready
              ? "Contract Ready. Sending the agreement for signature is not yet built in IAOS — no further action is available here."
              : "Complete the checklist above to reach Contract Ready."}
          </div>

          {sellerContractFactsReport && sellerContractFactsReadiness ? (
            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "6px" }}>
                Seller Contract Facts — TREC 20-19 (One to Four Family Residential Contract (Resale))
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                Supported V1 path: Cash Acquisition / Assignment Exit. Buyer: {sellerContractFactsReport.parties.buyerEntityName.kind === "populated" ? sellerContractFactsReport.parties.buyerEntityName.value : "unresolved"}.
              </div>

              <div
                data-testid="contract-facts-send-gate"
                style={{
                  display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px",
                  fontSize: "13px", fontWeight: 700, color: sellerContractFactsReadiness.blocksSendForSignature ? "#F59E0B" : "#22C55E",
                }}
              >
                {sellerContractFactsReadiness.blocksSendForSignature ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
                {sellerContractFactsReadiness.blocksSendForSignature
                  ? `Send for Signature blocked — ${sellerContractFactsReadiness.unresolvedFields.length} unresolved field(s)${sellerContractFactsReport.priceConflicts.length > 0 ? `, ${sellerContractFactsReport.priceConflicts.length} price conflict(s)` : ""}`
                  : "Every execution-material field is populated or confirmed not applicable"}
              </div>

              {nextUnresolvedAction ? (
                <a
                  href={`#contract-facts-group-${nextUnresolvedAction.group}`}
                  data-testid="contract-facts-next-action"
                  style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px", fontSize: "12px", color: "#1EC8FF", textDecoration: "none" }}
                >
                  <ArrowRight size={13} /> Next: {nextUnresolvedAction.label}
                </a>
              ) : null}

              <div data-testid="contract-facts-groups" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {SELLER_CONTRACT_FACT_GROUPS.map((group) => {
                  const groupValue = sellerContractFactsReport[group.key] as Record<string, FieldDisposition<unknown>>;
                  return (
                    <div key={String(group.key)} id={`contract-facts-group-${String(group.key)}`} data-testid={`contract-facts-group-${String(group.key)}`} style={groupCardStyle}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>{group.label}</div>
                      <div style={{ fontSize: "11px", lineHeight: 1.7 }}>
                        {Object.entries(groupValue)
                          .filter(([, v]) => v !== null && typeof v === "object" && "kind" in (v as object))
                          .map(([field, disposition]) => {
                          const { text, color } = renderFieldValue(String(group.key), field, disposition);
                          const label = FIELD_LABELS[`${String(group.key)}.${field}`] ?? humanizeKey(field);
                          return (
                            <div key={field} data-testid={`contract-fact-${String(group.key)}-${field}`}>
                              <span style={{ color: "#64748B" }}>{label}:</span> <span style={{ color }}>{text}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* -------------------------------------------------- */}
                      {/* Parties (¶1)                                        */}
                      {/* -------------------------------------------------- */}
                      {group.key === "parties" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Role"><TextField testId="contract-fact-input-signer-role" value={drafts.signer.role} onChange={(v) => updateDraft("signer", { role: v })} placeholder="Seller" /></Field>
                            <Field label="Name"><TextField testId="contract-fact-input-signer-name" value={drafts.signer.displayName} onChange={(v) => updateDraft("signer", { displayName: v })} placeholder="Jane Doe" /></Field>
                            <Field label="Signing authority note (optional)"><TextField testId="contract-fact-input-signer-note" value={drafts.signer.signingAuthorityNote} onChange={(v) => updateDraft("signer", { signingAuthorityNote: v })} placeholder="e.g. POA on file" /></Field>
                            <Btn testId="contract-fact-save-signer" onClick={handleSaveSigner} busy={busyGroup === "parties"}>Save signer</Btn>
                          </div>
                          <div style={rowStyle}>
                            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94A3B8" }}>
                              <input type="checkbox" data-testid="contract-fact-input-buyer-override-active" checked={drafts.buyerOverride.active} onChange={(e) => updateDraft("buyerOverride", { active: e.target.checked })} />
                              Override buyer entity for this deal (rare)
                            </label>
                            {drafts.buyerOverride.active ? (
                              <>
                                <TextField testId="contract-fact-input-buyer-override-name" value={drafts.buyerOverride.buyerName} onChange={(v) => updateDraft("buyerOverride", { buyerName: v })} placeholder="Override buyer name" />
                                <TextField testId="contract-fact-input-buyer-override-reason" value={drafts.buyerOverride.reason} onChange={(v) => updateDraft("buyerOverride", { reason: v })} placeholder="Reason (required)" />
                                <Btn testId="contract-fact-save-buyer-override" onClick={handleSaveBuyerOverride} busy={busyGroup === "parties"}>Save override</Btn>
                              </>
                            ) : null}
                          </div>
                          <ErrorText testId="contract-fact-error-parties">{groupErrors.parties ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Property Legal Description (¶2)                    */}
                      {/* -------------------------------------------------- */}
                      {group.key === "propertyLegalDescription" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Lot"><ValueOrNoneField testId="contract-fact-input-lot" value={drafts.legalDesc.lot} onChange={(v) => updateDraft("legalDesc", { lot: v })} /></Field>
                            <Field label="Block"><ValueOrNoneField testId="contract-fact-input-block" value={drafts.legalDesc.block} onChange={(v) => updateDraft("legalDesc", { block: v })} /></Field>
                            <Field label="Addition"><ValueOrNoneField testId="contract-fact-input-addition" value={drafts.legalDesc.addition} onChange={(v) => updateDraft("legalDesc", { addition: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="County"><ValueOrNoneField testId="contract-fact-input-county" value={drafts.legalDesc.county} onChange={(v) => updateDraft("legalDesc", { county: v })} /></Field>
                            <Field label="Exclusions"><ValueOrNoneField testId="contract-fact-input-exclusions" value={drafts.legalDesc.exclusions} onChange={(v) => updateDraft("legalDesc", { exclusions: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Reservations"><SelectField testId="contract-fact-input-reservations-kind" value={drafts.legalDesc.reservationsKind} onChange={(v) => updateDraft("legalDesc", { reservationsKind: v })} options={[{ value: "none", label: "None" }, { value: "applies", label: "Applies" }]} /></Field>
                            {drafts.legalDesc.reservationsKind === "applies" ? <TextField testId="contract-fact-input-reservations-note" value={drafts.legalDesc.reservationsNote} onChange={(v) => updateDraft("legalDesc", { reservationsNote: v })} placeholder="Describe the reservation" /> : null}
                            <Btn testId="contract-fact-save-legal-desc" onClick={handleSaveLegalDesc} busy={busyGroup === "propertyLegalDescription"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-propertyLegalDescription">{groupErrors.propertyLegalDescription ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Leases (¶4)                                         */}
                      {/* -------------------------------------------------- */}
                      {group.key === "leaseDisclosure" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Residential leases"><SelectField testId="contract-fact-input-residential-leases" value={drafts.lease.residentialLeases} onChange={(v) => updateDraft("lease", { residentialLeases: v })} options={[{ value: "none", label: "None" }, { value: "applies", label: "Applies" }]} /></Field>
                            <Field label="Fixture leases"><SelectField testId="contract-fact-input-fixture-leases" value={drafts.lease.fixtureLeases} onChange={(v) => updateDraft("lease", { fixtureLeases: v })} options={[{ value: "none", label: "None" }, { value: "applies", label: "Applies" }]} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Natural resource leases"><SelectField testId="contract-fact-input-natural-leases-kind" value={drafts.lease.naturalKind} onChange={(v) => updateDraft("lease", { naturalKind: v })} options={[{ value: "none", label: "None" }, { value: "delivered", label: "Delivered" }, { value: "not_yet_delivered", label: "Not yet delivered" }]} /></Field>
                            {drafts.lease.naturalKind === "not_yet_delivered" ? <TextField testId="contract-fact-input-natural-leases-days" value={drafts.lease.naturalDays} onChange={(v) => updateDraft("lease", { naturalDays: v })} placeholder="days" width="80px" /> : null}
                            <Btn testId="contract-fact-save-lease" onClick={handleSaveLease} busy={busyGroup === "leaseDisclosure"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-leaseDisclosure">{groupErrors.leaseDisclosure ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Earnest Money and Option (¶5)                      */}
                      {/* -------------------------------------------------- */}
                      {group.key === "earnestMoneyOption" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Escrow agent name"><TextField testId="contract-fact-input-escrow-agent-name" value={drafts.earnest.escrowAgentName} onChange={(v) => updateDraft("earnest", { escrowAgentName: v })} /></Field>
                            <Field label="Escrow agent address"><TextField testId="contract-fact-input-escrow-agent-address" value={drafts.earnest.escrowAgentAddress} onChange={(v) => updateDraft("earnest", { escrowAgentAddress: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Earnest money"><AmountOrNoneField testId="contract-fact-input-earnest-money" value={drafts.earnest.earnestMoney} onChange={(v) => updateDraft("earnest", { earnestMoney: v })} /></Field>
                            <Field label="Option fee"><AmountOrNoneField testId="contract-fact-input-option-fee" value={drafts.earnest.optionFee} onChange={(v) => updateDraft("earnest", { optionFee: v })} /></Field>
                            <Field label="Option period"><DaysOrNoneField testId="contract-fact-input-option-period-days" value={drafts.earnest.optionPeriodDays} onChange={(v) => updateDraft("earnest", { optionPeriodDays: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Additional earnest money">
                              <SelectField testId="contract-fact-input-additional-earnest-kind" value={drafts.earnest.additionalKind} onChange={(v) => updateDraft("earnest", { additionalKind: v })} options={[{ value: "unset", label: "Choose one…" }, { value: "none", label: "Not applicable" }, { value: "value", label: "Applicable" }]} />
                            </Field>
                            {drafts.earnest.additionalKind === "value" ? (
                              <>
                                <TextField testId="contract-fact-input-additional-earnest-amount" value={drafts.earnest.additionalAmount} onChange={(v) => updateDraft("earnest", { additionalAmount: v })} placeholder="$ amount" width="100px" />
                                <TextField testId="contract-fact-input-additional-earnest-days" value={drafts.earnest.additionalWithinDays} onChange={(v) => updateDraft("earnest", { additionalWithinDays: v })} placeholder="within days" width="90px" />
                              </>
                            ) : null}
                            <Btn testId="contract-fact-save-earnest-money" onClick={handleSaveEarnest} busy={busyGroup === "earnestMoneyOption"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-earnestMoneyOption">{groupErrors.earnestMoneyOption ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Title Policy and Survey (¶6)                       */}
                      {/* -------------------------------------------------- */}
                      {group.key === "titleSurvey" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Title policy expense paid by"><SelectField testId="contract-fact-input-title-expense-party" value={drafts.titleSurvey.titlePolicyExpenseParty} onChange={(v) => updateDraft("titleSurvey", { titlePolicyExpenseParty: v })} options={[{ value: "seller", label: "Seller" }, { value: "buyer", label: "Buyer" }]} /></Field>
                            <Field label="Title company"><TextField testId="contract-fact-input-title-company" value={drafts.titleSurvey.titleCompanyName} onChange={(v) => updateDraft("titleSurvey", { titleCompanyName: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Shortage amendment"><SelectField testId="contract-fact-input-shortage-kind" value={drafts.titleSurvey.shortageKind} onChange={(v) => updateDraft("titleSurvey", { shortageKind: v })} options={[{ value: "not_amended", label: "Not amended" }, { value: "amended", label: "Amended" }]} /></Field>
                            {drafts.titleSurvey.shortageKind === "amended" ? <SelectField testId="contract-fact-input-shortage-expense-party" value={drafts.titleSurvey.shortageExpenseParty} onChange={(v) => updateDraft("titleSurvey", { shortageExpenseParty: v })} options={[{ value: "seller", label: "Seller pays" }, { value: "buyer", label: "Buyer pays" }]} /> : null}
                          </div>
                          <div style={rowStyle}>
                            <Field label="Survey"><SelectField testId="contract-fact-input-survey-option" value={drafts.titleSurvey.surveyOption} onChange={(v) => updateDraft("titleSurvey", { surveyOption: v })} options={[{ value: "seller_existing_survey", label: "Seller furnishes existing survey" }, { value: "buyer_new_survey", label: "Buyer obtains new survey" }, { value: "seller_new_survey", label: "Seller furnishes new survey" }]} /></Field>
                            {drafts.titleSurvey.surveyOption === "seller_existing_survey" ? (
                              <>
                                <TextField testId="contract-fact-input-survey-seller-furnish-days" value={drafts.titleSurvey.sellerFurnishDays} onChange={(v) => updateDraft("titleSurvey", { sellerFurnishDays: v })} placeholder="furnish days" width="100px" />
                                <SelectField testId="contract-fact-input-survey-if-rejected" value={drafts.titleSurvey.ifRejectedExpenseParty} onChange={(v) => updateDraft("titleSurvey", { ifRejectedExpenseParty: v })} options={[{ value: "seller", label: "If rejected: seller pays new survey" }, { value: "buyer", label: "If rejected: buyer pays new survey" }]} />
                              </>
                            ) : null}
                            {drafts.titleSurvey.surveyOption === "buyer_new_survey" ? <TextField testId="contract-fact-input-survey-buyer-obtain-days" value={drafts.titleSurvey.buyerObtainDays} onChange={(v) => updateDraft("titleSurvey", { buyerObtainDays: v })} placeholder="obtain days" width="100px" /> : null}
                            {drafts.titleSurvey.surveyOption === "seller_new_survey" ? <TextField testId="contract-fact-input-survey-seller-furnish-days-new" value={drafts.titleSurvey.sellerFurnishDays} onChange={(v) => updateDraft("titleSurvey", { sellerFurnishDays: v })} placeholder="furnish days" width="100px" /> : null}
                          </div>
                          <div style={rowStyle}>
                            <Field label="Title objections"><ValueOrNoneField testId="contract-fact-input-objections-text" value={drafts.titleSurvey.objectionsText} onChange={(v) => updateDraft("titleSurvey", { objectionsText: v })} /></Field>
                            <Field label="Objection days"><TextField testId="contract-fact-input-objections-days" value={drafts.titleSurvey.objectionsDays} onChange={(v) => updateDraft("titleSurvey", { objectionsDays: v })} placeholder="days" width="70px" /></Field>
                            <Field label="POA membership"><SelectField testId="contract-fact-input-poa-membership" value={drafts.titleSurvey.poaMembership} onChange={(v) => updateDraft("titleSurvey", { poaMembership: v })} options={[{ value: "is_not_subject", label: "Not subject to a POA" }, { value: "is_subject", label: "Subject to a POA" }]} /></Field>
                            <Btn testId="contract-fact-save-title-survey" onClick={handleSaveTitleSurvey} busy={busyGroup === "titleSurvey"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-titleSurvey">{groupErrors.titleSurvey ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Property Condition (¶7)                            */}
                      {/* -------------------------------------------------- */}
                      {group.key === "propertyCondition" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Seller's disclosure notice"><SelectField testId="contract-fact-input-disclosure-kind" value={drafts.propertyCondition.disclosureKind} onChange={(v) => updateDraft("propertyCondition", { disclosureKind: v })} options={[{ value: "received", label: "Received" }, { value: "not_yet_received", label: "Not yet received" }, { value: "not_required", label: "Not required" }]} /></Field>
                            {drafts.propertyCondition.disclosureKind === "not_yet_received" ? <TextField testId="contract-fact-input-disclosure-days" value={drafts.propertyCondition.disclosureDays} onChange={(v) => updateDraft("propertyCondition", { disclosureDays: v })} placeholder="days" width="70px" /> : null}
                          </div>
                          <div style={rowStyle}>
                            <Field label="As-is election"><SelectField testId="contract-fact-input-as-is-kind" value={drafts.propertyCondition.asIsKind} onChange={(v) => updateDraft("propertyCondition", { asIsKind: v })} options={[{ value: "as_is", label: "As-is" }, { value: "as_is_with_repairs", label: "As-is with specified repairs" }]} /></Field>
                            {drafts.propertyCondition.asIsKind === "as_is_with_repairs" ? <TextField testId="contract-fact-input-repairs-text" value={drafts.propertyCondition.repairsText} onChange={(v) => updateDraft("propertyCondition", { repairsText: v })} placeholder="Describe repairs" /> : null}
                          </div>
                          <div style={rowStyle}>
                            <Field label="Residential service contract cap"><ValueOrNoneField testId="contract-fact-input-service-cap" value={drafts.propertyCondition.serviceContractCap} onChange={(v) => updateDraft("propertyCondition", { serviceContractCap: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Water/wastewater disclosure"><SelectField testId="contract-fact-input-water-kind" value={drafts.propertyCondition.waterKind} onChange={(v) => updateDraft("propertyCondition", { waterKind: v })} options={[{ value: "received", label: "Received" }, { value: "not_yet_received", label: "Not yet received" }, { value: "exempt", label: "Exempt" }]} /></Field>
                            {drafts.propertyCondition.waterKind === "not_yet_received" ? <TextField testId="contract-fact-input-water-days" value={drafts.propertyCondition.waterDays} onChange={(v) => updateDraft("propertyCondition", { waterDays: v })} placeholder="days" width="70px" /> : null}
                            {drafts.propertyCondition.waterKind === "exempt" ? <TextField testId="contract-fact-input-water-source" value={drafts.propertyCondition.waterSource} onChange={(v) => updateDraft("propertyCondition", { waterSource: v })} placeholder="Water source" /> : null}
                            <Btn testId="contract-fact-save-property-condition" onClick={handleSavePropertyCondition} busy={busyGroup === "propertyCondition"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-propertyCondition">{groupErrors.propertyCondition ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Closing and Possession (¶9, ¶10)                   */}
                      {/* -------------------------------------------------- */}
                      {group.key === "closingPossession" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Closing date"><input type="date" data-testid="contract-fact-input-closing-date" value={drafts.closingPossession.closingDate} onChange={(e) => updateDraft("closingPossession", { closingDate: e.target.value })} style={inputStyle} /></Field>
                            <Field label="Possession"><SelectField testId="contract-fact-input-possession-election" value={drafts.closingPossession.possessionElection} onChange={(v) => updateDraft("closingPossession", { possessionElection: v })} options={[{ value: "upon_closing_and_funding", label: "Upon closing and funding" }, { value: "leaseback", label: "Leaseback" }]} /></Field>
                            <Field label="Possession details"><ValueOrNoneField testId="contract-fact-input-possession-details" value={drafts.closingPossession.possessionDetails} onChange={(v) => updateDraft("closingPossession", { possessionDetails: v })} /></Field>
                            <Btn testId="contract-fact-save-closing-possession" onClick={handleSaveClosingPossession} busy={busyGroup === "closingPossession"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-closingPossession">{groupErrors.closingPossession ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Settlement and Other Expenses (¶12)                */}
                      {/* -------------------------------------------------- */}
                      {group.key === "settlementExpense" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Seller expense credit cap"><ValueOrNoneField testId="contract-fact-input-seller-credit-cap" value={drafts.settlement.sellerCreditCap} onChange={(v) => updateDraft("settlement", { sellerCreditCap: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Seller pays buyer's broker"><SelectField testId="contract-fact-input-seller-pays-kind" value={drafts.settlement.sellerPaysKind} onChange={(v) => updateDraft("settlement", { sellerPaysKind: v })} options={[{ value: "none", label: "None" }, { value: "dollar", label: "Dollar amount" }, { value: "percent", label: "Percent" }]} /></Field>
                            {drafts.settlement.sellerPaysKind === "dollar" ? <TextField testId="contract-fact-input-seller-pays-amount" value={drafts.settlement.sellerPaysAmount} onChange={(v) => updateDraft("settlement", { sellerPaysAmount: v })} placeholder="$" width="90px" /> : null}
                            {drafts.settlement.sellerPaysKind === "percent" ? <TextField testId="contract-fact-input-seller-pays-percent" value={drafts.settlement.sellerPaysPercent} onChange={(v) => updateDraft("settlement", { sellerPaysPercent: v })} placeholder="%" width="70px" /> : null}
                          </div>
                          <div style={rowStyle}>
                            <Field label="Buyer pays seller's broker"><SelectField testId="contract-fact-input-buyer-pays-kind" value={drafts.settlement.buyerPaysKind} onChange={(v) => updateDraft("settlement", { buyerPaysKind: v })} options={[{ value: "none", label: "None" }, { value: "dollar", label: "Dollar amount" }, { value: "percent", label: "Percent" }]} /></Field>
                            {drafts.settlement.buyerPaysKind === "dollar" ? <TextField testId="contract-fact-input-buyer-pays-amount" value={drafts.settlement.buyerPaysAmount} onChange={(v) => updateDraft("settlement", { buyerPaysAmount: v })} placeholder="$" width="90px" /> : null}
                            {drafts.settlement.buyerPaysKind === "percent" ? <TextField testId="contract-fact-input-buyer-pays-percent" value={drafts.settlement.buyerPaysPercent} onChange={(v) => updateDraft("settlement", { buyerPaysPercent: v })} placeholder="%" width="70px" /> : null}
                            <Btn testId="contract-fact-save-settlement" onClick={handleSaveSettlement} busy={busyGroup === "settlementExpense"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-settlementExpense">{groupErrors.settlementExpense ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Broker/Agent Representation                        */}
                      {/* -------------------------------------------------- */}
                      {group.key === "representation" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Representation"><SelectField testId="contract-fact-input-representation-kind" value={drafts.representation.kind} onChange={(v) => updateDraft("representation", { kind: v })} options={[{ value: "none", label: "No representation" }, { value: "represented", label: "Represented" }]} /></Field>
                          </div>
                          {drafts.representation.kind === "represented" ? (
                            <>
                              <div style={rowStyle}>
                                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94A3B8" }}>
                                  <input type="checkbox" data-testid="contract-fact-input-seller-agent-present" checked={drafts.representation.sellerAgentPresent} onChange={(e) => updateDraft("representation", { sellerAgentPresent: e.target.checked })} />
                                  Seller's agent present
                                </label>
                              </div>
                              {drafts.representation.sellerAgentPresent ? (
                                <div style={rowStyle}>
                                  {BROKER_FIELDS.map((f) => (
                                    <TextField key={f.key} testId={`contract-fact-input-seller-agent-${f.key}`} value={drafts.representation.sellerAgent[f.key]} onChange={(v) => updateDraft("representation", { sellerAgent: { ...drafts.representation.sellerAgent, [f.key]: v } })} placeholder={f.label} />
                                  ))}
                                </div>
                              ) : null}
                              <div style={rowStyle}>
                                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94A3B8" }}>
                                  <input type="checkbox" data-testid="contract-fact-input-buyer-agent-present" checked={drafts.representation.buyerAgentPresent} onChange={(e) => updateDraft("representation", { buyerAgentPresent: e.target.checked })} />
                                  Buyer's agent present
                                </label>
                              </div>
                              {drafts.representation.buyerAgentPresent ? (
                                <div style={rowStyle}>
                                  {BROKER_FIELDS.map((f) => (
                                    <TextField key={f.key} testId={`contract-fact-input-buyer-agent-${f.key}`} value={drafts.representation.buyerAgent[f.key]} onChange={(v) => updateDraft("representation", { buyerAgent: { ...drafts.representation.buyerAgent, [f.key]: v } })} placeholder={f.label} />
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                          <div style={rowStyle}>
                            <Btn testId="contract-fact-save-representation" onClick={handleSaveRepresentation} busy={busyGroup === "representation"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-representation">{groupErrors.representation ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Addenda Applicability (¶22)                        */}
                      {/* -------------------------------------------------- */}
                      {group.key === "addendaApplicability" ? (
                        <div style={formBoxStyle}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginBottom: "8px" }}>
                            {ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => (
                              <label key={k} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94A3B8" }}>
                                <input type="checkbox" data-testid={`contract-fact-input-addenda-${k}`} checked={drafts.addenda.items[k]} onChange={(e) => updateDraft("addenda", { items: { ...drafts.addenda.items, [k]: e.target.checked } })} />
                                {humanizeKey(k)}
                              </label>
                            ))}
                          </div>
                          <div style={rowStyle}>
                            <Field label="District notices"><ValueOrNoneField testId="contract-fact-input-district-notices" value={drafts.addenda.districtNotices} onChange={(v) => updateDraft("addenda", { districtNotices: v })} /></Field>
                            <Btn testId="contract-fact-save-addenda" onClick={handleSaveAddenda} busy={busyGroup === "addendaApplicability"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-addendaApplicability">{groupErrors.addendaApplicability ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Notices (¶21) -- Buyer Business Config + Seller     */}
                      {/* Notice confirmation, Jess Gate correction #3/#4     */}
                      {/* -------------------------------------------------- */}
                      {group.key === "noticeContact" ? (
                        <div style={formBoxStyle}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Buyer Business Configuration (BTC LLC)</div>
                          <div style={rowStyle}>
                            <Field label="Notice address"><TextField testId="contract-fact-input-buyer-config-address" value={drafts.buyerBusinessConfig.noticeAddress} onChange={(v) => updateDraft("buyerBusinessConfig", { noticeAddress: v })} /></Field>
                            <Field label="Notice phone"><TextField testId="contract-fact-input-buyer-config-phone" value={drafts.buyerBusinessConfig.noticePhone} onChange={(v) => updateDraft("buyerBusinessConfig", { noticePhone: v })} /></Field>
                            <Field label="Notice email"><TextField testId="contract-fact-input-buyer-config-email" value={drafts.buyerBusinessConfig.noticeEmail} onChange={(v) => updateDraft("buyerBusinessConfig", { noticeEmail: v })} /></Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Authorized signer name"><TextField testId="contract-fact-input-buyer-config-signer-name" value={drafts.buyerBusinessConfig.signerName} onChange={(v) => updateDraft("buyerBusinessConfig", { signerName: v })} /></Field>
                            <Field label="Signer role"><TextField testId="contract-fact-input-buyer-config-signer-role" value={drafts.buyerBusinessConfig.signerRole} onChange={(v) => updateDraft("buyerBusinessConfig", { signerRole: v })} placeholder="e.g. Manager" /></Field>
                            <Btn testId="contract-fact-save-buyer-config" onClick={handleSaveBuyerBusinessConfig} busy={busyGroup === "buyerBusinessConfig"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-buyerBusinessConfig">{groupErrors.buyerBusinessConfig ?? null}</ErrorText>

                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", margin: "14px 0 6px" }}>Seller Notice (¶21)</div>
                          <div style={{ fontSize: "10px", color: "#475569", marginBottom: "8px" }}>
                            Candidate from the contact record (NOT written automatically) — Address: {sellerNoticeCandidate.address || "none on file"}; Phone: {sellerNoticeCandidate.phone || "none on file"}; Email: {sellerNoticeCandidate.email || "none on file"}.
                          </div>
                          <div style={rowStyle}>
                            <Field label="Notice address">
                              <span style={{ display: "inline-flex", gap: "6px" }}>
                                <TextField testId="contract-fact-input-seller-notice-address" value={drafts.sellerNotice.noticeAddress} onChange={(v) => updateDraft("sellerNotice", { noticeAddress: v })} />
                                <button data-testid="contract-fact-use-candidate-address" onClick={() => updateDraft("sellerNotice", { noticeAddress: sellerNoticeCandidate.address })} style={{ ...saveButtonStyle, background: "#1E293B" }}>Use candidate</button>
                              </span>
                            </Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Notice phone">
                              <span style={{ display: "inline-flex", gap: "6px" }}>
                                <ValueOrNoneField testId="contract-fact-input-seller-notice-phone" value={drafts.sellerNotice.noticePhone} onChange={(v) => updateDraft("sellerNotice", { noticePhone: v })} />
                                <button data-testid="contract-fact-use-candidate-phone" onClick={() => updateDraft("sellerNotice", { noticePhone: sellerNoticeCandidate.phone ? { mode: "value", text: sellerNoticeCandidate.phone } : { mode: "none", text: "" } })} style={{ ...saveButtonStyle, background: "#1E293B" }}>Use candidate</button>
                              </span>
                            </Field>
                            <Field label="Notice email">
                              <span style={{ display: "inline-flex", gap: "6px" }}>
                                <ValueOrNoneField testId="contract-fact-input-seller-notice-email" value={drafts.sellerNotice.noticeEmail} onChange={(v) => updateDraft("sellerNotice", { noticeEmail: v })} />
                                <button data-testid="contract-fact-use-candidate-email" onClick={() => updateDraft("sellerNotice", { noticeEmail: sellerNoticeCandidate.email ? { mode: "value", text: sellerNoticeCandidate.email } : { mode: "none", text: "" } })} style={{ ...saveButtonStyle, background: "#1E293B" }}>Use candidate</button>
                              </span>
                            </Field>
                            <Btn testId="contract-fact-save-seller-notice" onClick={handleSaveSellerNotice} busy={busyGroup === "sellerNotice"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-sellerNotice">{groupErrors.sellerNotice ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Seller Equitable-Interest Disclosure               */}
                      {/* -------------------------------------------------- */}
                      {group.key === "sellerEquitableInterest" ? (
                        <div style={formBoxStyle}>
                          <div style={rowStyle}>
                            <Field label="Disclosure"><SelectField testId="contract-fact-input-equitable-kind" value={drafts.sellerEquitable.kind} onChange={(v) => updateDraft("sellerEquitable", { kind: v })} options={[{ value: "not_yet_made", label: "Not yet made" }, { value: "made", label: "Made (now)" }]} /></Field>
                            <Btn testId="contract-fact-save-equitable" onClick={handleSaveSellerEquitable} busy={busyGroup === "sellerEquitableInterest"}>Save</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-sellerEquitableInterest">{groupErrors.sellerEquitableInterest ?? null}</ErrorText>
                        </div>
                      ) : null}

                      {/* -------------------------------------------------- */}
                      {/* Attorney/Manual Fields (¶11, ¶22 "Other:")          */}
                      {/* -------------------------------------------------- */}
                      {group.key === "attorneyManualFields" ? (
                        <div style={formBoxStyle}>
                          <div style={{ fontSize: "10px", color: "#475569", marginBottom: "8px" }}>
                            IAOS never drafts, interprets, or recommends this text -- it is stored and shown back exactly as supplied.
                          </div>
                          <div style={rowStyle}>
                            <Field label="Special provisions (¶11)"><SelectField testId="contract-fact-input-attorney-special-kind" value={drafts.attorneySpecial.kind} onChange={(v) => updateDraft("attorneySpecial", { kind: v })} options={[{ value: "not_applicable", label: "Not applicable" }, { value: "attorney_will_draft", label: "Attorney will draft" }, { value: "provided_verbatim", label: "Provided verbatim" }]} /></Field>
                            {drafts.attorneySpecial.kind === "provided_verbatim" ? <TextField testId="contract-fact-input-attorney-special-text" value={drafts.attorneySpecial.text} onChange={(v) => updateDraft("attorneySpecial", { text: v })} placeholder="Paste verbatim text" /> : null}
                            <Btn testId="contract-fact-save-attorney-special" onClick={() => handleSaveAttorneyField("special_provisions")} busy={busyGroup === "attorneyManualFields"}>Save</Btn>
                          </div>
                          {attorneySpecialProvisionsText ? <div style={{ fontSize: "10px", color: "#475569", marginBottom: "8px" }}>Provided text: "{attorneySpecialProvisionsText}"</div> : null}
                          <div style={rowStyle}>
                            <Field label="Other addenda (¶22 &quot;Other:&quot;)"><SelectField testId="contract-fact-input-attorney-other-kind" value={drafts.attorneyOther.kind} onChange={(v) => updateDraft("attorneyOther", { kind: v })} options={[{ value: "not_applicable", label: "Not applicable" }, { value: "attorney_will_draft", label: "Attorney will draft" }, { value: "provided_verbatim", label: "Provided verbatim" }]} /></Field>
                            {drafts.attorneyOther.kind === "provided_verbatim" ? <TextField testId="contract-fact-input-attorney-other-text" value={drafts.attorneyOther.text} onChange={(v) => updateDraft("attorneyOther", { text: v })} placeholder="Paste verbatim text" /> : null}
                            <Btn testId="contract-fact-save-attorney-other" onClick={() => handleSaveAttorneyField("other_addenda_text")} busy={busyGroup === "attorneyManualFields"}>Save</Btn>
                          </div>
                          {attorneyOtherAddendaText ? <div style={{ fontSize: "10px", color: "#475569" }}>Provided text: "{attorneyOtherAddendaText}"</div> : null}
                          <ErrorText testId="contract-fact-error-attorneyManualFields">{groupErrors.attorneyManualFields ?? null}</ErrorText>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ================================================================ */}
          {/* Contract Review & Send-Authorization Gate -- B9-07 / INV-62       */}
          {/* ================================================================ */}
          {contractDocumentPreview && bradAuthorizationStatus && authorizationEligibility ? (
            <div data-testid="contract-authorization-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Contract Review &amp; Send-Authorization
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                No agreement becomes eligible for delivery merely because IAOS generated, populated, or displayed it. Only Brad's own explicit action, for this exact document revision, can authorize it -- and any material change since revokes that authorization.
              </div>

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Template &amp; document revision identity</div>
                <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.8 }}>
                  <div data-testid="contract-authorization-template-name">Template: {contractDocumentPreview.templateName}</div>
                  <div data-testid="contract-authorization-template-source" style={{ color: "#64748B" }}>{contractDocumentPreview.templateSource}</div>
                  <div data-testid="contract-authorization-revision">
                    Revision: agreement {new Date(contractDocumentPreview.version.agreementAt).toLocaleString()}, version {contractDocumentPreview.version.versionSeq}
                    {contractDocumentPreview.version.supersedesVersionSeq !== null ? ` (supersedes version ${contractDocumentPreview.version.supersedesVersionSeq})` : ""}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                <div data-testid="contract-authorization-preview-complete" style={{
                  ...groupCardStyle, flex: "1 1 220px",
                  borderColor: contractDocumentPreview.previewComplete ? "rgba(34,197,94,0.35)" : "rgba(245,158,11,0.35)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: contractDocumentPreview.previewComplete ? "#22C55E" : "#F59E0B" }}>
                    {contractDocumentPreview.previewComplete ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                    Preview {contractDocumentPreview.previewComplete ? "complete" : "incomplete"}
                  </div>
                  <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
                    Population/preview completeness only -- never authorization to send.
                  </div>
                </div>
                <div data-testid="contract-authorization-brad-authorized" style={{
                  ...groupCardStyle, flex: "1 1 220px",
                  borderColor: bradAuthorizationStatus.authorized ? "rgba(34,197,94,0.35)" : "rgba(148,163,184,0.35)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: bradAuthorizationStatus.authorized ? "#22C55E" : "#94A3B8" }}>
                    {bradAuthorizationStatus.authorized ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                    {bradAuthorizationStatus.authorized ? "Brad-authorized" : "Not Brad-authorized"}
                  </div>
                  <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
                    {bradAuthorizationStatus.authorized
                      ? `Authorized ${new Date(bradAuthorizationStatus.record.at).toLocaleString()} for this exact revision.`
                      : "Requires Brad's explicit action for this exact revision -- never assumed, never a side effect of saving a fact."}
                  </div>
                </div>
              </div>

              {!bradAuthorizationStatus.authorized ? (
                <ul data-testid="contract-authorization-reasons" style={{ margin: "0 0 12px", padding: "0 0 0 18px", fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }}>
                  {bradAuthorizationStatus.reasons.map((r) => (
                    <li key={r.code} data-testid={`contract-authorization-reason-${r.code}`}>{r.message}</li>
                  ))}
                </ul>
              ) : null}

              {contractDocumentPreview.blockingReasons.length > 0 ? (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "4px" }}>Unresolved / conflicting</div>
                  <ul data-testid="contract-authorization-blocking-reasons" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "12px", color: "#F59E0B", lineHeight: 1.8 }}>
                    {contractDocumentPreview.blockingReasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              ) : null}

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Seller signer &amp; delivery information</div>
                <div style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.8 }}>
                  {contractDocumentPreview.documentLines
                    .filter((l) => l.group === "parties" || l.group === "noticeContact")
                    .map((l) => (
                      <div key={`${l.group}.${l.field}`} data-testid={`contract-authorization-signer-${l.field}`}>
                        <span style={{ color: "#64748B" }}>{l.label}:</span>{" "}
                        <span style={{ color: l.status === "populated" ? "#22C55E" : l.status === "not_applicable" ? "#64748B" : "#F59E0B" }}>
                          {l.text ?? "Unresolved"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Material contract terms (populated preview)</div>
                <div data-testid="contract-authorization-preview-lines" style={{ fontSize: "11px", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: "10px" }}>
                  {Object.entries(
                    contractDocumentPreview.documentLines.reduce((acc: Record<string, typeof contractDocumentPreview.documentLines>, l) => {
                      (acc[l.group] ??= []).push(l);
                      return acc;
                    }, {}),
                  ).map(([groupKey, lines]) => (
                    <div key={groupKey}>
                      <div style={{ color: "#64748B", fontWeight: 700, marginBottom: "3px" }}>{CONTRACT_DOCUMENT_GROUP_LABEL[groupKey] ?? groupKey}</div>
                      {lines.map((l) => (
                        <div key={`${l.group}.${l.field}`}>
                          <span style={{ color: "#475569" }}>¶{l.paragraph || "—"} {l.label}:</span>{" "}
                          <span style={{ color: l.status === "populated" ? "#E2E8F0" : l.status === "not_applicable" ? "#64748B" : "#F59E0B" }}>
                            {l.text ?? "Unresolved"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Differences from the last Brad-reviewed revision</div>
                {differencesFromLastAuthorized === null ? (
                  <div data-testid="contract-authorization-diff-none-recorded" style={{ fontSize: "11px", color: "#64748B" }}>No prior authorization exists to compare against.</div>
                ) : differencesFromLastAuthorized.length === 0 ? (
                  <div data-testid="contract-authorization-diff-unchanged" style={{ fontSize: "11px", color: "#22C55E" }}>No differences -- this is exactly the revision Brad last authorized.</div>
                ) : (
                  <ul data-testid="contract-authorization-diff-list" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#F59E0B", lineHeight: 1.8 }}>
                    {differencesFromLastAuthorized.map((d) => (
                      <li key={`${d.group}.${d.field}`}>
                        {d.group}.{d.field}: {d.previous ? `"${d.previous.text ?? d.previous.status}"` : "(none)"} → {d.current ? `"${d.current.text ?? d.current.status}"` : "(removed)"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <Btn
                  testId="contract-authorization-authorize-button"
                  onClick={handleAuthorize}
                  busy={authorizeBusy}
                  disabled={!authorizationEligibility.eligible}
                >
                  Authorize this exact revision
                </Btn>
                {!authorizationEligibility.eligible ? (
                  <div data-testid="contract-authorization-ineligible-reasons" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "8px" }}>
                    {authorizationEligibility.reasons.map((r) => <div key={r.code}>{r.message}</div>)}
                  </div>
                ) : null}
                <ErrorText testId="contract-authorization-error">{authorizeError}</ErrorText>
              </div>
            </div>
          ) : null}

          {/* ================================================================ */}
          {/* Contract Sent -- e-signature sending, GHL Documents & Contracts   */}
          {/* B9-08 / INV-63                                                    */}
          {/* ================================================================ */}
          {contractDocumentPreview && sendEligibility && contractSentStatus ? (
            <div data-testid="contract-send-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Send via GHL Documents &amp; Contracts
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                Sends the exact Brad-authorized agreement through GHL Documents &amp; Contracts (IAOS Test only). Contract Sent is recorded only after the provider affirmatively confirms acceptance -- never on request alone.
              </div>

              {templateDriftCheck.kind === "problem" ? (
                <div data-testid="contract-send-template-drift-problem" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(239,68,68,0.35)", fontSize: "12px", color: "#EF4444" }}>
                  {templateDriftCheck.message}
                </div>
              ) : null}

              {(() => {
                const status: string | null = existingSend && existingSend.status !== "in_progress"
                  ? existingSend.status
                  : null;
                if (sendBusy) {
                  return (
                    <div data-testid="contract-send-state-sending" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(148,163,184,0.35)", color: "#94A3B8", fontSize: "12px", fontWeight: 700 }}>
                      Sending...
                    </div>
                  );
                }
                if (status === "provider_accepted_pending_readback") {
                  return (
                    <div data-testid="contract-send-state-pending-readback" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(245,158,11,0.35)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#F59E0B" }}>
                        <ShieldAlert size={14} /> Provider responded -- readback verification incomplete
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
                        The provider accepted the POST, but IAOS's own readback confirmation did not complete (e.g. this tab closed mid-flow). A real document may already exist at GHL -- verify directly in GHL before retrying.
                      </div>
                    </div>
                  );
                }
                if (status === "accepted") {
                  return (
                    <div data-testid="contract-send-state-accepted" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(34,197,94,0.35)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#22C55E" }}>
                        <ShieldCheck size={14} /> Provider accepted -- Contract Sent
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
                        {existingSend?.iaosObservedAcceptanceAt ? `Observed ${new Date(existingSend.iaosObservedAcceptanceAt).toLocaleString()}. ` : ""}
                        {existingSend?.providerResponse?.documentId ? `Provider document id: ${existingSend.providerResponse.documentId}. ` : ""}
                        Expires {new Date(existingSend!.expirationAt).toLocaleString()}.
                      </div>
                    </div>
                  );
                }
                if (status === "failed") {
                  return (
                    <div data-testid="contract-send-state-failed" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(239,68,68,0.35)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#EF4444" }}>
                        <ShieldAlert size={14} /> Failed
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>{existingSend?.failureReason ?? "The provider did not accept this send."} Retrying is allowed for this exact revision.</div>
                    </div>
                  );
                }
                if (status === "ambiguous") {
                  return (
                    <div data-testid="contract-send-state-ambiguous" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(245,158,11,0.35)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#F59E0B" }}>
                        <ShieldAlert size={14} /> Ambiguous -- manual verification required
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>{existingSend?.failureReason ?? "The provider's response could not be confirmed as accepted."} Verify directly in GHL before retrying or treating this as sent.</div>
                    </div>
                  );
                }
                return null;
              })()}

              {!sendEligibility.eligible ? (
                <div data-testid={sendEligibility.reasons.some((r) => r.code === "ALREADY_SENT" || r.code === "SEND_IN_PROGRESS") ? "contract-send-state-already-sent" : "contract-send-state-not-eligible"} style={{ marginBottom: "12px" }}>
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }}>
                    {sendEligibility.reasons.map((r) => <li key={r.code} data-testid={`contract-send-reason-${r.code}`}>{r.message}</li>)}
                  </ul>
                </div>
              ) : (
                <div data-testid="contract-send-state-eligible" style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "11px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                    Expiration date/time (explicit -- required before sending)
                  </label>
                  <input
                    type="datetime-local"
                    data-testid="contract-send-expiration-input"
                    value={sendExpirationDraft}
                    onChange={(e) => setSendExpirationDraft(e.target.value)}
                    style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: "6px", color: "#E2E8F0", fontSize: "12px", padding: "6px 8px", marginBottom: "10px" }}
                  />
                  <div>
                    <Btn testId="contract-send-button" onClick={handleSend} busy={sendBusy} disabled={sendExpirationDraft === "" || templateDriftCheck.kind !== "ok"}>
                      Send via GHL Documents &amp; Contracts
                    </Btn>
                    {templateDriftCheck.kind === "checking" ? (
                      <div style={{ fontSize: "10px", color: "#64748B", marginTop: "6px" }}>Verifying the GHL template's identity...</div>
                    ) : null}
                  </div>
                </div>
              )}

              <ErrorText testId="contract-send-error">{sendError}</ErrorText>

              <div style={{ ...groupCardStyle, marginTop: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Contract Sent (state-machine evaluation)</div>
                {contractSentStatus.eligible ? (
                  <div data-testid="contract-sent-true" style={{ fontSize: "12px", color: "#22C55E" }}>Contract Sent -- all three locked facts are present (Brad authorization, confirmed provider transmission, explicit expiration).</div>
                ) : (
                  <ul data-testid="contract-sent-false-reasons" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                    {contractSentStatus.reasons.map((r) => <li key={r.code}>{r.message}</li>)}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
