# Contacts Detail Spec — Phase A

## 1. Purpose

Add the Phase A read-only contact-detail renderer to the existing /contacts/:id route while preserving every existing ContactWorkspace capability.

## 2. Scope

IN: read-only render of the 96 GHL custom fields across six folders, the Additional Info subgroup layer, and contact-level DND display.

OUT: all editability, all writes, any parallel detail route, Phase B, Enter-to-Save, additionalPhones rendering.

/contacts/:id is owned by ContactWorkspace. This spec ADDS to that route. A parallel detail route is forbidden.

## 3. Preserve list

Every capability below exists today and must still work after every slice. Behavior descriptions are normative. Component names are navigational.

Navigation / states
- Back link "Contacts" to /contacts
- Error state "Failed to load contact" + message + Back link
- Not-found state "Contact not found" + id + Back link
- Loading placeholders for name, phone, address

Identity header (read-only)
- Contact name, first+last, or "Unknown"
- Phone
- Address, address1 + city/state/postalCode, or "-"
- Tier badge hot/warm/low from getBucketTag
- Combined score chip
- Motivation score chip
- Deal score chip

Actions
- Call button, opens ghlContactDetailUrl(id) in a new tab, writes nothing
- Schedule Callback / Reschedule Callback toggle, label depends on whether a callback exists
- Callback-time display "Callback: {time}" when set

CallbackPopover
- datetime-local input, 30-minute step, defaults to the next :00 or :30
- Save, via scheduleCallbackGated, writes setCallbackDatetime + note + setLastCallAttempt
- Clear, shown only when a callback exists, calls setCallbackDatetime(id, null)
- Cancel, closes the popover
- Popover error line

Notes (left column)
- Notes heading + last-attempt status
- New-note text input, AUTOSAVE ON BLUR; any text counts as an attempt and creates a note + setLastCallAttempt
- Save-error line
- Notes error, loading, and empty states
- Note history list, newest-first, formatted date + body

Conversation History (right column)
- Heading
- Error, loading, and empty states
- Read-only transcript bubbles, Sent/Received + channel + date. The TYPE_EMAIL-only filter formerly recorded here is SUPERSEDED by D5.

The blur-autosave note behavior is PRESERVED AS-IS in Phase A and is not a defect to fix in this phase. The TYPE_EMAIL-only filter was preserved on the same basis until 2026-08-11 and is now superseded by D5.

## 4. Decisions of record

D1 — IDENTITY BLOCK: reuse the existing ContactWorkspace identity header. Do not build a second identity block. The Phase A identity requirements are satisfied by the existing render.

D2 — PHONE FORMAT: the detail view formats phone to match the Contacts grid. The identity header changes from raw to formatted.

D3 — FAILURE SCOPE: "never partial render" scopes to the 96-field custom-field section ONLY, not to the route. On render-config failure that section shows an explicit error state and renders no fields. Everything in section 3 continues to work, because none of it depends on render-config.

D4 — DND: display contact-level per-channel DND from dndSettings. Render only when the key is present. Absence means no DND and is NOT an error. Per-phone DNC does not exist in GHL's model and is not built.

D5 — CONVERSATION PARITY (supersedes the §3 TYPE_EMAIL-only preservation, 2026-08-11). The Workspace transcript renders TYPE_EMAIL and TYPE_SMS. An SMS sent to a seller is fetched by ghl-contact-conversations and returned in the response today; it is dropped at render, so the surface contacts are worked from cannot show the message that was just sent. Conversations.tsx has allowed both types since it shipped and renders SMS correctly.

Email bodies collapse to five rendered lines within the existing Workspace bubble width. Collapse uses the same -webkit-line-clamp mechanism and the same overflow detection as Conversations — measured scrollHeight > clientHeight while clamped, so the Expand control appears only when the body actually truncates. It does NOT adopt Conversations' full-width email layout. The Workspace keeps its 85% max-width, direction-aligned bubble; the line count matches, the visible content does not, and that difference is accepted. Changing Workspace email width is out of scope and would contradict the preserve list.

SMS never collapses, matching Conversations. SMS inherits the Workspace's existing direction alignment — outbound right, inbound left — with no new alignment code, because the Workspace already aligns every bubble by direction rather than by type. The channel label already renders the message type, so an SMS self-identifies once it enters the allowlist. No icon change: the Workspace uses direction arrows, not Conversations' per-type icons.

