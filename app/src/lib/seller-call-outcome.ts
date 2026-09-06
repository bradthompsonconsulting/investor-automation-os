/**
 * Seller Call resume + bounded call outcomes. B8-10 / INV-53.
 *
 * Pure. No I/O, no React, no GHL identifiers. This module creates NO new
 * persistence carrier: `formatOutcomeNote` writes a structured note body
 * through the EXISTING, already-sanctioned `ghl.notes.create()` write --
 * one of AGENTS.md's "three sanctioned writes, and no fourth" -- and
 * `parseOutcomeNote`/`latestOutcomeNoteForOpportunity` read it back
 * through the EXISTING, already-used `ghl.notes.list()` read. This is the
 * exact pattern `arv-persist.ts`/`arv-approval-note.ts` already
 * established and shipped for Board #7's ARV approval ledger: a
 * structured, versioned note IS an authoritative existing mechanism
 * (GHL notes are real system-of-record objects, not a shadow copy), not
 * a new carrier, and reusing that proven shape here is deliberate.
 *
 * THE THREE BOUNDED OUTCOMES ARE NOT INVENTED. `docs/SELLER_ACQUISITION_
 * WORKFLOW.md`'s own master flow names them verbatim: "...NEGOTIATE
 * AGAINST FIXED MAO -> ACCEPT / FOLLOW-UP / PASS -> CONTRACT READINESS
 * -> NEXT ACTION." `CallOutcomeKind` below is exactly those three words,
 * nothing added.
 *
 * WHY NOT BOARD 4's DispositionControl / `iaos_call_disposition`.
 * `DispositionControl.tsx`'s six dispositions ("No Answer", "Voicemail",
 * "Follow Up", "Requested Appointment", "Not Interested", "Incorrect
 * Number") are COLD-OUTREACH qualification outcomes, wired to
 * `iaos_call_disposition`/`iaos_call_routing`/`iaos_disposition_at` and
 * Board 4's own S7 sequence triggers -- "Requested Appointment" alone
 * enrolls the contact in a live sequence. Writing those exact field
 * values from a NEGOTIATION-stage Seller Call, for an unrelated meaning
 * ("the seller accepted our offer" is not "Requested Appointment"),
 * would risk firing a Board 4 automation this issue has no business
 * touching -- AGENTS.md's "IAOS never fires a workflow" HARD NO applies
 * regardless of which write class is used. This module writes to none of
 * those three fields; it only ever calls `ghl.notes.create`,
 * `ghl.contacts.setCallbackDatetime` (via the EXISTING, unmodified
 * `scheduleCallbackGated` in `callbackWrite.ts`, for `follow_up` only),
 * and `ghl.contacts.setLastCallAttempt` -- the same three sanctioned
 * writes, never a fourth, never repurposing a Board-4-specific one.
 *
 * ACCEPTED PRICE IS THE EXISTING CURRENT OFFER, NEVER A NEW FIELD. "The
 * seller accepted our offer" means the seller accepted whatever
 * `currentOffer` (B8-08 / INV-51's own session state) currently holds --
 * this module takes it as a plain parameter, reusing the existing
 * negotiation value rather than asking for a second, competing "accepted
 * price" input.
 *
 * DURABLE PERSISTENCE GAP, DOCUMENTED FOR INV-54 (B8-11), NOT PAPERED
 * OVER. A GHL note is a real, durable, resumable record (this module's
 * own `latestOutcomeNoteForOpportunity` proves it can be read back
 * accurately), but it is NOT a queryable, pipeline-reportable field --
 * there is no way to filter "show me every Agreement Reached deal" across
 * the whole pipeline without reading every contact's notes individually.
 * That gap is real, is not this issue's to close (no new carrier is
 * authorized here), and is exactly what INV-54's own scope already names.
 */

export type CallOutcomeKind = "accept" | "follow_up" | "pass";

/**
 * The negotiation/economics facts captured AT THE MOMENT of the outcome --
 * copied verbatim from whatever the caller already computed (B8-03's
 * `Board8Economics`/`ExpectedSpread`, B8-04's `ReadinessResult`, B8-08's
 * session negotiation state). This module recomputes NONE of them; a
 * `null` field means that figure was itself unavailable at the moment of
 * the outcome (e.g. Target uncalculated), not a parsing failure.
 */
export type OutcomeSnapshot = {
  sellerPosition: number | null;
  currentOffer: number | null;
  targetAcquisitionPrice: number | null;
  maxSupportedOffer: number | null;
  expectedSpread: number | null;
  arv: number | null;
  repairs: number | null;
  readinessStatus: "NOT_READY" | "REVIEW_NEEDED" | "OFFER_READY";
};

