import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Phone, PhoneCall, Smartphone } from "lucide-react";
import { normalizeVoicePhone } from "../../shared/voice-call-contract";
import { formatPhone } from "../lib/format";
import { ghlContactDetailUrl } from "../lib/ghl";
import { openGhlContactWindow, type GhlHandoffResult } from "../lib/ghl-call-handoff";
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

  async function copySellerNumber() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function openGhl() {
    setHandoff(openGhlContactWindow(ghlUrl, (url, target) => window.open(url, target)));
  }

  return (
    <section className="seller-call-modes" aria-label="Seller calling options" data-testid="seller-call-modes">
      <div className="seller-call-mode" data-testid="call-with-ghl-mode">
        <strong><PhoneCall size={16} aria-hidden="true" /> Call with GHL Phone</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions">
          <button className="seller-call-button seller-call-button--primary" type="button" onClick={openGhl} data-testid="open-ghl-contact">
            <ExternalLink size={16} aria-hidden="true" /> Open seller in GHL
          </button>
        </div>
        <div className="seller-call-mode__hint" aria-live="polite" data-testid="ghl-handoff-status">
          {handoff === "blocked" ? (
            <span role="alert" className="seller-call-mode__error">
              Your browser blocked the new window.{" "}
              <a href={ghlUrl} target="_blank" rel="noopener noreferrer" data-testid="ghl-handoff-manual-link">Open the GHL record</a>{" "}
              manually, or allow pop-ups for IAOS.
            </span>
          ) : handoff === "opened" ? (
            "GHL opened in a new window. Confirm the contact name and number there before dialing. Opening GHL does not place or record a call."
          ) : (
            "Opens this seller's GHL record in a new window. Confirm the contact, then dial from GHL's phone icon. Opening GHL does not place or record a call."
          )}
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
