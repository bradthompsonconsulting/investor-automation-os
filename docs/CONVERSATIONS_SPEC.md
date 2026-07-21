# IAOS — CONVERSATIONS SPEC v1 (READ-ONLY phase)

Status: read-only phase SHIPPED (`c3dd42a`) + VERIFIED LIVE 2026-07-16 — 10/10 harness, see §6.1.
Coverage Roadmap surface #3 (master ref §2a). Sits alongside `DASHBOARD_SPEC_v2.txt` +
`CONTACT_WORKSPACE_SPEC_v2.md` (whose §5/§8/§12 established the conversation read path this reuses).

## 0. SCOPE (this phase)

READ-ONLY. A cross-contact inbox: full thread list + per-thread message history, rendered in-app.
**No send, no compose, no writes of any kind.** Send is a separately-scoped later step (Brad's call),
NOT in this phase. The three-write invariant is untouched — this phase adds zero write actions.

## 1. SURFACE

New route `/contacts`-sibling `/conversations` + a "Conversations" nav item (Sidebar, between
Contacts and Pipeline). Distinct from the Contact Workspace, which embeds ONE contact's history in its
right column (workspace §8 step 5); this is the cross-contact inbox. Two-pane:
- LEFT — thread list (all conversations, newest first). Click selects a thread.
- RIGHT — the selected thread's messages (reuses the Workspace's message read path + bubble render).
  Header links to that contact's Workspace (`/contacts/:id`, reusing the step-7 deep-link pattern).

Files: `app/src/pages/Conversations.tsx` (new), route in `App.tsx`, nav in `Sidebar.tsx`,
`ghl-conversations.ts` (+`?scope=all` branch), `ghl.ts` (`ThreadRow` + `conversations.threads()`).

## 2. ENDPOINTS (OBSERVED = seen return on the wire; INFERRED = from docs/code)

