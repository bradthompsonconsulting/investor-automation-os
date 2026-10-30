import { useLayoutEffect } from "react";

/* Shared since B15-06 (2026-10-26): moved verbatim from ContactWorkspace.tsx
   (PR #147, merged d1cf575). Contact calls it exactly as before. */

/* Narrow-width F3 (2026-10-25) — a keyboard-focused control must never land
   under the STUCK deal rail. Focus scrolls a control to the scrollport edge,
   which is where the rail sticks, and the browser does not account for a
   sticky element. So the rail's scroll container (Layout's <main>) gets
   scroll-padding-top = its own padding-top + the rail's CURRENT height + 8px.
   scroll-padding only moves where scrolling stops; it changes no layout.
   - Tracked with a ResizeObserver: the rail's height changes with the window
     width and when values replace waiting texts. A value set once goes stale.
   - <main> belongs to Layout and outlives this page, so on exit the observer
     is disconnected and main's PREVIOUS value is put back; otherwise every
     later page inherits this padding.

   CLEARANCE RULE (fallback, Jess 2026-10-25, PR #147 CI): a stuck rail can be
   taller than the window leaves room for (narrow widths, short windows, a rail
   that grows). Then no scroll padding can show a focused control below it.
     room = main.clientHeight − main padding-top − rail height − 8px
     need = height of the TALLEST rendered, visible, enabled focusable control
            in <main> outside the rail (measured, never capped: a textarea the
            user enlarges past the room releases the pin, desktop included —
            Jess 2026-10-25)
   room >= need → sticky, with the scroll padding above.
   room <  need → the rail scrolls with the page (position: relative) and
            main's previous scroll padding is put back. PERMANENT MAO VISIBILITY
            IS RELAXED IN THIS FALLBACK ONLY: a rail that leaves no room cannot
            keep both the MAO and the focused control in view, and an obscured
            focus fails WCAG 2.4.11.
   Re-checked when the rail, <main> or the page content changes size
   (ResizeObserver) and when an attribute or the child list changes inside
   <main> (MutationObserver): a taller control can be enabled, shown or resized
   without any observed box changing size. The mode is written to the rail
   directly, not through React state, and mutation callbacks run before the
   next input event, so the right mode is in place before keyboard focus needs
   it. Sticky returns without a reload.

   KEYBOARD REVEAL (Bones REVISE of 5b57be0, 2026-10-25). Browser focus
   scrolling shows only a focused textarea's caret, which can leave the box cut
   at the bottom edge. When focus arrives from the KEYBOARD, the control is
   brought fully into view with the smallest move. The browser's Tab scroll
   runs before focusin, so this adjusts its result:
   - Modality is explicit: focus that lands while a keydown is being handled
     (keydown listener on the document; cleared on the next task and on
     pointerdown). A textarea matches :focus-visible on a mouse click too, so
     that selector is not used. Pointer focus, clicks, selection, caret
     placement and scripted focus get no extra scroll.
   - Vertical only, and only <main>.scrollTop. Never scrollIntoView: it also
     moves <main> sideways (480px overflows) and scrolls any scrollable
     ancestor or the window.
   - A control in the sticky rail is always in view, so keyboard focus on it
     must not move the page. The browser's own Tab scroll does move it (the
     rail lies inside the scroll padding), so the page is put back where the
     key found it, in the same task.
   - A control taller than the visible band cannot be shown whole. It is left
     to the browser, which keeps its caret in view.
   - When the rail returns to sticky while a keyboard-focused control is in
     view, that control is kept clear of the rail with the same smallest move.

   PINNED REGIONS (B15-06, 2026-10-26). `pinned`, optional, is a selector for
   other regions that stay in view on their own -- Seller Call's side column
   (Full Script, Notes), sticky beside the workspace at desktop widths. Only
   while such a region is computed sticky: keyboard focus inside it must not
   move the page (the same put-back as for the stuck rail), and its controls
   are not measured for the clearance rule (the rail never covers them). A
   region in normal flow (stacked above the workspace on narrower screens) is
   treated like any other content. Contact passes no selector.
   Both put-backs (stuck rail, pinned region) keep the browser's own Tab scroll
   when undoing it would leave the control out of view: on Seller Call, panels
   stacked above the workspace can put the bar below the fold before it first
   sticks.

   --rail-clearance (B15-06): the scroll padding the rail currently adds ("0px"
   when it scrolls), set on <main> for CSS and removed on exit. The padding
   also applies when something other than keyboard focus scrolls a control of
   the stuck rail into view (a pointer tool, assistive technology,
   scrollIntoView): the rail lies inside the padding, so the page moved up. Seller Call's compact Call is shown
   only while the full Call is out of view, so that scroll hid the very button
   being reached. Seller Call gives the stuck bar's controls a matching negative
   scroll-margin-top (SellerCallWorkspace.css).
   Contact uses no such rule; its behaviour is unchanged. */