Expansion state is per message and resets when the route contact id changes. Bubbles are already keyed by message id with a conversationId+dateAdded fallback, and the contact-change effect already clears conversations state, so the reset follows from the existing structure rather than from new code — but it is a stated requirement, not an incidental property, and must be verified rather than assumed.

IMPLEMENTATION CONSEQUENCE, not a new abstraction: the bubble is currently inline JSX inside a .map() callback, where React hooks cannot legally be called. Per-bubble state and the overflow effect therefore require extracting a small component local to ContactWorkspace.tsx. This is a mechanical consequence of adding state to a repeated element. It does NOT create a shared cross-surface component — CONVERSATIONS_SPEC section 7 holds that a shared MessageBubble is extracted only when a third consumer appears, and there are still two.

WATCH, DO NOT PRE-SOLVE: CONVERSATIONS_SPEC section 8.7 established that GHL emits internal workflow notifications to Brad as genuine TYPE_SMS objects, which messageType cannot discriminate from real seller messages. On Conversations these sit in a dedicated Text section; in the Workspace's single chronological list they will interleave with seller email. Ship parity, observe the result on real contacts, then decide whether a second filter is warranted. Do not add one preemptively.

## 5. Render-config source

LIVE from GHL at runtime: field set, parentId, position, definitions, types.
CHECKED-IN IAOS config: the Additional Info subgroup mapping ONLY.
The harness's static 96-ID list is VERIFICATION-ONLY and is never imported by runtime.
Folder and field metadata are not duplicated in code.
Runtime asserts no field count. Only the harness pins 96.

## 6. Failure contract

"Malformed" is a SHAPE condition: non-200, unparseable, or missing parentId/position. It is NOT a count.

On malformed: the custom-field section renders an explicit error state. Never a partial render. Never a fallback to the static list. Per D3, the rest of the page is unaffected.

## 7. OBSERVED from the wire

Line references in this section are dated observations, not living contracts.

2026-07-23, GET /locations/jmHG4B8RdzwpfqruNf68/customFields, HTTP 200
- 96 fields; parentId 96/96; position 96/96
- No key encodes subgroup membership. All 73 Additional Info fields share parentId qYS1wakeOTmfgjyeSJ8M
- Subgroup partition: Reachability 22, Property 30, Investor 14, System 7 = 73; 73 distinct fieldKeys; 0 duplicated; 0 unassigned
- Offer folder YslJ5oke73JrBOgaq0np, 7 fields
- getDetail (ghl.ts:343 as of 2026-07-23) returns SPARSE customFields. The join is superset x populated values.

2026-07-24, GET /contacts/9fbH2VCcZvzVNhsR9zjc via deployed ghl-proxy, HTTP 200
- 26 top-level keys: id, dateAdded, type, locationId, lastName, lastNameLowerCase, email, emailLowerCase, phone, phoneLabel, country, attributionSource, createdBy, timezone, source, additionalPhones, tags, followers, assignedTo, fullNameLowerCase, firstName, firstNameLowerCase, lastAttributionSource, dateUpdated, customFields, additionalEmails
- No key matching /dnd|dnc|donotdisturb/i. ABSENT, not false.

2026-07-24, GET /contacts/05gYdxJcyNTCKWTwkbbs via deployed ghl-proxy
- dndSettings = {"SMS":{"status":"permanent","message":"STOP_KEYWORD"},"RCS":{"status":"permanent","message":"STOP_KEYWORD"}}
- additionalPhones = []
- additionalEmails = []
- phoneLabel = undefined

CONCLUSION: dndSettings is a CONDITIONAL key, present only when DND is set, keyed by channel at contact level.

## 8. UNKNOWN / not live-coverable

- additionalPhones populated shape. [] on both fixtures. Not rendered in Phase A.
- phoneLabel semantics. undefined on the DND fixture. Not rendered in Phase A.
- null-dateAdded sort branch and non-empty malformed-phone fallback. OBSERVED 42/42 have dateAdded, 0 malformed, 1 empty. A passing 123/123 does not exercise these.

## 9. Slice boundaries

### 9.1 S2
Data shaping + reuse of the existing identity header + D2 phone format + D4 DND display + ONE folder + the section 6 failure contract. Live-verified at ~2560px. Must leave the app shippable: no empty headers or placeholders implying unrendered folders exist.

### 9.2 S3
Remaining five folders + the checked-in Additional Info subgroup mapping, 73 fields across four subgroups.

### 9.3 Harness
Single 123-check run at app/scripts/verify-contacts.cjs, authored once, after the detail view is live. Not split.

### 9.4 Development rule

No abstraction ships without its first consumer.
