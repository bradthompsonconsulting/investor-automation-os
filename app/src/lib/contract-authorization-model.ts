/**
 * Brad contract review and explicit send-authorization gate. B9-07 / INV-62.
 *
 * Pure. No I/O, no React, no writes. Consumes `contract-document-model.ts`'s
 * `ContractDocumentPreview` (B9-06/INV-61, already shipped) and
 * `board9-contract-model.ts`'s `ContractVersionIdentity`/
 * `isSameContractVersion` (B9-03/INV-58, already shipped) directly --
 * REUSED, never reimplemented.
 *
 * `previewComplete` IS NOT AUTHORIZATION (locked requirement, this issue).
 * `previewComplete` (B9-06) means only that the populated preview is
 * complete. Brad authorization is a SEPARATE, EXPLICIT fact that only
 * Brad's own recorded action can create -- generating, previewing, or an
 * ordinary per-field Save action never authorizes anything, no matter how
 * complete the resulting preview becomes. `BradAuthorized` below
 * (`evaluateBradAuthorizationCurrency(...).authorized`) is a DERIVED
 * result, recomputed fresh every time from the latest authorization
 * record and the LIVE current preview -- never a persisted flag this
 * module merely reads back -- exactly mirroring how Contract Ready is
 * already a derived result in `board9-contract-model.ts`.
 *
 * NO SECOND VERSION SCHEME. Reuses `ContractVersionIdentity`/
 * `isSameContractVersion` verbatim for "is this the exact reviewed
 * revision" -- the SAME check `evaluateContractSentEligibility` already
 * applies to `bradSendAuthorization.authorizedVersion`. This module does
 * not call that function directly: it also requires
 * `providerTransmission`/`expiration` facts that are squarely out of this
 * issue's scope (e-sign sending, B9-08's job) -- so this module
 * implements only the authorization-currency sub-question that function
 * will eventually also need, using the exact same reusable primitive,
 * never a second, divergent version-equality implementation.
 *
 * CONTENT-LEVEL REVOCATION, NOT JUST VERSION-LEVEL. `ContractVersionIdentity`
 * only changes on a locked Correction (price/property/parties) --
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own bright-line test. A material
 * change to any OTHER contract fact (closing date, earnest money, a
 * signer, an addendum selection, an attorney-provided text...) does not
 * bump it, yet this issue's own locked rule requires such a change to
 * revoke prior authorization too ("any material fact, contract term,
 * signer, delivery detail... change revokes prior authorization"). This
 * module therefore ALSO snapshots and compares the full populated content
 * -- every `ContractDocumentLine`'s `group`/`field`/`status`/`text` -- at
 * authorization time against the live current preview. A version match is
 * necessary but not sufficient.
 *
 * TEMPLATE IDENTITY PARTICIPATES IN CURRENCY (Jess Gate correction, this
 * issue). `templateName`/`templateSource` are compared independently of
 * version and content -- a mismatch on either revokes authorization with
 * its own explicit `TEMPLATE_CHANGED` reason, never silently folded into
 * `CONTENT_CHANGED` or left uncompared. Today `contract-document-model.ts`
 * emits these as fixed constants (`CONTRACT_DOCUMENT_TEMPLATE_NAME`/
 * `_SOURCE`), so this check cannot currently fire in practice -- it exists
 * so a future change to which template is authoritative can never silently
 * carry forward an authorization recorded against a different one.
 *
 * BRAD RECORDED CONSISTENTLY AS BOTH FIELDS (Jess Gate correction, this
 * issue). Every carrier note in this codebase already carries a generic
 * `operator` provenance field, distinct from any domain-specific actor
 * field -- previously `operator` was a caller-supplied, nullable value
 * even for a Brad-only action, which could produce a record claiming
 * `authorizedBy: "brad"` while `operator` was `null` or someone else.
 * `buildAuthorizationRecordArgs` no longer accepts `operator` from the
 * caller at all -- it is hardcoded to the literal `"brad"` internally,
 * exactly like `authorizedBy` already was, so the two fields can never
 * disagree in anything this module itself produces. `evaluateBrad
 * AuthorizationCurrency` ALSO fails closed on any record -- however it
 * was produced, including a hand-crafted or historical one -- whose
 * `operator` is not exactly `"brad"`, independently of the existing
 * `authorizedBy` check, so a record that identifies Brad inconsistently
 * across the two fields is never treated as current.
 *
 * FAIL CLOSED, EVERYWHERE. No authorization record, an unrecognized
 * authorizer (in either field), a changed template, a changed revision,
 * changed content, or an incomplete current preview -- each independently
 * and explicitly named, never collapsed into a bare boolean, exactly
 * mirroring every other B9 `evaluate*` function's own
 * `TransitionReason`-shaped discipline.
 *
 * ARTIFACT BINDING (Board #9 Phase B, 2026-09-18; corrected same-day --
 * see FAIL-CLOSED CORRECTION below). `contract-authorization-carriers.ts`'s
 * schema v2 adds `artifactSha256`/`sourcePdfSha256`/`generatorVersion`/
 * `manifestVersion` to every record this module builds -- REQUIRED at
 * build time (`buildAuthorizationRecordArgs`'s `artifact` argument, itself
 * shape-validated before anything is built) so a v2 record can never omit
 * them. `evaluateBradAuthorizationCurrency` takes a REQUIRED third
 * argument, `currentArtifactFacts`, comparing the record's own four
 * artifact fields against the caller's freshest known ones and producing
 * `ARTIFACT_CHANGED`/`SOURCE_PDF_CHANGED`/`GENERATOR_CHANGED`/
 * `MANIFEST_CHANGED` on any mismatch. This module never computes or
 * fetches those "current" values itself (no I/O, per this file's own
 * discipline) -- the caller (a future generation endpoint or UI) supplies
 * them, exactly like `currentVersion` already works for
 * `evaluateAuthorizationEligibility`.
 *
 * FAIL-CLOSED CORRECTION (same day). An earlier pass of this function made
 * `currentArtifactFacts` OPTIONAL, so a caller who simply omitted it still
 * got a real `authorized: true` result based on content/version/template
 * alone -- a real gap: nothing forced a v2, artifact-bound authorization
 * to actually be checked against a specific artifact before being reported
 * current. Corrected: the parameter is required, and even a malformed or
 * `undefined` value at runtime (a non-TypeScript caller, or a bug) is
 * shape-validated (`artifactFactsShapeReasons`, shared with
 * `buildAuthorizationRecordArgs`'s own build-time check) and fails closed
 * with `ARTIFACT_FACTS_INVALID` rather than silently skipping the artifact
 * checks -- there is no code path in this function that reaches
 * `authorized: true` without `currentArtifactFacts` having been validated
 * and matched. This intentionally breaks every 2-argument call site that
 * predates this correction (`contract-send-model.ts`,
 * `ContractWorkspace.tsx`) -- expected and accepted; those callers are
 * updated together in a later integration slice, not patched around here.
 *
 * A v1-shaped record can never satisfy currency for a generated PDF --
 * not via a runtime special case here, but structurally: `contract-
 * authorization-carriers.ts`'s CURRENT-schema parser
 * (`parseBradContractAuthorizationNote`) does not recognize a v1 note's
 * header at all, so `latestBradContractAuthorizationForOpportunity` never
 * returns one, and this function never even sees a v1-shaped `record` to
 * evaluate.
 */

