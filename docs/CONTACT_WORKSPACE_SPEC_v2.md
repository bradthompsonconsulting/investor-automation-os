# IAOS — CONTACT WORKSPACE SPEC v2

Status: §5 verified live 2026-07-15. §7 revised. **§8 steps 1–7 all SHIPPED + verified live** (steps 4–5 `dc60d1e` §9.3; step 6 disposition capture `6fa154c` §9.4; step 7 name-click deep-link `becaa17` §9.5 — 2026-07-16). No §8 build work remains. ONE thing outstanding, not code: step 6's GHL-side trigger→webhook path awaits a real dispositioned call from Brad (§9.4 PENDING).
Supersedes CONTACT_WORKSPACE_SPEC_v1.md. Sits alongside `IAOS_Master_Architecture_Reference_V10_2.txt` and `DASHBOARD_SPEC_v2.txt`.

**Changes from v1:**
- §5 open questions all answered by live test (contact ID, auth, idempotency) — see §5.1
- §5 new constraint discovered: the Custom Disposition prompt is transient and unrecoverable — see §5.2
- §5 redesigned: Path A only — Path B (call-end backstop) rejected, silence is not a signal — see §5.4
- §6 grey rule stated from source: MECHANISM is a fresh last_call_attempt greys (notes are not read by the grey computation); the four cases are consequences of the note+setLastCallAttempt pairing convention — see §6
- §7 layout changed to two-column
- §8 step 6 de-risked: the GHL→IAOS receive path already exists in production

---

## 0. WHY THIS EXISTS

The Dashboard is a **triage** surface: it answers "who do I work next." It is not where work happens.

The Contact Workspace is the **work** surface: open a person, work them fully (call → log outcome → note → callback), close, next. The contact is the natural unit of work, not the row.

Today `/contacts` is a read-only analysis grid (Combined / Motivation / Deal scores + Analyze button). There is no per-contact detail view in IAOS at all. This spec builds one.

### Roadmap position (revised)
Original: Dashboard → Conversations → Calendars → Contacts.
Revised: Dashboard → **Contact Workspace** → Conversations → Calendars.

Reason: calling is core to a lead-automation product, and calling lives on the contact. Conversations (SMS/email reply) is valuable but blocks nothing today — SMS/email still work in GHL. This is a deliberate re-sequence, not drift.

---

## 1. THE CALLING CONSTRAINT (LOCKED — DO NOT RE-LITIGATE)

**In-app dialing is blocked by GoHighLevel, not by IAOS.** Established by capability spike, 2026-07-14:

