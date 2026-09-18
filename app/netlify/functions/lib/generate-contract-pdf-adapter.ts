/**
 * Board #9 Phase B -- runtime callable adapter, INV-67 / B9-12.
 *
 * The smallest server-side seam between the application's canonical
 * contract-facts computation and the Phase A live-data PDF generator.
 * Accepts already-computed canonical facts (a `ContractDocumentPreview`,
 * `SellerContractFactsReport`, and `SellerSigningReadinessResult` -- the
 * SAME three pure-model inputs `buildContractProjectionPlan` has always
 * required), runs the ONE canonical projection function against them, and
 * hands the result straight to the ONE canonical generator. Returns PDF
 * bytes plus the generator's own deterministic evidence record (source
 * hash, generator version, manifest version, populated-field count).
 *
 * DELIBERATELY DOES NOT FETCH ANYTHING. No GHL call, no `GhlBoundary`, no
 * `requireAppWriter`, no authentication or write-boundary code of any
 * kind -- this file imports nothing from PR #78's write-boundary work.
 * Assembling live canonical facts from a real GHL opportunity (step 1 of
 * the Board #9 Phase B integration design) remains a SEPARATE, later
 * concern, explicitly out of this slice's scope; this adapter's entire
 * job starts one step downstream of that, with facts the caller already
 * has in hand -- exactly matching how `buildContractProjectionPlan`
 * itself has always been called.
 *
 * REUSE, NEVER REIMPLEMENTATION: `buildContractProjectionPlan`
 * (contract-ghl-projection-model.ts, unmodified) and
 * `generatePopulatedContractPdf` (inv67-pdf-generator.cjs, unmodified
 * except for its Phase B runtime-cache swap, itself verified equivalent
 * by test-inv67-pdf-geometry-cache.cjs) are the ONLY two functions this
 * file calls. No projection logic, no PDF logic, and no evidence-shape
 * logic is duplicated here.
 *
 * FAILS CLOSED on an incomplete projection plan, BEFORE ever reaching the
 * generator -- `buildContractProjectionPlan`'s own `ok`/`blockingReasons`
 * are surfaced directly, never swallowed or reinterpreted.
 */

import { buildContractProjectionPlan, type ContractProjectionPlan } from "../../../src/lib/contract-ghl-projection-model";
import type { ContractDocumentPreview } from "../../../src/lib/contract-document-model";
import type { SellerContractFactsReport } from "../../../src/lib/contract-facts-model";
import type { SellerSigningReadinessResult } from "../../../src/lib/contract-seller-signing-model";

// require(), not import -- this is a CommonJS module (app/scripts/lib/),
// exactly the interop pattern the Board #9 Phase B packaging proof already
// confirmed esbuild bundles and traces cleanly from a Netlify Function
// location outside that directory.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generatePopulatedContractPdf } = require("../../../scripts/lib/inv67-pdf-generator.cjs") as {
  generatePopulatedContractPdf: (args: { projectionPlan: ContractProjectionPlan; opportunityId?: string }) => Promise<{ outputBytes: Uint8Array; evidence: Record<string, unknown> }>;
};

export class ContractPdfAdapterError extends Error {
  constructor(message: string, public readonly reasons: unknown[] = []) {
    super(message);
    this.name = "ContractPdfAdapterError";
  }
}

export type GenerateContractPdfFromCanonicalFactsArgs = {
  opportunityId: string;
  preview: ContractDocumentPreview;
  report: SellerContractFactsReport;
  sellerReadiness: SellerSigningReadinessResult;
};

export type GenerateContractPdfFromCanonicalFactsResult = {
  outputBytes: Uint8Array;
  evidence: Record<string, unknown>;
  projectionPlan: ContractProjectionPlan;
};

/**
 * Accepts canonical contract facts, runs the canonical projection, and
 * generates the pinned TREC 20-19 PDF. Fails closed (throws
 * `ContractPdfAdapterError`) on an incomplete projection plan or any
 * error the generator itself raises (deferred rows, malformed entries,
 * duplicate keys -- see inv67-pdf-generator.cjs's own fail-closed
 * contract, unchanged and reused here).
 */
export async function generateContractPdfFromCanonicalFacts(
  args: GenerateContractPdfFromCanonicalFactsArgs,
): Promise<GenerateContractPdfFromCanonicalFactsResult> {
  const projectionPlan = buildContractProjectionPlan(args.opportunityId, args.preview, args.report, args.sellerReadiness);
  if (!projectionPlan.ok) {
    throw new ContractPdfAdapterError(
      "Cannot generate: canonical facts do not yet produce a complete contract projection.",
      projectionPlan.blockingReasons,
    );
  }
  const { outputBytes, evidence } = await generatePopulatedContractPdf({
    projectionPlan,
    opportunityId: args.opportunityId,
  });
  return { outputBytes, evidence, projectionPlan };
}
