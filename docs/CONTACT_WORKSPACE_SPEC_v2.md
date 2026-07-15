# IAOS — CONTACT WORKSPACE SPEC v2

Status: §5 verified live 2026-07-15. §7 revised. Ready for Brad's sign-off, then build.
Supersedes CONTACT_WORKSPACE_SPEC_v1.md. Sits alongside `IAOS_Master_Architecture_Reference_V10_2.txt` and `DASHBOARD_SPEC_v2.txt`.

**Changes from v1:**
- §5 open questions all answered by live test (contact ID, auth, idempotency) — see §5.1
- §5 new constraint discovered: the Custom Disposition prompt is transient and unrecoverable — see §5.2
- §5 redesigned: Path A only — Path B (call-end backstop) rejected, silence is not a signal — see §5.4
- §6 grey rule restated as four explicit cases: a note greys, a call never greys (a disposition greys only because it writes a note) — see §6
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
3. `ghl.contacts.setCallbackDatetime()` → PUT, carries `callback_datetime` (`JeQWtwpwUbvPA5OUfuPU`) + `callback_datetime_precise` (`7qRUkZQK8bi2HNo7zDHd`) in ONE call

**HARD NO, unchanged:** tags, pipeline stage, `offer_` fields, workflow triggers. IAOS never fires a workflow.

**Note remains the only thing that marks an attempt.** The Call button does not set attempt or grey a row. Callback scheduling DOES now write a note and mark the attempt (locked this session — see §6).

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

**Accepted consequence (Brad, 2026-07-15):** a call dispositioned outside that window produces no webhook — so IAOS writes no note and greys nothing. The lead resurfaces as never-attempted and gets re-dialed. This is accepted deliberately. The remedy is the **manual note**: if Brad wants that attempt on record, he types one, which greys the row like any other note. IAOS does not infer an outcome from silence — a missed disposition is not a signal (see §5.4, Path B rejected).

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
3. Note-save fires the existing `setLastCallAttempt` path -> row greys (via the note, like any other note).

**Path B — call-end backstop with no disposition — REJECTED.** v1 proposed writing `Call — {duration}s, no disposition` from the call-end event whenever nothing was tapped, as a backstop for §5.2's gap. Rejected deliberately:

> **IAOS writes a note only when Brad explicitly signals an outcome. The absence of a disposition is not a signal.** Inferring one would put an unauthored note on a seller's permanent record — the record that matters most — on the strength of silence. A missed disposition is handled by §5.2's accepted consequence (the lead re-dials) and the manual-note remedy, not by machine inference.

Consequences of dropping Path B:
- The **call-end-event / `conversations.readonly` prerequisite verification is removed** — nothing depends on it anymore.
- The **reconciliation / dedupe logic is removed** — with one path there is nothing to reconcile.
- The grey rule stays clean (§6): a disposition writes a note and greys through the note; a call with no disposition writes nothing and does not grey.

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

**The grey rule, as Brad's four cases (2026-07-15):**

```
no call + note                          = grey
no call + no note                       = no grey
call + disposition (writes a note)      = grey  (via the note, as always)
call + no disposition (no note)         = no grey
```

**Unifying principle, unchanged: a note greys; a call never greys.** There is no "a call greys" rule and none is needed. A disposition (Path A, §5.4) writes a note automatically, so it greys *through the note*, like anything else. A call with no disposition writes no note (Path B rejected, §5.4) and does not grey. The Call button itself — which only proves you opened a tab — has never greyed and still doesn't.

**Callback scheduling greys — change from Dashboard v2 (LOCKED, Brad 2026-07-14):** scheduling a callback **writes a note** (`Callback scheduled for {Mon D, h:mm A}`) and marks the attempt, so it greys — consistent with the rule above, because it is a note. Fires the existing note → attempt → grey path; no new write action; applies on both Dashboard and Workspace. Reverses the prior "callback never greys" rule deliberately.

**Grey triggers, exhaustive:** a typed note, a scheduled callback, a tapped disposition. All three are notes. Nothing else greys — including in Waiting on Me.

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
3. **Callback** — popover + write. Reuse Dashboard's component. Include the note+grey change (§6).
4. **Call button** — tab-hop to GHL. Trivial; same as Dashboard.
5. **Conversation history** — read-only render from the existing conversations read path.
6. **Disposition capture** — new Netlify function + GHL workflow, per §5.4 (Path A only). §5 open questions are closed; no prerequisites remain (the Path B call-end verification was dropped with Path B).
7. **Dashboard name-click** → deep-link to `/contacts/:id`.

