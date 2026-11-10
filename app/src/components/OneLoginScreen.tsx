/**
 * B15-29 (INV-137) professional login experience -- rendered ONLY while one IAOS sign-in is on (by OneLoginAccess).
 *
 * Presentation only: it never decides sign-in state, never reads or stores a credential, and never sends a request.
 *
 *   entrance  no session yet. Full page; the routed app is NOT rendered underneath (OneLoginAccess does not mount it).
 *   overlay   session ended, revoked, unavailable or "Log In Again". Fixed, opaque, full viewport ABOVE the still-mounted
 *             app: the app is never unmounted (drafts survive in component memory), it is made `inert` while the
 *             overlay is up, and focus returns to the element that had it once the overlay closes.
 *
 * Every layer (this screen and the reminder dialog) is a portal into <body> with aria-modal, a Tab focus trap, and
 * `inert` on every other child of <body> (the app root included); only the attributes it added are removed again.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

export const IAOS = { navy: "#07142E", accent: "#1EC8FF", cta: "#005CE6", card: "#1B2433", text: "#F5F7FA", muted: "rgba(245,247,250,0.72)" };
const DISPLAY = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
const BODY = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const LAYER = "data-iaos-layer";

// The last element focused OUTSIDE every layer: what focus returns to when a layer closes.
let lastFocus: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === "function" && !t.closest(`[${LAYER}]`)) lastFocus = t;
  }, true);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal layer: portal host in <body>, background inert, Tab trapped, focus restored on close. */
function useModalLayer(dialog: RefObject<HTMLElement | null>): HTMLElement | null {
  const [host] = useState(() => (typeof document === "undefined" ? null : (() => { const d = document.createElement("div"); d.setAttribute(LAYER, ""); return d; })()));
  useLayoutEffect(() => {
    if (!host) return;
    const restore = lastFocus;
    document.body.appendChild(host);
    const made: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === host || el.hasAttribute(LAYER) || el.hasAttribute("inert") || el.tagName === "SCRIPT") continue;
      el.setAttribute("inert", ""); made.push(el);
    }
    const first = () => dialog.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.current?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog.current;
    first()?.focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); dialog.current.focus(); return; }
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === -1 || i === items.length - 1 ? 0 : i + 1);
      e.preventDefault(); items[next].focus();
    };
    const keep = (e: FocusEvent) => { if (dialog.current && e.target instanceof Node && !host.contains(e.target)) first()?.focus({ preventScroll: true }); };
    document.addEventListener("keydown", trap, true);
    document.addEventListener("focusin", keep, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      document.removeEventListener("focusin", keep, true);
      for (const el of made) el.removeAttribute("inert");
      host.remove();
      // After the app is visible again (next task), return focus to where it was -- unless another layer took over.
      setTimeout(() => { if (restore && restore.isConnected && !document.querySelector(`[${LAYER}]`)) restore.focus({ preventScroll: true }); }, 0);
    };
  }, [host, dialog]);
  return host;
}

export function IaosMark({ size = 48 }: { size?: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12 }} data-testid="iaos-mark">
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #a5f3fc 0%, #22d3ee 50%, #06b6d4 100%)", color: IAOS.navy,
      fontFamily: DISPLAY, fontWeight: 700, fontSize: Math.round(size * 0.4), boxShadow: "0 0 20px rgba(0,217,255,0.3), inset 0 1px 0 rgba(255,255,255,0.45)",
    }}>IA</div>
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, fontFamily: DISPLAY }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: IAOS.text, letterSpacing: "0.02em" }}>INVESTOR</span>
      <span style={{ fontSize: 13, color: IAOS.accent, letterSpacing: "0.02em" }}>AUTOMATION OS</span>
    </div>
  </div>;
}

export type ScreenAction = { label: string; onClick: () => void; testId: string; busy?: boolean };
export type ScreenMessage = { text: string; tone: "status" | "alert"; testId?: string };