import {
  type ContractVersionIdentity,
  isSameContractVersion,
} from "./board9-contract-model";
import {
  type ContractDocumentPreview,
  type ContractDocumentLine,
  isContractDocumentPreviewStale,
} from "./contract-document-model";
import type {
  AuthorizedLineSnapshot,
  ParsedBradContractAuthorization,
} from "./contract-authorization-carriers";

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

function isNonEmptySha256(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/**
 * Shape-only validation shared by BOTH `evaluateBradAuthorizationCurrency`
 * (is the CALLER-supplied "current" bundle even usable to compare against)
 * and `buildAuthorizationRecordArgs` (is the bundle being PERSISTED
 * well-formed) -- one check, never two divergent copies. Never verifies a
 * hash is ACTUALLY correct for any bytes -- this module has no I/O and
 * never will; that belongs to whichever server-side caller independently
 * regenerates and compares before accepting a write.
 */
function artifactFactsShapeReasons(artifact: CurrentArtifactFacts | null | undefined): BradAuthorizationReason[] {
  if (!artifact || typeof artifact !== "object") {
    return [{ code: "ARTIFACT_FACTS_INVALID", message: "No generated-artifact evidence was supplied." }];
  }
  const reasons: BradAuthorizationReason[] = [];
  if (!isNonEmptySha256(artifact.artifactSha256)) {
    reasons.push({ code: "ARTIFACT_FACTS_INVALID", message: "The supplied artifact SHA-256 is missing or malformed." });
  }
  if (!isNonEmptySha256(artifact.sourcePdfSha256)) {
    reasons.push({ code: "ARTIFACT_FACTS_INVALID", message: "The supplied source-PDF SHA-256 is missing or malformed." });
  }
  if (typeof artifact.generatorVersion !== "string" || artifact.generatorVersion === "") {
    reasons.push({ code: "ARTIFACT_FACTS_INVALID", message: "The supplied generator version is missing." });
  }
  if (typeof artifact.manifestVersion !== "string" || artifact.manifestVersion === "") {
    reasons.push({ code: "ARTIFACT_FACTS_INVALID", message: "The supplied manifest version is missing." });
  }
  return reasons;
}

function toSnapshotLine(l: ContractDocumentLine): AuthorizedLineSnapshot {
  return { group: l.group, field: l.field, status: l.status, text: l.text };
}

export type AuthorizedContentSnapshot = {
  documentLines: AuthorizedLineSnapshot[];
  additionalRequiredFacts: AuthorizedLineSnapshot[];
};

/** The exact content a future authorization record would snapshot, or that an existing one is compared against -- built fresh from the live preview every time, never cached. */
export function buildAuthorizedContentSnapshot(preview: ContractDocumentPreview): AuthorizedContentSnapshot {
  return {
    documentLines: preview.documentLines.map(toSnapshotLine),
    additionalRequiredFacts: preview.additionalRequiredFacts.map(toSnapshotLine),
  };
}

function snapshotLinesEqual(a: AuthorizedLineSnapshot[], b: AuthorizedLineSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].group !== b[i].group || a[i].field !== b[i].field || a[i].status !== b[i].status || a[i].text !== b[i].text) return false;
  }
  return true;
}

