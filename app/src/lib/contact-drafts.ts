/**
 * B15-27b P2 -- contact / deal draft preservation (Captain decision, 2026-11-04).
 *
 * Unfinished work typed for a contact (or one of its deals) stays with THAT
 * contact or deal: switching from Seller A to Seller B never shows A's text on
 * B, and returning to A brings A's text back, including after a reload.
 *
 * The approach is B15-25's identity-scoped browser storage
 * (src/lib/calculator-drafts.ts on candidate 80bfe48, not on main yet; mirrored
 * here, not imported):
 *   - a draft is kept in THIS BROWSER only. It is never sent to GHL, never a
 *     saved value and never an approval: only the page's existing Save / blur /
 *     Confirm sends anything, exactly as before;
 *   - its key is its full identity -- environment (the GHL location, so Test
 *     and Production never share), operator (the write-session operator, else
 *     the last one seen, else this browser), contact and, for a deal draft, the
 *     opportunity. A missing part is refused; it never falls back to a broader
 *     key. Another operator's drafts are never shown;
 *   - saves are confirmed by reading back, removals by checking nothing is
 *     left; a stored record that does not match its key exactly is refused,
 *     never partly applied;
 *   - storage that is unavailable (private mode, blocked) falls back to this
 *     tab's memory, so A -> B -> A still works; nothing survives a reload then.
 * Unlike B15-25 there is no GHL base or conflict state: these drafts are text
 * for a note or an outcome that does not exist in GHL yet.
 *
 * Kinds (scopes):
 *   note      the Contact page note box                     (per contact)
 *   calllog   the Contact page call log: result + notes     (per contact)
 *   outcome   Seller Call outcome form: form, Pass reason, Follow-Up time (per deal)
 *   readiness Seller Call readiness decision reason         (per deal)
 *
 * A draft also records what happened to its last save, so it is never lost
 * silently and never sent twice blindly:
 *   sending  a save started and this page did not see it finish (for example
 *            the page was reloaded meanwhile): it may already be in GHL;
 *   failed   the last save failed (with its message): the text is kept.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AppWriteSignInRequired, appWriteIdentity, subscribeAppWriteSession, type AppWriteIdentity } from "./app-write-session";
import { oneLoginActive } from "./one-login";
import { confirmedOperatorTag } from "./operator-partition";

export const CONTACT_DRAFT_VERSION = 1;
export const CONTACT_DRAFT_PREFIX = "iaos-contact-draft:v1:";

export type DraftScope = "note" | "calllog" | "outcome" | "readiness";
/** Every value a draft of each kind holds (all strings). */
export const SCOPE_FIELDS: Record<DraftScope, readonly string[]> = {
  note: ["text"],
  calllog: ["result", "text"],
  outcome: ["form", "passReason", "followUpAt"],
  readiness: ["reason"],
};
/** The values that make a draft worth keeping. An empty one is removed (a choice alone is not kept). */
const CONTENT_FIELDS: Record<DraftScope, readonly string[]> = {
  note: ["text"],
  calllog: ["result", "text"],
  outcome: ["passReason", "followUpAt"],
  readiness: ["reason"],
};
const DEAL_SCOPES: ReadonlySet<DraftScope> = new Set<DraftScope>(["outcome", "readiness"]);

export type DraftRecord = { contactId: string; opportunityId?: string };
export type ContactDraftIdentity = { scope: DraftScope; env: string; operator: string; contactId: string; opportunityId?: string };
export type DraftValues = Record<string, string>;
/** `sent`: exactly what the uncertain save sent (B15-27b r2), so only an identical re-send is refused.
    `sentAt`: when that save started (B15-27b r3). Informational: since r4 no read of the notes reconciles an uncertain save. */
export type DraftNotice = { kind: "sending"; sent?: DraftValues; sentAt?: string } | { kind: "failed"; message: string } | null;
export type StoredDraft = {
  version: number; identity: ContactDraftIdentity; savedAt: string; values: DraftValues; notice: DraftNotice;
  /** The server operation a submitted call log belongs to (call log only). */
  op?: string;
};

export class ContactDraftIdentityError extends Error {}

