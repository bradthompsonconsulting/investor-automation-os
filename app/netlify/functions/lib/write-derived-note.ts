import { isSameContractVersion } from "../../../src/lib/board9-contract-model";
import { matchingArvApprovalForOpportunity } from "../../../src/lib/arv-approval-note";
/** INV-95: recompute system-derived ledger authority from fresh GHL evidence. */
import { isDeepStrictEqual } from "node:util";
import { getConfig } from "../../../shared/ghl-config";
import { currentContractContext, currentGeneratedArtifactFacts } from "./write-contract-context";
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
import { classifyDocumentReadback, classifyManualSendReadback } from "../../../src/lib/contract-send-model";
import { MANUAL_SEND_TEMPLATE_SOURCE } from "../../../src/lib/contract-manual-send-model";
import { latestPreservedExecutedArtifactForVersion, type PreservedExecutedArtifact } from "../../../src/lib/contract-executed-artifact-carriers";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

/**
 * Board #9 Phase B (B9-13), gate-review closure -- shared by the
 * stage-transition gate AND the disposition-handoff gate below. Finds
 * the durable preserved-artifact record for this EXACT opportunity/
 * agreement/version and re-reads its stored bytes from Blobs, never
 * trusting the note's own claim: byte count and SHA-256 are both
 * independently recomputed from what is actually stored right now.
 * Missing metadata, missing bytes, or a mismatch on either check all
 * throw -- never treated as a verified preserved artifact.
 */
async function reverifyPreservedArtifact(
  notes: { body: string }[],
  opportunityId: string,
  agreementAt: string,
  version: import("../../../src/lib/board9-contract-model").ContractVersionIdentity,
): Promise<PreservedExecutedArtifact> {
  const preserved = latestPreservedExecutedArtifactForVersion(notes, opportunityId, agreementAt, version);
  if (!preserved) throw new Error("No independently re-verifiable preserved executed-artifact record exists for this exact opportunity/version");
  const artifactBytes = await getStore("iaos-executed-artifacts").get(preserved.blobKey, { type: "arrayBuffer" });
  if (!artifactBytes) throw new Error("Preserved artifact bytes could not be read back for re-verification");
  const artifactBuffer = Buffer.from(artifactBytes);
  if (artifactBuffer.byteLength !== preserved.byteCount) throw new Error("Preserved artifact byte count no longer matches its durable record");
  if (createHash("sha256").update(artifactBuffer).digest("hex") !== preserved.sha256) throw new Error("Preserved artifact hash no longer matches its durable record");
  return preserved;
}

/**
 * Board #9 Phase B (B9-13), gate-review closure -- a FRESH GHL read
 * (never a note's claim, never browser-local `stageTransitionState`,
 * which resets on reload) confirming the opportunity is durably in the
 * exact Seller Leads Pipeline AND the exact Under Contract stage.
 */
