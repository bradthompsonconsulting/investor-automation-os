/**
 * Renders a popover in a fixed-position layer anchored to the control that opened it, kept inside the window.
 *
 * Why: the Dashboard opens CallbackPopover from cells and cards that clip their content (the Lead Queue action
 * cell and its scroll box; the Callbacks card's right edge), so the popover opened out of sight. This lifts it out
 * of those containers without changing CallbackPopover itself: the popover keeps its own absolute
 * `top: calc(100% + 4px); left: 0` placement, now relative to a zero-size fixed layer at the anchor's bottom-left.
 *
 * Placement: below the anchor; above it when there is no room below and there is room above; shifted left so its
 * right edge stays inside the window. It follows the anchor on scroll and resize. React events still bubble
 * through the portal to the Dashboard (CallbackPopover stops its own clicks), so its behaviour is unchanged.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EDGE = 8;   // keep this far from the window edge
const GAP = 4;    // CallbackPopover's own offset below its layer (top: calc(100% + 4px))

export function AnchoredPopover({ anchor, children }: { anchor: HTMLElement | null; children: ReactNode }) {
  const layer = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const child = layer.current?.firstElementChild as HTMLElement | null;
      const w = child?.offsetWidth ?? 0, h = child?.offsetHeight ?? 0;
      let top = a.bottom;                                                    // popover top = a.bottom + GAP
      if (a.bottom + GAP + h > window.innerHeight - EDGE && a.top - GAP - h >= EDGE) top = a.top - 2 * GAP - h;
      let left = a.left;
      if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, window.innerWidth - EDGE - w);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);

  if (!anchor) return null;
  return createPortal(
    <div ref={layer} style={{ position: "fixed", top: pos?.top ?? -10000, left: pos?.left ?? -10000, width: 0, height: 0, zIndex: 50,
      visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
