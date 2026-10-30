import { useRef, useState } from "react";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { closeEvaluation, type CloseOutcome } from "../lib/property-answer-client";
import { PropertyAnswersPanel } from "../components/PropertyAnswersPanel";

/**
 * B15-04 close (design r3; Jess D0–D4; Bones implementation clearance 2026-10-20) -- the dedicated
 * /evaluation-close page. Reached by URL only (no navigation link), inside the normal Layout and read
 * sign-in gate.
 *
 *  - Nothing is sent on mount. The ONE request this page makes by itself is the property-answer `close`,
 *    and only when the operator clicks. The button latches at once, so a double click sends one request.
 *  - `closed` is shown only for the server's acknowledged close. Anything else is UNKNOWN and stays on
 *    hold; the operator may deliberately try again (D4). Nothing here retries on its own.
 *  - Closing is admission fencing, not cancellation: work already admitted may still finish.
 *  - Only AFTER this page saw `closed` may the operator open draft recovery for ONE reviewed pair. That
 *    mounts the property-answers panel here, never ContactWorkspace: its first requests are a context
 *    (refused by the stopped budget before any GHL request) and then the drafts read.
 *  - The pairs come from the runtime projection (`propertyAnswerRecovery`); the server re-checks every
 *    request against its own configuration.
 */
type Attempt = { at: string; outcome: CloseOutcome };

const box = { marginTop: "14px", padding: "16px 18px", borderRadius: "10px", background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)" } as const;
const muted = { fontSize: "13px", color: "#94A3B8", lineHeight: 1.6 } as const;
const button = { padding: "6px 12px", borderRadius: "6px", background: "#1EC8FF", color: "#07142E", fontWeight: 600, fontSize: "13px" } as const;
const RESULT_TEXT: Record<CloseOutcome["kind"], string> = { closed: "Closed", unknown: "UNKNOWN (on hold)", refused: "Refused", sign_in: "Not sent" };

export default function EvaluationClose() {
  const recovery = getRuntimeConfig().propertyAnswerRecovery;
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [recovering, setRecovering] = useState<number | null>(null);
  const closed = attempts.some((a) => a.outcome.kind === "closed");
  const last = attempts[attempts.length - 1]?.outcome;

  if (!recovery.enabled || recovery.pairs.length === 0) {
    return <div style={{ padding: "24px 28px", maxWidth: "720px" }}>
      <h1 className="text-2xl font-semibold text-white font-display">Close the evaluation</h1>
      <div data-testid="evaluation-close-unavailable" style={{ ...box, ...muted }}>The property-answer evaluation is not available in this deployment. Nothing can be closed here.</div>
    </div>;
  }

  const close = async () => {
    if (pending.current || closed) return;   // the latch: one attempt at a time, none after a confirmed close
    pending.current = true; setBusy(true);
    try {
      const outcome = await closeEvaluation(recovery.pairs[0]);
      setAttempts((a) => [...a, { at: new Date().toISOString(), outcome }]);
    } finally { pending.current = false; setBusy(false); }
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: "720px" }}>
      <h1 className="text-2xl font-semibold text-white font-display">Close the evaluation</h1>
      <div style={box}>
        <div style={muted}>
          This durably stops the Test property-answer evaluation: no new property-answer request to GHL is admitted after it.
          It does not cancel work already admitted, which may still finish, and it does not sign anyone out. Drafts stay saved and recoverable.
        </div>
        {!closed ? <div style={{ marginTop: "10px" }}>
          <button data-testid="evaluation-close-button" style={{ ...button, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => void close()}>
            {busy ? "Closing…" : attempts.length ? "Close again" : "Close the evaluation"}
          </button>
        </div> : null}
        {last ? <div data-testid="evaluation-close-result" data-kind={last.kind} style={{ fontSize: "13px", color: last.kind === "closed" ? "#E2E8F0" : "#F59E0B", marginTop: "10px" }}>{last.message}</div> : null}
        {attempts.length ? <ol data-testid="evaluation-close-attempts" style={{ ...muted, margin: "8px 0 0", paddingLeft: "20px" }}>
          {attempts.map((a, i) => <li key={i}>{new Date(a.at).toLocaleTimeString()}: {RESULT_TEXT[a.outcome.kind]}{a.outcome.kind === "refused" ? ` (${a.outcome.code})` : ""}</li>)}
        </ol> : null}
      </div>
      {closed ? <div data-testid="evaluation-recovery" style={box}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>Recover drafts</div>
        <div style={muted}>Open one reviewed evaluation pair to see your saved drafts. Saving to GHL stays off.</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
          {recovery.pairs.map((p, i) => <button key={p.contactId} data-testid={`evaluation-recovery-pair-${i}`} style={{ ...button, opacity: recovering === i ? 0.5 : 1 }} disabled={recovering === i}
            onClick={() => setRecovering(i)}>Pair {i + 1}: contact {p.contactId}, deal {p.opportunityId}</button>)}
        </div>
        {recovering !== null ? <div data-testid="evaluation-recovery-panel" style={{ marginTop: "10px" }}>
          <PropertyAnswersPanel key={recovering} contactId={recovery.pairs[recovering].contactId} deals={[{ id: recovery.pairs[recovering].opportunityId, name: "" }]} />
        </div> : null}
      </div> : null}
    </div>
  );
}
