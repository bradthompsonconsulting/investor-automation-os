/**
 * B15-03 / INV-103 slice C -- Seller Call "Save at Summary": the save plan, the
 * per-item result model, and the one-save-at-a-time coordinator.
 *
 * Pure apart from the client it is handed (no React, no GHL identifiers, no
 * fetch). The page supplies the real client (`seller-conversation-save-client.ts`);
 * the tests supply simulated ones.
 *
 * THE PLAN (`buildSavePlan`), in this fixed order, each item listed with what it
 * would write and why:
 *   1. note            one structured conversation note for this call
 *                      (seller-conversation-note.ts), written whenever the call
 *                      has any content and that exact content is not already
 *                      confirmed this visit (a corrected re-save supersedes by
 *                      call id);
 *   2. timing          Transaction assumptions v2: closing/possession from the
 *                      Timing answer, the other two items carried unchanged from
 *                      the latest record (or, with the sections integrated, from
 *                      the Transaction assumptions section as typed);
 *   3. price           Seller price position: a valid positive price only;
 *                      anything else is "not saved: not a valid price";
 *   4. sellerPosition  (sections integrated only) the Seller Position ledger;
 *   5. occupancy       contact.occupancy: one of the three permitted values;
 *   6. address, 7. reason  never written: "not saved: not enabled" (B15-04).
 * A canonical item is written only where the draft differs from what is on
 * record. Two different entries for the same fact (the conversation answer and
 * the section field) are never resolved silently: the item is "not saved" and
 * says why.
 *
 * RESULTS are per item: confirmed / refused (the server's reason) / uncertain
 * (network error, timeout, unreadable or indeterminate response). An UNCERTAIN
 * item is never sent again by Save -- it is "blocked" until an explicit Check
 * reads the record: found -> confirmed; not found -> it may be sent again (a
 * fresh request). A confirmed item whose content is unchanged is not re-sent.
 * Nothing is ever erased by Save: a confirmed item simply stops counting as
 * unsaved; a failed or uncertain one keeps its draft exactly as typed.
 */
import { noteFor, OCCUPANCY_CHOICES, type ConversationDraft } from "./seller-conversation";
import { formatSellerConversationNote, SellerConversationNoteTooLong } from "./seller-conversation-note";
import {
  formatTransactionAssumptionsNoteV2, formatSellerPricePositionNote, isReservedTransactionAssumptionText,
  type TransactionAssumptionDraftField,
} from "./seller-call-readiness-carriers";
import { formatSellerPositionNote } from "./seller-call-seller-position-note";
import { parseAcquisitionPriceInput } from "./seller-call-negotiation";

export type SaveItemId = "note" | "timing" | "price" | "sellerPosition" | "occupancy" | "address" | "reason";
export const SAVE_ITEM_ORDER: readonly SaveItemId[] = ["note", "timing", "price", "sellerPosition", "occupancy", "address", "reason"];
export const SAVE_ITEM_LABEL: Record<SaveItemId, string> = {
  note: "Conversation note",
  timing: "Timing → Transaction assumptions",
  price: "Seller's stated price → Seller price position",
  sellerPosition: "Seller Position",
  occupancy: "Occupancy → Contact occupancy",
  address: "Property address",
  reason: "Reason for selling",
};

export type OccupancyValue = typeof OCCUPANCY_CHOICES[number];
export type SaveWrite =
  | { kind: "note"; body: (at: string) => string }
  | { kind: "occupancy"; value: OccupancyValue };

/**
 * write      will be sent by Save;
 * done       this exact content is confirmed this visit (not re-sent);
 * none       nothing to save (blank, or matches what is on record);
 * not_saved  cannot be saved as it stands (not enabled, invalid, conflicting, too long) -- says why;
 * blocked    the last attempt is uncertain (or being checked): never re-sent until checked.
 */
