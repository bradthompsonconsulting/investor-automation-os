/** INV-95: identity/version check. Callers also authenticate Brad and recompute full content currency.
 * Brad approved the explicit canonical TREC -> configured Test GHL template binding.
 * The request template ID and all Test-only gates remain independently enforced. */
import { latestBradContractAuthorizationForOpportunity } from "../../../src/lib/contract-authorization-carriers";
import { isSameContractVersion, type ContractVersionIdentity } from "../../../src/lib/board9-contract-model";

/**
 * Small, stable, rarely-changing shape -- duplicated (never imported)
 * matching `contract-send-guard.ts`'s own "small and stable is
 * duplicated, large and evolving is imported" split (see that file's own
 * header; `classifyDocumentReadback` above is the "evolving" side of
 * that same split). Mirrors `contract-send-carriers.ts`'s own
 * `parseVersionJson` exactly.
 */
function parseVersionRaw(raw: string): ContractVersionIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.agreementAt !== "string") return null;
  if (typeof v.versionSeq !== "number" || !Number.isInteger(v.versionSeq) || v.versionSeq < 1) return null;
  if (v.supersedesVersionSeq !== null && (typeof v.supersedesVersionSeq !== "number" || !Number.isInteger(v.supersedesVersionSeq))) return null;
  if (v.replacesAgreementAt !== null && typeof v.replacesAgreementAt !== "string") return null;
  return {
    agreementAt: v.agreementAt,
    versionSeq: v.versionSeq,
    supersedesVersionSeq: v.supersedesVersionSeq as number | null,
    replacesAgreementAt: v.replacesAgreementAt as string | null,
  };
}

export type AuthorizationNoteCheck =
  | { ok: true }
  | { ok: false; reason: string; message: string };

export function verifyAuthorizationNoteCurrency(args: {
  notes: { body: string }[];
  opportunityId: string;
  /** The raw JSON version string the caller declared -- parsed HERE, never trusted pre-parsed, so a malformed/tampered string fails closed rather than being coerced by a caller-side parse. */
  declaredVersionRaw: string;
  expectedTemplateName: string;
  expectedTemplateSource?: string;
}): AuthorizationNoteCheck {
  const declaredVersion = parseVersionRaw(args.declaredVersionRaw);
  if (!declaredVersion) {
    return { ok: false, reason: "DECLARED_VERSION_MALFORMED", message: "The declared version identity is not well-formed JSON matching ContractVersionIdentity." };
  }
  const record = latestBradContractAuthorizationForOpportunity(args.notes, args.opportunityId);
  if (!record) {
    return { ok: false, reason: "NO_AUTHORIZATION_RECORDED", message: "No Brad authorization is recorded for this opportunity." };
  }
  if (record.authorizedBy !== "brad") {
    return { ok: false, reason: "NOT_BRAD", message: "The recorded authorization was not made by Brad." };
  }
  if (record.operator !== "brad") {
    return { ok: false, reason: "OPERATOR_NOT_BRAD", message: "The recorded operator does not identify Brad consistently with the authorization." };
  }
  if (!isSameContractVersion(record.version as ContractVersionIdentity, declaredVersion)) {
    return { ok: false, reason: "REVISION_CHANGED_OR_SUPERSEDED", message: "The latest recorded authorization does not cover the exact revision being sent -- it has changed or been superseded." };
  }
  if (record.templateName !== args.expectedTemplateName || (args.expectedTemplateSource !== undefined && record.templateSource !== args.expectedTemplateSource)) {
    return { ok: false, reason: "TEMPLATE_CHANGED", message: "The recorded authorization's template does not match the configured template." };
  }
  return { ok: true };
}
