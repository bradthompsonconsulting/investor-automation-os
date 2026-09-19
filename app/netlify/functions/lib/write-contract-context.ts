/** Reuses the application's canonical contract computations on fresh GHL evidence. */
import { getConfig, CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED } from "../../../shared/ghl-config";
import { latestOutcomeNoteForOpportunity } from "../../../src/lib/seller-call-outcome";
import { initialVersionIdentity } from "../../../src/lib/board9-contract-model";
import { computeSellerContractFactsReport } from "../../../src/lib/contract-facts-model";
import { buildContractDocumentPreview } from "../../../src/lib/contract-document-model";
import { buildContractProjectionPlan } from "../../../src/lib/contract-ghl-projection-model";
import { latestSellerSigningModelForOpportunity } from "../../../src/lib/seller-contract-facts-carriers";
import { evaluateSellerSigningPreWriteReadiness, resolveSeller1FromOpportunity, sellerCountTransportValue } from "../../../src/lib/contract-seller-signing-model";
import { latestBradContractAuthorizationForOpportunity } from "../../../src/lib/contract-authorization-carriers";
import { evaluateBradAuthorizationCurrency } from "../../../src/lib/contract-authorization-model";
import type { GhlBoundary } from "./ghl-write-boundary";
export async function currentContractContext(boundary: GhlBoundary, opportunityId: string) {
  const opportunity = await boundary.opportunity(opportunityId);
  const contact = await boundary.contact(opportunity.contactId);
  const notes = await boundary.notes(contact.id);
  const agreement = latestOutcomeNoteForOpportunity(notes, opportunityId);
  if (agreement?.kind !== "accept" || agreement.snapshot.currentOffer === null) throw new Error("Current accepted agreement is required");
  const cityStateZip = [contact.city, [contact.state, contact.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const propertyAddress = [contact.address1, cityStateZip].filter(Boolean).join(", ") || null;
  const version = initialVersionIdentity(agreement.at);
  const report = computeSellerContractFactsReport({ opportunityId, notes, agreedPrice: agreement.snapshot.currentOffer, agreementAt: agreement.at, propertyAddress });
  const preview = buildContractDocumentPreview({ opportunityId, version, report, propertyStreetAddress: propertyAddress ? { kind: "populated", value: propertyAddress, authority: "operator_attested", recordedAt: null } : { kind: "unresolved" } });
  const signing = latestSellerSigningModelForOpportunity(notes, opportunityId);
  const config = getConfig(process.env.IAOS_ENV);
  const sellerReadiness = evaluateSellerSigningPreWriteReadiness({
    disposition: signing ? {kind:"populated",value:signing.model} : {kind:"unresolved"},
    seller1: resolveSeller1FromOpportunity({contactId:contact.id,contactName:[contact.firstName,contact.lastName].filter(Boolean).join(" ") || contact.name || "",email:contact.email}),
    printedSellerSigners: report.parties.sellerSigners.kind === "populated" ? report.parties.sellerSigners.value.map(s=>({displayName:s.displayName})) : [],
    sellerCountFieldId:config.contractSellerCountField,sellerCountFieldSentinel:CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,sellerCountWriteReadbackVerified:true,
  });
  const projection = buildContractProjectionPlan(opportunityId, preview, report, sellerReadiness);
  return {opportunity,contact,notes,agreement,version,report,preview,projection,propertyAddress,sellerCount:signing?sellerCountTransportValue(signing.model):null};
}
export async function requireCurrentContractAuthorization(boundary: GhlBoundary, opportunityId: string) {
  const context = await currentContractContext(boundary, opportunityId);
  const authority = evaluateBradAuthorizationCurrency(latestBradContractAuthorizationForOpportunity(context.notes, opportunityId), context.preview);
  if (!authority.authorized) throw new Error("Contract authorization refused: " + authority.reasons.map(r=>r.code).join(","));
  return context;
}

/** Provider identity stays independent from the canonical TREC authorization. */
export async function requireConfiguredTestTemplate(boundary:GhlBoundary) {
  const config=getConfig(process.env.IAOS_ENV), expected=config.documentsContracts;
  if(config.locationId!==getConfig("test").locationId)throw new Error("Test template only");
  const response=await boundary.fetcher("https://services.leadconnectorhq.com/proposals/templates?"+new URLSearchParams({locationId:config.locationId,name:expected.expectedTemplateName}),{headers:{Authorization:"Bearer "+boundary.token,Version:"v3"}});
  if(!response.ok)throw new Error("Template identity unavailable");
  const body=await response.json();
  if(!Array.isArray(body?.data))throw new Error("Template identity ambiguous");
  const matches=body.data.filter((t:any)=>t?.id===expected.templateId);
  if(matches.length!==1 || matches[0].deleted || matches[0].name!==expected.expectedTemplateName)throw new Error("Configured template identity changed");
}
