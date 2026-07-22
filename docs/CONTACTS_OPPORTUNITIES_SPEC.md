# IAOS — CONTACTS / OPPORTUNITIES SPEC

Status: **DRAFT — §0–3 (narrative: why / boundary / scope / navigation) + §4-v3 (write invariant) + recon log.** §5+ still undrafted. This is roadmap surface #4 (master ref §2a, locked sequence: Dashboard → Conversations → Calendars → **Contacts/Opportunities**). §0–3 and the write-class model are Brad-decided (2026-07-21/22) and recon-backed; §5+ is TBD.

**This phase covers Contacts only. Opportunities are deliberately out of scope and will be specified separately** (§2.4).

Sits alongside `IAOS_Master_Architecture_Reference_V10_2.txt`, `DASHBOARD_SPEC_v2.txt`, `CONTACT_WORKSPACE_SPEC_v2.md`, `CONVERSATIONS_SPEC.md`, `CALENDARS_SPEC.md`.

---

## 0. WHY THIS SURFACE EXISTS

Contacts is the record-**management** surface. Where Conversations is where the investor *works the lead* — texting, calling, emailing, taking notes, setting callbacks — Contacts is where they *manage the record*.

Outlook model: **Inbox = daily work; Contacts = address book.** Conversations is the inbox (where you go to do today's work); Contacts is the address book (where you go to correct a record, look someone up, or add a new person). Two different jobs, two different surfaces.

**Contact Workspace is TRANSITIONAL.** Its working-the-lead features — notes, callback, conversation history, the Call action — belong to Conversations and migrate there over time. Do NOT build any part of this surface assuming Workspace is permanent or that its feature set is the target shape. (See §3 for the shared-route consequence during the transition.)

---

## 1. SCOPE BOUNDARY (LOCKED)

- **Conversations = working the lead.**
- **Contacts = managing the record.**

This boundary is locked. This surface does **NOT** extend Contact Workspace conceptually — it is not "Workspace v2." Contacts and Workspace share a route during the transition only (§3); that shared route is a migration artifact, not a merge of the two surfaces. A reader must not conclude the surfaces combined.

---

## 2. SCOPE

### 2.1 In scope

- **Contact detail record editing** at `/contacts/:id` — native fields, custom fields, property info. Editing happens ONLY on the detail view.
- **Contacts grid** — list / search / filter / sort; choose which contact to open. **NO inline editing in the grid** — the grid selects a record; editing is on the detail view only.
- **Create New Contact** — Class 3 (§4.5), gated on its own inert-proof.

### 2.2 Display-only (NOT editable)

- **Score and Tier** are computed **system outputs, not contact data.** They are never editable — a manual edit would weaken the scoring model and be overwritten on the next rescore. The detail view MAY surface the contributing factors behind a Score/Tier; the values themselves stay read-only display.

### 2.3 Read-only in edit (per §4.3, unchanged)

- **Primary email, primary phone, and the address block (`address1` / `city` / `state` / `postalCode`)** are read-only in edit. This restates the §4.3 rule for the read view — it is not re-decided here.
- **Correction path — if an identity field is wrong, CREATE A NEW CONTACT.** Do not edit the identity field to fix it.
- **No cleanup process for the superseded record is needed.** A bad number fails to connect and washes out via call disposition; a good number that reaches the wrong person resolves through normal lead work. The superseded record needs no explicit archive/delete step.

### 2.4 Out of scope

- **Opportunities** — deliberately out of scope; **this phase covers Contacts only. Opportunities will be specified separately.** The **RECON FINDINGS — Opportunities read path** log at the bottom of this file is retained as **FUTURE REFERENCE ONLY** — it is not an in-scope feature of this phase.
- **Tags, pipeline stage, `offer_` fields** — HARD NO, unchanged (§4.1).

### 2.5 Recorded, not scoped (GHL-side config, not IAOS code)

- **Bad-number call disposition → route the opportunity to Lost / Not Interested via a GHL WORKFLOW.** When a call disposition marks a number bad, the opportunity should route to Lost/Not Interested. This is **GHL-side workflow config, not IAOS code** — it extends the already-proven disposition webhook path (`CONTACT_WORKSPACE_SPEC` §5.6). Recorded here so it is not lost; it is NOT a build item for this surface.

---

## 3. NAVIGATION

- **Contacts owns `/contacts/:id`** as the record-management (detail) view.
- **During the transition, that same route ALSO hosts the existing Contact Workspace working-the-lead features** (notes, callback, conversation history, Call) until they migrate to Conversations (§0). Stated explicitly so a reader does NOT conclude the two surfaces merged — they cohabit one route temporarily; that is all.
- **Do NOT create a temporary second detail route.** The transition is handled on the one `/contacts/:id` route, not by standing up a parallel Workspace URL.
- The **grid → detail link already shipped** (Contact Workspace §8 step 2b) — Contacts reuses it; no new grid→detail navigation is built here.

---

## 4. WRITE INVARIANT (v3 — field-edit write classes)

This surface is the first that EDITS contact fields. That is a materially larger write surface than every prior phase, all of which wrote only the three sanctioned actions (notes, `last_call_attempt`, callback). v3 does NOT loosen those three — it carries them forward unchanged and layers a classified field-edit model on top, gated per class.

### 4.0 Carried forward UNCHANGED — the three-write invariant (Workspace §4)

The Dashboard/Workspace three sanctioned write actions are untouched by this surface:

1. `ghl.notes.create()` → POST `/contacts/{id}/notes`
2. `ghl.contacts.setLastCallAttempt()` → PUT `last_call_attempt` (+`_precise`) in ONE call
3. `ghl.contacts.setCallbackDatetime()` → PUT `callback_datetime` (+`_precise`) in ONE call

**No-drift invariant holds:** GHL is sole system of record. No app-side shadow copy. Every value displayed is read from GHL.

### 4.1 HARD NO — unchanged from Workspace §4

**Tags, pipeline stage, `offer_` fields, workflow triggers.** IAOS never fires a workflow. This is unchanged from `CONTACT_WORKSPACE_SPEC_v2.md` §4 and is NOT relaxed by any write class below. Editing a contact field is not a licence to touch a tag, move a stage, or set an offer field.

### 4.2 Why classification, not a blanket field-edit toggle

Editing a native/custom contact field can have side effects IAOS does not control:

- **Identity fields anchor dedup/merge.** The location deduplicates on them (§4.3, OBSERVED).
- **A field change can fire a GHL workflow.** Whether it does is **NOT API-derivable** (see the verbatim finding in §4.6). We cannot enumerate which field changes trigger a workflow, so we cannot pre-classify a field as inert from the API alone.

Consequence: **no field is writable on assumption.** Each writable field earns write access by a per-field **inert-proof** on the fixture (edit the field on `bradt75@gmail.com` / `214-914-6151`, the clean no-DnD fixture per `SESSION_HANDOFF.md`, and confirm no tag/stage/offer/workflow side effect resulted). Recon is the input to classification; the inert-proof is what unlocks a write.

### 4.3 CLASS 2 — IDENTITY fields

**`contact.email` (primary) and `contact.phone` (primary) are READ-ONLY in edit.**

- **OBSERVED** (`GET /locations/jmHG4B8RdzwpfqruNf68`, 2026-07-21): `settings.contactUniqueIdentifiers = ["email", "phone"]` and `allowDuplicateContact: false` — dedup is ON and keyed on the primary email + primary phone. These are the identity/dedup anchors; editing them risks a merge/collision. Read-only in edit is the safe floor.
- Object paths (OBSERVED, `GET /contacts/{id}`): primary = scalar `contact.email` / `contact.phone`.

**The address block is READ-ONLY in edit — but on a DISTINCT justification (business-identity, NOT dedup).**

- Scope: the address-identity set = `address1`, `city`, `state`, `postalCode` ONLY. **`country` is EXCLUDED** — US is implied and is not part of the address-identity set.
- **Justification is a BUSINESS RULE, not a technical dedup constraint.** One contact = one property = one address; editing the address on an existing contact corrupts the one-contact-one-property keying. That is the reason it is read-only in edit — and it is DIFFERENT from the email/phone reason.
- **Address is NOT a GHL dedup key** — it is NOT in `contactUniqueIdentifiers` (`["email","phone"]`, OBSERVED above), so editing it would NOT trigger a GHL merge/collision. The read-only rule here is OURS (business), not GHL's (dedup). Do not conflate the two justifications.
- Treatment mirrors email/phone: **READ-ONLY in edit, READ/WRITE only at create** (a new property = a new contact; the address-identity set is set at creation — §4.5).

**`contact.additionalEmails` and `contact.additionalPhones` are READ/WRITE — but flagged PROVISIONAL.**

- Rationale: additional emails/phones are reachability data, not identity.
- **PROVISIONAL, pending a fixture collision-test.** Whether the additional-value arrays sit INSIDE or OUTSIDE the dedup set is **UNKNOWN via API** — `contactUniqueIdentifiers` names only `email`/`phone` (primary field names) and does not enumerate additional-field participation; no duplicate-settings endpoint exists (`/locations/{id}/settings`, `/duplicate-settings`, `/duplicates/settings`, `/settings/duplicates` all 404). Read/write on additionals ships ONLY after a fixture collision-test PROVES additionals are outside the dedup set. Until then, treat as read-only.
- **Element shape UNKNOWN, resolve at build.** OBSERVED that `additionalEmails` / `additionalPhones` exist as top-level array fields, but ALL 41 contacts in the location have them empty (`[]`) — so whether each element is a bare string or an object (value + label/type) is not observable from location data. Resolve against the wire at build time before writing them.

### 4.4 CLASS 1 — FIELD-EDIT (non-identity native + custom fields)

**Writable ONLY after a per-field inert-proof on the `bradt75` fixture.**

- Covers non-identity native contact fields and custom fields.
- No field is writable on assumption (§4.2). Because workflow triggers are not API-enumerable (§4.6), each field must be individually proven inert on the fixture — edit it, confirm no tag/stage/offer/workflow side effect — before it is exposed as editable.
- HARD NO (§4.1) still bounds this class: even a "field edit" must never touch a tag, stage, or `offer_` field.

### 4.5 CLASS 3 — CREATE NEW CONTACT

**A new `ghl.contacts.create()` POST. Ships only after its own inert-proof.**

- On create, identity fields (`email`, `phone`, and the address-identity set `address1`/`city`/`state`/`postalCode`) ARE read/write — they are being set for the first time (a new property = a new contact), not edited on an existing dedup/business-identity anchor, so the Class 2 read-only rule does not apply at creation.
- Create is a distinct write action from the three in §4.0 and from Class 1 edits. It ships only after its own inert-proof (create the fixture contact, confirm no unexpected workflow/tag/stage side effect on creation — note the Phone Type Validation workflow already fires on Contact Created, `CONTACT_WORKSPACE_SPEC §5.6`, so "inert" here means no side effect BEYOND the known, accepted ones).

**Opportunity creation model (design note, Brad 2026-07-21):** opportunities are created **only via GHL workflow** — IAOS does not create opportunities (consistent with the workflow HARD NO, §4.1). **One opportunity per contact is the intended state.** This is a design intent, not a GHL-enforced limit; it is also why the multi-opportunity-per-contact pagination case is off the happy path (flagged INFERRED-not-exercised in the recon-findings log below).

### 4.6 Workflow-trigger classification is NOT API-derivable (carried verbatim, OBSERVED 2026-07-21)

> GHL v2 API exposes workflow inventory (GET /workflows/?locationId) but NOT trigger config; /workflows/{id} and /workflows/{id}/triggers both 404. SAFE/DANGEROUS classification is not API-derivable.

Consequence for this surface: we cannot build a trigger table that says "editing field X fires workflow Y." The per-field inert-proof (§4.2/§4.4) is the substitute — it observes the effect of an edit directly on the fixture rather than predicting it from an un-enumerable trigger config. Do NOT infer triggers from workflow names.

---

## RECON FINDINGS — Opportunities read path (OBSERVED on the wire 2026-07-21)

Append-only recon log. Separate from the section outline above (§0–3 drafted; §5+ undrafted); this records wire facts as they are established. Fixture: bradt75 (`bradt75@gmail.com`, contact id `9fbH2VCcZvzVNhsR9zjc`).

- **Contact→opportunities read — RESOLVED.** `GET /opportunities/search?location_id={loc}&contact_id={id}` → **HTTP 200**, returns exactly that contact's opportunities, **server-side filtered** (`meta.total: 1` for bradt75, opp `4zCenJMlSlrwPF5UUQRv`). This is the path to use. No client-side filtering needed.
  - **BOTH params are snake_case: `location_id` and `contact_id`.** camelCase `contactId` / `locationId` → **HTTP 422**. **This is the root cause of the prior recorded 422 — wrong param CASE, NOT a missing endpoint.** `/opportunities/search` was always the right endpoint.
- **`GET /contacts/{id}/opportunities` → HTTP 404 (dead).** No such nested endpoint (`Cannot GET ...` / Not Found). Do not use.
- **Opportunity object carries a contact back-reference three ways** (from `GET /opportunities/search?location_id={loc}` with no contact filter, 41 opps, HTTP 200): top-level **`contactId`** (string), nested **`contact`** object (`id`/`name`/`email`/`phone`/`tags`/`score`), and **`relations[]`** (`OPPORTUNITIES_CONTACTS_ASSOCIATION`, `recordId` = contact id). Client-side filter on `contactId` is a **viable fallback**, but the server-side `contact_id` filter (above) is **preferred** — no over-fetch, paginated.
- **INFERRED, NOT OBSERVED — single-contact multi-opportunity PAGINATION is untested.** bradt75 has exactly **1** opportunity, so `meta.nextPageUrl` / `startAfter` + `startAfterId` were *seen in the response shape* but never *exercised* across a page boundary for one contact. Confirm pagination against a multi-opp contact before relying on it.
- **GENERAL GOTCHA — `/opportunities/search` params are snake_case** (`location_id`, `contact_id`), unlike the contacts endpoints which take `locationId` (camelCase). Mixing the convention → 422. Watch this when reusing query-building code across the two endpoints.

---

_Narrative §0–3 drafted 2026-07-22 (per Brad); §5+ intentionally not drafted yet._