export type SnapshotDifference = {
  group: string;
  field: string;
  /** `null` when this field did not exist in the prior (authorized) snapshot. */
  previous: { status: string; text: string | null } | null;
  /** `null` when this field no longer exists in the current snapshot. */
  current: { status: string; text: string | null } | null;
};

function diffSnapshotLines(previous: AuthorizedLineSnapshot[], current: AuthorizedLineSnapshot[]): SnapshotDifference[] {
  const key = (l: { group: string; field: string }) => `${l.group}.${l.field}`;
  const prevMap = new Map(previous.map((l) => [key(l), l]));
  const currMap = new Map(current.map((l) => [key(l), l]));
  const allKeys = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  const diffs: SnapshotDifference[] = [];
  for (const k of allKeys) {
    const p = prevMap.get(k) ?? null;
    const c = currMap.get(k) ?? null;
    const same = p !== null && c !== null && p.status === c.status && p.text === c.text;
    if (same) continue;
    const identity = (c ?? p)!;
    diffs.push({
      group: identity.group,
      field: identity.field,
      previous: p ? { status: p.status, text: p.text } : null,
      current: c ? { status: c.status, text: c.text } : null,
    });
  }
  return diffs;
}

/**
 * Differences between the LAST Brad-authorized revision (if any) and the
 * live current preview -- one of this issue's own required review-screen
 * display items ("differences from the last Brad-reviewed revision").
 * `null` when no authorization has ever been recorded for this
 * opportunity (nothing to diff against); an EMPTY array when one exists
 * and nothing has changed.
 */
