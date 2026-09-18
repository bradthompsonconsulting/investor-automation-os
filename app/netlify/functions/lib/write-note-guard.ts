import { requireSendOutcome } from "./write-receipts";
import { validateDerivedNote } from "./write-derived-note";
/** INV-95: validate existing ledger schemas before they can acquire business authority. */
import { parseArvApprovalNote } from "../../../src/lib/arv-approval-note";
import { parseOutcomeNote } from "../../../src/lib/seller-call-outcome";
import { parsePropertyIdentityConfirmationNote, parseTransactionAssumptionsNote, parseSellerPricePositionNote, parseReadinessHumanActionNote, parseReadinessDecisionInvalidationNote, parseContractReadyChecklistNote } from "../../../src/lib/seller-call-readiness-carriers";
import { parseNegotiationOverrideNote } from "../../../src/lib/seller-call-negotiation-override-note";
import { parseBuyerEntityOverrideNote, parsePartySignerFactsNote, parsePropertyLegalDescriptionFactsNote, parseLeaseDisclosureFactsNote, parseEarnestMoneyOptionFactsNote, parseTitleSurveyFactsNote, parsePropertyConditionFactsNote, parseClosingPossessionFactsNote, parseSettlementExpenseFactsNote, parseRepresentationFactsNote, parseAddendaApplicabilityFactsNote, parseSellerEquitableInterestDisclosureNote, parseAttorneyManualFieldDispositionNote, parseSellerNoticeConfirmationFactsNote, parseBuyerBusinessConfigFactsNote, parseSellerSigningModelNote } from "../../../src/lib/seller-contract-facts-carriers";
import { parseBradContractAuthorizationNote } from "../../../src/lib/contract-authorization-carriers";
import { parseDispositionHandoffNote } from "../../../src/lib/contract-disposition-handoff-carriers";
import { parseExecutedTermsAttestationNote } from "../../../src/lib/contract-executed-terms-attestation-carriers";
import { parseContractLifecycleNote } from "../../../src/lib/contract-lifecycle-carriers";
import { parseUnderContractNote } from "../../../src/lib/contract-execution-carriers";
import { parseContractProjectionSyncNote } from "../../../src/lib/contract-projection-sync-carriers";
import { parseContractSendNote } from "../../../src/lib/contract-send-carriers";
import { parseSignerMappingAttestationNote } from "../../../src/lib/contract-signer-mapping-carriers";
import { identifier } from "./write-contracts";
import { fieldValue, type GhlBoundary } from "./ghl-write-boundary";
import { getConfig } from "../../../shared/ghl-config";
import { latestOutcomeNoteForOpportunity } from "../../../src/lib/seller-call-outcome";
const parsers: ((body: string) => any)[] = [parseArvApprovalNote, parseOutcomeNote, parsePropertyIdentityConfirmationNote, parseTransactionAssumptionsNote, parseSellerPricePositionNote, parseReadinessHumanActionNote, parseReadinessDecisionInvalidationNote, parseContractReadyChecklistNote, parseNegotiationOverrideNote, parseBuyerEntityOverrideNote, parsePartySignerFactsNote, parsePropertyLegalDescriptionFactsNote, parseLeaseDisclosureFactsNote, parseEarnestMoneyOptionFactsNote, parseTitleSurveyFactsNote, parsePropertyConditionFactsNote, parseClosingPossessionFactsNote, parseSettlementExpenseFactsNote, parseRepresentationFactsNote, parseAddendaApplicabilityFactsNote, parseSellerEquitableInterestDisclosureNote, parseAttorneyManualFieldDispositionNote, parseSellerNoticeConfirmationFactsNote, parseBuyerBusinessConfigFactsNote, parseSellerSigningModelNote, parseBradContractAuthorizationNote, parseDispositionHandoffNote, parseExecutedTermsAttestationNote, parseContractLifecycleNote, parseUnderContractNote, parseContractProjectionSyncNote, parseContractSendNote, parseSignerMappingAttestationNote];
export async function validateLedgerNote(boundary: GhlBoundary, contactId: string, body: string) {
  const record = parsers.map(parse => parse(body)).find(Boolean);
  if (!record) {
    if (/^IAOS (?:ARV|OFFER|CONTRACT|BRAD|SELLER|PROPERTY|TRANSACTION|READINESS|UNDER|DISPOSITION|EXECUTED|SIGNER|NEGOTIATION|BUYER|PARTY|LEASE|EARNEST|TITLE|CLOSING|SETTLEMENT|REPRESENTATION|ADDENDA|ATTORNEY)/.test(body)) throw new Error("Malformed or undeclared ledger note");
    return;
  }
  if (record.operator !== undefined && record.operator !== null && record.operator !== "brad" && !(parseArvApprovalNote(body) && record.operator === "Brad Thompson")) throw new Error("Ledger operator does not match authenticated Brad");
  if (record.authorizedBy !== undefined && record.authorizedBy !== "brad") throw new Error("Invalid authorizer");
  identifier(record.opportunityId);
  const opportunity = await boundary.opportunity(record.opportunityId);
  if (opportunity.contactId !== contactId) throw new Error("Ledger opportunity belongs to another contact");
  const notes = await boundary.notes(contactId);
  const arv = parseArvApprovalNote(body);
  if (arv && fieldValue(opportunity.customFields, getConfig(process.env.IAOS_ENV).opportunityFacts.arv, "opportunity").value !== arv.approvedArv) throw new Error("ARV approval must match confirmed opportunity ARV");
  const outcome = parseOutcomeNote(body);
  if (outcome) {
    const previous = latestOutcomeNoteForOpportunity(notes, record.opportunityId);
    if (previous?.kind === "accept") throw new Error("Agreement is already recorded");
    if (outcome.kind === "accept") {
      const value = fieldValue(opportunity.customFields, getConfig(process.env.IAOS_ENV).opportunityFacts.currentOffer, "opportunity").value;
      if (typeof value !== "number" || value <= 0 || outcome.snapshot.currentOffer !== value) throw new Error("Accepted price must match confirmed Current Offer");
    }
  }
  await validateDerivedNote(boundary, body);
  const send = parseContractSendNote(body);
  if (send) {
    if (send.status === "in_progress") throw new Error("Send reservations require the dedicated server operation");
    await requireSendOutcome(send.attemptId,send.status,send.providerResponse?.documentId??null);
    const existing = notes.map(n => parseContractSendNote(n.body)).filter(Boolean);
    if (existing.some(n=>n!.attemptId===send.attemptId && n!.status==="accepted")) throw new Error("Accepted send cannot be overwritten or duplicated");
    if (send.requestedTemplateId !== getConfig(process.env.IAOS_ENV).documentsContracts.templateId) throw new Error("Wrong send template");
    if (!existing.some(n => n!.attemptId === send.attemptId && n!.opportunityId === send.opportunityId && n!.status === "in_progress")) throw new Error("No matching send reservation");
  }
}
