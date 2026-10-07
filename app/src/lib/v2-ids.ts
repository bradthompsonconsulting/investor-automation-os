/**
 * Storage correction (plan v6 §9.3): the v2 client mints ONLY `v2-` prefixed
 * request, operation and attempt ids. The server refuses every other id before
 * any I/O, so every legacy receipt keeps its meaning.
 */
export const newV2Id = () => `v2-${crypto.randomUUID()}`;

/** Codes the server uses when saving is paused or held (the page shows the server's message). */
export const PAUSED_CODES = new Set(["g5_blocked", "legacy_blocked", "publication_unresolved", "admission_closed", "activation_missing", "cutover_pending", "kill_switch", "storage", "activation_changed"]);
export function pausedMessage(body: unknown): string | null {
  const b = body as { code?: unknown; error?: unknown } | null;
  return b && typeof b.code === "string" && PAUSED_CODES.has(b.code) && typeof b.error === "string" ? b.error : null;
}
