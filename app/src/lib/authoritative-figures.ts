/**
 * Board #15 B15-22 / INV-131 (F41, F42, F44) -- WHICH FIGURE COUNTS.
 *
 * Pure. No I/O, no React, no fetch, no GHL. Display wording only: every
 * number here is handed in by a caller that already read or computed it with
 * the existing readers and engines (computeUnderwriting, readOpportunityNumber,
 * the ARV approval ledger readers). Nothing here calculates a price, decides a
 * gate, or writes anything.
 *
 * Three kinds of figure appear across the deal surfaces and must not be
 * confused (W2: "distinguish working draft, approved underwriting, and
 * historical agreement snapshot"):
 *
 *   - CALCULATED NOW: the live engine output from the inputs on screen. A
 *     working figure until someone approves it.
 *   - APPROVED (RECORDED): what an explicit approval saved to the
 *     Opportunity (Seller MAO) or recorded in the ARV approval ledger.
 *   - AT ACCEPTANCE: the frozen snapshot captured when agreement was
 *     reached. Historical; never recomputed.
 */

export function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

// ── Seller MAO: recorded approved underwriting vs calculated now ─────────────

/** The Underwriting rail's Seller MAO cell: the RECORDED approved value. */
export const RECORDED_SELLER_MAO_LABEL = "Approved underwriting (recorded)";
export const RECORDED_SELLER_MAO_NONE = "None recorded yet";
/** The Underwriting decision panel's Seller MAO: the LIVE engine output. */
export const LIVE_SELLER_MAO_LABEL = "Seller MAO — calculated now";

export type SellerMaoComparison = {
  /** The rail cell's value text: the recorded figure, or that none is recorded. */
  recordedText: string;
  /** The line under the live figure, or null when there is no live figure. */
  liveNote: string | null;
  /** Evidence token: none | matches | differs | no_live. */
  token: "none" | "matches" | "differs" | "no_live";
};

/**
 * Compares the RECORDED approved Seller MAO (the Opportunity field Approve
 * writes, read with readOpportunityNumber -- or the figure Approve just saved
 * and confirmed on read-back, before the page re-reads) with the one
 * calculated now.
 */
export function compareSellerMao(input: {
  recorded: number | null;
  live: number | null;
}): SellerMaoComparison {
  const recorded = input.recorded;
  const recordedText = recorded === null ? RECORDED_SELLER_MAO_NONE : money(recorded);
  if (input.live === null) return { recordedText, liveNote: null, token: "no_live" };
  if (recorded === null) {
    return { recordedText, liveNote: "Not yet approved — no approved underwriting recorded yet", token: "none" };
  }
  if (recorded === input.live) {
    return { recordedText, liveNote: "Matches the approved underwriting on record", token: "matches" };
  }
  return { recordedText, liveNote: `Not yet approved — differs from approved ${money(recorded)}`, token: "differs" };
}

/** Contact rail Seller MAO provenance: it is the recorded approved value. */
export function railSellerMaoProvenance(opportunityName: string): string {
  return `Approved underwriting · ${opportunityName}`;
}

// ── ARV: approved on record vs this session's comps ──────────────────────────

export type ArvOnRecord =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "approved"; amount: number }
  | { kind: "mismatch"; ledgerAmount: number; currentArv: number }
  | { kind: "no_arv_on_file"; ledgerAmount: number }
  | { kind: "none" };

export const ARV_SESSION_EVIDENCE_NOTE = "the comps below are this session's working evidence";

/**
 * The line above the ARV workspace's session comps. `latestLedgerArv` is the
 * latest ledger entry's amount for THIS Opportunity regardless of match
 * (latestArvApprovalForOpportunity); `matchedArv` is non-null only when that
 * entry matches the ARV on file (matchingArvApprovalForOpportunity) -- the
 * same two reads Seller Call's ARV provenance uses.
 */
export function arvOnRecordText(state: ArvOnRecord): string {
  switch (state.kind) {
    case "loading": return "Reading the ARV approval record…";
    case "unavailable": return `The ARV approval record could not be read — ${ARV_SESSION_EVIDENCE_NOTE}`;
    case "approved": return `Approved ARV on record ${money(state.amount)} — ${ARV_SESSION_EVIDENCE_NOTE}`;
    case "mismatch":
      return `ARV on file ${money(state.currentArv)} does not match the latest ARV approval (${money(state.ledgerAmount)}) — not treated as approved; ${ARV_SESSION_EVIDENCE_NOTE}`;
    case "no_arv_on_file":
      return `An ARV approval (${money(state.ledgerAmount)}) is in the history but no ARV is on file — not treated as approved; ${ARV_SESSION_EVIDENCE_NOTE}`;
    case "none": return `No approved ARV on record — ${ARV_SESSION_EVIDENCE_NOTE}`;
  }
}

export function arvOnRecordState(input: {
  latestLedgerArv: number | null;
  matchedArv: number | null;
  currentArv: number | null;
}): ArvOnRecord {
  if (input.matchedArv !== null) return { kind: "approved", amount: input.matchedArv };
  if (input.latestLedgerArv !== null && input.currentArv !== null) {
    return { kind: "mismatch", ledgerAmount: input.latestLedgerArv, currentArv: input.currentArv };
  }
  if (input.latestLedgerArv !== null) return { kind: "no_arv_on_file", ledgerAmount: input.latestLedgerArv };
  return { kind: "none" };
}

// ── B15-22 r3 (Bones REVISE P2 #1): a visit-local ARV confirmation is bound
//    to the read it supplements ──────────────────────────────────────────────