/**
 * B15-27b r2 (Bones finding 2) -- only a save error that PROVES nothing was sent
 * is a definite failure. At the page, that is the client's own sign-in refusal
 * (AppWriteSignInRequired, thrown before any request). Everything else -- the
 * server's 409 "indeterminate" (the write may have reached GHL), any other HTTP
 * refusal or error (confirmedCommand reports them all as a plain Error, so the
 * page cannot tell a proven "not_sent" from an uncertain one), a parse failure,
 * a network error or an abort on reload -- is UNCERTAIN: the draft stays
 * "sending" (it may already be in GHL) and is never re-sent automatically.
 */
export function isDefiniteFailure(e: unknown): boolean {
  return e instanceof AppWriteSignInRequired;
}
export function isUncertainFailure(e: unknown): boolean {
  return !isDefiniteFailure(e);
}

/** The owner a one-IAOS-sign-in draft gets if no confirmed operator is known: matches nothing stored, shows nothing. */
export const ONE_LOGIN_UNCONFIRMED_OPERATOR = "one-login:unconfirmed";
/**
 * The operator a draft belongs to (B15-25 rule): the write-session operator, else the last one seen, else this browser.
 * B15-29 (Jess 2026-11-10): while one IAOS sign-in is on, it is the server-confirmed operator of this page's session
 * (operator-partition.ts), known before the app mounts and the same across reloads, renewals and re-logins of the same
 * account; a different account never matches. Off: exactly the previous rule.
 */
export function draftOperator(w: AppWriteIdentity = appWriteIdentity()): string {
  if (oneLoginActive()) {
    const tag = confirmedOperatorTag();
    return tag ? `one-login:${tag}` : ONE_LOGIN_UNCONFIRMED_OPERATOR;
  }
  return w.operator ?? w.lastOperator ?? "this-browser";
}

const part = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "") throw new ContactDraftIdentityError(`draft identity needs ${name}`);
  return encodeURIComponent(v);
};
/** A draft needs its full identity for its kind; a missing part never falls back to a broader key. */
export function contactDraftKey(id: ContactDraftIdentity): string {
  if (!id || !(id.scope in SCOPE_FIELDS)) throw new ContactDraftIdentityError("draft identity needs a kind");
  const deal = DEAL_SCOPES.has(id.scope);
  if (!deal && id.opportunityId !== undefined) throw new ContactDraftIdentityError("a contact draft has no opportunity");
  const parts = [part(id.env, "env"), part(id.operator, "operator"), part(id.contactId, "contactId")];
  if (deal) parts.push(part(id.opportunityId, "opportunityId"));
  return `${CONTACT_DRAFT_PREFIX}${id.scope}|${parts.join("|")}`;
}

function sameIdentity(a: unknown, b: ContactDraftIdentity): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return x.scope === b.scope && x.env === b.env && x.operator === b.operator && x.contactId === b.contactId
    && (x.opportunityId ?? null) === (b.opportunityId ?? null);
}

/** Only the kind's own fields, as strings ("" when absent). */
export function normalizeValues(scope: DraftScope, values: Record<string, unknown> | null | undefined): DraftValues {
  const out: DraftValues = {};
  for (const f of SCOPE_FIELDS[scope]) { const v = values ? values[f] : undefined; out[f] = typeof v === "string" ? v : ""; }
  return out;
}
export function isEmptyDraft(scope: DraftScope, values: DraftValues): boolean {
  return CONTENT_FIELDS[scope].every((f) => (values[f] ?? "") === "");
}
export function sameValues(scope: DraftScope, a: DraftValues, b: DraftValues): boolean {
  return SCOPE_FIELDS[scope].every((f) => (a[f] ?? "") === (b[f] ?? ""));
}

const validSent = (v: unknown): boolean => v === undefined
  || (!!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every((x) => typeof x === "string"));
const validNotice = (n: unknown): n is DraftNotice =>
  n === null || (!!n && typeof n === "object" && (((n as { kind?: unknown }).kind === "sending" && validSent((n as { sent?: unknown }).sent)
      && ((n as { sentAt?: unknown }).sentAt === undefined || typeof (n as { sentAt?: unknown }).sentAt === "string"))
    || ((n as { kind?: unknown }).kind === "failed" && typeof (n as { message?: unknown }).message === "string")));