- GHL docs, Conversation Providers: *"Call providers cannot be used to place or receive calls within the CRM and can only be used to log calls via inbound and outbound APIs."* Third-party apps can only log a call that already happened.
- No generic "place a call" API exists. Open, unresolved community feature request confirms it is still a gap.
- `tel:` links are the OS protocol handler, not a GHL deep link. Will not open GHL's softphone.
- Custom Pages (iframe + postMessage SSO) have no documented bridge to GHL's softphone session or its provisioned number.
- Number `+1 972-954-8586` is **LC Phone** (GHL's resold Twilio) — lives in GHL's Twilio subaccount, no direct API access.
- **BYO Twilio is not available on this account** (not present in Integrations). Brad's personal Twilio account is a trial and unrelated to GHL.

**Consequence:** the Call button opens the GHL contact page in a new tab. Brad clicks GHL's softphone there. This is the ceiling.

**Rejected alternatives and why:**
- *Separate Twilio + new number:* would require paid Twilio, new number, fresh A2P 10DLC + SHAKEN/STIR + CNAM registration, and would call sellers from an unverified number. Trading a trusted caller ID for ~2 seconds is a bad trade — pickups are the business. Also breaks the SaaS story: every client would need their own telephony stack.
- *Port number to own Twilio:* moot — BYO Twilio unavailable on this account.
- *IAOS embedded in GHL via Custom Pages:* removes the tab-hop but still cannot trigger the softphone. Partial win, does not deliver click-to-dial.

**Revisit only if GHL ships a dial API.** Not a research gap. Not an open task.

---

## 2. SCOPE

### In scope
1. Per-contact detail view in IAOS (new surface)
2. Notes (read + write, full history)
3. Tier + Score (read-only display)
4. Address (read-only display)
5. Callback scheduling (read + write, reuses Dashboard's proven popover)
6. Call button (tab-hop to GHL contact page — same behavior as Dashboard today)
7. Full conversation history (read-only)
8. Disposition capture (see §5)

### Out of scope (deferred)
- Reply/compose (SMS/email) — that is the **Conversations** phase
- Appointments — **Calendars** phase
- Offer/MAO editing — MAO Calculator stays reference-only, never moves stages or tags
- Any in-app dialing — see §1

---

## 3. NAVIGATION

- Dashboard Lead Queue: **clicking the contact's NAME** deep-links to that contact's IAOS detail view (`/contacts/:id`). Not the Contacts list — the specific person.
  - This is a **Dashboard-only** behavior.
- Dashboard Lead Queue section heading already has an external-link icon → `/contacts` (shipped, commit f65c6f9).
- Contacts list rows also link to `/contacts/:id`.
- **Dashboard Call button stays where it is for now.** Removal is deferred until the Workspace is live and proven; removing it early leaves a gap with nothing to replace it.

---

## 4. WRITE INVARIANT (EXTENDED)

The Dashboard's three-write invariant carries forward unchanged. The Workspace adds **no new write actions**:

1. `ghl.notes.create()` → POST `/contacts/{id}/notes`
2. `ghl.contacts.setLastCallAttempt()` → PUT, carries `last_call_attempt` (`lGoNXM9Wrte4m7ShwQPT`) + `last_call_attempt_precise` (`2vz1igGMxF3wv7HaWm97`) in ONE call
3. `ghl.contacts.setCallbackDatetime()` → PUT, carries `callback_datetime` (`JeQWtwpwUbvPA50UfuPU`) + `callback_datetime_precise` (`7qRUkZQK8bi2HNo7zDHd`) in ONE call

**HARD NO, unchanged:** tags, pipeline stage, `offer_` fields, workflow triggers. IAOS never fires a workflow.

**`last_call_attempt` is what greys; `setLastCallAttempt` is the only thing that sets it (§6 MECHANISM).** Every write path that should grey pairs `notes.create` with `setLastCallAttempt` (the note is the record; the attempt greys). The Call button does neither — it does not grey a row. Callback scheduling now writes both, in gated order (locked this session — see §6).

**No-drift invariant holds:** GHL is sole system of record. No app-side shadow copy. Every value displayed is read from GHL.

---

## 5. DISPOSITION CAPTURE

This is the real automation win. The tab-hop costs ~2 seconds; manually logging every call outcome costs 40x per day.

### 5.1 VERIFIED LIVE — 2026-07-15

All v1 open questions are closed. Test: workflow `9d1d5cc9-86de-47f7-93b8-f39dc2e4c971`, trigger Call details / Custom disposition (all six values), action Webhook (POST) -> webhook.site. Real softphone call to test contact Brad Thompson `9fbH2VCcZvzVNhsR9zjc`, disposition Voicemail tapped, payload captured.

**Trigger exists.** Events > Call details, filter field Custom disposition, offering exactly the six values in this spec: Follow Up, Incorrect Number, No Answer, Not Interested, Requested Appointment, Voicemail. Filter operator is "contains any of" — no is-not-empty. Select all six to fire on any disposition.

**Use the free Webhook action, NOT Custom Webhook.** Custom Webhook is LC Premium and meters per execution. The standard Webhook action carries everything needed via CUSTOM DATA key/value pairs with the dynamic value picker. Confirmed working:

```
disposition   {{phoneCall.dispositions}}
contact_id    {{contact.id}}
duration      {{phoneCall.duration}}
```

**Verified payload (`customData` block):**

```json
"customData": {
  "disposition": "Voicemail",
  "contact_id": "9fbH2VCcZvzVNhsR9zjc",
  "duration": "28"
}
```

- `disposition` returns a **single string**, not an array. The plural field name is a red herring.
- `contact_id` matches the GHL contact detail URL exactly.
- `duration` is talk-seconds as a string.

**Payload facts that matter for the build:**
- A root-level `contact_id` also ships in the standard payload. GHL's public docs omit it from the documented field list. Do not depend on it — `customData` is explicit and won't silently move.
- `triggerData` arrives as empty `{}`. Call context does NOT arrive as a trigger object. The `{{phoneCall.*}}` merge fields resolve at send time regardless. **customData mapping is the only way to get call data out.**
- Payload is ~2.8kB, mostly empty contact custom fields, every field on the record on every fire. **The IAOS function reads `customData` and ignores the rest.**

**Auth: the Webhook action HAS a HEADERS section** (GHL's docs omit this too). Set `X-IAOS-Secret` from a GHL Custom Value; constant-time compare in the Netlify function; 401 otherwise. GHL cannot provide a static IP for allowlisting, so header auth is the mechanism.

**Idempotency:** return 2xx immediately (non-2xx triggers retry with exponential backoff -> duplicate notes). Dedupe by reading the contact's recent notes for a matching disposition+timestamp. **No local dedupe table** — that would be an app-side shadow copy and violates the no-drift invariant.

### 5.2 THE TRANSIENT PROMPT (CONSTRAINT — verified 2026-07-15)

The Custom Disposition picker appears **in the Call Summary panel the moment you hang up**. One tap, no navigation. Good UX when you use it.

**It closes after ~1-2 minutes of inactivity, and once closed the call cannot be dispositioned.** Verified by attempt: the "Call completed" entry in the contact activity feed offers no path back; the only way to reach a disposition picker again is to place another call.

This is GHL's UI. No setting controls the timeout, no default-disposition config exists, no API touches it. Not fixable from our side.

**Accepted consequence (Brad, 2026-07-15):** a call dispositioned outside that window produces no webhook — so IAOS writes no note and greys nothing. The lead resurfaces as never-attempted and gets re-dialed. This is accepted deliberately. The remedy is the **manual note**: if Brad wants that attempt on record, he types one; the note-save pairs with `setLastCallAttempt` (§6), and the fresh `last_call_attempt` greys the row. IAOS does not infer an outcome from silence — a missed disposition is not a signal (see §5.4, Path B rejected).

### 5.3 WHAT GHL EXPOSES

**Available with NO workflow:**
- `callDuration` (number, seconds), `callStatus` (string: `completed` | `voicemail`)
- Source: `OutboundMessage` / `InboundMessage` webhook schema
- Scope: `conversations/message.readonly` — already in use for Unanswered Inbound

**Requires a GHL Workflow:**
- Custom Disposition value — surfaces in Call Reporting UI and as a Workflow trigger filter
- No `CallDispositionSet` webhook event exists. The only call-completion event is `VoiceAiCallEnd`, scoped to AI-agent calls only.

### 5.4 DESIGN — PATH A ONLY (Path B rejected, Brad 2026-07-15)

**Path A — disposition tapped (the only path):**
1. GHL Workflow: trigger Call details / Custom disposition (all six); action Webhook -> IAOS endpoint, customData per §5.1, `X-IAOS-Secret` header.
2. IAOS writes note: `Call: {disposition} — {duration}s`
3. IAOS then calls `setLastCallAttempt` (paired with the note, §6 CONVENTION) -> the fresh `last_call_attempt` greys the row. **The note alone does NOT grey — the webhook MUST call `setLastCallAttempt` too (§6 STEP 6 REQUIREMENT).**

**Path B — call-end backstop with no disposition — REJECTED.** v1 proposed writing `Call — {duration}s, no disposition` from the call-end event whenever nothing was tapped, as a backstop for §5.2's gap. Rejected deliberately:

> **IAOS writes a note only when Brad explicitly signals an outcome. The absence of a disposition is not a signal.** Inferring one would put an unauthored note on a seller's permanent record — the record that matters most — on the strength of silence. A missed disposition is handled by §5.2's accepted consequence (the lead re-dials) and the manual-note remedy, not by machine inference.

Consequences of dropping Path B:
- The **call-end-event / `conversations.readonly` prerequisite verification is removed** — nothing depends on it anymore.
- The **reconciliation / dedupe logic is removed** — with one path there is nothing to reconcile.
- The grey rule stays clean (§6): a disposition writes a note AND `setLastCallAttempt` (which greys); a call with no disposition writes neither and does not grey.

**Still exactly three writes.** No new write action. Invariant intact.

### 5.5 INVARIANT RULING (LOCKED — Brad, 2026-07-14)

A GHL Workflow of the shape **Custom Disposition trigger -> Webhook action -> IAOS endpoint** does **NOT** violate the workflows-are-a-hard-No invariant.

Reasoning: the invariant governs what **IAOS writes** — that IAOS never triggers workflows, moves stages, or re-tags as a side effect. A disposition webhook is the opposite direction: GHL-side config that IAOS does not trigger and only *receives* from. It moves nothing, tags nothing, mails nothing. It is a read mechanism shaped like a workflow. Workflows already exist in this account (mailer track, Seller pipeline bridge, Phone Type Validation); the rule was never "no workflows exist," it was "IAOS doesn't touch them."

### 5.6 THE RECEIVE PATH ALREADY EXISTS IN PRODUCTION

Discovered 2026-07-15. The **Phone Type Validation** workflow (`4ed31e4a-8c95-45f9-bb3b-0376eb0927ef`) triggers on Contact Created (no filters), fires a Custom webhook to `https://investorautomationos.com/api/phone-lookup` with body `{"contactId": "{{contact.id}}", "phone": "{{contact.phone}}"}`, waits 10s, branches on Phone Type, tags `phone-validated-{mobile|landline|voip|unknown}`.

**§8 step 6 is therefore not a new mechanism.** GHL -> IAOS webhook receive is proven in production. This materially de-risks the step.

**Three open items surfaced by that discovery (not blockers, do not fix during this phase):**
1. `/api/phone-lookup` has AUTHORIZATION: None — a public unauthenticated endpoint accepting a contact ID and phone number. Do not repeat this pattern; the disposition endpoint uses `X-IAOS-Secret` from day one.
2. That workflow uses Custom webhook (LC Premium) and meters per execution on **every contact created**. Already a live cost line in the account. Reason enough for the disposition webhook to stay on the free standard Webhook action.
3. The Wait 10s -> If/Else on Phone Type implies IAOS writes `Phone Type` back to the contact — a write outside the three. Either the invariant was always scoped to the lead-working path and phone-lookup is exempt, or there is an undocumented fourth write in production. **Resolve before the invariant is stated as absolute anywhere.**

## 6. THE GREY RULE + CALLBACK BEHAVIOR (LOCKED — Brad)

Established from source (Dashboard `getBand(effectiveLastAttempt(c))` → band 3 → `opacity: 0.55`; the chain reads only `last_call_attempt`/`_precise`, never notes), 2026-07-15:

**MECHANISM:** a fresh `last_call_attempt` (< `RESURFACE_HOURS`) greys a row. Nothing else greys. Notes are not read by the grey computation.

**CONVENTION:** every path that should grey writes a note AND `setLastCallAttempt` together, in that order, gated. The note is the human-readable record; `last_call_attempt` is what greys.

**CONSEQUENCE:** the four cases hold only while that pairing is honored. A path that writes a note without `setLastCallAttempt` will not grey (breaks case 3). A path that sets `last_call_attempt` without a note will grey with no record of why.

```
no call + note                          = grey
no call + no note                       = no grey
call + disposition (writes a note)      = grey
call + no disposition (no note)         = no grey
```

**STEP 6 REQUIREMENT:** the disposition-capture webhook must call `setLastCallAttempt` alongside `notes.create`, or dispositioned calls will not grey. **— SATISFIED (`6fa154c`, verified live §9.4):** `ghl-disposition.ts` fires `setLastCallAttempt` alongside `notes.create`, gated (note→attempt), and returns **502 on attempt-failure** so the endpoint never returns 2xx with the row un-greyed; GHL retries and a dedupe-by-recent-notes guard keeps the retry idempotent.

**Callback scheduling greys — change from Dashboard v2 (LOCKED, Brad 2026-07-14):** scheduling a callback writes a note (`Callback scheduled for {Mon D, h:mm A}`) and then `setLastCallAttempt`, in that gated order — so it greys by the convention above, not because "a note greys." Clearing a callback writes neither and does not grey. No new write action; applies on both Dashboard and Workspace. Reverses the prior "callback never greys" rule deliberately.

**Gated write order + failure behavior (Workspace callback, verified live 2026-07-15):** `setCallbackDatetime` → `notes.create` → `setLastCallAttempt`, each gating the next — the callback must persist before the note asserts it, and the note before the attempt is marked. This proves the frontend control-flow gate — don't call notes.create unless setCallbackDatetime resolved — which is exactly what the commit claims. It does not exercise a GHL-side partial failure (GHL never gets the chance, by design).

### 6.1 NOTE COPY (LOCKED)

```
Call: {disposition} — {duration}s
Callback scheduled for {Mon D, h:mm A}
```

(The Path-B `Call — {duration}s, no disposition` copy is removed — Path B is rejected, §5.4.)

Internal notes, not seller-facing — the "no just checking in" copy rule doesn't apply here. Keep them parseable; they'll be grepped later.

---

## 7. LAYOUT (REVISED v2 — two-column)

v1's draft was single-column at `CONTENT_MAX_WIDTH=1600px` and stacked conversation history *below* note history. On Brad's 2560px screen that wastes horizontal space and, worse, forces scrolling away from the note input to read the context you're writing about. You read while you type.

```
/contacts/:id

┌──────────────────────────────────────────────────────────────────────┐
│ ← Contacts        [Name]                              [Tier] [Score] │
│ [phone]  [address]                                                   │
│ [ Call (opens GHL ↗) ]  [ Schedule Callback ]                        │
├───────────────────────────────────┬──────────────────────────────────┤
│ NOTES  (the work)                 │ CONVERSATION HISTORY (context)   │
│ [ new note — autosave on blur ]   │ read-only, oldest → newest       │
│ ─ history, newest first ─         │ independently scrollable         │
│   {date} {body}                   │                                  │
│   {date} Call: Voicemail — 28s    │                                  │
│   {date} Callback scheduled for … │                                  │
└───────────────────────────────────┴──────────────────────────────────┘
```

- Left column = the work: identity, actions, notes.
- Right column = the context: conversation history, read-only, scrolls independently.
- Disposition notes land in the left column's note history — no separate surface needed.

Reuse from Dashboard (proven):
- Note input + autosave-on-blur + attempt/grey path
- Callback popover: defaults to today at next :00/:30, `step={1800}`, un-muted controls
- `effectiveLastAttempt()` resolver (precise → DATE fallback)
- `effectiveCallback()` resolver
- Tier/Score badge components
- `CONTENT_MAX_WIDTH` = 1600px

Copy rules apply to seller-facing content: no "just checking in" language; lead with the seller's benefit; never promise follow-up the automation can't back. Internal note copy is governed by §6.1.

---

## 8. BUILD ORDER

1. **Read-only detail view** — route `/contacts/:id`, display name/phone/address/tier/score. Prove the read path.
2. **Notes** — history display + new-note write. Reuse Dashboard's autosave/attempt/grey.
2b. **Contacts list → detail link** — wrap the contact NAME in `Contacts.tsx` with a `Link` to `/contacts/:id` (per §3). Read-only, no writes. Distinct from the Dashboard name-click (step 7) — different surface (the Contacts grid, not the Lead Queue). Placed before step 3 because it is the other half of §3's navigation and rides the step-1/2 read path already shipped.
3. **Callback** — popover + write. Reuse Dashboard's component. Scheduling writes a note + `setLastCallAttempt` (gated), and the fresh `last_call_attempt` greys per §6.
4. **Call button** — tab-hop to GHL. Trivial; same as Dashboard. **SHIPPED + VERIFIED LIVE (`dc60d1e`, 2026-07-16 — §9.3).** Opens the GHL contact page in a new tab; writes nothing, greys nothing.
5. **Conversation history** — read-only render from the existing conversations read path. **SHIPPED + VERIFIED LIVE (`dc60d1e`, 2026-07-16 — §9.3).** `TYPE_EMAIL` allowlist (useMemo) over the complete transcript; observed GHL shapes in §12.
6. **Disposition capture** — new Netlify function + GHL workflow, per §5.4 (Path A only). **SHIPPED + VERIFIED LIVE (`6fa154c`, 2026-07-16 — §9.4).** `ghl-disposition.ts` receives the workflow's Webhook POST and writes note→attempt, gated; the STEP 6 REQUIREMENT (setLastCallAttempt alongside notes.create) is satisfied and proven live. §5 open questions were closed; no prerequisites remained (the Path B call-end verification was dropped with Path B).
7. **Dashboard name-click** → deep-link to `/contacts/:id`. **SHIPPED + VERIFIED LIVE (`becaa17`, 2026-07-16 — §9.5).** Lead Queue contact name wrapped in a react-router `Link` (Dashboard-only, Lead Queue only); pure navigation — writes nothing (no note, no `last_call_attempt`), same rule as the step-4 Call button.

**All of §8 (steps 1–7) is shipped + verified live as of 2026-07-16.** The only thing outstanding is not a build step: step 6's GHL-side trigger→webhook path awaits a real dispositioned call from Brad (§9.4 PENDING). Steps 1–5 were always on proven paths; step 6 was never a new mechanism (GHL → IAOS webhook receive already runs in production, §5.6).

**Deferred until the Workspace is live:** Lead Queue column reorder, Call button removal from Dashboard rows (#3/#4/#5/#10a from Brad's original list).

---

## 9. VERIFICATION

Per established pattern:
- Verify live at `app.investorautomationos.com`, never localhost
- Bundle-hash gate before asserting — but "hash changed" ≠ "your code is live"; use the discriminating method in §9.2
- Write audit after any write-path change: confirm still exactly 3 write actions
- Any write test scoped to a single contact by explicit ID (never `.first()` or a queue index)
- Test contact: Neelima Bale `FiIT0hUaxVCIuokQpZuc`
- Poll for round-trips; never fixed-timeout waits (GHL read-propagation lag is real — §11 measured ~105s on the grey rule's own path)
- Reload retests must use a real `page.reload()` — in-session override masks bugs
- Verify at a wide viewport (~2560px) matching Brad's actual screen, not the 1280px default
- Every harness self-checks that it actually ran (assert the write/interception fired; fail loud + non-zero otherwise) — an assertion over zero events is a false pass

### 9.1 VERIFIED LIVE — callback wiring, 2026-07-15

The shared callback helper (`app/src/lib/callbackWrite.ts`, `scheduleCallbackGated`) was wired
into BOTH surfaces — implemented in `b76802a` (feat: wire both surfaces), deployed to production
alongside `17c6238` (playwright devDep for the harnesses). All three required verifications ran
live at `app.investorautomationos.com`, 2560px, against Neelima Bale `FiIT0hUaxVCIuokQpZuc` by
explicit ID. Actual numbers, not "passed":

**Bundle gate (deploy-is-live proof; method in §9.2).** Old code built to `index-DlH3mUN9.js`;
the wired commit built to `index-BCwmjQxm.js`; prod served `index-BCwmjQxm.js`. Old ≠ new proves
the hash discriminates; prod == new proves the wired code is under test. Each harness re-asserted
this hash at runtime before any assertion.

1. **Dashboard live grey test.** Scheduling from a Lead Queue row fired exactly three gated writes
   in order — `callback` (PUT, 200) → `note` (POST, 201) → `attempt` (PUT, 200), no fourth.
   `last_call_attempt` advanced `2026-07-15T20:53:34.890Z → 22:09:26.014Z` — the assertion keys on
   the timestamp VALUE advancing, NOT band membership (Neelima was already band 3, so membership
   alone would be a tautology that cannot fail). `listAll` converged to the fresh value after 35
   polls (~105s — see §11). Real `page.reload()` → row `opacity 0.55`, band 3, keyed off
   `last_call_attempt` (not note presence). Callback cleared afterward.
2. **Dashboard `route.abort` gate-failure test.** Aborting proxy writes (match = string
   `url.includes('/.netlify/functions/ghl-proxy')`, not a regex) with the callback write failing:
   aborts callback=1, note=0, attempt=0 — the gate HELD, note+attempt never attempted. Error
   surfaced ("Couldn't schedule callback: Failed to fetch"), popover stayed open (callback-stage →
   open). `last_call_attempt` unchanged (`22:09:26.014Z`). INTERCEPTION_FIRED true, counted inside
   the abort so a matcher that never fired fails loud rather than false-passing.
3. **Workspace re-runs (extraction unchanged).** Phase A happy path: three gated writes
   `callback(200) → note(201) → attempt(200)`, attempt advanced `22:09:26.014Z → 22:18:56.259Z`
   and persisted (single-record read). Phase B `route.abort` gate: callback=1, note=0, attempt=0,
   error surfaced, popover open, no state change. Confirms the extraction into
   `scheduleCallbackGated` left the Workspace's observable behavior identical to the Dashboard's.

Final live state: Neelima's callback cleared; `last_call_attempt` left at `22:18:56.259Z`
(harmless permanent marker on the established test contact); test notes left in place.

### 9.2 Bundle-gate methodology — "hash changed" is not "your code is live"

A changed bundle hash proves *a* deploy happened, not that *your commit* is what deployed. The
gate that actually proves it (used in §9.1, now the standard):
1. Build the commit under test locally → the expected entry hash (here `index-BCwmjQxm.js`).
2. Build the PARENT commit → prove the hash DISCRIMINATES (old `index-DlH3mUN9.js` ≠ new). A change
   that doesn't move the hash would make the whole gate worthless; this step catches exactly that.
3. Poll prod `index.html` until its entry hash equals the expected hash. Equality against a
   *discriminating* hash is the proof; a bare before/after change is not.
Each harness then re-asserts the live hash at runtime before making any assertion. (Vite content-
hashes chunks, so the same source + deps reproduces the same hash; a CSS-only or comment-only
change may not move the JS hash — step 2 is what tells you whether the hash can prove anything.)

### 9.3 VERIFIED LIVE — steps 4–5 (Call button + conversation history), 2026-07-16

Shipped in **`dc60d1e`** (`feat: Contact Workspace call button + conversation history (§8 steps 4-5)`).
Verified live at `app.investorautomationos.com`, 2560px, against Neelima Bale `FiIT0hUaxVCIuokQpZuc`
by explicit ID, after a real `page.reload()`. Harness self-check: **checksRun=19, failures=0** — a
floor of 19 checks, so an early throw or a rendered-nothing panel fails loud instead of false-passing.

**Bundle gate (§9.2).** dc60d1e built to `index-Cw1s0sdN.js`; parent `1cf32d0` built to
`index-DIMiNVpY.js` (old ≠ new → the hash discriminates); prod served `index-Cw1s0sdN.js`, matched on
poll #1. The harness re-asserted the live hash at runtime before any assertion.

**Step 5 — conversation history (read-only).**
- Endpoint ground truth: `messages.length = 7` — 4 `TYPE_EMAIL`, 3 `TYPE_ACTIVITY_OPPORTUNITY`.
- Panel rendered **exactly 4 bubbles** (4 Sent/Received labels, 4 "· Email" channel labels); empty-state absent.
- Filter proof — the REAL invariant, robust to a live send bumping 7/4/3 → 8/5/3: bubbles == emails,
  and total − bubbles == activity == 3. Live: **7 total → 4 bubbles → 3 filtered.**
- `"Opportunity updated"` / `"Opportunity created"` absent from the Workspace DOM.

**Audits.**
- Network: **listAll (`ghl-contacts`) = 0.** Audit provably attached — **6 function GETs** across
  goto+reload: `ghl-contact ×2`, `ghl-proxy ×2` (single-record read + notes read), `ghl-contact-conversations ×2`.
  "Zero listAll" is distinguishable from "audit never attached" by that positive control.
- Writes: **none** (`writes=[]`). No note, no `last_call_attempt`, no callback field. Rendering history is not an attempt (§6).

**Step 4 — Call button.**
- Requested URL asserted **pre-redirect** (captured at the context level before the click — `window.open`
  navigates before a popup-scoped listener can attach, and GHL redirects the popup to a login page):
  `https://app.gohighlevel.com/v2/location/jmHG4B8RdzwpfqruNf68/contacts/detail/FiIT0hUaxVCIuokQpZuc`.
- Writes nothing: post-click write count 0; app-function request count unchanged (before=6, after=6). Never greys a row (§6).

Harness note: the first run surfaced a test-harness false negative on the Call assertion (it caught
GHL's login-page Google-Sign-In iframe `document` request instead of the top-level nav); fixed by
capturing the requested URL at the context level. No product code changed during verification.

### 9.4 VERIFIED LIVE — step 6 (disposition capture), 2026-07-16

Shipped in `6fa154c` (`ghl-disposition.ts` + field IDs exported from `lib/contact-parse.ts`).
Server-side webhook, so there is NO frontend bundle to gate (§9.2 does not apply) and NO
function-deploy gate exists (§10) — verified by hitting the live endpoint directly. Test contact
`FiIT0hUaxVCIuokQpZuc`, secret from `app/.env`. Harness self-check floor met on both artifacts.

**Write / auth / idempotency (main harness — 13 of 15 checks passed, then it THREW):** the run
threw at the browser step (a harness casing bug, below) before `dashboard-row-found` and
`row-greyed-0.55` could execute, so the `checksRun<15` floor caught it as **exit 2 (FAILED)** — not
a clean pass. The 13 that ran, all passing:
- **bad-secret → 401 AND zero writes** — `last_call_attempt` unchanged, matching-note count 0→0.
  Made MEANINGFUL by the positive control `audit-detects-writes` (the good write moved the same
  before/after reads), so "zero writes" is distinguishable from "audit never attached" — not a
  dead-read false pass. no-secret → 401 likewise.
- **good-secret → 200** `{ok, noteWritten:true, attemptMarked:true}`; note +1 (exactly one matching
  note); `last_call_attempt` advanced `2026-07-15T22:18:56.259Z → 2026-07-16T20:16:30.523Z`.
- **double-POST (idempotency) → 200** with `noteWritten:false`; still exactly ONE note (dedupe held).

**Grey (proven standalone, 3/3 — the main run's browser step threw on a harness bug, below):**
- `fresh-attempt-under-12h`: value `2026-07-16T20:16:31.383Z`, age 0.19h → band 3.
- `pre-write-was-ungreyed`: prior attempt **22.0h** old → row WAS band-1/ungreyed, so the
  ungreyed→greyed transition is non-tautological.
- `listall-converged`: **4 polls / 11s** (poll to convergence, never fixed-wait — see §11 addendum).
- Real `page.reload()` → Neelima's Lead Queue row **opacity 0.55** (band 3), keyed on the fresh
  attempt VALUE, not band membership.

**STEP 6 REQUIREMENT proven:** `setLastCallAttempt` fires alongside `notes.create`, gated
(note→attempt); the endpoint returns **502 on attempt-failure** so it never 2xx's with the row
un-greyed (GHL retries; dedupe keeps it idempotent). Still exactly the three sanctioned writes.

**Auth (X-IAOS-Secret):** hashed constant-time compare of a server-side secret (GHL Custom Value →
Netlify env `IAOS_WEBHOOK_SECRET`). Decision + scope in §10 Closed #9 — authenticates the disposition
WEBHOOK only; does NOT reopen the other seven read-only functions (auth stays deferred).

**Harness note:** the main run threw on the Dashboard grey step because GHL's list vs single-record
endpoints disagree on name casing (§10 open item) — the selector searched "Neelima Bale" but listAll
renders "neelima bale". A test-harness bug, not a product defect; the grey was then proven standalone
with a case-insensitive, row-keyed wait. No product code changed during verification.

**PENDING — GHL-side trigger→webhook, awaiting a real dispositioned call (this is a live-test item,
NOT a build gap).** Everything above proves the IAOS side: a harness POST to `ghl-disposition` returns
200, writes note+attempt, and is idempotent. What is NOT yet proven live is GHL's side — that tapping a
Custom Disposition on a real softphone call fires the published Workflow, which POSTs to
`ghl-disposition` with the right `customData` and `X-IAOS-Secret`. **The Workflow is wired and
published** (URL → `/.netlify/functions/ghl-disposition`; header `X-IAOS-Secret` =
`{{ custom_values.iaos_webhook_secret }}`; all six dispositions on the trigger filter). It needs one
real dispositioned call from Brad's softphone to close the loop. **Constraint (§5.2):** the disposition
picker is transient — it appears in the Call Summary the instant you hang up and closes after ~1–2 min
of inactivity, unrecoverable once closed. So the live test MUST tap the disposition inside that window;
a call left un-dispositioned proves nothing (and, by design, writes nothing — the lead just re-dials).

### 9.5 VERIFIED LIVE — step 7 (Dashboard name-click deep-link), 2026-07-16

Shipped in `becaa17`. Verified live at `app.investorautomationos.com`, 2560px. Harness:
**checksRun=8, failures=0** — the floor (8) equals the exact count of `check()` calls, so no partial
run could pass.

**Bundle gate (§9.2).** `becaa17` built to `index-vC0u0CHt.js`; parent `e2d764d` built to
`index-Cw1s0sdN.js` (discriminates). The parent is the SAME bundle as `dc60d1e` because the commits
between (`616c33b`, `6fa154c`, `e2d764d`) touched only docs and a netlify function — none of which
enter the client bundle. A legitimate unchanged baseline, not a coincidental collision. Prod served
`index-vC0u0CHt.js` (poll #3); re-asserted at runtime.

**Real numbers:**
- `namelink-present`: the Lead Queue name is `<a href="/contacts/FiIT0hUaxVCIuokQpZuc">`.
- `target-is-non-first`: targetIndex **39 of 40** — Neelima at the queue bottom (band 3). Clicking a
  NON-first row is what discriminates against an "always navigates to the first contact" bug.
- `url-is-target-id`: click → `/contacts/FiIT0hUaxVCIuokQpZuc` (the clicked contact's id, not an
  index / `.first()`).
- `workspace-shows-target`: `ContactWorkspace` rendered that contact.
- `write-audit-attached`: **3 read GETs** after the click (`ghl-contact`, `ghl-proxy`,
  `ghl-contact-conversations`) — positive control proving the audit was watching.
- `zero-writes-on-nav`: `writes=[]` (no POST/PUT).
- `attempt-unchanged`: `last_call_attempt` byte-identical `2026-07-16T20:16:31.383Z` before and after.

**INVARIANT (recorded): the name-click is PURE NAVIGATION** — it writes nothing (no note, no
`last_call_attempt`), the same rule as the step-4 Call button (§6). Navigation is not an attempt.
Proven, not asserted: `zero-writes-on-nav` + `attempt-unchanged`, with the read-GET positive control
ruling out "audit never attached." No new write action; the three-write invariant is untouched.

---

## 10. OPEN DECISIONS FOR BRAD

**Closed since v1:**
1. ~~§5 — confirm Path A~~ → confirmed and verified live (§5.1). Path A only; Path B rejected (§5.4).
2. ~~§7 layout shape~~ → revised to two-column (§7).
3. ~~Note copy~~ → locked (§6.1).
4. ~~`offer_` fields in the Workspace~~ → **omit entirely.** Read-only offer data on a work surface invites "why can't I edit this," and the answer is an invariant you'd defend every time you look at the screen. The Workspace is a calling surface.
5. ~~Contacts list: Analyze button / score columns~~ → **keep as-is.** The grid's value is comparison across leads; the detail view's is depth on one. Folding Analyze in means analyzing one at a time — worse at the job the grid exists to do. Different surfaces, different jobs.
6. ~~Grey rule / a completed call greying a row~~ → **resolved (Brad, 2026-07-15).** Settled from source: the MECHANISM is a fresh `last_call_attempt` greys (notes are not read by the grey computation); the four cases are consequences of the note+`setLastCallAttempt` pairing convention. No separate "a completed call greys" decision exists. See §6 (incl. the STEP 6 REQUIREMENT that disposition capture must call `setLastCallAttempt`).
7. ~~Path B backstop~~ → **rejected (§5.4).** IAOS writes a note only on an explicit outcome; silence is not a signal. The call-end-event verification prerequisite is therefore gone.
8. ~~Dashboard callback handler must grey~~ → **done (2026-07-15).** Both surfaces wired onto the shared `scheduleCallbackGated` (`b76802a`; deployed alongside `17c6238`). Scheduling a callback from the Dashboard now fires the same gated `setCallbackDatetime → notes.create → setLastCallAttempt` pairing as the Workspace, so the row greys off a fresh `last_call_attempt` on BOTH surfaces; clearing stays a lone `setCallbackDatetime(null)`. Verified live with numbers — §9.1 (Dashboard grey test + Workspace re-runs). Was "Decided — pending its own task"; the task is complete.
9. ~~§8 step 6 auth (X-IAOS-Secret)~~ → **decided + implemented (`6fa154c`, 2026-07-16).** The disposition webhook is a server-to-server WRITE endpoint whose secret lives server-side (GHL Custom Value → Netlify env `IAOS_WEBHOOK_SECRET`) — a different risk class than the deferred read-only browser functions (a bundled secret isn't a secret; a server-held one is). So it verifies `X-IAOS-Secret` (hashed constant-time compare, 401 otherwise) from day one. **Scope: this authenticates the disposition webhook ONLY; it does NOT reopen the other seven functions**, whose auth stays deferred (trigger unchanged: first user who isn't Brad). Verified live §9.4.

**Open — needs Brad:**
- **Lead Queue UI copy** (`Dashboard.tsx:816`, the "A note is the only thing that marks an attempt" blurb) is wrong as a mechanism (§6: a fresh `last_call_attempt` greys, not the note) but is telling a user something roughly true about how to use the tool. Wording is **undecided**; it's user-facing copy with its own build/deploy/verify cycle. **Untouched by the callback wiring** — the wiring changed the handler, not this blurb (the line moved 783 → 816 only because wiring added code above it). Still wrong, still unshipped, pending a decision on the phrasing.

**Open — housekeeping, not blockers:**
- §5.6 item 3 — does `/api/phone-lookup` write `Phone Type` back to the contact? If so, the three-write invariant has an undocumented exception in production and needs scoping language.
- §5.6 item 1 — `/api/phone-lookup` is unauthenticated.
- Test contact Brad Thompson (`9fbH2VCcZvzVNhsR9zjc`) carries `phone-validated-unknown` and sits in the live Lead Queue. Strip the tag.
- Test workflow `9d1d5cc9-86de-47f7-93b8-f39dc2e4c971` is published and pointed at a webhook.site URL that expires 7 days from 2026-07-15. Unpublish.
- Test contact Neelima Bale (`FiIT0hUaxVCIuokQpZuc`) accumulated several labeled `[Claude Code — …]` verification notes and a live `last_call_attempt` during the §11 probes. Harmless (permanent notes on the established test contact) but present; clear if a clean slate is wanted.

**Open — security & integrity (recorded during the steps 4–5 review, 2026-07-16; named, not chased):**
- **Zero inbound auth on the seven read-only, browser-facing netlify functions, plus `Access-Control-Allow-Origin: *`.** Any client that knows a URL can read GHL contact/conversation/opportunity data. **Deferred by Brad's call — single-tenant today.** TRIGGER to fix is **the first user who isn't Brad, not a lead count.** Multi-tenant needs a session-derived `locationId` per request, **never client-supplied**. (The eighth function, `ghl-disposition`, is the exception — a server-to-server WRITE endpoint, authed with `X-IAOS-Secret` from day one; §10 Closed #9. Its auth does NOT reopen these seven.)
- **`ghl-proxy.ts:9` "Phase B: validate OAuth token here"** — never implemented. Same gap, already flagged in the proxy's own header.
- **`/api/phone-lookup` unauthenticated** (§5.6 item 1), and it is **unresolved whether it writes `Phone Type` back** to the contact — a possible undocumented **4th production write** (§5.6 item 3). Resolve before the three-write invariant is stated as absolute anywhere.
- **§9.2's gate proves `deployed == repo` for the FRONTEND bundle only, NOT for the netlify functions.** The bundle-hash gate covers `index-*.js`; deployed function code has no equivalent gate and can drift from the repo undetected.
- **Secret/token mismatch — GHL token PARTLY RESOLVED (2026-07-17); webhook-secret split unchanged.** GHL API token, RESOLVED: **prod runs `GHL_PRIVATE_API_KEY` = the canonical PIT `pit-…d0f7` ("IAOS Netlify Integration" in GHL).** All 9 functions read `GHL_PRIVATE_API_KEY ?? GHL_API_TOKEN`, so with both set on the app site GHL_PRIVATE_API_KEY always wins and **`GHL_API_TOKEN` is a dead fallback that never engages**. `app/.env`'s `pit-b2e9…` is **"Jeff the Bot's" SEPARATE build-phase integration — NOT a prod mismatch** (the earlier "app/.env lacks Conversations scope" worry does not touch prod). **STILL UNKNOWN: the token's full scope LIST** — the GHL UI does not expose it. Observed scopes so far (probes, 2026-07-17): contacts R+W, conversations R, calendars R, calendars/events W; **Conversations WRITE UNTESTED (recorded as untested, not absent).** SEPARATELY, `IAOS_WEBHOOK_SECRET` still exists in two places — `app/.env` (local harness) and a Netlify-set prod copy mirrored as a GHL Custom Value (**authoritative for prod**); that split is unchanged.
- **`ghl-contacts` (listAll) returns `firstName`/`lastName` LOWERCASE; `ghl-contact` (single-record) returns proper case.** The Dashboard renders from listAll, so it **displays every contact name lowercase** (e.g. "neelima bale"; single-record gives "Neelima Bale"). Observed 2026-07-16 during step 6 verification — it broke a name-based test selector. **Cosmetic, live, unfixed. Cause unproven — do not design a fix against it.**
- **Two `TYPE_ACTIVITY_OPPORTUNITY` rows on 2026-07-07** (source `app`, from "Investor Automation OS") flipped the pipeline `New Lead ↔ Seller Offer Sent` ten minutes apart. **Something carrying the IAOS credential moved pipeline stages** — which the write invariant says IAOS never does. Cause **unproven; do not design a fix against it.** Recorded as a data point; watch for recurrence.

---

## 11. READ RELIABILITY FINDING — GHL LIST ENDPOINT IS EVENTUALLY CONSISTENT AND TRANSIENTLY DROPS RECORDS (2026-07-15)

Found while locating the source of a stale-attempt-on-reload symptom in the Workspace (§8 step 1). Read-only probes, no fix applied. Documented for shape.

**The lag is GHL's, not ours.** GHL's contacts LIST/SEARCH endpoint (`GET /contacts?locationId=…`) is eventually consistent — it trails GHL's single-record endpoint (`GET /contacts/{id}`) after a write. Measured by writing `last_call_attempt_precise` and polling all three reads side by side every 2s:
- **Single-record GET** — fresh immediately (poll #1, 0.0s).
- **List endpoint, called DIRECTLY with the PIT (Netlify bypassed entirely)** — returned the PRIOR value for ≥20s, caught up somewhere in the 20–53s window. Across earlier runs the same list lag ran to several minutes.
- **Our `ghl-contacts` Netlify function** — tracked the list endpoint value-for-value; it adds no lag and no cache of its own. Function response headers: `cache-control: no-cache`, `age` 0–1, `netlify-cdn-cache-control` / `cdn-cache-control` null, a distinct `x-nf-request-id` per hit. **Not our cache. Not fixable with a cache header** — the cache hypothesis is dead.

**Measured again on the grey rule's own path, 2026-07-15 (callback-wiring Verify #1, §9.1).** After scheduling a callback from the Dashboard Lead Queue, the Netlify `ghl-contacts` (`listAll`) path took **~105s** — 35 polls at a 3s cadence — to reflect the fresh `last_call_attempt`. That is well beyond the 20–53s of the direct-endpoint probe above, and it is the exact path the grey rule reads to key a row off `last_call_attempt`. **Stated plainly: any fixed wait shorter than ~105s would have produced a false negative** — the reload would have read the stale (pre-write) attempt and the row would have looked un-greyed, wrongly failing the test (or, in production, briefly showing a scheduled lead as not-yet-worked). This is why the grey check polls `listAll` to convergence and never fixed-waits (§9). Treat ~105s as a realistic figure for this path on a busy account, not a ceiling — earlier runs ran to several minutes.

**The sharper problem — a transient record DROP, not just staleness.** At one sample (elapsed 55.3s) the list endpoint returned the contact **absent from the results entirely** (`not-in-list`), bracketed by present-and-fresh readings at 53.0s and 87.4s. Mid-reindex, GHL's list index dropped the record, then restored it. Two ~30s stalls where the list endpoint hung before responding were also observed, consistent with reindex churn.

**Shape of it (honest bounds — do not overstate):**
- Observed **once**, in one of the probe runs, against the list endpoint called directly.
- A single 2s-cadence sample caught it; exact duration is **unknown** — bounded within a ~34s window (present 53.0s → absent 55.3s → present 87.4s), and cadence was itself disrupted by the ~30s hangs, so the drop could be anywhere from sub-second to tens of seconds.
- **Not** observed in a separate 90s / 28-sample run polling the list via the Netlify function — the contact was present in every sample there (stale value, never null). So the drop is **intermittent, a reindex-churn artifact, not a steady-state condition.**

**Blast radius — everything reading the GHL list endpoint (`listAll()`) inherits both the lag and the drop:**
- **Dashboard Lead Queue** — a contact can briefly vanish from the queue, or show a stale attempt/tier/score, mid-reindex. The in-session override masks the attempt case during active work; a cold reload does not.
- **ContactWorkspace step 1** — the reason step 1's contact read was moved to a single-record read (implemented this session via `ghl.contacts.getOne` / the new `ghl-contact` function, sharing `parseContact` with the plural `ghl-contacts`). Note history was never affected — it already uses the immediate single-contact notes GET.
- **rescore-all.ts** — most consequential: if it enumerates contacts via the list endpoint, a transiently-dropped contact is **silently skipped for that run** and goes unscored until the next pass. Data-completeness risk, not cosmetic.
- **Client-side address filtering / search** (MAO calc, Contacts) — a dropped contact won't match a search transiently → "not found" for a record that exists.

**Not fixed.** The Workspace read-path change sidesteps it for the detail view (single-record read). Lead Queue, rescore-all, and search still ride the list endpoint and remain exposed; whether to harden those is a separate decision.

**Addendum (2026-07-16, step-6 verification) — convergence timing is VARIABLE; the range is the point.** `listAll` convergence after the disposition write measured **11s (4 polls)**, versus **~105s** on the callback-grey path 2026-07-15 (§9.1). Same endpoint, order-of-magnitude spread. This is exactly why every grey/attempt check **polls to convergence and never fixed-waits**: a fixed wait tuned to 11s would false-negative the 105s case, and one tuned to 105s wastes 90s on the fast case. Treat neither number as representative — poll.

---

## 12. OBSERVED GHL CONVERSATION SHAPES (from the prod probe — `bd6906a` deployed, stripped in `1cf32d0`)

Captured by the deploy-as-probe `?debug` block that shipped in `bd6906a` and was stripped in `1cf32d0`
once the shapes were observed. **OBSERVED from prod, not inferred:**

- **`GET /conversations/search?locationId=&contactId=`** works server-side and returns a `conversationId`
  **reliably** (the function's fail-loud 502 guard for a conversation lacking an `id` never triggered on
  real data, but is kept).
- **`GET /conversations/{id}/messages`** — per-message fields observed: `direction`, `messageType`
  (STRING enum, e.g. `TYPE_EMAIL` / `TYPE_ACTIVITY_OPPORTUNITY`), `body`, `dateAdded` (ISO), `type`
  (**NUMERIC**), `source`, `conversationId`, `contentType`, `meta.email.subject`. Payload **nests as
  `messages.messages[]`** (with `nextPage` / `lastMessageId` alongside).
- **GHL wire order is DESCENDING** (newest first). `ghl-contact-conversations` re-sorts **ASCENDING**
  (oldest→newest) so a call-prep transcript reads the way the conversation happened (§7). The client does
  NOT re-sort — it renders the function's order.
- **Pagination:** `MESSAGE_CAP=500`, `limit=100` per page, `lastMessageId` cursor. The returned array is
  the **COMPLETE** transcript.
- **`TYPE_ACTIVITY_OPPORTUNITY` rows are interleaved with real messages** (pipeline-activity noise —
  "Opportunity created/updated"). They MUST be filtered for display. **Filter on the `messageType`
  STRING (`TYPE_EMAIL` allowlist), NEVER the numeric `type` field** — SMS (`TYPE_SMS`) joins the
  allowlist later. Verified live: 7 total → 4 shown → 3 filtered (§9.3).
