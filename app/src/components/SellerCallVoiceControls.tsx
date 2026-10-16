import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, MonitorSmartphone, Phone, PhoneCall, Smartphone } from "lucide-react";
import { normalizeVoicePhone } from "../../shared/voice-call-contract";
import { airdroidCallTarget, launchAirdroidCall, type AirdroidLaunchResult } from "../lib/airdroid-launch";
import { EligibilityGate, ELIGIBILITY_COPY, handoffVerdict, readCallEligibility, type BlockReason } from "../lib/airdroid-eligibility";
import { formatPhone } from "../lib/format";
import { ghlContactDetailUrl } from "../lib/ghl";
import { openGhlContactWindow, type GhlHandoffResult } from "../lib/ghl-call-handoff";
import { GhlHandoffNotice } from "./GhlHandoffNotice";
import "./SellerCallVoiceControls.css";

/*
 * B14-11 / INV-93 — Seller Call calling options.
 *
 * GHL Phone is the calling and call-record system of record. "Call with GHL
 * Phone" opens this seller's GHL contact record in a new window so the IAOS
 * script stays usable beside it; the call is dialed from GHL's own Web
 * Dialer. It writes nothing, and opening GHL never means a call was placed.
 * "Call with Cell" is the fallback and needs a valid seller number.
 *
 * The retired Twilio-era "Call with IAOS" softphone entrance and its
 * voice-session fetch are gone from the browser; the server-side voice
 * capability is separately and unconditionally disabled.
 *
 * B14-13 — "Call with AirDroid" is the first, primary option; GHL Phone is
 * the backup and Cell stays. The button only passes the seller's 10 US digits
 * to the AirDroid launch interface (../lib/airdroid-launch, which opens the
 * iaos-airdroid: link once); this component itself does not navigate, open a
 * window or write. Its only fetch is the read-only call-eligibility check below. It shows only an invalid-number
 * reason or an error the interface reports, cleared whenever the seller
 * changes. It cannot see a call, a helper or a cancelled launch, so it never
 * claims a call was placed, connected or ended.
 *
 * B14-13 (live test, f32a17e): the Call button scrolled off screen. When the
 * page gives a `compactCallSlot` (an element in Seller Call's sticky deal bar),
 * a compact Call button is rendered into it, shown only while the full button
 * is not wholly in view. It runs the same callWithAirdroid for the same seller,
 * so there is still one launch per click and one error for both buttons.
 *
 * Call eligibility (Jess ruling 2026-10-16; Brad-approved scope
 * IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md): before any
 * handoff, both buttons share ONE fresh click-time read of GHL call
 * suppression and Incorrect Number (lib/airdroid-eligibility.ts, served by the
 * read-only call-eligibility function). The handoff happens only for an
 * eligible result bound to the same contact and number the click was made
 * for. Suppressed, Incorrect Number, a changed contact or number, and any
 * unknown read block it and offer Refresh status (which never dials) and
 * Review contact. Refresh status is also offered while a check is in flight;
 * it supersedes that check, so the pending click can no longer dial.
 * A click while a check is in flight is ignored; navigation,
 * a seller or number change, Refresh or unmount make any in-flight check
 * stale, so a late response never dials. No clearance or consent claim is shown.
 * Status can still change in GHL between the read and AirDroid's dial.
 */

