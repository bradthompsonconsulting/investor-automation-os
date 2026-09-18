import { isSameContractVersion } from "../../../src/lib/board9-contract-model";
import { matchingArvApprovalForOpportunity } from "../../../src/lib/arv-approval-note";
/** INV-95: recompute system-derived ledger authority from fresh GHL evidence. */
import { isDeepStrictEqual } from "node:util";
import { getConfig } from "../../../shared/ghl-config";
import { currentContractContext } from "./write-contract-context";
import type { GhlBoundary } from "./ghl-write-boundary";
import { parseBradContractAuthorizationNote } from "../../../src/lib/contract-authorization-carriers";
import { evaluateBradAuthorizationCurrency } from "../../../src/lib/contract-authorization-model";
import { parseUnderContractNote, allUnderContractRecordsForOpportunity } from "../../../src/lib/contract-execution-carriers";
import { parseDispositionHandoffNote, allDispositionHandoffsForOpportunity } from "../../../src/lib/contract-disposition-handoff-carriers";
import { evaluateDispositionHandoffEligibility, verifyHandoffMatchesUnderContract, buildDispositionHandoffRecordArgs } from "../../../src/lib/contract-disposition-handoff-model";
import { parseContractLifecycleNote, allContractLifecycleRecordsForOpportunity } from "../../../src/lib/contract-lifecycle-carriers";
import { buildProviderObservationRecordFromReadback, buildRescissionRecord, buildDeclineRecord, buildResendRecord, buildCorrectionRecord } from "../../../src/lib/contract-lifecycle-model";
import { buildRequiredSignerSet } from "../../../src/lib/contract-signer-mapping-model";
import { latestSignerMappingAttestationForOpportunity } from "../../../src/lib/contract-signer-mapping-carriers";
import { latestExecutedTermsAttestationForOpportunity } from "../../../src/lib/contract-executed-terms-attestation-carriers";
import { buildVerifiedUnderContractRecord, extractProviderSignerRowsFromListDocumentsBody, isDuplicateUnderContractRecord } from "../../../src/lib/contract-execution-model";
import { latestContractSendForOpportunity, parseContractSendNote } from "../../../src/lib/contract-send-carriers";
import { classifyDocumentReadback } from "../../../src/lib/contract-send-model";
export async function validateDerivedNote(boundary: GhlBoundary, body: string) {
  const authorization = parseBradContractAuthorizationNote(body);
  const execution = parseUnderContractNote(body);
  const handoff = parseDispositionHandoffNote(body);
  const lifecycle = parseContractLifecycleNote(body);
  const send = parseContractSendNote(body);
  const record = authorization ?? execution ?? handoff ?? lifecycle ?? send;
  if (!record) return;
  const context = await currentContractContext(boundary, record.opportunityId);
  if (authorization) {
    if (!evaluateBradAuthorizationCurrency(authorization, context.preview).authorized) throw new Error("Authorization differs from current canonical document");
    return;
  }
  const history = allContractLifecycleRecordsForOpportunity(context.notes, record.opportunityId);
  if (handoff) {
    const underContract = allUnderContractRecordsForOpportunity(context.notes, record.opportunityId).find(u=>u.iaosVerifiedAt===handoff.underContract.verifiedAt) ?? null;
    const args = { opportunityId:record.opportunityId, agreementAt:context.agreement.at, version:context.version, underContract, lifecycleHistory:history, existingHandoffsForOpportunity:allDispositionHandoffsForOpportunity(context.notes,record.opportunityId).map(h=>({agreementAt:h.agreementAt,version:h.version,underContractVerifiedAt:h.underContract.verifiedAt})) };
    if (!evaluateDispositionHandoffEligibility(args).eligible || !underContract || !verifyHandoffMatchesUnderContract({...args,underContract,handoff}).ok) throw new Error("Handoff transition refused");
    const required = buildRequiredSignerSet(context.report);
    if (!required.ok) throw new Error("Required signers unavailable");
    const economics = context.agreement.snapshot;
    const approval = matchingArvApprovalForOpportunity(context.notes,record.opportunityId,economics.arv);
    const rebuilt = buildDispositionHandoffRecordArgs({handoffId:handoff.handoffId,createdAt:handoff.createdAt,opportunityId:record.opportunityId,contactId:context.contact.id,agreementAt:context.agreement.at,version:context.version,eligibility:{eligible:true},underContract,propertyAddress:context.propertyAddress?{kind:"populated",value:context.propertyAddress,authority:"operator_attested",recordedAt:null}:{kind:"unresolved"},propertyLegalDescription:context.report.propertyLegalDescription,sellerContractPrice:economics.currentOffer,approvedArv:economics.arv===null?null:{amount:economics.arv,approvalEvidenceState:approval?.evidenceState??null,approvalDecision:approval?.decision??null,approvedAt:approval?.approvedAt??null},approvedRepairs:economics.repairs,closingDate:context.report.closingPossession.closingDate,possessionDetails:context.report.closingPossession.possessionDetails,accessShowingInformation:{kind:"unresolved"},sellerContact:{noticeAddress:context.report.noticeContact.sellerNoticeAddress,noticePhone:context.report.noticeContact.sellerNoticePhone,noticeEmail:context.report.noticeContact.sellerNoticeEmail},requiredSigners:required.signers,documentReferences:[],documentReferencesNote:handoff.documentReferencesNote,evidenceSummary:handoff.evidenceSummary});
    if(!rebuilt.ok || !isDeepStrictEqual(rebuilt.value,handoff))throw new Error("Handoff snapshot differs from canonical evidence");
    return;
  }
  const acceptedSend = latestContractSendForOpportunity(context.notes, record.opportunityId);
  const config = getConfig(process.env.IAOS_ENV);
  const providerOutcome = async () => {
    if (config.locationId !== getConfig("test").locationId || context.contact.id !== config.documentsContracts.approvedTestContactId) throw new Error("Contract provider evidence is Test-only");
    const response = await boundary.fetcher("https://services.leadconnectorhq.com/proposals/document?" + new URLSearchParams({locationId:config.locationId,limit:"21"}), {headers:{Authorization:"Bearer "+boundary.token,Version:"v3"}});
    const body = await response.json();
    if (!Array.isArray(body?.documents) || new Set(body.documents.map((d:any)=>d?.documentId)).size !== body.documents.length) throw new Error("Ambiguous document readback");
    return {kind:"http_response" as const,status:response.status,body};
  };
  if (send) {
    if (send.status === "accepted") {
      const id=send.providerResponse?.documentId; if(!id)throw new Error("Document identity missing");
      const verified=classifyDocumentReadback({expectedDocumentId:id,expectedRecipientId:context.contact.id,expectedSenderUserId:config.documentsContracts.senderUserId,expectedLocationId:config.locationId,outcome:await providerOutcome()});
      if(verified.status!=="accepted" || !isDeepStrictEqual(verified.summary,send.providerResponse))throw new Error("Send resolution differs from provider evidence");
    }
    return;
  }
  if (lifecycle && lifecycle.kind !== "provider_observation") {
    let result;
    if(lifecycle.kind === "rescission")result=buildRescissionRecord({...lifecycle,acceptedSend:acceptedSend?.status==="accepted"?acceptedSend:null});
    else if(lifecycle.kind === "decline") {if(!acceptedSend)throw new Error("No accepted send");result=buildDeclineRecord({...lifecycle,acceptedSend});}
    else if(lifecycle.kind === "resend") {if(!acceptedSend)throw new Error("No prior send");result=buildResendRecord({...lifecycle,priorSend:acceptedSend});}
    // Corrections are operator-attested, never provider or execution evidence.
    else {
      if(lifecycle.recordedBy!=="brad" || acceptedSend?.status!=="accepted" || !isSameContractVersion(lifecycle.priorVersion,acceptedSend.version))throw new Error("Correction lacks its prior sent agreement");
      result=buildCorrectionRecord({...lifecycle,classification:lifecycle.classification==="new_agreement_required"?{kind:"new_agreement_required",conflicts:lifecycle.materialConflicts}:{kind:"same_agreement_reentry"},newAgreementAt:lifecycle.classification==="new_agreement_required"?lifecycle.newVersion.agreementAt:null});
    }
    if(!result.ok || !isDeepStrictEqual(result.value,lifecycle))throw new Error("Lifecycle transition refused");
    return;
  }
  if(!acceptedSend || acceptedSend.status!=="accepted" || !acceptedSend.providerResponse?.documentId)throw new Error("Accepted send evidence required");
  const documentId=acceptedSend.providerResponse.documentId;
  const outcome=await providerOutcome();
  const observed=buildProviderObservationRecordFromReadback({opportunityId:record.opportunityId,version:acceptedSend.version,expectedDocumentId:documentId,expectedLocationId:config.locationId,acceptedSend,outcome,iaosObservedAt:lifecycle?.iaosObservedAt ?? execution!.iaosVerifiedAt,evidenceSummary:lifecycle?.evidenceSummary ?? execution!.evidenceSummary,relatedPriorRecordId:lifecycle ? lifecycle.relatedPriorRecordId : execution!.relatedPriorRecordId});
  if(!observed.ok)throw new Error("Provider observation refused");
  if(lifecycle) {if(!isDeepStrictEqual(observed.value,lifecycle))throw new Error("Provider observation differs from fresh evidence");return;}
  if(execution) {
    const signers=buildRequiredSignerSet(context.report);
    const recipients=extractProviderSignerRowsFromListDocumentsBody({body:outcome.body,expectedDocumentId:documentId,expectedLocationId:config.locationId});
    if(!signers.ok || !recipients.ok)throw new Error("Signer evidence unavailable");
    const result=buildVerifiedUnderContractRecord({opportunityId:record.opportunityId,agreementAt:context.agreement.at,version:context.version,acceptedSend,requiredSigners:signers.signers,signerMappingAttestation:latestSignerMappingAttestationForOpportunity(context.notes,record.opportunityId),providerRecipients:recipients.rows,lifecycleHistory:[...history,observed.value],manualArtifactOutcome:{kind:"selected",sha256:execution.artifactSha256,fileName:"operator-selected.pdf",mimeType:"application/pdf"},selectedForDocumentId:documentId,selectedForVersion:execution.version,executedTermsAttestation:latestExecutedTermsAttestationForOpportunity(context.notes,record.opportunityId),iaosVerifiedAt:execution.iaosVerifiedAt,evidenceSummary:execution.evidenceSummary,relatedPriorRecordId:execution.relatedPriorRecordId});
    if(!result.ok || !isDeepStrictEqual(result.value,execution))throw new Error("Under Contract evidence is not independently confirmed");
    if(allUnderContractRecordsForOpportunity(context.notes,record.opportunityId).some(r=>isDuplicateUnderContractRecord(r,execution)))throw new Error("Duplicate execution evidence");
  }
}