async function requireUnderContractStageConfirmed(boundary: GhlBoundary, opportunityId: string, config: ReturnType<typeof getConfig>): Promise<void> {
  const opportunity = await boundary.opportunity(opportunityId);
  if (opportunity.pipelineId !== config.pipelines.sellerLeads || opportunity.pipelineStageId !== config.stages.underContract) {
    throw new Error("Opportunity is not durably confirmed in the exact Seller Leads Pipeline / Under Contract stage");
  }
}

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
    // Independently regenerated, never the note's own claim -- see
    // currentGeneratedArtifactFacts's own header.
    const currentArtifactFacts = await currentGeneratedArtifactFacts(context);
    if (!evaluateBradAuthorizationCurrency(authorization, context.preview, currentArtifactFacts).authorized) throw new Error("Authorization differs from current canonical document");
    return;
  }
  const history = allContractLifecycleRecordsForOpportunity(context.notes, record.opportunityId);
  if (handoff) {
    const underContract = allUnderContractRecordsForOpportunity(context.notes, record.opportunityId).find(u=>u.iaosVerifiedAt===handoff.underContract.verifiedAt) ?? null;
    const args = { opportunityId:record.opportunityId, agreementAt:context.agreement.at, version:context.version, underContract, lifecycleHistory:history, existingHandoffsForOpportunity:allDispositionHandoffsForOpportunity(context.notes,record.opportunityId).map(h=>({agreementAt:h.agreementAt,version:h.version,underContractVerifiedAt:h.underContract.verifiedAt})) };
    if (!evaluateDispositionHandoffEligibility(args).eligible || !underContract || !verifyHandoffMatchesUnderContract({...args,underContract,handoff}).ok) throw new Error("Handoff transition refused");
    // Gate-review closure (§5 ruling) -- Start Disposition's durable,
    // server-side gate: the SAME three conditions the client independently
    // derives (never trusted from the client alone). A stale note
    // resubmitted after a rescission or a since-corrupted artifact must
    // never be allowed to write a disposition handoff.
    const config = getConfig(process.env.IAOS_ENV);
    await reverifyPreservedArtifact(context.notes, record.opportunityId, context.agreement.at, context.version);
    await requireUnderContractStageConfirmed(boundary, record.opportunityId, config);
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
      if (send.templateSource === MANUAL_SEND_TEMPLATE_SOURCE) {
        // The manual bridge records Brad's own attestation that he already
        // completed an upload/send GHL performed himself -- it was never
        // dispatched by IAOS's own sender identity, so it cannot be
        // deep-equal-recomputed the way the automated path's fields are.
        // Independently confirmed instead: the exact document/revision Brad
        // named genuinely exists, live, in the Test location, undeleted,
        // not a draft, and carries a real required fillable field.
        const verified=classifyManualSendReadback({expectedDocumentId:id,expectedLocationId:config.locationId,expectedDocumentRevision:send.providerResponse?.documentRevision??null,outcome:await providerOutcome()});
        if(verified.status!=="accepted")throw new Error("Manual send could not be independently confirmed against live provider evidence: "+(verified.failureReason??"unknown"));
      } else {
        const verified=classifyDocumentReadback({expectedDocumentId:id,expectedRecipientId:context.contact.id,expectedSenderUserId:config.documentsContracts.senderUserId,expectedLocationId:config.locationId,outcome:await providerOutcome()});
        if(verified.status!=="accepted" || !isDeepStrictEqual(verified.summary,send.providerResponse))throw new Error("Send resolution differs from provider evidence");
      }
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
    const result=buildVerifiedUnderContractRecord({opportunityId:record.opportunityId,agreementAt:context.agreement.at,version:context.version,acceptedSend,requiredSigners:signers.signers,buyerSignerRole:signers.buyerRole,authorizedBuyerName:signers.buyerDisplayName,authorizedBuyerEmail:signers.buyerEmail,signerMappingAttestation:latestSignerMappingAttestationForOpportunity(context.notes,record.opportunityId),providerRecipients:recipients.rows,lifecycleHistory:[...history,observed.value],manualArtifactOutcome:{kind:"selected",sha256:execution.artifactSha256,fileName:"operator-selected.pdf",mimeType:"application/pdf",pageCount:execution.pageCount},selectedForDocumentId:documentId,selectedForVersion:execution.version,executedTermsAttestation:latestExecutedTermsAttestationForOpportunity(context.notes,record.opportunityId),iaosVerifiedAt:execution.iaosVerifiedAt,evidenceSummary:execution.evidenceSummary,relatedPriorRecordId:execution.relatedPriorRecordId});
    if(!result.ok || !isDeepStrictEqual(result.value,execution))throw new Error("Under Contract evidence is not independently confirmed");
    if(allUnderContractRecordsForOpportunity(context.notes,record.opportunityId).some(r=>isDuplicateUnderContractRecord(r,execution)))throw new Error("Duplicate execution evidence");
  }
}

/**
 * Board #9 Phase B (B9-13) -- the Under Contract GHL opportunity-stage
 * transition's own independent re-verification. Never called from a note
 * body (there is no note being written); called directly by the
 * "opportunity.underContractStage" operation in `ghl-write.ts` BEFORE it
 * is permitted to call `GhlBoundary.transitionOpportunityStage`.
 *
 * Mirrors `validateDerivedNote`'s own Under Contract re-derivation above
 * exactly, retargeted: instead of comparing fresh evidence against an
 * INCOMING note body, it finds the ALREADY-DURABLE Under Contract record
 * for this exact opportunity/agreement/version and requires fresh
 * evidence to STILL independently re-derive it byte-for-byte. A stage
 * transition can never be requested from a stale or since-invalidated
 * Under Contract record -- this is what actually confirms that, not
 * merely that a note with the right shape exists somewhere.
 */