/**
 * A READ GENERATION of the deal facts the ARV workspace is handed. It moves
 * on every newer read the page hands in: a new contact object (a refresh,
 * sign-in recovery, the re-read after another save) or a changed ARV on file.
 * Pure: the caller keeps the previous value and passes it back.
 */
export type ArvReadGeneration = { contact: unknown; currentArv: number | null; gen: number };
export function nextArvReadGeneration(prev: ArvReadGeneration | null, contact: unknown, currentArv: number | null): ArvReadGeneration {
  if (prev === null) return { contact, currentArv, gen: 0 };
  if (prev.contact === contact && prev.currentArv === currentArv) return prev;
  return { contact, currentArv, gen: prev.gen + 1 };
}

/** What a confirmed ARV save supplements: that deal, that read generation, the ARV on file then. */
export type ArvConfirmation = { key: string; gen: number; amount: number; basisArv: number | null };

/**
 * A confirmed save becomes the visit-local confirmation ONLY when no newer
 * read arrived while it was in flight (same deal key, same generation as when
 * the save started). Otherwise there is no confirmation: the newer read and
 * its ledger re-read are the record.
 */
export function arvConfirmationOnSave(input: {
  started: { key: string; gen: number } | null;
  key: string; gen: number; amount: number; basisArv: number | null;
}): ArvConfirmation | null {
  if (input.started === null || input.started.key !== input.key || input.started.gen !== input.gen) return null;
  return { key: input.key, gen: input.gen, amount: input.amount, basisArv: input.basisArv };
}

/** The ARV ledger as read for one deal key and one read generation (notes null = the read failed). */
export type ArvLedgerRead = { key: string; gen: number; notes: { body: string }[] | null };

/**
 * The ARV-on-record line's state. A confirmation counts only for the deal
 * AND read generation it supplements; a newer read retires it, and the line
 * then waits for (and reconciles against) the ledger re-read for THAT
 * generation -- an older ledger answer is never shown for a newer read.
 */
export function arvOnRecordFor(input: {
  key: string; gen: number;
  confirmation: ArvConfirmation | null;
  ledger: ArvLedgerRead | null;
  fromLedger: (notes: { body: string }[]) => ArvOnRecord;
}): ArvOnRecord {
  const c = input.confirmation;
  if (c !== null && c.key === input.key && c.gen === input.gen) return { kind: "approved", amount: c.amount };
  const l = input.ledger;
  if (l === null || l.key !== input.key || l.gen !== input.gen) return { kind: "loading" };
  if (l.notes === null) return { kind: "unavailable" };
  return input.fromLedger(l.notes);
}

// ── B15-22 r3 (Bones REVISE P2 #2): the recorded Seller MAO after Approve is
//    the SUBMITTED snapshot, never the render state at completion ───────────

/** Exactly what one Approve operation sent, captured in that operation before it awaits. */
export type SubmittedApproval = {
  op: number; opportunityId: string;
  sellerMAO: number; endBuyerMaxPrice: number; assignmentMode: string;
};
/** A confirmed Approve: its submitted snapshot, bound to the pipeline read it supplements. */
export type ConfirmedApproval = SubmittedApproval & { boundTo: unknown };

export function submittedApprovalSnapshot(
  op: number, opportunityId: string,
  figures: { sellerMAO: number; endBuyerMaxPrice: number }, assignmentMode: string,
): SubmittedApproval {
  return { op, opportunityId, sellerMAO: figures.sellerMAO, endBuyerMaxPrice: figures.endBuyerMaxPrice, assignmentMode };
}

/**
 * On confirmed success: the SUBMITTED snapshot becomes the confirmation,
 * bound to the pipeline read on screen at confirmation. A confirmation from
 * a superseded operation (a newer Approve has started since) changes nothing.
 */
export function confirmSubmittedApproval(
  prev: ConfirmedApproval | null, submitted: SubmittedApproval, latestOp: number, boundTo: unknown,
): ConfirmedApproval | null {
  if (submitted.op !== latestOp) return prev;
  return { ...submitted, boundTo };
}

/**
 * The recorded Seller MAO for the selected Opportunity: the confirmed
 * submitted figure while the page still holds the read it supplements and
 * the same Opportunity is selected; otherwise what the Opportunity read holds.
 */
export function recordedSellerMaoFor(input: {
  confirmed: ConfirmedApproval | null; selectedId: string | null; read: unknown; fromRead: number | null;
}): number | null {
  const c = input.confirmed;
  if (c !== null && input.selectedId !== null && c.opportunityId === input.selectedId && c.boundTo === input.read) return c.sellerMAO;
  return input.fromRead;
}

/** F44: with no property address, the subject-fact grid is collapsed and this is said instead. */
export const ARV_ADDRESS_FIRST = "Add the property address first — comps and property facts need it.";
export const ARV_SHOW_FACTS_ANYWAY = "Enter property facts anyway (this session only)";

// ── Contract disposition handoff: the frozen snapshot ────────────────────────

/** Consistent with the AGREEMENT REACHED banner's "ARV at acceptance". */
export const DISPOSITION_ARV_LABEL = "ARV at acceptance";
export const DISPOSITION_REPAIRS_LABEL = "Repairs at acceptance";

// ── Contact record: which ARV governs underwriting ───────────────────────────

/**
 * resolveDealFacts (underwriting/resolver.ts) reads the Opportunity ARV
 * first and uses the Contact ARV only when the Opportunity carries none.
 */
export const CONTACT_ARV_SEED_NOTE = "Seed only — the linked Opportunity's ARV governs once it is set";
