/**
 * B15-30 / INV-140 -- the Seller Call hub's ONE Next action for the selected deal (derived by lib/deal-next-step.ts
 * from the records the page already read). Captain REVISE 2026-11-19: it lives in the sticky deal bar, on ONE row
 * (label, the Next control, progress, reason -- the reason truncates with its full text in `title`), so at 1440x900 it
 * is visible without scrolling and the conversation still starts right under the bar.
 *
 * Previous (Captain 2026-11-20, from Brad's Test walkthrough): a visible "Previous" beside Next steps back through the
 * guided fields of THIS deal (a step already done is revisited: its field is focused, never a button); Next then moves
 * forward again and, on reaching the next unfinished step, returns to it. Previous is disabled at the first step.
 *
 * Neither control writes, approves or records anything: they only move focus, set the review position in the URL
 * (`?deal=&step=`) or open a link (Underwriting, with the deal and the exact field).
 */
import { Link } from "react-router-dom";
import { focusTestId } from "../lib/focus-target";
import { markGuidedNavigation } from "../lib/lifecycle-blur";
import type { DealStepId, NextDealStep } from "../lib/deal-next-step";

const ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: "10px", minWidth: 0, margin: "2px 0 4px" };
const TAG: React.CSSProperties = { flex: "0 0 auto", fontSize: "10px", fontWeight: 700, color: "#1EC8FF", textTransform: "uppercase", letterSpacing: "0.06em" };
const NEXT: React.CSSProperties = { flex: "0 0 auto", display: "inline-block", fontSize: "12px", fontWeight: 700, padding: "3px 10px", borderRadius: "6px", border: "1px solid rgba(30,200,255,0.55)", background: "rgba(30,200,255,0.14)", color: "#1EC8FF", cursor: "pointer", textDecoration: "none", lineHeight: 1.5, whiteSpace: "nowrap" };
const PREV: React.CSSProperties = { ...NEXT, fontWeight: 600, border: "1px solid rgba(148,163,184,0.45)", background: "transparent", color: "#CBD5E1" };
const SMALL: React.CSSProperties = { fontSize: "11px", color: "#94A3B8", whiteSpace: "nowrap" };
const REASON: React.CSSProperties = { ...SMALL, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" };

/** Previous / Next navigation, supplied by the page (it owns the URL and the router). */
export type GuidedNav = {
  /** The step being revisited, when Brad has stepped back; null on the live (next unfinished) step. */
  reviewing: { id: DealStepId; title: string } | null;
  /** Where Previous goes; null at the first step (Previous disabled). */
  previous: DealStepId | null;
  onPrevious: () => void;
  /** While reviewing: what Next says and does (forward one step, or back to the next unfinished step). */
  forwardLabel: string | null;
  onForward: () => void;
};

export default function DealNextStepPanel({ next, contactId, dealId, nav = null }: { next: NextDealStep; contactId: string; dealId: string | null; nav?: GuidedNav | null }) {
  if (next.kind !== "step") {
    return (
      <div data-testid="deal-next-step" data-deal={dealId ?? ""} data-step={next.kind} aria-label="Next step for this deal" style={ROW}>
        <span style={TAG}>Next step</span>
        <span data-testid="deal-next-step-reason" role={next.kind === "unreadable" ? "alert" : "status"} title={next.message}
          style={{ ...REASON, color: next.kind === "unreadable" ? "#F87171" : "#94A3B8" }}>{next.message}</span>
      </div>
    );
  }
  const { step, done, total } = next;
  const d = step.destination;
  const reviewing = nav?.reviewing ?? null;
  const reason = reviewing
    ? `Reviewing ${reviewing.title} -- already recorded for this deal. Next moves forward toward your next unfinished step.`
    : step.reason;
  return (
    <div data-testid="deal-next-step" data-deal={dealId ?? ""} data-step={step.id} data-reviewing={reviewing?.id ?? ""} aria-label="Next step for this deal" style={ROW}>
      <span style={TAG}>{reviewing ? "Reviewing" : "Next step"}</span>
      {nav ? (
        <button type="button" data-testid="deal-previous-step-go" data-guided-nav="previous" onPointerDown={markGuidedNavigation} aria-label="Previous step" disabled={nav.previous === null}
          title={nav.previous === null ? "This is the first step" : undefined} onClick={nav.onPrevious}
          style={{ ...PREV, opacity: nav.previous === null ? 0.4 : 1, cursor: nav.previous === null ? "not-allowed" : "pointer" }}>
          ◀ Previous
        </button>
      ) : null}
      {reviewing && nav ? (
        <button type="button" data-testid="deal-next-step-go" data-guided-nav="next" onPointerDown={markGuidedNavigation} style={NEXT} aria-describedby="deal-next-step-reason" onClick={nav.onForward}>{nav.forwardLabel}</button>
      ) : d.kind === "underwriting" ? (
        <Link data-testid="deal-next-step-go" data-guided-nav="next" onPointerDown={markGuidedNavigation} style={NEXT} aria-describedby="deal-next-step-reason"
          to={`/contacts/${encodeURIComponent(contactId)}/underwriting?${dealId ? `deal=${encodeURIComponent(dealId)}&` : ""}focus=${encodeURIComponent(step.id)}`}>
          {step.label}
        </Link>
      ) : d.kind === "contract" ? (
        <Link data-testid="deal-next-step-go" data-guided-nav="next" onPointerDown={markGuidedNavigation} style={NEXT} aria-describedby="deal-next-step-reason"
          to={`/contacts/${encodeURIComponent(contactId)}/contract${dealId ? `?deal=${encodeURIComponent(dealId)}` : ""}`}>
          {step.label}
        </Link>
      ) : d.kind === "seller_call" ? (
        <button type="button" data-testid="deal-next-step-go" data-guided-nav="next" onPointerDown={markGuidedNavigation} style={NEXT} aria-describedby="deal-next-step-reason" onClick={() => { focusTestId(d.target); }}>{step.label}</button>
      ) : (
        <span data-testid="deal-next-step-go" data-destination="ghl" style={{ ...NEXT, cursor: "default" }} aria-describedby="deal-next-step-reason">{step.label} — {d.what}</span>
      )}
      <span data-testid="deal-next-step-progress" style={SMALL}>{done} of {total} steps done</span>
      <span id="deal-next-step-reason" data-testid="deal-next-step-reason" title={reason} style={REASON}>{reason}</span>
    </div>
  );
}

/**
 * B15-30 (Captain REVISE 2026-11-19): on Underwriting, opened by a Seller Call Next action (`?focus=<step>`). Names the
 * deal and the step, and returns to Seller Call on the SAME deal (`?deal=`), where the next step is derived again from
 * the records -- so the operator continues without hunting. Opened by Previous / Next onto a step already done
 * (`reviewStep`), it says so and returns to that same review position (`&step=`), so Next moves forward from there.
 * A link only: nothing is written or recorded.
 */
export function GuidedReturnBar({ contactId, dealId, dealName, action, reviewStep = null }: { contactId: string; dealId: string; dealName: string; action: string; reviewStep?: string | null }) {
  return (
    <div data-testid="guided-return" data-deal={dealId} data-reviewing={reviewStep ?? ""} role="note" style={{
      position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      marginBottom: "14px", padding: "8px 12px", background: "#0F172A", border: "1px solid rgba(30,200,255,0.35)", borderRadius: "8px",
    }}>
      <span style={TAG}>{reviewStep ? "Reviewing from Seller Call" : "Guided from Seller Call"}</span>
      <span style={{ fontSize: "12px", color: "#E2E8F0" }}>{dealName}: {action}.</span>
      {reviewStep ? null : <span style={SMALL}>When it is saved:</span>}
      <Link data-testid="guided-return-back" style={NEXT}
        to={`/contacts/${encodeURIComponent(contactId)}/seller-call?deal=${encodeURIComponent(dealId)}${reviewStep ? `&step=${encodeURIComponent(reviewStep)}` : ""}`}>
        {reviewStep ? "Back to Seller Call" : "Back to Seller Call — next step"}
      </Link>
    </div>
  );
}
