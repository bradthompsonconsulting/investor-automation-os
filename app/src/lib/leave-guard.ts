/**
 * B15-03 / INV-103 slice C -- warn before leaving the Seller Call page with
 * unsaved conversation work. The conversation drafts and call ids live in the
 * page's memory, so leaving the page discards them: every departure asks first,
 * and only an explicit "OK" leaves. Nothing is ever discarded silently.
 *
 * Bones C2 (2026-11-03): the App now uses a React Router DATA router
 * (`createBrowserRouter`, App.tsx), so the guard uses React Router's supported
 * `useBlocker`. While `active`, it covers:
 *   1. every in-app navigation through the router: links (`<Link>`/`<NavLink>`/
 *      `<a>` handled by the router), programmatic `navigate()`, and the browser
 *      Back/Forward buttons (POP: the router restores the URL and holds the
 *      navigation until the operator answers);
 *   2. a change of query on the same path (it can carry another contact or deal);
 *      only a hash-only change stays on the page;
 *   3. reload, closing the tab, typing another address, and any full-page
 *      navigation: the browser's own `beforeunload` prompt.
 * "Cancel" keeps the page and every draft exactly as typed; "OK" leaves.
 *
 * Outside a data router (some offline harnesses render the page inside a plain
 * `<BrowserRouter>`) `useBlocker` is unavailable, so a FALLBACK covers only
 * beforeunload and same-origin link clicks, as before. The real App never takes
 * the fallback (the rendered suite proves Back/Forward and navigate() on it).
 */
import { createElement, useCallback, useContext, useEffect, useRef, type ReactElement } from "react";
import { UNSAFE_DataRouterContext, useBlocker, type BlockerFunction } from "react-router-dom";

type Place = { pathname: string; search: string };

/** True when moving `from` -> `to` leaves this page: another path, or the same path with another query. A hash-only change stays. */
export function leavesPage(from: Place, to: Place): boolean {
  return from.pathname !== to.pathname || from.search !== to.search;
}

type ClickLike = { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null };

/** (Fallback only.) The href a click would navigate this tab to, when that leaves this page; otherwise null. */
export function leavingHref(e: ClickLike, here: { origin: string; pathname: string; search?: string }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const el = e.target as { closest?: (s: string) => Element | null } | null;
  const a = el && typeof el.closest === "function" ? (el.closest("a[href]") as HTMLAnchorElement | null) : null;
  if (!a) return null;
  const target = (a.getAttribute("target") ?? "").trim().toLowerCase();
  if ((target && target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try { url = new URL(a.getAttribute("href") ?? "", here.origin + here.pathname + (here.search ?? "")); } catch { return null; }
  if (url.origin === here.origin && !leavesPage({ pathname: here.pathname, search: here.search ?? "" }, url)) return null;
  return url.href;
}

function useBeforeUnloadWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

type GuardProps = { active: boolean; message: string };

/** The real App: React Router's blocker holds every router navigation (links, navigate(), Back/Forward) until answered. */
function RouterLeaveGuard({ active, message }: GuardProps): null {
  const msg = useRef(message);
  msg.current = message;
  useBeforeUnloadWhile(active);
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => active && leavesPage(currentLocation, nextLocation), [active]);
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(msg.current)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return null;
}

/** Fallback (no data router): beforeunload and link clicks only. */
function LinkLeaveGuard({ active, message }: GuardProps): null {
  const msg = useRef(message);
  msg.current = message;
  useBeforeUnloadWhile(active);
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (leavingHref(e, window.location) === null) return;
      if (window.confirm(msg.current)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active]);
  return null;
}

/** Render once on the page that holds unsaved work. Which guard runs is fixed by the router the page is in. */
export function LeaveGuard(props: GuardProps): ReactElement {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return createElement(dataRouter ? RouterLeaveGuard : LinkLeaveGuard, props);
}
