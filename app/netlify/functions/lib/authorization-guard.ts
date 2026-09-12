/**
 * Server-side Brad authorization currency check — B9-08 / INV-63, Jess
 * Gate correction round, 2026-09-12 ("the server must independently
 * verify... Brad/operator authorization exists; authorization applies to
 * this exact opportunity and contract revision/version; authorization
 * has not expired, been superseded, revoked, or already consumed").
 *
 * DELIBERATELY IMPORTS the real carrier/model functions from `src/lib`
 * rather than duplicating them — the SAME precedent
 * `ghl-contract-send-readback.ts` already established for
 * `classifyDocumentReadback` ("~80 lines of branching, evolving
 * classification logic -- duplicating it here would risk two copies
 * silently diverging"). `latestBradContractAuthorizationForOpportunity`
 * and `isSameContractVersion` are equally evolving, equally risky to
 * fork, and equally PURE (no I/O, no React) -- importing them is reading
 * evolving logic once, not a second write path.
 *
 * WHAT THIS DOES NOT CHECK, DISCLOSED, NOT HIDDEN. Full authorization
 * currency (`contract-authorization-model.ts`'s
 * `evaluateBradAuthorizationCurrency`) also compares the LIVE current
 * preview's full populated content against the content snapshotted at
 * authorization time (`CONTENT_CHANGED`) -- catching a material change
 * to a fact that does NOT bump `ContractVersionIdentity` (closing date,
 * earnest money, a signer, an addendum, attorney text --
 * `contract-authorization-model.ts`'s own header: "CONTENT-LEVEL
 * REVOCATION, NOT JUST VERSION-LEVEL"). Reproducing that check here
 * would require reconstructing the ENTIRE current `ContractDocumentPreview`
 * server-side -- ARV, comps, seller facts, every populated field -- an
 * enormous, disproportionate scope increase for a security-hardening
 * correction, and this codebase's own "do so narrowly" instruction for
 * this round governs. What THIS function verifies instead, exactly and
 * only: a Brad/operator authorization record exists, for the EXACT
 * `ContractVersionIdentity` being sent (closing REVISION_CHANGED and,
 * as a consequence of `latestBradContractAuthorizationForOpportunity`
 * always resolving to the newest record, effectively closing "an OLDER,
 * superseded-by-a-newer-authorization record was presented" too), by
 * the recognized authorizer, against the configured template identity.
 * A content-only change with no version bump AND no new authorization
 * remains a real, REPORTED gap -- exactly the kind of thing
 * `contract-authorization-model.ts`'s own review-screen UI exists to
 * surface to a human before authorizing, and exactly why this check is
 * repeated at BOTH the reservation and the send-execution boundary
 * (narrowing, not eliminating, the window between "Brad authorized" and
 * "the provider call actually fires").
 *
 * NOT AUTHENTICATED IDENTITY -- PRODUCT OWNER SINGLE-USER V1 RULING,
 * 2026-09-12. This function confirms that a GHL Note exists with the
 * exact expected SHAPE and CONTENT (author fields reading "brad",
 * matching revision, matching template) -- it does NOT confirm that a
 * real, authenticated Brad wrote it. `contact.notes` are written through
 * `ghl-proxy.ts`'s generic, unauthenticated `POST /contacts/{id}/notes`
 * path; nothing in this application binds "brad" to a login, session,
 * or credential of any kind. Brad has accepted this as a named residual
 * risk for single-user V1, where he is presently the only operator with
 * access to the deployed application at all -- IAOS V1 does NOT add
 * authentication, and this check must never be described as
 * "authenticated" or "cryptographically verified" authorization. It is
 * accurately described only as: a same-shape, same-content GHL Note
 * check. Authentication is a REQUIRED, NOT YET BUILT gate before
 * multi-user access, automation, or commercial customer use -- see
 * `ghl-contract-send-reserve.ts`'s own "FUTURE PRODUCTION GATE" note.
 */

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
  if (record.templateName !== args.expectedTemplateName) {
    return { ok: false, reason: "TEMPLATE_CHANGED", message: "The recorded authorization's template does not match the configured template." };
  }
  return { ok: true };
}