export type SaveAction = "write" | "done" | "none" | "not_saved" | "blocked";
export type PlanItem = {
  id: SaveItemId;
  label: string;
  action: SaveAction;
  /** One plain line: what would be written, or why not. */
  text: string;
  /** The content identity (no timestamp). Equal signatures = the same write. */
  signature: string | null;
  write: SaveWrite | null;
  /** For the note: the exact text that would be written (timestamp as of `previewAt`). */
  preview?: string;
};
export type SavePlan = { items: PlanItem[]; writes: PlanItem[]; unsaved: boolean };

export type SentRecord = { kind: "note"; contactId: string; body: string; at: string } | { kind: "occupancy"; contactId: string; value: OccupancyValue; at: string };
export type ItemResult =
  | { status: "saving"; signature: string }
  | { status: "confirmed"; signature: string; sent: SentRecord; message: string }
  | { status: "refused"; signature: string; message: string }
  | { status: "uncertain"; signature: string; sent: SentRecord; message: string }
  | { status: "checking"; signature: string; sent: SentRecord; message: string }
  | { status: "not_found"; signature: string; message: string };
export type DealResults = Partial<Record<SaveItemId, ItemResult>>;

type TaFields = { transactionStructure: TransactionAssumptionDraftField; closingPossession: TransactionAssumptionDraftField; titleComplications: TransactionAssumptionDraftField };
export type SavePlanInput = {
  opportunityId: string;
  callId: string;
  draft: ConversationDraft;
  /** What is on record for this deal, as the page already read and parsed it. */
  record: {
    transaction: TaFields | null;
    sellerPrice: { kind: "price"; price: number } | { kind: "refused" } | null;
    sellerPosition: number | null;
    /** contact.occupancy as read (a permitted value, an unrecognised raw value, or null when empty). */
    occupancy: string | null;
  };
  /**
   * The page's Board 14-13 sections as typed, ONLY while Save is enabled (they then join this plan and stop
   * autosaving). null with Save disabled: the sections keep autosaving and are not part of the plan.
   */
  sections: null | {
    ta: { fields: TaFields; problem: string | null };
    price: { kind: "blank" } | { kind: "invalid"; reason: string } | { kind: "price"; price: number } | { kind: "refused" };
    sellerPosition: { kind: "empty" } | { kind: "invalid"; reason: string } | { kind: "value"; value: number };
  };
  results: DealResults;
  /** Timestamp used only for the note preview. */
  previewAt: string;
};

const UNANSWERED: TransactionAssumptionDraftField = { kind: "unanswered" };
const sameField = (a: TransactionAssumptionDraftField, b: TransactionAssumptionDraftField) => JSON.stringify(a) === JSON.stringify(b);
const fieldText = (f: TransactionAssumptionDraftField) => (f.kind === "value" ? `"${f.value}"` : f.kind === "none" ? "None (recorded)" : "not yet answered");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const answer = (d: ConversationDraft, q: string, f: string) => (d.answers[q as keyof ConversationDraft["answers"]]?.fields[f] ?? "");

function item(id: SaveItemId, action: SaveAction, text: string, signature: string | null = null, write: SaveWrite | null = null, preview?: string): PlanItem {
  return { id, label: SAVE_ITEM_LABEL[id], action, text, signature, write, ...(preview !== undefined ? { preview } : {}) };
}

/** Applies this visit's last result for the item: uncertain blocks it; a confirmed identical write is done. */
function withResult(p: PlanItem, r: ItemResult | undefined): PlanItem {
  if (!r) return p;
  if (r.status === "uncertain" || r.status === "checking" || r.status === "saving") {
    return { ...p, action: "blocked", text: r.status === "saving" ? "Saving…" : `Uncertain: ${r.message} It is not sent again until Check again reads the record.` };
  }
  if (p.action !== "write") return p;
  if (r.status === "confirmed" && r.signature === p.signature) return { ...p, action: "done", text: "Saved (confirmed)." };
  if (r.status === "refused") return { ...p, text: `${p.text} (Last attempt refused: ${r.message})` };
  return p;
}

