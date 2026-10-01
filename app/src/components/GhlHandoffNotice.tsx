import type { GhlHandoffResult } from "../lib/ghl-call-handoff";

/*
 * B14-11 / INV-93 — the status line under "Open seller in GHL".
 *
 * Kept free of CSS and GHL-config imports so the offline suite can render it
 * directly. The failure copy makes no claim that the blank window was
 * closed: closing it can itself fail, so the operator is told what to do if
 * one remains. Every message denies that opening GHL places or records a
 * call.
 */
export function GhlHandoffNotice(props: { result: GhlHandoffResult | null; ghlUrl: string }) {
  const { result, ghlUrl } = props;
  if (result === "blocked" || result === "isolation-failed") {
    return (
      <span role="alert" className="seller-call-mode__error" data-testid={`ghl-handoff-${result}`}>
        {result === "blocked"
          ? "Your browser blocked the new window. "
          : "IAOS could not safely open the GHL record. If a blank window remains open, close it and use the link below."}
        {result === "isolation-failed" ? <br /> : null}
        <a href={ghlUrl} target="_blank" rel="noopener noreferrer" data-testid="ghl-handoff-manual-link">Open the GHL record</a>
        {result === "blocked" ? " manually, or allow pop-ups for IAOS." : null}
      </span>
    );
  }
  if (result === "opened") {
    return <>GHL opened in a new window. Confirm the contact name and number there before dialing. Opening GHL does not place or record a call.</>;
  }
  return <>Opens this seller's GHL record in a new window. Confirm the contact, then dial from GHL's phone icon. Opening GHL does not place or record a call.</>;
}
