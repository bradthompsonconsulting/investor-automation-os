/**
 * B15-03 / INV-103 slice C -- warn before leaving the Seller Call page with
 * unsaved conversation work.
 *
 * The app uses react-router-dom 6 `<BrowserRouter>` (not a data router), so
 * `useBlocker` is not available. This guard covers, while `active`:
 *   1. reload, closing the tab, typing another address, and any full-page
 *      navigation: the browser's own `beforeunload` prompt;
 *   2. in-app navigation by link: a click on any same-origin `<a href>` that
 *      leaves this page's path (react-router `<Link>`/`<NavLink>` render `<a>`) is
 *      intercepted in the capture phase, before the router sees it, and asks
 *      `window.confirm`; "Cancel" stops the navigation.
 * NOT covered (documented limit): the browser Back/Forward buttons and
 * programmatic `navigate()`/history calls -- a BrowserRouter offers no supported
 * way to cancel those. Links that open a new tab (`target="_blank"`), downloads,
 * modified clicks (Ctrl/Cmd/Shift/Alt, middle button) and links to the same
 * path (e.g. `#hash`) never leave this page and are not intercepted.
 */
import { useEffect, useRef } from "react";

type ClickLike = { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null };

/** The href a click would navigate this tab to, when that leaves the current path; otherwise null. */
export function leavingHref(e: ClickLike, here: { origin: string; pathname: string }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const el = e.target as { closest?: (s: string) => Element | null } | null;
  const a = el && typeof el.closest === "function" ? (el.closest("a[href]") as HTMLAnchorElement | null) : null;
  if (!a) return null;
  const target = (a.getAttribute("target") ?? "").trim().toLowerCase();
  if ((target && target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try { url = new URL(a.getAttribute("href") ?? "", here.origin + here.pathname); } catch { return null; }
  if (url.origin === here.origin && url.pathname === here.pathname) return null;
  return url.href;
}

export function useLeaveGuard(active: boolean, message: string): void {
  const msg = useRef(message);
  msg.current = message;
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; return ""; };
    const onClick = (e: MouseEvent) => {
      if (leavingHref(e, window.location) === null) return;
      if (window.confirm(msg.current)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
}
