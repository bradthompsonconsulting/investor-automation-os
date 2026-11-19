/**
 * B15-30 / INV-140 -- open the exact field a guided step names.
 *
 * `focusTestId(id)` scrolls the element with that data-testid into view and focuses its first usable control (an
 * enabled input, select, textarea or button inside it, else the element itself made focusable for this once). It
 * returns whether the element was found. `useFocusParam(map)` is the deep-link side: on a page opened with
 * `?focus=<step>`, it waits (bounded) for that step's target to render, then focuses it ONCE per page visit and marks
 * it `data-focus-applied="true"` so a test can see which target was opened. No request, no write.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const FOCUSABLE = "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

export function focusTestId(testId: string): boolean {
  if (!testId) return false;
  const el = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  const control = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  if (control) control.focus({ preventScroll: true });
  else { if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); }
  el.setAttribute("data-focus-applied", "true");
  return true;
}

/** Deep link: `?focus=<key>` focuses `targets[key]` once it renders (up to `timeoutMs`). Unknown keys do nothing. */
export function useFocusParam(targets: Readonly<Record<string, string>>, timeoutMs = 15000): void {
  const [params] = useSearchParams();
  const key = params.get("focus");
  const testId = key && Object.prototype.hasOwnProperty.call(targets, key) ? targets[key] : null;
  useEffect(() => {
    if (!testId) return;
    let done = false;
    const tryFocus = () => { if (!done && focusTestId(testId)) { done = true; observer.disconnect(); clearTimeout(timer); } };
    const observer = new MutationObserver(tryFocus);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => { done = true; observer.disconnect(); }, timeoutMs);
    tryFocus();
    return () => { done = true; observer.disconnect(); clearTimeout(timer); };
  }, [testId, timeoutMs]);
}
