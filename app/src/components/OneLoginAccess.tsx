import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import OneLoginScreen, { ReminderDialog, type ScreenAction, type ScreenMessage } from "./OneLoginScreen";
import { dismissReminder, dueReminder, nextReminderDelay, reminderDismissed, reminderMessage } from "../lib/session-reminder";
import { READ_SESSION_ENDPOINT, READ_SESSION_LOST_EVENT } from "../lib/read-session";
import { SESSION_UNAVAILABLE_EVENT, SESSION_UNAVAILABLE_MARKER, oneLoginSessionScale } from "../lib/one-login";
import { clearAppWriteToken, confirmAppWriteSession, pauseAppWriteForSignOut, primeAppWriteSession, replaceAppWriteSession, resumeAppWriteAccess } from "../lib/app-write-session";
import { clearOperatorScopedData, operatorChangedSinceLastPage, rememberOperator } from "../lib/operator-partition";
import { ReadRecovered, ReadViewReport, type ReadView } from "./access-status";

/** The ONE status line while one IAOS sign-in is on (Layout renders this instead of AppWriteAccess): no saving control. */
export function OneLoginStatusLine({ read }: { read: ReadView }) {
  if (read.kind !== "signed_in") return null;
  return <div role="status" data-testid="session-status" className="text-sm" style={{ padding: "6px 16px", color: "#fff", background: "#14213d" }}>
    <span data-testid="read-access-signed-in">
      {/* 30-day session: show the END DATE (a time alone read as "ends today"). A Test-scaled session (under a day)
          says so and shows the end TIME, which is what can be checked. */}
      {oneLoginSessionScale() < 1
        ? <>Signed in · Test session ends {new Date(read.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</>
        : <>Signed in · session ends {new Date(read.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>} · <button onClick={read.signOut}>Sign out</button></span>
  </div>;
}

export const SIGN_OUT_ENDPOINT = "/.netlify/functions/app-signout";
/** Client bound on one Sign out attempt (wall clock on this computer; not a server guarantee). */
export const SIGN_OUT_CLIENT_TIMEOUT_MS = 10_000;
export const SIGNED_OUT_TEXT = "You've signed out of IAOS.";
export const SIGN_OUT_NOT_CONFIRMED_TEXT = "Sign-out not confirmed. IAOS could not verify this Sign out. Saving is paused on this page.";
/** Longest single expiry wait (one day): well under setTimeout's 2^31-1 ms limit. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
export const UNAVAILABLE_TEXT = "IAOS sign-in is temporarily unavailable. Try again.";
/** B15-29 login experience copy (spec §1). */
export const SIGN_IN_LABEL = "Sign In to IAOS";
export const WORKING_TEXT = "Opening secure sign-in…";
export const POPUP_BLOCKED_TEXT = "Allow pop-ups for IAOS to sign in.";
export const EXPIRED_TEXT = "Your 30-day session has ended. Sign in to continue — your unsaved work is still here.";
/** B15-29 (Jess 2026-11-10): the same copy on a Test-scaled lifetime, never claiming 30 days. */
export const TEST_EXPIRED_TEXT = "Your Test session has ended. Sign in to continue — your unsaved work is still here.";
const sessionLengthText = (scale: number) => (scale < 1 ? `${Math.round((scale * 30 * 24 * 60))}-minute Test` : "30-day");
/** r4 (R3-2): shown once after a sign-in with a DIFFERENT account replaced this page's session. */
export const ACCOUNT_CHANGED_HEADING = "Signed in with a different account";
export const ACCOUNT_CHANGED_TEXT = "Unsaved work from the previous account was cleared from this page. Anything already saved is not affected.";

/** Why there is no session: none known (first visit / expired cookie), ended while open, revoked by a Sign out elsewhere, or Sign out here. */
type SignedOutReason = "none" | "ended" | "revoked" | "signed_out_here";
type Status =
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "signed_out"; reason: SignedOutReason }
  | { kind: "signed_in"; expiresAt: number; operator: string; session: string }
  | { kind: "unavailable"; message: string }
  | { kind: "signing_out" }
  | { kind: "signout_unconfirmed"; message: string };

/**
 * SECURITY -- B15-29 (INV-137) read gate while one IAOS sign-in is on
 * (Layout chooses it ONLY when oneLoginActive(); ReadAccess is unchanged and
 * used otherwise). Same page-preserving shape as ReadAccess: the page lives in
 * ONE wrapper in every state and is never remounted, so drafts, saves in flight
 * and their warnings survive every state below.
 *
 *   signed_in            the server confirmed the session AND a verified-absent revocation; holds this tab's
 *                        current revoke-only handle (memory only, never storage, never logged)
 *   signed_out           no session, an expired one, or a VERIFIED revocation ("Signed out of IAOS.")
 *   unavailable          IAOS could not confirm the session (C1). NOT signed out, NOT a sign-in prompt:
 *                        [Try again] re-checks deliberately; no automatic loop
 *   signout_unconfirmed  Sign out was not acknowledged; saving stays paused on this page; [Try Sign out again]
 *                        re-sends the SAME frozen handle (it can only ever revoke the old session)
 *
 * Every status request and Sign out attempt is tagged with this tab's session
 * generation (bumped when Sign out begins and when it is confirmed); a late
 * answer from an earlier generation or attempt is discarded. The status is
 * re-checked on load, focus and visibility, after any refused or unavailable
 * answer -- never while a Sign out is pending or unconfirmed. Other tabs are
 * stopped by the server, not by this component.
 *
 * B15-29 login experience (spec SPEC_LOGIN_EXPERIENCE): with no session yet the full-page entrance screen is shown
 * and the routed app is not rendered (the URL is never touched, so the deep link is where the app opens). Once the
 * page has been signed in, every later state is an opaque full-viewport OVERLAY above the still-mounted, inert page
 * (never unmounted, so drafts survive; focus returns after). The 5-day / 1-day reminder is computed only from the
 * server's absolute `expiresAt`; Remind Me Later records a dismissal and sends nothing; Log In Again opens the
 * overlay, and its sign-in is a NEW 30-day session (the old one is left to expire).
 *
 * r4 (Bones R3-2, delayed status). Every status answer carries non-secret operator / session tags. A deliberate
 * sign-in discards the saving token at once (cached and pending) and saving waits for the server-confirmed NEW
 * session; whenever a confirmed session differs from the one this page had (this tab or another one replaced the
 * cookie), the old session's saving tokens are discarded, and if the OPERATOR differs the routed app is remounted,
 * operator-scoped page data is cleared (lib/operator-partition.ts) and a neutral notice says so. The same operator
 * keeps the page and its unsaved work. Every status request carries a sequence number: an answer older than the
 * newest applied one, or from an earlier generation, is discarded, so a late "signed in" can never repaint after a
 * newer revoked / unavailable / expired answer.
 */
/* ───────────────────────── B15-29 single-flight session status (design r1–r6, Bones ACCEPT) ─────────────────────────
 * ONE status request in flight per tab; further triggers coalesce into at most ONE queued revalidation; a refusal that
 * arrives while a request is in flight invalidates that request's success; consecutive refusals are bounded (backoff,
 * then a persistent "exhausted" state until a reset trigger); sign-out, sign-in (generation replacement) and unmount
 * cancel queued and scheduled work. Every GHL reader still sends its own request and is authorized by the server; the
 * client caches no authorization. Instrumentation (TRACE) exists ONLY in the offline test harness build.
 */
type Reason = "none" | "ended";
type TriggerClass = "reset" | "fresh" | "refusal";
type Queued = { reason: Reason; fresh: boolean };
type Flight = { id: number; g: number; invalidated: boolean; preExhaustion: boolean };
type Slot =
  | { kind: "idle" }
  | { kind: "flight"; f: Flight }
  | { kind: "scheduled"; id: number; g: number; timer: ReturnType<typeof setTimeout>; queued: Queued };
type StatusResult =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "signed_in"; expiresAt: number; operator: string; session: string; handle: string }
  | { kind: "signed_out"; reason: SignedOutReason };
/** Consecutive refusals tolerated before the status stops re-checking on its own (reset: sign-in, Try again, load). */
export const MAX_REFUSALS = 2;
/** Delay before a revalidation, indexed by the refusals counted so far (capped at the last entry). */
export const STATUS_BACKOFF_MS = [0, 1000] as const;
const merge = (a: Queued | null, b: Queued): Queued =>
  ({ reason: a?.reason === "ended" || b.reason === "ended" ? "ended" : "none", fresh: !!a?.fresh || b.fresh });
const JSON_FAILED = Symbol("json-failed");
/** Harness-only instrumentation gate: the application build never defines this variable, so every TRACE block is dead code. */
const TRACE = import.meta.env.VITE_IAOS_STATUS_PROBE === "1";
const traceLog = (): any[] => ((window as any).__iaosStatusTrace ??= []);
type Fx = {
  setStatus: (v: Status | ((cur: Status) => Status)) => void;
  setPartition: (v: (p: number) => number) => void;
  setAccountChanged: (v: boolean) => void;
  adoptSession: (n: { operator: string; session: string }) => void;
  primeAppWriteSession: () => void;
  confirmAppWriteSession: () => void;
  replaceAppWriteSession: () => void;
  clearOperatorScopedData: () => void;
  rememberOperator: (o: string) => void;
  setHandle: (h: string | null) => void;
  setAppliedSeq: (v: number) => void;
  schedule: (q: Queued, delay: number, site: string) => void;
  start: (q: Queued) => Promise<void>;
};

export default function OneLoginAccess({ children }: { children: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [status, setStatusRaw] = useState<Status>({ kind: "checking" });
  const [wasSignedIn, setWasSignedIn] = useState(false);
  useEffect(() => { if (status.kind === "signed_in") setWasSignedIn(true); }, [status.kind]);
  const [epoch, setEpoch] = useState(0);
  const lapsed = useRef(false);
  const [popupState, setPopupState] = useState<"idle" | "working" | "blocked">("idle");
  const [relogin, setRelogin] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const seq = useRef(0);
  const appliedSeq = useRef(0);
  /** The session this page last had confirmed (non-secret tags), kept across lapses so a replacement is always seen. */
  const bound = useRef<{ operator: string; session: string } | null>(null);
  const pageShown = useRef(false);
  const [partition, setPartitionRaw] = useState(0);
  const [accountChanged, setAccountChangedRaw] = useState(false);
  const attempt = useRef(0);
  const handle = useRef<string | null>(null);
  const frozen = useRef<string | null>(null);
  const signOutBusy = useRef(false);
  // single-flight state (refs only)
  const slotRef = useRef<Slot>({ kind: "idle" });
  const pendingRef = useRef<Queued | null>(null);
  const refusals = useRef(0);
  const exhausted = useRef(false);
  const unmountedRef = useRef(false);
  const nextFlightId = useRef(0);
  const nextScheduledId = useRef(0);
  /** Status timers actually armed (a cancelled or fired timer is removed). */
  const liveTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** The flight whose continuation is running synchronously right now (trace attribution only). */
  const ctxFlight = useRef<number | null>(null);

  // ── the ONE table of state applications and side effects (r5 D21); the raw table itself in the application build.
  // Built once: every function it reaches reads refs and stable setters only, so the first render's closures stay valid.
  const fxRef = useRef<Fx | null>(null);
  if (fxRef.current === null) {
    const raw: Fx = {
      setStatus: (v) => setStatusRaw(v),
      setPartition: (v) => setPartitionRaw(v),
      setAccountChanged: (v) => setAccountChangedRaw(v),
      adoptSession: (n) => adoptSessionRaw(n),
      primeAppWriteSession: () => primeAppWriteSession(),
      confirmAppWriteSession: () => confirmAppWriteSession(),
      replaceAppWriteSession: () => replaceAppWriteSession(),
      clearOperatorScopedData: () => clearOperatorScopedData(),
      rememberOperator: (o) => rememberOperator(o),
      setHandle: (h) => { handle.current = h; },
      setAppliedSeq: (v) => { appliedSeq.current = v; },
      schedule: (q, d, site) => scheduleRaw(q, d, site),
      start: (q) => startRaw(q),
    };
    if (TRACE) {
      const traced = {} as Record<string, (...a: any[]) => any>;
      for (const op of Object.keys(raw) as (keyof Fx)[]) {
        traced[op] = (...a: any[]) => {
          const sl = slotRef.current;
          traceLog().push({ rule: "apply", op, unmounted: unmountedRef.current, flight: ctxFlight.current ?? (sl.kind === "flight" ? sl.f.id : null),
            ...(op === "start" ? { item: a[0] ? { ...a[0] } : null } : {}) });
          return (raw[op] as (...x: any[]) => any)(...a);
        };
      }
      fxRef.current = traced as unknown as Fx;
    } else {
      fxRef.current = raw;
    }
  }
  const fx = fxRef.current;

  /** r4: a server-confirmed session. A different session than before discards its saving tokens; a different operator partitions the page. */
  function adoptSessionRaw(next: { operator: string; session: string }) {
    const prev = bound.current;
    if (prev === null) {
      if (operatorChangedSinceLastPage(next.operator)) fx.clearOperatorScopedData();
    } else if (prev.session !== next.session) {
      fx.replaceAppWriteSession();
      if (prev.operator !== next.operator) {
        fx.clearOperatorScopedData();
        fx.setPartition((p) => p + 1);
        if (pageShown.current) fx.setAccountChanged(true);
      }
    }
    bound.current = next;
    fx.rememberOperator(next.operator);
    fx.confirmAppWriteSession();
    fx.primeAppWriteSession();   // learn the (new) operator's identity before the first save; silent on failure
  }

  // ── ownership writes: the ONLY assignments to slotRef / pendingRef (r5 D26′) ──
  function checkI1(site: string) {
    if (pendingRef.current !== null && slotRef.current.kind !== "flight") {
      traceLog().push({ rule: "I-1", site, slotKind: slotRef.current.kind, pending: pendingRef.current.reason });
    }
  }
  function setSlot(next: Slot, site: string) { slotRef.current = next; if (TRACE) checkI1(site); }
  function setPending(next: Queued | null, site: string) { pendingRef.current = next; if (TRACE) checkI1(site); }

  const halted = () => unmountedRef.current || signOutBusy.current || !!frozen.current;
  const eligible = (q: Queued, g: number) => !halted() && g === generation.current && (!exhausted.current || q.fresh);

  function cancelSlot(site: string) {
    const s = slotRef.current;
    if (s.kind === "scheduled") { clearTimeout(s.timer); liveTimers.current.delete(s.timer); }
    setPending(null, `cancel:${site}`);
    setSlot({ kind: "idle" }, `cancel:${site}`);
  }

  function enterExhaustion() {
    exhausted.current = true;
    const s = slotRef.current;   // r4 F1: decided once, before any mutation
    if (s.kind === "flight") {
      s.f.invalidated = true;
      s.f.preExhaustion = true;
    } else if (s.kind === "scheduled") {
      if (!(s.queued.fresh && !halted() && s.g === generation.current)) {
        clearTimeout(s.timer); liveTimers.current.delete(s.timer);
        setSlot({ kind: "idle" }, "exhaust:slot-idle");
      }
    }
    if (pendingRef.current && !pendingRef.current.fresh) setPending(null, "exhaust:pending-clear");
    fx.setStatus((cur) => (cur.kind === "signed_out" ? cur : { kind: "unavailable", message: UNAVAILABLE_TEXT }));
  }

  function scheduleRaw(q: Queued, delay: number, site: string) {
    const id = ++nextScheduledId.current;
    const g = generation.current;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => { liveTimers.current.delete(timer); fire(id); }, delay);
    liveTimers.current.add(timer);
    setSlot({ kind: "scheduled", id, g, timer, queued: q }, site);
  }

  function fire(id: number) {
    const s = slotRef.current;
    if (s.kind !== "scheduled" || s.id !== id) return;
    const q = s.queued;   // captured before the slot is released
    setSlot({ kind: "idle" }, "fire:slot-idle");
    if (eligible(q, s.g)) void fx.start(q);
  }

  /** Every status trigger enters here. */
  function request(reason: Reason, cls: TriggerClass) {
    if (halted()) return;
    if (cls === "reset") { refusals.current = 0; exhausted.current = false; }
    if (cls === "refusal") {
      refusals.current += 1;
      const cur = slotRef.current;
      if (cur.kind === "flight") cur.f.invalidated = true;
      if (exhausted.current) return;
      if (refusals.current > MAX_REFUSALS) { enterExhaustion(); return; }
    }
    const item: Queued = { reason, fresh: cls !== "refusal" };
    const s = slotRef.current;
    if (s.kind === "flight") { setPending(merge(pendingRef.current, item), "request:merge-pending"); return; }
    if (s.kind === "scheduled") { setSlot({ ...s, queued: merge(s.queued, item) }, "request:merge-queued"); return; }
    if (cls === "refusal" && refusals.current > 1) {
      fx.schedule(item, STATUS_BACKOFF_MS[Math.min(refusals.current - 1, STATUS_BACKOFF_MS.length - 1)], "request:schedule");
    } else {
      void fx.start(item);
    }
  }

  function classify(res: Response, body: any, reason: Reason): StatusResult {
    if (body === JSON_FAILED || body === null || typeof body !== "object") return { kind: "unavailable" };
    if (res.status === 503 && body?.by === "iaos-app-read-unconfigured") return { kind: "unconfigured" };
    if (res.status === 503 && body?.by === SESSION_UNAVAILABLE_MARKER) return { kind: "unavailable" };
    if (!res.ok) return { kind: "unavailable" };
    const expiresAt = Date.parse(body?.expiresAt ?? "");
    if (body?.state === "signed_in" && body?.signedIn === true && typeof body?.handle === "string" && Number.isFinite(expiresAt) && expiresAt > Date.now() &&
        typeof body?.operator === "string" && body.operator && typeof body?.session === "string" && body.session) {
      return { kind: "signed_in", expiresAt, operator: body.operator, session: body.session, handle: body.handle };
    }
    return { kind: "signed_out", reason: body?.state === "revoked" ? "revoked" : reason };
  }

  /** r4 F3: the ONE place a status answer (success, refusal, network or JSON failure) reaches the page. */
  function apply(f: Flight, s: number, r: StatusResult) {
    if (unmountedRef.current) return;
    // Discarded: an answer from before a Sign out began or a sign-in replaced the session, or older than one already applied.
    if (f.g !== generation.current || frozen.current || s < appliedSeq.current) return;
    if (r.kind === "signed_in" && (f.invalidated || f.preExhaustion)) return;   // a stale success never confirms a session
    fx.setAppliedSeq(s);
    if (r.kind === "unconfigured") { fx.setStatus({ kind: "unconfigured" }); return; }
    if (r.kind === "unavailable") { fx.setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }
    if (r.kind === "signed_in") {
      fx.adoptSession({ operator: r.operator, session: r.session });
      fx.setHandle(r.handle);
      fx.setStatus({ kind: "signed_in", expiresAt: r.expiresAt, operator: r.operator, session: r.session });
      return;
    }
    fx.setHandle(null);
    fx.setStatus({ kind: "signed_out", reason: r.reason });
  }

  /** Owning-flight completion (r4 F1): clear the queue holder, then free the slot, then hand work to ONE new owner. */
  function complete(f: Flight) {
    if (unmountedRef.current) return;
    const s = slotRef.current;
    if (s.kind !== "flight" || s.f !== f) return;   // not the owner: no write of any kind
    const q = pendingRef.current;
    setPending(null, "complete:pending-clear");
    setSlot({ kind: "idle" }, "complete:slot-idle");
    if (q && eligible(q, f.g)) fx.schedule(q, STATUS_BACKOFF_MS[Math.min(refusals.current, STATUS_BACKOFF_MS.length - 1)], "complete:schedule");
  }

  async function startRaw(item: Queued): Promise<void> {
    const f: Flight = { id: ++nextFlightId.current, g: generation.current, invalidated: false, preExhaustion: false };
    const s = ++seq.current;
    setSlot({ kind: "flight", f }, "start:slot-flight");
    let res: Response | null = null;
    let body: any = JSON_FAILED;
    try { res = await fetch(READ_SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin" }); ctxFlight.current = f.id; }
    catch { ctxFlight.current = f.id; res = null; }
    if (res) body = await res.json().catch(() => { ctxFlight.current = f.id; return JSON_FAILED; });
    ctxFlight.current = f.id;
    try {
      if (unmountedRef.current) return;
      const r: StatusResult = res ? classify(res, body, item.reason) : { kind: "unavailable" };
      try { apply(f, s, r); } finally { complete(f); }
    } finally { ctxFlight.current = null; }
  }

  useEffect(() => {
    if (status.kind === "signed_in") {
      if (lapsed.current) { lapsed.current = false; setEpoch((e) => e + 1); }
      fx.primeAppWriteSession();
    } else if (wasSignedIn && status.kind !== "checking") lapsed.current = true;
    // Any state other than signed in: no saving token is kept (the next save asks again, and is refused if still not signed in).
    if (status.kind !== "signed_in" && status.kind !== "checking") clearAppWriteToken();
  }, [status.kind, wasSignedIn]);
  const report = useContext(ReadViewReport);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    if (TRACE) traceLog().push({ rule: "report", kind: status.kind, unmounted: unmountedRef.current });
    report(status.kind === "signed_in"
      ? { kind: "signed_in", expiresAt: status.expiresAt, signOut: () => { void signOutRef.current(); } }
      : { kind: status.kind === "signing_out" ? "signout_unconfirmed" : status.kind });
  }, [status, report]);

  // Load (a reset trigger) and unmount.
  useEffect(() => {
    unmountedRef.current = false;
    if (TRACE) {
      (window as any).__iaosStatusProbe = {
        get slotKind() { return slotRef.current.kind; },
        get pendingHeld() { return pendingRef.current !== null; },
        get queuedHeld() { return slotRef.current.kind === "scheduled"; },
        get queued() { const s = slotRef.current; return s.kind === "scheduled" ? { ...s.queued } : pendingRef.current ? { ...pendingRef.current } : null; },
        get refusals() { return refusals.current; },
        get exhausted() { return exhausted.current; },
        get scheduledId() { const s = slotRef.current; return s.kind === "scheduled" ? s.id : null; },
        get timersArmed() { return liveTimers.current.size; },
        get currentFlightId() { const s = slotRef.current; return s.kind === "flight" ? s.f.id : null; },
        bumpGenerationOnly() { generation.current += 1; },
      };
    }
    request("none", "reset");
    return () => { unmountedRef.current = true; cancelSlot("unmount"); };
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "iaos-app-read-signed-in") return;
      popup.current.close(); popup.current = null;
      // A deliberate sign-in: a new session; any old frozen handle is dropped. r4: the old session's saving tokens
      // (cached and pending) are discarded NOW and saving waits until the status check confirms the new session.
      // Single-flight: queued and scheduled work is cancelled, the generation replaced, and a FRESH check starts at once.
      cancelSlot("signin");
      generation.current += 1; frozen.current = null; fx.setHandle(null);
      refusals.current = 0; exhausted.current = false;
      resumeAppWriteAccess();
      setPopupState("idle");
      void fx.start({ reason: "none", fresh: true }).then(() => setRelogin(false));
    };
    const lost = () => request("ended", "refusal");
    const recheck = () => { if (document.visibilityState === "visible") request("none", "fresh"); };
    window.addEventListener("message", receive);
    window.addEventListener(READ_SESSION_LOST_EVENT, lost);
    window.addEventListener(SESSION_UNAVAILABLE_EVENT, lost);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener(READ_SESSION_LOST_EVENT, lost);
      window.removeEventListener(SESSION_UNAVAILABLE_EVENT, lost);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  const expiresAt = status.kind === "signed_in" ? status.expiresAt : 0;
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    // B15-29 r6: a 30-day expiry is beyond setTimeout's 2^31-1 ms limit (an overflow would fire at once and loop), so the
    // wait is capped at one day; at that point the status is simply re-checked and the timer re-armed.
    const timer = setTimeout(() => { setRearm((n) => n + 1); request("ended", "fresh"); }, Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - Date.now())));
    return () => clearTimeout(timer);
  }, [expiresAt, rearm]);

  // Reminder checkpoints (T5, T1) from the server's absolute expiry: re-evaluated at each status answer and by a
  // local timer at the next checkpoint (capped at one day). No request is made here.
  useEffect(() => {
    if (!expiresAt) return;
    const delay = nextReminderDelay(expiresAt, Date.now(), oneLoginSessionScale());
    if (delay === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, tick]);

  // While the sign-in popup is open: "working"; closed without signing in -> back to idle (no request).
  useEffect(() => {
    if (popupState !== "working") return;
    const timer = setInterval(() => { if (!popup.current || popup.current.closed) { popup.current = null; setPopupState("idle"); } }, 500);
    return () => clearInterval(timer);
  }, [popupState]);

  function signIn() {
    popup.current = window.open("/app-read-login.html", "iaos-app-read-signin", "popup,width=480,height=620");
    setPopupState(popup.current ? "working" : "blocked");
  }

  async function signOut() {
    if (signOutBusy.current) return;
    // At the click, before any request: saving on this page stops, and earlier status answers are void; queued and
    // scheduled status work is cancelled (single-flight).
    cancelSlot("signout");
    pauseAppWriteForSignOut();
    generation.current += 1;
    const g = generation.current;
    const a = ++attempt.current;
    // Freeze the target once: a retry NEVER refetches or retargets (it can only revoke the old session).
    if (!frozen.current) frozen.current = handle.current;
    const target = frozen.current;
    if (!target) { fx.setStatus({ kind: "signout_unconfirmed", message: SIGN_OUT_NOT_CONFIRMED_TEXT }); return; }
    signOutBusy.current = true;
    fx.setStatus({ kind: "signing_out" });
    const deadline = Date.now() + SIGN_OUT_CLIENT_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SIGN_OUT_CLIENT_TIMEOUT_MS);
    let confirmed = false;
    try {
      const res = await fetch(SIGN_OUT_ENDPOINT, {
        method: "POST", cache: "no-store", credentials: "same-origin", signal: ac.signal,
        headers: { "Content-Type": "application/json", "X-IAOS-Session": "sign-out" },
        body: JSON.stringify({ handle: target }),
      });
      const body = await res.json().catch(() => null);
      confirmed = res.status === 200 && body?.state === "revoked";
    } catch { confirmed = false; } finally { clearTimeout(timer); signOutBusy.current = false; }
    // Only the current attempt in the current generation, within its own deadline, may change what is shown.
    if (a !== attempt.current || g !== generation.current) return;
    if (confirmed && Date.now() <= deadline) {
      frozen.current = null; fx.setHandle(null); generation.current += 1;
      setWasSignedIn(false); // an explicit, confirmed sign-out hides the page, unlike an expiry
      fx.setStatus({ kind: "signed_out", reason: "signed_out_here" });
    } else {
      fx.setStatus({ kind: "signout_unconfirmed", message: SIGN_OUT_NOT_CONFIRMED_TEXT });
    }
  }

  const signedIn = status.kind === "signed_in";
  pageShown.current = signedIn || wasSignedIn;
  // Not signed in: the page stays MOUNTED (drafts, saves in flight) but is not painted (visibility keeps its layout and
  // scroll position) under the opaque overlay, and the overlay layer makes it inert.
  // r4: keyed by the operator partition -- a different operator remounts the routed app (no previous operator's state).
  const page = <div key={`page-${partition}`} data-testid="one-login-app" style={signedIn ? undefined : { visibility: "hidden" }} aria-hidden={!signedIn || undefined}>
    <ReadRecovered.Provider value={epoch}>{children}</ReadRecovered.Provider>
  </div>;

  const signInAction: ScreenAction = { label: SIGN_IN_LABEL, onClick: signIn, testId: "one-login-sign-in", busy: popupState === "working" };
  const popupMessage: ScreenMessage | null = popupState === "working" ? { text: WORKING_TEXT, tone: "status" }
    : popupState === "blocked" ? { text: POPUP_BLOCKED_TEXT, tone: "alert" } : null;
  const msg = (text: string, tone: "status" | "alert" = "status"): ScreenMessage => ({ text, tone, testId: `read-access-${status.kind}` });
  const tryAgain: ScreenAction = { label: "Try again", onClick: () => { request("none", "reset"); }, testId: "one-login-try-again" };

  let layer: ReactNode = null;
  if (signedIn) {
    if (accountChanged) {
      layer = <OneLoginScreen key="overlay" mode="overlay" testId="one-login-account-changed" heading={ACCOUNT_CHANGED_HEADING}
        line={ACCOUNT_CHANGED_TEXT} primary={{ label: "Continue", onClick: () => fx.setAccountChanged(false), testId: "one-login-account-continue" }} />;
    } else if (relogin) {
      layer = <OneLoginScreen key="overlay" mode="overlay" testId="one-login-relogin" heading="Log in again"
        line={`Start a new ${sessionLengthText(oneLoginSessionScale())} session. With the same account, your unsaved work on this page stays where it is.`}
        primary={signInAction} message={popupMessage}
        secondary={{ label: "Cancel", onClick: () => { setRelogin(false); setPopupState("idle"); }, testId: "one-login-cancel" }} />;
    } else {
      const scale = oneLoginSessionScale();
      const due = dueReminder(status.expiresAt, Date.now(), scale);
      if (due !== null && !reminderDismissed(status.expiresAt, due)) {
        const at = status.expiresAt;
        layer = <ReminderDialog key={`reminder-${due}`} text={reminderMessage(due, status.expiresAt - Date.now(), scale)}
          onLater={() => { dismissReminder(at, due); setTick((n) => n + 1); }}
          onLogIn={() => { dismissReminder(at, due); setRelogin(true); }} />;
      }
    }
  } else if (!wasSignedIn) {
    // No session yet: the full-page entrance, nothing else -- no page (and so no GHL read) mounts before the server confirms.
    const heading = "Welcome to IAOS";
    const line = "Sign in to open your investor workspace.";
    layer = status.kind === "checking"
      ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" message={msg("Checking your session…")} footer={false} />
      : status.kind === "unconfigured"
        ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line}
            message={msg("Read sign-in is not configured for this site. No IAOS data can be shown.", "alert")} />
        : status.kind === "unavailable"
          // An outage is never a sign-in prompt: Try again re-checks; there is no sign-in button.
          ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line} primary={tryAgain} message={msg(status.message, "alert")} />
          : status.kind === "signed_out"
            ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line} primary={signInAction}
                message={popupMessage ?? (status.reason === "revoked" || status.reason === "signed_out_here" ? msg(SIGNED_OUT_TEXT) : null)} />
            : <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line}
                message={msg(status.kind === "signing_out" ? "Signing out…" : status.message, status.kind === "signing_out" ? "status" : "alert")} />;
  } else {
    // The page was signed in: every state is the overlay above the mounted, inert page.
    const keep = "Nothing you saved is lost. Anything you haven't saved stays on this page.";
    layer = status.kind === "signed_out"
      ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery"
          heading={status.reason === "revoked" ? "You've signed out" : "Your session has ended"}
          line="Sign in again to continue where you left off." primary={signInAction}
          message={popupMessage ?? msg(status.reason === "revoked" ? SIGNED_OUT_TEXT : oneLoginSessionScale() < 1 ? TEST_EXPIRED_TEXT : EXPIRED_TEXT)} />
      : status.kind === "unavailable"
        ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="IAOS can't confirm your sign-in right now"
            line={`${keep} A new sign-in would not fix this; try again in a moment.`} primary={tryAgain} message={msg(status.message, "alert")} />
        : status.kind === "signout_unconfirmed"
          ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Sign-out not confirmed yet"
              line={`${keep} Nothing is saved from this page until you sign in again.`}
              primary={{ label: "Try Sign out again", onClick: () => { void signOut(); }, testId: "one-login-retry-sign-out" }} message={msg(status.message, "alert")} />
          : status.kind === "signing_out"
            ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Signing out" line={keep} message={msg("Signing out…")} />
            : status.kind === "unconfigured"
              ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Sign-in is not configured" line={keep}
                  message={msg("Read sign-in is not configured for this site. No IAOS data can be shown.", "alert")} />
              : null;
  }
  return <>{layer}{signedIn || wasSignedIn ? page : null}</>;
}
