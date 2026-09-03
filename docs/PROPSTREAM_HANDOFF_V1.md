# PropStream handoff V1 — B7-02

The smallest permitted IAOS → PropStream handoff, and the evidence behind it.
Board #7, INV-19. Every claim below is classified OBSERVED, INFERRED or UNKNOWN
per `FOUNDATIONAL_PRINCIPLES.md` §I.

## The contract

From a seller record in the Contact Workspace, **[Get Comps]**:

1. copies the record's full subject-property address to the clipboard,
2. opens `https://login.propstream.com/` in a new browser tab,
3. shows a session-only helper carrying the address, **Copy Again**, and an
   **Open PropStream** link.

The investor pastes the address into PropStream's own property search. That
paste is the platform's step, not a gap — see "no address deep link" below.

Authentication is **browser-owned**: the investor's existing PropStream session,
or their browser's own password autofill. IAOS stores no PropStream credential,
reads none, and drives no PropStream field. Future investors use their own
browser profile and their own PropStream account; nothing here is Brad-specific.

Implementation: `app/src/lib/propstream.ts`, called from exactly one place
(`app/src/pages/ContactWorkspace.tsx`). That single call site is the **seam** a
future authorized PropStream integration would replace — a module swap, not a
page rewrite. The offline runner asserts the call site count so it stays one.

## HARD NO — what this does not do

No credential storage. No scraping. No DOM automation of PropStream. No
undocumented deep-link trick. No API dependency — there is no PropStream request
in IAOS code, and none is made on the investor's behalf. The offline runner
asserts the absence of `fetch`/XHR, of credential-shaped identifiers, and of DOM
driving in the module's executable code, so a later edit reintroducing one fails
a check rather than passing review.

## Research answers

### Exact supported URL

**OBSERVED 2026-09-03**, direct request from this session:

```
$ curl -sS -D- -o /tmp/ps-login.html --max-time 25 https://login.propstream.com/
HTTP/2 200
content-type: text/html;charset=UTF-8
x-frame-options: SAMEORIGIN
...
$ grep -oiE '<title>[^<]*</title>' /tmp/ps-login.html
<title>PropStream - Login</title>
exit=0
```

`https://login.propstream.com/` is the URL IAOS opens, and the whole of the URL
contract — no path, no query string, no fragment.

`x-frame-options: SAMEORIGIN` (OBSERVED above) also settles a question nobody
asked out loud: PropStream **cannot** be embedded in an IAOS iframe. A new tab
is not a shortcut, it is the only available shape.

### Is there a documented property-address deep link?

**No — and this is why the address goes to the clipboard.**

- OBSERVED: `https://app.propstream.com/property/` returns HTTP 200 with
  `<title>Loading...</title>` — an SPA shell, not an addressable property page.
- OBSERVED, PropStream's own help and FAQ material: property search is
  documented as an in-app action only (address, APN, or draw/geolocate). No
  URL-parameter reference is published.
- UNKNOWN: whether an undocumented internal query shape exists. It was not
  looked for, deliberately. Reverse-engineering one from network traffic would
  make IAOS depend on a private endpoint that can change without notice, and
  B7-02 forbids exactly that.

INFERRED, and the design consequence: the address must reach PropStream through
the clipboard, because no supported programmatic route to a property exists.

### Clipboard behaviour and permissions

**OBSERVED 2026-09-03, Chromium 149 headless, real click on the real button**
(`app/scripts/verify-propstream-handoff.cjs`):

- Secure context (`http://localhost`): `navigator.clipboard.writeText` succeeded
  and `readText()` returned `"4821 SW 12th Ter, Cape Coral, FL 33914"` — the
  full subject address, verbatim.
- Non-secure context (plain http on a non-localhost host):
  `navigator.clipboard` is **not exposed at all**. The helper renders
  "Couldn't copy automatically — copy it from here" and shows the address as
  selectable text.

`writeText` additionally rejects when permission is denied or the document is
not focused. All three failures land on the same reported state and the same
fallback. **Fallback: the address is on screen, selectable, with Copy Again.**

### Popup / new-tab behaviour, and the fallback if blocked

Two findings, both of which changed the implementation.

**1. Transient user activation. OBSERVED:** with the clipboard write `await`ed
*before* `window.open`, the popup was **blocked on every click** — 0 pages
opened, no request issued — while the copy succeeded. Awaiting yields the task,
so the open is no longer attributable to the click. Issuing both calls inside the
click's own task gives 1 page opened at `https://login.propstream.com/` with the
copy still succeeding. `handoffToPropStream` is written that way and says so;
do not "tidy" the order.

**2. A blocked popup is not detectable here. OBSERVED:**
`window.open(url, "_blank", "noopener,noreferrer")` returned a **falsy value
while the browser opened the tab** — `noopener` severs the reference, so there is
nothing to return. The first implementation trusted that return value and told
the investor "Your browser blocked the new tab" about a tab that had just opened.

So there is deliberately **no `opened` outcome**. `noopener` is kept, the
detection is dropped, and **Open PropStream is offered unconditionally** in the
helper. An always-present escape hatch cannot be wrong about whether it is
needed, and a real link click is a fresh user gesture, so it opens where a
programmatic call was suppressed. It is an `<a>`, not a second `window.open`:
retrying the suppressed mechanism is not a fallback.

UNKNOWN: behaviour in Safari and Firefox. Only Chromium 149 was OBSERVED. Both
fallbacks are unconditional, so neither depends on browser detection — but no
claim is made about those browsers.

### Which address is handed off

GHL's native `address1` / `city` / `state` / `postalCode`, which
`scripts/import-propstream-csv.ts` binds from PropStream's **own** property
columns (Address + Unit #, City, State, Zip). The address handed back to
PropStream is the address PropStream exported.

**Street, city and state are all required; zip is optional.** Without a complete
address the button is **disabled** with the reason in its title — OBSERVED in the
real UI. A comp search on a bare street line resolves to the wrong parcel in
another county, and the result looks exactly like the right one.

`contact.property_address` is deliberately **not** the source: the importer never
populates it, so it is "" on imported records, and a hand-typed value carries no
guarantee of city or state.

### Minimal return / import guidance after CSV export

Nothing new is built for this, because the path already exists. After exporting
comps or a list from PropStream, `scripts/import-propstream-csv.ts` maps
PropStream's CSV columns to GHL contact fields.

Comp *evidence* is a separate question. B7-02 persists nothing — no note, no
field, no `sessionStorage`. There is no approved persistence mechanism for a comp
set, and inventing one is outside this scope; it belongs to B7-07's operator
workspace. The helper is session-only by design.

## Verification

| What | Command | Result |
|---|---|---|
| Module contract, offline | `node app/scripts/test-propstream-handoff.cjs` | 29/29, floor 29 |
| Real browser, real click | `node app/scripts/verify-propstream-handoff.cjs` | 9/9, floor 9 |
| Typecheck + build | `pnpm --dir app build` | exit 0 |

The browser harness serves `app/dist` from localhost, answers every
`/.netlify/functions/*` request from a fixture, and aborts any request to
propstream.com. No GHL, no PropStream, no deployed site, no secret, no write.
Neither harness is in CI: `.github/workflows/ci.yml` excludes Playwright by name,
and the offline runner follows the `test-repair-estimation.cjs` precedent of
shipping as a named runner rather than being wired into the gate.

## Read-only, and cannot grey a row

Get Comps writes nothing: no note, no `last_call_attempt`, no callback, no
field, no tag, no stage, no workflow. Same standing as the Call and Underwriting
buttons beside it.
