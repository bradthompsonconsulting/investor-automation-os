/**
 * Renders a popover in a fixed-position layer anchored to the control that opened it, kept inside the window.
 *
 * Why: the Dashboard opens CallbackPopover from cells and cards that clip their content (the Lead Queue action
 * cell and its scroll box; the Callbacks card's right edge), so the popover opened out of sight. This lifts it out
 * of those containers without changing CallbackPopover itself: the popover keeps its own absolute
 * `top: calc(100% + 4px); left: 0` placement, now relative to a zero-size fixed layer at the anchor's bottom-left.
 *
 * Placement: below the anchor; above it when there is no room below and there is room above; shifted left so its
 * right edge stays inside the window; and kept inside the window vertically. It is placed again on scroll, on
 * resize, and whenever the popover itself changes size (e.g. a save error adds a line), so a grown popover is
 * never clipped.
 *
 * Keyboard: the layer sits at the end of <body>, outside the page's tab order, so focus is managed explicitly. On
 * open, focus moves to the popover's first control. Tab past its last control continues to the control after the
 * anchor; Shift+Tab from its first control returns to the anchor. On close, focus returns to the anchor when it was
 * inside the popover (or nowhere). React events still bubble through the portal to the Dashboard (CallbackPopover
 * stops its own clicks), so its behaviour is unchanged.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EDGE = 8;   // keep this far from the window edge
const GAP = 4;    // CallbackPopover's own offset below its layer (top: calc(100% + 4px))
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function AnchoredPopover({ anchor, children }: { anchor: HTMLElement | null; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const focused = useRef(false);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const child = layer.current?.firstElementChild as HTMLElement | null;
      const w = child?.offsetWidth ?? 0, h = child?.offsetHeight ?? 0;
      let top = a.bottom;                                                    // popover top = a.bottom + GAP
      if (a.bottom + GAP + h > window.innerHeight - EDGE && a.top - GAP - h >= EDGE) top = a.top - 2 * GAP - h;
      // Never past the bottom or top edge, even when neither side has room.
      top = Math.max(EDGE - GAP, Math.min(top, window.innerHeight - EDGE - GAP - h));
      let left = a.left;
      if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, window.innerWidth - EDGE - w);
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    const child = layer.current?.firstElementChild;
    const resized = typeof ResizeObserver === "function" && child ? new ResizeObserver(place) : null;
    if (resized && child) resized.observe(child);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resized?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Move focus into the popover once it is placed; give it back to the anchor when the popover closes.
  useLayoutEffect(() => {
    if (!pos || focused.current) return;
    focused.current = true;
    const first = layer.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [pos]);
  useLayoutEffect(() => () => {
    const active = document.activeElement;
    const lost = !active || active === document.body || (layer.current?.contains(active) ?? false);
    if (lost && anchor?.isConnected) anchor.focus();
  }, [anchor]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !anchor || !layer.current) return;
    const inside = [...layer.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (inside.length === 0) return;
    const active = document.activeElement;
    if (e.shiftKey && active === inside[0]) { e.preventDefault(); anchor.focus(); return; }
    if (!e.shiftKey && active === inside[inside.length - 1]) {
      const after = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) =>
        !layer.current!.contains(el) && el !== anchor && !!(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (after) { e.preventDefault(); after.focus(); }
    }
  }

  if (!anchor) return null;
  return createPortal(
    <div ref={layer} onKeyDown={onKeyDown} style={{ position: "fixed", top: pos?.top ?? -10000, left: pos?.left ?? -10000, width: 0, height: 0, zIndex: 50,
      visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
