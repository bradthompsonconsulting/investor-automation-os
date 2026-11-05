/**
 * B15-27b P2 -- the line under a field whose text is kept as a draft
 * (lib/contact-drafts.ts). Display only. Wording is factual; Brad/Spock may
 * adjust the copy.
 *   kept     the text is kept in this browser for this contact/deal, not in GHL;
 *   sending  a save of it started and was not seen to finish: it may already be in GHL;
 *   failed   its last save failed: the text is kept.
 */
import type { DraftNotice as Notice } from "../lib/contact-drafts";

const STYLE = { fontSize: "10px", color: "#F59E0B", marginTop: "4px", lineHeight: 1.4 } as const;

export function draftNoticeText(kept: boolean, notice: Notice, what: string, owner: "contact" | "deal"): string | null {
  if (notice?.kind === "failed") return `Not saved: ${notice.message} Your ${what} is kept in this browser for this ${owner}; it is not in GHL.`;
  if (notice?.kind === "sending") return `This ${what} was being saved when you left. It may already be in GHL — check before saving it again.`;
  if (kept) return `Draft kept in this browser for this ${owner}. It is not in GHL until you save it.`;
  return null;
}

export function DraftNotice({ kept, notice, what, owner, testid, action }: {
  kept: boolean; notice: Notice; what: string; owner: "contact" | "deal"; testid: string;
  /** B15-27b r2: an explicit action offered with an uncertain ("sending") draft. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const text = draftNoticeText(kept, notice, what, owner);
  if (!text) return null;
  return (
    <div data-testid={testid} data-draft-state={notice?.kind ?? "kept"} role="status" style={STYLE}>
      {text}
      {action && notice?.kind === "sending" ? (
        <> <button type="button" data-testid={`${testid}-action`} onClick={action.onClick} disabled={action.disabled}
          style={{ fontSize: "10px", color: "#F59E0B", background: "transparent", border: "1px solid rgba(245,158,11,0.5)", borderRadius: "4px", padding: "1px 6px", cursor: "pointer" }}>
          {action.label}
        </button></>
      ) : null}
    </div>
  );
}
