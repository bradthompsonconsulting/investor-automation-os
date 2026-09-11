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
 * -- every `ContractDocumentLine`'s `group`/`field`/`status`/`text`, plus
 * template identity -- at authorization time against the live current
 * preview. A version match is necessary but not sufficient.
 *
 * FAIL CLOSED, EVERYWHERE. No authorization record, an unrecognized
 * authorizer, a changed revision, changed content, or an incomplete
 * current preview -- each independently and explicitly named, never
 * collapsed into a bare boolean, exactly mirroring every other B9
 * `evaluate*` function's own `TransitionReason`-shaped discipline.
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
  | "AUTHORIZATION_TIMESTAMP_INVALID"
  | "REVISION_CHANGED"
  | "CONTENT_CHANGED"
  | "PREVIEW_NOT_COMPLETE"
  | "PREVIEW_STALE";

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
  if (!isValidIsoInstant(record.at)) {
    reasons.push({ code: "AUTHORIZATION_TIMESTAMP_INVALID", message: "The recorded authorization does not carry a valid timestamp." });
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
  operator: string | null;
  preview: ContractDocumentPreview;
  /** The caller's own freshest known revision identity -- see `evaluateAuthorizationEligibility`'s own doc comment. */
  currentVersion: ContractVersionIdentity;
};

export type AuthorizationRecordToPersist = {
  opportunityId: string;
  at: string;
  operator: string | null;
  authorizedBy: "brad";
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  documentLines: AuthorizedLineSnapshot[];
  additionalRequiredFacts: AuthorizedLineSnapshot[];
};

/**
 * Builds the exact args a caller passes to
 * `formatBradContractAuthorizationNote` -- the ONLY place `authorizedBy`
 * is asserted as the literal `"brad"` (never assumed from context, never
 * a caller-supplied value, matching every other Brad-only action in this
 * codebase, e.g. Rescission). Re-checks eligibility itself rather than
 * trusting a caller who might have skipped `evaluateAuthorizationEligibility`
 * -- fails closed either way.
 */
export function buildAuthorizationRecordArgs(
  args: BuildAuthorizationRecordArgs,
): { ok: true; value: AuthorizationRecordToPersist } | { ok: false; reasons: BradAuthorizationReason[] } {
  const eligibility = evaluateAuthorizationEligibility(args.preview, args.currentVersion);
  if (!eligibility.eligible) return { ok: false, reasons: eligibility.reasons };
  const snapshot = buildAuthorizedContentSnapshot(args.preview);
  return {
    ok: true,
    value: {
      opportunityId: args.opportunityId,
      at: args.at,
      operator: args.operator,
      authorizedBy: "brad",
      version: args.preview.version,
      templateName: args.preview.templateName,
      templateSource: args.preview.templateSource,
      documentLines: snapshot.documentLines,
      additionalRequiredFacts: snapshot.additionalRequiredFacts,
    },
  };
}
