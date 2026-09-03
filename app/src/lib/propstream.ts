/**
 * B7-02 — the IAOS -> PropStream browser handoff, and nothing more.
 *
 * WHAT THIS IS. The investor is looking at a seller record that already holds
 * the subject-property address. To pull comps they need that address inside
 * PropStream. Today they retype it. This module removes the retyping and
 * nothing else: it hands the address to the clipboard and opens PropStream in
 * the investor's own browser, where their own session and their own browser's
 * password autofill do the authenticating.
 *
 * WHAT IT IS NOT, stated because every one of these was explicitly excluded by
 * the approved B7-02 scope:
 *
 *   - It stores no PropStream username or password, and reads none.
 *   - It does not drive PropStream's login form, or any PropStream DOM.
 *   - It does not construct a property-address deep link. NO DOCUMENTED ONE
 *     EXISTS — see docs/PROPSTREAM_HANDOFF_V1.md for what was checked and what
 *     was OBSERVED. An undocumented one guessed from network traffic would be a
 *     dependency on a private endpoint that can change without notice, so the
 *     address goes to the clipboard and the investor pastes it into the search
 *     PropStream documents.
 *   - It adds no API dependency. There is no PropStream request in this file,
 *     and IAOS makes none on the investor's behalf.
 *
 * WHY IT IS A MODULE AND NOT INLINE IN THE PAGE. Two reasons. It is the seam a
 * future AUTHORIZED PropStream integration would replace — one function, one
 * call site, so the replacement is a module swap rather than a page rewrite.
 * And it holds no React and no config read, so a .cjs runner can drive every
 * branch offline, including the two the browser only reaches by refusing.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing here writes to GHL. No note, no tag, no
 * stage, no field, no workflow. It cannot grey a row.
 */

/**
 * The one URL IAOS opens.
 *
 * OBSERVED 2026-09-03 by direct request: `https://login.propstream.com/`
 * returned HTTP/2 200 with `<title>PropStream - Login</title>`. This is
 * PropStream's own published sign-in entry point, and it is the whole of the
 * URL contract — no path, no query string, no fragment. Appending anything to
 * it would be the invented deep link this scope forbids.
 *
 * The trailing slash is deliberate and is the form that was probed.
 */
export const PROPSTREAM_LOGIN_URL = "https://login.propstream.com/";

/**
 * The subject-property address components, as the record already holds them.
 *
 * These are GHL's native `address1` / `city` / `state` / `postalCode`, which
 * `scripts/import-propstream-csv.ts` binds from PropStream's OWN property
 * columns — Address (+ Unit #), City, State, Zip at L703-708. So the address
 * being handed back to PropStream is the address PropStream exported, which is
 * the strongest form this seam can have.
 *
 * `contact.property_address` is deliberately NOT the source. The importer never
 * populates it (it is absent from CUSTOM_FIELD_MAP), so on an imported record
 * it is "" — and where an operator has typed one by hand there is no guarantee
 * it carries city and state, which a comp search needs. Preferring a field that
 * is usually empty and sometimes partial over one the importer fills from
 * PropStream itself would trade a working handoff for a plausible-looking one.
 */
export interface SubjectAddressParts {
  address1: string;
  city: string;
  state: string;
  postalCode: string;
}

/**
 * The full one-line subject address, or null when the record does not hold one.
 *
 * COMPLETENESS IS A REQUIREMENT, NOT A PREFERENCE. Street, city and state must
 * all be present. A comp search on a bare street line resolves to the wrong
 * "123 Main St" in a different county, and the investor cannot tell from the
 * result that it happened. Refusing is the honest outcome, and the caller
 * renders the refusal rather than a half address.
 *
 * ZIP IS OPTIONAL. Street + city + state names exactly one parcel for a search;
 * a missing zip narrows nothing that city and state have not already narrowed.
 * A record missing only the zip is still handed off.
 *
 * FORMAT is "street, city, ST zip" — the same shape the Contact Workspace
 * identity header already displays, so what is copied is what the investor is
 * looking at.
 */
export function subjectAddress(parts: SubjectAddressParts | null | undefined): string | null {
  if (!parts) return null;
  const street = (parts.address1 || "").trim();
  const city = (parts.city || "").trim();
  const state = (parts.state || "").trim();
  const zip = (parts.postalCode || "").trim();
  if (!street || !city || !state) return null;
  return `${street}, ${city}, ${state}${zip ? ` ${zip}` : ""}`;
}

/** Whether the clipboard actually received the address. */
export type ClipboardOutcome = "copied" | "denied";

export interface HandoffResult {
  /** The address handed off, verbatim — what the helper displays and re-copies. */
  address: string;
  /** The URL that was opened. Always PROPSTREAM_LOGIN_URL. */
  url: string;
  clipboard: ClipboardOutcome;
}

/**
 * ⚠ THERE IS DELIBERATELY NO `opened` OUTCOME, AND ADDING ONE WOULD BE A LIE.
 *
 * The obvious implementation reads the return value of `window.open`: null
 * means the popup blocker took it. It does not work here.
 *
 *   OBSERVED 2026-09-03, Chromium 149 headless, real click on the real button:
 *   `window.open(url, "_blank", "noopener,noreferrer")` returned a FALSY value
 *   WHILE the browser reported exactly one page opened at
 *   https://login.propstream.com/. The helper, trusting that return value, told
 *   the investor "Your browser blocked the new tab" about a tab that had just
 *   opened in front of them.
 *
 * That is `noopener` behaving as specified — it severs the reference, so there
 * is nothing left to return. The choice was between dropping `noopener` to
 * regain a detectable handle, and dropping the detection. This drops the
 * DETECTION, and the fallback is better for it: the helper offers "Open
 * PropStream" as a plain link EVERY time, not only when a check fires. An
 * unconditional escape hatch cannot be wrong about whether it is needed, and a
 * real link click is a fresh user gesture, so it opens where a programmatic
 * call was suppressed.
 */

