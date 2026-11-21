/**
 * Board 15 cleanup (Bones, PR #131 P1) -- a blur the operator did not make.
 *
 * When the read session ends, ReadAccess hides the page (the `hidden`
 * attribute on its wrapper) behind the sign-in recovery screen. The browser
 * then takes focus away from whatever field had it and fires `blur`. That
 * blur is page lifecycle, not operator intent, so a blur-to-save field must
 * not write on it: the draft stays in the field, unsaved, and the operator's
 * own next blur or Enter saves it exactly as before.
 *
 * True only while the element sits inside a hidden subtree at the moment the
 * blur is handled -- which an operator's click, Tab or Enter never produces.
 *
 * B15-30 guided navigation (Captain 2026-11-20): pressing Previous or Next in the guided step row also takes focus
 * away from whatever field had it -- a draft in Current Offer, Seller Position, the seller's price or a transaction
 * field. That blur is navigation, not "done with this field": navigation alone never writes, so that ONE blur does not
 * save either; the draft stays in the field and the operator's own next blur or Enter saves it as before. The guided
 * controls call `markGuidedNavigation()` on pointer down; the mark is consumed by the first blur and expires after
 * one second (a Tab away or any other click still saves exactly as before).
 */
let guidedNavigationUntil = 0;

export function markGuidedNavigation(): void {
  guidedNavigationUntil = Date.now() + 1000;
}

export function isLifecycleBlur(target: EventTarget | null): boolean {
  if (guidedNavigationUntil > Date.now()) { guidedNavigationUntil = 0; return true; }
  return typeof Element !== "undefined" && target instanceof Element && target.closest("[hidden]") !== null;
}
