# IAOS — CONTACTS / OPPORTUNITIES SPEC

Status: **DRAFT — §0–3 (narrative: why / boundary / scope / navigation) + §4-v3 (write invariant) + §5 (surface design & build: layout / build order / verification) + recon log.** §5.1–5.3 drafted 2026-07-22. This is roadmap surface #4 (master ref §2a, locked sequence: Dashboard → Conversations → Calendars → **Contacts/Opportunities**). §0–3 and the write-class model are Brad-decided (2026-07-21/22) and recon-backed; the §5.3 Phase A verification floor integer is **123**.

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
- **Correction path is THREE-WAY (amended 2026-07-22 — supersedes the earlier flat rule "any identity error → create a new contact"):**
  - **(a) NEW property / address** → **create a new contact.** One contact = one property; a genuinely different property is a genuinely different record (Class 3 create, §4.5).
  - **(b) ALTERNATE phone / email** — an additional way to reach the SAME person, not a fix to the primary → **write to the `Phone 2–5` / `Email 2–4` custom fields** (the canonical reachability home — see the field-inventory recon log below), **NOT a new contact.**
  - **(c) TYPO in the PRIMARY phone / email** → **do NOT create a new contact** — that manufactures the exact duplicate the dedup model exists to prevent. The primary stays **READ-ONLY in IAOS**; the repair happens **OUTSIDE the IAOS edit surface (currently GHL).**
  - **Rationale: IAOS handles normal daily work; identity anchors are repaired elsewhere.** IAOS never edits an identity anchor; a mistyped primary is repaired **outside the IAOS edit surface (currently GHL)**, not by spawning a second record from the app.
- **No cleanup of a superseded record is needed — and only case (a) creates one.** A bad number fails to connect and washes out via call disposition; a good number that reaches the wrong person resolves through normal lead work. **Scope note:** this "washes out" path covers a **BAD LEAD** — it does **NOT** cover a **typo on a LIVE record**, which is case (c) above (repaired outside the IAOS edit surface, not washed out).

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

## 5. SURFACE DESIGN AND BUILD

### 5.1 Layout rules

Layout rules for the Contacts surface — the **`/contacts/:id` detail view** (bullets immediately below) and the **`/contacts` grid** (Grid layout subsection at the end of §5.1). **RULES ONLY — no field is assigned to a group here.** The field→group mapping (and how `Additional Info` is subdivided) lives in `docs/CONTACT_FIELD_REFERENCE.md` (Part 2 — IAOS DECISIONS), not in this spec.

