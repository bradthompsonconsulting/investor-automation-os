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
  buildContractProjectionPlan, reusedCurrentOfferLines, type ContractProjectionFieldKey,
} from "../lib/contract-ghl-projection-model";
import {
  evaluateContractDraftRequestTransition, normalizeContractDraftRequestState,
  buildContractDraftRequestAttemptRecord, buildContractDraftRequestResolutionRecord,
  classifyContractDraftRequestOutcome,
} from "../lib/contract-draft-request-model";
import { formatContractProjectionSyncNote, latestContractProjectionSyncForOpportunity } from "../lib/contract-projection-sync-carriers";
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
import { buildProviderObservationRecordFromReadback, type LifecycleRecord } from "../lib/contract-lifecycle-model";
import {
  classifySelectedFileBytes, verifyRequiredSigners, verifyProviderCompletion,
  verifyManualArtifactSelection, buildVerifiedUnderContractRecord,
  extractProviderSignerRowsFromListDocumentsBody,
  isDuplicateUnderContractRecord, verifyReadbackMatchesWritten,
  type ManualArtifactSelectionOutcome, type UnderContractRecordEntry,
} from "../lib/contract-execution-model";
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
import {
  formatDispositionHandoffNote, parseDispositionHandoffNote, allDispositionHandoffsForOpportunity,
} from "../lib/contract-disposition-handoff-carriers";
import { getRuntimeConfig, CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED } from "../../shared/ghl-config";
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
  normalizeEmail, evaluateSellerSigningPreWriteReadiness, buildSellerSigningAuditEvidence, sellerCountTransportValue,
  type SellerSigningModel, type SigningCapacityDisposition, type Seller1Resolution, type SellerSigningModelDisposition,
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

  /** INV-67 Phase 1 Jess re-gate correction -- the canonical seller-signing fact, as a `SellerSigningModelDisposition` (the exact shape `evaluateSellerSigningPreWriteReadiness` / `buildSellerSigningAuditEvidence` take). No Note ever recorded reads as `unresolved`, never a silent default. */
  const sellerSigningDisposition: SellerSigningModelDisposition = useMemo(
    () => (latestSellerSigningModel ? { kind: "populated", value: latestSellerSigningModel.model } : { kind: "unresolved" }),
    [latestSellerSigningModel],
  );

  /** The existing `parties.sellerSigners` printed-identity array, narrowed to the one field the seller-readiness gate compares against -- never a second, independently-read source. */
  const printedSellerSigners = useMemo(() => {
    const d = sellerContractFactsReport?.parties.sellerSigners;
    return d && d.kind === "populated" ? d.value.map((s) => ({ displayName: s.displayName })) : [];
  }, [sellerContractFactsReport]);

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

  /**
   * INV-67 / B9-12 contract-population repair -- Contract Workspace
   * synchronization control. Projects `contractDocumentPreview`'s
   * already-resolved facts into the 48 narrowly-scoped GHL Opportunity
   * fields, then -- ONLY once every write/readback lands and the accepted
   * price cross-checks -- sets the one-shot `Contract Draft Request`
   * dropdown to "Requested". This control NEVER creates or sends a
   * document itself: it writes Opportunity custom fields and audit Notes
   * only, exactly the write classes this repair authorizes. The future GHL
   * workflow (not built here) is what actually creates the draft and
   * resets the field back to "Idle".
   *
   * JESS GATE CORRECTION (this session) -- AUDIT ORDERING. GHL may create
   * the draft the instant "Requested" lands, so a durable, DURABLE-BEFORE-
   * THE-WRITE "in_progress" note is required -- see
   * `contract-draft-request-model.ts`'s own header for the full ruling.
   * This handler now performs the SAME two-phase attempt/resolution
   * sequence `handleSend` above already establishes for Contract Sent:
   * build the attempt record -> write ITS note -> only on that note's
   * confirmed success, attempt the actual "Requested" PUT -> build and
   * write the resolution record for the SAME attemptId. Neither evidence
   * write is ever swallowed; a resolution-note failure (or a readback
   * mismatch) after a successful PUT is surfaced as "indeterminate," never
   * silently treated as success, failure, or safe-to-retry -- the next
   * invocation's own fresh read is what actually prevents a duplicate
   * request, not a client-side retry loop (there is none here).
   */
  const [syncBusy, setSyncBusy] = useState(false);
  type DraftRequestOutcome = {
    attempted: boolean;
    /** null = never evaluated (the projection write itself did not fully land). */
    transitionAllowed: boolean | null;
    refusalReason: string | null;
    attemptNoteOk: boolean | null;
    /** The raw PUT+readback outcome. null until the PUT was actually attempted. */
    rawStatus: "accepted" | "failed" | "indeterminate" | null;
    resolutionNoteOk: boolean | null;
    /**
     * "accepted"/"failed" straight from `rawStatus`, EXCEPT a successful PUT
     * whose resolution note failed to write is escalated to "indeterminate"
     * here -- durable evidence of the outcome does not exist, which is
     * exactly the condition the corrected ruling's item 6 names.
     */
    reportedStatus: "accepted" | "failed" | "indeterminate" | null;
    sentValue: string | null;
    observedValue: string | null;
  };
  const [syncResult, setSyncResult] = useState<
    | null
    | { kind: "blocked"; blockingReasons: string[] }
    | {
        kind: "done";
        ok: boolean;
        entries: { key: ContractProjectionFieldKey; landed: boolean }[];
        currentOfferCrossCheckOk: boolean;
        draftRequest: DraftRequestOutcome;
        /** INV-67 checkbox-marker / broker-model repair -- non-blocking issues (e.g. POA membership/addendum disagreement). Never causes `ok:false`. */
        warnings: string[];
      }
    | { kind: "error"; message: string }
  >(null);

  const latestProjectionSync = useMemo(() => {
    if (screen.state !== "ready" || !notes) return null;
    return latestContractProjectionSyncForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  async function handleSyncContractProjectionFields() {
    // INV-67 checkbox-marker / broker-model repair -- buildContractProjectionPlan
    // now also derives markers/broker text from the raw report, not just the
    // rendered preview, so both must be available before attempting a sync.
    if (screen.state !== "ready" || !contractDocumentPreview || !sellerContractFactsReport) return;
    setSyncResult(null);
    setSyncBusy(true);
    try {
      const opportunityId = screen.opportunity.id;

      // INV-67 Phase 1 Jess re-gate correction -- the seller-signing gate
      // runs BEFORE buildContractProjectionPlan is even called, and its
      // result is FOLDED into that plan's own blockingReasons/ok:false
      // path below -- there is no separate seller-only short-circuit here,
      // so the SAME "if (!plan.ok) return" already in place structurally
      // covers both. Nothing here performs network I/O; every input is
      // already-resolved live data this component already holds.
      const sellerCountFieldId = getRuntimeConfig().contractSellerCountField;
      const sellerReadiness = evaluateSellerSigningPreWriteReadiness({
        disposition: sellerSigningDisposition,
        seller1: seller1Resolution,
        printedSellerSigners,
        sellerCountFieldId,
        sellerCountFieldSentinel: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,
        sellerCountWriteReadbackVerified: true, // see evaluateSellerSigningPreWriteReadiness's own doc comment -- gate 15 is enforced post-write, below.
      });

      const plan = buildContractProjectionPlan(opportunityId, contractDocumentPreview, sellerContractFactsReport, sellerReadiness);
      if (!plan.ok) {
        setSyncResult({ kind: "blocked", blockingReasons: plan.blockingReasons });
        return;
      }

      // plan.ok === true guarantees sellerReadiness.ok === true, which
      // guarantees sellerSigningDisposition.kind === "populated" (gate 1)
      // and sellerCountFieldId is provisioned (gate 14) -- safe to build
      // and include the Seller Count write in the SAME verified write/
      // readback call the 112 TREC fields already go through.
      const sellerCountText =
        sellerSigningDisposition.kind === "populated" ? sellerCountTransportValue(sellerSigningDisposition.value) : null;
      const writeResult = await ghl.opportunities.syncContractProjectionFields(
        opportunityId,
        plan.entries,
        sellerCountText !== null ? { fieldId: sellerCountFieldId, text: sellerCountText } : null,
      );

      // Extends the EXISTING opportunity-scoped, two-phase evidence --
      // never a second, global, or independently-scoped audit system. See
      // buildSellerSigningAuditEvidence's own doc comment for why this is
      // computed ONCE here and carried forward unchanged onto both notes.
      const sellerSigningEvidence = buildSellerSigningAuditEvidence({
        disposition: sellerSigningDisposition,
        seller1: seller1Resolution,
        printedSellerSigners,
        sellerCountFieldId,
        sellerCountFieldSentinel: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,
        sellerCountWriteReadbackOk: writeResult.sellerCount ? writeResult.sellerCount.landed : null,
      });

      const reused = reusedCurrentOfferLines(contractDocumentPreview);
      const currentOfferCrossCheckOk =
        reused.every((r) => r.text !== null) && writeResult.currentOfferObserved === screen.agreedPrice;

      let draftRequest: DraftRequestOutcome = {
        attempted: false, transitionAllowed: null, refusalReason: null, attemptNoteOk: null,
        rawStatus: null, resolutionNoteOk: null, reportedStatus: null, sentValue: null, observedValue: null,
      };

      if (writeResult.ok) {
        // Fresh read, immediately before deciding -- never a cached value (see
        // contract-draft-request-model.ts's own duplicate/stale-request note).
        const currentRaw = await ghl.opportunities.readContractDraftRequest(opportunityId);
        const observedStateBeforeWrite = normalizeContractDraftRequestState(currentRaw);
        const decision = evaluateContractDraftRequestTransition({
          currentRaw,
          projection: { entryCount: writeResult.entries.length, allEntriesLanded: writeResult.ok },
          currentOfferCrossCheckOk,
        });

        if (!decision.allowed) {
          draftRequest = { ...draftRequest, attempted: true, transitionAllowed: false, refusalReason: decision.reason };
        } else {
          // Fresh attemptId, generated here, every invocation -- a repeated
          // UI action can never reuse an earlier attempt's id.
          const attemptAt = new Date().toISOString();
          const attemptRecord = buildContractDraftRequestAttemptRecord({
            opportunityId,
            operator: "brad",
            attemptAt,
            version: documentVersion!,
            entriesAttempted: writeResult.entries.length,
            entriesLanded: writeResult.entries.filter((e) => e.landed).length,
            failedKeys: writeResult.entries.filter((e) => !e.landed).map((e) => e.key),
            currentOfferCrossCheckOk,
            observedStateBeforeWrite,
            sellerSigningEvidence,
          });
          const attemptNote = formatContractProjectionSyncNote(attemptRecord);

          // Stage 1: the "in_progress" note -- MUST land before "Requested" is ever attempted.
          let attemptNoteOk = false;
          try {
            await ghl.notes.create(contactId, attemptNote);
            setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: attemptNote, dateAdded: attemptRecord.at }]);
            attemptNoteOk = true;
          } catch (e: any) {
            draftRequest = {
              ...draftRequest, attempted: true, transitionAllowed: true, attemptNoteOk: false,
              refusalReason:
                `Couldn't durably record the draft-request attempt (${e?.message ?? "unknown error"}) -- ` +
                'refusing to write "Requested" without evidence of intent. The projection fields above are still confirmed landed; nothing was requested.',
            };
          }

          if (attemptNoteOk) {
            // Stage 2: the actual one-shot write -- redeems the attempt just
            // durably recorded above. setContractDraftRequest NEVER throws
            // (Jess Gate transport-outcome correction) -- it always returns
            // a discriminated ContractDraftRequestWriteOutcome, classified
            // below by the SAME pure function this module's own tests
            // exercise against all six variants -- no ad hoc try/catch
            // classification here that could re-collapse a transport
            // exception or a readback failure into "failed".
            const outcome = await ghl.opportunities.setContractDraftRequest(opportunityId, "Requested");
            const classification = classifyContractDraftRequestOutcome(outcome);
            const rawStatus = classification.status;

            const resolvedAt = new Date().toISOString();
            const resolutionRecord = buildContractDraftRequestResolutionRecord({
              attempt: attemptRecord,
              resolvedAt,
              status: rawStatus,
              sentValue: classification.sentValue,
              observedValue: classification.observedValue,
              providerStatus: classification.providerStatus,
              failureReason: classification.failureReason,
            });
            const resolutionNote = formatContractProjectionSyncNote(resolutionRecord);

            // Stage 3: the resolution note -- for the SAME attemptId. Never swallowed.
            let resolutionNoteOk = false;
            try {
              await ghl.notes.create(contactId, resolutionNote);
              setNotes((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, body: resolutionNote, dateAdded: resolutionRecord.at }]);
              resolutionNoteOk = true;
            } catch {
              resolutionNoteOk = false;
            }

            // A successful write whose own evidence failed to land is
            // reported exactly like an unconfirmed readback: indeterminate,
            // never silently "accepted" -- item 6 of the corrected ruling.
            const reportedStatus: "accepted" | "failed" | "indeterminate" =
              rawStatus === "accepted" && !resolutionNoteOk ? "indeterminate" : rawStatus;

            draftRequest = {
              attempted: true,
              transitionAllowed: true,
              // The exact, kind-specific explanation classifyContractDraftRequestOutcome
              // built -- never a generic fallback. null only for "accepted"
              // (and downgraded to the resolution-note-missing message below
              // when reportedStatus escalates a clean "accepted" to "indeterminate").
              refusalReason:
                reportedStatus === "accepted"
                  ? null
                  : resolutionRecord.failureReason ??
                    'The write succeeded and read back correctly, but the resolution evidence note itself failed to record -- a draft may have been triggered without confirmed durable evidence.',
              attemptNoteOk: true,
              rawStatus,
              resolutionNoteOk,
              reportedStatus,
              sentValue: resolutionRecord.sentValue,
              observedValue: resolutionRecord.observedValue,
            };
          }
        }
      }

      setSyncResult({
        kind: "done",
        ok: writeResult.ok,
        entries: writeResult.entries.map((e) => ({ key: e.key, landed: e.landed })),
        currentOfferCrossCheckOk,
        draftRequest,
        warnings: plan.warnings,
      });
    } catch (e: any) {
      setSyncResult({ kind: "error", message: e?.message ?? "Couldn't synchronize the contract projection fields. Try again." });
    } finally {
      setSyncBusy(false);
    }
  }

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
      setManualFileOutcome({ kind: "selected", sha256, fileName: bytesOutcome.fileName, mimeType: bytesOutcome.mimeType });
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
      !manualFileOutcome || !providerDocumentId || requiredSigners.length === 0
    ) return null;
    return buildVerifiedUnderContractRecord({
      opportunityId: screen.opportunity.id,
      agreementAt: screen.economics.agreementAt,
      version: existingSend.version,
      acceptedSend: existingSend,
      requiredSigners,
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
  }, [screen, existingSend, providerSignerRowsResult, lifecycleObservationRecord, manualFileOutcome, providerDocumentId, requiredSigners, existingSignerMappingAttestation, existingAttestation]);

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
    const matchingReadback = parsedCandidates.find((r) => JSON.stringify(r) === JSON.stringify(candidate)) ?? null;
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

  const dispositionLifecycleHistory = useMemo(() => {
    if (screen.state !== "ready" || !notes) return [];
    return allContractLifecycleRecordsForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

  const existingDispositionHandoffs = useMemo(() => {
    if (screen.state !== "ready" || !notes) return [];
    return allDispositionHandoffsForOpportunity(notes, screen.opportunity.id);
  }, [screen, notes]);

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
    const matchingReadback = parsedCandidates.find((r) => JSON.stringify(r) === JSON.stringify(candidate)) ?? null;
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

              {/* INV-67 / B9-12 contract-population repair -- Contract Workspace synchronization control. */}
              <div data-testid="contract-projection-sync-section" style={{ ...groupCardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", marginBottom: "6px" }}>
                  Sync contract fields to GHL (IAOS Test only)
                </div>
                <div style={{ fontSize: "10px", color: "#64748B", marginBottom: "8px" }}>
                  Writes the populated preview above into the 48 narrowly-scoped GHL Opportunity fields, verifies every write by readback, then -- only if every field lands and the accepted price cross-checks -- sets Contract Draft Request to "Requested" for the future GHL workflow to pick up. Never creates or sends a document itself.
                </div>

                {latestProjectionSync ? (
                  <div data-testid="contract-projection-sync-last-evidence" style={{ fontSize: "10px", color: "#64748B", marginBottom: "8px" }}>
                    Last attempt: {new Date(latestProjectionSync.attemptId).toLocaleString()} ({latestProjectionSync.entriesLanded}/{latestProjectionSync.entriesAttempted} projection fields landed on that attempt) -- draft request {latestProjectionSync.status === "in_progress" ? "still in progress (no terminal resolution recorded)" : latestProjectionSync.status === "accepted" ? "Requested (confirmed)" : latestProjectionSync.status === "indeterminate" ? "INDETERMINATE -- a draft may have been triggered without confirmed evidence; check GHL directly" : `not requested -- ${latestProjectionSync.failureReason ?? "failed"}`}.
                  </div>
                ) : (
                  <div data-testid="contract-projection-sync-no-evidence" style={{ fontSize: "10px", color: "#64748B", marginBottom: "8px" }}>No sync has been recorded for this opportunity yet.</div>
                )}

                <Btn
                  testId="contract-projection-sync-button"
                  onClick={handleSyncContractProjectionFields}
                  busy={syncBusy}
                  disabled={!contractDocumentPreview.previewComplete}
                >
                  Sync contract fields to GHL
                </Btn>

                {syncResult?.kind === "blocked" ? (
                  <ul data-testid="contract-projection-sync-blocked" style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: "11px", color: "#F59E0B", lineHeight: 1.8 }}>
                    {syncResult.blockingReasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                ) : null}

                {syncResult?.kind === "done" ? (
                  <div data-testid="contract-projection-sync-result" style={{ marginTop: "8px", fontSize: "11px" }}>
                    <div style={{ color: syncResult.ok ? "#22C55E" : "#F59E0B", fontWeight: 700 }}>
                      {syncResult.ok ? "All 48 fields landed." : `${syncResult.entries.filter((e) => e.landed).length}/${syncResult.entries.length} fields landed.`}
                    </div>
                    {!syncResult.ok ? (
                      <ul data-testid="contract-projection-sync-failed-keys" style={{ margin: "4px 0 0", padding: "0 0 0 18px", color: "#F59E0B" }}>
                        {syncResult.entries.filter((e) => !e.landed).map((e) => <li key={e.key}>{e.key}</li>)}
                      </ul>
                    ) : null}
                    <div style={{ color: "#94A3B8", marginTop: "4px" }}>
                      Accepted-price cross-check: {syncResult.currentOfferCrossCheckOk ? "matches" : "MISMATCH"}.
                    </div>
                    <div
                      data-testid="contract-projection-sync-draft-request"
                      style={{
                        color: syncResult.draftRequest.reportedStatus === "accepted" ? "#22C55E"
                          : syncResult.draftRequest.reportedStatus === "indeterminate" ? "#EF4444"
                          : "#94A3B8",
                        marginTop: "4px",
                      }}
                    >
                      {!syncResult.draftRequest.attempted
                        ? "Draft request not attempted (field writes did not all land)."
                        : syncResult.draftRequest.transitionAllowed === false
                          ? `Draft not requested -- ${syncResult.draftRequest.refusalReason}`
                          : syncResult.draftRequest.attemptNoteOk === false
                            ? `Draft not requested -- ${syncResult.draftRequest.refusalReason}`
                            : syncResult.draftRequest.reportedStatus === "accepted"
                              ? "Contract Draft Request set to Requested (confirmed on readback, evidence recorded)."
                              : syncResult.draftRequest.reportedStatus === "indeterminate"
                                ? `INDETERMINATE -- a draft may have been triggered but IAOS could not confirm it (${syncResult.draftRequest.refusalReason ?? "no further detail was recorded"}). Do not retry; check GHL directly.`
                                : `Draft request failed -- ${syncResult.draftRequest.refusalReason ?? "no further detail was recorded"}.`}
                    </div>
                    {syncResult.draftRequest.resolutionNoteOk === false ? (
                      <div data-testid="contract-projection-sync-resolution-note-failed" style={{ color: "#EF4444", marginTop: "4px" }}>
                        The resolution evidence note itself failed to record -- the outcome above is reported from this session's own observation only.
                      </div>
                    ) : null}
                    {syncResult.warnings.length > 0 ? (
                      <ul data-testid="contract-projection-sync-warnings" style={{ margin: "8px 0 0", padding: "0 0 0 18px", color: "#F59E0B" }}>
                        {syncResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <ErrorText testId="contract-projection-sync-error">{syncResult?.kind === "error" ? syncResult.message : null}</ErrorText>
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

          {/* ================================================================ */}
          {/* Verify Execution & Under Contract -- B9-10 / INV-65               */}
          {/* Jess Gate repair round, 2026-09-13. READ-ONLY against GHL. Writes */}
          {/* nothing. Under Contract stays BLOCKED in V1 regardless of what    */}
          {/* this section observes -- see EXECUTED_TERMS_EVIDENCE_UNAVAILABLE. */}
          {/* ================================================================ */}
          {existingSend && existingSend.status === "accepted" ? (
            <div data-testid="contract-execution-section" style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#E2E8F0", marginBottom: "4px" }}>
                Verify Execution &amp; Under Contract
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
                Verifies, in this browser only, whether the three locked Under Contract facts actually hold: every signer completed (by provider recipient id, never GHL's generic role), the provider independently reports completion, and a manually-selected executed PDF is present and hashed. Nothing here is uploaded, persisted, logged, or written to GHL.
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
                          : item.kind === "signing_party" ? `Signing party: ${item.signerRole}`
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
                        disabled={!allChecklistItemsAnswered || !manualArtifactVerificationResult || !manualArtifactVerificationResult.ok}
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
          ) : null}

          {/* ================================================================ */}
          {/* Start Disposition -- B9-11 / INV-66. Shown ONLY once a genuine,   */}
          {/* canonical-carrier-parsed Under Contract record exists. Writes     */}
          {/* nothing until Brad's own explicit click.                         */}
          {/* ================================================================ */}
          {currentUnderContractRecord ? (
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
