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
 */
export function isLifecycleBlur(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest("[hidden]") !== null;
}
