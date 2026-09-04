/**
 * ARV valuation evidence snapshots and versions. B7-09 / INV-26.
 *
 * THE OUTCOME THIS EXISTS FOR: never destroy the evidence supporting an
 * approved ARV. A later comp refresh creates a NEW valuation version; it does
 * not rewrite the evidence behind an earlier approved ARV.
 *
 * ⚠ THIS MODULE INVENTS NO SECOND REPRESENTATION OF ANYTHING BOARD #7 ALREADY
 * PRODUCES. Every evidentiary field INV-26 requires already has a type, and a
 * snapshot holds those types verbatim:
 *
 *     source / import metadata   PropStreamCompImport["source"] (B7-04)
 *     comps considered           PropStreamComparable[]         (B7-04)
 *     duplicate-property groups  PropertyEvidenceGroup[]        (B7-04)
 *     import issues              CompImportIssue[]              (B7-04)
 *     subject facts used         SubjectForCompClassification (B7-05)
 *     operator-established facts CompAssessment[]             (B7-05)
 *     comp dispositions          CompSearchResult             (B7-05)
 *     search level               CompSearchResult.level       (B7-05)
 *     median sale / median PPSF  ArvReconciliationResult      (B7-06)
 *     recommended ARV            ArvReconciliationResult      (B7-06)
 *     evidence state             ArvReconciliationResult      (B7-06)
 *
 * Only two things INV-26 requires had NO existing representation, and each
 * gets exactly one new type here: the source ARTIFACT reference, and the
 * approval/override DECISION with its approver and time.
 *
 * ⚠ THIS MODULE IS PURE. No React, no network, no GHL, no storage engine, no
 * clock and no identifier of any kind. Time is supplied by the caller, exactly
 * as B7-04's own `source.importedAt` already is, so a snapshot is a
 * deterministic function of its inputs and the harness can assert equality
 * rather than approximate it.
 *
 * ⚠ WHAT IT DELIBERATELY DOES NOT DO — B7-08 IS A DIFFERENT RESPONSIBILITY.
 * It writes no GHL field, creates no carrier, and contains no note ledger. The
 * B7-08 append-only GHL Contact note ledger is the durable MINIMUM approval
 * provenance; this is the richer IAOS evidence record. They are distinct and
 * this module must never grow into the other.
 *
 * ⚠ CROSS-SESSION DURABILITY IS NOT DELIVERED HERE, AND SAYING SO IS THE POINT.
 * A ledger is plain JSON-able data with an explicit schema tag and a
 * serializer, so ANY carrier later authorized can persist it without redesign.
 * No carrier is authorized today: new per-comp GHL fields are a HARD NO, and
 * B7-07 recorded that the workspace adds no browser storage. INV-26's
 * acceptance is about a later COMP REFRESH not destroying an earlier run --
 * its own words, "a later comp refresh creates a new valuation
 * version/snapshot" -- and that is what this proves. Where a ledger comes to
 * rest is a carrier decision this issue does not authorize.
 */

import type {
  ArvReconciliationResult,
} from "./arv-reconciliation";
import type {
  CompAssessment,
  CompSearchResult,
  SubjectForCompClassification,
} from "./comp-classification";
import type {
  CompImportIssue,
  PropertyEvidenceGroup,
  PropStreamComparable,
  PropStreamCompImport,
} from "./propstream-comp-csv";

export const VALUATION_LEDGER_SCHEMA = "iaos-valuation-ledger-v1" as const;

/**
 * A source document retained for audit, NOT parsed.
 *
 * INV-26 permits a Complete Analysis PDF or a PropStream export to be kept
 * "for audit/reference without extracting every contained field", and that
 * permission is the whole design here: this is a REFERENCE, never a parser
 * contract. Nothing in IAOS reads inside a retained artifact, and adding a
 * field-by-field extraction of one is out of scope by name.
 */