function useMobileViewport(): boolean {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function SellerCallVoiceControls(props: { contactId: string; sellerName: string; sellerPhone: string; compactCallSlot?: HTMLElement | null }) {
  const destination = useMemo(() => normalizeVoicePhone(props.sellerPhone), [props.sellerPhone]);
  const displayPhone = destination ? formatPhone(destination) : "No valid seller number";
  const ghlUrl = ghlContactDetailUrl(props.contactId);
  const isMobile = useMobileViewport();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [handoff, setHandoff] = useState<GhlHandoffResult | null>(null);
  const airdroidTarget = useMemo(() => airdroidCallTarget(props.sellerPhone), [props.sellerPhone]);
  const [airdroidError, setAirdroidError] = useState<string | null>(null);
  const gateRef = useRef<EligibilityGate | null>(null);
  if (gateRef.current === null) gateRef.current = new EligibilityGate();
  const gate = gateRef.current;
  const [eligibility, setEligibility] = useState<{ kind: "idle" } | { kind: "checking" } | { kind: "blocked"; reason: BlockReason }>({ kind: "idle" });
  // The seller and number this render shows; a response is applied only if it still matches what its click was made for.
  const binding = useRef({ contactId: props.contactId, target: airdroidTarget });
  binding.current = { contactId: props.contactId, target: airdroidTarget };
  // A launch error and an eligibility result belong to one seller and number: clear them, and make any in-flight
  // check stale, when the seller (even one sharing this number) or the number changes.
  useEffect(() => {
    gate.invalidate();
    setAirdroidError(null);
    setEligibility({ kind: "idle" });
  }, [gate, props.contactId, airdroidTarget]);
  useEffect(() => () => gate.invalidate(), [gate]);
  // The compact button shows only while the full Call button (its actions row) is not wholly visible: scrolled away, or under the sticky bar.
  const callButtonRef = useRef<HTMLDivElement | null>(null);
  const [callButtonInView, setCallButtonInView] = useState(true);
  useEffect(() => {
    const row = callButtonRef.current;
    if (!row || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setCallButtonInView(entry.intersectionRatio >= 0.99), { threshold: [0, 0.99, 1] });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  async function copySellerNumber() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  /**
   * One fresh eligibility read for this seller and number. "call" hands off to AirDroid only on an eligible, current,
   * bound result; "refresh" only updates the status and never hands off.
   */
  async function checkEligibility(mode: "call" | "refresh") {
    const target = airdroidTarget;
    if (!target) return;
    const ticket = gate.begin(mode);
    if (!ticket) return;                                   // a check is already in flight for these buttons
    const bound = { contactId: props.contactId, target };
    setAirdroidError(null);
    setEligibility({ kind: "checking" });
    const response = await readCallEligibility(bound.contactId, ticket.signal);
    if (!gate.finish(ticket.seq)) return;                  // stale: superseded, navigated, changed or unmounted
    const now = binding.current;
    if (now.contactId !== bound.contactId || now.target !== bound.target) return;
    const verdict = handoffVerdict(response, bound);
    if (!verdict.dial) {
      setEligibility({ kind: "blocked", reason: verdict.reason });
      return;
    }
    setEligibility({ kind: "idle" });
    if (mode !== "call") return;                           // Refresh status never dials
    let result: AirdroidLaunchResult;
    try {
      result = launchAirdroidCall(bound.target);
    } catch {
      result = { ok: false, error: "AirDroid couldn't be started." };
    }
    setAirdroidError(result.ok ? null : result.error);
  }

  const callWithAirdroid = () => { void checkEligibility("call"); };
  const refreshEligibility = () => { void checkEligibility("refresh"); };
  const checking = eligibility.kind === "checking";

  function openGhl() {
    setHandoff(openGhlContactWindow(ghlUrl, (url, target) => window.open(url, target)));
  }

  return (
    <section className="seller-call-modes" aria-label="Seller calling options" data-testid="seller-call-modes">
      <div className="seller-call-mode seller-call-mode--primary" data-testid="call-with-airdroid-mode">
        <strong><MonitorSmartphone size={16} aria-hidden="true" /> Call with AirDroid</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions" ref={callButtonRef}>
          <button className="seller-call-button seller-call-button--primary" type="button" onClick={callWithAirdroid} disabled={!airdroidTarget || checking}
            aria-busy={checking} data-testid="call-with-airdroid">
            <PhoneCall size={16} aria-hidden="true" /> Call with AirDroid
          </button>
        </div>
        {!airdroidTarget ? (
          <div className="seller-call-mode__hint" data-testid="airdroid-no-number">
            Unavailable: IAOS has no valid 10-digit US number for this seller. Use GHL Phone or Cell.
          </div>
        ) : eligibility.kind === "checking" ? (
          <div className="seller-call-mode__hint" role="status" data-testid="airdroid-eligibility" data-state="checking">
            <span data-testid="airdroid-eligibility-text">{ELIGIBILITY_COPY.checking}</span>
            {/* Reachable while a check is in flight: it supersedes (and so cancels) that check, and never dials. */}
            <div className="seller-call-mode__actions">
              <button className="seller-call-button" type="button" onClick={refreshEligibility} data-testid="airdroid-refresh-status">
                {ELIGIBILITY_COPY.refresh}
              </button>
            </div>
          </div>
        ) : eligibility.kind === "blocked" ? (
          <div className="seller-call-mode__hint seller-call-mode__error" role="alert" data-testid="airdroid-eligibility" data-state={eligibility.reason}>
            <span data-testid="airdroid-eligibility-text">{ELIGIBILITY_COPY[eligibility.reason]}</span>
            <div className="seller-call-mode__actions">
              <button className="seller-call-button" type="button" onClick={refreshEligibility} data-testid="airdroid-refresh-status">
                {ELIGIBILITY_COPY.refresh}
              </button>
              <button className="seller-call-button" type="button" onClick={openGhl} data-testid="airdroid-review-contact">
                <ExternalLink size={16} aria-hidden="true" /> {ELIGIBILITY_COPY.review}
              </button>
            </div>
          </div>
        ) : airdroidError ? (
          <div className="seller-call-mode__hint seller-call-mode__error" role="alert" data-testid="airdroid-launch-error">
            {airdroidError} Use GHL Phone or Cell.
          </div>
        ) : null}
      </div>

      <div className="seller-call-mode" data-testid="call-with-ghl-mode">
        <strong><PhoneCall size={16} aria-hidden="true" /> Call with GHL Phone</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions">
          <button className="seller-call-button" type="button" onClick={openGhl} data-testid="open-ghl-contact">
            <ExternalLink size={16} aria-hidden="true" /> Open seller in GHL
          </button>
        </div>
        <div className="seller-call-mode__hint" aria-live="polite" data-testid="ghl-handoff-status">
          <GhlHandoffNotice result={handoff} ghlUrl={ghlUrl} />
        </div>
        {!destination ? (
          <div className="seller-call-mode__hint" data-testid="ghl-handoff-no-number">
            IAOS has no valid number for this seller. Check the number in GHL before dialing.
          </div>
        ) : null}
      </div>

      <div className="seller-call-mode" data-testid="call-with-cell-mode">
        <strong><Smartphone size={16} aria-hidden="true" /> Call with Cell</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions">
          {isMobile && destination ? (
            <a className="seller-call-button" href={`tel:${destination}`} data-testid="call-with-cell-mobile">
              <Phone size={16} aria-hidden="true" /> Open phone dialer
            </a>
          ) : (
            <button className="seller-call-button" type="button" onClick={copySellerNumber} disabled={!destination} data-testid="call-with-cell-copy">
              <Copy size={16} aria-hidden="true" /> Copy seller number
            </button>
          )}
        </div>
        <div className="seller-call-mode__hint" aria-live="polite">
          {!destination
            ? "Unavailable: no valid seller number."
            : isMobile ? "Your phone will prefill the number. You must press Send." : copyState === "copied" ? "Seller number copied." : copyState === "failed" ? "Copy failed — select the number above and copy it manually." : "Use your ordinary cell-phone calling path."}
        </div>
      </div>

      {props.compactCallSlot && airdroidTarget ? createPortal(
        <div className="seller-call-compact" data-testid="call-with-airdroid-compact-wrap" data-shown={callButtonInView ? "false" : "true"}>
          <button className="seller-call-button seller-call-button--primary seller-call-button--compact" type="button" onClick={callWithAirdroid} disabled={checking}
            aria-busy={checking} aria-label={`Call ${props.sellerName} with AirDroid`} title={`Call ${props.sellerName} · ${displayPhone} with AirDroid`} data-testid="call-with-airdroid-compact">
            <PhoneCall size={14} aria-hidden="true" /> Call
          </button>
          {eligibility.kind === "checking" ? (
            <span className="seller-call-compact__status" role="status" data-testid="airdroid-compact-eligibility" data-state="checking">
              {ELIGIBILITY_COPY.checking}{" "}
              <button className="seller-call-compact__action" type="button" onClick={refreshEligibility} data-testid="airdroid-compact-refresh-status">{ELIGIBILITY_COPY.refresh}</button>
            </span>
          ) : eligibility.kind === "blocked" ? (
            <span className="seller-call-compact__error" role="alert" data-testid="airdroid-compact-eligibility" data-state={eligibility.reason}>
              {ELIGIBILITY_COPY[eligibility.reason]}{" "}
              <button className="seller-call-compact__action" type="button" onClick={refreshEligibility} data-testid="airdroid-compact-refresh-status">{ELIGIBILITY_COPY.refresh}</button>
              {" · "}
              <button className="seller-call-compact__action" type="button" onClick={openGhl} data-testid="airdroid-compact-review-contact">{ELIGIBILITY_COPY.review}</button>
            </span>
          ) : airdroidError ? <span className="seller-call-compact__error" data-testid="airdroid-compact-error">Not started. Use GHL Phone or Cell.</span> : null}
        </div>,
        props.compactCallSlot,
      ) : null}
    </section>
  );
}
