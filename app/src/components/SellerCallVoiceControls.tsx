import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Mic, MicOff, Phone, PhoneCall, PhoneOff, Smartphone } from "lucide-react";
import { Device } from "@twilio/voice-sdk";
import { normalizeVoicePhone, type VoiceCallState } from "../../shared/voice-call-contract";
import { formatPhone } from "../lib/format";
import { VoiceCallSession } from "../lib/voice/call-session";
import { TwilioBrowserAdapter, type BrowserVoiceConnection } from "../lib/voice/twilio-browser-adapter";
import {
  isVoiceAttemptActive,
  voiceControlAvailability,
  VOICE_STATE_LABELS,
} from "../lib/voice/seller-call-voice-controls";
import "./SellerCallVoiceControls.css";

type GoogleCredentialResponse = { credential?: string };
type VoiceBootstrap = { enabled: boolean; googleClientId: string | null };
type OperatorSession = { token: string; expiresAt: string };

declare global {
  interface Window {
    google?: {
      accounts: { id: {
        initialize(input: { client_id: string; callback(response: GoogleCredentialResponse): void; auto_select?: boolean }): void;
        renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
      } };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-iaos-google-identity="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google sign-in failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.iaosGoogleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in failed to load"));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

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

function browserVoiceSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && Device.isSupported &&
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function SellerCallVoiceControls(props: { contactId: string; sellerName: string; sellerPhone: string }) {
  const destination = useMemo(() => normalizeVoicePhone(props.sellerPhone), [props.sellerPhone]);
  const displayPhone = destination ? formatPhone(destination) : props.sellerPhone || "No valid seller number";
  const isMobile = useMobileViewport();
  const supported = browserVoiceSupported();
  const [softphoneOpen, setSoftphoneOpen] = useState(false);
  const [bootstrap, setBootstrap] = useState<VoiceBootstrap | null>(null);
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceCallState>("idle");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const signInRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<TwilioBrowserAdapter | null>(null);
  const callSessionRef = useRef<VoiceCallSession | null>(null);
  const connectionRef = useRef<BrowserVoiceConnection | null>(null);
  const operatorTokenRef = useRef("");
  const sessionActive = session !== null && Date.parse(session.expiresAt) > Date.now();

  const availability = voiceControlAvailability({
    isMobile,
    browserSupported: supported,
    featureEnabled: bootstrap?.enabled === true,
    authenticated: sessionActive,
    state: voiceState,
  });

  useEffect(() => {
    if (bootstrap !== null) return;
    let cancelled = false;
    fetch("/.netlify/functions/voice-session")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Voice availability check failed");
        return body as VoiceBootstrap;
      })
      .then((body) => { if (!cancelled) setBootstrap(body); })
      .catch((error: Error) => { if (!cancelled) { setBootstrap({ enabled: false, googleClientId: null }); setMessage(error.message); } });
    return () => { cancelled = true; };
  }, [bootstrap]);

  useEffect(() => {
    if (!softphoneOpen || !bootstrap?.enabled || !bootstrap.googleClientId || sessionActive || !signInRef.current) return;
    const googleClientId = bootstrap.googleClientId;
    let cancelled = false;
    loadGoogleIdentity().then(() => {
      if (cancelled || !signInRef.current || !window.google) return;
      signInRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        callback: async ({ credential }) => {
          if (!credential) { setMessage("Google sign-in returned no identity token"); return; }
          try {
            const response = await fetch("/.netlify/functions/voice-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ googleIdToken: credential }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? "Brad-only voice sign-in failed");
            operatorTokenRef.current = body.token;
            setSession(body as OperatorSession);
            setMessage(null);
          } catch (error) { setMessage((error as Error).message); }
        },
      });
      window.google.accounts.id.renderButton(signInRef.current, { theme: "outline", size: "large", text: "signin_with" });
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [softphoneOpen, bootstrap, sessionActive]);

  useEffect(() => {
    if (!session) return;
    const adapter = new TwilioBrowserAdapter();
    adapterRef.current = adapter;
    callSessionRef.current = new VoiceCallSession(adapter, () => operatorTokenRef.current);
    return () => {
      callSessionRef.current?.disconnect();
      adapter.destroy();
      callSessionRef.current = null;
      adapterRef.current = null;
      connectionRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!attemptId || !session || !isVoiceAttemptActive(voiceState)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const view = await callSessionRef.current?.restore(props.contactId);
        if (cancelled || !view) return;
        if (view.attemptId !== attemptId || view.contactBinding !== props.contactId) {
          setVoiceState("provider-unknown");
          setMessage("Call identity changed unexpectedly. Review provider state before trying again.");
          return;
        }
        setVoiceState(view.state);
      } catch (error) {
        if (!cancelled) setMessage(`Status refresh failed: ${(error as Error).message}`);
      }
    };
    const timer = window.setInterval(refresh, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [attemptId, session, voiceState, props.contactId]);

  async function copySellerNumber() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function dial() {
    if (!availability.canDial || !callSessionRef.current) return;
    const id = crypto.randomUUID();
    setAttemptId(id);
    setVoiceState("authorizing");
    setMessage(null);
    try {
      const authorized = await callSessionRef.current.authorize(props.contactId, id);
      if (authorized.contactBinding !== props.contactId || authorized.attemptId !== id) throw new Error("Voice authorization identity mismatch");
      setVoiceState("ready");
      connectionRef.current = await callSessionRef.current.start(
        authorized,
        (state) => { setVoiceState(state); setMuted(state === "muted"); },
        (error) => { setVoiceState("failed"); setMessage(error.message); },
      );
    } catch (error) {
      setVoiceState("failed");
      setMessage((error as Error).message);
    }
  }

  function toggleMute() {
    if (!availability.canMute || !connectionRef.current) return;
    const next = !connectionRef.current.isMuted();
    connectionRef.current.mute(next);
    setMuted(next);
  }

  function hangUp() {
    if (!availability.canHangUp) return;
    callSessionRef.current?.disconnect();
    connectionRef.current = null;
    setMuted(false);
    setVoiceState("disconnected");
  }

  return (
    <section className="seller-call-modes" aria-label="Seller calling options" data-testid="seller-call-modes">
      <div className="seller-call-mode" data-testid="call-with-cell-mode">
        <strong><Smartphone size={16} aria-hidden="true" /> Call with Cell</strong>
        <span className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</span>
        <div className="seller-call-mode__actions">
          {isMobile && destination ? (
            <a className="seller-call-button seller-call-button--primary" href={`tel:${destination}`} data-testid="call-with-cell-mobile">
              <Phone size={16} aria-hidden="true" /> Open phone dialer
            </a>
          ) : (
            <button className="seller-call-button" type="button" onClick={copySellerNumber} disabled={!destination} data-testid="call-with-cell-copy">
              <Copy size={16} aria-hidden="true" /> Copy seller number
            </button>
          )}
        </div>
        <div className="seller-softphone__hint" aria-live="polite">
          {isMobile ? "Your phone will prefill the number. You must press Send." : copyState === "copied" ? "Seller number copied." : copyState === "failed" ? "Copy failed — select the number above and copy it manually." : "Use your ordinary cell-phone calling path."}
        </div>
      </div>

      {availability.showIaosMode ? (
        <div className="seller-call-mode" data-testid="call-with-iaos-mode">
          <strong><PhoneCall size={16} aria-hidden="true" /> Call with IAOS</strong>
          <span className="seller-call-mode__identity">Outbound only · {props.sellerName} · {displayPhone}</span>
          <div className="seller-call-mode__actions">
            <button className="seller-call-button seller-call-button--primary" type="button" onClick={() => setSoftphoneOpen(true)} disabled={availability.iaosDisabled || !destination} data-testid="open-iaos-softphone">
              Open softphone
            </button>
          </div>
          {availability.iaosDisabled ? <div className="seller-softphone__hint">IAOS browser calling is unavailable on this browser or environment.</div> : null}
        </div>
      ) : null}

      {softphoneOpen && availability.showIaosMode ? (
        <div className="seller-softphone" data-testid="iaos-softphone">
          <div className="seller-softphone__header">
            <div>
              <strong>IAOS outbound softphone</strong>
              <div className="seller-call-mode__identity">{props.sellerName} · {displayPhone}</div>
            </div>
            <button className="seller-call-button" type="button" onClick={() => setSoftphoneOpen(false)} disabled={isVoiceAttemptActive(voiceState)}>Close</button>
          </div>
          {!sessionActive && bootstrap?.enabled ? <div ref={signInRef} className="seller-google-signin" data-testid="voice-google-signin" /> : null}
          <div className="seller-call-mode__actions" aria-label="Softphone controls">
            <button className="seller-call-button seller-call-button--primary" type="button" onClick={dial} disabled={!availability.canDial} data-testid="voice-dial"><Phone size={16} aria-hidden="true" /> Dial</button>
            <button className="seller-call-button" type="button" onClick={toggleMute} disabled={!availability.canMute} aria-pressed={muted} data-testid="voice-mute">{muted ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}{muted ? "Unmute" : "Mute"}</button>
            <button className="seller-call-button seller-call-button--danger" type="button" onClick={hangUp} disabled={!availability.canHangUp} data-testid="voice-hang-up"><PhoneOff size={16} aria-hidden="true" /> Hang Up</button>
          </div>
          <div className="seller-softphone__status" role="status" aria-live="polite" data-testid="voice-lifecycle-state">{VOICE_STATE_LABELS[voiceState]}</div>
          {message ? <div className="seller-softphone__error" role="alert" data-testid="voice-failure-message">{message}</div> : null}
          <div className="seller-softphone__hint">Ending this call does not select a disposition or schedule a callback.</div>
        </div>
      ) : null}
    </section>
  );
}