export interface ValuationSourceArtifact {
  readonly kind: "PROPSTREAM_COMP_CSV" | "COMPLETE_ANALYSIS_PDF" | "OTHER";
  readonly fileName: string;
  /** Bytes, where the caller knows it. Null is "not recorded", never zero. */
  readonly byteLength: number | null;
  /**
   * Non-cryptographic content fingerprint. It exists to make a substituted or
   * edited artifact VISIBLE, not to resist an adversary, and must never be
   * described as a security control.
   */
  readonly fingerprint: string | null;
  /** Why this artifact was retained. Free text, operator-facing. */
  readonly note: string;
}

/**
 * One valuation run's evidence, frozen at the moment it was captured.
 *
 * A snapshot answers "why did this valuation produce this result", which is
 * why it carries the operator's `assessments` as well as the machine outputs:
 * the disposition of a comp is not explicable from the CSV alone, because
 * B7-05 needs buyer-market and transaction-credibility facts a CSV cannot
 * establish. Dropping them would preserve the WHAT and lose the WHY.
 */
export interface ValuationSnapshot {
  readonly schema: typeof VALUATION_LEDGER_SCHEMA;
  /** 1-based and monotonic within one ledger. Never reused, never renumbered. */
  readonly version: number;
  readonly capturedAt: string;
  /**
   * The importer's OWN source block, verbatim: kind, contract version, file
   * name, import instant, the exact headers seen and the row count. It already
   * carries its contract version, so no second version field is kept here.
   */
  readonly source: PropStreamCompImport["source"];
  readonly sourceArtifacts: readonly ValuationSourceArtifact[];
  readonly subject: SubjectForCompClassification;
  readonly assessments: readonly CompAssessment[];
  readonly comps: readonly PropStreamComparable[];
  /** Duplicate-property grouping and its conflicts, as B7-04 produced them. */
  readonly propertyGroups: readonly PropertyEvidenceGroup[];
  readonly importIssues: readonly CompImportIssue[];
  /** Null when the import failed outright and classification never ran. */
  readonly search: CompSearchResult | null;
  /** Null for the same reason. An absent result is never a zero result. */
  readonly reconciliation: ArvReconciliationResult | null;
  readonly fingerprint: string;
}

/**
 * An operator decision about one snapshot.
 *
 * ⚠ DECISIONS ARE A SEPARATE APPEND-ONLY SEQUENCE, NOT A FIELD ON THE
 * SNAPSHOT, and that is the load-bearing choice in this module. Approval
 * happens AFTER a run is computed, so writing it into the snapshot would mean
 * either editing a frozen record -- which is the thing INV-26 forbids -- or
 * refusing to snapshot a run until it is approved, which would silently
 * discard every run the operator considered and did not approve. Those are
 * exactly the comps INV-26 wants preserved.
 *
 * Re-deciding appends. It never edits, so an ARV that was approved at one
 * figure and later overridden to another leaves BOTH on the record with their
 * times. That is the same shape Brad ruled for B7-08: the current value may be
 * replaced, the history may not.
 */