export function computeDifferencesFromLastAuthorized(
  record: ParsedBradContractAuthorization | null,
  currentPreview: ContractDocumentPreview,
): SnapshotDifference[] | null {
  if (!record) return null;
  const current = buildAuthorizedContentSnapshot(currentPreview);
  return [
    ...diffSnapshotLines(record.documentLines, current.documentLines),
    ...diffSnapshotLines(record.additionalRequiredFacts, current.additionalRequiredFacts),
  ];
}

export type BradAuthorizationReasonCode =
  | "NO_AUTHORIZATION_RECORDED"
  | "NOT_BRAD"
  | "OPERATOR_NOT_BRAD"
  | "AUTHORIZATION_TIMESTAMP_INVALID"
  | "TEMPLATE_CHANGED"
  | "REVISION_CHANGED"
  | "CONTENT_CHANGED"
  | "PREVIEW_NOT_COMPLETE"
  | "PREVIEW_STALE"
  | "ARTIFACT_CHANGED"
  | "SOURCE_PDF_CHANGED"
  | "GENERATOR_CHANGED"
  | "MANIFEST_CHANGED"
  | "ARTIFACT_FACTS_INVALID";

/**
 * The artifact facts a caller compares an authorization record against --
 * either "what this generation run just reported" (evidence from
 * `generatePopulatedContractPdf`) when building a NEW record, or "what we
 * currently know to be pinned/authoritative, plus a candidate artifact's
 * own hash" when checking an EXISTING record's currency. Same shape for
 * both uses, deliberately -- one type, never a second divergent one.
 */
export type CurrentArtifactFacts = {
  artifactSha256: string;
  sourcePdfSha256: string;
  generatorVersion: string;
  manifestVersion: string;
};

export type BradAuthorizationReason = { code: BradAuthorizationReasonCode; message: string };

export type BradAuthorizationStatus =
  | { authorized: true; record: ParsedBradContractAuthorization }
  | { authorized: false; record: ParsedBradContractAuthorization | null; reasons: BradAuthorizationReason[] };

/**
 * `BradAuthorized` (locked requirement) is exactly `.authorized` on this
 * result -- a DERIVED value, recomputed fresh from the latest
 * authorization record and the LIVE current preview every time this is
 * called, never a value read back from a persisted flag. See module
 * header.
 */