export function buildSavePlan(input: SavePlanInput): SavePlan {
  const d = input.draft;
  const items: PlanItem[] = [];
  const opp = input.opportunityId;

  /* 1. The conversation note. */
  const rows = noteFor(d);
  const hasContent = rows.some((r) => (r.kind === "general" ? r.value.trim() !== "" : r.dontKnow || r.answers.some((a) => a.value.trim() !== "")));
  if (!hasContent) {
    items.push(item("note", "none", "Nothing entered yet: no note is written."));
  } else {
    const signature = JSON.stringify([input.callId, d.opening, rows]);
    const build = (at: string) => formatSellerConversationNote({ opportunityId: opp, callId: input.callId, at, operator: null, opening: d.opening, rows });
    try {
      const preview = build(input.previewAt);
      const answered = rows.filter((r) => r.kind === "question" && (r.dontKnow || r.answers.some((a) => a.value.trim() !== ""))).length;
      items.push(withResult(item("note", "write",
        `One note for this call: every question and its answer (${answered} answered), then General notes.`, signature, { kind: "note", body: build }, preview), input.results.note));
    } catch (e) {
      items.push(item("note", "not_saved", e instanceof SellerConversationNoteTooLong ? `Not saved: ${e.message}` : `Not saved: ${(e as Error).message}`));
    }
  }

  /* 2. Timing -> Transaction assumptions v2. */
  {
    const rec: TaFields = input.record.transaction ?? { transactionStructure: UNANSWERED, closingPossession: UNANSWERED, titleComplications: UNANSWERED };
    const sec = input.sections?.ta ?? null;
    const base: TaFields = sec ? sec.fields : rec;
    const timing = answer(d, "timing", "timing").trim();
    let closing = base.closingPossession;
    let problem: string | null = sec?.problem ?? null;
    if (timing !== "") {
      const fromCall: TransactionAssumptionDraftField = { kind: "value", value: timing };
      if (sec && !sameField(sec.fields.closingPossession, rec.closingPossession) && !sameField(sec.fields.closingPossession, fromCall)) {
        problem = "the Timing answer and the Transaction assumptions closing entry differ. Make them the same, or clear one.";
      } else if (/[\r\n]/.test(timing) || isReservedTransactionAssumptionText(timing)) {
        problem = "the Timing answer must be one line of ordinary text.";
      }
      closing = fromCall;
    }
    const desired: TaFields = { transactionStructure: base.transactionStructure, closingPossession: closing, titleComplications: base.titleComplications };
    const changed = !sameField(desired.transactionStructure, rec.transactionStructure) || !sameField(desired.closingPossession, rec.closingPossession) || !sameField(desired.titleComplications, rec.titleComplications);
    if (problem && (changed || timing !== "")) items.push(item("timing", "not_saved", `Not saved: ${problem}`));
    else if (changed) {
      const keep = (next: TransactionAssumptionDraftField, was: TransactionAssumptionDraftField, name: string) => (sameField(next, was) ? `${name} ${fieldText(next)} (unchanged)` : `${name} → ${fieldText(next)}`);
      items.push(withResult(item("timing", "write",
        `New Transaction assumptions record: ${keep(desired.closingPossession, rec.closingPossession, "closing/possession")}; ${keep(desired.transactionStructure, rec.transactionStructure, "structure")}; ${keep(desired.titleComplications, rec.titleComplications, "title")}.`,
        JSON.stringify(desired), { kind: "note", body: (at) => formatTransactionAssumptionsNoteV2({ opportunityId: opp, at, operator: null, ...desired }) }), input.results.timing));
    } else if (timing !== "") items.push(item("timing", "none", "Matches what is on record: nothing to save."));
  }

  /* 3. Seller's stated price -> Seller price position (a valid positive number only). */
  {
    const raw = answer(d, "price", "amount");
    const rec = input.record.sellerPrice;
    const sec = input.sections?.price ?? { kind: "blank" as const };
    const recSig = rec ? (rec.kind === "price" ? `price:${rec.price}` : "refused") : "none";
    const secSig = sec.kind === "price" ? `price:${sec.price}` : sec.kind === "refused" ? "refused" : null;
    const secChanged = secSig !== null && secSig !== recSig;
    let desired: { kind: "price"; price: number } | { kind: "refused" } | null = null;
    let problem: string | null = null;
    if (raw.trim() !== "") {
      const parsed = parseAcquisitionPriceInput(raw);
      if (parsed.kind !== "value") problem = "not a valid price.";
      else if (secChanged && secSig !== `price:${parsed.value}`) problem = "the seller's stated price and the Seller price position entry differ. Make them the same, or clear one.";
      else desired = { kind: "price", price: parsed.value };
    } else if (sec.kind === "invalid") problem = "not a valid price.";
    else if (secChanged) desired = sec.kind === "price" ? { kind: "price", price: sec.price } : { kind: "refused" };
    if (problem) items.push(item("price", "not_saved", `Not saved: ${problem}`));
    else if (desired) {
      const sig = desired.kind === "price" ? `price:${desired.price}` : "refused";
      if (sig === recSig) items.push(item("price", "none", "Matches what is on record: nothing to save."));
      else {
        const value = desired;
        items.push(withResult(item("price", "write",
          value.kind === "price" ? `New Seller price position: ${usd(value.price)} (what the seller said; not an offer, never the asking price).` : "New Seller price position: the seller declined to give a price.",
          sig, { kind: "note", body: (at) => formatSellerPricePositionNote(value.kind === "price" ? { opportunityId: opp, at, operator: null, kind: "price", price: value.price } : { opportunityId: opp, at, operator: null, kind: "refused" }) }),
          input.results.price));
      }
    }
  }

  /* 4. Seller Position (sections integrated only). */
  if (input.sections) {
    const sp = input.sections.sellerPosition;
    const rec = input.record.sellerPosition;
    if (sp.kind === "invalid") items.push(item("sellerPosition", "not_saved", `Not saved: ${sp.reason}`));
    else {
      const sig = sp.kind === "value" ? String(sp.value) : "cleared";
      const recSig = rec === null ? "cleared" : String(rec);
      if (sig !== recSig) {
        items.push(withResult(item("sellerPosition", "write", sp.kind === "value" ? `New Seller Position: ${usd(sp.value)}.` : "Seller Position cleared.",
          sig, { kind: "note", body: (at) => (sp.kind === "value" ? formatSellerPositionNote({ opportunityId: opp, at, operator: null, kind: "value", value: sp.value }) : formatSellerPositionNote({ opportunityId: opp, at, operator: null, kind: "cleared" })) }),
          input.results.sellerPosition));
      }
    }
  }

  /* 5. Occupancy -> contact.occupancy (the three permitted values). */
  {
    const choice = answer(d, "occupancy", "occupancy");
    if (choice !== "") {
      if (!(OCCUPANCY_CHOICES as readonly string[]).includes(choice)) items.push(item("occupancy", "not_saved", "Not saved: not one of the three permitted values."));
      else if (choice === input.record.occupancy) items.push(item("occupancy", "none", "Matches what is on record: nothing to save."));
      else {
        items.push(withResult(item("occupancy", "write", `Contact occupancy → ${choice}${input.record.occupancy ? ` (was ${input.record.occupancy})` : ""}.`, choice, { kind: "occupancy", value: choice as OccupancyValue }), input.results.occupancy));
      }
    }
  }

  /* 6-7. B15-04 property answers stay restricted: listed, never written. */
  if (["street", "unit", "city", "state", "zip"].some((f) => answer(d, "address", f).trim() !== "")) {
    items.push(item("address", "not_saved", "Not saved: not enabled. The address stays in the conversation note only."));
  }
  if (answer(d, "reason", "reason").trim() !== "") {
    items.push(item("reason", "not_saved", "Not saved: not enabled. The reason stays in the conversation note only."));
  }

  // An item with a result this visit stays listed (so its result stays visible), and a blocked item stays
  // blocked even if its content later reads as unchanged.
  for (const id of SAVE_ITEM_ORDER) {
    const r = input.results[id];
    if (r && !items.some((i) => i.id === id)) items.push(withResult(item(id, "none", "Matches what is on record: nothing to save."), r));
  }
  items.sort((a, b) => SAVE_ITEM_ORDER.indexOf(a.id) - SAVE_ITEM_ORDER.indexOf(b.id));
  const writes = items.filter((i) => i.action === "write");
  const unsaved = items.some((i) => i.action === "write" || i.action === "blocked" || i.action === "not_saved");
  return { items, writes, unsaved };
}

