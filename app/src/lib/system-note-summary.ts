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
   * such as "Contract send" never reads as a success. The one exception is
   * a Disposition stored as one of three exact JSON shapes, which is shown
   * as its plain words (see dispositionWords); the full record is unchanged.
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

/** Same wording and zone as the note cards' own dates (ContactWorkspace formatNoteDate). */
function formatDispositionDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));

/**
 * B15-17 follow-up (Spock, Addendum 2): the seller equitable-interest and
 * attorney/manual-field writers store Disposition as JSON. The three shapes
 * seen on Test read as words: {"kind":"not_applicable"} "Not applicable",
 * {"kind":"not_yet_made"} "Not yet made", {"kind":"made","at":ISO} "Made on
 * <date>" (just "Made" when the date does not parse). The writers' two
 * other kinds read the same way: {"kind":"attorney_will_draft"} "Attorney
 * will draft", {"kind":"provided_verbatim","text":...} "Provided verbatim"
 * -- the supplied text is NOT put in the summary; it stays in the full
 * record. Anything else returns null and is quoted as before.
 */
function dispositionWords(raw: string): string | null {
  if (!raw.startsWith("{")) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "not_applicable" && exactKeys(o, ["kind"])) return "Not applicable";
  if (o.kind === "not_yet_made" && exactKeys(o, ["kind"])) return "Not yet made";
  if (o.kind === "attorney_will_draft" && exactKeys(o, ["kind"])) return "Attorney will draft";
  if (o.kind === "provided_verbatim" && exactKeys(o, ["kind", "text"]) && typeof o.text === "string") return "Provided verbatim";
  if (o.kind === "made" && exactKeys(o, ["kind", "at"]) && typeof o.at === "string") {
    const when = formatDispositionDate(o.at);
    return when ? `Made on ${when}` : "Made";
  }
  return null;
}

function statusLine(lines: string[]): SystemNoteSummary["status"] {
  for (const label of STATUS_LABELS) {
    const line = lines.find((l) => l.startsWith(label + ": "));
    if (!line) continue;
    const raw = line.slice(label.length + 2).trim();
    if (!raw) continue;
    const value = (label === "Disposition" ? dispositionWords(raw) : null) ?? raw.replace(/_/g, " ");
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
