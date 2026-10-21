/**
 * System note summaries -- B15-17 (INV-126), Walkthrough 2 (Brad/Jess,
 * 2026-10-07): "Contact and Conversations expose raw system ledger/JSON; use
 * readable summaries with expandable technical evidence, preserving
 * provenance."
 *
 * Pure. No I/O, no React, no GHL. Decides only how an already-read note body
 * is SHOWN. The stored note is never changed, and every ledger parser keeps
 * reading the raw body exactly as before.
 *
 * Two shapes are recognised, both conservatively:
 *
 *   IAOS ledger note   first line is exactly `IAOS <TITLE> — iaos-<version>`,
 *                      the header every IAOS ledger writer emits (arv-persist,
 *                      seller-call-outcome, the contract and readiness
 *                      carriers). TITLE is upper case, so an ordinary note
 *                      that happens to start with "IAOS" does not match.
 *   JSON record        the whole trimmed body parses as a JSON object or
 *                      array. A person does not type one.
 *
 * Anything else is a person's note and is shown as written. A recognised
 * note is never hidden: the page shows the summary with the full original
 * body one click away.
 */

export type SystemNoteSummary = {
  /** Operator wording for the record, e.g. "ARV approval". */
  title: string;
  /** The header's version string (`iaos-...`), or null for a JSON record. */
  version: string | null;
  /**
   * The record's OWN status line, quoted -- never interpreted (Brad,
   * 2026-10-19: confirmed, failed, pending and uncertain must stay
   * distinct). `value` is the stored value with underscores read as spaces
   * ("provider accepted pending readback", "ambiguous", "withdrawn"). Null
   * when the record has no status line; the page then says so, so a title
   * such as "Contract send" never reads as a success.
   */
  status: { label: string; value: string } | null;
};

/**
 * Status-bearing labels the ledger writers emit, in the order one is chosen
 * when a record has several: Status (contract send, draft-request sync,
 * property identity), Outcome (seller call outcome), Event kind (contract
 * lifecycle), Decision (ARV approval, readiness), Kind (readiness human
 * action), Disposition (attorney/manual field), Evidence state (ARV).
 */
export const STATUS_LABELS = ["Status", "Outcome", "Event kind", "Decision", "Kind", "Disposition", "Evidence state"] as const;

/** Longer values are cut for the one-line summary; the full record keeps them. */
const STATUS_VALUE_MAX = 80;

function statusLine(lines: string[]): SystemNoteSummary["status"] {
  for (const label of STATUS_LABELS) {
    const line = lines.find((l) => l.startsWith(label + ": "));
    if (!line) continue;
    const raw = line.slice(label.length + 2).trim();
    if (!raw) continue;
    const value = raw.replace(/_/g, " ");
    return { label, value: value.length > STATUS_VALUE_MAX ? value.slice(0, STATUS_VALUE_MAX - 1) + "…" : value };
  }
  return null;
}

const LEDGER_HEADER = /^IAOS ([A-Z0-9][A-Z0-9 /&()-]*?) — (iaos-[a-z0-9-]+)$/;

/** Words kept upper case when the header title is put in sentence case. */
const ACRONYMS: ReadonlySet<string> = new Set(["ARV", "IAOS", "GHL", "PDF", "LLC", "MAO"]);

/** "ARV APPROVAL LEDGER" -> "ARV approval"; "ATTORNEY/MANUAL FIELD DISPOSITION" -> "Attorney/manual field disposition". */
export function ledgerTitleToOperatorWords(headerTitle: string): string {
  const words = headerTitle.trim().split(/\s+/);
  if (words.length > 1 && words[words.length - 1] === "LEDGER") words.pop();
  const text = words
    .map((word) => word.split("/").map((part) => (ACRONYMS.has(part) ? part : part.toLowerCase())).join("/"))
    .join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function summarizeSystemNote(body: string | null | undefined): SystemNoteSummary | null {
  if (typeof body !== "string") return null;
  const lines = body.split(/\r?\n/);
  const header = LEDGER_HEADER.exec(lines[0]);
  if (header) return { title: ledgerTitleToOperatorWords(header[1]), version: header[2], status: statusLine(lines.slice(1)) };

  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value !== null && typeof value === "object") return { title: "Technical record", version: null, status: null };
    } catch {
      return null;
    }
  }
  return null;
}