/* ---------------- responses ---------------- */

export type SendOutcome = { kind: "confirmed" } | { kind: "refused"; message: string } | { kind: "uncertain"; message: string };

/**
 * One ghl-write response, classified. Only an explicit, definitive refusal is "refused" (outcome not_sent, or a
 * 4xx other than the server's generic 409 -- which may follow a send). A 200 is confirmed unless it says
 * `confirmed: false`. Everything else -- indeterminate, the generic 409, 5xx, 202, an unreadable body -- is uncertain.
 */
export function classifyWriteResponse(status: number, text: string): SendOutcome {
  let body: any;
  try { body = JSON.parse(text); } catch { return { kind: "uncertain", message: `The answer could not be read (status ${status}); it may have been saved.` }; }
  if (!body || typeof body !== "object") return { kind: "uncertain", message: `The answer could not be read (status ${status}); it may have been saved.` };
  const reason = typeof body.error === "string" && body.error ? body.error : `status ${status}`;
  if (body.outcome === "indeterminate") return { kind: "uncertain", message: `${reason}.` };
  if (body.outcome === "not_sent") return { kind: "refused", message: reason };
  if (status === 200) return body.confirmed === false ? { kind: "uncertain", message: "Sent, but the saved value could not be confirmed." } : { kind: "confirmed" };
  if (status >= 400 && status < 500 && status !== 409 && status !== 408) return { kind: "refused", message: reason };
  return { kind: "uncertain", message: `${reason} (status ${status}); it may have been saved.` };
}