Steps 1–5 are all on proven paths. **Step 6 is no longer a new mechanism** — GHL → IAOS webhook receive already runs in production (§5.6). Steps 1–2 can start immediately; they touch none of §5.

**Deferred until the Workspace is live:** Lead Queue column reorder, Call button removal from Dashboard rows (#3/#4/#5/#10a from Brad's original list).

---

## 9. VERIFICATION

Per established pattern:
- Verify live at `app.investorautomationos.com`, never localhost
- Bundle hash grep before/after each deploy
- Write audit after any write-path change: confirm still exactly 3 write actions
- Any write test scoped to a single contact by explicit ID (never `.first()` or a queue index)
- Test contact: Neelima Bale `FiIT0hUaxVCIuokQpZuc`
- Poll for round-trips; never fixed-timeout waits (GHL read-propagation lag is real)
- Reload retests must use a real `page.reload()` — in-session override masks bugs
- Verify at a wide viewport (~2560px) matching Brad's actual screen, not the 1280px default

---

## 10. OPEN DECISIONS FOR BRAD

**Closed since v1:**
1. ~~§5 — confirm Path A~~ → confirmed and verified live (§5.1). Path A only; Path B rejected (§5.4).
2. ~~§7 layout shape~~ → revised to two-column (§7).
3. ~~Note copy~~ → locked (§6.1).
4. ~~`offer_` fields in the Workspace~~ → **omit entirely.** Read-only offer data on a work surface invites "why can't I edit this," and the answer is an invariant you'd defend every time you look at the screen. The Workspace is a calling surface.
5. ~~Contacts list: Analyze button / score columns~~ → **keep as-is.** The grid's value is comparison across leads; the detail view's is depth on one. Folding Analyze in means analyzing one at a time — worse at the job the grid exists to do. Different surfaces, different jobs.
6. ~~Grey rule / a completed call greying a row~~ → **resolved (Brad, 2026-07-15).** A note greys; a call never greys. Path A produces a note automatically, so nothing about the grey rule changes — no separate "a completed call greys" decision exists. Four cases locked in §6.
7. ~~Path B backstop~~ → **rejected (§5.4).** IAOS writes a note only on an explicit outcome; silence is not a signal. The call-end-event verification prerequisite is therefore gone.

**Open — needs Brad:**
- (none — the §6.1 grey decision is closed above; the §5.4 Path B prerequisite is gone.)

**Open — housekeeping, not blockers:**
- §5.6 item 3 — does `/api/phone-lookup` write `Phone Type` back to the contact? If so, the three-write invariant has an undocumented exception in production and needs scoping language.
- §5.6 item 1 — `/api/phone-lookup` is unauthenticated.
- Test contact Brad Thompson (`9fbH2VCcZvzVNhsR9zjc`) carries `phone-validated-unknown` and sits in the live Lead Queue. Strip the tag.
- Test workflow `9d1d5cc9-86de-47f7-93b8-f39dc2e4c971` is published and pointed at a webhook.site URL that expires 7 days from 2026-07-15. Unpublish.
- Test contact Neelima Bale (`FiIT0hUaxVCIuokQpZuc`) accumulated several labeled `[Claude Code — …]` verification notes and a live `last_call_attempt` during the §11 probes. Harmless (permanent notes on the established test contact) but present; clear if a clean slate is wanted.

---

## 11. READ RELIABILITY FINDING — GHL LIST ENDPOINT IS EVENTUALLY CONSISTENT AND TRANSIENTLY DROPS RECORDS (2026-07-15)

Found while locating the source of a stale-attempt-on-reload symptom in the Workspace (§8 step 1). Read-only probes, no fix applied. Documented for shape.

**The lag is GHL's, not ours.** GHL's contacts LIST/SEARCH endpoint (`GET /contacts?locationId=…`) is eventually consistent — it trails GHL's single-record endpoint (`GET /contacts/{id}`) after a write. Measured by writing `last_call_attempt_precise` and polling all three reads side by side every 2s:
- **Single-record GET** — fresh immediately (poll #1, 0.0s).
- **List endpoint, called DIRECTLY with the PIT (Netlify bypassed entirely)** — returned the PRIOR value for ≥20s, caught up somewhere in the 20–53s window. Across earlier runs the same list lag ran to several minutes.
- **Our `ghl-contacts` Netlify function** — tracked the list endpoint value-for-value; it adds no lag and no cache of its own. Function response headers: `cache-control: no-cache`, `age` 0–1, `netlify-cdn-cache-control` / `cdn-cache-control` null, a distinct `x-nf-request-id` per hit. **Not our cache. Not fixable with a cache header** — the cache hypothesis is dead.

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
