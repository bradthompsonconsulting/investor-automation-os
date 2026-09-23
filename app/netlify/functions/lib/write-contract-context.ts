/** Reuses the application's canonical contract computations on fresh GHL evidence. */
import { getConfig, CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED } from "../../../shared/ghl-config";
import { latestOutcomeNoteForOpportunity } from "../../../src/lib/seller-call-outcome";
import { initialVersionIdentity } from "../../../src/lib/board9-contract-model";
import { computeSellerContractFactsReport } from "../../../src/lib/contract-facts-model";
import { buildContractDocumentPreview } from "../../../src/lib/contract-document-model";
import { buildContractProjectionPlan } from "../../../src/lib/contract-ghl-projection-model";
import { latestSellerSigningModelForOpportunity } from "../../../src/lib/seller-contract-facts-carriers";
import { evaluateSellerSigningCanonicalReadiness, resolveSeller1FromOpportunity, sellerCountTransportValue } from "../../../src/lib/contract-seller-signing-model";
import { latestBradContractAuthorizationForOpportunity } from "../../../src/lib/contract-authorization-carriers";
import { evaluateBradAuthorizationCurrency, type CurrentArtifactFacts } from "../../../src/lib/contract-authorization-model";
import type { GhlBoundary } from "./ghl-write-boundary";
import type { SellerSigningReadinessResult } from "../../../src/lib/contract-seller-signing-model";

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
  const sellerReadiness = evaluateSellerSigningCanonicalReadiness({
    disposition: signing ? {kind:"populated",value:signing.model} : {kind:"unresolved"},
    seller1: resolveSeller1FromOpportunity({contactId:contact.id,contactName:[contact.firstName,contact.lastName].filter(Boolean).join(" ") || contact.name || "",email:contact.email}),
    printedSellerSigners: report.parties.sellerSigners.kind === "populated" ? report.parties.sellerSigners.value.map(s=>({displayName:s.displayName})) : [],
    sellerCountFieldId:config.contractSellerCountField,sellerCountFieldSentinel:CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,sellerCountWriteReadbackVerified:true,
  });
  const projection = buildContractProjectionPlan(opportunityId, preview, report, sellerReadiness);
  return {opportunity,contact,notes,agreement,version,report,preview,projection,propertyAddress,sellerCount:signing?sellerCountTransportValue(signing.model):null,sellerReadiness};
}
export type ContractContext = Awaited<ReturnType<typeof currentContractContext>>;

/**
 * Board #9 Phase B packaging correction. Independently regenerates the
 * CURRENT populated PDF from FRESH canonical facts -- never from a stored
 * authorization note -- by calling the merged PR #81 runtime adapter
 * (`generate-contract-pdf-adapter.ts`), REUSED here rather than
 * duplicated: this file no longer requires `inv67-pdf-generator.cjs`
 * itself at all.
 *
 * The `require()` below is INTENTIONALLY deferred to inside this function
 * body, not module scope. `inv67-pdf-render-core.cjs` (transitively
 * required by the adapter) resolves and validates the canonical source
 * PDF's on-disk path EAGERLY, the instant it is first required -- a
 * module-scope require here would run that resolution the moment ANYTHING
 * imports this file, including `ghl-write.ts` (via write-note-guard.ts ->
 * write-derived-note.ts) for EVERY write operation, not just an
 * authorization-note write. That was PROVEN as a live regression against a
 * real deploy-preview: `ghl-write.ts` 502'd on a plain unauthenticated
 * request, before requireAppWriter or requireAppWriteOrigin ever ran,
 * because the PDF runtime loaded before either gate did. Deferring the
 * require to here means it only ever runs when a caller actually reaches
 * this function -- exclusively the authorization-note validation branch in
 * write-derived-note.ts, and the post-auth/origin/location code path in
 * generate-contract-pdf.ts -- never for an ordinary field or note write.
 *
 * Fails closed (throws) if the projection is incomplete, generation
 * itself fails, or the packaged PDF runtime cannot be loaded/located --
 * there is no fallback value and no partial result.
 */
export async function generateCurrentContractPdf(context: ContractContext): Promise<{ outputBytes: Uint8Array; evidence: { outputSha256: string; sourceSha256: string; generatorVersion: string; manifestVersion: string; [k: string]: unknown } }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateContractPdfFromCanonicalFacts } = require("./generate-contract-pdf-adapter") as {
    generateContractPdfFromCanonicalFacts: (args: {
      opportunityId: string;
      preview: ContractContext["preview"];
      report: ContractContext["report"];
      sellerReadiness: SellerSigningReadinessResult;
    }) => Promise<{ outputBytes: Uint8Array; evidence: { outputSha256: string; sourceSha256: string; generatorVersion: string; manifestVersion: string; [k: string]: unknown } }>;
  };
  return generateContractPdfFromCanonicalFacts({
    opportunityId: context.opportunity.id,
    preview: context.preview,
    report: context.report,
    sellerReadiness: context.sellerReadiness,
  });
}

/**
 * The four `CurrentArtifactFacts` fields, ALL independently sourced from a
 * fresh regeneration -- never from the stored authorization record being
 * evaluated. This is the one and only source of "current" artifact truth
 * this codebase uses; nothing here echoes a caller's or a record's own
 * claim back at itself.
 */
export async function currentGeneratedArtifactFacts(context: ContractContext): Promise<CurrentArtifactFacts> {
  const { evidence } = await generateCurrentContractPdf(context);
  return {
    artifactSha256: evidence.outputSha256,
    sourcePdfSha256: evidence.sourceSha256,
    generatorVersion: evidence.generatorVersion,
    manifestVersion: evidence.manifestVersion,
  };
}

export async function requireCurrentContractAuthorization(boundary: GhlBoundary, opportunityId: string) {
  const context = await currentContractContext(boundary, opportunityId);
  const record = latestBradContractAuthorizationForOpportunity(context.notes, opportunityId);
  const currentArtifactFacts = await currentGeneratedArtifactFacts(context);
  const authority = evaluateBradAuthorizationCurrency(record, context.preview, currentArtifactFacts);
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
