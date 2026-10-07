/**
 * Storage correction (plan v6 §11) -- sanitized diagnostics. ONE JSON line:
 * {fn, action, phase, class, status?, capability?}. Numeric status only.
 *
 * NEVER logged: credentials, headers, keys, payloads, note bodies, contact data,
 * raw SDK messages, tokens or their hashes. Callers pass only the fixed
 * vocabularies below; anything else is replaced by "unexpected".
 */
export const PHASES = [
  "capability", "cutover_gate", "deploy_context", "lock_acquire", "lock_release", "lock_release_verify",
  "stage_marker_claim", "stage_marker_clear", "op_publish", "attempt_publish", "binding_publish", "head_cas",
  "decision_claim", "claim_verify", "decision_withdraw", "outcome_record", "final_record", "head_release",
  "status_read", "import_capture", "import_classify", "import_output", "import_owner", "activation", "g5_gate",
  "admission", "publication", "ticket", "receipt", "storage_read", "storage_write", "ghl_dispatch", "request",
] as const;
export type DiagPhase = typeof PHASES[number];
export const CLASSES = [
  "conflict", "auth_refused", "rate_limited", "server_error", "transport", "deadline", "abandoned", "ack_ambiguous",
  "strong_unavailable", "readback_missing", "readback_mismatch", "release_unverified", "legacy_blocked",
  "preview_refused", "cutover_pending", "activation_missing", "activation_changed", "g5_blocked",
  "import_owner_conflict", "legacy_id_refused", "admission_closed", "ticket_overlap", "publication_unresolved",
  "unexpected",
] as const;
export type DiagClass = typeof CLASSES[number];

export type DiagLine = { fn: string; action: string; phase: DiagPhase; class: DiagClass; status?: number; capability?: string };

/** Test hook: captured lines (never enabled in production code paths). */
export const diagnosticSink: { lines: DiagLine[] | null } = { lines: null };

const ACTION = /^[a-z][a-z0-9_.:-]{0,40}$/;
export function diag(line: DiagLine): void {
  const safe: DiagLine = {
    fn: ACTION.test(line.fn) ? line.fn : "unexpected",
    action: ACTION.test(line.action) ? line.action : "unexpected",
    phase: (PHASES as readonly string[]).includes(line.phase) ? line.phase : "request",
    class: (CLASSES as readonly string[]).includes(line.class) ? line.class : "unexpected",
  };
  if (typeof line.status === "number" && Number.isInteger(line.status) && line.status >= 0 && line.status < 1000) safe.status = line.status;
  if (line.capability === "unknown" || line.capability === "unavailable" || line.capability === "configured" || line.capability === "verified") safe.capability = line.capability;
  if (diagnosticSink.lines) diagnosticSink.lines.push(safe);
  try { console.error("[iaos-storage]", JSON.stringify(safe)); } catch { /* never throws */ }
}