- **Single long scrolling form.** The edit view is one long scrolling form on `/contacts/:id` — no tabs, no wizard, no pagination.
- **Primary sections are GHL's six custom-field folders**, rendered in the order given in `docs/CONTACT_FIELD_REFERENCE.md` (the folder table, Part 1). **Section headings use GHL's folder names verbatim.**
- **Within each folder, fields render in GHL `position` order** (the order the reference file's field table is already sorted within a `parentId`).
- **`Additional Info` (`qYS1wakeOTmfgjyeSJ8M`) is the SOLE exception to native grouping.** It holds **73 of 96** fields, so it is internally subdivided into IAOS subgroups. This is the ONLY folder where IAOS departs from GHL's native grouping, and the reason is exactly the observed **73/96** concentration. Every OTHER folder renders **flat** (no subgroups).
- **Precise companion fields are never independently editable.** `last_call_attempt_precise` and `callback_datetime_precise` have no standalone control; each is written ONLY in the same operation that writes its paired field (`last_call_attempt` / `callback_datetime`, per §4.0).
- **Each `Phone N DNC` field renders adjacent to its `Phone N` field** — the DNC flag sits with the number it qualifies. This governs **`Phone 2 DNC`–`Phone 5 DNC`**, which sit beside `Phone 2`–`Phone 5` in the **Reachability** subgroup. **`Phone 1 DNC` is the exception:** there is no `Phone 1` custom field (the primary phone is a native identity field, not among the 96), and — because **line 156 governs the primary phone's placement** (§4-v3 Class 2 / §4.3 governs its treatment, not its render position) — `Phone 1 DNC` renders **in the identity block, adjacent to the native primary phone (NOT in the Reachability subgroup)**. The intent of the rule is that **no phone number renders without its DNC status.**
- **Native identity fields render FIRST — the identity block is the top section of the form, above all six folder sections.** Primary phone, primary email, and the address block are NOT custom fields and are NOT among the 96. **Render POSITION is fixed here (this supersedes the earlier "not restated here" for render order ONLY):** the identity block renders at the very top of the `/contacts/:id` form, ahead of IAOS Onboarding and every other folder; `Phone 1 DNC` sits within it, adjacent to the native primary phone (per the DNC rule above). Their **treatment** — read-only in edit, dedup anchors — remains governed by §4-v3 Class 2 (§4.3); only render position is stated here.

#### Grid layout (V1) — the `/contacts` list view

**Philosophy (record first):** the Contacts grid answers **"Who is this contact?"**; the Dashboard answers **"Who should I work next?"** The Dashboard Lead Queue is an operational **calling** workspace; the Contacts grid is a **contact-management** workspace, and it **intentionally uses different columns, search, and sorting** — it is NOT the Lead Queue re-skinned.

- **Columns (V1):** Name · Phone · Email · Property Address · Date Added.
- **Sort (V1 — client-side, clickable headers on Name and Date Added ONLY).** Applied to the already-loaded dataset entirely client-side; **`gridRows()` and the netlify function are unchanged** (parallel to Search).
  - **Order of operations:** the active sort produces the ordered spine (`ordered`); Search filters over that spine (`filtered`) and **preserves its order — search narrows, never reorders.** Changing the sort reorders the full list and the current query re-narrows the newly-sorted result. (OBSERVED-consistent with `4c0db07`, where `filtered` already filters over `ordered` order-preservingly.)
  - **Sortable columns: Name and Date Added ONLY.** Phone / Email / Property Address headers are not clickable and carry no sort affordance.
  - **Toggle — TWO-state (asc ⇄ desc) per active column.** Clicking the active header flips its direction; clicking a different sortable header makes THAT column active at its initial direction. **No third "return-to-default" state** — default is recoverable by clicking Date Added → descending, and a hidden third click that jumps columns is unintuitive.
  - **Initial direction when a column becomes active:** Name → **ascending** (A→Z first); Date Added → **descending** (newest first). The first click on each header does the conventionally-expected thing.
  - **Initial grid state:** Date Added, descending — **unchanged from `4c0db07`**; the default before any header click.
  - **Name comparison:** `localeCompare` (default locale). Names are OBSERVED lowercased, so case is moot; localeCompare sorts accented characters adjacent to their base letter (`josé` near `jose`, not after `z`) and orders punctuation per default collation — chosen over raw code-unit `<`/`>`, which pushes accents past `z`.
  - **Date Added comparison:** lexicographic compare of the ISO strings = chronological (OBSERVED, existing `ordered` comment). A **null/absent `dateAdded` sorts LAST in BOTH directions** — a missing date never floats to the top of an ascending sort.
  - **Active-sort indicator:** a chevron in the active column's header — up = ascending, down = descending (`ChevronUp`/`ChevronDown`); inactive sortable headers show a muted `ChevronsUpDown`; non-sortable headers show nothing.
  - **Single active column** — no multi-column sort, no persistence across navigation; resets to Date-Added-desc on remount.
- **Search (V1 — client-side):** a **single input** over **Name / Phone / Email**. V1 performs client-side substring filtering over the already-loaded `ContactRow` dataset. Search is case-insensitive substring matching across Name, Phone, and Email only; Property Address is excluded, matching GHL's own query behavior. Results preserve the active sort order (default: Date Added, newest first) — search narrows the list, never reorders it. No fuzzy matching, no relevance ranking. This is a V1 implementation decision and does not preclude server-side search in a later version; the trigger for revisiting it is an OBSERVED load-time or memory problem at scale, not an assumed one. A future move to server-side search would carry GHL's list-endpoint reindex lag and transient-drop behavior into the search path and must be specified separately.
  - **Phone normalization (V1 — specified behavior, TWO-BRANCH):** if the trimmed query contains ONLY digits, it is matched as a SUBSTRING against the row's phone after removing all non-digit characters (so a digits-only query like `2149146151` matches the stored E.164 `+12149146151`) — Name and Email are NOT included in this digits-only path. Any query containing a non-digit character uses raw case-insensitive substring matching across Name, Phone, and Email. No country-code normalization, no partial-format matching, no fuzzy matching.
  - **Address exclusion is OBSERVED, not assumed** (2026-07-22): four `query` legs via `ghl-proxy` against bradt75 — `Thompson` / `bradt75@gmail.com` / `2149146151` each returned **HTTP 200, count 1, target present**; `Greenway` (a real token of its `property_address` "2623 Greenway Dr") returned **HTTP 200, count 0, target absent**. GHL's contact-search `query` matches name/email/phone but NOT the property-address custom field; V1's client-side filter mirrors that exclusion.
- **Filters: NONE in V1.**
- **No inline editing** (§2.1); a row **selects → opens `/contacts/:id`** via the already-shipped grid→detail link (§3 / Contact Workspace §8 step 2b) — no new navigation.
- **Display casing (V1) — names render AS RETURNED, not title-cased.** `listAll()` returns first/last names **lowercased** (OBSERVED — the existing lowercase-names finding). Phase A **preserves the returned casing** rather than mechanically title-casing, because naive title-case **mangles real names** (`McCormack` → "Mccormack"; `de la Cruz` → "De La Cruz"). Logged as a **known cosmetic limitation** until a trustworthy casing source is chosen (an un-lowercased name field on the wire, or a proper casing library).
- **Phone display formatting (V1) — DISPLAY ONLY, Phone column `render` only.** `ContactGridRow.phone` retains its **raw stored E.164 value**; formatting happens **only** inside the Phone column's `render`, nowhere else — not in `parseContact`, `cfString`, `gridRows()`, the `ghl-contacts` function, or the `filtered` memo. **Format rule:** a raw value matching `+1` followed by **exactly 10 digits** renders as `214-914-6151` (area-prefix-line, hyphen-separated, country code dropped). **Anything else — different length, non-US, malformed, or empty — renders AS-IS, unchanged; never blanked, truncated, or guessed** (an empty value falls through to the existing `—` placeholder, as today). **Search is unaffected — this is the invariant:** the `filtered` memo matches the **raw stored value** on BOTH branches (digits-only → `r.phone.replace(/\D/g,"")` against the raw value; any non-digit → case-insensitive substring against the raw value), exactly as verified at `4c0db07`. Display formatting is a pure render-time transform that never mutates the value search reads. Same class as the casing decision — a render concern, not a data change. **Consequence (ACCEPTED for V1):** a query typed in the DISPLAYED form (e.g. `214-914-6151`) will **NOT** match — the filter compares against the raw stored value, and the query's non-digit characters route it to the substring branch against `+12149146151`. Digits-only queries (`2149146151`, `6151`) match as verified. This divergence between what is shown and what is searchable is accepted for V1 and recorded here so it is not rediscovered as a bug.
  - **OBSERVED (2026-07-23, 42 rows via `ghl-contacts`):** **41** match `+1`+10 digits (format path); **1** empty (fallback → existing `—`); **0** non-empty non-US/malformed — so the **non-empty fallback branch ships untested**, logged alongside the null-`dateAdded` sort gap.

**Explicitly EXCLUDED from V1 (with reason, per this decision):**
- **Lead Source** — **0 of 41 populated** (OBSERVED: list count = 0, corroborated by a single-record truncation check on 3 contacts, incl. **two with 39 populated fields each** — genuinely empty, not a list-truncation artifact). Becomes a column **when the data exists**.
- **Tier** — **NOT a field.** Derived from the `hot`/`warm`/`low` bucket tags via `getBucketTag`, **defaulting to `"low"`** when absent — so *every* contact has one. A "Tier filter" would just be a **tag filter relabeled**; out for V1.
- **Combined Score, Last Call Attempt, callback fields** — **prioritization / calling behavior**, which lives on the **Dashboard**. Available as **later sorts, not V1 columns**.

**Implementation — `app/src/pages/Contacts.tsx` BECOMES the §5.1 V1 grid (DECIDED 2026-07-23).** The existing routed `/contacts` page is **rebuilt into this grid** — NOT a new unreferenced component, and NOT an accidental regression. It is the deliberate expression of the **three-surface model** (**Dashboard = prioritization · Conversations = working the lead · Contacts = record management**): the old Contacts page carried Dashboard-style scoring/analysis that belongs on the Dashboard, so it is removed here on purpose.

- **Planned removals (intentional):**
  - the **Combined / Motivation / Deal score columns** — removed.
  - **score sorting** — removed (V1 sorts only **Name** + **Date Added**, per the Sort rule above).
  - the **Analyze → `/mao-calculator` link** — removed from Contacts (analysis is a Dashboard/calculator concern, not the record-management grid).
- **Preserved:**
  - **Name → `/contacts/:id`** (the Contact Workspace) — the row's navigation target is unchanged.
  - **all five inbound `/contacts` entry points** continue to land on this page: `Sidebar.tsx:18`, `Header.tsx:5`, `ContactWorkspace.tsx` 293/304/314, `Dashboard.tsx:813` (line numbers OBSERVED 2026-07-23 — re-verify before edit, code moves).

**Verification (floor 123):** §5.3 allots the grid **5** assertions — grid renders, search behaves, filter behaves, sort behaves, and phone display formats (the Phone column renders a known `+1`+10-digit fixture as `214-914-6151`). V1 has no filters, so the **"filter" assertion asserts that NO filter control renders** (an absence check, parallel to the no-input-element assertion) — it flips to a positive filter-behaves check when filters land; the filter decision itself does not move the floor. The phone-format check is the single increment that raised the floor from 122 to 123 (added 2026-07-23, after phone formatting shipped at `419ab12`/`c502f90`).

### 5.2 Build order

Two **separate build phases with separate verification** — NOT one phase with conditional gates (reason at the end of this section).

**Phase A — read-only.**

- Ships: the grid (list / search / filter / sort) and the `/contacts/:id` detail **display** of all 96 custom fields plus the native identity fields.
- **No writes; no fixture proofs required.** Ships on its own bundle gate (§9.2).
- **Edit affordances are ABSENT in Phase A, not disabled** — render read-only text, no input elements. A greyed-out input the reader cannot distinguish from a wired one that failed is not an acceptable intermediate state.

**Phase B — edit affordances, unlocked per field.**

- Each **Class 1** field (§4.4) becomes writable ONLY after its own inert-proof passes on the `bradt75` fixture.
- **Class 2** identity fields (§4.3) stay **read-only in the edit view regardless of proof**.
- **Class 3** create (§4.5) is its own sub-phase with its own proof.
- The **§4.1 HARD NO** fields — the seven `offer_` fields (GHL folder "Offer") — **never become editable**.

**Why two build phases, not one phase with conditional gates:** Phase A's harness contains **no GHL write**, so its assertion floor is a **fixed count of read assertions**. Mixing write proofs into Phase A would make that floor **shift as proofs land** — so Phase A and Phase B are separate build phases with separate verification, each with a stable floor.

### 5.3 Verification

- **Each phase has its own harness with its own self-check floor.** The floor is the **exact count of `check()` calls on the happy path**, and it is **written into this spec BEFORE the harness exists** — never derived from a run. A floor set after observing a run passes partial runs as clean.
- **Phase A floor — read assertions only.** It covers: the grid renders; search / filter / sort behave (**V1 has no filters, so the "filter" assertion asserts ABSENCE of any filter control** — a positive filter-behaves check when filters land; §5.1 Grid layout); the Phone column formats a known `+1`+10-digit fixture as `214-914-6151` (DISPLAY-only, raw value unaffected — §5.1 phone display); the detail view renders all **96** custom fields in **folder-then-subgroup-then-`position`** order for `Additional Info` (its four subgroups in the order Reachability, Property, Investor, System, each internally by GHL `position` — NOT raw `position` across all 73) and **folder-then-`position`** order for every other folder; the **native identity fields render — primary phone, primary email, `address1`, `city`, `state`, `postalCode` — as SIX separate assertions** (the address block is asserted **field-by-field, NOT as one block**, because a partial address render is still a defect); the **four `Additional Info` subgroups** render; **`Phone 2 DNC`–`Phone 5 DNC` render adjacent to their `Phone N` in the Reachability subgroup, and `Phone 1 DNC` renders adjacent to the native primary phone in the identity block**; and **no input element exists anywhere on the detail view**. **Each of the 96 field assertions checks three things in ONE `check()`: (1) PRESENCE; (2) CORRECT SECTION — its folder, and for `Additional Info` its subgroup; and (3) RELATIVE ORDER within that section — NOT an absolute index. `Phone 1 DNC` asserts as: in the identity block, adjacent to the native primary phone.** Cross-section ordering is NOT a per-field absolute ordinal — it moves into checks already counted in the floor: **the 6 folder-section checks and the 4 `Additional Info` subgroup checks now assert each section's RENDERED POSITION IN SEQUENCE, not merely its presence.** **RATIONALE (this reverses the a4208a2 "GLOBAL index 1..96" definition):** absolute ordinals carry no business meaning, and they make a harmless section reorder look like ~95 regressions; relative-within-section order plus section-sequence checks localize a real defect to its section without that false-positive blast radius. That relative-order change did not move the floor — same check counts, richer assertions. The floor moved 122 → 123 separately, on 2026-07-23, when the phone-format display check was added.
- **Phase A verification runs against the LIVE deploy** at `app.investorautomationos.com`, **never localhost**, and passes the **§9.2 bundle gate**: the parent hash must **discriminate** from the current commit hash to confirm a new deploy is actually live.
- **Layout is verified at Brad's WIDE viewport, not only at 1280px.** DOM checks at 1280 have passed when the rendered result was wrong at ~2560px.
- **Phase B adds one write assertion per field** as its inert-proof passes; the Phase B floor **increments with each unlocked field and is restated at each increment**.

**Phase A floor integer — 123.** Enumerated as `check()` calls on the happy path: grid + search + filter + sort + phone-format (5) + six folder sections (6) + the 96 custom fields (96) + four `Additional Info` subgroups (4) + six native identity fields — primary phone, primary email, `address1`, `city`, `state`, `postalCode` (6) + five `Phone N DNC` adjacencies — `Phone 2 DNC`–`Phone 5 DNC` beside their `Phone N` in Reachability (4) and `Phone 1 DNC` beside the native primary phone **in the identity block** (1), five total (5) + no-input-element (1) = **123**. The **phone-format** check asserts a known `+1`+10-digit fixture row renders in the Phone column as `214-914-6151` (DISPLAY-only; raw value unaffected — §5.1 phone display); it is the single increment over the original 122, added 2026-07-23 after phone formatting shipped (`419ab12`/`c502f90`) but still BEFORE the harness is coded — never back-filled from a passing run.

**Unexercised branches (not defects, not pending work):** the null-`dateAdded` sort branch and the non-empty malformed-phone display fallback are NOT live-coverable under the current Phase A production-only harness constraints. OBSERVED 2026-07-23 against 42 live rows: 42/42 have `dateAdded` (GHL stamps it at creation) and 0 rows are non-empty non-US/malformed. A passing 123/123 run therefore does NOT mean these branches were exercised. Synthetic fixtures, a test location, or a later local/mock harness could cover them; none exists today.

---

_Narrative §0–3 (per Brad) and §5 (surface design & build: layout / build order / verification) drafted 2026-07-22; the §5.3 Phase A verification floor integer is 123 (raised from 122 on 2026-07-23 by the phone-format display check)._

---

## RECON FINDINGS — Opportunities read path (OBSERVED on the wire 2026-07-21)

Append-only recon log. Separate from the section outline above (§0–3 drafted; §5+ undrafted); this records wire facts as they are established. Fixture: bradt75 (`bradt75@gmail.com`, contact id `9fbH2VCcZvzVNhsR9zjc`).

- **Contact→opportunities read — RESOLVED.** `GET /opportunities/search?location_id={loc}&contact_id={id}` → **HTTP 200**, returns exactly that contact's opportunities, **server-side filtered** (`meta.total: 1` for bradt75, opp `4zCenJMlSlrwPF5UUQRv`). This is the path to use. No client-side filtering needed.
  - **BOTH params are snake_case: `location_id` and `contact_id`.** camelCase `contactId` / `locationId` → **HTTP 422**. **This is the root cause of the prior recorded 422 — wrong param CASE, NOT a missing endpoint.** `/opportunities/search` was always the right endpoint.
- **`GET /contacts/{id}/opportunities` → HTTP 404 (dead).** No such nested endpoint (`Cannot GET ...` / Not Found). Do not use.
- **Opportunity object carries a contact back-reference three ways** (from `GET /opportunities/search?location_id={loc}` with no contact filter, 41 opps, HTTP 200): top-level **`contactId`** (string), nested **`contact`** object (`id`/`name`/`email`/`phone`/`tags`/`score`), and **`relations[]`** (`OPPORTUNITIES_CONTACTS_ASSOCIATION`, `recordId` = contact id). Client-side filter on `contactId` is a **viable fallback**, but the server-side `contact_id` filter (above) is **preferred** — no over-fetch, paginated.
- **INFERRED, NOT OBSERVED — single-contact multi-opportunity PAGINATION is untested.** bradt75 has exactly **1** opportunity, so `meta.nextPageUrl` / `startAfter` + `startAfterId` were *seen in the response shape* but never *exercised* across a page boundary for one contact. Confirm pagination against a multi-opp contact before relying on it.
- **GENERAL GOTCHA — `/opportunities/search` params are snake_case** (`location_id`, `contact_id`), unlike the contacts endpoints which take `locationId` (camelCase). Mixing the convention → 422. Watch this when reusing query-building code across the two endpoints.

### Field inventory — Contacts edit surface (OBSERVED on the wire 2026-07-22)

Two reads: `GET /locations/jmHG4B8RdzwpfqruNf68/customFields` (HTTP 200) and a full single-record `GET /contacts/9fbH2VCcZvzVNhsR9zjc` (bradt75, HTTP 200). **No field is classified safe/dangerous here — that is the per-field inert-proof's job (§4.2/§4.4), not inferable from names.**

**Canonical enumerated inventory:** the full 96-row field list (name/id/fieldKey/dataType/position/parentId/standard) lives in `docs/CONTACT_FIELD_REFERENCE.md` (Part 1 — OBSERVED, regenerable from the wire). The breakdown below is a summary; that file is the source of truth for the enumeration.

- **CUSTOM fields — 96 definitions, ALL `model: contact`.** ZERO opportunity-scoped custom fields in this location → **no §2.4 opportunities/custom-field overlap to police.** The full enumerated list is in `docs/CONTACT_FIELD_REFERENCE.md`; dataType breakdown by count:
  - **TEXT 45** — Phone Type, Mailing Address/City/State/Zip/County/Care-of-Name, Phone 2–5 + Phone 1–5 DNC, Email 2–4, Property Address/Type/Status/Notes, APN, County, Owner Occupied, condition fields (Interior/Exterior/Bathroom/Kitchen/Total), Owner 2 First/Last, Business Website, MLS Status, Litigator, Foreclosure Factor, Wholesaling Market, SMS Sender Name, Do Not Mail, Sending Domain, Booking Calendar Link, `last_call_attempt_precise`, `callback_datetime_precise`, Marketing Lists
  - **NUMERICAL 25** — the `offer_*` set (Offer ARV/MAO/Margin/Price/Repair Total/Wholesale Fee), scores (Motivation/Combined/Deal/Data Completeness), Est. Value/Equity/LTV/Remaining Loan Balance, Bedrooms, Total Bathrooms, Building/Lot Sqft, Total Assessed Value, MLS Amount, Last Sale Amount, Hold Months, Effective Year Built, Total Open Loans, Lien Amount
  - **MONETORY 5** — Loan Amount, Asking Price, Carrying Cost, Estimated Repairs, ARV
  - **DATE 7** — Last Sale Date, MLS Date, Callback Datetime, Last Call Attempt, Follow Up Date, Offer Date, Date Added to List
  - **SINGLE_OPTIONS 5** — Has Sending Domain, Has Booking Calendar, Existing GHL Account, Has Existing Leads, MAO Viability Flag
  - **MULTIPLE_OPTIONS 4** — Lead Source, Timeline to Sell, Occupancy Status, Motivation Level
  - **LARGE_TEXT 2** — Onboarding Notes, Repair Line Items
  - **FLOAT 1** — Interest Rate · **PHONE 1** — Business Phone · **FILE_UPLOAD 1** — Upload Your Lead CSV
- **NATIVE fields — 26 top-level keys present on the bradt75 record**, with types:
  - `id` (string, immutable), `dateAdded`/`dateUpdated` (ISO string, system), `locationId` (string, system), `type` (string `lead`)
  - `firstName`/`lastName` (string); `firstNameLowerCase`/`lastNameLowerCase`/`fullNameLowerCase` (string, **derived/system** — the lowercase-names finding); `email`+`emailLowerCase` (string); `phone` (string `+12149146151`); `phoneLabel` (string `Mobile`); `country` (string `US`)
  - `timezone` (string), `source` (string), `assignedTo` (string, user id)
  - `tags` (array of string — **HARD NO §4.1**), `followers` (array, empty)
  - `additionalEmails` (array, empty), `additionalPhones` (array, empty)
  - `attributionSource` / `lastAttributionSource` / `createdBy` (object, system-populated tracking)
  - `customFields` (array of `{id, value}` — nested carrier for the custom values above; 3 populated on bradt75)
- **CAVEAT 1 — the contact GET returns only POPULATED native keys.** bradt75 has no address set, so `address1` / `city` / `state` / `postalCode` (the §4.3 address-identity block) are **ABSENT from this record**. Absence = **empty-on-this-record, NOT absent-from-schema.** The full native address set must be confirmed against a contact that HAS an address, or against the create-contact schema, before the read/edit view relies on those keys.
- **CAVEAT 2 — `contact.customFields` is a nested `{id, value}` array** carrying only that contact's populated custom values (3 on bradt75). The 96 `customFields` definitions are the **superset**; a contact surfaces only the ones it has values for.
- **CAVEAT 3 — `additionalEmails`/`additionalPhones` element shape STILL unobservable** (both `[]` on bradt75, consistent with the §4.3 record). AND reachability data ALSO lives in separate custom TEXT fields (`Phone 2–5`, `Email 2–4`) distinct from these native arrays — **two different homes for the same kind of data; an unresolved design question for §5** (which home the edit surface writes, and how the two reconcile).
- **CAVEAT 4 — recon used Jeff's `pit-b2e9…` token, NOT prod's `…d0f7`.** Both reads returned HTTP 200; scopes (Custom Fields, Contacts) sufficient for READ. This is a read-recon, **not a prod-credential test.** **RESOLVED (OBSERVED 2026-07-22 via `ghl-proxy` under prod `…d0f7`):** the prod token and pit-b2e9 return an **identical 96-field set with identical dataType distribution** — the token-divergence caveat is resolved.
- **PROVISIONAL DIRECTION (2026-07-22) — reachability home decided (provisionally).** The two-homes question from CAVEAT 3 gets a working answer: **the custom fields `Phone 2–5` / `Email 2–4` are the CANONICAL home for alternate reachability data**, because the **PropStream import already populates them** — the data already lives there. The native `additionalPhones` / `additionalEmails` arrays stay **READ-ONLY and unused** until collision behavior, element shape, and workflow usage are verified on the wire. **DO NOT mirror values into both homes** (one source of truth, no drift). **UNVERIFIED:** whether GHL workflows read the custom fields or the native arrays is **NOT confirmable from the repo** — workflow config lives in GHL (per §4.6, trigger/read config is not API-derivable). Resolve on the wire before relying on either as the workflow-visible home.
