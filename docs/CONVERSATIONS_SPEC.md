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