export interface ValuationDecision {
  readonly schema: typeof VALUATION_LEDGER_SCHEMA;
  /** The snapshot version this decision is about. */
  readonly version: number;
  /** 1-based, monotonic across the whole ledger. Orders decisions absolutely. */
  readonly sequence: number;
  readonly kind: "APPROVED" | "OVERRIDDEN";
  readonly amount: number;
  /**
   * What IAOS recommended at the moment of the decision. An override is only
   * legible beside the number it departed from, and reading it back off the
   * snapshot later would silently re-derive rather than record.
   */
  readonly recommendedAtDecision: number | null;
  /** Required for an override, null for a plain approval. */
  readonly overrideReason: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

export interface ValuationLedger {
  readonly schema: typeof VALUATION_LEDGER_SCHEMA;
  /** Whose valuation history this is. An opaque key to this module. */
  readonly subjectKey: string;
  readonly snapshots: readonly ValuationSnapshot[];
  readonly decisions: readonly ValuationDecision[];
}

export class ValuationLedgerError extends Error {}

/* ------------------------------------------------------------------ */
/* fingerprinting                                                      */
/* ------------------------------------------------------------------ */

/**
 * A stable, non-cryptographic 64-bit content fingerprint, rendered hex.
 *
 * Two independent 32-bit FNV-1a lanes over the same bytes, concatenated. It is
 * dependency-free and identical in Node and the browser, which matters because
 * this module is application code exercised by a Node harness.
 *
 * ⚠ IT IS NOT A SECURITY CONTROL and must never be presented as one. It makes
 * an edited or substituted record visible to an honest reader; it does not
 * resist anyone trying to forge one.
 */
export function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((c << 1) | (i & 1)), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * JSON with object keys in a stable order, so a fingerprint depends on CONTENT
 * and not on the order a caller happened to build an object in. `JSON.stringify`
 * preserves insertion order, which would make two identical snapshots
 * fingerprint differently and turn a real guarantee into a coin flip.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([l], [r]) => (l < r ? -1 : l > r ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}";
}

/**
 * Freezes a value and everything under it.
 *
 * Immutability is enforced STRUCTURALLY rather than by convention, because
 * "no caller mutates history" is a property this module can guarantee and a
 * code review cannot. `readonly` is erased at runtime and stops nobody.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return Object.freeze(value);
}

/* ------------------------------------------------------------------ */
/* the ledger                                                          */
/* ------------------------------------------------------------------ */

export function createLedger(subjectKey: string): ValuationLedger {
  if (subjectKey.trim() === "") throw new ValuationLedgerError("a ledger needs a subject key");
  return deepFreeze({
    schema: VALUATION_LEDGER_SCHEMA,
    subjectKey,
    snapshots: [],
    decisions: [],
  });
}

export interface ValuationRunInput {
  /** The B7-07 orchestration output for this run, used exactly as produced. */
  readonly run: {
    readonly imported: PropStreamCompImport;
    readonly search: CompSearchResult | null;
    readonly reconciliation: ArvReconciliationResult | null;
  };
  readonly subject: SubjectForCompClassification;
  readonly assessments: readonly CompAssessment[];
  readonly capturedAt: string;
  readonly sourceArtifacts?: readonly ValuationSourceArtifact[];
}

/**
 * Appends a valuation run as the next version.
 *
 * Returns a NEW ledger. The prior ledger object, every snapshot in it and every
 * decision on it are untouched and remain frozen, so a caller holding a
 * reference to the ledger as it stood before a refresh still holds exactly that.
 */
export function appendValuation(ledger: ValuationLedger, input: ValuationRunInput): ValuationLedger {
  if (input.capturedAt.trim() === "") throw new ValuationLedgerError("capturedAt is required; this module reads no clock");

  const version = ledger.snapshots.length + 1;
  const body = {
    schema: VALUATION_LEDGER_SCHEMA,
    version,
    capturedAt: input.capturedAt,
    source: input.run.imported.source,
    sourceArtifacts: input.sourceArtifacts ?? [],
    subject: input.subject,
    assessments: input.assessments,
    comps: input.run.imported.evidence,
    propertyGroups: input.run.imported.propertyGroups,
    importIssues: input.run.imported.issues,
    search: input.run.search,
    reconciliation: input.run.reconciliation,
  };

  const snapshot = deepFreeze({ ...body, fingerprint: fingerprint(body) }) as ValuationSnapshot;

  return deepFreeze({
    schema: VALUATION_LEDGER_SCHEMA,
    subjectKey: ledger.subjectKey,
    snapshots: [...ledger.snapshots, snapshot],
    decisions: [...ledger.decisions],
  });
}