export function evaluateBradAuthorizationCurrency(
  record: ParsedBradContractAuthorization | null,
  currentPreview: ContractDocumentPreview,
  currentArtifactFacts: CurrentArtifactFacts,
): BradAuthorizationStatus {
  if (!record) {
    return {
      authorized: false,
      record: null,
      reasons: [{ code: "NO_AUTHORIZATION_RECORDED", message: "No Brad authorization has been recorded for this agreement." }],
    };
  }

  const reasons: BradAuthorizationReason[] = [];
  if (record.authorizedBy !== "brad") {
    reasons.push({ code: "NOT_BRAD", message: "The recorded authorization was not made by Brad -- V1 permits no other authorizer." });
  }
  if (record.operator !== "brad") {
    reasons.push({ code: "OPERATOR_NOT_BRAD", message: "The recorded operator does not identify Brad consistently with the authorization -- V1 requires both fields to agree." });
  }
  if (!isValidIsoInstant(record.at)) {
    reasons.push({ code: "AUTHORIZATION_TIMESTAMP_INVALID", message: "The recorded authorization does not carry a valid timestamp." });
  }
  if (record.templateName !== currentPreview.templateName || record.templateSource !== currentPreview.templateSource) {
    reasons.push({
      code: "TEMPLATE_CHANGED",
      message: "The authoritative template has changed since this authorization was recorded -- it no longer covers the current template.",
    });
  }

  if (!isSameContractVersion(record.version as ContractVersionIdentity, currentPreview.version)) {
    reasons.push({
      code: "REVISION_CHANGED",
      message: "The document revision has changed since this authorization was recorded -- it no longer covers the current revision.",
    });
  } else {
    const current = buildAuthorizedContentSnapshot(currentPreview);
    const contentUnchanged =
      snapshotLinesEqual(record.documentLines, current.documentLines) &&
      snapshotLinesEqual(record.additionalRequiredFacts, current.additionalRequiredFacts);
    if (!contentUnchanged) {
      reasons.push({
        code: "CONTENT_CHANGED",
        message: "A material contract fact has changed since this authorization was recorded -- it no longer covers the current content.",
      });
    }
  }

  if (!currentPreview.previewComplete) {
    reasons.push({
      code: "PREVIEW_NOT_COMPLETE",
      message: "The current preview is not complete -- an incomplete document can never remain authorized.",
    });
  }

  // FAILS CLOSED: currentArtifactFacts is REQUIRED, not optional, for a v2
  // record. A caller cannot obtain `authorized: true` by omitting it, or by
  // supplying a malformed bundle -- there is no code path here that skips
  // straight to the final return without this check having run. Only when
  // the bundle is well-formed do the four comparisons even attempt to run;
  // a malformed bundle has nothing meaningful to compare against, so it
  // reports ARTIFACT_FACTS_INVALID alone rather than also guessing at
  // spurious ARTIFACT_CHANGED-style mismatches.
  const artifactShapeReasons = artifactFactsShapeReasons(currentArtifactFacts);
  reasons.push(...artifactShapeReasons);
  if (artifactShapeReasons.length === 0) {
    if (record.artifactSha256 !== currentArtifactFacts.artifactSha256) {
      reasons.push({ code: "ARTIFACT_CHANGED", message: "The authorized artifact's own hash no longer matches the artifact currently in view -- it no longer covers these exact bytes." });
    }
    if (record.sourcePdfSha256 !== currentArtifactFacts.sourcePdfSha256) {
      reasons.push({ code: "SOURCE_PDF_CHANGED", message: "The canonical source PDF has changed since this authorization was recorded." });
    }
    if (record.generatorVersion !== currentArtifactFacts.generatorVersion) {
      reasons.push({ code: "GENERATOR_CHANGED", message: "The PDF generator has changed since this authorization was recorded -- it no longer covers output from the current generator." });
    }
    if (record.manifestVersion !== currentArtifactFacts.manifestVersion) {
      reasons.push({ code: "MANIFEST_CHANGED", message: "The placement manifest has changed since this authorization was recorded -- it no longer covers output from the current manifest." });
    }
  }

  return reasons.length === 0 ? { authorized: true, record } : { authorized: false, record, reasons };
}

export type AuthorizationEligibility = { eligible: true } | { eligible: false; reasons: BradAuthorizationReason[] };

/**
 * Gate on CREATING a new authorization record -- called before any caller
 * ever writes one. An incomplete preview can never be authorized, full
 * stop; the caller's UI should also surface `preview.blockingReasons` for
 * the itemized list (already computed by B9-06, not re-derived here).
 *
 * `currentVersion` is supplied independently of `preview.version` (the
 * caller's own freshest known revision identity, e.g. read directly
 * alongside the preview) so a genuinely STALE preview -- one built
 * earlier, before the underlying agreement was superseded, that may still
 * read as `previewComplete: true` on its own stale terms -- cannot be
 * authorized just because it looks complete. Reuses
 * `isContractDocumentPreviewStale` verbatim (B9-06) rather than a second
 * staleness check.
 */