const RAIL_GAP = 8;
const RAIL_FOCUSABLE = "a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex='-1'])";
const RAIL_WATCHED = ["disabled", "hidden", "style", "class", "tabindex", "open", "rows", "cols"];
export function useRailClearance(rail: HTMLElement | null, pinned?: string): void {
  useLayoutEffect(() => {
    const scroller = rail?.closest("main");
    if (!rail || !scroller) return;
    const previous = scroller.style.scrollPaddingTop;
    const previousPosition = rail.style.position;
    /* keyTask: inside the task of a keydown, where the browser moves focus for
       Tab / Shift+Tab. A scripted focus in a later task (focus({preventScroll}))
       is not keyboard focus. keyScroll: main.scrollTop when that key went down.
       byKeyboard: the control keyboard focus landed on. */
    let keyTask = false;
    let keyScroll = 0;
    let byKeyboard: Element | null = null;
    const onKey = () => { keyTask = true; keyScroll = scroller.scrollTop; setTimeout(() => { keyTask = false; }); };
    const onPointer = () => { keyTask = false; byKeyboard = null; };
    const sticky = () => rail.dataset.railMode !== "scrolls";
    /* Put the page back where the key found it -- only while that leaves the
       control fully in view (B15-06: before it first sticks, a bar below the
       fold is not in view, so the browser's own Tab scroll is kept). */
    const putBack = (el: Element) => {
      if (!keyTask || scroller.scrollTop === keyScroll) return;
      const moved = scroller.scrollTop;
      scroller.scrollTop = keyScroll;
      const b = el.getBoundingClientRect();
      const top = scroller.getBoundingClientRect().top + scroller.clientTop;
      if (b.top < top - 0.5 || b.bottom > top + scroller.clientHeight + 0.5) scroller.scrollTop = moved;
    };
    const inPinned = (el: Element) => {
      const region = pinned ? el.closest(pinned) : null;
      return region !== null && scroller.contains(region) && getComputedStyle(region).position === "sticky";
    };
    const inView = (el: Element) => {
      const b = el.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return b.bottom > box.top && b.top < box.bottom;
    };
    const show = (el: HTMLElement) => {
      const box = scroller.getBoundingClientRect();
      const style = getComputedStyle(scroller);
      const top = box.top + scroller.clientTop + (parseFloat(style.scrollPaddingTop) || 0);
      const bottom = box.top + scroller.clientTop + scroller.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0);
      const b = el.getBoundingClientRect();
      if (b.height > bottom - top + 1) return;
      const delta = b.top < top ? b.top - top : b.bottom > bottom ? b.bottom - bottom : 0;
      if (delta) scroller.scrollTop += delta;
    };
    const update = () => {
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const railHeight = rail.getBoundingClientRect().height;
      let need = 0;
      scroller.querySelectorAll<HTMLElement>(RAIL_FOCUSABLE).forEach((el) => {
        if (rail.contains(el) || (el as HTMLButtonElement).disabled || !el.checkVisibility({ visibilityProperty: true }) || inPinned(el)) return;
        need = Math.max(need, el.getBoundingClientRect().height);
      });
      const fits = scroller.clientHeight - padTop - railHeight - RAIL_GAP >= need;
      const padding = fits ? `${Math.ceil(padTop + railHeight + RAIL_GAP)}px` : previous;
      /* Returning to sticky: a keyboard-focused control in view stays clear. */
      const kept = fits && rail.dataset.railMode === "scrolls" && byKeyboard instanceof HTMLElement
        && byKeyboard === document.activeElement && !rail.contains(byKeyboard) && inView(byKeyboard) ? byKeyboard : null;
      if (rail.dataset.railMode !== (fits ? "sticky" : "scrolls")) {
        rail.dataset.railMode = fits ? "sticky" : "scrolls";
        rail.style.position = fits ? "sticky" : "relative";
      }
      if (scroller.style.scrollPaddingTop !== padding) scroller.style.scrollPaddingTop = padding;
      const clearance = fits ? padding : "0px";
      if (scroller.style.getPropertyValue("--rail-clearance") !== clearance) scroller.style.setProperty("--rail-clearance", clearance);
      if (kept) show(kept);
    };
    const reveal = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (sticky() && rail.contains(el)) {
        /* A sticky rail is always in view, but it lies inside the scroll
           padding, so the browser's Tab scroll (which runs before focusin)
           moved the page to clear it (Spock, 2026-10-25). Put the page back
           where the key found it, in the same task, before anything paints. */
        putBack(el);
        return;
      }
      if (inPinned(el)) {
        /* A sticky side region is in view the same way (B15-06). */
        putBack(el);
        byKeyboard = null;
        return;
      }
      byKeyboard = keyTask ? el : null;
      if (keyTask) show(el);
    };
    update();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    scroller.addEventListener("focusin", reveal);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    [rail, scroller, rail.parentElement].forEach((el) => { if (el) observer?.observe(el); });
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mutations?.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: RAIL_WATCHED });
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      scroller.removeEventListener("focusin", reveal);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      scroller.style.scrollPaddingTop = previous;
      rail.style.position = previousPosition;
      scroller.style.removeProperty("--rail-clearance");
      delete rail.dataset.railMode;
    };
  }, [rail]);
}