export class SaveTimeout extends Error {}
/** Resolves or rejects like `p`, or rejects with SaveTimeout after `ms` (the request itself may still complete). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new SaveTimeout(`No answer within ${Math.round(ms / 1000)} seconds`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* ---------------- the coordinator ---------------- */

export interface SaveClient {
  /** One named write, classified. Never throws. */
  send(operation: "note.create" | "contact.occupancy", targetId: string, args: { body: string } | { value: string }): Promise<SendOutcome>;
  /** Fresh reads for Check again (reads only, never writes). */
  readNotes(contactId: string): Promise<{ body: string }[]>;
  readOccupancy(contactId: string): Promise<string | null>;
  now(): string;
}
export type SaveHooks = { onConfirmed?: (item: { id: SaveItemId; signature: string }, sent: SentRecord) => void };

/**
 * ONE save in flight for the whole page. Results are kept per deal key for this visit. A late answer only
 * updates the deal it was started for. Defense in depth: even a stale plan cannot re-send an uncertain item
 * or a confirmed identical one.
 */
export class SellerConversationSaveCoordinator {
  private deals = new Map<string, DealResults>();
  private inflight: string | null = null;
  constructor(private readonly onChange: () => void = () => {}) {}

  results(dealKey: string): DealResults { return this.deals.get(dealKey) ?? {}; }
  busy(): boolean { return this.inflight !== null; }

  private set(dealKey: string, id: SaveItemId, r: ItemResult) {
    this.deals.set(dealKey, { ...this.results(dealKey), [id]: r });
    this.onChange();
  }