export type ParsedOutcomeNote = {
  opportunityId: string;
  kind: CallOutcomeKind;
  at: string;
  /** `null` when no authenticated operator identity is available -- never a fabricated name. Same convention as `seller-call-negotiation.ts`'s `NegotiationOverride`. */
  operator: string | null;
  snapshot: OutcomeSnapshot;
  /** Present only for `pass`. */
  reason: string | null;
  /** Present only for `follow_up`, the ISO instant the callback was scheduled for. */
  followUpAt: string | null;
};

const LEDGER_VERSION = "iaos-seller-call-outcome-v1" as const;
const EXPECTED_HEADER = `IAOS SELLER CALL OUTCOME LEDGER — ${LEDGER_VERSION}`;
const OUTCOME_KINDS: ReadonlySet<string> = new Set(["accept", "follow_up", "pass"]);
const READINESS_STATUSES: ReadonlySet<string> = new Set(["NOT_READY", "REVIEW_NEEDED", "OFFER_READY"]);

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

/**
 * The exact inverse of `ledgerValue`: `"UNAVAILABLE"` (or blank) becomes
 * `null`, anything else must parse to a finite number or the WHOLE note
 * fails closed -- never a partial/best-effort snapshot.
 */
function parseLedgerNumber(raw: string | null): { ok: true; value: number | null } | { ok: false } {
  if (raw === null) return { ok: false };
  if (raw === "UNAVAILABLE" || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Structured note body for one bounded call outcome. Mirrors
 * `arv-persist.ts`'s `formatArvApprovalNote` shape verbatim: a versioned
 * header line, one fact per line, no per-comp/per-row detail. Written
 * through the EXISTING `ghl.notes.create()` -- this function only builds
 * the string; it performs no write itself.
 */
export function formatOutcomeNote(args: {
  opportunityId: string;
  kind: CallOutcomeKind;
  at: string;
  operator: string | null;
  snapshot: OutcomeSnapshot;
  reason: string | null;
  followUpAt: string | null;
}): string {
  const s = args.snapshot;
  return [
    EXPECTED_HEADER,
    `Outcome timestamp: ${args.at}`,
    `Operator: ${ledgerValue(args.operator)}`,
    `Opportunity: ${args.opportunityId}`,
    `Outcome: ${args.kind}`,
    `Seller Position: ${ledgerValue(s.sellerPosition)}`,
    `Current Offer: ${ledgerValue(s.currentOffer)}`,
    `Target Acquisition Price: ${ledgerValue(s.targetAcquisitionPrice)}`,
    `Max Supported Offer: ${ledgerValue(s.maxSupportedOffer)}`,
    `Expected Spread: ${ledgerValue(s.expectedSpread)}`,
    `ARV: ${ledgerValue(s.arv)}`,
    `Repairs: ${ledgerValue(s.repairs)}`,
    `Offer Readiness: ${s.readinessStatus}`,
    `Reason: ${ledgerValue(args.reason)}`,
    `Follow-up at: ${ledgerValue(args.followUpAt)}`,
  ].join("\n");
}

/**
 * Parses one note body. Returns `null` on ANY deviation from the exact
 * format `formatOutcomeNote` produces -- fails closed, never guesses,
 * exactly like `arv-approval-note.ts`'s `parseArvApprovalNote`.
 */
export function parseOutcomeNote(body: string): ParsedOutcomeNote | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines[0] !== EXPECTED_HEADER) return null;

  function field(label: string): string | null {
    const line = lines.find((l) => l.startsWith(label + ": "));
    return line ? line.slice(label.length + 2) : null;
  }

  const at = field("Outcome timestamp");
  const operatorRaw = field("Operator");
  const opportunityId = field("Opportunity");
  const kindRaw = field("Outcome");
  const readinessRaw = field("Offer Readiness");
  const reasonRaw = field("Reason");
  const followUpAtRaw = field("Follow-up at");

  if (!at || !opportunityId || !kindRaw || !readinessRaw) return null;
  if (!OUTCOME_KINDS.has(kindRaw)) return null;
  if (!READINESS_STATUSES.has(readinessRaw)) return null;

  const atMs = new Date(at).getTime();
  if (!Number.isFinite(atMs)) return null;

  const numericFields = [
    field("Seller Position"), field("Current Offer"), field("Target Acquisition Price"),
    field("Max Supported Offer"), field("Expected Spread"), field("ARV"), field("Repairs"),
  ].map(parseLedgerNumber);
  if (numericFields.some((f) => !f.ok)) return null;
  const [sellerPosition, currentOffer, targetAcquisitionPrice, maxSupportedOffer, expectedSpread, arv, repairs] =
    numericFields.map((f) => (f as { ok: true; value: number | null }).value);

  const reason = reasonRaw === null || reasonRaw === "UNAVAILABLE" || reasonRaw === "" ? null : reasonRaw;
  const followUpAt = followUpAtRaw === null || followUpAtRaw === "UNAVAILABLE" || followUpAtRaw === "" ? null : followUpAtRaw;
  const operator = operatorRaw === null || operatorRaw === "UNAVAILABLE" || operatorRaw === "" ? null : operatorRaw;

  return {
    opportunityId,
    kind: kindRaw as CallOutcomeKind,
    at,
    operator,
    snapshot: {
      sellerPosition, currentOffer, targetAcquisitionPrice, maxSupportedOffer,
      expectedSpread, arv, repairs,
      readinessStatus: readinessRaw as OutcomeSnapshot["readinessStatus"],
    },
    reason,
    followUpAt,
  };
}