export interface DecisionInput {
  readonly version: number;
  readonly kind: "APPROVED" | "OVERRIDDEN";
  readonly amount: number;
  readonly overrideReason?: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/**
 * Records an approval or override against an existing version.
 *
 * Appends. Never edits, and never touches the snapshot it refers to -- the
 * evidence and the decision about it are separately immutable.
 */
export function recordDecision(ledger: ValuationLedger, input: DecisionInput): ValuationLedger {
  const snapshot = snapshotAt(ledger, input.version);
  if (snapshot === null) {
    throw new ValuationLedgerError(
      `no valuation version ${input.version} exists on this ledger; a decision cannot be recorded against a run that was never captured`,
    );
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValuationLedgerError("a decided ARV must be a positive finite amount");
  }
  if (input.kind === "OVERRIDDEN" && (input.overrideReason ?? "").trim() === "") {
    throw new ValuationLedgerError("an override must state its reason");
  }
  if (input.decidedBy.trim() === "") throw new ValuationLedgerError("a decision must name who made it");
  if (input.decidedAt.trim() === "") throw new ValuationLedgerError("a decision must carry when it was made");

  const decision = deepFreeze({
    schema: VALUATION_LEDGER_SCHEMA,
    version: input.version,
    sequence: ledger.decisions.length + 1,
    kind: input.kind,
    amount: input.amount,
    recommendedAtDecision: snapshot.reconciliation?.recommendedArv ?? null,
    overrideReason: input.kind === "OVERRIDDEN" ? (input.overrideReason as string) : null,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
  }) as ValuationDecision;

  return deepFreeze({
    schema: VALUATION_LEDGER_SCHEMA,
    subjectKey: ledger.subjectKey,
    snapshots: [...ledger.snapshots],
    decisions: [...ledger.decisions, decision],
  });
}

/* ------------------------------------------------------------------ */
/* inspection                                                          */
/* ------------------------------------------------------------------ */

/** The snapshot for a version, or null. Versions are 1-based. */
export function snapshotAt(ledger: ValuationLedger, version: number): ValuationSnapshot | null {
  return ledger.snapshots.find((s) => s.version === version) ?? null;
}

export function latestSnapshot(ledger: ValuationLedger): ValuationSnapshot | null {
  return ledger.snapshots.length === 0 ? null : ledger.snapshots[ledger.snapshots.length - 1];
}

/** Every decision about one version, oldest first. Nothing is filtered out. */
export function decisionsFor(ledger: ValuationLedger, version: number): readonly ValuationDecision[] {
  return ledger.decisions.filter((d) => d.version === version);
}

/**
 * The decision that governs a version now: the LAST one recorded against it.
 *
 * Superseded decisions are not deleted and stay readable through
 * `decisionsFor`. This function answers "what stands", never "what happened".
 */
export function effectiveDecision(ledger: ValuationLedger, version: number): ValuationDecision | null {
  const all = decisionsFor(ledger, version);
  return all.length === 0 ? null : all[all.length - 1];
}

/** Every decision on the ledger, oldest first, across all versions. */
export function decisionHistory(ledger: ValuationLedger): readonly ValuationDecision[] {
  return ledger.decisions;
}

/**
 * A one-line-per-fact explanation of why a version produced what it did.
 *
 * Assembled from the snapshot only. It derives no valuation policy and
 * recomputes nothing -- if it disagreed with the reconciliation engine, this
 * would be a second source of truth, which is exactly what B7-06 forbids.
 */
export function explainVersion(ledger: ValuationLedger, version: number): readonly string[] {
  const s = snapshotAt(ledger, version);
  if (s === null) return [`No valuation version ${version} exists.`];

  const lines: string[] = [
    `Version ${version}, captured ${s.capturedAt}.`,
    `Source: ${s.source.fileName}, imported ${s.source.importedAt} (${s.source.version}, ${s.source.rowCount} rows).`,
    `Subject: ${s.subject.propertyType}, ${s.subject.squareFeet} sf, as of ${s.subject.asOfDate}.`,
    `Comps considered: ${s.comps.length}.`,
  ];
  if (s.search === null) {
    lines.push("Classification did not run: the import failed.");
  } else {
    const counts = { ACCEPTED: 0, SUPPORTING: 0, REJECTED: 0 };
    for (const c of s.search.classifications) counts[c.disposition]++;
    lines.push(`Search level: ${s.search.level}.`);
    lines.push(`Dispositions: ${counts.ACCEPTED} accepted, ${counts.SUPPORTING} supporting, ${counts.REJECTED} rejected.`);
  }
  if (s.reconciliation === null) {
    lines.push("Reconciliation did not run.");
  } else {
    const r = s.reconciliation;
    lines.push(`Median sold indication: ${r.primaryMedianSoldPrice ?? "none"}.`);
    lines.push(`Median accepted PPSF: ${r.medianAcceptedPricePerSquareFoot ?? "none"}.`);
    lines.push(`Recommended ARV: ${r.recommendedArv ?? "none"} (${r.outcome}, evidence ${r.evidenceState}).`);
  }
  for (const artifact of s.sourceArtifacts) {
    lines.push(`Retained artifact: ${artifact.kind} ${artifact.fileName} — ${artifact.note}`);
  }
  const decisions = decisionsFor(ledger, version);
  if (decisions.length === 0) {
    lines.push("No approval or override was recorded against this version.");
  } else {
    for (const d of decisions) {
      const against = d.recommendedAtDecision === null ? "no recommendation" : `recommendation ${d.recommendedAtDecision}`;
      lines.push(
        `${d.kind} ${d.amount} by ${d.decidedBy} at ${d.decidedAt}, against ${against}` +
          (d.overrideReason === null ? "." : ` — ${d.overrideReason}`),
      );
    }
    const effective = decisions[decisions.length - 1];
    if (decisions.length > 1) lines.push(`Effective now: ${effective.kind} ${effective.amount} (sequence ${effective.sequence}).`);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* serialization                                                       */
/* ------------------------------------------------------------------ */

/**
 * The ledger as stable text.
 *
 * Key-ordered, so the same ledger always produces the same bytes. That is what
 * lets a harness assert that version 1 is BYTE-recoverable after version 2
 * exists rather than merely deep-equal, and it is what a future authorized
 * carrier would persist.
 */
export function serializeLedger(ledger: ValuationLedger): string {
  return stableStringify(ledger);
}

/**
 * Reads a ledger back, refusing anything that is not one.
 *
 * The schema tag is checked before the shape: a payload written under a
 * different contract must fail loudly here rather than half-load and be
 * mistaken for evidence.
 */
export function deserializeLedger(text: string): ValuationLedger {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValuationLedgerError("the serialized ledger is not valid JSON");
  }
  const l = raw as Partial<ValuationLedger>;
  if (l === null || typeof l !== "object") throw new ValuationLedgerError("the serialized ledger is not an object");
  if (l.schema !== VALUATION_LEDGER_SCHEMA) {
    throw new ValuationLedgerError(
      `unknown ledger schema ${JSON.stringify(l.schema)}; expected ${VALUATION_LEDGER_SCHEMA}`,
    );
  }
  if (typeof l.subjectKey !== "string" || !Array.isArray(l.snapshots) || !Array.isArray(l.decisions)) {
    throw new ValuationLedgerError("the serialized ledger is missing subjectKey, snapshots or decisions");
  }
  return deepFreeze(l as ValuationLedger);
}

/**
 * Recomputes each snapshot's fingerprint and reports any that no longer match.
 *
 * Returns the versions whose recorded evidence does not match its recorded
 * fingerprint. An empty array means every snapshot is internally consistent.
 * Honest limit: this detects accidental corruption and careless edits, not a
 * determined forger who recomputed the fingerprint too.
 */
export function verifyLedger(ledger: ValuationLedger): readonly number[] {
  const bad: number[] = [];
  for (const s of ledger.snapshots) {
    const { fingerprint: recorded, ...body } = s;
    if (fingerprint(body) !== recorded) bad.push(s.version);
  }
  return bad;
}
