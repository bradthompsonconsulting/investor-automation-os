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
import { MANUAL_SEND_TEMPLATE_SOURCE } from "../../../src/lib/contract-manual-send-model";
import { isSameContractVersion } from "../../../src/lib/board9-contract-model";
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
    const isManualBridge = send.templateSource === MANUAL_SEND_TEMPLATE_SOURCE;
    if (isManualBridge) {
      // The manual bridge writes directly at status "accepted" -- Brad's
      // own attestation that he already completed the upload/send GHL
      // performed himself. It has no separate POST/readback pair to stage
      // through (see contract-manual-send-model.ts's own header), so
      // neither a server send receipt (requireSendOutcome, which exists to
      // bind a ledger claim to IAOS's OWN automated POST attempt) nor an
      // `in_progress` reservation note (which exists to prevent a second
      // concurrent AUTOMATED attempt) applies to it.
      if (send.status !== "accepted") throw new Error("The manual GHL send bridge records only a completed (accepted) send");
    } else {
      await requireSendOutcome(send.attemptId,send.status,send.providerResponse?.documentId??null);
    }
    const existing = notes.map(n => parseContractSendNote(n.body)).filter(Boolean);
    if (existing.some(n=>n!.attemptId===send.attemptId && n!.status==="accepted")) throw new Error("Accepted send cannot be overwritten or duplicated");
    if (send.requestedTemplateId !== getConfig(process.env.IAOS_ENV).documentsContracts.templateId) throw new Error("Wrong send template");
    if (isManualBridge) {
      // A second, DIFFERENT attemptId accepted for the same exact contract
      // version is a genuine conflicting duplicate -- refuse it, the same
      // idempotency guarantee the automated path's reservation gives it.
      if (existing.some(n => n!.opportunityId === send.opportunityId && n!.attemptId !== send.attemptId && n!.status === "accepted" && isSameContractVersion(n!.version, send.version))) {
        throw new Error("An accepted send already exists for this exact contract version");
      }
    } else if (!existing.some(n => n!.attemptId === send.attemptId && n!.opportunityId === send.opportunityId && n!.status === "in_progress")) {
      throw new Error("No matching send reservation");
    }
  }
  // Gate-review closure -- narrow post-attestation safety repair. A
  // second "Record attestation" click (before the client's own hydrated
  // currency check could disable the button) previously had nothing
  // stopping a second, duplicate durable note for the SAME exact
  // evidence -- unlike `send` above, this note kind had no server-side
  // duplicate guard at all. "Same exact evidence" mirrors
  // `verifyExecutedTermsAttestationCurrency`'s own definition of current:
  // opportunity, contract version, provider document, its revision, and
  // the selected artifact hash, all identical.
  const executedTermsAttestation = parseExecutedTermsAttestationNote(body);
  if (executedTermsAttestation) {
    const existing = notes.map(n => parseExecutedTermsAttestationNote(n.body)).filter(Boolean);
    if (existing.some(n =>
      n!.opportunityId === executedTermsAttestation.opportunityId &&
      isSameContractVersion(n!.version, executedTermsAttestation.version) &&
      n!.providerDocumentId === executedTermsAttestation.providerDocumentId &&
      n!.providerDocumentRevision === executedTermsAttestation.providerDocumentRevision &&
      n!.selectedArtifactSha256 === executedTermsAttestation.selectedArtifactSha256
    )) throw new Error("An executed-terms attestation already exists for this exact evidence");
  }
}
