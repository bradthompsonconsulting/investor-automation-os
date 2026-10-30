import { useCallback, useEffect, useRef, useState } from "react";
import {
  propertyAnswer, followUpAfter, operatorDigestOf, isStatusAccess, AppWriteSignInRequired, EMPTY_ADDRESS, GATE_CODES, HOLDING, STATE_TEXT,
  type Address, type AnswerContext, type AnswerField, type DraftState, type OpView, type Reply, type StatusAccess,
} from "../lib/property-answer-client";
import { appWriteIdentity, subscribeAppWriteSession } from "../lib/app-write-session";

/**
 * B15-04 Rev 6 -- deal-scoped property answers, first slice: first-time
 * property address + Seller Reason. CONTROLLED TEST EVALUATION ONLY (Option B
 * for Test, Brad 2026-10-17): the server refuses every contact and deal that is
 * not a pinned synthetic fixture, and every Production deployment; on those
 * refusals this panel renders nothing.
 *
 * Nothing here decides eligibility, identity or success. Each save carries the
 * address digest and deal-set digest this panel was shown; the server
 * re-evaluates both under the contact lock and answers with its recorded
 * state. Unsaved text is kept as a server-side draft bound to the signed-in operator.
 *
 * Answer preservation (C1–C4 r4, Bones design clearance 2026-10-20):
 *  - C1 a re-read replaces a field only while it still holds what this panel last put there (the seed) or
 *    already equals the server value; a refused or failed re-read keeps the form, the text, the last save
 *    outcome and any hold, adds a banner and turns saving off.
 *  - C2 losing the write session turns saving off and keeps the form; a new session re-reads once and the
 *    server decides. Nothing is restored, reset or resent.
 *  - C3 when the server refuses the context, this operator's bound drafts are recovered (zero GHL, no budget),
 *    read-only, labelled as a prior observed association whose current ownership is unchecked.
 *  - C4 a status action is offered only as the server's `access` allows: Check again (settle), a read-only
 *    recorded status (read), or none. A thrown save never grants one.
 *  - Only a context 200 enables saving. A reply sent under another session generation, operator or target is
 *    discarded without touching fields, seeds, holds, access or save enablement.
 * Text never persisted before a reload is NOT protected by any of this.
 */
type Load = { kind: "loading" } | { kind: "hidden" } | { kind: "failed"; message: string } | { kind: "ready"; ctx: AnswerContext | null; recovered: boolean };
type Sent = { ok: true; r: Reply } | { ok: false; error: unknown } | null;   // null: stale, discarded

const SAVE_UNCERTAIN = "The save may not have reached the server, or it may have reached GHL: the earlier write remains unresolved. Do not save again.";
const SIGN_IN = "Sign in for application writes before saving. Your edits have not been submitted.";
const SIGNED_OUT = "Saving is off. Your text is kept. Signing in again lets you recover your saved drafts; it does not resume this evaluation.";
const READ_INCOMPLETE = "Verification is incomplete. Your text is kept; saving is off.";
const NO_STATUS = "Status can't be reconciled in this session. Signing in again does not resume this evaluation.";
const RECOVERY_NOTICE = "Saved draft for a previously observed contact/deal association. Current ownership and eligibility have not been checked. Saving is off.";
const DRAFT_STATE_TEXT: Record<string, string> = {
  cleared: "cleared after a save", absent: "no saved draft", unavailable: "could not be read (not the same as no draft)",
  invalid: "not trusted (record does not match)", legacy_unverified: "an older draft without operator provenance (not shown)",
  association_absent: "no prior association of this contact and deal", association_ambiguous: "association ambiguous",
  association_unconfirmed: "association could not be confirmed",
};

