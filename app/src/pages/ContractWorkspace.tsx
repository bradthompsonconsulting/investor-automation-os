import { useMemo, useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { ghl, type ContactDetail, type OpportunityRow } from "../lib/ghl";
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import {
  formatContractReadyChecklistNote,
  CONTRACT_READY_ITEM_KEYS, type ContractReadyItemKey, type ContractReadyItems,
} from "../lib/seller-call-readiness-carriers";
import {
  computeContractScreenState, showRecordGhlSendControl, showVerifyExecutionControl, showDispositionHandoffControl, showStartDispositionControl,
  type ContractScreenState,
} from "../lib/contract-workspace-view";
import { CONTRACT_STATE_MEANING, initialVersionIdentity, evaluateContractSentEligibility, isSameContractVersion, type MaterialTermSnapshot } from "../lib/board9-contract-model";
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
import { buildContractSentEvidence } from "../lib/contract-send-model";
import { latestContractSendForOpportunity } from "../lib/contract-send-carriers";
import { buildProviderObservationRecordFromReadback, type LifecycleRecord } from "../lib/contract-lifecycle-model";
import {
  classifySelectedFileBytes, verifyRequiredSigners, verifyProviderCompletion,
  verifyManualArtifactSelection, buildVerifiedUnderContractRecord,
  extractProviderSignerRowsFromListDocumentsBody, verifyBuyerSignerIdentity,
  isDuplicateUnderContractRecord, verifyReadbackMatchesWritten, matchesUnderContractEvidenceIdentity, countPdfPages,
  type ManualArtifactSelectionOutcome, type UnderContractRecordEntry,
} from "../lib/contract-execution-model";
import { buildManualContractSendRecordArgs } from "../lib/contract-manual-send-model";
import { formatContractSendNote } from "../lib/contract-send-carriers";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { computeManualArtifactSha256Hex } from "../lib/browser-artifact-hash";
import {
  buildExecutedTermsChecklist, buildExecutedTermsAttestationRecordArgs,
  verifyExecutedTermsAttestationCurrency,
  type ChecklistItem, type ChecklistItemKind, type ChecklistResponseValue,
} from "../lib/contract-executed-terms-attestation-model";
import {
  formatExecutedTermsAttestationNote, latestExecutedTermsAttestationForOpportunity,
} from "../lib/contract-executed-terms-attestation-carriers";
import {
  buildRequiredSignerSet, buildSignerMappingAttestationRecordArgs,
  verifySignerMappingAttestationCurrency, type RequiredSigner,
} from "../lib/contract-signer-mapping-model";
import {
  formatSignerMappingAttestationNote, latestSignerMappingAttestationForOpportunity,
} from "../lib/contract-signer-mapping-carriers";
import {
  formatUnderContractNote, parseUnderContractNote, allUnderContractRecordsForOpportunity,
} from "../lib/contract-execution-carriers";
import { allContractLifecycleRecordsForOpportunity } from "../lib/contract-lifecycle-carriers";
import { matchingArvApprovalForOpportunity } from "../lib/arv-approval-note";
import {
  evaluateDispositionHandoffEligibility, buildDispositionHandoffRecordArgs,
  verifyHandoffMatchesUnderContract,
  type DispositionHandoffRecord, type DocumentReference,
} from "../lib/contract-disposition-handoff-model";
import { CHUNK_SIZE_BYTES } from "../lib/contract-executed-artifact-storage-model";
import { latestPreservedExecutedArtifactForVersion } from "../lib/contract-executed-artifact-carriers";
import { appWriteFetch } from "../lib/app-write-session";
import {
  formatDispositionHandoffNote, parseDispositionHandoffNote, allDispositionHandoffsForOpportunity,
} from "../lib/contract-disposition-handoff-carriers";
import {
  formatBuyerEntityOverrideNote,
  formatPartySignerFactsNote, type SellerSignerFact,
  formatPropertyLegalDescriptionFactsNote, type ReservationsFact, type LegalMunicipalityFact,
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
  formatSellerSigningModelNote, latestSellerSigningModelForOpportunity,
  type ValueOrNone, type AmountOrNone, type DaysOrNone,
} from "../lib/seller-contract-facts-carriers";
import {
  resolveSeller1FromOpportunity, checkSeller2LegalName, checkSeller2EmailFormat, checkSellerEmailsDistinct,
  normalizeEmail,
  type SellerSigningModel, type SigningCapacityDisposition, type Seller1Resolution,
} from "../lib/contract-seller-signing-model";

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
      // UTC-explicit -- the stored value is a calendar-only fact (midnight
      // UTC), and without this option `toLocaleDateString()` renders in the
      // browser's LOCAL timezone, rolling the displayed day back by one for
      // any timezone behind UTC. Matches the already-established
      // `closingDateMonthDayTransport` pattern (contract-ghl-transport-
      // formatting.ts), which derives the same instant the same way.
      return { text: new Date(v as string).toLocaleDateString(undefined, { timeZone: "UTC" }), color: "#22C55E" };
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
      // INV-67 checkbox-marker / broker-model repair -- narrowly justified
      // adjustment required by compilation: RepresentationFact gained a
      // third kind. Intermediary status is surfaced distinctly (never
      // rendered as if it were the separate-side "represented" shape) so
      // an operator sees the fail-closed state this codebase's own
      // classifier (`contract-broker-arrangement-model.ts`) already refuses
      // to sync.
      if (r.kind === "intermediary") return { text: `Intermediary — ${r.brokerFirm.firmName}`, color: "#F59E0B" };
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
  "propertyLegalDescription.legalMunicipality": "Legal municipality (¶2A City of)",
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

/**
 * INV-67 checkbox-marker / broker-model repair -- the five page-11 fields
 * beyond the originally-shipped six (`BROKER_FIELDS` below, UNCHANGED).
 * Each is a `VNDraft` ("has a value" vs. explicit "None"), matching
 * `BrokerInfo`'s own `ValueOrNone` shape for these five -- many real
 * brokers genuinely have no team name or no distinct licensed supervisor,
 * and a plain empty string cannot distinguish "not yet captured" from
 * "confirmed absent." There is no separate address/city/state/zip -- TREC
 * page 11 has ONE Address blank per side.
 */
type BrokerDraft = {
  firmName: string; licenseNo: string; associateName: string; associateLicenseNo: string; email: string; phone: string;
  address: VNDraft; teamName: VNDraft; supervisorName: VNDraft; supervisorPhone: VNDraft; supervisorLicenseNo: VNDraft;
};
const BROKER_DRAFT_EMPTY: BrokerDraft = {
  firmName: "", licenseNo: "", associateName: "", associateLicenseNo: "", email: "", phone: "",
  address: VN_UNSET, teamName: VN_UNSET, supervisorName: VN_UNSET, supervisorPhone: VN_UNSET, supervisorLicenseNo: VN_UNSET,
};
const BROKER_FIELDS: { key: "firmName" | "licenseNo" | "associateName" | "associateLicenseNo" | "email" | "phone"; label: string }[] = [
  { key: "firmName", label: "Firm name" }, { key: "licenseNo", label: "License #" },
  { key: "associateName", label: "Associate name" }, { key: "associateLicenseNo", label: "Associate license #" },
  { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
];
/** INV-67 checkbox-marker / broker-model repair -- the five new ValueOrNone page-11 fields. */
const BROKER_VALUE_OR_NONE_FIELDS: { key: "address" | "teamName" | "supervisorName" | "supervisorPhone" | "supervisorLicenseNo"; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "teamName", label: "Team name" },
  { key: "supervisorName", label: "Licensed supervisor name" },
  { key: "supervisorPhone", label: "Licensed supervisor phone" },
  { key: "supervisorLicenseNo", label: "Licensed supervisor license #" },
];

type Drafts = {
  buyerOverride: { active: boolean; buyerName: string; reason: string };
  signer: { role: string; displayName: string; signingAuthorityNote: string };
  /** `municipalityKind: "unset"` = no default -- INV-67 Phase 2A Product Owner ruling forbids inferring or preselecting either choice. */
  legalDesc: { lot: VNDraft; block: VNDraft; addition: VNDraft; county: VNDraft; exclusions: VNDraft; reservationsKind: "none" | "applies"; reservationsNote: string; municipalityKind: "unset" | "municipality" | "unincorporated"; municipalityName: string };
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
  /** INV-67 Phase 1. `count: "unset"` = no default seller count -- an explicit choice is required. `seller1Capacity`/`seller2Capacity` default to `"unresolved"`, which is a real, persistable disposition (not an eligible passing state), matching "no eligible default." */
  sellerSigning: { count: "unset" | 1 | 2; seller1Capacity: SigningCapacityDisposition; seller2LegalName: string; seller2Email: string; seller2Capacity: SigningCapacityDisposition };
};

const INITIAL_DRAFTS: Drafts = {
  buyerOverride: { active: false, buyerName: "", reason: "" },
  signer: { role: "", displayName: "", signingAuthorityNote: "" },
  legalDesc: { lot: VN_UNSET, block: VN_UNSET, addition: VN_UNSET, county: VN_UNSET, exclusions: VN_UNSET, reservationsKind: "none", reservationsNote: "", municipalityKind: "unset", municipalityName: "" },
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
  sellerSigning: { count: "unset", seller1Capacity: "unresolved", seller2LegalName: "", seller2Email: "", seller2Capacity: "unresolved" },
};

/* ==================================================================== */
/* Saved-fact form hydration -- the exact inverse of each handleSaveX     */
/* below. A refresh previously reset every group's draft to              */
/* INITIAL_DRAFTS regardless of what was actually saved, so a one-field  */
/* correction (e.g. County) submitted every OTHER field in that group at */
/* its blank default, overwriting real saved values, or failing the      */
/* group's own "every field needs a value" validation outright.          */
/* ==================================================================== */

function valueOrNoneToDraft(f: ValueOrNone): VNDraft {
  return f.kind === "none" ? { mode: "none", text: "" } : { mode: "value", text: f.value };
}

function numberDispositionToAmountDraft(disp: FieldDisposition<number>): AONDraft {
  if (disp.kind === "populated") return { mode: "amount", text: String(disp.value) };
  if (disp.kind === "not_applicable") return { mode: "none", text: "" };
  return AON_UNSET;
}

function numberDispositionToDaysDraft(disp: FieldDisposition<number>): DONDraft {
  if (disp.kind === "populated") return { mode: "days", text: String(disp.value) };
  if (disp.kind === "not_applicable") return { mode: "none", text: "" };
  return DON_UNSET;
}

function brokerInfoToDraft(b: BrokerInfo): BrokerDraft {
  return {
    firmName: b.firmName, licenseNo: b.licenseNo, associateName: b.associateName, associateLicenseNo: b.associateLicenseNo,
    email: b.email, phone: b.phone,
    address: valueOrNoneToDraft(b.address), teamName: valueOrNoneToDraft(b.teamName),
    supervisorName: valueOrNoneToDraft(b.supervisorName), supervisorPhone: valueOrNoneToDraft(b.supervisorPhone),
    supervisorLicenseNo: valueOrNoneToDraft(b.supervisorLicenseNo),
  };
}

/**
 * `"intermediary"` is a real `RepresentationFact` kind (INV-67 checkbox-
 * marker / broker-model repair) that `Drafts["representation"]` has no
 * shape for at all -- it was never editable through this form before this
 * fix and remains not editable now; the caller below never invokes this
 * for that kind. Adding intermediary support to the draft type would be a
 * real feature change, out of this hydration fix's scope.
 */
function repFactToDraft(f: RepresentationFact & { kind: "none" | "represented" }): Drafts["representation"] {
  if (f.kind === "none") return { kind: "none", sellerAgentPresent: false, sellerAgent: BROKER_DRAFT_EMPTY, buyerAgentPresent: false, buyerAgent: BROKER_DRAFT_EMPTY };
  return {
    kind: "represented",
    sellerAgentPresent: f.sellerAgent !== null, sellerAgent: f.sellerAgent ? brokerInfoToDraft(f.sellerAgent) : BROKER_DRAFT_EMPTY,
    buyerAgentPresent: f.buyerAgent !== null, buyerAgent: f.buyerAgent ? brokerInfoToDraft(f.buyerAgent) : BROKER_DRAFT_EMPTY,
  };
}

/**
 * Builds a full `Drafts` object from the currently-resolved canonical
 * report (and the separately-parsed seller signing model) -- the exact
 * inverse of each handleSaveX below, field for field. Called ONCE per
 * opportunity by the hydration effect inside the component, never on
 * every report recompute (which would silently overwrite in-progress,
 * unsaved typing every time an unrelated group's save appends a note).
 *
 * A field with no canonical record (`unresolved`) is left at its
 * INITIAL_DRAFTS default -- never invented, never inferred, matching
 * every existing "no default" ruling already encoded in the save
 * handlers below (legal municipality, seller count, additional earnest
 * money, ...).
 *
 * Two disclosed, deliberate gaps, neither introduced by this fix:
 * (1) `buyerOverride` is never hydrated -- its audit-only `reason` text
 * is not part of the aggregated report (only `parties.buyerEntityName`,
 * a bare string, survives into it), so there is nothing lossless to
 * reconstruct; re-entering an override, on the rare deal that needs one,
 * is unchanged from today. (2) `attorneySpecial`/`attorneyOther` cannot
 * distinguish a previously-recorded "attorney will draft" from "never
 * recorded" -- `contract-facts-model.ts`'s own aggregation deliberately
 * collapses both to `unresolved` (see that file's header); hydration
 * inherits that same, pre-existing ambiguity rather than resolving it by
 * re-reading raw notes here, which is out of this fix's scope.
 */
function draftsFromReport(report: SellerContractFactsReport | null, signingModel: SellerSigningModel | null): Drafts {
  const d = INITIAL_DRAFTS;
  if (!report) return d;

  const signer = report.parties.sellerSigners.kind === "populated" && report.parties.sellerSigners.value.length > 0
    ? report.parties.sellerSigners.value[0]
    : null;
  const legal = report.propertyLegalDescription;
  const lease = report.leaseDisclosure;
  const earnest = report.earnestMoneyOption;
  const title = report.titleSurvey;
  const condition = report.propertyCondition;
  const closing = report.closingPossession;
  const settlement = report.settlementExpense;
  const rep = report.representation.representation;
  const addenda = report.addendaApplicability;
  const equitable = report.sellerEquitableInterest.disposition;
  const attorneySpecial = report.attorneyManualFields.specialProvisions;
  const attorneyOther = report.attorneyManualFields.otherAddendaText;
  const notice = report.noticeContact;

  return {
    buyerOverride: d.buyerOverride,
    signer: signer
      ? { role: signer.role, displayName: signer.displayName ?? "", signingAuthorityNote: signer.signingAuthorityNote ?? "" }
      : d.signer,
    legalDesc: {
      lot: legal.lot.kind === "populated" ? valueOrNoneToDraft(legal.lot.value) : d.legalDesc.lot,
      block: legal.block.kind === "populated" ? valueOrNoneToDraft(legal.block.value) : d.legalDesc.block,
      addition: legal.addition.kind === "populated" ? valueOrNoneToDraft(legal.addition.value) : d.legalDesc.addition,
      county: legal.county.kind === "populated" ? valueOrNoneToDraft(legal.county.value) : d.legalDesc.county,
      exclusions: legal.exclusions.kind === "populated" ? valueOrNoneToDraft(legal.exclusions.value) : d.legalDesc.exclusions,
      reservationsKind: legal.reservations.kind === "populated" ? legal.reservations.value.kind : d.legalDesc.reservationsKind,
      reservationsNote: legal.reservations.kind === "populated" && legal.reservations.value.kind === "applies" ? legal.reservations.value.addendumNote : d.legalDesc.reservationsNote,
      municipalityKind: legal.legalMunicipality.kind === "populated" ? legal.legalMunicipality.value.kind : d.legalDesc.municipalityKind,
      municipalityName: legal.legalMunicipality.kind === "populated" && legal.legalMunicipality.value.kind === "municipality" ? legal.legalMunicipality.value.name : d.legalDesc.municipalityName,
    },
    lease: {
      residentialLeases: lease.residentialLeases.kind === "populated" ? lease.residentialLeases.value : d.lease.residentialLeases,
      fixtureLeases: lease.fixtureLeases.kind === "populated" ? lease.fixtureLeases.value : d.lease.fixtureLeases,
      naturalKind: lease.naturalResourceLeases.kind === "populated" ? lease.naturalResourceLeases.value.kind : d.lease.naturalKind,
      naturalDays: lease.naturalResourceLeases.kind === "populated" && lease.naturalResourceLeases.value.kind === "not_yet_delivered" ? String(lease.naturalResourceLeases.value.terminateWithinDays) : d.lease.naturalDays,
    },
    earnest: {
      escrowAgentName: earnest.escrowAgentName.kind === "populated" ? earnest.escrowAgentName.value : d.earnest.escrowAgentName,
      escrowAgentAddress: earnest.escrowAgentAddress.kind === "populated" ? earnest.escrowAgentAddress.value : d.earnest.escrowAgentAddress,
      earnestMoney: numberDispositionToAmountDraft(earnest.earnestMoney),
      optionFee: numberDispositionToAmountDraft(earnest.optionFee),
      optionPeriodDays: numberDispositionToDaysDraft(earnest.optionPeriodDays),
      additionalKind: earnest.additionalEarnestMoney.kind === "populated" ? "value" : earnest.additionalEarnestMoney.kind === "not_applicable" ? "none" : d.earnest.additionalKind,
      // The report only ever wraps the "value" variant in `populated` --
      // "none" resolves to `not_applicable` instead (contract-facts-model.ts) --
      // but `AdditionalEarnestMoneyFact` itself still admits both, so this
      // narrows explicitly rather than assuming the disposition wrapper's
      // own construction discipline.
      additionalAmount: earnest.additionalEarnestMoney.kind === "populated" && earnest.additionalEarnestMoney.value.kind === "value" ? String(earnest.additionalEarnestMoney.value.amount) : d.earnest.additionalAmount,
      additionalWithinDays: earnest.additionalEarnestMoney.kind === "populated" && earnest.additionalEarnestMoney.value.kind === "value" ? String(earnest.additionalEarnestMoney.value.withinDays) : d.earnest.additionalWithinDays,
    },
    titleSurvey: {
      titlePolicyExpenseParty: title.titlePolicyExpenseParty.kind === "populated" ? title.titlePolicyExpenseParty.value : d.titleSurvey.titlePolicyExpenseParty,
      titleCompanyName: title.titleCompanyName.kind === "populated" ? title.titleCompanyName.value : d.titleSurvey.titleCompanyName,
      shortageKind: title.shortageAmendmentElection.kind === "populated" ? title.shortageAmendmentElection.value.kind : d.titleSurvey.shortageKind,
      shortageExpenseParty: title.shortageAmendmentElection.kind === "populated" && title.shortageAmendmentElection.value.kind === "amended" ? title.shortageAmendmentElection.value.expenseParty : d.titleSurvey.shortageExpenseParty,
      surveyOption: title.surveyElection.kind === "populated" ? title.surveyElection.value.option : d.titleSurvey.surveyOption,
      sellerFurnishDays: title.surveyElection.kind === "populated" && (title.surveyElection.value.option === "seller_existing_survey" || title.surveyElection.value.option === "seller_new_survey") ? String(title.surveyElection.value.sellerFurnishDays) : d.titleSurvey.sellerFurnishDays,
      buyerObtainDays: title.surveyElection.kind === "populated" && title.surveyElection.value.option === "buyer_new_survey" ? String(title.surveyElection.value.buyerObtainDays) : d.titleSurvey.buyerObtainDays,
      ifRejectedExpenseParty: title.surveyElection.kind === "populated" && title.surveyElection.value.option === "seller_existing_survey" ? title.surveyElection.value.ifRejectedExpenseParty : d.titleSurvey.ifRejectedExpenseParty,
      objectionsText: title.objectionsText.kind === "populated" ? valueOrNoneToDraft(title.objectionsText.value) : d.titleSurvey.objectionsText,
      objectionsDays: title.objectionsDays.kind === "populated" ? String(title.objectionsDays.value) : d.titleSurvey.objectionsDays,
      poaMembership: title.poaMembership.kind === "populated" ? title.poaMembership.value : d.titleSurvey.poaMembership,
    },
    propertyCondition: {
      disclosureKind: condition.sellerDisclosureNotice.kind === "populated" ? condition.sellerDisclosureNotice.value.kind : d.propertyCondition.disclosureKind,
      disclosureDays: condition.sellerDisclosureNotice.kind === "populated" && condition.sellerDisclosureNotice.value.kind === "not_yet_received" ? String(condition.sellerDisclosureNotice.value.deliverWithinDays) : d.propertyCondition.disclosureDays,
      asIsKind: condition.asIsElection.kind === "populated" ? condition.asIsElection.value.kind : d.propertyCondition.asIsKind,
      repairsText: condition.asIsElection.kind === "populated" && condition.asIsElection.value.kind === "as_is_with_repairs" ? condition.asIsElection.value.repairsText : d.propertyCondition.repairsText,
      serviceContractCap: condition.serviceContractCap.kind === "populated" ? valueOrNoneToDraft(condition.serviceContractCap.value) : d.propertyCondition.serviceContractCap,
      waterKind: condition.waterDisclosure.kind === "populated" ? condition.waterDisclosure.value.kind : d.propertyCondition.waterKind,
      waterDays: condition.waterDisclosure.kind === "populated" && condition.waterDisclosure.value.kind === "not_yet_received" ? String(condition.waterDisclosure.value.deliverWithinDays) : d.propertyCondition.waterDays,
      waterSource: condition.waterDisclosure.kind === "populated" && condition.waterDisclosure.value.kind === "exempt" ? condition.waterDisclosure.value.waterSource : d.propertyCondition.waterSource,
    },
    closingPossession: {
      // The stored value is already a canonical UTC-midnight ISO instant
      // (`YYYY-MM-DDT00:00:00.000Z`) -- slicing the string is UTC-safe by
      // construction, no Date/local-timezone conversion of any kind, same
      // discipline as the closing-date display fix earlier on this page.
      closingDate: closing.closingDate.kind === "populated" ? closing.closingDate.value.slice(0, 10) : d.closingPossession.closingDate,
      possessionElection: closing.possessionElection.kind === "populated" ? closing.possessionElection.value : d.closingPossession.possessionElection,
      possessionDetails: closing.possessionDetails.kind === "populated" ? valueOrNoneToDraft(closing.possessionDetails.value) : d.closingPossession.possessionDetails,
    },
    settlement: {
      sellerCreditCap: settlement.sellerCreditCap.kind === "populated" ? valueOrNoneToDraft(settlement.sellerCreditCap.value) : d.settlement.sellerCreditCap,
      sellerPaysKind: settlement.sellerPaysBuyerBroker.kind === "populated" ? settlement.sellerPaysBuyerBroker.value.kind : d.settlement.sellerPaysKind,
      sellerPaysAmount: settlement.sellerPaysBuyerBroker.kind === "populated" && settlement.sellerPaysBuyerBroker.value.kind === "dollar" ? String(settlement.sellerPaysBuyerBroker.value.amount) : d.settlement.sellerPaysAmount,
      sellerPaysPercent: settlement.sellerPaysBuyerBroker.kind === "populated" && settlement.sellerPaysBuyerBroker.value.kind === "percent" ? String(settlement.sellerPaysBuyerBroker.value.percent) : d.settlement.sellerPaysPercent,
      buyerPaysKind: settlement.buyerPaysSellerBroker.kind === "populated" ? settlement.buyerPaysSellerBroker.value.kind : d.settlement.buyerPaysKind,
      buyerPaysAmount: settlement.buyerPaysSellerBroker.kind === "populated" && settlement.buyerPaysSellerBroker.value.kind === "dollar" ? String(settlement.buyerPaysSellerBroker.value.amount) : d.settlement.buyerPaysAmount,
      buyerPaysPercent: settlement.buyerPaysSellerBroker.kind === "populated" && settlement.buyerPaysSellerBroker.value.kind === "percent" ? String(settlement.buyerPaysSellerBroker.value.percent) : d.settlement.buyerPaysPercent,
    },
    representation: rep.kind === "populated" && rep.value.kind !== "intermediary" ? repFactToDraft(rep.value) : d.representation,
    addenda: {
      items: addenda.items.kind === "populated" ? { ...addenda.items.value } : d.addenda.items,
      districtNotices: addenda.districtNotices.kind === "populated" ? valueOrNoneToDraft(addenda.districtNotices.value) : d.addenda.districtNotices,
    },
    sellerEquitable: { kind: equitable.kind === "populated" ? equitable.value.kind : d.sellerEquitable.kind },
    attorneySpecial: attorneySpecial.kind === "populated" ? { kind: "provided_verbatim", text: attorneySpecial.value.text } : attorneySpecial.kind === "not_applicable" ? { kind: "not_applicable", text: "" } : d.attorneySpecial,
    attorneyOther: attorneyOther.kind === "populated" ? { kind: "provided_verbatim", text: attorneyOther.value.text } : attorneyOther.kind === "not_applicable" ? { kind: "not_applicable", text: "" } : d.attorneyOther,
    buyerBusinessConfig: {
      noticeAddress: notice.buyerNoticeAddress.kind === "populated" ? notice.buyerNoticeAddress.value : d.buyerBusinessConfig.noticeAddress,
      noticePhone: notice.buyerNoticePhone.kind === "populated" ? notice.buyerNoticePhone.value : d.buyerBusinessConfig.noticePhone,
      noticeEmail: notice.buyerNoticeEmail.kind === "populated" ? notice.buyerNoticeEmail.value : d.buyerBusinessConfig.noticeEmail,
      signerName: notice.buyerSignerName.kind === "populated" ? notice.buyerSignerName.value : d.buyerBusinessConfig.signerName,
      signerRole: notice.buyerSignerRole.kind === "populated" ? notice.buyerSignerRole.value : d.buyerBusinessConfig.signerRole,
    },
    sellerNotice: {
      noticeAddress: notice.sellerNoticeAddress.kind === "populated" ? notice.sellerNoticeAddress.value : d.sellerNotice.noticeAddress,
      noticePhone: notice.sellerNoticePhone.kind === "populated" ? { mode: "value", text: notice.sellerNoticePhone.value } : notice.sellerNoticePhone.kind === "not_applicable" ? { mode: "none", text: "" } : d.sellerNotice.noticePhone,
      noticeEmail: notice.sellerNoticeEmail.kind === "populated" ? { mode: "value", text: notice.sellerNoticeEmail.value } : notice.sellerNoticeEmail.kind === "not_applicable" ? { mode: "none", text: "" } : d.sellerNotice.noticeEmail,
    },
    sellerSigning: signingModel
      ? {
          count: signingModel.kind === "one_seller" ? 1 : 2,
          seller1Capacity: signingModel.seller1Capacity,
          seller2LegalName: signingModel.kind === "two_sellers" ? signingModel.seller2.legalName : d.sellerSigning.seller2LegalName,
          seller2Email: signingModel.kind === "two_sellers" ? signingModel.seller2.email : d.sellerSigning.seller2Email,
          seller2Capacity: signingModel.kind === "two_sellers" ? signingModel.seller2Capacity : d.sellerSigning.seller2Capacity,
        }
      : d.sellerSigning,
  };
}

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
   * INV-67 Phase 1 -- Seller 1 resolution. PURE, from data already fetched
   * above (`opps`) -- no new GHL call. Distinct from `sellerNoticeCandidate`
   * (that is inherited candidate data for the seller's *notice* address;
   * this is the Opportunity's bound primary Contact identity for the
   * signer-cardinality fact).
   */
  const seller1Resolution: Seller1Resolution = useMemo(() => {
    if (screen.state !== "ready") return { ok: false, reason: "No Opportunity is selected." };
    const row = (opps ?? []).find((o) => o.id === screen.opportunity.id) ?? null;
    return resolveSeller1FromOpportunity(row ? { contactId: row.contactId, contactName: row.contactName, email: row.email } : null);
  }, [screen, opps]);

  const latestSellerSigningModel = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestSellerSigningModelForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  /**
   * Saved-fact form hydration. Populates every group's draft from the
   * currently-resolved canonical report EXACTLY ONCE per opportunity --
   * the instant canonical data first becomes available for it -- never on
   * every subsequent recompute of `sellerContractFactsReport`/
   * `latestSellerSigningModel` (both produce a new object reference on
   * every notes change, including a DIFFERENT group's own save; hydrating
   * on every recompute would silently overwrite an operator's in-progress,
   * unsaved keystrokes mid-session). `hydratedOpportunityId` tracks which
   * opportunity's drafts are already hydrated; switching opportunities
   * naturally re-triggers exactly one fresh hydration for the new one.
   */
  const hydratedOpportunityId = useRef<string | null>(null);
  useEffect(() => {
    if (screen.state !== "ready" || !sellerContractFactsReport) return;
    if (hydratedOpportunityId.current === screen.opportunity.id) return;
    hydratedOpportunityId.current = screen.opportunity.id;
    setDrafts(draftsFromReport(sellerContractFactsReport, latestSellerSigningModel?.model ?? null));
  }, [screen, sellerContractFactsReport, latestSellerSigningModel]);

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

  /**
   * Board #9 Phase B. The CURRENT generated artifact, if Brad has
   * generated one in this session -- `null` means none exists yet (or a
   * prior one was invalidated because canonical facts changed underneath
   * it). Holds ONLY what `generate-contract-pdf` independently returned;
   * nothing here is computed or claimed client-side. `pdfBase64` lives
   * only in this component's own memory for exactly as long as this page
   * is open -- no persistence, no server custody (see that endpoint's own
   * header).
   */
  const [generatedArtifact, setGeneratedArtifact] = useState<{
    pdfBase64: string;
    outputSha256: string;
    sourceSha256: string;
    generatorVersion: string;
    manifestVersion: string;
  } | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Invalidates any prior generation the instant the canonical, live-derived
  // preview changes underneath it -- Brad must re-generate before
  // authorizing against changed facts. Fires on mount too (generatedArtifact
  // is already null then, so this is a harmless no-op), and on every
  // genuine recompute of contractDocumentPreview (a new object each time
  // its own dependencies change).
  useEffect(() => {
    setGeneratedArtifact(null);
    setGenerateError(null);
  }, [contractDocumentPreview]);

  /**
   * B9-13 authorization-hydration repair (gate-review correction,
   * 2026-09-21). The "current" artifact facts `evaluateBradAuthorizationCurrency`
   * compares the saved record against. A fresh in-session generation (the
   * operator's own explicit "Generate" click) is always preferred when one
   * exists -- it is independently, freshly computed evidence, and if the
   * operator changed something that alters the generator's OUTPUT bytes
   * without changing the tracked content/version/template snapshot (a
   * generator or manifest upgrade, for instance), this is what actually
   * catches it.
   *
   * Absent a fresh generation -- true on every ordinary page load/reopen,
   * where `generatedArtifact` is always initially `null` -- there is no
   * new artifact to compare the record against, so this falls back to the
   * record's OWN saved artifact identity. This is not circular: it makes
   * `evaluateBradAuthorizationCurrency`'s four artifact-specific checks
   * (ARTIFACT_CHANGED/SOURCE_PDF_CHANGED/GENERATOR_CHANGED/MANIFEST_CHANGED)
   * correctly report "nothing to disagree with yet" while its INDEPENDENT
   * content/version/template/operator checks -- computed fresh from the
   * live `currentPreview` every time, never from this bundle -- still run
   * in full and still correctly revoke authorization the instant a real
   * contract fact changes underneath it. No PDF is generated, no write
   * session is required, and no network call of any kind happens here --
   * this is a pure, synchronous read of already-loaded note data.
   */
  const currentArtifactFactsForDisplay = useMemo(() => {
    if (generatedArtifact) {
      return {
        artifactSha256: generatedArtifact.outputSha256,
        sourcePdfSha256: generatedArtifact.sourceSha256,
        generatorVersion: generatedArtifact.generatorVersion,
        manifestVersion: generatedArtifact.manifestVersion,
      };
    }
    if (bradAuthorizationRecord) {
      return {
        artifactSha256: bradAuthorizationRecord.artifactSha256,
        sourcePdfSha256: bradAuthorizationRecord.sourcePdfSha256,
        generatorVersion: bradAuthorizationRecord.generatorVersion,
        manifestVersion: bradAuthorizationRecord.manifestVersion,
      };
    }
    return { artifactSha256: "", sourcePdfSha256: "", generatorVersion: "", manifestVersion: "" };
  }, [generatedArtifact, bradAuthorizationRecord]);

  async function handleGenerateArtifact() {
    if (screen.state !== "ready") return;
    setGenerateError(null);
    setGenerateBusy(true);
    try {
      const result = await ghl.contracts.generatePdf({ opportunityId: screen.opportunity.id });
      setGeneratedArtifact({
        pdfBase64: result.pdfBase64,
        outputSha256: result.evidence.outputSha256,
        sourceSha256: result.evidence.sourceSha256,
        generatorVersion: result.evidence.generatorVersion,
        manifestVersion: result.evidence.manifestVersion,
      });
    } catch (e: any) {
      setGeneratedArtifact(null);
      setGenerateError(e?.message ?? "Could not generate the contract PDF. Try again.");
    } finally {
      setGenerateBusy(false);
    }
  }

  const [downloadError, setDownloadError] = useState<string | null>(null);

  /**
   * Builds the downloaded file from the SAME `generatedArtifact.pdfBase64`
   * bytes already held in memory -- no network call, no new generation, no
   * second copy of the artifact. This is why the downloaded file's SHA-256
   * can never differ from `generatedArtifact.outputSha256`, the same value
   * `handleAuthorize` below binds the authorization record to: both read
   * the one in-memory generation result, never two independent fetches.
   */
  function handleDownloadArtifact() {
    if (!generatedArtifact) return;
    setDownloadError(null);
    let url: string | null = null;
    try {
      const bytes = Uint8Array.from(atob(generatedArtifact.pdfBase64), (c) => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `contract-${screen.state === "ready" ? screen.opportunity.id : "draft"}-${generatedArtifact.outputSha256.slice(0, 12)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setDownloadError("Could not prepare the PDF. Generate it again before saving authorization.");
    } finally {
      // Deferred, not immediate -- revoking synchronously right after click()
      // can race the browser's own download-start in some engines. Revoked
      // either way: on success (once the download has started) and on
      // failure (the URL, if it was created before the throw, is never left
      // dangling).
      if (url) { const revoke = url; setTimeout(() => URL.revokeObjectURL(revoke), 0); }
    }
  }

  const bradAuthorizationStatus = useMemo(() => {
    if (!contractDocumentPreview) return null;
    return evaluateBradAuthorizationCurrency(bradAuthorizationRecord, contractDocumentPreview, currentArtifactFactsForDisplay);
  }, [bradAuthorizationRecord, contractDocumentPreview, currentArtifactFactsForDisplay]);

  /**
   * Display-only derivation from `bradAuthorizationStatus` -- never a
   * second authorization computation. "saved" = currently authorized.
   * "unsaved_changes" = a PRIOR authorization exists (`record !== null`)
   * but currency now fails (something changed since). "not_saved" = no
   * authorization has ever been recorded for this revision at all.
   */
  const authorizationDisplayState: "saved" | "unsaved_changes" | "not_saved" =
    bradAuthorizationStatus?.authorized
      ? "saved"
      : bradAuthorizationStatus && bradAuthorizationStatus.record
      ? "unsaved_changes"
      : "not_saved";

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
    if (!generatedArtifact) {
      setAuthorizeError("Generate the current contract PDF before authorizing it.");
      return;
    }
    const built = buildAuthorizationRecordArgs({
      opportunityId: screen.opportunity.id,
      at: new Date().toISOString(),
      preview: contractDocumentPreview,
      currentVersion: documentVersion,
      artifact: {
        artifactSha256: generatedArtifact.outputSha256,
        sourcePdfSha256: generatedArtifact.sourceSha256,
        generatorVersion: generatedArtifact.generatorVersion,
        manifestVersion: generatedArtifact.manifestVersion,
      },
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
   * Historical Contract Sent evidence remains readable after V1 retires
   * automated sending. This section does not initiate a provider request.
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

  /**
   * B9-13 / INV-96 -- Record GHL Send (the manual bridge). Brad manually
   * uploads/sends the authorized PDF himself, in GHL's own UI, then comes
   * back here and enters exactly what he sees: the provider document id/
   * reference/revision, GHL's own displayed expiration, and the moment he
   * actually sent it. `buildManualContractSendRecordArgs` validates this
   * against the CURRENT `bradAuthorizationRecord` (a stale/cross-version
   * authorization refuses to build) and against IAOS's own required
   * signer set (never free-typed recipient names) before this handler
   * writes anything. This is the ONE missing link that otherwise leaves
   * `existingSend` always `null` and blocks every already-shipped
   * downstream verification stage below.
   */
  const [manualSendForm, setManualSendForm] = useState({
    providerDocumentId: "",
    providerDocumentReference: "",
    providerDocumentRevision: "",
    requestAt: "",
    expirationAt: "",
  });
  const [manualSendBuildError, setManualSendBuildError] = useState<string | null>(null);

  async function handleRecordManualSend() {
    if (screen.state !== "ready" || !documentVersion || requiredSigners.length === 0) return;
    setManualSendBuildError(null);
    const runtimeConfig = getRuntimeConfig();
    const requestAtIso = manualSendForm.requestAt ? new Date(manualSendForm.requestAt).toISOString() : "";
    // B9-13/INV-96 correction: GHL may report no explicit expiration for a
    // manually-sent document -- never fabricated, never required.
    const expirationAtIso = manualSendForm.expirationAt ? new Date(manualSendForm.expirationAt).toISOString() : null;
    const built = buildManualContractSendRecordArgs({
      opportunityId: screen.opportunity.id,
      agreementAt: screen.economics.agreementAt,
      version: documentVersion,
      requestAt: requestAtIso,
      expirationAt: expirationAtIso,
      providerDocumentId: manualSendForm.providerDocumentId.trim(),
      providerDocumentReference: manualSendForm.providerDocumentReference.trim() || null,
      providerDocumentRevision: manualSendForm.providerDocumentRevision.trim() === "" ? null : Number(manualSendForm.providerDocumentRevision),
      recipients: requiredSigners.map((s) => ({ role: s.role, displayName: s.displayName })),
      authorizedRecord: bradAuthorizationRecord,
      templateName: runtimeConfig.documentsContracts.expectedTemplateName,
      requestedTemplateId: runtimeConfig.documentsContracts.templateId,
      readbackLocationId: runtimeConfig.locationId,
      operator: "brad",
      recordedAt: new Date().toISOString(),
    });
    if (!built.ok) {
      setManualSendBuildError(built.reasons.map((r) => r.message).join(" "));
      return;
    }
    const note = formatContractSendNote(built.value);
    await commitNote("manual-contract-send", note);
  }

  /**
   * B9-10 / INV-65 -- Verify full execution. Jess Gate repair round,
   * 2026-09-13, items 1-2.
   *
   * This section is READ-ONLY against GHL and writes NOTHING -- it exists
   * solely to let Brad verify, in-browser, whether the three locked
   * Under Contract facts (signer completion, provider completion,
   * executed-artifact possession) actually hold, using the SAME pure
   * verification functions `test-contract-execution-model.cjs` proves.
   * `buildVerifiedUnderContractRecord` can never return `ok: true` in V1
   * (see that module's own `EXECUTED_TERMS_EVIDENCE_AVAILABLE` boundary)
   * -- Under Contract stays explicitly BLOCKED here regardless of how far
   * the other stages get.
   *
   * `providerReadback` holds the RAW outcome from `ghl.proposals.
   * listDocuments()` (already-sanctioned, already-shipped, read-only) so
   * it can feed BOTH `extractProviderSignerRowsFromListDocumentsBody`
   * (signer-level rows) AND `buildProviderObservationRecordFromReadback`
   * (INV-64's own provider-completion chronology) from the exact same
   * live fetch -- never two divergent reads.
   */
  const [providerReadback, setProviderReadback] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; outcome: { kind: "http_response"; status: number; body: unknown }; fetchedAt: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleFetchProviderReadback() {
    setProviderReadback({ kind: "loading" });
    const outcome = await ghl.proposals.listDocuments({ limit: 21 });
    if (outcome.kind === "network_error") {
      setProviderReadback({ kind: "error", message: outcome.message });
      return;
    }
    setProviderReadback({ kind: "loaded", outcome, fetchedAt: new Date().toISOString() });
  }

  const providerDocumentId = existingSend?.providerResponse?.documentId ?? null;
  const providerExpectedLocationId = existingSend?.providerResponse?.readbackLocationId ?? null;

  const providerSignerRowsResult = useMemo(() => {
    if (providerReadback.kind !== "loaded" || !providerDocumentId || !providerExpectedLocationId) return null;
    return extractProviderSignerRowsFromListDocumentsBody({
      body: providerReadback.outcome.body,
      expectedDocumentId: providerDocumentId,
      expectedLocationId: providerExpectedLocationId,
    });
  }, [providerReadback, providerDocumentId, providerExpectedLocationId]);

  const lifecycleObservationRecord: LifecycleRecord | null = useMemo(() => {
    if (
      providerReadback.kind !== "loaded" || screen.state !== "ready" || !existingSend ||
      existingSend.status !== "accepted" || !providerDocumentId || !providerExpectedLocationId
    ) return null;
    const built = buildProviderObservationRecordFromReadback({
      opportunityId: screen.opportunity.id,
      version: existingSend.version,
      expectedDocumentId: providerDocumentId,
      expectedLocationId: providerExpectedLocationId,
      acceptedSend: existingSend,
      outcome: providerReadback.outcome,
      iaosObservedAt: providerReadback.fetchedAt,
      evidenceSummary: `Live in-browser readback via GET /proposals/document, fetched ${providerReadback.fetchedAt}.`,
      relatedPriorRecordId: null,
    });
    return built.ok ? built.value : null;
  }, [providerReadback, screen, existingSend, providerDocumentId, providerExpectedLocationId]);

  const providerCompletionResult = useMemo(() => {
    if (screen.state !== "ready" || !existingSend || !lifecycleObservationRecord) return null;
    return verifyProviderCompletion({ opportunityId: screen.opportunity.id, version: existingSend.version, lifecycleHistory: [lifecycleObservationRecord] });
  }, [screen, existingSend, lifecycleObservationRecord]);

  /**
   * B9-10 / INV-65 -- Product Owner ruling, 2026-09-13. WHO must sign is
   * assembled ONLY from IAOS's own authoritative contract facts (BTC
   * LLC's configured buyer signer + every recorded seller signer) --
   * NEVER from the accepted send's own `signers[]`. See
   * `contract-signer-mapping-model.ts`'s own header.
   */
  const requiredSignerSetResult = useMemo(() => {
    if (!sellerContractFactsReport) return null;
    return buildRequiredSignerSet(sellerContractFactsReport);
  }, [sellerContractFactsReport]);

  const requiredSigners: readonly RequiredSigner[] = requiredSignerSetResult && requiredSignerSetResult.ok ? requiredSignerSetResult.signers : [];

  const availableProviderRecipientIds = useMemo(() => {
    if (!providerSignerRowsResult || !providerSignerRowsResult.ok) return [];
    return providerSignerRowsResult.rows.map((r) => r.providerRecipientId);
  }, [providerSignerRowsResult]);

  const existingSignerMappingAttestation = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestSignerMappingAttestationForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const signerMappingCurrencyResult = useMemo(() => {
    if (screen.state !== "ready" || !existingSend || existingSend.status !== "accepted" || !providerDocumentId || requiredSigners.length === 0) return null;
    return verifySignerMappingAttestationCurrency({
      attestation: existingSignerMappingAttestation,
      opportunityId: screen.opportunity.id,
      version: existingSend.version,
      providerDocumentId,
      providerDocumentRevision: existingSend.providerResponse?.documentRevision ?? null,
      acceptedSendAttemptId: existingSend.attemptId,
      requiredSigners,
    });
  }, [screen, existingSend, providerDocumentId, requiredSigners, existingSignerMappingAttestation]);

  const signerVerificationResult = useMemo(() => {
    if (!signerMappingCurrencyResult || !signerMappingCurrencyResult.ok || !providerSignerRowsResult || !providerSignerRowsResult.ok) return null;
    return verifyRequiredSigners({ mappings: signerMappingCurrencyResult.mappings, providerRecipients: providerSignerRowsResult.rows });
  }, [signerMappingCurrencyResult, providerSignerRowsResult]);

  /**
   * B9-13 / INV-96 -- blocking, case-insensitive check that the buyer's
   * mapped provider recipient's GHL-reported name matches the authorized
   * legal buyer name. Live as soon as Brad's own mapping currency check
   * passes, same dependency shape as `signerVerificationResult` above --
   * this never selects or suggests a mapping itself, only verifies one
   * already made.
   */
  const buyerSignerIdentityResult = useMemo(() => {
    if (!signerMappingCurrencyResult || !signerMappingCurrencyResult.ok || !providerSignerRowsResult || !providerSignerRowsResult.ok || !requiredSignerSetResult || !requiredSignerSetResult.ok) return null;
    return verifyBuyerSignerIdentity({
      buyerSignerRole: requiredSignerSetResult.buyerRole,
      authorizedBuyerName: requiredSignerSetResult.buyerDisplayName,
      authorizedBuyerEmail: requiredSignerSetResult.buyerEmail,
      mappings: signerMappingCurrencyResult.mappings,
      providerRecipients: providerSignerRowsResult.rows,
    });
  }, [signerMappingCurrencyResult, providerSignerRowsResult, requiredSignerSetResult]);

  /**
   * Brad's own manual, one-to-one recipient-mapping assignment -- NEVER
   * auto-paired by array order, GHL's generic role string, or a guessed
   * name/email match. `mappingAssignments` is keyed by required-signer
   * role, valued by the provider recipient id Brad picked for it; reset
   * whenever the provider document/revision changes, since a prior
   * in-progress (unsaved) assignment made against different evidence is
   * never carried forward silently.
   */
  const [mappingAssignments, setMappingAssignments] = useState<Record<string, string>>({});
  const [mappingBuildError, setMappingBuildError] = useState<string | null>(null);

  useEffect(() => {
    setMappingAssignments({});
    setMappingBuildError(null);
  }, [providerDocumentId, existingSend?.providerResponse?.documentRevision]);

  const allSignersAssigned = requiredSigners.length > 0 && requiredSigners.every((s) => mappingAssignments[s.role] !== undefined && mappingAssignments[s.role] !== "");

  /**
   * The ONLY write this mapping form performs -- routed through the SAME
   * shared `commitNote` every group-form Save button already uses.
   * `buildSignerMappingAttestationRecordArgs` itself refuses to build a
   * record unless the assignment is a true, complete, unambiguous
   * bijection -- this handler never bypasses that gate.
   */
  async function handleRecordSignerMapping() {
    if (screen.state !== "ready" || !existingSend || existingSend.status !== "accepted" || !providerDocumentId) return;
    setMappingBuildError(null);
    const assignments = requiredSigners.map((s) => ({ role: s.role, providerRecipientId: mappingAssignments[s.role] ?? "" }));
    const built = buildSignerMappingAttestationRecordArgs({
      opportunityId: screen.opportunity.id,
      version: existingSend.version,
      agreementAt: screen.economics.agreementAt,
      providerDocumentId,
      providerDocumentRevision: existingSend.providerResponse?.documentRevision ?? null,
      acceptedSendAttemptId: existingSend.attemptId,
      attestedAt: new Date().toISOString(),
      requiredSigners,
      availableProviderRecipientIds,
      assignments,
      evidenceSummary: "Brad's own factual, visually-verified mapping of each required signer to its GHL provider recipient id.",
    });
    if (!built.ok) {
      setMappingBuildError(built.reasons.map((r) => r.message).join(" "));
      return;
    }
    const note = formatSignerMappingAttestationNote(built.value);
    await commitNote("signer-mapping-attestation", note);
  }

  /**
   * The manual executed-artifact bridge. NEVER uploaded, persisted,
   * logged, or cached: `handleManualFileSelected` reads the chosen
   * `File`'s bytes into an in-memory `ArrayBuffer`/`Uint8Array` that
   * exists ONLY inside this async function's own local variables, hashes
   * it via `computeManualArtifactSha256Hex` (Web Crypto,
   * `browser-artifact-hash.ts`), and stores ONLY the resulting
   * `ManualArtifactSelectionOutcome` -- which, by construction (its own
   * type), can carry a `sha256` string but never a byte). Once this
   * function returns, the bytes have no remaining reference anywhere in
   * this component and are eligible for garbage collection. The `<input>`
   * itself is cleared immediately after reading so the DOM does not keep
   * holding the selected `File` either.
   */
  const [manualFileOutcome, setManualFileOutcome] = useState<ManualArtifactSelectionOutcome | null>(null);
  const [manualFileBusy, setManualFileBusy] = useState(false);

  async function handleManualFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) {
      setManualFileOutcome({ kind: "no_file" });
      return;
    }
    setManualFileBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const bytesOutcome = classifySelectedFileBytes({ fileName: file.name, mimeType: file.type || null, bytes });
      if (bytesOutcome.kind !== "valid_bytes") {
        setManualFileOutcome(bytesOutcome);
        return;
      }
      const sha256 = await computeManualArtifactSha256Hex(bytesOutcome.bytes);
      const pageCount = await countPdfPages(bytesOutcome.bytes);
      setManualFileOutcome({ kind: "selected", sha256, fileName: bytesOutcome.fileName, mimeType: bytesOutcome.mimeType, pageCount });
    } catch (err: any) {
      setManualFileOutcome({ kind: "unreadable", message: err?.message ?? "The file could not be read." });
    } finally {
      setManualFileBusy(false);
    }
  }

  const manualArtifactVerificationResult = useMemo(() => {
    if (!manualFileOutcome || !existingSend || existingSend.status !== "accepted" || !providerDocumentId) return null;
    return verifyManualArtifactSelection({
      outcome: manualFileOutcome,
      confirmedProviderDocumentId: providerDocumentId,
      selectedForDocumentId: providerDocumentId,
      selectedForVersion: existingSend.version,
      expectedVersion: existingSend.version,
    });
  }, [manualFileOutcome, existingSend, providerDocumentId]);

  /**
   * B9-10 / INV-65 -- executed-terms attestation. Product Owner ruling,
   * 2026-09-13: "For single-user IAOS V1, Brad's factual visual
   * attestation may verify that the material terms visible in the
   * selected, hash-verified executed PDF match the authoritative
   * Agreement Reached record." IAOS never reads the PDF's own content --
   * every checklist item's `authoritativeLabel` below is sourced entirely
   * from IAOS's own already-held facts (the accepted price/address, the
   * fixed buyer identity, the deterministically-derived expected
   * signers); Brad compares those against what he sees on the downloaded
   * PDF, outside this page entirely, and answers per item.
   */
  const materialTermSnapshot: MaterialTermSnapshot | null = useMemo(() => {
    if (screen.state !== "ready") return null;
    return { price: screen.agreedPrice, propertyAddress: screen.propertyAddress, parties: [] };
  }, [screen]);

  const buyerIdentityLabel = useMemo(() => {
    if (!sellerContractFactsReport) return null;
    return sellerContractFactsReport.parties.buyerEntityName.kind === "populated"
      ? sellerContractFactsReport.parties.buyerEntityName.value
      : "unresolved";
  }, [sellerContractFactsReport]);

  const checklistItems: readonly ChecklistItem[] = useMemo(() => {
    if (!materialTermSnapshot || !buyerIdentityLabel || requiredSigners.length === 0) return [];
    return buildExecutedTermsChecklist({ agreement: materialTermSnapshot, buyerIdentity: buyerIdentityLabel, expectedSigners: requiredSigners });
  }, [materialTermSnapshot, buyerIdentityLabel, requiredSigners]);

  function checklistItemKey(item: { kind: ChecklistItemKind; signerRole: string | null }): string {
    return `${item.kind}::${item.signerRole ?? ""}`;
  }

  const [checklistResponses, setChecklistResponses] = useState<Record<string, ChecklistResponseValue>>({});
  const [attestationBuildError, setAttestationBuildError] = useState<string | null>(null);

  // A change of provider document, revision, or selected artifact hash
  // means any in-progress (unsaved) responses were answered against
  // DIFFERENT evidence -- never carried forward silently.
  useEffect(() => {
    setChecklistResponses({});
    setAttestationBuildError(null);
  }, [providerDocumentId, existingSend?.providerResponse?.documentRevision, manualArtifactVerificationResult?.ok ? manualArtifactVerificationResult.sha256 : null]);

  const existingAttestation = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestExecutedTermsAttestationForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const attestationCurrencyResult = useMemo(() => {
    if (screen.state !== "ready" || !existingSend || existingSend.status !== "accepted" || !providerDocumentId || !manualArtifactVerificationResult || !manualArtifactVerificationResult.ok) return null;
    return verifyExecutedTermsAttestationCurrency({
      attestation: existingAttestation,
      opportunityId: screen.opportunity.id,
      version: existingSend.version,
      providerDocumentId,
      providerDocumentRevision: existingSend.providerResponse?.documentRevision ?? null,
      selectedArtifactSha256: manualArtifactVerificationResult.sha256,
    });
  }, [screen, existingSend, providerDocumentId, manualArtifactVerificationResult, existingAttestation]);

  const allChecklistItemsAnswered = checklistItems.length > 0 && checklistItems.every((item) => checklistResponses[checklistItemKey(item)] !== undefined);

  /**
   * The ONLY write this section performs -- routed through the SAME
   * shared `commitNote` every group-form Save button already uses, never
   * a new direct `ghl.notes.create()` call site. `buildExecutedTermsAttestationRecordArgs`
   * itself refuses to build a record unless every item was answered and
   * every answer is `"MATCHES"` (ruling item 3) -- this handler never
   * bypasses that gate.
   */
  async function handleRecordAttestation() {
    if (
      screen.state !== "ready" || !existingSend || existingSend.status !== "accepted" ||
      !providerDocumentId || !manualArtifactVerificationResult || !manualArtifactVerificationResult.ok
    ) return;
    setAttestationBuildError(null);
    const responses = checklistItems.map((item) => ({ kind: item.kind, signerRole: item.signerRole, result: checklistResponses[checklistItemKey(item)] }));
    const built = buildExecutedTermsAttestationRecordArgs({
      opportunityId: screen.opportunity.id,
      version: existingSend.version,
      agreementAt: screen.economics.agreementAt,
      providerDocumentId,
      providerDocumentRevision: existingSend.providerResponse?.documentRevision ?? null,
      selectedArtifactSha256: manualArtifactVerificationResult.sha256,
      attestedAt: new Date().toISOString(),
      requiredItems: checklistItems,
      responses,
      evidenceSummary: "Brad's own factual visual comparison of the selected, hash-verified executed PDF against the authoritative Agreement Reached record.",
    });
    if (!built.ok) {
      setAttestationBuildError(built.reasons.map((r) => r.message).join(" "));
      return;
    }
    const note = formatExecutedTermsAttestationNote(built.value);
    await commitNote("executed-terms-attestation", note);
  }

  const fullVerificationResult = useMemo(() => {
    if (
      screen.state !== "ready" || !existingSend || existingSend.status !== "accepted" ||
      !providerSignerRowsResult || !providerSignerRowsResult.ok || !lifecycleObservationRecord ||
      !manualFileOutcome || !providerDocumentId || requiredSigners.length === 0 ||
      !requiredSignerSetResult || !requiredSignerSetResult.ok
    ) return null;
    return buildVerifiedUnderContractRecord({
      opportunityId: screen.opportunity.id,
      agreementAt: screen.economics.agreementAt,
      version: existingSend.version,
      acceptedSend: existingSend,
      requiredSigners,
      buyerSignerRole: requiredSignerSetResult.buyerRole,
      authorizedBuyerName: requiredSignerSetResult.buyerDisplayName,
      authorizedBuyerEmail: requiredSignerSetResult.buyerEmail,
      signerMappingAttestation: existingSignerMappingAttestation,
      providerRecipients: providerSignerRowsResult.rows,
      lifecycleHistory: [lifecycleObservationRecord],
      manualArtifactOutcome: manualFileOutcome,
      selectedForDocumentId: providerDocumentId,
      selectedForVersion: existingSend.version,
      executedTermsAttestation: existingAttestation,
      iaosVerifiedAt: new Date().toISOString(),
      evidenceSummary: "Manual in-browser verification: live GHL readback (signer completion, provider completion), Brad's own recorded signer-recipient mapping, a manually selected executed-artifact hash, and Brad's own recorded executed-terms attestation.",
      relatedPriorRecordId: null,
    });
  }, [screen, existingSend, providerSignerRowsResult, lifecycleObservationRecord, manualFileOutcome, providerDocumentId, requiredSigners, requiredSignerSetResult, existingSignerMappingAttestation, existingAttestation]);

  /**
   * B9-10 / INV-65, ruling item 4 -- Under Contract persistence. THE ONLY
   * place this page may ever write an Under Contract record, and ONLY
   * ever reachable once `fullVerificationResult.ok` -- every earlier gate
   * (required signers, signer mapping, signer completion, provider
   * completion, artifact hash, executed-terms attestation) has already
   * independently passed by construction; this handler adds no shortcut
   * of its own.
   *
   * Sequence, exactly as ruled: (1) refuse outright if an existing
   * record for this EXACT verified execution already exists
   * (`isDuplicateUnderContractRecord`) -- never write a second one; (2)
   * append the one new note via the same sanctioned `ghl.notes.create()`
   * every write in this app uses; (3) immediately re-fetch notes FRESH
   * (never trust local state, never trust the write call's own success
   * alone); (4) parse every fresh note through the canonical carrier and
   * require EXACT equality with the record requested for persistence
   * (`verifyReadbackMatchesWritten`); (5) report success ONLY after that
   * verified match. Any failure at any step reports a precise fail-closed
   * status, never retries automatically, and explicitly warns that a
   * write may have occurred so Brad can reconcile directly in GHL.
   */
  const [underContractWriteState, setUnderContractWriteState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "success"; record: UnderContractRecordEntry }
    | { kind: "already_recorded"; record: UnderContractRecordEntry }
    | { kind: "failed"; message: string; writeMayHaveOccurred: boolean }
  >({ kind: "idle" });

  async function handleCreateUnderContract() {
    if (screen.state !== "ready" || !fullVerificationResult || !fullVerificationResult.ok || !notes) return;
    setUnderContractWriteState({ kind: "busy" });
    const candidate = fullVerificationResult.value;

    // Replay/history safety -- refuse a duplicate BEFORE ever writing.
    const existingRecords = allUnderContractRecordsForOpportunity(notes, screen.opportunity.id);
    const duplicate = existingRecords.find((r) => isDuplicateUnderContractRecord(r, candidate));
    if (duplicate) {
      setUnderContractWriteState({ kind: "already_recorded", record: duplicate });
      return;
    }

    const note = formatUnderContractNote(candidate);
    try {
      await ghl.notes.create(contactId, note);
    } catch (e: any) {
      setUnderContractWriteState({
        kind: "failed",
        message: `The write itself failed: ${e?.message ?? "unknown error"} -- do not assume a record was NOT created; verify directly in GHL before retrying.`,
        writeMayHaveOccurred: true,
      });
      return;
    }

    // A FRESH readback -- never the local, possibly-stale `notes` state.
    let freshNotes: { id: string; body: string; dateAdded: string }[];
    try {
      const freshResult = await ghl.notes.list(contactId);
      freshNotes = freshResult.notes ?? [];
    } catch (e: any) {
      setUnderContractWriteState({
        kind: "failed",
        message: `The write may have succeeded, but the readback fetch itself failed: ${e?.message ?? "unknown error"} -- verify directly in GHL before retrying; this action does not retry automatically.`,
        writeMayHaveOccurred: true,
      });
      return;
    }
    setNotes(freshNotes);

    const parsedCandidates = freshNotes
      .map((n) => parseUnderContractNote(n.body))
      .filter((r): r is UnderContractRecordEntry => r !== null);
    const matchingReadback = parsedCandidates.find((r) => matchesUnderContractEvidenceIdentity(r, candidate)) ?? null;
    const readbackCheck = verifyReadbackMatchesWritten(candidate, matchingReadback);
    if (!readbackCheck.ok) {
      setUnderContractWriteState({
        kind: "failed",
        message: `${readbackCheck.reason} A note carrying this exact evidence may or may not now exist in GHL -- verify directly before retrying; this action does not retry automatically.`,
        writeMayHaveOccurred: true,
      });
      return;
    }

    setUnderContractWriteState({ kind: "success", record: candidate });
  }

  /**
   * Board #9 Phase B (B9-13) -- executed-PDF durable preservation.
   * Product Owner ruling, 2026-09-21: GHL exposes no supported retrieval
   * path for the executed document's bytes, so Brad downloads the
   * completed PDF from GHL himself and uploads it here. Chunked through
   * the existing Netlify Function architecture (never an Edge Function) --
   * `CHUNK_SIZE_BYTES` keeps each request's base64-encoded body safely
   * under Netlify's ~4.5 MB effective binary-payload ceiling for classic
   * Functions. The server independently reassembles, validates, hashes,
   * stores, and re-reads the bytes before ever recording durable
   * metadata -- this handler only drives that sequence, it never claims
   * success on its own say-so.
   */
  const preservedArtifactRecord = useMemo(() => {
    if (screen.state !== "ready" || !notes || !documentVersion) return null;
    return latestPreservedExecutedArtifactForVersion(notes, screen.opportunity.id, screen.economics.agreementAt, documentVersion);
  }, [screen, notes, documentVersion]);

  const [preserveUploadState, setPreserveUploadState] = useState<
    | { kind: "idle" }
    | { kind: "uploading"; chunkIndex: number; chunkCount: number }
    | { kind: "success"; alreadyPreserved: boolean; sha256: string; byteCount: number; pageCount: number | null }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  async function handlePreserveExecutedArtifact(file: File) {
    if (screen.state !== "ready" || !documentVersion || !existingSend?.providerResponse?.documentId) return;
    const providerDocumentId = existingSend.providerResponse.documentId;
    setPreserveUploadState({ kind: "uploading", chunkIndex: 0, chunkCount: 1 });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE_BYTES));
      const uploadId = (globalThis.crypto && "randomUUID" in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${screen.opportunity.id}-${Date.now()}`;
      const call = async (body: unknown) => {
        const res = await appWriteFetch("/.netlify/functions/ghl-executed-artifact-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const parsed = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(parsed.error ?? "Preservation request refused");
        return parsed;
      };
      for (let i = 0; i < chunkCount; i++) {
        setPreserveUploadState({ kind: "uploading", chunkIndex: i, chunkCount });
        const slice = bytes.subarray(i * CHUNK_SIZE_BYTES, Math.min(bytes.length, (i + 1) * CHUNK_SIZE_BYTES));
        let binary = "";
        for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
        await call({
          phase: "chunk", opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion,
          uploadId, chunkIndex: i, chunkCount, totalByteCount: bytes.length, originalFileName: file.name, chunkBase64: btoa(binary),
        });
      }
      const finalized = await call({
        phase: "finalize", opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion,
        uploadId, providerDocumentId,
      });
      setPreserveUploadState({ kind: "success", alreadyPreserved: !!finalized.alreadyPreserved, sha256: finalized.sha256, byteCount: finalized.byteCount, pageCount: finalized.pageCount ?? null });
    } catch (e: any) {
      setPreserveUploadState({ kind: "failed", message: e?.message ?? "Preservation failed unexpectedly" });
    }
  }

  /**
   * Board #9 Phase B (B9-13) -- the Under Contract GHL opportunity-stage
   * transition. Offered ONLY once both a durable Under Contract record
   * AND a durable preserved-artifact record exist for this exact
   * opportunity/version -- the server independently re-verifies both
   * from fresh evidence before it will ever attempt the write; this
   * handler adds no shortcut of its own.
   */
  const [stageTransitionState, setStageTransitionState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "success"; alreadyInStage: boolean }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  async function handleTransitionUnderContractStage() {
    if (screen.state !== "ready" || !documentVersion) return;
    setStageTransitionState({ kind: "busy" });
    try {
      const result = await ghl.opportunities.transitionToUnderContractStage(screen.opportunity.id, screen.economics.agreementAt, documentVersion);
      setStageTransitionState({ kind: "success", alreadyInStage: !!result.alreadyInStage });
    } catch (e: any) {
      setStageTransitionState({ kind: "failed", message: e?.message ?? "Stage transition failed unexpectedly" });
    }
  }

  /**
   * Board #9 Phase B (B9-13), gate-review §5 ruling -- Start Disposition's
   * REAL gate must be durable, never `stageTransitionState` (browser-local,
   * resets on reload and proves nothing on its own). This is a fresh,
   * independent GHL read of the opportunity's own live `pipelineId`/
   * `pipelineStageId` -- never the transition call's own claimed readback,
   * never a note's claim. Refetched on every fresh load AND again after a
   * successful transition (`stageTransitionState.kind` in the dependency
   * array), so the durable GHL state -- not local success state -- is what
   * actually makes Start Disposition appear, exactly as ruled.
   */
  const [opportunityStageSnapshot, setOpportunityStageSnapshot] = useState<{ pipelineId: string; pipelineStageId: string } | null>(null);

  useEffect(() => {
    if (screen.state !== "ready") { setOpportunityStageSnapshot(null); return; }
    let cancelled = false;
    const opportunityId = screen.opportunity.id;
    ghl.opportunities.get(opportunityId).then((res: any) => {
      if (cancelled) return;
      const opp = res?.opportunity ?? res;
      if (opp && typeof opp.pipelineId === "string" && typeof opp.pipelineStageId === "string") {
        setOpportunityStageSnapshot({ pipelineId: opp.pipelineId, pipelineStageId: opp.pipelineStageId });
      } else {
        setOpportunityStageSnapshot(null);
      }
    }).catch(() => { if (!cancelled) setOpportunityStageSnapshot(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.state, screen.state === "ready" ? screen.opportunity.id : null, stageTransitionState.kind]);

  const underContractStageConfirmed =
    opportunityStageSnapshot !== null &&
    opportunityStageSnapshot.pipelineId === getRuntimeConfig().pipelines.sellerLeads &&
    opportunityStageSnapshot.pipelineStageId === getRuntimeConfig().stages.underContract;

  /**
   * B9-11 / INV-66 -- the no-reentry handoff to Board #10 Buyer
   * Disposition. Everything below is READ-ONLY against GHL except
   * `handleStartDisposition`'s own final write, gated exactly like
   * `handleCreateUnderContract` above: Start Disposition is offered ONLY
   * once a genuinely canonical-carrier-parsed Under Contract record
   * exists for this exact opportunity/agreement/version, with no later
   * rescission and no equivalent handoff already recorded.
   */
  const currentUnderContractRecord: UnderContractRecordEntry | null = useMemo(() => {
    if (screen.state !== "ready" || !notes || !documentVersion) return null;
    const all = allUnderContractRecordsForOpportunity(notes, screen.opportunity.id);
    return all.find((r) => r.agreementAt === screen.economics.agreementAt && isSameContractVersion(r.version, documentVersion)) ?? null;
  }, [screen, notes, documentVersion]);

  /**
   * Gate-review closure -- PR #85 live-Test proof, requirement 5: on a
   * page reload, `underContractWriteState` starts back at `{kind:
   * "idle"}` (it is plain component state, not durable) even when a
   * verified Under Contract record already exists in `notes` -- the
   * button previously stayed enabled until clicked once more. Hydrates
   * from the SAME durable, freshly-parsed `currentUnderContractRecord`
   * the rest of this page already uses for gating (Start Disposition,
   * etc.), never a second/different lookup. Only ever transitions FROM
   * "idle" -- never overrides an in-flight "busy" write or a "failed"
   * result the operator still needs to see.
   */
  useEffect(() => {
    if (underContractWriteState.kind !== "idle" || !currentUnderContractRecord) return;
    setUnderContractWriteState({ kind: "already_recorded", record: currentUnderContractRecord });
  }, [currentUnderContractRecord, underContractWriteState.kind]);

  const dispositionLifecycleHistory = useMemo(() => {
    if (screen.state !== "ready" || !notes) return [];
    return allContractLifecycleRecordsForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const existingDispositionHandoffs = useMemo(() => {
    if (screen.state !== "ready" || !notes) return [];
    return allDispositionHandoffsForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  /**
   * Gate-review closure -- PR #85 preventive repair, same pattern as
   * `currentUnderContractRecord`'s own reload-hydration. The durable,
   * freshly-parsed handoff that is genuinely CURRENT for the CURRENT
   * Under Contract evidence -- never merely "the latest handoff note
   * that happens to exist" (a superseded/stale handoff for a prior
   * version must never be mistaken for current).
   */
  const currentDispositionHandoff: DispositionHandoffRecord | null = useMemo(() => {
    if (screen.state !== "ready" || !documentVersion || !currentUnderContractRecord) return null;
    return existingDispositionHandoffs.find((h) => verifyHandoffMatchesUnderContract({
      handoff: h, opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion, underContract: currentUnderContractRecord,
    }).ok) ?? null;
  }, [screen, documentVersion, currentUnderContractRecord, existingDispositionHandoffs]);

  const dispositionEligibility = useMemo(() => {
    if (screen.state !== "ready" || !documentVersion) return null;
    return evaluateDispositionHandoffEligibility({
      opportunityId: screen.opportunity.id,
      agreementAt: screen.economics.agreementAt,
      version: documentVersion,
      underContract: currentUnderContractRecord,
      lifecycleHistory: dispositionLifecycleHistory,
      existingHandoffsForOpportunity: existingDispositionHandoffs.map((h) => ({ agreementAt: h.agreementAt, version: h.version, underContractVerifiedAt: h.underContract.verifiedAt })),
    });
  }, [screen, documentVersion, currentUnderContractRecord, dispositionLifecycleHistory, existingDispositionHandoffs]);

  /**
   * Every downstream section below is sourced from an already-canonical
   * upstream carrier/model, copied verbatim -- never recomputed. ARV and
   * repairs are the frozen `OutcomeSnapshot` values captured at Agreement
   * Reached (`screen.economics.economics`), exactly as
   * `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s "Consuming Board #8
   * economics, never recomputing them" requires -- ARV's own
   * evidence-state provenance is cross-matched via the EXISTING
   * `matchingArvApprovalForOpportunity` (B8-07/INV-50), never a new
   * comparison. Access/showing information and photo/document references
   * have no upstream carrier anywhere in this codebase (confirmed absent
   * this issue) -- represented honestly, never fabricated.
   */
  const dispositionArvApprovalMatch = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return matchingArvApprovalForOpportunity(notes, screen.opportunity.id, screen.economics.economics.arv);
  }, [screen, notes]);

  const dispositionPackagePreviewArgs = useMemo(() => {
    if (screen.state !== "ready" || !documentVersion || !sellerContractFactsReport || !currentUnderContractRecord || !requiredSignerSetResult || !requiredSignerSetResult.ok) return null;
    const arv = screen.economics.economics.arv;
    const repairs = screen.economics.economics.repairs;
    return {
      opportunityId: screen.opportunity.id,
      contactId,
      agreementAt: screen.economics.agreementAt,
      version: documentVersion,
      underContract: currentUnderContractRecord,
      propertyAddress: propertyStreetAddressDisposition,
      propertyLegalDescription: sellerContractFactsReport.propertyLegalDescription,
      sellerContractPrice: screen.economics.economics.currentOffer,
      approvedArv: arv === null ? null : {
        amount: arv,
        approvalEvidenceState: dispositionArvApprovalMatch?.evidenceState ?? null,
        approvalDecision: dispositionArvApprovalMatch?.decision ?? null,
        approvedAt: dispositionArvApprovalMatch?.approvedAt ?? null,
      },
      approvedRepairs: repairs,
      closingDate: sellerContractFactsReport.closingPossession.closingDate,
      possessionDetails: sellerContractFactsReport.closingPossession.possessionDetails,
      accessShowingInformation: { kind: "unresolved" as const },
      sellerContact: {
        noticeAddress: sellerContractFactsReport.noticeContact.sellerNoticeAddress,
        noticePhone: sellerContractFactsReport.noticeContact.sellerNoticePhone,
        noticeEmail: sellerContractFactsReport.noticeContact.sellerNoticeEmail,
      },
      requiredSigners: requiredSignerSetResult.signers,
      documentReferences: [] as readonly DocumentReference[],
      documentReferencesNote: "No photo/document carrier exists in IAOS today -- this list is honestly empty, not omitted.",
      evidenceSummary: "No-reentry disposition-start handoff to Board #10, assembled from already-canonical Board #9 upstream sources.",
    };
  }, [screen, documentVersion, sellerContractFactsReport, currentUnderContractRecord, requiredSignerSetResult, contactId, propertyStreetAddressDisposition, dispositionArvApprovalMatch]);

  const dispositionPackagePreview = useMemo(() => {
    if (!dispositionPackagePreviewArgs || !dispositionEligibility) return null;
    return buildDispositionHandoffRecordArgs(Object.assign({}, dispositionPackagePreviewArgs, {
      handoffId: "preview",
      createdAt: new Date().toISOString(),
      eligibility: dispositionEligibility,
    }));
  }, [dispositionPackagePreviewArgs, dispositionEligibility]);

  const [dispositionWriteState, setDispositionWriteState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "success"; record: DispositionHandoffRecord }
    | { kind: "already_recorded"; record: DispositionHandoffRecord }
    | { kind: "failed"; message: string; writeMayHaveOccurred: boolean }
  >({ kind: "idle" });

  /**
   * Gate-review closure -- PR #85 preventive repair, same pattern as
   * `underContractWriteState`'s own reload-hydration effect. On a page
   * reload `dispositionWriteState` starts back at `{kind: "idle"}` even
   * when a durable, current handoff already exists -- Start Disposition
   * previously stayed enabled until clicked once more. Only ever
   * transitions FROM "idle" -- never overrides an in-flight "busy" write
   * or a "failed" result the operator still needs to see.
   */
  useEffect(() => {
    if (dispositionWriteState.kind !== "idle" || !currentDispositionHandoff) return;
    setDispositionWriteState({ kind: "already_recorded", record: currentDispositionHandoff });
  }, [currentDispositionHandoff, dispositionWriteState.kind]);

  /**
   * THE ONLY write this section performs. On Brad's explicit click only:
   * (1) re-evaluate eligibility against FRESH local `notes` state (not a
   * cached value); (2) refuse a duplicate equivalent handoff before ever
   * writing; (3) append exactly one note via the existing sanctioned
   * `ghl.notes.create()`; (4) perform an independent, fresh
   * `ghl.notes.list()` readback; (5) parse every fresh note through the
   * canonical handoff carrier; (6) require EXACT equality with the
   * requested snapshot; (7) report success only after that verified
   * match. Any ambiguous failure never retries automatically and warns
   * that a write may have occurred.
   */
  async function handleStartDisposition() {
    if (screen.state !== "ready" || !documentVersion || !notes) return;
    setDispositionWriteState({ kind: "busy" });

    // Re-evaluate eligibility against the CURRENT notes, not a stale memo.
    const freshUnderContract = allUnderContractRecordsForOpportunity(notes, screen.opportunity.id).find(
      (r) => r.agreementAt === screen.economics.agreementAt && isSameContractVersion(r.version, documentVersion),
    ) ?? null;
    const freshLifecycle = allContractLifecycleRecordsForOpportunity(notes, screen.opportunity.id);
    const freshHandoffs = allDispositionHandoffsForOpportunity(notes, screen.opportunity.id);
    const freshEligibility = evaluateDispositionHandoffEligibility({
      opportunityId: screen.opportunity.id,
      agreementAt: screen.economics.agreementAt,
      version: documentVersion,
      underContract: freshUnderContract,
      lifecycleHistory: freshLifecycle,
      existingHandoffsForOpportunity: freshHandoffs.map((h) => ({ agreementAt: h.agreementAt, version: h.version, underContractVerifiedAt: h.underContract.verifiedAt })),
    });
    if (!freshEligibility.eligible) {
      setDispositionWriteState({
        kind: "failed",
        message: "Eligibility no longer holds: " + freshEligibility.reasons.map((r) => r.message).join(" "),
        writeMayHaveOccurred: false,
      });
      return;
    }
    if (!freshUnderContract || !dispositionPackagePreviewArgs) {
      setDispositionWriteState({ kind: "failed", message: "The disposition package could not be assembled from current evidence.", writeMayHaveOccurred: false });
      return;
    }

    const built = buildDispositionHandoffRecordArgs(Object.assign({}, dispositionPackagePreviewArgs, {
      handoffId: (globalThis.crypto && "randomUUID" in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${screen.opportunity.id}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      eligibility: freshEligibility,
      underContract: freshUnderContract,
    }));
    if (!built.ok) {
      setDispositionWriteState({ kind: "failed", message: "The disposition package failed essential-data validation: " + built.reasons.map((r) => r.message).join(" "), writeMayHaveOccurred: false });
      return;
    }
    const candidate = built.value;

    // Duplicate refusal BEFORE ever writing.
    const duplicate = freshHandoffs.find((h) => {
      const currency = verifyHandoffMatchesUnderContract({ handoff: h, opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion, underContract: freshUnderContract });
      return currency.ok;
    });
    if (duplicate) {
      setDispositionWriteState({ kind: "already_recorded", record: duplicate });
      return;
    }

    const note = formatDispositionHandoffNote(candidate);
    try {
      await ghl.notes.create(contactId, note);
    } catch (e: any) {
      setDispositionWriteState({
        kind: "failed",
        message: `The write itself failed: ${e?.message ?? "unknown error"} -- do not assume a record was NOT created; verify directly in GHL before retrying.`,
        writeMayHaveOccurred: true,
      });
      return;
    }

    let freshNotes: { id: string; body: string; dateAdded: string }[];
    try {
      const freshResult = await ghl.notes.list(contactId);
      freshNotes = freshResult.notes ?? [];
    } catch (e: any) {
      setDispositionWriteState({
        kind: "failed",
        message: `The write may have succeeded, but the readback fetch itself failed: ${e?.message ?? "unknown error"} -- verify directly in GHL before retrying; this action does not retry automatically.`,
        writeMayHaveOccurred: true,
      });
      return;
    }
    setNotes(freshNotes);

    const parsedCandidates = freshNotes
      .map((n) => parseDispositionHandoffNote(n.body))
      .filter((r): r is DispositionHandoffRecord => r !== null);
    // Gate-review closure -- PR #85 preventive repair. The same fragile
    // whole-object JSON.stringify equality proven to false-fail on the
    // Under Contract readback (a live GHL round trip is not guaranteed
    // byte-identical to an in-memory format/parse round trip) applied
    // here too. Reuses the SAME narrow, canonical-identity check this
    // handler already trusts for the PRE-write duplicate refusal above
    // (`verifyHandoffMatchesUnderContract`) -- never provider/free-text
    // fields GHL could reformat, exactly the opportunity/agreement/
    // version/Under-Contract-verification identity that makes one
    // handoff durably distinct from any other for this opportunity.
    const matchingReadback = parsedCandidates.find((r) => verifyHandoffMatchesUnderContract({
      handoff: r, opportunityId: screen.opportunity.id, agreementAt: screen.economics.agreementAt, version: documentVersion, underContract: freshUnderContract,
    }).ok) ?? null;
    if (matchingReadback === null) {
      setDispositionWriteState({
        kind: "failed",
        message: "No note carrying this exact requested snapshot was found on fresh readback -- the write, the read, or the read's own parse failed. A note may or may not now exist in GHL -- verify directly before retrying; this action does not retry automatically.",
        writeMayHaveOccurred: true,
      });
      return;
    }

    setDispositionWriteState({ kind: "success", record: candidate });
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

  /**
   * INV-67 Phase 1. Builds a `SellerSigningModel` from the draft and writes
   * it through the SAME sanctioned Note write every other group uses.
   * Validates only what the Note carrier itself requires to round-trip
   * (a selected count; for Two Sellers, a non-blank Seller 2 legal name and
   * a valid, distinct email) -- capacity dispositions of "unresolved" are a
   * real, persistable recorded state (matching every other explicit
   * populated/not-applicable/unresolved fact group in this file), not a
   * save-time error; downstream draft-readiness gating on capacity is later,
   * separately authorized integration work (see `contract-seller-signing-model.ts`).
   */
  async function handleSaveSellerSigning() {
    if (screen.state !== "ready") return;
    if (drafts.sellerSigning.count === "unset") {
      setGroupError("parties", "Select One Seller or Two Sellers before saving.");
      return;
    }
    let model: SellerSigningModel;
    if (drafts.sellerSigning.count === 1) {
      model = { kind: "one_seller", seller1Capacity: drafts.sellerSigning.seller1Capacity };
    } else {
      const nameErr = checkSeller2LegalName(drafts.sellerSigning.seller2LegalName);
      if (nameErr) { setGroupError("parties", nameErr); return; }
      const emailErr = checkSeller2EmailFormat(drafts.sellerSigning.seller2Email);
      if (emailErr) { setGroupError("parties", emailErr); return; }
      if (seller1Resolution.ok) {
        const dupErr = checkSellerEmailsDistinct(seller1Resolution.email, drafts.sellerSigning.seller2Email);
        if (dupErr) { setGroupError("parties", dupErr); return; }
      }
      model = {
        kind: "two_sellers",
        seller1Capacity: drafts.sellerSigning.seller1Capacity,
        seller2: { legalName: drafts.sellerSigning.seller2LegalName.trim(), email: normalizeEmail(drafts.sellerSigning.seller2Email) },
        seller2Capacity: drafts.sellerSigning.seller2Capacity,
      };
    }
    const at = new Date().toISOString();
    const note = formatSellerSigningModelNote({ opportunityId: screen.opportunity.id, at, operator: null, model });
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
    // INV-67 Phase 2A: legal municipality is a required, explicit choice -- never
    // inferred from contact/postal city, address, ZIP, county, geocoding, or the
    // water-source municipality (¶7I). No default; "unset" always blocks save.
    let legalMunicipality: LegalMunicipalityFact;
    if (drafts.legalDesc.municipalityKind === "unset") {
      setGroupError("propertyLegalDescription", "Select Municipality or Unincorporated for the legal municipality (¶2A).");
      return;
    } else if (drafts.legalDesc.municipalityKind === "unincorporated") {
      legalMunicipality = { kind: "unincorporated" };
    } else {
      if (drafts.legalDesc.municipalityName.trim() === "") {
        setGroupError("propertyLegalDescription", "Enter the legal municipality name, or select Unincorporated.");
        return;
      }
      legalMunicipality = { kind: "municipality", name: drafts.legalDesc.municipalityName.trim() };
    }
    const at = new Date().toISOString();
    const note = formatPropertyLegalDescriptionFactsNote({ opportunityId: screen.opportunity.id, at, operator: null, lot, block, addition, county, exclusions, reservations, legalMunicipality });
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
        // INV-67 checkbox-marker / broker-model repair -- the five new
        // ValueOrNone fields each resolve independently to a real value or
        // an explicit "none"; `valueOrNoneToFact` returns null only when
        // "Has a value" is selected but left blank, which is the same
        // "invalid" case the six required strings above already guard.
        const address = valueOrNoneToFact(d.address);
        const teamName = valueOrNoneToFact(d.teamName);
        const supervisorName = valueOrNoneToFact(d.supervisorName);
        const supervisorPhone = valueOrNoneToFact(d.supervisorPhone);
        const supervisorLicenseNo = valueOrNoneToFact(d.supervisorLicenseNo);
        if (!address || !teamName || !supervisorName || !supervisorPhone || !supervisorLicenseNo) return "invalid";
        return {
          firmName: d.firmName, licenseNo: d.licenseNo, associateName: d.associateName, associateLicenseNo: d.associateLicenseNo,
          email: d.email, phone: d.phone, address, teamName, supervisorName, supervisorPhone, supervisorLicenseNo,
        };
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
              ? "Contract Ready. Review the populated PDF, then upload and send it manually in GHL."
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
                      {/* Number of Sellers -- INV-67 Phase 1                */}
                      {/* -------------------------------------------------- */}
                      {group.key === "parties" ? (
                        <div style={formBoxStyle} data-testid="contract-fact-group-seller-signing">
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Number of Sellers</div>
                          {latestSellerSigningModel ? (
                            <div data-testid="contract-fact-seller-signing-current" style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px" }}>
                              Currently recorded: {latestSellerSigningModel.model.kind === "one_seller" ? "One Seller" : "Two Sellers"}
                            </div>
                          ) : null}

                          <div style={rowStyle}>
                            <Field label="Number of Sellers">
                              <SelectField
                                testId="contract-fact-input-seller-count"
                                value={drafts.sellerSigning.count === "unset" ? "unset" : String(drafts.sellerSigning.count)}
                                onChange={(v) => updateDraft("sellerSigning", { count: v === "unset" ? "unset" : (Number(v) as 1 | 2) })}
                                options={[{ value: "unset", label: "Select…" }, { value: "1", label: "One Seller" }, { value: "2", label: "Two Sellers" }]}
                              />
                            </Field>
                          </div>

                          <div style={rowStyle}>
                            <Field label="Seller 1 (resolved from this Opportunity's primary Contact)" testId="contract-fact-seller1-resolved">
                              {seller1Resolution.ok ? (
                                <div style={{ fontSize: "12px", color: "#E2E8F0" }}>
                                  {seller1Resolution.name} &lt;{seller1Resolution.email}&gt; <span style={{ color: "#64748B" }}>({seller1Resolution.contactId})</span>
                                </div>
                              ) : (
                                <div style={{ fontSize: "12px", color: "#EF4444" }}>{seller1Resolution.reason}</div>
                              )}
                            </Field>
                          </div>
                          <div style={rowStyle}>
                            <Field label="Seller 1 signing capacity">
                              <SelectField
                                testId="contract-fact-input-seller1-capacity"
                                value={drafts.sellerSigning.seller1Capacity}
                                onChange={(v) => updateDraft("sellerSigning", { seller1Capacity: v })}
                                options={[
                                  { value: "unresolved", label: "Not yet confirmed" },
                                  { value: "individual_own_capacity", label: "Individual, own capacity" },
                                  { value: "unsupported_capacity", label: "Entity / trust / POA / other (not supported in V1)" },
                                ]}
                              />
                            </Field>
                          </div>

                          {drafts.sellerSigning.count === 2 ? (
                            <>
                              <div style={rowStyle}>
                                <Field label="Seller 2 legal name"><TextField testId="contract-fact-input-seller2-name" value={drafts.sellerSigning.seller2LegalName} onChange={(v) => updateDraft("sellerSigning", { seller2LegalName: v })} placeholder="Jane Doe" /></Field>
                                <Field label="Seller 2 email"><TextField testId="contract-fact-input-seller2-email" value={drafts.sellerSigning.seller2Email} onChange={(v) => updateDraft("sellerSigning", { seller2Email: v })} placeholder="jane@example.com" /></Field>
                              </div>
                              <div style={rowStyle}>
                                <Field label="Seller 2 signing capacity">
                                  <SelectField
                                    testId="contract-fact-input-seller2-capacity"
                                    value={drafts.sellerSigning.seller2Capacity}
                                    onChange={(v) => updateDraft("sellerSigning", { seller2Capacity: v })}
                                    options={[
                                      { value: "unresolved", label: "Not yet confirmed" },
                                      { value: "individual_own_capacity", label: "Individual, own capacity" },
                                      { value: "unsupported_capacity", label: "Entity / trust / POA / other (not supported in V1)" },
                                    ]}
                                  />
                                </Field>
                              </div>
                            </>
                          ) : null}

                          <div style={rowStyle}>
                            <Btn testId="contract-fact-save-seller-signing" onClick={handleSaveSellerSigning} busy={busyGroup === "parties"}>Save seller signing model</Btn>
                          </div>
                          <ErrorText testId="contract-fact-error-seller-signing">{groupErrors.parties ?? null}</ErrorText>
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
                          </div>
                          <div style={rowStyle}>
                            <Field label="Legal municipality (City of)">
                              <SelectField
                                testId="contract-fact-input-legal-municipality-kind"
                                value={drafts.legalDesc.municipalityKind}
                                onChange={(v) => updateDraft("legalDesc", { municipalityKind: v })}
                                options={[
                                  { value: "unset", label: "Select…" },
                                  { value: "municipality", label: "Municipality" },
                                  { value: "unincorporated", label: "Unincorporated" },
                                ]}
                              />
                            </Field>
                            {drafts.legalDesc.municipalityKind === "municipality" ? (
                              <TextField
                                testId="contract-fact-input-legal-municipality-name"
                                value={drafts.legalDesc.municipalityName}
                                onChange={(v) => updateDraft("legalDesc", { municipalityName: v })}
                                placeholder="Municipality name"
                              />
                            ) : null}
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
                                <>
                                  <div style={rowStyle}>
                                    {BROKER_FIELDS.map((f) => (
                                      <TextField key={f.key} testId={`contract-fact-input-seller-agent-${f.key}`} value={drafts.representation.sellerAgent[f.key]} onChange={(v) => updateDraft("representation", { sellerAgent: { ...drafts.representation.sellerAgent, [f.key]: v } })} placeholder={f.label} />
                                    ))}
                                  </div>
                                  <div style={rowStyle}>
                                    {BROKER_VALUE_OR_NONE_FIELDS.map((f) => (
                                      <Field key={f.key} label={f.label}><ValueOrNoneField testId={`contract-fact-input-seller-agent-${f.key}`} value={drafts.representation.sellerAgent[f.key]} onChange={(v) => updateDraft("representation", { sellerAgent: { ...drafts.representation.sellerAgent, [f.key]: v } })} /></Field>
                                    ))}
                                  </div>
                                </>
                              ) : null}
                              <div style={rowStyle}>
                                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94A3B8" }}>
                                  <input type="checkbox" data-testid="contract-fact-input-buyer-agent-present" checked={drafts.representation.buyerAgentPresent} onChange={(e) => updateDraft("representation", { buyerAgentPresent: e.target.checked })} />
                                  Buyer's agent present
                                </label>
                              </div>
                              {drafts.representation.buyerAgentPresent ? (
                                <>
                                  <div style={rowStyle}>
                                    {BROKER_FIELDS.map((f) => (
                                      <TextField key={f.key} testId={`contract-fact-input-buyer-agent-${f.key}`} value={drafts.representation.buyerAgent[f.key]} onChange={(v) => updateDraft("representation", { buyerAgent: { ...drafts.representation.buyerAgent, [f.key]: v } })} placeholder={f.label} />
                                    ))}
                                  </div>
                                  <div style={rowStyle}>
                                    {BROKER_VALUE_OR_NONE_FIELDS.map((f) => (
                                      <Field key={f.key} label={f.label}><ValueOrNoneField testId={`contract-fact-input-buyer-agent-${f.key}`} value={drafts.representation.buyerAgent[f.key]} onChange={(v) => updateDraft("representation", { buyerAgent: { ...drafts.representation.buyerAgent, [f.key]: v } })} /></Field>
                                    ))}
                                  </div>
                                </>
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
                No agreement becomes eligible for delivery merely because IAOS generated, populated, or displayed it. Only the authorized operator's own explicit action, for this exact document revision, can authorize it -- and any material change since revokes that authorization.
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
                <div data-testid="contract-authorization-save-status" style={{
                  ...groupCardStyle, flex: "1 1 220px",
                  borderColor: authorizationDisplayState === "saved" ? "rgba(34,197,94,0.35)" : authorizationDisplayState === "unsaved_changes" ? "rgba(245,158,11,0.35)" : "rgba(148,163,184,0.35)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: authorizationDisplayState === "saved" ? "#22C55E" : authorizationDisplayState === "unsaved_changes" ? "#F59E0B" : "#94A3B8" }}>
                    {authorizationDisplayState === "saved" ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                    {authorizationDisplayState === "saved" ? "Saved" : authorizationDisplayState === "unsaved_changes" ? "Unsaved changes" : "Not saved"}
                  </div>
                  <div style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
                    {authorizationDisplayState === "saved"
                      ? "Authorization saved for this version."
                      : authorizationDisplayState === "unsaved_changes"
                      ? "The contract changed. Generate the updated PDF and save authorization again."
                      : "Generate the PDF, review it, then save authorization."}
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
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Changes since authorization</div>
                {differencesFromLastAuthorized === null ? (
                  <div data-testid="contract-authorization-diff-none-recorded" style={{ fontSize: "11px", color: "#64748B" }}>No prior authorization exists to compare against.</div>
                ) : differencesFromLastAuthorized.length === 0 ? (
                  <div data-testid="contract-authorization-diff-unchanged" style={{ fontSize: "11px", color: "#22C55E" }}>No changes since authorization was saved.</div>
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

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Current generated artifact</div>
                {generatedArtifact ? (
                  <div data-testid="contract-generated-artifact-current" style={{ fontSize: "11px", color: "#22C55E" }}>
                    Generated -- SHA-256 {generatedArtifact.outputSha256.slice(0, 12)}…
                  </div>
                ) : (
                  <div data-testid="contract-generated-artifact-none" style={{ fontSize: "11px", color: "#94A3B8" }}>
                    Not yet generated for this revision -- generate before authorizing.
                  </div>
                )}
                <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <Btn testId="contract-generate-button" onClick={handleGenerateArtifact} busy={generateBusy} disabled={!authorizationEligibility.eligible}>
                    Generate current contract PDF
                  </Btn>
                  <Btn testId="contract-generated-artifact-download" onClick={handleDownloadArtifact} busy={false} disabled={!generatedArtifact}>
                    Download PDF
                  </Btn>
                </div>
                <ErrorText testId="contract-generate-error">{generateError}</ErrorText>
                <ErrorText testId="contract-download-error">{downloadError}</ErrorText>
              </div>

              <div>
                <Btn
                  testId="contract-authorization-authorize-button"
                  onClick={handleAuthorize}
                  busy={authorizeBusy}
                  disabled={!authorizationEligibility.eligible || !generatedArtifact}
                >
                  Save authorization
                </Btn>
                {!authorizationEligibility.eligible ? (
                  <div data-testid="contract-authorization-ineligible-reasons" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "8px" }}>
                    {authorizationEligibility.reasons.map((r) => <div key={r.code}>{r.message}</div>)}
                  </div>
                ) : authorizationEligibility.eligible && !generatedArtifact ? (
                  <div data-testid="contract-authorization-needs-generation" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "8px" }}>
                    Generate the current contract PDF above before authorizing it.
                  </div>
                ) : null}
                <ErrorText testId="contract-authorization-error">{authorizeError}</ErrorText>
              </div>
            </div>
          ) : null}

          {/* ================================================================ */}
          {/* Manual GHL upload/send notice and retained Contract Sent evidence */}
          {/* B9-08 / INV-63                                                    */}
          {/* ================================================================ */}
          {contractDocumentPreview && contractSentStatus ? (
            <div data-testid="contract-manual-send-notice"
              style={{ marginTop: "24px" }}>
              <h3>Manual GHL upload and send</h3>
              <p>Review the populated PDF, then upload it to GHL
                Documents &amp; Contracts and send it manually.</p>
              <p>IAOS V1 does not sync contract merge fields, request
                a GHL template draft, or send contracts automatically.
                This notice does not record a contract as sent.</p>
              {/*
                B9-13 authorization-hydration repair: the retired
                automated-path "Contract Sent (state-machine evaluation)"
                display (`contractSentStatus`) is deliberately removed from
                this operator-facing UI. That evaluator can structurally
                never report eligible in V1 (RETIRED_PATH_NEVER_MATCHES_ARTIFACT_FACTS,
                board9-contract-model.ts / contract-send-model.ts) -- it was
                showing a permanent, misleading "not eligible" reason list
                (including a stale "Brad has not explicitly authorized"
                reason) regardless of the REAL, current authorization state,
                which read as a direct contradiction against the real
                authorization-currency status above. The underlying pure
                computation (`contractSentEvidence`/`contractSentStatus`)
                is left in place, unused by any render -- retained for
                historical/audit reuse per contract-send-model.ts's own
                header, never claimed as a live operator signal again.
              */}
            </div>
          ) : null}

          {/* ================================================================ */}
          {/* Verify Execution & Under Contract -- B9-10 / INV-65               */}
          {/* Jess Gate repair round, 2026-09-13. READ-ONLY against GHL. Writes */}
          {/* nothing. Under Contract stays BLOCKED in V1 regardless of what    */}
          {/* this section observes -- see EXECUTED_TERMS_EVIDENCE_UNAVAILABLE. */}
          {/* ================================================================ */}
          {showVerifyExecutionControl(existingSend) ? (
            <div data-testid="contract-execution-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Verify Execution &amp; Under Contract
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                Verifies whether the three locked Under Contract facts actually hold: every signer completed (by provider recipient id, never GHL's generic role), the provider independently reports completion, and a manually-selected executed PDF is present and hashed. Fetching the live readback above is read-only against GHL, and selecting/hashing the PDF happens locally in this browser. But clicking Record signer mapping or Record attestation below DOES write a durable IAOS note in GHL -- only when that button is clicked, never automatically. Neither of those two steps uploads the PDF file itself; Preserve executed PDF, further below, is a separate action that DOES upload and durably store the actual PDF bytes.
              </div>

              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Provider document being verified</div>
                <div data-testid="contract-execution-document-id" style={{ fontSize: "12px", color: "#E2E8F0" }}>
                  Document id: <span style={{ fontFamily: "monospace" }}>{providerDocumentId ?? "unknown"}</span>
                </div>
                <div data-testid="contract-execution-document-reference" style={{ fontSize: "11px", color: "#64748B", marginTop: "2px" }}>
                  Reference: <span style={{ fontFamily: "monospace" }}>{existingSend.providerResponse?.documentReference ?? "unknown"}</span>
                </div>
              </div>

              {/* -------------------------------------------------------------- */}
              {/* Live provider readback (GET /proposals/document, read-only)    */}
              {/* -------------------------------------------------------------- */}
              <div style={{ marginBottom: "12px" }}>
                <Btn testId="contract-execution-fetch-readback-button" onClick={handleFetchProviderReadback} busy={providerReadback.kind === "loading"}>
                  Fetch live provider readback
                </Btn>
                {providerReadback.kind === "error" ? (
                  <ErrorText testId="contract-execution-readback-error">{providerReadback.message}</ErrorText>
                ) : null}
                {providerReadback.kind === "loaded" ? (
                  <div data-testid="contract-execution-readback-fetched-at" style={{ fontSize: "10px", color: "#64748B", marginTop: "6px" }}>
                    Fetched {new Date(providerReadback.fetchedAt).toLocaleString()} (HTTP {providerReadback.outcome.status}).
                  </div>
                ) : null}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 1. Required signers -- WHO must sign, from IAOS's own          */}
              {/* authoritative contract facts, never from send evidence         */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>1. Required signers</div>
                {requiredSignerSetResult && requiredSignerSetResult.ok ? (
                  <ul data-testid="contract-execution-required-signers" style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "12px", color: "#E2E8F0" }}>
                    {requiredSignerSetResult.signers.map((s) => <li key={s.role}>{s.role}: {s.displayName}</li>)}
                  </ul>
                ) : requiredSignerSetResult ? (
                  <ul data-testid="contract-execution-required-signers-blocked" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#F59E0B", lineHeight: 1.8 }}>
                    {requiredSignerSetResult.reasons.map((r) => <li key={r.code}>{r.message}</li>)}
                  </ul>
                ) : (
                  <div style={{ fontSize: "11px", color: "#64748B" }}>Loading contract facts...</div>
                )}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 2. Brad's recipient-mapping attestation -- manual, one-to-one, */}
              {/* never auto-paired by order, generic role, or guessed identity  */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>2. Signer-recipient mapping</div>
                {providerReadback.kind !== "loaded" ? (
                  <div data-testid="contract-execution-mapping-awaiting-readback" style={{ fontSize: "11px", color: "#64748B" }}>Fetch the live provider readback above before mapping signers to recipients.</div>
                ) : requiredSigners.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#F59E0B" }}>Resolve the required signer set above before mapping can begin.</div>
                ) : (
                  <>
                    <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px" }}>
                      Visually verify each mapping directly in GHL, then assign every required signer below to exactly one provider recipient id. Every recipient observed in this document must be assigned to exactly one signer -- nothing is auto-paired.
                    </div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                      {requiredSigners.map((s) => (
                        <li key={s.role} data-testid={`contract-execution-mapping-row-${s.role}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontSize: "11px", color: "#E2E8F0", minWidth: "160px" }}>{s.role}: {s.displayName}</div>
                          <select
                            data-testid={`contract-execution-mapping-select-${s.role}`}
                            value={mappingAssignments[s.role] ?? ""}
                            onChange={(e) => setMappingAssignments((prev) => ({ ...prev, [s.role]: e.target.value }))}
                            style={selectStyle}
                          >
                            <option value="">-- select provider recipient id --</option>
                            {availableProviderRecipientIds.map((id) => <option key={id} value={id}>{id}</option>)}
                          </select>
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: "10px" }}>
                      <Btn
                        testId="contract-execution-mapping-record-button"
                        onClick={handleRecordSignerMapping}
                        busy={busyGroup === "signer-mapping-attestation"}
                        disabled={!allSignersAssigned}
                      >
                        Record signer mapping
                      </Btn>
                    </div>
                    <ErrorText testId="contract-execution-mapping-build-error">{mappingBuildError}</ErrorText>
                    <ErrorText testId="contract-execution-mapping-save-error">{groupErrors["signer-mapping-attestation"] ?? null}</ErrorText>
                  </>
                )}
                {existingSignerMappingAttestation ? (
                  <div style={{ marginTop: "12px", fontSize: "11px", color: "#64748B" }}>
                    Last recorded mapping: {new Date(existingSignerMappingAttestation.attestedAt).toLocaleString()} --{" "}
                    {signerMappingCurrencyResult ? (
                      signerMappingCurrencyResult.ok ? (
                        <span data-testid="contract-execution-mapping-current" style={{ color: "#22C55E" }}>current for this exact evidence.</span>
                      ) : (
                        <span data-testid="contract-execution-mapping-stale" style={{ color: "#F59E0B" }}>not current for this exact evidence ({signerMappingCurrencyResult.reasons.map((r) => r.message).join(" ")})</span>
                      )
                    ) : (
                      <span>currency not yet checked.</span>
                    )}
                  </div>
                ) : null}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 3. Signer completion -- matched by provider recipient id, WITH */}
              {/* a valid signed timestamp required for every signer             */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>3. Signer completion</div>
                {providerReadback.kind !== "loaded" ? (
                  <div data-testid="contract-execution-signers-awaiting-readback" style={{ fontSize: "11px", color: "#64748B" }}>Fetch the live provider readback above to check signer completion.</div>
                ) : signerMappingCurrencyResult && !signerMappingCurrencyResult.ok ? (
                  <ul data-testid="contract-execution-signer-mapping-blocked" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#F59E0B", lineHeight: 1.8 }}>
                    {signerMappingCurrencyResult.reasons.map((r) => <li key={r.code}>{r.message}</li>)}
                  </ul>
                ) : providerSignerRowsResult && !providerSignerRowsResult.ok ? (
                  <div data-testid="contract-execution-signer-rows-unavailable" style={{ fontSize: "11px", color: "#F59E0B" }}>{providerSignerRowsResult.reason}</div>
                ) : signerVerificationResult ? (
                  signerVerificationResult.ok ? (
                    <ul data-testid="contract-execution-signers-complete" style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "12px", color: "#22C55E" }}>
                      {signerVerificationResult.matches.map((m) => (
                        <li key={m.role}>{m.role} ({m.displayName}) -- completed {m.providerCompletedAt ? new Date(m.providerCompletedAt).toLocaleString() : "(no timestamp reported)"}</li>
                      ))}
                    </ul>
                  ) : (
                    <ul data-testid="contract-execution-signers-incomplete" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                      {signerVerificationResult.reasons.map((r) => <li key={r.code} data-testid={`contract-execution-signer-reason-${r.code}`}>{r.message}</li>)}
                    </ul>
                  )
                ) : (
                  <div style={{ fontSize: "11px", color: "#64748B" }}>Waiting on readback evidence.</div>
                )}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 3. Buyer signer identity -- B9-13/INV-96, BLOCKING, case-       */}
              {/* insensitive, never a mapping mechanism (see this file's own    */}
              {/* verifyBuyerSignerIdentity header).                              */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>3. Buyer signer identity</div>
                {!buyerSignerIdentityResult ? (
                  <div data-testid="contract-execution-buyer-identity-awaiting-mapping" style={{ fontSize: "11px", color: "#64748B" }}>Map the buyer's provider recipient above to check this.</div>
                ) : buyerSignerIdentityResult.ok ? (
                  <div data-testid="contract-execution-buyer-identity-verified" style={{ fontSize: "12px", color: "#22C55E" }}>
                    The buyer's mapped provider recipient's reported name matches the authorized buyer signer name.
                  </div>
                ) : (
                  <ul data-testid="contract-execution-buyer-identity-mismatch" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                    {buyerSignerIdentityResult.reasons.map((r) => <li key={r.code} data-testid={`contract-execution-buyer-identity-reason-${r.code}`}>{r.message}</li>)}
                  </ul>
                )}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 2. Provider completion -- reuses INV-64's own chronology        */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>4. Provider completion</div>
                {providerReadback.kind !== "loaded" ? (
                  <div data-testid="contract-execution-provider-completion-awaiting-readback" style={{ fontSize: "11px", color: "#64748B" }}>Fetch the live provider readback above to check provider completion.</div>
                ) : providerCompletionResult ? (
                  providerCompletionResult.ok ? (
                    <div data-testid="contract-execution-provider-completion-true" style={{ fontSize: "12px", color: "#22C55E" }}>
                      Provider reports completed as of {new Date(providerCompletionResult.completedAt).toLocaleString()}.
                    </div>
                  ) : (
                    <ul data-testid="contract-execution-provider-completion-false" style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                      {providerCompletionResult.reasons.map((r) => <li key={r.code} data-testid={`contract-execution-provider-completion-reason-${r.code}`}>{r.message}</li>)}
                    </ul>
                  )
                ) : (
                  <div data-testid="contract-execution-provider-completion-unavailable" style={{ fontSize: "11px", color: "#F59E0B" }}>The live readback did not confirm this document's own record -- provider completion cannot be evaluated.</div>
                )}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 5. Executed artifact -- manual PDF selection, browser-local     */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>5. Executed artifact (manual selection)</div>
                <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px" }}>
                  GHL's Documents &amp; Contracts API has no download endpoint -- download the completed document for this exact provider document id directly from GHL, then select that PDF file below. It is read and hashed in this browser only; the file itself is never uploaded, saved, or sent anywhere.
                </div>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  data-testid="contract-execution-manual-file-input"
                  onChange={handleManualFileSelected}
                  disabled={manualFileBusy}
                  style={{ fontSize: "11px", color: "#94A3B8" }}
                />
                {manualFileBusy ? (
                  <div data-testid="contract-execution-manual-file-busy" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px" }}>Reading and hashing selected file...</div>
                ) : null}
                {manualArtifactVerificationResult ? (
                  manualArtifactVerificationResult.ok ? (
                    <div data-testid="contract-execution-artifact-verified" style={{ fontSize: "12px", color: "#22C55E", marginTop: "8px" }}>
                      Verified. SHA-256: <span style={{ fontFamily: "monospace", fontSize: "10px" }}>{manualArtifactVerificationResult.sha256}</span>
                      <div data-testid="contract-execution-artifact-page-count" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>
                        Page count: {manualArtifactVerificationResult.pageCount ?? "could not be determined"}
                      </div>
                    </div>
                  ) : (
                    <ul data-testid="contract-execution-artifact-not-verified" style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                      {manualArtifactVerificationResult.reasons.map((r) => <li key={r.code} data-testid={`contract-execution-artifact-reason-${r.code}`}>{r.message}</li>)}
                    </ul>
                  )
                ) : manualFileOutcome && manualFileOutcome.kind !== "selected" ? (
                  <div data-testid="contract-execution-artifact-rejected" style={{ fontSize: "11px", color: "#F59E0B", marginTop: "8px" }}>
                    {manualFileOutcome.kind === "no_file" ? "No file was selected."
                      : manualFileOutcome.kind === "invalid_file_type" ? "The selected file is not a real PDF (its content does not begin with the PDF signature)."
                      : manualFileOutcome.kind === "empty_file" ? "The selected file is empty."
                      : manualFileOutcome.message}
                  </div>
                ) : null}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 4. Executed material terms -- Brad's own factual visual         */}
              {/* attestation checklist (Product Owner ruling, 2026-09-13)        */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>6. Executed material terms</div>
                <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px" }}>
                  Compare each item below against what is printed on the executed PDF you downloaded from GHL, then answer every item. This is your own factual visual comparison only -- IAOS never reads the PDF's content, never interprets contract language, and never determines legal validity. Only unanimous MATCHES on every item can satisfy this requirement.
                </div>
                {checklistItems.length === 0 ? (
                  <div data-testid="contract-execution-terms-checklist-unavailable" style={{ fontSize: "11px", color: "#F59E0B" }}>
                    Fetch the live readback above (a deterministic expected signer is required) before the checklist can be built.
                  </div>
                ) : (
                  <>
                    <ul data-testid="contract-execution-terms-checklist" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                      {checklistItems.map((item) => {
                        const key = checklistItemKey(item);
                        const label = item.kind === "property_identity" ? "Property identity"
                          : item.kind === "purchase_price" ? "Purchase price"
                          : item.kind === "buyer_identity" ? "Buyer identity"
                          : item.kind === "signing_party" ? `Signing party: ${item.authoritativeLabel}`
                          : "Other material terms";
                        const current = checklistResponses[key];
                        return (
                          <li key={key} data-testid={`contract-execution-terms-item-${key}`} style={{ borderTop: "1px solid #1E293B", paddingTop: "8px" }}>
                            <div style={{ fontSize: "11px", color: "#E2E8F0", fontWeight: 700 }}>{label}</div>
                            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>Authoritative: {item.authoritativeLabel}</div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              {(["MATCHES", "DOES_NOT_MATCH", "CANNOT_VERIFY"] as const).map((value) => (
                                <button
                                  key={value}
                                  data-testid={`contract-execution-terms-item-${key}-${value}`}
                                  onClick={() => setChecklistResponses((prev) => ({ ...prev, [key]: value }))}
                                  style={{
                                    fontSize: "10px", padding: "4px 8px", borderRadius: "6px", cursor: "pointer",
                                    border: current === value ? "1px solid #005CE6" : "1px solid #1E293B",
                                    background: current === value ? "#005CE6" : "#0D1B3E",
                                    color: current === value ? "#F5F7FA" : "#94A3B8",
                                  }}
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div style={{ marginTop: "12px" }}>
                      <Btn
                        testId="contract-execution-terms-record-button"
                        onClick={handleRecordAttestation}
                        busy={busyGroup === "executed-terms-attestation"}
                        disabled={!allChecklistItemsAnswered || !manualArtifactVerificationResult || !manualArtifactVerificationResult.ok || (attestationCurrencyResult?.ok ?? false)}
                      >
                        Record attestation
                      </Btn>
                    </div>
                    <ErrorText testId="contract-execution-terms-build-error">{attestationBuildError}</ErrorText>
                    <ErrorText testId="contract-execution-terms-save-error">{groupErrors["executed-terms-attestation"] ?? null}</ErrorText>
                  </>
                )}

                {existingAttestation ? (
                  <div style={{ marginTop: "12px", fontSize: "11px", color: "#64748B" }}>
                    Last recorded attestation: {new Date(existingAttestation.attestedAt).toLocaleString()} --{" "}
                    {attestationCurrencyResult ? (
                      attestationCurrencyResult.ok ? (
                        <span data-testid="contract-execution-terms-attestation-current" style={{ color: "#22C55E" }}>current for this exact evidence.</span>
                      ) : (
                        <span data-testid="contract-execution-terms-attestation-stale" style={{ color: "#F59E0B" }}>not current for this exact evidence ({attestationCurrencyResult.reasons.map((r) => r.message).join(" ")})</span>
                      )
                    ) : (
                      <span>currency not yet checked (fetch readback and select the PDF above).</span>
                    )}
                  </div>
                ) : null}
              </div>

              {/* -------------------------------------------------------------- */}
              {/* 7. Final eligibility + Under Contract persistence -- reflects   */}
              {/* the REAL pipeline result; the write action below is reachable  */}
              {/* ONLY once every INV-65 gate above independently passes         */}
              {/* -------------------------------------------------------------- */}
              <div style={{ ...groupCardStyle, borderColor: fullVerificationResult?.ok ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>7. Under Contract</div>
                {fullVerificationResult ? (
                  fullVerificationResult.ok ? (
                    <div>
                      <div data-testid="contract-execution-under-contract-eligible" style={{ fontSize: "12px", color: "#22C55E", fontWeight: 700, marginBottom: "10px" }}>
                        Every INV-65 requirement passes for this exact evidence.
                      </div>
                      <Btn
                        testId="contract-execution-create-under-contract-button"
                        onClick={handleCreateUnderContract}
                        busy={underContractWriteState.kind === "busy"}
                        disabled={underContractWriteState.kind === "success" || underContractWriteState.kind === "already_recorded"}
                      >
                        Create Under Contract
                      </Btn>
                      {underContractWriteState.kind === "success" ? (
                        <div data-testid="contract-execution-under-contract-write-success" style={{ fontSize: "12px", color: "#22C55E", marginTop: "8px" }}>
                          Recorded and verified by fresh readback -- the written note round-trips exactly.
                        </div>
                      ) : underContractWriteState.kind === "already_recorded" ? (
                        <div data-testid="contract-execution-under-contract-already-recorded" style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px" }}>
                          Already recorded for this exact verified execution (recorded {new Date(underContractWriteState.record.iaosVerifiedAt).toLocaleString()}) -- refusing to append a duplicate.
                        </div>
                      ) : underContractWriteState.kind === "failed" ? (
                        <div data-testid="contract-execution-under-contract-write-failed" style={{ fontSize: "12px", color: "#EF4444", marginTop: "8px" }}>
                          {underContractWriteState.message}
                        </div>
                      ) : null}

                      {(underContractWriteState.kind === "success" || underContractWriteState.kind === "already_recorded") ? (
                        <div style={{ ...groupCardStyle, marginTop: "16px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Preserve executed PDF</div>
                          <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>
                            GHL exposes no supported retrieval path for the executed document's bytes. Download the completed executed PDF from GHL yourself, then upload it here -- IAOS stores the actual bytes durably and independently re-verifies them before Under Contract can proceed.
                          </div>
                          {preservedArtifactRecord ? (
                            <div data-testid="contract-execution-artifact-preserved" style={{ fontSize: "12px", color: "#22C55E" }}>
                              Preserved: {preservedArtifactRecord.originalFileName} -- {preservedArtifactRecord.byteCount.toLocaleString()} bytes, SHA-256 {preservedArtifactRecord.sha256.slice(0, 12)}…, {preservedArtifactRecord.pageCount ?? "unknown"} page(s).
                            </div>
                          ) : (
                            <>
                              <input
                                data-testid="contract-execution-artifact-file-input"
                                type="file"
                                accept="application/pdf"
                                disabled={preserveUploadState.kind === "uploading"}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePreserveExecutedArtifact(f); }}
                              />
                              {preserveUploadState.kind === "uploading" ? (
                                <div data-testid="contract-execution-artifact-uploading" style={{ fontSize: "11px", color: "#94A3B8", marginTop: "6px" }}>
                                  Uploading chunk {preserveUploadState.chunkIndex + 1} of {preserveUploadState.chunkCount}…
                                </div>
                              ) : preserveUploadState.kind === "success" ? (
                                <div data-testid="contract-execution-artifact-upload-success" style={{ fontSize: "12px", color: "#22C55E", marginTop: "6px" }}>
                                  {preserveUploadState.alreadyPreserved ? "Already preserved -- identical bytes, no duplicate written." : "Preserved and independently re-verified by fresh readback."}
                                </div>
                              ) : preserveUploadState.kind === "failed" ? (
                                <div data-testid="contract-execution-artifact-upload-failed" style={{ fontSize: "12px", color: "#EF4444", marginTop: "6px" }}>
                                  {preserveUploadState.message}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}

                      {preservedArtifactRecord ? (
                        <div style={{ ...groupCardStyle, marginTop: "16px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Transition to Under Contract</div>
                          <Btn
                            testId="contract-execution-transition-under-contract-button"
                            onClick={handleTransitionUnderContractStage}
                            busy={stageTransitionState.kind === "busy"}
                            disabled={stageTransitionState.kind === "success"}
                          >
                            Transition GHL stage to Under Contract
                          </Btn>
                          {stageTransitionState.kind === "success" ? (
                            <div data-testid="contract-execution-stage-transition-success" style={{ fontSize: "12px", color: "#22C55E", marginTop: "8px" }}>
                              {stageTransitionState.alreadyInStage ? "Already in the Under Contract stage." : "Transitioned and confirmed by fresh readback -- pipeline and stage both verified exact."}
                            </div>
                          ) : stageTransitionState.kind === "failed" ? (
                            <div data-testid="contract-execution-stage-transition-failed" style={{ fontSize: "12px", color: "#EF4444", marginTop: "8px" }}>
                              {stageTransitionState.message}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div data-testid="contract-execution-full-result" style={{ fontSize: "11px", color: "#94A3B8" }}>
                      <div style={{ color: "#EF4444", fontWeight: 700, marginBottom: "6px" }}>BLOCKED -- stage: <span style={{ fontFamily: "monospace" }}>{fullVerificationResult.failure.stage}</span></div>
                      <ul style={{ margin: 0, padding: "0 0 0 18px", lineHeight: 1.8 }}>
                        {fullVerificationResult.failure.reasons.map((r) => <li key={r.code} data-testid={`contract-execution-full-reason-${r.code}`}>{r.message}</li>)}
                      </ul>
                    </div>
                  )
                ) : (
                  <div style={{ fontSize: "11px", color: "#64748B" }}>Fetch the live readback, map signers to recipients, and select the executed PDF above to see exactly which stage this evidence reaches.</div>
                )}
              </div>
            </div>
          ) : showRecordGhlSendControl(screen, bradAuthorizationRecord, existingSend) ? (
            <div data-testid="contract-manual-send-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Record GHL Send
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                After you manually upload the authorized PDF to GHL Documents &amp; Contracts and send it, enter exactly what GHL shows you below. IAOS validates this against the currently-authorized PDF's revision and hash before recording it -- nothing is sent to GHL from here.
              </div>
              <div style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "11px", color: "#94A3B8", marginBottom: "10px" }}>
                  Provider document id
                  <input
                    data-testid="contract-manual-send-document-id"
                    value={manualSendForm.providerDocumentId}
                    onChange={(e) => setManualSendForm((prev) => ({ ...prev, providerDocumentId: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: "11px", color: "#94A3B8", marginBottom: "10px" }}>
                  Provider document reference (optional)
                  <input
                    data-testid="contract-manual-send-document-reference"
                    value={manualSendForm.providerDocumentReference}
                    onChange={(e) => setManualSendForm((prev) => ({ ...prev, providerDocumentReference: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: "11px", color: "#94A3B8", marginBottom: "10px" }}>
                  Provider document revision (optional)
                  <input
                    data-testid="contract-manual-send-document-revision"
                    value={manualSendForm.providerDocumentRevision}
                    onChange={(e) => setManualSendForm((prev) => ({ ...prev, providerDocumentRevision: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: "11px", color: "#94A3B8", marginBottom: "10px" }}>
                  When you actually sent it in GHL
                  <div data-testid="contract-manual-send-request-at-helper" style={{ fontSize: "10px", color: "#64748B", marginTop: "2px" }}>
                    Enter this in your OWN local date and time, exactly as GHL displayed it to you -- IAOS converts and stores it as UTC.
                  </div>
                  <input
                    type="datetime-local"
                    data-testid="contract-manual-send-request-at"
                    value={manualSendForm.requestAt}
                    onChange={(e) => setManualSendForm((prev) => ({ ...prev, requestAt: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
                <label style={{ display: "block", fontSize: "11px", color: "#94A3B8" }}>
                  GHL's own displayed expiration for this document (optional -- leave blank if GHL shows none)
                  <input
                    type="datetime-local"
                    data-testid="contract-manual-send-expiration-at"
                    value={manualSendForm.expirationAt}
                    onChange={(e) => setManualSendForm((prev) => ({ ...prev, expirationAt: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: "4px" }}
                  />
                </label>
              </div>
              <Btn testId="contract-manual-send-record-button" onClick={handleRecordManualSend} busy={busyGroup === "manual-contract-send"}>
                Record GHL Send
              </Btn>
              <ErrorText testId="contract-manual-send-build-error">{manualSendBuildError}</ErrorText>
              <ErrorText testId="contract-manual-send-save-error">{groupErrors["manual-contract-send"] ?? null}</ErrorText>
            </div>
          ) : null}

          {/* ================================================================ */}
          {/* Start Disposition -- B9-11 / INV-66, gate-review §5 ruling        */}
          {/* (2026-09-21). Shown ONLY once ALL THREE of the durable Board #9   */}
          {/* completion facts independently hold: a genuine, canonical-        */}
          {/* carrier-parsed Under Contract record; a genuine preserved-        */}
          {/* artifact record for this exact agreement/version; AND a fresh,    */}
          {/* live GHL read confirming the opportunity is actually in the       */}
          {/* exact Seller Leads Pipeline / Under Contract stage. Never gated   */}
          {/* on `stageTransitionState` -- that is browser-local and resets on  */}
          {/* reload, proving nothing by itself; `underContractStageConfirmed`  */}
          {/* is re-derived from a fresh GHL read every time this page loads.   */}
          {/* Writes nothing until Brad's own explicit click.                   */}
          {/* ================================================================ */}
          {showStartDispositionControl(currentUnderContractRecord, preservedArtifactRecord, underContractStageConfirmed) ? (
            <div data-testid="disposition-handoff-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Start Disposition -- hand off to Board #10
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                Assembles the complete authoritative deal package Board #10 needs, from already-canonical Board #9 sources only -- nothing recalculated, nothing fabricated. Writes nothing until you explicitly click Start Disposition below.
              </div>

              {dispositionEligibility && !dispositionEligibility.eligible ? (
                <div data-testid="disposition-handoff-blocked" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(239,68,68,0.35)" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#EF4444", marginBottom: "6px" }}>Blocking conflicts</div>
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                    {dispositionEligibility.reasons.map((r) => <li key={r.code} data-testid={`disposition-handoff-blocked-reason-${r.code}`}>{r.message}</li>)}
                  </ul>
                </div>
              ) : null}

              {dispositionPackagePreview && !dispositionPackagePreview.ok ? (
                <div data-testid="disposition-handoff-essential-missing" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(239,68,68,0.35)" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#EF4444", marginBottom: "6px" }}>Missing essential data -- blocks handoff creation</div>
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                    {dispositionPackagePreview.reasons.map((r) => <li key={r.code} data-testid={`disposition-handoff-essential-reason-${r.code}`}>{r.message}</li>)}
                  </ul>
                </div>
              ) : null}

              {dispositionPackagePreview && dispositionPackagePreview.ok ? (() => {
                const pkg = dispositionPackagePreview.value;
                const optionalItems: { label: string; fd: { kind: string } }[] = [
                  { label: "Closing date", fd: pkg.closingDate },
                  { label: "Possession details", fd: pkg.possessionDetails },
                  { label: "Access/showing information", fd: pkg.accessShowingInformation },
                  { label: "Seller notice address", fd: pkg.sellerContact.noticeAddress },
                  { label: "Seller notice phone", fd: pkg.sellerContact.noticePhone },
                  { label: "Seller notice email", fd: pkg.sellerContact.noticeEmail },
                ];
                const missingOptional = optionalItems.filter((i) => i.fd.kind !== "populated");
                return (
                  <>
                    <div data-testid="disposition-handoff-preview-authoritative" style={{ ...groupCardStyle, marginBottom: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>Authoritative data (reused verbatim, never recalculated)</div>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "12px", color: "#E2E8F0", lineHeight: 1.9 }}>
                        <li>Property: {pkg.propertyAddress.kind === "populated" ? pkg.propertyAddress.value : "unconfirmed"}</li>
                        <li>Seller contract price: {money(pkg.sellerContractPrice)}</li>
                        <li>Approved ARV: {money(pkg.approvedArv.amount)} {pkg.approvedArv.approvalEvidenceState ? `(${pkg.approvedArv.approvalEvidenceState}, ${pkg.approvedArv.approvalDecision})` : "(no matching approval-ledger entry)"}</li>
                        <li>Approved repairs: {money(pkg.approvedRepairs)}</li>
                        <li>Required signers: {pkg.requiredSigners.map((s) => `${s.role} (${s.displayName})`).join(", ")}</li>
                        <li>Provider document: {pkg.underContract.providerDocumentId} (revision {pkg.underContract.providerDocumentRevision ?? "unavailable"})</li>
                        <li>Artifact SHA-256: <span style={{ fontFamily: "monospace", fontSize: "10px" }}>{pkg.underContract.artifactSha256}</span></li>
                        <li>Execution verified at: {new Date(pkg.underContract.verifiedAt).toLocaleString()}</li>
                      </ul>
                    </div>

                    {missingOptional.length > 0 ? (
                      <div data-testid="disposition-handoff-preview-missing-optional" style={{ ...groupCardStyle, marginBottom: "12px", borderColor: "rgba(245,158,11,0.35)" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#F59E0B", marginBottom: "6px" }}>Missing optional data (disclosed honestly, never fabricated)</div>
                        <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "11px", color: "#94A3B8", lineHeight: 1.8 }}>
                          {missingOptional.map((i) => <li key={i.label}>{i.label}: not yet recorded.</li>)}
                          <li>Photos/documents: {pkg.documentReferencesNote}</li>
                        </ul>
                      </div>
                    ) : null}

                    <div style={{ marginBottom: "12px" }}>
                      <Btn
                        testId="disposition-handoff-start-button"
                        onClick={handleStartDisposition}
                        busy={dispositionWriteState.kind === "busy"}
                        disabled={
                          dispositionWriteState.kind === "success" || dispositionWriteState.kind === "already_recorded" ||
                          !dispositionEligibility || !dispositionEligibility.eligible
                        }
                      >
                        Start Disposition
                      </Btn>
                      {dispositionWriteState.kind === "success" ? (
                        <div data-testid="disposition-handoff-write-success" style={{ fontSize: "12px", color: "#22C55E", marginTop: "8px" }}>
                          Recorded and verified by fresh readback -- the written note round-trips exactly. Board #10 may now consume handoff id <span style={{ fontFamily: "monospace" }}>{dispositionWriteState.record.handoffId}</span>.
                        </div>
                      ) : dispositionWriteState.kind === "already_recorded" ? (
                        <div data-testid="disposition-handoff-already-recorded" style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px" }}>
                          Already recorded for this exact verified execution (handoff id <span style={{ fontFamily: "monospace" }}>{dispositionWriteState.record.handoffId}</span>, created {new Date(dispositionWriteState.record.createdAt).toLocaleString()}) -- refusing to append a duplicate.
                        </div>
                      ) : dispositionWriteState.kind === "failed" ? (
                        <div data-testid="disposition-handoff-write-failed" style={{ fontSize: "12px", color: "#EF4444", marginTop: "8px" }}>
                          {dispositionWriteState.message}
                        </div>
                      ) : null}
                    </div>
                  </>
                );
              })() : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
