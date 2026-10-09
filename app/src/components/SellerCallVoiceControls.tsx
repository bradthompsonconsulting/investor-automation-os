import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, MonitorSmartphone, Phone, PhoneCall, Smartphone } from "lucide-react";
import { normalizeVoicePhone } from "../../shared/voice-call-contract";
import { airdroidCallTarget, launchAirdroidCall, type AirdroidLaunchResult } from "../lib/airdroid-launch";
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
 * window, fetch or write. It shows only an invalid-number
 * reason or an error the interface reports, cleared whenever the seller
 * changes. It cannot see a call, a helper or a cancelled launch, so it never
 * claims a call was placed, connected or ended.
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

export function SellerCallVoiceControls(props: { contactId: string; sellerName: string; sellerPhone: string }) {
  const destination = useMemo(() => normalizeVoicePhone(props.sellerPhone), [props.sellerPhone]);
  const displayPhone = destination ? formatPhone(destination) : "No valid seller number";
  const ghlUrl = ghlContactDetailUrl(props.contactId);
  const isMobile = useMobileViewport();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [handoff, setHandoff] = useState<GhlHandoffResult | null>(null);
  const airdroidTarget = useMemo(() => airdroidCallTarget(props.sellerPhone), [props.sellerPhone]);
  const [airdroidError, setAirdroidError] = useState<string | null>(null);
  // A launch error belongs to one seller: clear it when the seller (even one sharing this number) or the number changes.
  useEffect(() => setAirdroidError(null), [props.contactId, airdroidTarget]);

  async function copySellerNumber() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function callWithAirdroid() {
    if (!airdroidTarget) return;
    let result: AirdroidLaunchResult;
    try {
      result = launchAirdroidCall(airdroidTarget);
    } catch {
      result = { ok: false, error: "AirDroid couldn't be started." };
    }
    setAirdroidError(result.ok ? null : result.error);
  }

  function openGhl() {
    setHandoff(openGhlContactWindow(ghlUrl, (url, target) => window.open(url, target)));
  }

  return (
    <section className="seller-call-modes" aria-label="Seller calling options" data-testid="seller-call-modes">
      <div className="seller-call-mode seller-call-mode--primary" data-testid="call-with-airdroid-mode">
        <strong><MonitorSmartphone size={16} aria-hidden="true" /> Call with AirDroid</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions">
          <button className="seller-call-button seller-call-button--primary" type="button" onClick={callWithAirdroid} disabled={!airdroidTarget} data-testid="call-with-airdroid">
            <PhoneCall size={16} aria-hidden="true" /> Call with AirDroid
          </button>
        </div>
        {!airdroidTarget ? (
          <div className="seller-call-mode__hint" data-testid="airdroid-no-number">
            Unavailable: IAOS has no valid 10-digit US number for this seller. Use GHL Phone or Cell.
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
    </section>
  );
}