- **`GET /conversations/search?locationId=&limit=100`** (+ `startAfterDate`/`startAfterId` paging) —
  the thread-list source, exposed opt-in via `ghl-conversations?scope=all` (default stays the
  unanswered-inbound filter; NO new function — Brad's amendment, not growing the zero-auth surface).
  **OBSERVED**: returns 200 live. Per-conversation fields consumed (`id, contactId, contactName,
  phone, email, lastMessageDate, lastMessageDirection, lastMessageBody, unreadCount`) are
  OBSERVED-as-consumed by the deployed function. **INFERRED**: multi-page pagination params — not
  personally watched paging past one page.
- **`GET /conversations/search?locationId=&contactId=`** — conversation(s) for one contact.
  **OBSERVED** live (`conversationCount` returned per contact).
- **`GET /conversations/{id}/messages?limit=100`** (`lastMessageId` cursor) — message history.
  **OBSERVED** live; message fields + `messages.messages[]` nesting recorded in workspace §12.
  **INFERRED**: >100-message pagination (never triggered).

## 3. EVENTUAL CONSISTENCY (workspace §11)

**UNKNOWN for conversations — not the same measurement.** §11's lag + transient-drop finding was
measured on the CONTACTS list endpoint, NOT `/conversations/search`. Not measured here. Read-only with
no write-then-read, so lag is low-stakes; the only exposure is a just-arrived inbound possibly not
appearing on the next load. Netlify function response is `cache-control: no-cache`, `age 0–1` (observed)
— no IAOS/CDN cache added; any lag would be GHL-side and is unmeasured.

## 4. CREDENTIAL

Conversations calls do NOT use `ghl-proxy` — the proxy's `pit-` token lacks the Conversations scope
(per `ghl-contact-conversations.ts`'s own header). The dedicated functions read
`process.env.GHL_PRIVATE_API_KEY` (fallback `GHL_API_TOKEN`) — env-var NAME observed in code. The
actual token VALUE is set only in the Netlify iaos-app dashboard and is **not observable from the repo**
(no Netlify CLI auth). Observed functionally: the deployed key works for Conversations (200 + real
messages). Which specific `pit-` token it is: unresolved (workspace §10 four-way secret ambiguity).

## 5. CHANNEL FILTER

Client-side allowlist `TYPE_EMAIL` + `TYPE_SMS` over the complete transcript (same mechanism as the
Workspace's `TYPE_EMAIL`-only allowlist, widened). GHL pipeline-activity (`TYPE_ACTIVITY_OPPORTUNITY`,
`TYPE_ACTIVITY_CONTACT`) and call logs (`TYPE_CALL`) are NOT conversation messages and are filtered
out. Filter on the `messageType` STRING, never the numeric `type` field. SMS joins the allowlist here.

## 6. VERIFICATION

Live at `app.investorautomationos.com`, 2560px, bundle-gate discriminating (§9.2 method). Fixtures by
explicit ID (never index/.first()):
- Email thread: Neelima Bale `FiIT0hUaxVCIuokQpZuc` (4 `TYPE_EMAIL` + 3 activity → 4 shown, 3 filtered).
- SMS thread: john sanchez `05gYdxJcyNTCKWTwkbbs` — INBOUND-only fixture (see §7). The harness verifies
  the INBOUND SMS renders; outbound SMS is out of live scope (none exists to drive).
Harness checks: bundle gate, thread-list shape/count, thread scoped-by-id, message delta (activity
filtered), inbound-SMS message renders (john sanchez), zero-writes (POST/PUT == 0) with a read-GET
positive control, no listAll on the path. Self-check floor = the LITERAL `check()` count in the written
harness (counted, not estimated).

### 6.1 VERIFIED LIVE — 2026-07-16 (`c3dd42a`)

**10/10 PASS, exit 0. Floor 10 == the literal `check()` count in the harness** (counted from the file;
the wait-fix edit added no checks). **Run 4× consecutively clean.** Bundle gate: `c3dd42a` →
`index-W5jrh93x.js`; parent `2147900` → `index-vC0u0CHt.js` (discriminates); prod matched poll #1;
re-asserted at runtime.

Real numbers:
- `threads-endpoint-ok`: 41 threads (rows carry `conversationId/contactId/contactName/lastMessageDirection`).
- `threadlist-count-matches`: DOM 41 == endpoint 41.
- `target-thread-present`: john sanchez at index 6 of 41.
- `thread-scoped-by-id`: click → Workspace link `→ /contacts/05gYdxJcyNTCKWTwkbbs` (id-scoped, not index).
- `message-delta`: endpoint total **6 → 4 shown → 2 filtered** (activity dropped); DOM bubbles **4**.
- `inbound-sms-renders`: endpoint inbound SMS **1**; DOM "STOP" bubble marked **Received + Sms** = true.
- `write-audit-attached`: 2 GETs (`ghl-conversations 1`, `ghl-contact-conversations 1`) — positive control.
- `zero-writes`: `writes=[]`; `no-listall-on-path`: `ghl-contacts = 0`.

**Diagnostic (separate probe, 3 runs):** the `ghl-contact-conversations` GET for john returned
**200, count=6** every run; DOM bubble timeline `[0, 0, 4, 4, 4, …]` — 0 for the first ~800ms (messages
GET in flight, spinner), then **stable at 4**. The bubbles render and persist; the read path is not flaky.

**Pre-fix 8/10 — recorded as what it was, not rounded away.** The FIRST harness run was a real **8/10
FAIL (exit 1)**: `message-delta` and `inbound-sms-renders` read `domBubbles=0` because the harness
evaluated the DOM inside that ~800ms pre-render window (it waited on the Workspace deep-link, which
renders in the header the instant a thread is selected — ahead of the messages). Fixed by adding a
second wait keyed on the message bubbles actually rendering. That 8/10 was a **harness-timing artifact,
superseded by the fix** — NOT a product defect (the wire proved 200/6 and a stable 4-bubble render).

### 6.2 VERIFIED LIVE — email-bubble collapse — 2026-07-16 (`0804767`)

**13/13 PASS, exit 0. Floor 13 == the literal `check()` count** (the read-only harness extended with 3
collapse checks; the original 10 re-ran green as a regression). Bundle gate: `0804767` →
`index-BHR7Coqc.js`; parent `159a269` → `index-W5jrh93x.js` (discriminates); prod matched poll #1.

Collapse numbers (fixture: john sanchez `05gYdxJcyNTCKWTwkbbs` — 3 long emails + 1 inbound SMS):
- `email-clamped-and-expandable`: **3 Expand buttons** (all 3 emails overflow 5 lines); first email body
  `scrollHeight > clientHeight` = clamped.
- `sms-not-collapsed`: the SMS "STOP" bubble has NO Expand button and its body is not clamped.
- `expand-reveals-full`: click Expand → button becomes "Show less", body no longer clamped (full text shown).
Regression: `message-delta` 6→4→2 (DOM bubbles 4), inbound-SMS renders, `zero-writes`, `no-listall` — all
still green with the local `MessageBubble` refactor.

**Short-EMAIL caveat — a NARROW gap, not the outbound-SMS kind.** The Expand control is gated on
`collapsible && overflowing`. Both relevant false-outcomes are exercised LIVE:
- `collapsible === false` (SMS) → button correctly ABSENT — **live-verified** (`sms-not-collapsed`).
- `collapsible === true && overflowing === true` (long email) → button correctly PRESENT + clamps —
  **live-verified** (`email-clamped-and-expandable`).
The ONE remaining combination is unverified: `collapsible === true && overflowing === false` — a SHORT
EMAIL that fits ≤5 lines, where the button should be absent. No such email exists in the location (all
71 emails are 874+ chars / 30+ newlines). So this is a **single unexercised sub-branch, NOT a
whole-feature gap**: the "button absent when it shouldn't show" outcome IS proven live via the SMS path;
only the short-EMAIL variant is open. This is narrower than the outbound-SMS item (which has zero data of
its kind at all) — the record should not flatten the two together. **Code-correct, not live-verified.
Trigger: first email that fits ≤5 lines.**

### 6.3 VERIFIED LIVE — §8.1 inner label "Conversations" → "History" — 2026-07-20 (`261a191`)

**14/14 PASS, exit 0. `checksRun=14`, `failures=0`. Floor 14 == the literal `check()` count** in the
harness (counted from the file: lines 30/36/65/66/75/103/104/106/126/128/139/148/150/151 — the original 13
plus one positive inner-label check; guard is `< 14`). The original 13 re-ran green as a regression.

Bundle gate (§9.2): `261a191` → `index-D7eW48eb.js`; parent `79cbddb` → `index-BpdCKBIX.js` (discriminates).
Both hashes were built locally BEFORE commit — the parent build reproduced the then-current prod bundle
`index-BpdCKBIX.js` EXACTLY, and the child differed, so the gate had a real discriminator (not the stale
`index-BHR7Coqc.js` from §6.2). Prod flipped `BpdCKBIX` → `D7eW48eb` and the harness matched at runtime.

The one new check — `inner-label-history-outer-conversations`: `h1s=["History"]`, `navConversations=true`
(sole page `<h1>` reads "History"; Sidebar nav still reads "Conversations"). Regression numbers unchanged
from §6.1/§6.2: threads 41/41, target john sanchez at index 6, thread scoped by id, message-delta 6→4→2
(DOM bubbles 4), inbound SMS renders, email clamp+expand (3 buttons), SMS not collapsed, expand reveals
full, write-audit attached (2 GETs), `zero-writes []`, no listAll on path.

**Harness now COMMITTED at `app/scripts/verify-conversations.cjs`** (`require("playwright")` from
`app/node_modules`) — it had gone stale-pinned twice living in scratchpad. Future threads inherit it and
RE-PIN `EXPECTED` per run; do not rebuild it.

**Netlify deploy-log line NOT agent-observable** (no Netlify dashboard/CLI/API access). "App built `261a191`,
not a docs-only skip" was proven instead by the runtime hash flip — prod serving the exact locally-built
`D7eW48eb` (a skip would have left `BpdCKBIX`; the bundle gate aborts rather than false-passing). OBSERVED
via the bundle, INFERRED-free; the literal log stays Brad's to read.

### 6.4 VERIFIED LIVE — §8.2/§8.4/§8.6 three-section layout + notes — 2026-07-20 (`867d058` + `20883bf`)

**20/20 PASS, exit 0. `checksRun=20`, `failures=0`. Floor 20 == the literal `check()` count** (counted from
the file; the 15 prior — §6.1/§6.2 + §8.1 inner-label + the interim top-bar-title check that took floor
14→15 at `e04b608` — re-ran green as regression, + 5 new layout checks).

Bundle gate (§9.2): `867d058` (the layout code) → `index-B6PPkWme.js`; parent `e04b608` → `index-YgvDrCUD.js`
(discriminates; both built locally, parent reproduced then-prod exactly). Prod converged to `B6PPkWme` on
poll #1. The follow-up `20883bf` is **scripts-only** (harness `.cjs`, not bundled) → the rebuild produced the
SAME `B6PPkWme` (Conversations.tsx unchanged); prod hash correctly UNCHANGED, and the harness ran green
against it.

The five new checks:
- `three-sections-present`: `headers=["Notes","Text","Email"]`.
- `section-placement`: `text{rows=1,stop=true}==sms=1 | email{rows=4,stop=false}==email=4` — SMS lands in
  Text (with the STOP), emails in Email, counts match the endpoint, not intermixed.
- `notes-section-data-driven` (john sanchez `05gYdxJcyNTCKWTwkbbs`, 0 notes): `domNotes=0 endpointNotes=0` —
  the EMPTY path + notes wiring.
- `notes-populated-data-driven` (Neelima Bale `FiIT0hUaxVCIuokQpZuc`, 12 notes): `endpointNotes=12
  domNotes=12` — the POPULATED render (>0). **Closes the john-N=0 gap honestly** (`20883bf`): the empty
  check alone did not exercise notes rendering with rows; this does.
- `empty-text-section` (Neelima, 0 SMS): `domTextRows=0 emptyText="No texts."` — §8.4 empty state.

**Notes fixtures — OBSERVED 2026-07-20:** of the 41 thread contacts, only **Neelima Bale (12 notes)** and
**Summer Carter (1)** have any; **john sanchez and Brad Thompson `9fbH2VCcZvzVNhsR9zjc` have 0.** Neelima is
the dual fixture (empty Text + populated Notes). Notes read via `ghl-proxy` GET (Option A, §8.6):
`write-audit-attached` now requires that proxy GET (`ghl-proxy/notes=2`), and `zero-writes` audits ALL
functions incl. ghl-proxy by method — `writes=[]`. No listAll on the path.

### 6.5 VERIFIED LIVE — §8.3 per-section bubble styling — 2026-07-20 (`39c414b`)

**21/21 PASS, exit 0. `checksRun=21`, `failures=0`. Floor 21 == the literal `check()` count**
(counted from the file; guard is `if (checksRun < 21)`. The 20 prior — §6.1/§6.2 + §8.1 inner-label
+ top-bar-title + the 5 §8.2/§8.4/§8.6 layout checks — re-ran green as regression, + 1 new §8.3
alignment check). Harness = the committed `app/scripts/verify-conversations.cjs`, `EXPECTED` re-pinned
to the bundle under test.

Bundle gate (§9.2): `39c414b` → `index-BSie5hdy.js`; parent `82d8c77` → `index-B6PPkWme.js`
(discriminates). **Basis (recorded honestly):** the child `BSie5hdy` is OBSERVED live — the harness gate
pulled it from prod this run and matched. The parent `B6PPkWme` is CARRIED from §6.4 (`82d8c77` is
docs-only and `20883bf` scripts-only, both reproducing `867d058`'s `B6PPkWme`); prod flipping
`B6PPkWme → BSie5hdy` proves the app built (a docs-only skip would have left `B6PPkWme`) — the §6.3
runtime-flip reasoning, NOT a fresh dual local build this session.

The §8.3 change under test: **Email** bubbles are full-width flush-left (`alignSelf: stretch`), direction
shown by the Sent/Received tag + color, alignment dropped; **Text** RETAINS phone-style alignment (inbound
STOP SMS → `flex-start`); **Notes** stay plain (no alignment, no tag). Plus the 60/40 top-row proportion
and half-height section headers (`39c414b` subject).

The one new check — `bubble-alignment`: `emailAlign=stretch textAlign=flex-start textIsStop=true` (first
Email bubble stretches full width; first Text bubble is the inbound STOP SMS, left-aligned).

**Live john sanchez numbers — the thread GREW since §6.1/§6.2 (recorded, not carried forward):**
`message-delta` now reads `endpointTotal=8 shown=5 filtered=3 domBubbles=5` (was 6→4→2 in §6.1/§6.2 —
the thread gained messages; DOM tracked the endpoint exactly). `section-placement`:
`text{rows=1,stop=true}==sms=1 | email{rows=4,stop=false}==email=4` — SMS (the STOP) in Text, 4 emails in
Email, segregated. Do not reconcile against the stale 6→4→2; these are the live figures for this run.

Regression numbers unchanged from §6.1/§6.2/§6.4: threads 41/41, target john sanchez at index 6, thread
scoped by id, inner-label `["History"]` + nav "Conversations", top-bar title "Conversations", inbound SMS
renders, three sections `["Notes","Text","Email"]`, notes empty (john `domNotes=0 endpointNotes=0`) +
populated (Neelima `endpointNotes=12 domNotes=12`), empty-text (Neelima `"No texts."`, index 38), email
clamp+expand (4 Expand buttons), SMS not collapsed, expand reveals full, write-audit attached
(`GETs=5 ghl-conversations=1 ghl-contact-conversations=2 ghl-proxy/notes=2`), `zero-writes []`, no listAll
on path.

### 6.6 VERIFIED LIVE — §8.5 temporary GHL Reply deep-link — 2026-07-21 (`5f57319`)

**22/22 PASS, exit 0. `checksRun=22`, `failures=0`. Floor 22 == the literal `check()` count**
(counted from the file; guard is `if (checksRun < 22)`. The 21 prior — §6.1/§6.2 + §8.1 inner-label
+ top-bar-title + the 5 §8.2/§8.4/§8.6 layout checks + the §8.3 bubble-alignment check — re-ran green
as regression, + 1 new §8.5 `ghl-reply-link-present` check). Harness = the committed
`app/scripts/verify-conversations.cjs`, `EXPECTED` re-pinned to the bundle under test.

Bundle gate (§9.2): `5f57319` → `index-C8PEXds6.js`; parent `776e98c` → `index-BSie5hdy.js`
(discriminates). **Basis (recorded honestly):** the child `C8PEXds6` is OBSERVED live — the harness gate
pulled it from prod this run and matched. The parent `BSie5hdy` is CARRIED from §6.5 (`776e98c` is
docs-only, reproducing `39c414b`'s `BSie5hdy`); prod flipping `BSie5hdy → C8PEXds6` proves the app built
(a docs-only skip would have left `BSie5hdy`) — runtime-flip reasoning, NOT a fresh dual local build.

**Deploy-behavior CORRECTION (observed off the Deploy tab 2026-07-21, `d7fae9d` — the commit that added
THIS §6.6 record + the EXPECTED re-pin):** `d7fae9d`'s original commit message said "app + marketing sites
skip" — that was WRONG for the app site. `d7fae9d` touched `app/scripts/verify-conversations.cjs`, and the
app `ignore` rule scopes to base dir `app/` (`git diff … -- .`), so ANY file under `app/` — scripts
included — triggers a BUILD, not a skip. **What actually happened:** the app site **BUILT** (17s, 10
functions, Published) but **REPRODUCED `C8PEXds6`** — deterministic build, Netlify "All files already
uploaded by a previous deploy with the same commits," so **the served prod hash stayed `C8PEXds6` and the
harness `EXPECTED` still matches** (no gate re-run needed). **Marketing DID skip** (its rule excludes
`docs/`, and the only non-`app/` file was `docs/`; still on `6550bcc`). The discriminator is `app/` SCOPE,
NOT scripts-vs-source — see the corrected SESSION_HANDOFF Netlify rule. The §6.5 "`20883bf` scripts-only
skipped" belief was the same conflation: it BUILT-and-reproduced too. The 22/22 record above stands
unchanged — prod serves the exact bundle it was verified against.

The §8.5 change under test: a TEMPORARY GHL Reply deep-link at the top of the thread pane — a pure-navigation
`<a target="_blank">` to the SELECTED contact's GHL conversation, writing NOTHING. External host, so it adds
ZERO netlify-function traffic; `zero-writes` stays `[]` by construction. MUST be removed when Conversations
gets write capability (§8.5).

The one new check — `ghl-reply-link-present`: `tag=A target=_blank href=https://app.gohighlevel.com/v2/location/jmHG4B8RdzwpfqruNf68/contacts/detail/05gYdxJcyNTCKWTwkbbs`
(an `<a>`, not a `<button>`; opens a new tab; href is the GHL contact-detail path for the selected
john-sanchez contact `05gYdxJcyNTCKWTwkbbs`).

**Live john sanchez numbers — recorded, NOT carried forward:** target now at **index 7** of 41 (was index 6
in §6.5 — the thread list re-ordered by newest-activity; DOM tracked the endpoint order exactly,
`threadlist-count-matches dom=41 endpoint=41`). `message-delta` reads `endpointTotal=8 shown=5 filtered=3
domBubbles=5` and `section-placement` reads `text{rows=1,stop=true}==sms=1 | email{rows=4,stop=false}==email=4`
(both unchanged from §6.5's live figures; the thread body did not grow this run, only its list position moved).
Do not reconcile the index against §6.5's index-6; index is activity-ordered and moves.

Regression numbers unchanged from §6.5: threads 41/41, thread scoped by id, inner-label `["History"]` + nav
"Conversations", top-bar title "Conversations", inbound SMS renders (`endpointInboundSms=1 domStopInboundSms=true`),
three sections `["Notes","Text","Email"]`, notes empty (john `domNotes=0 endpointNotes=0`) + populated
(Neelima `endpointNotes=12 domNotes=12`), empty-text (Neelima `"No texts."`, index 38), email clamp+expand
(4 Expand buttons), SMS not collapsed, expand reveals full, bubble-alignment
(`emailAlign=stretch textAlign=flex-start textIsStop=true`), write-audit attached
(`GETs=5 ghl-conversations=1 ghl-contact-conversations=2 ghl-proxy/notes=2`), `zero-writes []`, no listAll
on path.

### 6.7 VERIFIED LIVE — §8.9 navy-header banner (contact name + Reply-in-GHL in one card) — 2026-07-21 (`70cdef6`)

**23/23 PASS, exit 0. `checksRun=23`, `failures=0`. Floor 23 == the literal `check()` count**
(counted from the file; guard is `if (checksRun < 23)`. The 22 prior — §6.1/§6.2 + §8.1 inner-label
+ top-bar-title + the 5 §8.2/§8.4/§8.6 layout checks + the §8.3 bubble-alignment check + the §8.5
`ghl-reply-link-present` check — re-ran green as regression, + 1 new §8.9 `name-and-reply-same-card`
check). Harness = the committed `app/scripts/verify-conversations.cjs`, `EXPECTED` re-pinned to the
bundle under test (`C8PEXds6 → DkmsrUiR`).

Bundle gate (§9.2): `70cdef6` → `index-DkmsrUiR.js`; parent `bc4bfea` → `index-C8PEXds6.js`
(discriminates). **Basis (recorded honestly):** this is a fresh DUAL LOCAL BUILD — child `70cdef6` built
to `DkmsrUiR` and parent `bc4bfea` built to `C8PEXds6` (which reproduced the then-current prod bundle
EXACTLY), so the gate had a real discriminator (child ≠ parent, child ≠ prior-prod). This is APP code
(exit-1 on `git diff -- app/`), so the app site BUILT (not a docs-only skip); prod flipped
`C8PEXds6 → DkmsrUiR` on poll #1 and the harness matched at runtime.

The §8.9 change under test: the selected contact's name now renders **LARGE (22px / 600 Space Grotesk,
`#F1F5F9`)** in a `#0D1B3E` navy banner — a visual twin of the Contacts/Workspace identity card — to the
right of the "History" `<h1>`, in the **SAME navy card as the §8.5 Reply-in-GHL button** so who-you're-acting-on
is tied to the action. The old small (14px) thread-pane name strip was removed; its name + Workspace
deep-link + Reply-in-GHL button all moved up into the banner. **READ-ONLY — pure layout: the name is an
already-read value (`ThreadRow.contactName`), the button is the pure-navigation §8.5 deep-link. ZERO write
actions added; the three-write invariant is untouched.**

The one new check — `name-and-reply-same-card`: `hasName=true hasReply=true nameFontPx=22`. It does NOT
merely assert the name renders somewhere — it finds the Reply `<a>`, climbs to the banner ancestor (the
container holding "History"), and asserts that SAME container holds BOTH the Reply link AND the name at
LARGE size (`nameFontPx=22`, ≥20px — distinguishing it from the removed 14px strip). Name match is
case-insensitive (thread-name casing is not guaranteed on the wire). This enforces the explicit requirement
that the large name and the Reply button share one navy card.

`inner-label-history-outer-conversations` stayed GREEN (`h1s=["History"]`): exactly ONE `<h1>History</h1>`
survives (the old top-level header `<div>` was replaced wholesale by the banner, not duplicated), and the
large name is a `<span>` sibling, not a second `<h1>` — so the exact-match h1 assertion did not regress.

**Live john sanchez numbers — recorded, NOT carried forward:** target at **index 7** of 41
(`threadlist-count-matches dom=41 endpoint=41`; same index as §6.6 this run). `message-delta` reads
`endpointTotal=8 shown=5 filtered=3 domBubbles=5` and `section-placement` reads
`text{rows=1,stop=true}==sms=1 | email{rows=4,stop=false}==email=4` (unchanged from §6.6's live figures —
the thread body did not grow). Do not reconcile the index against §6.5's index-6; index is activity-ordered.

Regression numbers unchanged from §6.6: threads 41/41, thread scoped by id (Workspace link
`/contacts/05gYdxJcyNTCKWTwkbbs` — now IN the banner, still found), inner-label `["History"]` + nav
"Conversations", top-bar title "Conversations", `ghl-reply-link-present` green (the Reply `<a target=_blank>`,
relocated to the banner, still an `<a>` to the GHL contact-detail), inbound SMS renders
(`endpointInboundSms=1 domStopInboundSms=true`), three sections `["Notes","Text","Email"]`, notes empty
(john `domNotes=0 endpointNotes=0`) + populated (Neelima `endpointNotes=12 domNotes=12`), empty-text
(Neelima `"No texts."`, index 38), email clamp+expand (4 Expand buttons), SMS not collapsed, expand reveals
full, bubble-alignment (`emailAlign=stretch textAlign=flex-start textIsStop=true`), write-audit attached
(`GETs=5 ghl-conversations=1 ghl-contact-conversations=2 ghl-proxy/notes=2`), `zero-writes []`, no listAll
on path.

### 6.8 VERIFIED LIVE — §8.9 banner name indented under the Notes column — 2026-07-21 (`1a7bee7`)

**23/23 PASS, exit 0. `checksRun=23`, `failures=0`. Floor 23 == the literal `check()` count**
(`grep -c 'check("'` = 23; guard `if (checksRun < 23)`). **NO new check** — this is a layout-only indent,
covered by the existing invariant checks (`name-and-reply-same-card`, `inner-label-history…`) re-running
green as regression PLUS a live viewport confirmation (below). The harness proves the banner invariants +
deploy-is-live; it does NOT machine-assert the pixel alignment. Harness = the committed
`app/scripts/verify-conversations.cjs`, `EXPECTED` re-pinned to the bundle under test (`DkmsrUiR → CwSbtBkM`).

Bundle gate (§9.2): `1a7bee7` → `index-CwSbtBkM.js`; parent `4e95bce` → `index-DkmsrUiR.js` (discriminates).
**Basis (recorded honestly):** child `CwSbtBkM` is a fresh LOCAL build (`tsc -b` passed) AND is OBSERVED live
— the harness gate pulled it from prod and matched. The parent `DkmsrUiR` is CARRIED from §6.7 (`4e95bce`
is docs + scripts only on top of the banner `70cdef6`, so it reproduces `DkmsrUiR`); prod flipping
`DkmsrUiR → CwSbtBkM` (poll #1) proves the app built — a docs/scripts-reproduce would have left `DkmsrUiR`.

The §8.9 change under test: the selected contact's name is INDENTED so its **left edge lands on the Notes
column** below it. The indent is a **single `NAME_INDENT` constant derived from shared `THREAD_LIST_WIDTH`
+ `PANE_GAP`** — the SAME constants now driving the thread-list flex-basis and the two-pane gap — so the
name **tracks the column** instead of a welded magic literal (change the column width once → both move).
`NAME_INDENT = THREAD_LIST_WIDTH(360) + PANE_GAP(16) + 15 (rightpane border 1 + body pad-left 14) − 19
(banner border 1 + pad-left 18) = 372px`, targeting the Notes card's left edge (all `box-sizing:border-box`).
The name is **ONE guarded `<span>`** (the old separator `·` rule removed; the Read-only pill moved into the
fixed leading zone), staying in the banner (same card as Reply-in-GHL), **22px, same node** — layout ONLY,
NOT moved into the Notes column subtree. **READ-ONLY — no write actions added; three-write invariant untouched.**

**Pixel alignment — VISUALLY CONFIRMED live by Brad (not machine-asserted):** at Brad's real viewport on
`app.investorautomationos.com/conversations`, the large name's left edge lands under the Notes column, checked
across TWO threads. Recorded honestly: the harness cannot assert cross-container pixel alignment; this line is
the human confirmation that closes it. (A local `vite preview` was tried first and abandoned — it serves the
static build but not the netlify functions, so threads returned the SPA HTML instead of JSON and no thread
could be selected; the live prod check was the only path to a rendered name.)

The regression checks that guard the invariants stayed GREEN through the indent: `name-and-reply-same-card`
(`hasName=true hasReply=true nameFontPx=22` — name still in the banner, same card as Reply, still 22px after
the restructure into the fixed leading zone) and `inner-label-history-outer-conversations` (`h1s=["History"]`
— exactly one `<h1>`, the name is a `<span>` sibling; the leading-zone wrapper added no second heading).

**Live john sanchez numbers — recorded, NOT carried forward:** target at **index 7** of 41
(`threadlist-count-matches dom=41 endpoint=41`). `message-delta` reads `endpointTotal=8 shown=5 filtered=3
domBubbles=5` and `section-placement` reads `text{rows=1,stop=true}==sms=1 | email{rows=4,stop=false}==email=4`
(unchanged from §6.6/§6.7's live figures). Do not reconcile the index against §6.5's index-6; index is
activity-ordered.

Regression numbers unchanged from §6.7: threads 41/41, thread scoped by id (Workspace link in the banner,
still found), inner-label `["History"]` + nav "Conversations", top-bar title "Conversations",
`ghl-reply-link-present` green, inbound SMS renders (`endpointInboundSms=1 domStopInboundSms=true`), three
sections `["Notes","Text","Email"]`, notes empty (john `domNotes=0 endpointNotes=0`) + populated (Neelima
`endpointNotes=12 domNotes=12`), empty-text (Neelima `"No texts."`, index 38), email clamp+expand (4 Expand
buttons), SMS not collapsed, expand reveals full, bubble-alignment
(`emailAlign=stretch textAlign=flex-start textIsStop=true`), write-audit attached
(`GETs=5 ghl-conversations=1 ghl-contact-conversations=2 ghl-proxy/notes=2`), `zero-writes []`, no listAll
on path.

## 7. OPEN ITEMS

- **SMS rendering — inbound live-verified, outbound NOT (observed 2026-07-16).** Recorded verbatim:
  **"SMS inbound rendering live-verified against contact 05gYdxJcyNTCKWTwkbbs. SMS OUTBOUND rendering
  is code-correct but NOT live-verified — zero outbound SMS observed in the location at build time.
  Trigger to verify: first observed outbound SMS thread."** Do not round inbound-verified up to
  SMS-verified.
  - Scan basis: a location-wide read-only scan of the 41 contacts `listAll` returned, per-contact
    message history, **fully accounted — 41/41 returned HTTP 200, 0 errored/skipped** (a first pass
    with a silent catch was re-run instrumented to confirm nothing was silently dropped). `messageType`
    totals `TYPE_EMAIL 71 (all outbound) / TYPE_ACTIVITY_OPPORTUNITY 44 / TYPE_CALL 2 /
    TYPE_ACTIVITY_CONTACT 2 / TYPE_SMS 1 (inbound)`. The one SMS is on john sanchez
    `05gYdxJcyNTCKWTwkbbs` — a single INBOUND `"STOP"`.
  - Endpoint direction behavior: **OBSERVED** the `direction` field distinguishes inbound/outbound and
    the endpoint returns outbound of other types (email/call/activity) — no blanket outbound filter.
    Whether it returns outbound SMS specifically is **UNKNOWN** — there are none in the data to observe.
  - **UNRESOLVED anomaly (not reasoned away):** an inbound `STOP` normally follows an outbound SMS, but
    John's `STOP` is preceded in `/messages` by an outbound EMAIL, not an outbound SMS — no outbound SMS
    appears anywhere. Either the triggering outbound SMS was never sent via this path, or GHL sent it
    and this endpoint does not return it. Cannot be determined from the wire; flagged for the first
    real outbound SMS thread to settle.
  - Universe caveat: the scan covers what `listAll` returned, so a §11-transiently-dropped contact
    would not have been scanned.
- **Full thread-list raw row** was not re-observed populated on the wire at build time (the unanswered
  subset was empty); fields are OBSERVED-as-consumed by the deployed function. Confirm the populated
  thread-row shape during the live harness run.
- **DnD / opt-out (OBSERVED 2026-07-16).** Contact john sanchez `05gYdxJcyNTCKWTwkbbs` sent an inbound
  SMS "STOP" and GHL recorded `TYPE_ACTIVITY_CONTACT` inbound "DnD enabled by customer" on the record.
  This phase is read-only and does not touch it. TRIGGER: when the send path is scoped, DnD state must
  gate compose — and this contact is never a send fixture. Whether the app reads DnD state anywhere
  today is UNVERIFIED.
- **Message-bubble render is an intentional dupe of Contact Workspace step 5.** `Conversations.tsx`
  renders message bubbles with its own copy of the bubble markup rather than importing a shared
  component — a deliberate choice to avoid touching the already-verified `ContactWorkspace.tsx`. NOT a
  defect; recorded so it isn't rediscovered as a surprise. If a third consumer appears, extract a shared
  `<MessageBubble>` then (and re-verify both surfaces), not before.
- **Email-bubble collapse — the dupe now DIVERGES on purpose (2026-07-16).** Conversations email bubbles
  collapse to `CLAMP_LINES = 5` via CSS `-webkit-line-clamp` with an Expand/Show-less control shown only
  when the body overflows (measured `scrollHeight > clientHeight` while clamped; per-bubble local state,
  resets on thread change; SMS never collapses). `ContactWorkspace.tsx` was deliberately NOT changed —
  its bubble render stays verified/as-is — so the two bubble renders are no longer identical. Extends
  the intentional-dupe note above: any future shared `<MessageBubble>` extraction must reconcile the
  collapse behavior and re-verify BOTH surfaces.
- **Unread badge — OBSERVED SHIPPED behavior (passive mirror), NOT unread management.** The thread list
  renders a read-only badge of GHL's `unreadCount` per thread: `ghl-conversations.ts:106` maps
  `c.unreadCount ?? 0` → `Conversations.tsx:179` renders `{t.unreadCount > 0 && <span>{t.unreadCount}</span>}`.
  OBSERVED live: john sanchez `05gYdxJcyNTCKWTwkbbs` `unreadCount=1` (1 of 41 threads). This is a passive
  READ — IAOS manages NO unread state: no mark-as-read (a write), no unread filter, no IAOS-side
  read/unread tracking. Those are the unshipped **unread MANAGEMENT** step (master ref §2a). Recorded as
  shipped read-only behavior so the record is not misread as "no unread info surfaces at all."

---

# 8. REWORK v2 — thread pane re-layout (2026-07-20) — PLAN, NOT YET BUILT

Status: **PLANNED**, no code written. All decisions RESOLVED (D1/D2 below, settled by Brad 2026-07-20 —
nothing pending). Still **READ-ONLY** — this rework adds ZERO write actions; the three-write invariant is
untouched. Where noted, §8 SUPERSEDES the v1 right-pane description in §1 and the single-list filter in §5;
§1–§7 stay as the historical v1 record (do not delete). Every §8 change is "just layout / read" — and per
Brad's standing rule that does NOT skip verification: each piece ships behind the harness floor + bundle
gate (§9.2 method), against an already-shipped verified surface.

## 8.0 Scope of this rework
Five changes to the RIGHT (thread) pane. The LEFT thread-list pane (§1) is unchanged. Pieces are independent
and ship one at a time, diff-before-every-commit. The investigation (§8.7) is a RECORDED FINDING, resolved.

## 8.1 Header label — inner "Conversations" → "History"
The page renders its own `<h1>` heading ("Conversations", `app/src/pages/Conversations.tsx:139`) in ADDITION
to the persistent chrome label. This duplicates the section name (the same doubling Pipeline has: Sidebar
"Pipeline" + page `<h1>Pipeline</h1>`). Change the PAGE `<h1>` text to **"History"**. Leave the OUTER labels
untouched: the Sidebar nav item stays "Conversations" (`app/src/components/Sidebar.tsx:19`) and the Header
chrome is not touched. Pure text change, one line, no data/logic.

## 8.2 Layout — three labeled sections (SUPERSEDES §1's single-list right pane)
Within the selected thread's right pane, replace the single chronological bubble list with THREE
sections, each with its own header, each holding ONLY that channel's items sorted by timestamp within the
section:
- **Top row, split two-up side by side:** **Notes** (left) and **Text** (right).
- **Below, full width:** **Email**.
Rationale (Brad): emails run long (all 71 in the location are 874+ chars, multi-paragraph); texts and notes
are short. Email earns full width; the two short channels share the narrow top row.
Sources:
- **Email** = existing feed, `messageType === "TYPE_EMAIL"`.
- **Text**  = existing feed, `messageType === "TYPE_SMS"`.
  (Both split out of the SAME `ghl-contact-conversations` response already loaded — a client-side partition,
  no new endpoint. This replaces the §5 combined `[TYPE_EMAIL, TYPE_SMS]` allowlist with a per-section split
  of the same two types. Workflow self-notifications stay in Text/Email — see §8.7, D2; NO exclusion filter.)
- **Notes** = the notes endpoint, NOT the conversation feed — see §8.6 (D1 resolved).

## 8.3 Bubble styling — per-section (Text keeps alignment; Email uses the tag; Notes plain) — REVISES §1
Direction signal differs by section (Brad, 2026-07-20):
- **Text** — KEEP phone-style left/right indent: incoming (received) left, outgoing (sent) right. Cramped in
  the narrow top panel is fine — that's the familiar SMS read. (This RETAINS the v1 `alignSelf`
  flex-start/flex-end behavior at `Conversations.tsx:75` for the Text section.)
- **Email** — use the **Sent/Received tag + color**, NOT alignment: uniform equal-width rows, one per row,
  sorted by timestamp, with the direction shown by the tag. (The v1 bubble already carries a "Sent"/"Received"
  label + cyan/slate color at `Conversations.tsx:82`; the Email section keeps that signal and drops the
  alignment.)
- **Notes** — render **PLAIN: NO left/right alignment AND NO Sent/Received tag.** A note has no direction —
  it's Brad's own record, not a message to anyone — so both signals are meaningless. Uniform timestamped
  entries only (dateAdded + body), one per row.
Email-collapse (§6.2, `CLAMP_LINES=5` Expand/Show-less) is retained in the Email section as-is.

## 8.4 Empty states — sections never collapse (matches Mailers)
All three sections ALWAYS render, even when empty. A contact with emails but no texts still shows the Text
section with an empty state. Reuse the Mailers empty-state idiom ("Nothing due this week." —
`app/src/pages/Mailers.tsx:302`); per-section copy e.g. "No texts." / "No emails." / "No notes."
Consistent contact-to-contact so the layout never jumps.

## 8.5 GHL Reply button — TEMPORARY, remove when write ships
At the top of each contact's thread pane, a button that DEEP-LINKS to that contact's GHL conversation so
Brad can reply inside GHL directly. Pure navigation (an `<a>`/link out to GHL) — writes NOTHING, adds no
write action, stays inside read-only. Likely target: the GHL contact/conversation URL (cf. the existing
`ghlContactDetailUrl(contactId)` builder, `app/src/lib/ghl.ts:46`, → `app.gohighlevel.com/v2/location/…`);
confirm the exact conversation-deep-link path during build.
**TEMPORARY — this button MUST be removed when Conversations gets write capability (send/compose).** A
future thread scoping the send path: DELETE this button as part of that work. Recorded here so it is not
mistaken for permanent UI.

## 8.6 Notes data source — D1 RESOLVED 2026-07-20
- **Source = `/contacts/:id/notes`** (`ghl.notes.list`, `app/src/lib/ghl.ts:332`; the read-only note history
  already used by Contact Workspace §8 step 2). Read-only GET; no write, invariant untouched.
- **Transport — Option A, chosen deliberately 2026-07-20 (not a default):** the notes read routes through
  the generic `ghl-proxy` passthrough via `ghl.notes.list` (GET only) — the SAME path the Contact Workspace
  already ships, NOT a new dedicated function. **OBSERVED:** `ghl-proxy.ts:38` forwards ANY method
  (`method: event.httpMethod`), so the proxy is write-*capable*; but this read uses GET only, and read-only
  is enforced by (a) the GET method and (b) the harness `zero-writes` audit, which filters ALL captured
  netlify-function requests — `ghl-proxy` included (the request listener matches `…/functions/([^/?]+)`) —
  by METHOD. **Rationale (Brad):** ghl-proxy's write-capability is already on the deferred
  seven-unauthed-functions item; piecemeal hardening now (a dedicated GET-only notes function, rejected
  Option B) would NOT close that item — the security pass will — and would diverge from the proven
  Workspace read. So reuse the shipped path; the invariant holds by method + audit, not by the function
  being write-locked.
- **Shows ALL of the contact's notes — NO origin filtering, no call-vs-manual distinction.** A disposition
  note reads as a call note by its content; a human can tell. Do NOT build any filter or type split.
- The section is named **"Notes"** (not "Call Notes").
- **Why NOT the TYPE_CALL call log:** OBSERVED 2026-07-20 (fixture Brad Thompson `9fbH2VCcZvzVNhsR9zjc`) that
  GHL call logs arrive in the conversation feed as `messageType: TYPE_CALL` with an **empty body (`""`)** —
  call-log EVENTS carry no readable text. Readable notes live only on the notes endpoint. So Notes pulls the
  notes endpoint, not TYPE_CALL. (No raw-field probe needed — decision settled.)
- Fields consumed from the notes response: `{ notes: [{ id, body, dateAdded }] }` (already the shape
  `ghl.notes.list` returns). **Sort oldest→newest by `dateAdded`** — consistent with the Text/Email sections
  and the §7 "reads the way it happened" convention.
- Rendered PLAIN per §8.3: no alignment, no Sent/Received tag — timestamped entries only.

## 8.7 Workflow-notification messages — investigation finding + D2 RESOLVED 2026-07-20
- **FINDING (OBSERVED, why the "raw workflow output" appears in the thread):** those objects are real
  `TYPE_SMS` / `TYPE_EMAIL` messages, NOT notes/system events. Thread `9fbH2VCcZvzVNhsR9zjc`, 20 messages,
  all `direction: outbound`. Type totals: TYPE_SMS 9, TYPE_EMAIL 4, TYPE_CALL 2, TYPE_ACTIVITY_OPPORTUNITY 3,
  TYPE_ACTIVITY_APPOINTMENT 2. Each "workflow output" line maps to a real conversation type: "🏠 New Seller
  Lead" → TYPE_SMS (idx 5,14); "Seller Replied:" → TYPE_SMS (idx 7); "Seller Appointment Booked" → TYPE_EMAIL
  (idx 10,16) + TYPE_SMS (idx 11,17); "…sitting in Seller Follow-Up for 2 days" → TYPE_SMS (idx 18);
  "Appointment Reminder in 10 Minutes" → TYPE_SMS (idx 19). These are workflow→Brad internal notifications
  GHL emits as bona-fide TYPE_SMS/TYPE_EMAIL objects on the contact's conversation. The genuine system events
  ARE correctly typed (`TYPE_ACTIVITY_*`) and the §5 allowlist already drops them; the notifications survive
  because they are genuinely TYPE_SMS/TYPE_EMAIL — `messageType` cannot discriminate them.
- **D2 RESOLVED (Brad):** these workflow self-notifications **STAY** in the Text and Email sections. **No
  exclusion, no discriminator, no filter.** Recorded so a future thread does not "fix" it as noise.

## 8.8 Build sequence + verification (each piece: diff-before-commit, harness floor, bundle gate §9.2)
Actual build order (RESEQUENCED at Brad's direction — §8.2 structure before §8.3 polish; §8.6 folded into §8.2):
1. **§8.1 header label — DONE + verified** (`261a191`; §6.3, floor 14).
   - **Header top-bar titles fix — DONE + verified** (`e04b608`; interim floor 15; a separate micro-change,
     not an original §8.8 step — /conversations, /calendars, /mailers TITLES keys).
2. **§8.2 + §8.4 three-section layout + empty states — DONE + verified** (`867d058`; §6.4, bundle `B6PPkWme`).
3. **§8.6 Notes section (Option A, `ghl.notes.list`/ghl-proxy GET) — DONE + verified** (folded into `867d058`;
   populated-notes gap closed `20883bf`; §6.4, floor 20).
4. **§8.3 bubble styling (Text alignment retained; Email tag; Notes already plain) — DONE + verified**
   (`39c414b`; §6.5, floor 21, bundle `BSie5hdy`). Also carried the 60/40 top-row proportion + half-height
   section headers.
5. §8.5 temporary GHL Reply button — NOT built.
Each step re-runs the existing harness (floor = literal `check()` count) plus new checks for the piece;
bundle gate discriminates commit vs parent and polls prod to the expected hash before any "live" claim.
No open decisions remain — build straight through the remaining sequence (§8.3, then §8.5).
