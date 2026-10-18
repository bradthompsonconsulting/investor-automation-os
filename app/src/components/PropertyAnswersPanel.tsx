import { useCallback, useEffect, useRef, useState } from "react";
import {
  propertyAnswer, AppWriteSignInRequired, EMPTY_ADDRESS, GATE_CODES, HOLDING, STATE_TEXT,
  type Address, type AnswerContext, type AnswerField, type Reply,
} from "../lib/property-answer-client";

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
 * state. Unsaved text is kept as a server-side draft.
 */
type Load = { kind: "loading" } | { kind: "hidden" } | { kind: "failed"; message: string } | { kind: "ready"; ctx: AnswerContext };

const box = { marginTop: "12px", padding: "12px 16px", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "10px", background: "#0D1B3E" } as const;
const input = { background: "#0A1530", color: "#E2E8F0", border: "1px solid rgba(148,163,184,0.35)", borderRadius: "6px", padding: "6px 8px", fontSize: "13px" } as const;
const button = { background: "#1E3A8A", color: "#F1F5F9", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", cursor: "pointer" } as const;
const muted = { fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 } as const;

/** The contact's Seller Leads deals from the page's pipeline read; the operator selects one (r3: the selected deal plus a confirmed address). */
export function PropertyAnswersPanel({ contactId, deals }: { contactId: string; deals: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState<string | null>(deals.length === 1 ? deals[0].id : null);
  useEffect(() => { setSelected(deals.length === 1 ? deals[0].id : null); }, [contactId, deals.length === 1 ? deals[0].id : ""]);
  if (!selected) {
    if (deals.length < 2) return null;
    return (
      <div data-testid="pa-select" style={box}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9", marginBottom: "6px" }}>Property answers <span style={{ ...muted, fontWeight: 400 }}>(Test evaluation)</span></div>
        <div style={muted}>This contact has {deals.length} seller deals. Select the deal these answers belong to:</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>{deals.map((d) => <button key={d.id} style={button} onClick={() => setSelected(d.id)}>{d.name || d.id}</button>)}</div>
      </div>
    );
  }
  return <DealAnswers key={`${contactId}:${selected}`} contactId={contactId} opportunityId={selected} canChange={deals.length > 1} onChange={() => setSelected(null)} />;
}

function DealAnswers({ contactId, opportunityId, canChange, onChange }: { contactId: string; opportunityId: string; canChange: boolean; onChange: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [reason, setReason] = useState("");
  const target = useRef(`${contactId}:${opportunityId}`);
  target.current = `${contactId}:${opportunityId}`;

  const refresh = useCallback(async () => {
    const forTarget = `${contactId}:${opportunityId}`;
    let r: Reply;
    try { r = await propertyAnswer({ action: "context", contactId, opportunityId }); }
    catch (e) { if (target.current === forTarget) setLoad(e instanceof AppWriteSignInRequired ? { kind: "hidden" } : { kind: "failed", message: "Property answers could not be loaded." }); return; }
    if (target.current !== forTarget) return;
    if (r.status === 403 && GATE_CODES.has(r.body?.code)) { setLoad({ kind: "hidden" }); return; }
    if (r.status !== 200) { setLoad({ kind: "failed", message: r.body?.error ?? "Property answers could not be loaded." }); return; }
    const ctx = r.body as AnswerContext;
    setLoad({ kind: "ready", ctx });
    setAddress(ctx.drafts.property_address ?? (ctx.address?.kind === "empty" ? EMPTY_ADDRESS : ctx.address?.address ?? EMPTY_ADDRESS));
    setReason(ctx.drafts.seller_reason ?? ctx.values.seller_reason ?? "");
  }, [contactId, opportunityId]);

  useEffect(() => { setLoad({ kind: "loading" }); setMessage(null); void refresh(); }, [refresh]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage(null);
    try {
      const r = await propertyAnswer(body);
      if (r.status === 200 && r.body?.outcome === "saved_history_pending" && r.body.view?.op) {
        const h = await propertyAnswer({ action: "history", contactId, opportunityId, operationId: r.body.view.op });
        setMessage(h.body?.message ?? h.body?.error ?? STATE_TEXT.history_unresolved);
      } else {
        setMessage(r.body?.message ?? r.body?.verdict?.message ?? r.body?.error ?? (r.body?.view ? STATE_TEXT[r.body.view.state as keyof typeof STATE_TEXT] : null) ?? "Not saved.");
      }
    } catch (e) {
      setMessage(e instanceof AppWriteSignInRequired ? e.message : "The save may not have reached the server. Use Check again; do not save again.");
    } finally { setBusy(false); await refresh(); }
  };
  const draft = (field: AnswerField, value: unknown) => { void propertyAnswer({ action: "draft", contactId, opportunityId, field, value }).catch(() => null); };

  if (load.kind === "hidden") return null;
  if (load.kind === "loading") return <div data-testid="pa-loading" style={{ ...box, ...muted }}>Loading property answers…</div>;
  if (load.kind === "failed") return <div data-testid="pa-failed" style={{ ...box, fontSize: "12px", color: "#F59E0B" }}>{load.message} <button style={button} onClick={() => void refresh()}>Retry</button></div>;

  const { ctx } = load;
  const op = ctx.operation;
  const held = !!op && HOLDING.has(op.state);
  const canSave = ctx.verdict.allowed && !held && !busy;
  const save = (field: AnswerField, value: unknown) => void run({
    action: "save", contactId, opportunityId, field, operationId: crypto.randomUUID(), value,
    expectedAddressDigest: ctx.address?.digest,
    expectedDealSetDigest: ctx.verdict.digest,
  });
  const addr = ctx.address;

  return (
    <div data-testid="property-answers" style={box}>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9", marginBottom: "6px" }}>Property answers <span style={{ ...muted, fontWeight: 400 }}>(Test evaluation)</span>{canChange ? <> <button style={{ ...button, background: "transparent", color: "#93C5FD" }} disabled={busy} onClick={onChange}>Change deal</button></> : null}</div>
      <div data-testid="pa-verdict" style={{ ...muted, color: ctx.verdict.allowed ? "#94A3B8" : "#F59E0B" }}>{ctx.verdict.message}</div>
      {op && op.state !== "committed" && op.state !== "not_saved" ? (
        <div data-testid="pa-op-state" style={{ fontSize: "12px", color: "#F59E0B", margin: "6px 0" }}>
          {STATE_TEXT[op.state]}{" "}
          <button style={button} disabled={busy} onClick={() => void run({ action: "check", contactId, opportunityId })}>Check again</button>
          {op.state === "saved_history_pending" ? <> <button style={button} disabled={busy} onClick={() => void run({ action: "history", contactId, opportunityId, operationId: op.op })}>Record history</button></> : null}
        </div>
      ) : null}
      {message ? <div data-testid="pa-message" style={{ fontSize: "12px", color: "#E2E8F0", margin: "6px 0" }}>{message}</div> : null}

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
            <input key={k} aria-label={k} placeholder={k === "unit" ? "unit (optional)" : k} value={address[k]} style={{ ...input, width: k === "street" ? "200px" : k === "city" ? "140px" : "80px" }}
              onChange={(e) => setAddress({ ...address, [k]: e.target.value })} onBlur={() => draft("property_address", address)} />
          ))}
          <button data-testid="pa-save-address" style={{ ...button, opacity: canSave ? 1 : 0.5 }} disabled={!canSave} onClick={() => save("property_address", address)}>Save address</button>
        </div>
      )}

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#CBD5E1", fontWeight: 600 }}>Seller reason</div>
      <textarea data-testid="pa-seller-reason" value={reason} rows={3} maxLength={2000} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical" }}
        onChange={(e) => setReason(e.target.value)} onBlur={() => draft("seller_reason", reason)} />
      {addr?.kind !== "confirmed" ? <div style={muted}>Saved as a draft until the property address is confirmed.</div> : null}
      <button data-testid="pa-save-reason" style={{ ...button, marginTop: "6px", opacity: canSave && addr?.kind === "confirmed" && reason.trim() ? 1 : 0.5 }}
        disabled={!canSave || addr?.kind !== "confirmed" || !reason.trim()} onClick={() => save("seller_reason", reason)}>Save seller reason</button>
    </div>
  );
}