/**
 * Finds the CURRENT standing outcome for one Opportunity from a contact's
 * full note list -- the latest ledger entry BY THE NOTE'S OWN embedded
 * timestamp, never by list order or GHL's `dateAdded`. Mirrors
 * `arv-approval-note.ts`'s `latestArvApprovalForOpportunity` exactly, for
 * the same reason: a later call's outcome must never be shadowed by an
 * earlier one still sitting higher (or lower) in the raw note list.
 *
 * Matches ONLY notes for the given `opportunityId` (PB-D55): a contact
 * holding more than one deal's history must never have one deal's
 * outcome attributed to another.
 */
export function latestOutcomeNoteForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedOutcomeNote | null {
  let latest: ParsedOutcomeNote | null = null;
  for (const note of notes) {
    const parsed = parseOutcomeNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) {
      latest = parsed;
    }
  }
  return latest;
}

/* ------------------------------------------------------------------ */
/* Recording an outcome -- validation, never a write                    */
/* ------------------------------------------------------------------ */

export type AttemptOutcomeResult =
  | { ok: true; note: string }
  | { ok: false; error: string };

/**
 * The ONLY way to produce a formatted outcome note. Fails closed per
 * outcome kind -- an operator cannot record acceptance of a price that
 * was never entered, acceptance of a deal that has not reached Offer
 * Ready, a follow-up with no valid callback time, or a pass with no
 * stated reason ("diagnose rather than manipulate":
 * `SELLER_ACQUISITION_WORKFLOW.md`'s own rule that an out-of-parameters
 * or negative outcome is stated, not silently recorded). Performs no
 * write itself -- the caller is responsible for `ghl.notes.create` (and,
 * for `follow_up`, the existing `scheduleCallbackGated`).
 *
 * Jess Gate correction, 2026-09-06: a Current Offer alone is NOT
 * sufficient to record acceptance -- without this, NOT_READY or
 * REVIEW_NEEDED economics could become "Agreement Reached" and expose
 * Contract Ready on evidence that never earned it. `args.snapshot.
 * readinessStatus` is the caller's OWN already-resolved `ReadinessResult.
 * effectiveStatus` (see SellerCallWorkspace.tsx's `buildOutcomeSnapshot`),
 * never recomputed here -- this module has no second readiness engine.
 * Because `effectiveStatus` (not the raw `status`) is what flows through,
 * a legitimate human OVERRIDDEN readiness result -- which
 * `offer-readiness.ts`'s own rule already resolves to OFFER_READY --
 * is accepted on the same terms as organically SUPPORTED evidence; this
 * function has no way to, and need not, tell the two apart.
 */
export function attemptRecordOutcome(args: {
  kind: CallOutcomeKind;
  opportunityId: string;
  operator: string | null;
  at: string;
  snapshot: OutcomeSnapshot;
  reason: string;
  followUpAt: string;
}): AttemptOutcomeResult {
  if (args.kind === "accept" && args.snapshot.currentOffer === null) {
    return { ok: false, error: "Cannot record acceptance -- no Current Offer has been entered for this negotiation." };
  }
  if (args.kind === "accept" && args.snapshot.readinessStatus !== "OFFER_READY") {
    return { ok: false, error: "Cannot record acceptance -- this deal is not yet Offer Ready." };
  }
  if (args.kind === "follow_up") {
    if (args.followUpAt.trim() === "") {
      return { ok: false, error: "A follow-up date/time is required." };
    }
    if (!Number.isFinite(new Date(args.followUpAt).getTime())) {
      return { ok: false, error: "That follow-up date/time is not valid." };
    }
  }
  if (args.kind === "pass" && args.reason.trim() === "") {
    return { ok: false, error: "A reason is required to record a pass." };
  }

  const note = formatOutcomeNote({
    opportunityId: args.opportunityId,
    kind: args.kind,
    at: args.at,
    operator: args.operator,
    snapshot: args.snapshot,
    reason: args.kind === "pass" ? args.reason : null,
    followUpAt: args.kind === "follow_up" ? new Date(args.followUpAt).toISOString() : null,
  });
  return { ok: true, note };
}