export async function verifyUnderContractStageTransitionReady(
  boundary: GhlBoundary,
  opportunityId: string,
  agreementAt: string,
  version: import("../../../src/lib/board9-contract-model").ContractVersionIdentity,
) {
  const context = await currentContractContext(boundary, opportunityId);
  if (context.agreement.at !== agreementAt) throw new Error("Agreement has changed since this transition was requested");
  if (!isSameContractVersion(context.version, version)) throw new Error("Contract version has changed since this transition was requested");
  const existing = allUnderContractRecordsForOpportunity(context.notes, opportunityId).find(
    (r) => r.agreementAt === agreementAt && isSameContractVersion(r.version, version),
  );
  if (!existing) throw new Error("No durable Under Contract record exists for this exact opportunity/version");

  // Pinned to the EXACT send this Under Contract record was built from
  // (`existing.acceptedSendAttemptId`) -- NEVER "whatever send is
  // currently latest for this opportunity". An opportunity can carry
  // sends for more than one contract version over its lifetime (a manual
  // re-entry, a correction); `latestContractSendForOpportunity` resolves
  // across ALL of them, which is correct for the note-WRITE guard above
  // (it is always validating a note about the send that just happened)
  // but wrong here, where a LATER, unrelated send for a different
  // version must never silently substitute for this one.
  const acceptedSend = context.notes
    .map((n) => parseContractSendNote(n.body))
    .find((s): s is NonNullable<typeof s> => s !== null && s.opportunityId === opportunityId && s.attemptId === existing.acceptedSendAttemptId && s.status === "accepted");
  if (!acceptedSend || !acceptedSend.providerResponse?.documentId) throw new Error("Accepted send evidence required");
  const config = getConfig(process.env.IAOS_ENV);
  if (config.locationId !== getConfig("test").locationId || context.contact.id !== config.documentsContracts.approvedTestContactId) throw new Error("Contract provider evidence is Test-only");
  const documentId = acceptedSend.providerResponse.documentId;
  const response = await boundary.fetcher(
    "https://services.leadconnectorhq.com/proposals/document?" + new URLSearchParams({ locationId: config.locationId, limit: "21" }),
    { headers: { Authorization: "Bearer " + boundary.token, Version: "v3" } },
  );
  const responseBody = await response.json();
  if (!Array.isArray(responseBody?.documents) || new Set(responseBody.documents.map((d: any) => d?.documentId)).size !== responseBody.documents.length) {
    throw new Error("Ambiguous document readback");
  }
  const outcome = { kind: "http_response" as const, status: response.status, body: responseBody };

  const history = allContractLifecycleRecordsForOpportunity(context.notes, opportunityId);
  const observed = buildProviderObservationRecordFromReadback({
    opportunityId, version: acceptedSend.version, expectedDocumentId: documentId, expectedLocationId: config.locationId,
    acceptedSend, outcome, iaosObservedAt: existing.iaosVerifiedAt, evidenceSummary: existing.evidenceSummary, relatedPriorRecordId: existing.relatedPriorRecordId,
  });
  if (!observed.ok) throw new Error("Provider observation refused");

  const signers = buildRequiredSignerSet(context.report);
  const recipients = extractProviderSignerRowsFromListDocumentsBody({ body: outcome.body, expectedDocumentId: documentId, expectedLocationId: config.locationId });
  if (!signers.ok || !recipients.ok) throw new Error("Signer evidence unavailable");
  const result = buildVerifiedUnderContractRecord({
    opportunityId, agreementAt: context.agreement.at, version: context.version, acceptedSend,
    requiredSigners: signers.signers, buyerSignerRole: signers.buyerRole, authorizedBuyerName: signers.buyerDisplayName, authorizedBuyerEmail: signers.buyerEmail,
    signerMappingAttestation: latestSignerMappingAttestationForOpportunity(context.notes, opportunityId),
    providerRecipients: recipients.rows, lifecycleHistory: [...history, observed.value],
    manualArtifactOutcome: { kind: "selected", sha256: existing.artifactSha256, fileName: "operator-selected.pdf", mimeType: "application/pdf", pageCount: existing.pageCount },
    selectedForDocumentId: documentId, selectedForVersion: existing.version,
    executedTermsAttestation: latestExecutedTermsAttestationForOpportunity(context.notes, opportunityId),
    iaosVerifiedAt: existing.iaosVerifiedAt, evidenceSummary: existing.evidenceSummary, relatedPriorRecordId: existing.relatedPriorRecordId,
  });
  if (!result.ok || !isDeepStrictEqual(result.value, existing)) throw new Error("Under Contract evidence is not independently re-confirmed");

  // Board #9 Phase B, requirement 15 -- the transition also requires the
  // preserved executed-artifact to independently re-verify.
  await reverifyPreservedArtifact(context.notes, opportunityId, agreementAt, version);

  return existing;
}
