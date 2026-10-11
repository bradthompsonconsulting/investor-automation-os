/**
 * Seller Position durable carrier -- Board 14-13 Seller Call autosave
 * (Brad, 2026-10-10: Seller Position persists independently of recording a
 * conversation outcome, as its own contact-note ledger scoped to one
 * Opportunity; no GHL field). Until now Seller Position was session-only
 * (B8-08 / INV-51) and durable only inside an outcome record's snapshot.
 *
 * Pure. No I/O, no React, no GHL identifiers. SAME PROVEN PATTERN AS
 * `seller-call-readiness-carriers.ts`, REUSED, NOT REINVENTED: versioned
 * header, one fact per line, positional parsing, a canonical ISO timestamp,
 * and a "latest entry wins, scoped to ONE Opportunity" reader by the note's
 * OWN embedded timestamp. Every save is a NEW append-only note. Clearing the
 * field is also a new note ("cleared"), so a reload never brings back an
 * older number the operator removed.
 *
 * This is NOT the "Seller price position" readiness record (a price or a
 * documented refusal, `seller-call-readiness-carriers.ts`): the two stay
 * separate, as `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md` rules. Nothing
 * here feeds Offer Readiness.
 *
 * Written through the existing sanctioned write only: the caller performs
 * `ghl.notes.create()`. The server's ledger guard must recognise this parser
 * before the real server accepts these notes (server files, not changed here).
 */

export const SELLER_POSITION_LEDGER_VERSION = "iaos-seller-position-v1" as const;
const SELLER_POSITION_HEADER = `IAOS SELLER POSITION — ${SELLER_POSITION_LEDGER_VERSION}`;
const SELLER_POSITION_LABELS = ["Recorded at", "Operator", "Opportunity", "Seller Position"] as const;
const CLEARED_MARKER = "(cleared)";
/** Plain positive decimal digits, as `String(number)` writes them for ordinary amounts (never exponent form). */
const VALUE_FORM = /^\d+(?:\.\d+)?$/;

export type ParsedSellerPosition =
  | { opportunityId: string; at: string; operator: string | null; kind: "value"; value: number }
  | { opportunityId: string; at: string; operator: string | null; kind: "cleared" };

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

function isCanonicalIsoTimestamp(at: string): boolean {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === at;
}

function matchPositionalSchema(body: string, header: string, labels: readonly string[]): string[] | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines.length !== 1 + labels.length) return null;
  if (lines[0] !== header) return null;
  const values: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const line = lines[i + 1];
    const prefix = labels[i] + ": ";
    if (!line.startsWith(prefix)) return null;
    values.push(line.slice(prefix.length));
  }
  return values;
}

/** `value` must already be a strictly positive, finite number (the page's `parseAcquisitionPriceInput` decides that). */
export function formatSellerPositionNote(
  args:
    | { opportunityId: string; at: string; operator: string | null; kind: "value"; value: number }
    | { opportunityId: string; at: string; operator: string | null; kind: "cleared" },
): string {
  if (args.kind === "value" && !(Number.isFinite(args.value) && args.value > 0 && VALUE_FORM.test(String(args.value)))) {
    throw new Error("Seller Position must be a positive number written in plain digits.");
  }
  return [
    SELLER_POSITION_HEADER,
    `${SELLER_POSITION_LABELS[0]}: ${args.at}`,
    `${SELLER_POSITION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${SELLER_POSITION_LABELS[2]}: ${args.opportunityId}`,
    `${SELLER_POSITION_LABELS[3]}: ${args.kind === "value" ? args.value : CLEARED_MARKER}`,
  ].join("\n");
}

export function parseSellerPositionNote(body: string): ParsedSellerPosition | null {
  const values = matchPositionalSchema(body, SELLER_POSITION_HEADER, SELLER_POSITION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, valueRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  if (valueRaw === CLEARED_MARKER) return { opportunityId, at, operator, kind: "cleared" };
  if (!VALUE_FORM.test(valueRaw)) return null;
  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { opportunityId, at, operator, kind: "value", value };
}

export function latestSellerPositionForOpportunity(notes: { body: string }[], opportunityId: string): ParsedSellerPosition | null {
  let latest: ParsedSellerPosition | null = null;
  for (const note of notes) {
    const parsed = parseSellerPositionNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}