const box = { marginTop: "12px", padding: "12px 16px", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "10px", background: "#0D1B3E" } as const;
const input = { background: "#0A1530", color: "#E2E8F0", border: "1px solid rgba(148,163,184,0.35)", borderRadius: "6px", padding: "6px 8px", fontSize: "13px" } as const;
const button = { background: "#1E3A8A", color: "#F1F5F9", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", cursor: "pointer" } as const;
const muted = { fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 } as const;
const sameAddress = (a: Address, b: Address) => JSON.stringify(a) === JSON.stringify(b);

/** The contact's Seller Leads deals from the page's pipeline read; the operator selects one (r3: the selected deal plus a confirmed address). */
export function PropertyAnswersPanel({ contactId, deals }: { contactId: string; deals: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState<string | null>(deals.length === 1 ? deals[0].id : null);
  useEffect(() => { setSelected(deals.length === 1 ? deals[0].id : null); }, [contactId, deals.length === 1 ? deals[0].id : ""]);
  // A different operator (A -> expired -> B) remounts with nothing of A's; A -> expired -> A keeps A's form.
  const [operator, setOperator] = useState<string | null>(() => appWriteIdentity().lastOperator);
  useEffect(() => subscribeAppWriteSession(() => setOperator(appWriteIdentity().lastOperator)), []);
  // C1–C4 r4 A3: a selection counts only for THIS contact's deals -- never one render with the previous contact's deal.
  const current = selected && deals.some((d) => d.id === selected) ? selected : deals.length === 1 ? deals[0].id : null;
  if (!current) {
    if (deals.length < 2) return null;
    return (
      <div data-testid="pa-select" style={box}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9", marginBottom: "6px" }}>Property answers <span style={{ ...muted, fontWeight: 400 }}>(Test evaluation)</span></div>
        <div style={muted}>This contact has {deals.length} seller deals. Select the deal these answers belong to:</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>{deals.map((d) => <button key={d.id} style={button} onClick={() => setSelected(d.id)}>{d.name || d.id}</button>)}</div>
      </div>
    );
  }
  return <DealAnswers key={`${contactId}:${current}:${operator ?? ""}`} contactId={contactId} opportunityId={current} canChange={deals.length > 1} onChange={() => setSelected(null)} />;
}

function DealAnswers({ contactId, opportunityId, canChange, onChange }: { contactId: string; opportunityId: string; canChange: boolean; onChange: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);   // the last save/check outcome; a later read failure never replaces it
  const [banner, setBanner] = useState<string | null>(null);     // refusal / verification / sign-in status
  const [closed, setClosed] = useState(false);                   // saving off until a context 200
  const [access, setAccess] = useState<StatusAccess | null>(null);
  const [opView, setOpView] = useState<OpView | null>(null);
  const [localHold, setLocalHold] = useState(false);             // this page's own save threw: it may have reached GHL
  const holdRef = useRef(false);
  holdRef.current = localHold;
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [reason, setReason] = useState("");
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null);
  const seed = useRef<{ address: Address; reason: string }>({ address: EMPTY_ADDRESS, reason: "" });
  const live = useRef<{ address: Address; reason: string }>({ address: EMPTY_ADDRESS, reason: "" });
  live.current = { address, reason };
  const shown = useRef(false);     // a form (context or recovered) has been shown in this mount
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  /** Sends one action; the reply is applied only for the SAME session generation, operator and mount (target). */
  const send = useCallback(async (body: Record<string, unknown>): Promise<Sent> => {
    const at = appWriteIdentity();
    // Re-validated after EVERY await (Bones F1, review of df623e6): this mount (= contact/deal/operator key) and the
    // session generation and operator the request was sent under must all still be current.
    const stillCurrent = () => { const now = appWriteIdentity(); return mounted.current && now.generation === at.generation && now.operator === at.operator; };
    let r: Reply;
    try { r = await propertyAnswer({ ...body, contactId, opportunityId }); }
    catch (error) {
      if (error instanceof AppWriteSignInRequired) return mounted.current ? { ok: false, error } : null;
      return stillCurrent() ? { ok: false, error } : null;
    }
    if (!stillCurrent()) return null;
    if (r.body?.operatorDigest !== undefined) {
      if (!at.operator) return null;
      const expected = await operatorDigestOf(at.operator);
      if (!stillCurrent() || r.body.operatorDigest !== expected) return null;
    }
    return stillCurrent() ? { ok: true, r } : null;
  }, [contactId, opportunityId]);

  /** C1 seed rule: a server value replaces a field only while it still holds the seed, or already equals it. */
  const adopt = (next: { reason?: string | null; address?: Address | null }) => {
    if (typeof next.reason === "string") {
      const cur = live.current.reason;
      if (cur === seed.current.reason || cur === next.reason) { setReason(next.reason); seed.current.reason = next.reason; live.current.reason = next.reason; }
    }
    if (next.address) {
      const cur = live.current.address;
      if (sameAddress(cur, seed.current.address) || sameAddress(cur, next.address)) { setAddress(next.address); seed.current.address = next.address; live.current.address = next.address; }
    }
  };

  /** C3: this operator's bound drafts, independent of any status check; never enables saving. */
  const recover = useCallback(async (why: string) => {
    const res = await send({ action: "drafts" });
    if (res === null) return;
    const d: Record<AnswerField, DraftState> | null = res.ok && res.r.status === 200 && res.r.body?.drafts ? res.r.body.drafts : null;
    const value = (x: DraftState | undefined) => (x && x.state === "present" ? (x as { value: unknown }).value : null);
    const r = value(d?.seller_reason), a = value(d?.property_address);
    const describe = d ? (["seller_reason", "property_address"] as const).filter((f) => d[f]?.state !== "present").map((f) => `${f === "seller_reason" ? "Seller reason" : "Address"}: ${DRAFT_STATE_TEXT[d[f]?.state] ?? "not trusted"}`).join(" · ") : "Saved drafts could not be read.";
    if (!shown.current) {
      if (r === null && a === null) { setLoad({ kind: "failed", message: `${why} ${describe}`.trim() }); return; }
      shown.current = true;
      setLoad({ kind: "ready", ctx: null, recovered: true });
    }
    adopt({ reason: typeof r === "string" ? r : null, address: a && typeof a === "object" ? (a as Address) : null });
    setRecoveryNote(r !== null || a !== null ? `${RECOVERY_NOTICE}${describe ? ` ${describe}` : ""}` : describe || null);
  }, [send]);

  const refresh = useCallback(async () => {
    const res = await send({ action: "context" });
    if (res === null) return;
    if (!res.ok) {
      if (res.error instanceof AppWriteSignInRequired) {
        if (shown.current) { setClosed(true); setAccess(null); setBanner(SIGNED_OUT); } else setLoad({ kind: "hidden" });
        return;
      }
      setClosed(true);
      if (shown.current) setBanner(READ_INCOMPLETE); else await recover("Property answers could not be loaded. Verification is incomplete.");
      return;
    }
    const r = res.r;
    if (r.status === 403 && GATE_CODES.has(r.body?.code)) { setLoad({ kind: "hidden" }); return; }
    if (r.status !== 200) {
      // Refused or failed: keep everything shown, turn saving off, and recover drafts independently of Check.
      setClosed(true);
      setAccess(isStatusAccess(r.body?.access) ? r.body.access : null);
      setBanner(r.body?.error ?? "Property answers could not be refreshed. Saving is off.");
      await recover(r.body?.error ?? "Property answers could not be loaded.");
      return;
    }
    const ctx = r.body as AnswerContext;
    shown.current = true;
    setLoad({ kind: "ready", ctx, recovered: false });
    setClosed(false); setBanner(null); setAccess("settle"); setRecoveryNote(null); setOpView(ctx.operation);
    adopt({
      reason: ctx.drafts.seller_reason ?? ctx.values.seller_reason ?? "",
      address: ctx.drafts.property_address ?? (ctx.address?.kind === "empty" ? EMPTY_ADDRESS : ctx.address?.address ?? EMPTY_ADDRESS),
    });
  }, [send, recover]);

  useEffect(() => { setLoad({ kind: "loading" }); setMessage(null); void refresh(); }, [refresh]);

  // C2: session loss turns saving off and keeps the form; a NEW session clears old access/status and re-reads once.
  useEffect(() => subscribeAppWriteSession(() => {
    setAccess(null);
    if (!appWriteIdentity().active) {
      // An uncertain-write warning is never replaced; otherwise the operator is told to sign in.
      if (shown.current) { setClosed(true); setBanner(SIGNED_OUT); setMessage((m) => (holdRef.current ? m : SIGN_IN)); }
      return;
    }
    setOpView(null);
    void refresh();
  }), [refresh]);

  const applyView = (v: OpView | null | undefined) => { if (v && v.opportunityId === opportunityId) setOpView(v); };
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    let stale = false;
    try {
      const res = await send(body);
      if (res === null) { stale = true; return; }
      const isWrite = body.action === "save" || body.action === "history";
      if (!res.ok) {
        if (res.error instanceof AppWriteSignInRequired) { setMessage(res.error.message); setClosed(true); setAccess(null); setBanner(SIGNED_OUT); }
        else if (isWrite) { setMessage(SAVE_UNCERTAIN); setLocalHold(true); setAccess(null); }
        else setBanner("Verification is incomplete; the recorded status could not be read.");
        return;
      }
      const r = res.r;
      if (body.action === "check") {
        if (isStatusAccess(r.body?.access)) setAccess(r.body.access);
        if (r.status === 200 && r.body?.view) {
          const v = r.body.view as OpView;
          applyView(v);
          if (v.state === "committed" || v.state === "not_saved") setLocalHold(false);   // never reopens saving by itself
          setMessage(`${r.body.readOnly ? "Recorded status (read-only): " : ""}${STATE_TEXT[v.state]}`);
        } else if (r.status === 200 && r.body?.outcome === "clear") { setLocalHold(false); setOpView(null); setMessage("No unfinished save is recorded for this deal."); }
        else setBanner(r.body?.error ?? "The recorded status can't be read in this session.");
        return;
      }
      const next = followUpAfter(body, r);   // only this page's own acknowledged save; never Check again
      if (r.body?.view) applyView(r.body.view);
      if (next) {
        const h = await send({ ...next });
        if (h === null) { stale = true; return; }
        if (!h.ok) { setMessage(h.error instanceof AppWriteSignInRequired ? h.error.message : SAVE_UNCERTAIN); if (!(h.error instanceof AppWriteSignInRequired)) setLocalHold(true); return; }
        if (h.r.body?.view) applyView(h.r.body.view);
        setMessage(h.r.body?.message ?? h.r.body?.error ?? STATE_TEXT.history_unresolved);
      } else {
        setMessage(r.body?.message ?? r.body?.verdict?.message ?? r.body?.error ?? (r.body?.view ? STATE_TEXT[r.body.view.state as keyof typeof STATE_TEXT] : null) ?? "Not saved.");
      }
    } finally {
      setBusy(false);
      if (!stale) await refresh();
    }
  };
  const draft = (field: AnswerField, value: unknown) => {
    if (load.kind !== "ready" || load.recovered) return;
    void send({ action: "draft", field, value }).then((res) => {
      if (res === null) return;
      if (!res.ok) { setDraftNote(res.error instanceof AppWriteSignInRequired ? "Draft NOT saved. Sign in to save drafts." : "Draft save not confirmed."); return; }
      const st = res.r.status;
      setDraftNote(st === 200 ? "Draft saved on the server." : st >= 502 && st <= 504 ? "Draft save not confirmed." : "Draft NOT saved.");
    });
  };

  if (load.kind === "hidden") return null;
  if (load.kind === "loading") return <div data-testid="pa-loading" style={{ ...box, ...muted }}>Loading property answers…</div>;

  const statusAction = (() => {
    if (busy) return null;
    if (access === "settle") return <button style={button} onClick={() => void run({ action: "check" })}>Check again</button>;
    if (access === "read") return <button style={button} onClick={() => void run({ action: "check" })}>View recorded status (read-only; this session cannot reconcile it)</button>;
    if (access === "none") return <span data-testid="pa-no-status" style={muted}>{NO_STATUS}</span>;
    return null;
  })();
  if (load.kind === "failed") {
    return <div data-testid="pa-failed" style={{ ...box, fontSize: "12px", color: "#F59E0B" }}>{load.message} {statusAction} <button style={button} onClick={() => void refresh()}>Retry</button></div>;
  }

  const { ctx, recovered } = load;
  const held = !!opView && HOLDING.has(opView.state);
  const canSave = !!ctx && !recovered && !closed && ctx.verdict.allowed && !held && !localHold && !busy;
  const save = (field: AnswerField, value: unknown) => void run({
    action: "save", field, operationId: crypto.randomUUID(), value,
    expectedAddressDigest: ctx?.address?.digest,
    expectedDealSetDigest: ctx?.verdict.digest,
  });
  const addr = ctx?.address ?? null;
  const showHold = localHold || (!!opView && opView.state !== "committed" && opView.state !== "not_saved");

  return (
    <div data-testid="property-answers" style={box}>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9", marginBottom: "6px" }}>Property answers <span style={{ ...muted, fontWeight: 400 }}>(Test evaluation)</span>{canChange ? <> <button style={{ ...button, background: "transparent", color: "#93C5FD" }} disabled={busy} onClick={onChange}>Change deal</button></> : null}</div>
      <div data-testid="pa-verdict" style={{ ...muted, color: ctx?.verdict.allowed ? "#94A3B8" : "#F59E0B" }}>{ctx ? ctx.verdict.message : RECOVERY_NOTICE}</div>
      {showHold ? (
        <div data-testid="pa-op-state" style={{ fontSize: "12px", color: "#F59E0B", margin: "6px 0" }}>
          {localHold ? SAVE_UNCERTAIN : STATE_TEXT[opView!.state]}{access === "read" ? " (recorded status, read-only)" : ""}{" "}
          {statusAction}
          {opView?.state === "saved_history_pending" && access === "settle" && !closed && !busy ? <> <button style={button} onClick={() => void run({ action: "history", operationId: opView.op })}>Record history</button></> : null}
        </div>
      ) : null}
      {banner ? <div data-testid="pa-banner" style={{ fontSize: "12px", color: "#F59E0B", margin: "6px 0" }}>{banner}{!showHold && statusAction ? <> {statusAction}</> : null} <button style={button} disabled={busy} onClick={() => void refresh()}>Reload</button></div> : null}
      {message ? <div data-testid="pa-message" style={{ fontSize: "12px", color: "#E2E8F0", margin: "6px 0" }}>{message}</div> : null}
      {recoveryNote ? <div data-testid="pa-recovery" style={muted}>{recoveryNote}</div> : null}
      {draftNote ? <div data-testid="pa-draft-note" style={muted}>{draftNote}</div> : null}

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#CBD5E1", fontWeight: 600 }}>Property address</div>
      {addr?.kind === "confirmed" ? (
        <div data-testid="pa-address" style={{ fontSize: "13px", color: "#E2E8F0" }}>
          {addr.address.street}{addr.address.unit ? `, ${addr.address.unit}` : ""}, {addr.address.city}, {addr.address.state} {addr.address.zip}
          <div style={muted}>Correcting an address is not available yet. A different property needs its own deal.</div>
        </div>
      ) : addr?.kind === "incomplete" ? (
        <div data-testid="pa-address-incomplete" style={{ fontSize: "12px", color: "#F59E0B" }}>The address in GHL is incomplete. Fix it in GHL; answers stay drafts until it is confirmed.</div>
      ) : (
        <div data-testid="pa-address-form" style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {(["street", "unit", "city", "state", "zip"] as const).map((k) => (
            <input key={k} aria-label={k} placeholder={k === "unit" ? "unit (optional)" : k} value={address[k]} readOnly={recovered} style={{ ...input, width: k === "street" ? "200px" : k === "city" ? "140px" : "80px" }}
              onChange={(e) => setAddress({ ...address, [k]: e.target.value })} onBlur={() => draft("property_address", address)} />
          ))}
          <button data-testid="pa-save-address" style={{ ...button, opacity: canSave ? 1 : 0.5 }} disabled={!canSave} onClick={() => save("property_address", address)}>Save address</button>
        </div>
      )}

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#CBD5E1", fontWeight: 600 }}>Seller reason</div>
      <textarea data-testid="pa-seller-reason" value={reason} rows={3} maxLength={2000} readOnly={recovered} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical" }}
        onChange={(e) => setReason(e.target.value)} onBlur={() => draft("seller_reason", reason)} />
      {addr?.kind !== "confirmed" ? <div style={muted}>Saved as a draft until the property address is confirmed.</div> : null}
      <button data-testid="pa-save-reason" style={{ ...button, marginTop: "6px", opacity: canSave && addr?.kind === "confirmed" && reason.trim() ? 1 : 0.5 }}
        disabled={!canSave || addr?.kind !== "confirmed" || !reason.trim()} onClick={() => save("seller_reason", reason)}>Save seller reason</button>
    </div>
  );
}