export function evaluateAuthorizationEligibility(
  preview: ContractDocumentPreview,
  currentVersion: ContractVersionIdentity,
): AuthorizationEligibility {
  const reasons: BradAuthorizationReason[] = [];
  if (isContractDocumentPreviewStale(preview, currentVersion)) {
    reasons.push({ code: "PREVIEW_STALE", message: "This preview no longer reflects the current document revision -- refresh it before authorizing." });
  }
  if (!preview.previewComplete) {
    reasons.push({ code: "PREVIEW_NOT_COMPLETE", message: "The current preview is not complete -- resolve every blocking reason before authorizing." });
  }
  return reasons.length === 0 ? { eligible: true } : { eligible: false, reasons };
}

export type BuildAuthorizationRecordArgs = {
  opportunityId: string;
  at: string;
  preview: ContractDocumentPreview;
  /** The caller's own freshest known revision identity -- see `evaluateAuthorizationEligibility`'s own doc comment. */
  currentVersion: ContractVersionIdentity;
  /** The exact generated artifact this authorization binds to -- REQUIRED, per Board #9 Phase B. See module header's "ARTIFACT BINDING" note. */
  artifact: CurrentArtifactFacts;
};

export type AuthorizationRecordToPersist = {
  opportunityId: string;
  at: string;
  operator: "brad";
  authorizedBy: "brad";
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  documentLines: AuthorizedLineSnapshot[];
  additionalRequiredFacts: AuthorizedLineSnapshot[];
  artifactSha256: string;
  sourcePdfSha256: string;
  generatorVersion: string;
  manifestVersion: string;
};

/**
 * Builds the exact args a caller passes to
 * `formatBradContractAuthorizationNote` -- the ONLY place `authorizedBy`
 * AND `operator` are asserted as the literal `"brad"` (Jess Gate
 * correction: `operator` is no longer a caller-supplied field at all --
 * there is no parameter through which a caller could ever produce a
 * record claiming Brad authorized it while `operator` is `null` or
 * anyone else). Never assumed from context, matching every other
 * Brad-only action in this codebase, e.g. Rescission. Re-checks
 * eligibility itself rather than trusting a caller who might have skipped
 * `evaluateAuthorizationEligibility` -- fails closed either way. Also
 * fails closed on missing/malformed artifact evidence (Board #9 Phase B)
 * -- a v2 record can never be built without real generation evidence.
 */
export function buildAuthorizationRecordArgs(
  args: BuildAuthorizationRecordArgs,
): { ok: true; value: AuthorizationRecordToPersist } | { ok: false; reasons: BradAuthorizationReason[] } {
  const eligibility = evaluateAuthorizationEligibility(args.preview, args.currentVersion);
  const artifactReasons = artifactFactsShapeReasons(args.artifact);
  const reasons = [...(eligibility.eligible ? [] : eligibility.reasons), ...artifactReasons];
  if (reasons.length > 0) return { ok: false, reasons };
  const snapshot = buildAuthorizedContentSnapshot(args.preview);
  return {
    ok: true,
    value: {
      opportunityId: args.opportunityId,
      at: args.at,
      operator: "brad",
      authorizedBy: "brad",
      version: args.preview.version,
      templateName: args.preview.templateName,
      templateSource: args.preview.templateSource,
      documentLines: snapshot.documentLines,
      additionalRequiredFacts: snapshot.additionalRequiredFacts,
      artifactSha256: args.artifact.artifactSha256,
      sourcePdfSha256: args.artifact.sourcePdfSha256,
      generatorVersion: args.artifact.generatorVersion,
      manifestVersion: args.artifact.manifestVersion,
    },
  };
}