  /** Sends the plan's writes in order. Returns "busy" (nothing sent) while another save runs. */
  async save(dealKey: string, contactId: string, plan: SavePlan, client: SaveClient, hooks: SaveHooks = {}): Promise<"busy" | "done"> {
    if (this.inflight !== null) return "busy";
    this.inflight = dealKey;
    this.onChange();
    try {
      for (const p of plan.writes) {
        const prev = this.results(dealKey)[p.id];
        if (!p.write || p.signature === null) continue;
        if (prev && (prev.status === "uncertain" || prev.status === "checking" || prev.status === "saving")) continue;
        if (prev && prev.status === "confirmed" && prev.signature === p.signature) continue;
        const signature = p.signature;
        const at = client.now();
        let sent: SentRecord;
        let outcome: SendOutcome;
        this.set(dealKey, p.id, { status: "saving", signature });
        try {
          if (p.write.kind === "note") {
            const body = p.write.body(at);
            sent = { kind: "note", contactId, body, at };
            outcome = await client.send("note.create", contactId, { body });
          } else {
            sent = { kind: "occupancy", contactId, value: p.write.value, at };
            outcome = await client.send("contact.occupancy", contactId, { value: p.write.value });
          }
        } catch (e) {
          // The body could not be built, or the client broke its contract: nothing is known to have been sent.
          this.set(dealKey, p.id, { status: "refused", signature, message: `Not sent: ${(e as Error)?.message ?? "the save could not start"}` });
          continue;
        }
        if (outcome.kind === "confirmed") {
          this.set(dealKey, p.id, { status: "confirmed", signature, sent, message: "Saved (confirmed)." });
          hooks.onConfirmed?.({ id: p.id, signature }, sent);
        } else if (outcome.kind === "refused") {
          this.set(dealKey, p.id, { status: "refused", signature, message: outcome.message });
        } else {
          this.set(dealKey, p.id, { status: "uncertain", signature, sent, message: outcome.message });
        }
      }
    } finally {
      this.inflight = null;
      this.onChange();
    }
    return "done";
  }

  /**
   * Check again: reads the record (never writes). Found exactly -> confirmed. Not found -> "not_found", which
   * Save may send again as a FRESH request. A failed read leaves it uncertain.
   */
  async check(dealKey: string, id: SaveItemId, client: SaveClient, hooks: SaveHooks = {}): Promise<void> {
    const r = this.results(dealKey)[id];
    if (!r || r.status !== "uncertain" || this.inflight !== null) return;
    const { sent, signature } = r;
    this.inflight = dealKey;
    this.set(dealKey, id, { status: "checking", signature, sent, message: "Checking the record…" });
    try {
      let found: boolean;
      try {
        if (sent.kind === "note") found = (await client.readNotes(sent.contactId)).some((n) => n.body === sent.body);
        else found = (await client.readOccupancy(sent.contactId)) === sent.value;
      } catch (e) {
        this.set(dealKey, id, { status: "uncertain", signature, sent, message: `${r.message} The check could not read the record (${(e as Error)?.message ?? "read failed"}).` });
        return;
      }
      if (found) {
        this.set(dealKey, id, { status: "confirmed", signature, sent, message: "Found on the record (confirmed by Check again)." });
        hooks.onConfirmed?.({ id, signature }, sent);
      } else {
        this.set(dealKey, id, { status: "not_found", signature, message: "Not found on the record. Save sends it again." });
      }
    } finally {
      this.inflight = null;
      this.onChange();
    }
  }
}

/** The browser capability (runtime config): true only when the server projected exactly { enabled: true }. */
export function sellerConversationSaveAvailable(runtime: unknown): boolean {
  const v = (runtime as { sellerConversationSave?: unknown } | null)?.sellerConversationSave;
  return !!v && typeof v === "object" && (v as { enabled?: unknown }).enabled === true;
}
