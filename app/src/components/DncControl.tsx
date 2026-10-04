import { useEffect, useRef, useState } from "react";
import { ghl, ghlContactDetailUrl, type ContactDetail } from "../lib/ghl";
import { openGhlContactWindow, type GhlHandoffResult } from "../lib/ghl-call-handoff";
import {
  DNC_BUTTON, DNC_DIALER_LINE, DNC_HANDOFF_OPENED, DNC_KEEPS_OPT_OUTS,
  dncStatusText, isCallSuppressed, unsuppressedChannels,
} from "../lib/dnc";

/**
 * B14-12 / INV-94 — Do Not Call, simplified (Brad 2026-10-04, Jess ruling).
 * READ-ONLY: this control writes nothing — no DND, no note, no field.
 *
 *   1. "Do Not Call (opens GHL)" — the isolated 14-11 handoff to THIS
 *      contact's GHL record, where Brad turns on Do Not Disturb for Calls,
 *      SMS and Email with GHL's own control. No reason is asked for.
 *   2. "Check GHL now" — a fresh read of this contact; IAOS shows which of
 *      calls, SMS and email GHL holds suppressed. It never claims IAOS set
 *      anything or recorded anything.
 *
 * ONLY A SUCCESSFUL READ IS SHOWN AS GHL STATE (Bones, #122). Before any
 * check, the page's own read of this contact; after a check, that check's
 * result. While a check is running, or after one fails, the state is UNKNOWN:
 * no suppression or calling-list claim is shown — an older read is never
 * brought back as if it were current.
 *
 * The Dashboard leaves any contact whose GHL Call channel is suppressed out of
 * its calling lists (isCallSuppressed), whoever set it.
 */

type Check =
  | { kind: "none" }
  | { kind: "busy" }
  | { kind: "read"; dnd: ContactDetail["dndSettings"] }
  | { kind: "failed"; message: string };

const HANDOFF_TEXT: Record<GhlHandoffResult, string> = {
  opened: DNC_HANDOFF_OPENED,
  blocked: "Your browser blocked the new window. Open this contact in GHL yourself, or allow pop-ups for IAOS.",
  "isolation-failed": "IAOS couldn't open GHL safely. Open this contact in GHL yourself.",
};

export function DncControl({ contactId, detail }: {
  contactId: string;
  /** This contact's detail, or null while it is not loaded (or belongs to another contact). */
  detail: ContactDetail | null;
}) {
  const [open, setOpen] = useState(false);
  const [handoff, setHandoff] = useState<GhlHandoffResult | null>(null);
  const [check, setCheck] = useState<Check>({ kind: "none" });
  const currentId = useRef(contactId);
  const ghlUrl = ghlContactDetailUrl(contactId);
  const busy = check.kind === "busy";

  // Another contact: nothing from the previous one carries over.
  useEffect(() => {
    currentId.current = contactId;
    setOpen(false); setHandoff(null); setCheck({ kind: "none" });
  }, [contactId]);

  function openInGhl() {
    setHandoff(openGhlContactWindow(ghlUrl, (url, target) => window.open(url, target)));
    setOpen(true);
  }

  /** Fresh read of THIS contact's DND. Reads only. */
  async function checkNow() {
    if (busy) return;
    const cid = contactId;
    setCheck({ kind: "busy" });
    try {
      const fresh = await ghl.contacts.getDetail(cid);
      if (currentId.current !== cid) return;
      if (fresh.id !== cid) { setCheck({ kind: "failed", message: "GHL returned a different contact. Do Not Disturb status is unknown right now. Check again." }); return; }
      setCheck({ kind: "read", dnd: fresh.dndSettings });
    } catch (e) {
      if (currentId.current === cid) setCheck({ kind: "failed", message: `Couldn't read this contact from GHL (${(e as Error).message}). Do Not Disturb status is unknown right now. Check again.` });
    }
  }

  // What to show — only a SUCCESSFUL read: this check's, or (before any check) the page's own.
  // Checking or failed = unknown: nothing older is shown as current GHL state.
  const dnd = check.kind === "read" ? check.dnd : check.kind === "none" ? detail?.dndSettings : undefined;
  const known = check.kind === "read" || (check.kind === "none" && detail !== null);
  const anySuppressed = known && unsuppressedChannels(dnd).length < 3;
  const showStatus = check.kind === "read" || anySuppressed;

  const red = { fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.10)", color: "#F87171", cursor: "pointer" } as const;
  const plain = { fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#94A3B8" } as const;

  return (
    <div data-testid="dnc" style={{ marginTop: "12px", padding: "12px 16px", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "10px", background: "#0D1B3E" }}>
      {check.kind === "failed" ? (
        <div data-testid="dnc-read-failed" style={{ fontSize: "12px", color: "#F59E0B", marginBottom: "8px" }}>{check.message}</div>
      ) : check.kind === "busy" ? (
        <div data-testid="dnc-checking" style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px" }}>Checking GHL… Do Not Disturb status will show when GHL answers.</div>
      ) : showStatus ? (
        <div data-testid="dnc-status" style={{ fontSize: "12px", color: isCallSuppressed(dnd) ? "#F87171" : "#94A3B8", marginBottom: "8px" }}>
          {dncStatusText(dnd)}
        </div>
      ) : null}
      {!open ? (
        <button data-testid="dnc-open" onClick={openInGhl} style={red}>{DNC_BUTTON}</button>
      ) : (
        <div data-testid="dnc-panel" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {handoff ? <div data-testid={`dnc-handoff-${handoff}`} style={{ fontSize: "12px", color: handoff === "opened" ? "#E2E8F0" : "#F87171", lineHeight: 1.5 }}>{HANDOFF_TEXT[handoff]}</div> : null}
          <div style={{ fontSize: "11px", color: "#64748B" }}>{DNC_KEEPS_OPT_OUTS} {DNC_DIALER_LINE}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button data-testid="dnc-check" onClick={() => void checkNow()} disabled={busy} style={{ ...red, cursor: busy ? "not-allowed" : "pointer" }}>
              {busy ? "Checking GHL…" : "Check GHL now"}
            </button>
            <button data-testid="dnc-open-ghl" onClick={openInGhl} disabled={busy} style={plain}>Open in GHL again</button>
            <button data-testid="dnc-close" onClick={() => { setOpen(false); setHandoff(null); }} disabled={busy} style={plain}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