const page: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2147483000, overflowY: "auto", overflowX: "hidden", boxSizing: "border-box",
  display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px",
  background: `radial-gradient(ellipse 80% 60% at 50% 0%, rgba(30,200,255,0.12) 0%, rgba(30,200,255,0) 60%), ${IAOS.navy}`,
  color: IAOS.text, fontFamily: BODY,
};
const card: CSSProperties = {
  width: "100%", maxWidth: 420, boxSizing: "border-box", background: IAOS.card, border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20, padding: "clamp(24px, 7vw, 40px)", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", outline: "none",
};
export const primaryButton = (busy = false): CSSProperties => ({
  width: "100%", minHeight: 48, borderRadius: 12, border: "none", background: IAOS.cta, color: "#FFFFFF",
  fontFamily: DISPLAY, fontWeight: 600, fontSize: 16, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.75 : 1,
});
export const secondaryButton: CSSProperties = {
  width: "100%", minHeight: 44, borderRadius: 12, background: "transparent", color: IAOS.text,
  border: "1px solid rgba(245,247,250,0.24)", fontFamily: DISPLAY, fontWeight: 500, fontSize: 15, cursor: "pointer",
};
const FOCUS_CSS = `[${LAYER}] button:focus-visible{outline:2px solid ${IAOS.accent};outline-offset:3px}`;

export function Btn({ action, primary }: { action: ScreenAction; primary: boolean }) {
  return <button type="button" data-testid={action.testId} data-autofocus={primary ? "" : undefined}
    aria-disabled={action.busy ? "true" : undefined} aria-busy={action.busy ? "true" : undefined}
    onClick={() => { if (!action.busy) action.onClick(); }}
    style={primary ? primaryButton(action.busy) : secondaryButton}>{action.label}</button>;
}

/** The full-page / overlay sign-in screen. */
export default function OneLoginScreen({ mode, testId, heading, line, message, primary, secondary, footer = true }: {
  mode: "entrance" | "overlay"; testId: string; heading?: string; line?: string; message?: ScreenMessage | null;
  primary?: ScreenAction | null; secondary?: ScreenAction | null; footer?: boolean;
}) {
  const dialog = useRef<HTMLDivElement | null>(null);
  const host = useModalLayer(dialog);
  // The primary action can appear after the layer opened (checking -> signed out): give it focus unless the operator moved it.
  useEffect(() => {
    const a = document.activeElement;
    if (a === dialog.current || a === document.body || a === null) dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [primary?.testId]);
  if (!host) return null;
  const headingId = `${testId}-heading`;
  return createPortal(<div style={page} data-testid={testId} data-mode={mode}>
    <style>{FOCUS_CSS}</style>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : "IAOS sign-in"}
      tabIndex={-1} style={card} data-testid="one-login-card">
      <IaosMark />
      {heading && <h1 id={headingId} style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, margin: "28px 0 8px", color: IAOS.text, letterSpacing: "-0.01em" }}>{heading}</h1>}
      {line && <p style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.5, color: IAOS.muted }}>{line}</p>}
      {!heading && !line && <div style={{ height: 24 }} />}
      {primary && <Btn action={primary} primary />}
      {secondary && <div style={{ marginTop: 12 }}><Btn action={secondary} primary={false} /></div>}
      <p role={message?.tone === "alert" ? "alert" : "status"} data-testid={message?.testId ?? "one-login-message"}
        style={{ minHeight: 20, margin: "16px 0 0", fontSize: 14, lineHeight: 1.45, color: message?.tone === "alert" ? "#FFD7D7" : IAOS.muted }}>
        {message?.text ?? ""}</p>
      {footer && <p style={{ margin: "24px 0 0", paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12.5, color: "rgba(245,247,250,0.6)" }}>
        Secure sign-in with your authorized Google account.</p>}
    </div>
  </div>, host);
}

/** The 5-day / 1-day reminder: a centred dark card over a dimmed, inert app. */
export function ReminderDialog({ text, onLater, onLogIn }: { text: string; onLater: () => void; onLogIn: () => void }) {
  const dialog = useRef<HTMLDivElement | null>(null);
  const host = useModalLayer(dialog);
  if (!host) return null;
  return createPortal(<div data-testid="session-reminder-backdrop" style={{
    position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px 16px", boxSizing: "border-box", background: "rgba(7,20,46,0.78)", fontFamily: BODY, color: IAOS.text, overflowX: "hidden",
  }}>
    <style>{FOCUS_CSS}</style>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="session-reminder-heading" aria-describedby="session-reminder-text"
      tabIndex={-1} style={card} data-testid="session-reminder">
      <IaosMark size={40} />
      <h2 id="session-reminder-heading" style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, margin: "24px 0 8px" }}>Session reminder</h2>
      <p id="session-reminder-text" data-testid="session-reminder-text" style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.5, color: IAOS.muted }}>{text}</p>
      <Btn action={{ label: "Log In Again", onClick: onLogIn, testId: "session-reminder-log-in" }} primary />
      <div style={{ marginTop: 12 }}><Btn action={{ label: "Remind Me Later", onClick: onLater, testId: "session-reminder-later" }} primary={false} /></div>
    </div>
  </div>, host);
}