/** Parses a stored record for `id`. Anything unexpected is refused, never partly applied. */
export function parseStoredDraft(raw: string | null, id: ContactDraftIdentity): { ok: true; draft: StoredDraft | null } | { ok: false; reason: string } {
  if (raw == null) return { ok: true, draft: null };
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return { ok: false, reason: "malformed" }; }
  if (!d || typeof d !== "object" || (d as StoredDraft).version !== CONTACT_DRAFT_VERSION) return { ok: false, reason: "version" };
  const s = d as StoredDraft;
  if (!sameIdentity(s.identity, id)) return { ok: false, reason: "identity" };
  if (typeof s.savedAt !== "string" || !s.values || typeof s.values !== "object" || Array.isArray(s.values)) return { ok: false, reason: "malformed" };
  const fields = SCOPE_FIELDS[id.scope];
  for (const [k, v] of Object.entries(s.values)) if (!fields.includes(k) || typeof v !== "string") return { ok: false, reason: "malformed" };
  if (!validNotice(s.notice ?? null)) return { ok: false, reason: "malformed" };
  if (s.op !== undefined && typeof s.op !== "string") return { ok: false, reason: "malformed" };
  return { ok: true, draft: { ...s, values: normalizeValues(id.scope, s.values), notice: s.notice ?? null } };
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ContactDraftStore = {
  /** True when drafts survive a reload (browser storage); false = this tab's memory only. */
  persistent: boolean;
  load(id: ContactDraftIdentity): { ok: true; draft: StoredDraft | null } | { ok: false; reason: string };
  /** True only when the record reads back exactly. */
  save(draft: StoredDraft): boolean;
  /** True only when nothing is left under the key. */
  remove(id: ContactDraftIdentity): boolean;
};

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => (m.has(k) ? m.get(k)! : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

/** Browser-storage adapter; storage that throws at start falls back to this tab's memory. */
export function openContactDraftStore(getStorage: () => StorageLike): ContactDraftStore {
  let storage: StorageLike;
  let persistent = true;
  try {
    storage = getStorage();
    const probe = `${CONTACT_DRAFT_PREFIX}probe`;
    storage.setItem(probe, "1"); storage.removeItem(probe);
  } catch { storage = memoryStorage(); persistent = false; }
  return {
    persistent,
    load(id) { try { return parseStoredDraft(storage.getItem(contactDraftKey(id)), id); } catch { return { ok: false, reason: "unreadable" }; } },
    save(draft) {
      try { const k = contactDraftKey(draft.identity); const text = JSON.stringify(draft); storage.setItem(k, text); return storage.getItem(k) === text; } catch { return false; }
    },
    remove(id) {
      try { const k = contactDraftKey(id); storage.removeItem(k); return storage.getItem(k) === null; } catch { return false; }
    },
  };
}

/* The text a confirmed save just removed, per key: until it is edited, it is never kept again, even if a
   render that still shows it runs its effect after the removal (the save can be confirmed before React has
   committed every render queued during it). */
const clearedSent = new Map<string, string>();

let shared: ContactDraftStore | null = null;
/** The page's store: browser storage when available, else this tab's memory. */
export function contactDraftStore(): ContactDraftStore {
  if (!shared) shared = openContactDraftStore(() => window.localStorage);
  return shared;
}

/** What a page holds for one kept draft, and the actions its save handlers take. */
export type RecordDraft = {
  /** The identity the page's values belong to now (null while no record is shown). */
  owner: ContactDraftIdentity | null;
  /** The shown record's notice (sending / failed), or null. */
  notice: DraftNotice;
  /** The shown record has unsaved content kept as a draft. */
  kept: boolean;
  /** The server operation a kept call log was submitted as. */
  op: string | null;
  /** The identity of `record` under the current operator (for a save to bind to at its start). */
  identityFor(record: DraftRecord): ContactDraftIdentity | null;
  /** A save of these values started: kept, marked "sending" (with its operation, for the call log). */
  markSending(id: ContactDraftIdentity | null, values: DraftValues, op?: string): void;
  /** The save failed: the draft is kept, with the message. */
  markFailed(id: ContactDraftIdentity | null, message: string): void;
  /** The save landed: the draft is removed if it still holds what was sent; otherwise (edited since) it stays, unmarked. */
  clearSent(id: ContactDraftIdentity | null, sent: DraftValues): void;
  /** Removes the draft (an outcome recorded for that deal). */
  remove(id: ContactDraftIdentity | null): void;
  /** Keeps the draft but drops its notice and operation (the server proved its operation is over or never happened). */
  clearNotice(id: ContactDraftIdentity | null): void;
  /** The operation a kept draft was submitted as (call log), read from storage: any record, shown or not. */
  storedOp(id: ContactDraftIdentity | null): string | null;
  /** The record's save notice as stored (identity-bound; any record, shown or not). */
  noticeOf(id: ContactDraftIdentity | null): DraftNotice;
  /** The record's kept values as stored, or null. */
  storedValues(id: ContactDraftIdentity | null): DraftValues | null;
};

/**
 * Keeps the page's values for the shown record as that record's draft.
 *
 * - When the shown record (or the operator) changes, the new record's draft is
 *   loaded and handed to `apply` (null = nothing kept) BEFORE paint, so a
 *   record never shows another's values, not even for a frame.
 * - Every change of `values` is kept for the record they belong to (`owner`,
 *   set together with them), never for a record shown later.
 * - Empty values remove the draft.
 */
export function useRecordDraft(opts: {
  scope: DraftScope;
  env: string;
  record: DraftRecord | null;
  values: DraftValues;
  apply: (values: DraftValues | null, draft: StoredDraft | null) => void;
}): RecordDraft {
  const { scope, env } = opts;
  const store = contactDraftStore();
  const [operator, setOperator] = useState(() => draftOperator());
  useEffect(() => subscribeAppWriteSession(() => setOperator(draftOperator())), []);
  const recordKey = opts.record ? `${opts.record.contactId}|${opts.record.opportunityId ?? ""}` : null;
  const identityFor = (record: DraftRecord): ContactDraftIdentity | null => {
    try {
      const id: ContactDraftIdentity = DEAL_SCOPES.has(scope)
        ? { scope, env, operator: draftOperator(), contactId: record.contactId, opportunityId: record.opportunityId }
        : { scope, env, operator: draftOperator(), contactId: record.contactId };
      contactDraftKey(id);
      return id;
    } catch { return null; }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownId = useMemo(() => (opts.record ? identityFor(opts.record) : null), [recordKey, operator, scope, env]);
  const shownKey = shownId ? contactDraftKey(shownId) : null;
  const [owner, setOwner] = useState<{ key: string | null; id: ContactDraftIdentity | null; notice: DraftNotice; op: string | null }>({ key: null, id: null, notice: null, op: null });
  const [initialised, setInitialised] = useState(false);

  useLayoutEffect(() => {
    if (initialised && shownKey === owner.key) return;
    /* Text typed while no record was resolved (for example while Seller B's own
       data was still loading: the values were cleared when A was left) belongs
       to the record now shown, so it is adopted for it, never overwritten. */
    // B15-27b r3: anything entered while loading counts -- also a form merely opened (contact-isolation S-cases).
    if (initialised && owner.key === null && shownId !== null && Object.values(normalizeValues(scope, opts.values)).some((v) => v !== "")) {
      setOwner({ key: shownKey, id: shownId, notice: null, op: null });
      return;
    }
    const loaded = shownId ? store.load(shownId) : { ok: true as const, draft: null };
    const draft = loaded.ok ? loaded.draft : null;
    opts.apply(draft ? draft.values : null, draft);
    setOwner({ key: shownKey, id: shownId, notice: draft ? draft.notice : null, op: draft?.op ?? null });
    setInitialised(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  const valuesJson = JSON.stringify(normalizeValues(scope, opts.values));
  useEffect(() => {
    if (!initialised || owner.id === null || owner.key !== shownKey) return;   // values not yet this record's
    const values = normalizeValues(scope, opts.values);
    const prev = store.load(owner.id);
    const before = prev.ok ? prev.draft : null;
    const ownerKey = owner.key;
    if (isEmptyDraft(scope, values)) {
      if (before) store.remove(owner.id);
      if (owner.notice !== null || owner.op !== null) setOwner((o) => (o.key === ownerKey ? { ...o, notice: null, op: null } : o));
      return;
    }
    if (before && sameValues(scope, before.values, values)) return;   // nothing new (a restore, or a save mark)
    if (!before && clearedSent.get(owner.key ?? "") === JSON.stringify(values)) return;   // the text a confirmed save just removed
    clearedSent.delete(owner.key ?? "");
    // An edit: kept. B15-27b r2: its save notice is kept too -- an uncertain draft
    // stays uncertain until reconciled, explicitly re-sent, emptied or removed.
    store.save({ version: CONTACT_DRAFT_VERSION, identity: owner.id, savedAt: new Date().toISOString(), values,
      notice: before ? before.notice : null, ...(before?.op ? { op: before.op } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesJson, owner, initialised, shownKey]);

  /* B15-27b r2 (Bones finding 1): a notice change for `id` applies to the
     record shown NOW only if it IS `id` -- compared inside the state updater,
     against the current owner, never a render captured by an earlier save. */
  const setNotice = (id: ContactDraftIdentity | null, notice: DraftNotice, op: string | null) => {
    if (!id) return;
    const key = contactDraftKey(id);
    setOwner((o) => (o.key === key ? { ...o, notice, op } : o));
  };
  return {
    owner: owner.id,
    notice: owner.key === shownKey ? owner.notice : null,
    kept: owner.key !== null && owner.key === shownKey && !isEmptyDraft(scope, normalizeValues(scope, opts.values)),
    op: owner.key === shownKey ? owner.op : null,
    identityFor,
    markSending(id, values, op) {
      if (!id) return;
      clearedSent.delete(contactDraftKey(id));
      const sent = normalizeValues(scope, values);
      const sentAt = new Date().toISOString();
      store.save({ version: CONTACT_DRAFT_VERSION, identity: id, savedAt: sentAt, values: sent, notice: { kind: "sending", sent, sentAt }, ...(op ? { op } : {}) });
      setNotice(id, { kind: "sending", sent, sentAt }, op ?? null);
    },
    markFailed(id, message) {
      if (!id) return;
      const prev = store.load(id);
      const d = prev.ok ? prev.draft : null;
      if (!d || isEmptyDraft(scope, d.values)) return;
      store.save({ ...d, savedAt: new Date().toISOString(), notice: { kind: "failed", message }, op: undefined });
      setNotice(id, { kind: "failed", message }, null);
    },
    clearSent(id, sent) {
      if (!id) return;
      const prev = store.load(id);
      const d = prev.ok ? prev.draft : null;
      if (!d) return;
      if (sameValues(scope, d.values, normalizeValues(scope, sent))) { store.remove(id); clearedSent.set(contactDraftKey(id), JSON.stringify(normalizeValues(scope, sent))); }
      else store.save({ ...d, notice: null, op: undefined });
      setNotice(id, null, null);
    },
    remove(id) {
      if (!id) return;
      store.remove(id);
      setNotice(id, null, null);
    },
    noticeOf(id) {
      if (!id) return null;
      const prev = store.load(id);
      return prev.ok && prev.draft ? prev.draft.notice : null;
    },
    storedValues(id) {
      if (!id) return null;
      const prev = store.load(id);
      return prev.ok && prev.draft ? prev.draft.values : null;
    },
    storedOp(id) {
      if (!id) return null;
      const prev = store.load(id);
      return prev.ok && prev.draft ? prev.draft.op ?? null : null;
    },
    clearNotice(id) {
      if (!id) return;
      const prev = store.load(id);
      const d = prev.ok ? prev.draft : null;
      if (d) store.save({ ...d, notice: null, op: undefined });
      setNotice(id, null, null);
    },
  };
}