/**
 * The two browser capabilities this seam needs, injected rather than imported.
 *
 * Same rule as `dispositionOverride.ts`'s StorageLike, for the same reason: the
 * interesting branch is the REFUSAL — a clipboard that rejects, or is not
 * exposed at all — and it cannot be provoked on demand in a real browser.
 * Injected, it is one line in an offline runner.
 */
export interface HandoffEnvironment {
  /**
   * `navigator.clipboard`, or null where the browser exposes none.
   *
   * ABSENT IS A REAL STATE, not a defensive nicety, and it was OBSERVED:
   * the Clipboard API is gated on a secure context, so over plain http on a
   * non-localhost host `navigator.clipboard` is undefined (verified in
   * Chromium 149 by `verify-propstream-handoff.cjs`). `writeText`
   * additionally REJECTS when the permission is denied or the document is not
   * focused. All of it lands on "denied", and the helper shows the address
   * for a manual copy.
   */
  clipboard: { writeText(text: string): Promise<void> } | null;
  /**
   * `window.open`. Its RETURN VALUE IS DELIBERATELY IGNORED — see the note on
   * HandoffResult for the observation that makes reading it dishonest.
   */
  openWindow(url: string): void;
}

/**
 * Copy the address and open PropStream. Never throws.
 *
 * ⚠ BOTH CALLS ARE MADE SYNCHRONOUSLY, BEFORE THE FIRST `await`, AND THAT IS
 * THE WHOLE DESIGN OF THIS FUNCTION. Do not "clean up" the sequence below into
 * `await writeText(...)` followed by `openWindow(...)`. It was written that way
 * first and the browser refused it:
 *
 *   OBSERVED 2026-09-03, Chromium 149 headless, real click on the real button:
 *   with `openWindow` placed after `await clipboard.writeText(...)`, the popup
 *   was BLOCKED — 0 pages opened — while the clipboard copy succeeded.
 *   Reordering so both calls are issued inside the click's own task made it
 *   1 page opened, `https://login.propstream.com/`, clipboard still copied.
 *
 * The cause is transient user activation. Awaiting a promise yields the task,
 * and a `window.open` issued after that yield is no longer attributable to the
 * click, so the popup blocker takes it — every time, not intermittently. The
 * fallback below would have covered it, but a fallback that fires on every
 * single click is not a fallback, it is the behaviour.
 *
 * The reverse order is equally wrong, for a different reason: `writeText`
 * rejects when the document is not focused, and opening a tab is precisely what
 * takes focus away. So neither call may wait for the other. Both are ISSUED in
 * the gesture's task — `writeText` returns its promise immediately — and only
 * then is the clipboard promise awaited.
 *
 * THE TWO STEPS ARE INDEPENDENT. A blocked popup does not un-copy the address,
 * and a denied clipboard does not stop PropStream from opening — so neither
 * short-circuits the other, and each has its own fallback in the helper.
 */
export async function handoffToPropStream(
  address: string,
  env: HandoffEnvironment,
): Promise<HandoffResult> {
  const url = PROPSTREAM_LOGIN_URL;

  // Issued first, but NOT awaited here — see above. A synchronous throw from a
  // hostile clipboard shim is caught alongside a rejection.
  let write: Promise<void> | null = null;
  try {
    write = env.clipboard ? env.clipboard.writeText(address) : null;
  } catch {
    write = null;
  }

  // Issued in the same task as the write above, and never awaited — that is
  // what keeps it attributable to the click. A throw is swallowed: the helper's
  // unconditional Open PropStream link is the recovery, not an exception.
  try {
    env.openWindow(url);
  } catch { /* the link in the helper is the fallback */ }

  let clipboard: ClipboardOutcome = "denied";
  if (write) {
    try {
      await write;
      clipboard = "copied";
    } catch {
      clipboard = "denied";
    }
  }

  return { address, url, clipboard };
}

/**
 * Copy Again — the same clipboard write, without reopening PropStream.
 *
 * A SEPARATE FUNCTION, DELIBERATELY. The investor asking for Copy Again already
 * has PropStream open; the whole point is that they lost the clipboard to
 * something else. Routing it back through `handoffToPropStream` would open a
 * second tab every retry, which is the one thing a retry must not do.
 */
export async function copyAddressAgain(
  address: string,
  clipboard: HandoffEnvironment["clipboard"],
): Promise<ClipboardOutcome> {
  if (!clipboard) return "denied";
  try {
    await clipboard.writeText(address);
    return "copied";
  } catch {
    return "denied";
  }
}

/**
 * The browser capabilities as they exist at a real call site.
 *
 * Lives here rather than in the page so the page never touches `navigator` or
 * `window.open` directly, which is what keeps the seam a seam. `noopener` and
 * `noreferrer` are set for the same reason every other outbound open in this
 * app sets them: the opened tab gets no handle back to IAOS. Keeping them is
 * also what costs the blocked-popup detection, which is a trade made knowingly
 * — see the note on HandoffResult.
 */
export function browserHandoffEnvironment(): HandoffEnvironment {
  return {
    clipboard:
      typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard
        : null,
    openWindow: (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); },
  };
}
