# IAOS — Session Handoff (2026-07-17; last refreshed 2026-07-29)

**Repo tip (updated 2026-07-29): `6f79044` on `main`, pushed; prod app bundle `index-Dg2_4V9j.js` — §9.2 verified live, harness EXPECTED pinned to match, floor 127 passing.** **Historical note below is as of 2026-07-23 and is NOT current state.** (bundle **moved `B76Jox53` → `B2TRJzB0`** with `1512c64`'s runtime code (`gridRows`). The intervening `644398c` was a **type-only** `ContactRow` interface field plus a `contact-parse.ts` FUNCTION change, so the CLIENT bundle stayed `B76Jox53` and that deploy was verified at the FUNCTION level — the `propertyAddress` KEY on the parsed `ghl-contacts` row — NOT by a hash change. App-code commits on this surface so far: `1d9769a` / `644398c` / `1512c64`; docs-only commits still Cancel both sites.). The Conversations navy-header **banner** is built out through **§8.10**: the selected contact's name renders LARGE (22px) indented under the Notes column, in one card with the Workspace / Reply-in-GHL / **Call** action links. **§8.10 Call button VERIFIED LIVE 24/24** (`CONVERSATIONS_SPEC.md` §6.9; harness floor now **24**, bundle `Bg9d3CqX`). Call + Reply BOTH tab-hop to the GHL contact-detail page (reused `ghlContactDetailUrl`, no new URL); there is **no in-app dialer — GHL exposes none** (recon 2026-07-21, OBSERVED: the softphone is an in-UI click, not a deep-link). Still **READ-ONLY — zero writes**, three-write invariant untouched. Banner history: §8.9 name-in-banner (§6.7) → name indent (§6.8) → §8.10 Call (§6.9). **Next roadmap surface: Contacts/Opportunities** (master ref §2a; full create/edit/manage depth).

**Read first, in the repo (I have NOT paraphrased their contents here — read them directly):**
`docs/IAOS_Master_Architecture_Reference_V10_2.txt` (master ref, internally v10.3), `docs/DASHBOARD_SPEC_v2.txt`, `docs/CONTACT_WORKSPACE_SPEC_v2.md`, `docs/CONVERSATIONS_SPEC.md`, `docs/CALENDARS_SPEC.md`, `docs/CONTACTS_OPPORTUNITIES_SPEC.md` (surface #4 — §0–3 + §4-v3 + **§5 (surface design & build) DRAFTED** + recon-findings log; the §5.3 Phase A floor integer is **123** (Phase A = grid + detail per §5.2; raised 122→123 at `e6109f0`); the enumerated field inventory lives in the companion **`docs/CONTACT_FIELD_REFERENCE.md`**; see the surface-#4 block below). The master ref §2a is the locked Coverage Roadmap: **Dashboard → Conversations → Calendars → Contacts/Opportunities** (order is locked; a Contact Workspace surface was built between Dashboard and Conversations as *build history*, not a roadmap re-sequence).

**Where things stand:** surfaces **#1 Dashboard, #2 Conversations (read-only), #3 Calendars (read-only)** are DONE + verified live. Contact Workspace §8 steps 1–7 also done (workspace spec §9.3–9.5). **Surface #4 Contacts/Opportunities is STARTED — spec only, no code (see the surface-#4 block below).** The read-only phases shipped; the WRITE phases (Conversations send/compose + unread management, Calendars booking/reschedule + availability) are separately-scoped later steps, not built.

## Surface #4 — Contacts/Opportunities (STARTED 2026-07-21; spec only, NO code)
`docs/CONTACTS_OPPORTUNITIES_SPEC.md` now holds **§0–3 (narrative)** (`c6ae880`) + **§4-v3 write invariant** (`cc06568`) + **§5 (surface design & build: layout / build order / verification)** (`963cc7f`) + the recon-findings log — **§5 DRAFTED; §5.3 Phase A floor integer set at 122.** The enumerated 96-field inventory, folder table, and Additional Info subgroup mapping live in the companion **`docs/CONTACT_FIELD_REFERENCE.md`** (see below). This is the first surface that EDITS contact fields — a materially larger write surface than every prior (read-only or three-write) phase.

- **§4-v3 write classes (Brad-decided 2026-07-21, recon-backed):**
  - **Class 1 — field-edit** (non-identity native + custom fields): writable ONLY after a per-field **inert-proof** on the `bradt75` fixture.
  - **Class 2 — identity:** primary `contact.email` + `contact.phone` **READ-ONLY in edit** (they are the dedup anchors). `additionalEmails` / `additionalPhones` **READ/WRITE but PROVISIONAL**.
  - **Class 3 — create new contact:** new `contacts.create` POST; identity fields read/write at creation; ships after its own inert-proof.
  - **HARD NO, unchanged from Workspace §4:** tags, pipeline stage, `offer_` fields, workflow triggers.
- **Recon LOCKED (OBSERVED on the wire 2026-07-21):**
  - **Dedup keyed on primary email + phone** — `GET /locations/jmHG4B8RdzwpfqruNf68` → `settings.contactUniqueIdentifiers = ["email","phone"]`, `allowDuplicateContact: false`. OBSERVED.
  - **Additionals READ/WRITE is PROVISIONAL — pending a fixture collision-test.** Whether `additionalEmails`/`additionalPhones` sit inside or outside the dedup set is **UNKNOWN via API** (`contactUniqueIdentifiers` names only the primary fields; no duplicate-settings endpoint — `/locations/{id}/settings`, `/duplicate-settings`, `/duplicates/settings`, `/settings/duplicates` all 404). Treat as read-only until a collision-test proves additionals are outside the dedup set.
  - **Additional-array element shape UNKNOWN** — the fields exist as top-level arrays but ALL 41 contacts in the location have them empty (`[]`), so bare-string vs. object (value + label) is not observable; resolve at build.
  - **Workflow trigger config is NOT API-derivable** — GHL v2 API exposes workflow inventory (`GET /workflows/?locationId`) but NOT trigger config; `/workflows/{id}` and `/workflows/{id}/triggers` both 404. SAFE/DANGEROUS classification is not API-derivable; do NOT infer triggers from workflow names. The per-field inert-proof is the substitute.
- **Fixture proofs NOT started** — the per-field inert-proofs (Class 1), the additionals collision-test (Class 2), the create inert-proof (Class 3), and the element-shape resolution are all gated to build time; **none have been run.**
- **Read-path RESOLVED (OBSERVED 2026-07-21, `29f925b`):** the contact→opportunities read is `GET /opportunities/search?location_id={loc}&contact_id={id}` — **BOTH params snake_case** (`location_id`, `contact_id`). The earlier HTTP 422 root cause was **camelCase** (`locationId`/`contactId`); snake_case succeeds. `/contacts/{id}/opportunities` is **404 dead** (do not use). Single-contact multi-opportunity **pagination is INFERRED, not exercised** — the one-per-contact intended state (see below) means no multi-opp contact has been tested against the read.
- **Address on identity (Class 2, Brad-decided 2026-07-21, `127a049`):** contact address is Class 2 identity — **READ-ONLY in edit, READ/WRITE at create.** Scope = `address1` / `city` / `state` / `postalCode` (**`country` EXCLUDED**). The business-identity rule (address anchors who the contact is) is an IAOS design rule, **NOT a GHL dedup key** — GHL dedup remains primary email + phone only (`contactUniqueIdentifiers = ["email","phone"]`).
- **Creation-model note (`127a049`):** opportunities are created **only via GHL workflow** — **IAOS does NOT create opportunities.** One-opportunity-per-contact is the **intended state (IAOS design intent), NOT GHL-enforced** (GHL permits multiple). The read path must tolerate >1 even though the model expects 1.
- **§0–3 narrative DRAFTED (`c6ae880`):**
  - **Contacts is the record-MANAGEMENT surface; Conversations is where the lead is WORKED** (§1 boundary LOCKED). Outlook model: Conversations = inbox/daily work, Contacts = address book. This surface does NOT extend Contact Workspace conceptually.
  - **Contact Workspace is TRANSITIONAL** — its working-the-lead features (notes, callback, conversation history, Call) migrate to Conversations over time; do NOT build assuming Workspace is permanent.
  - **In scope:** contact detail record editing at `/contacts/:id` (native + custom + property fields); Contacts grid = list/search/filter/sort with **NO inline editing** (grid selects, detail view edits); Create New Contact (Class 3, own inert-proof).
  - **Score/Tier are DISPLAY-ONLY** — computed system outputs, never editable (a manual edit weakens the model and is overwritten on rescore); may show contributing factors only.
  - **Identity fields READ-ONLY in edit (per §4.3); correction path is THREE-WAY** (§2.3 amended `328c828`, supersedes the flat c6ae880 "any identity error → create a new contact"): **(a)** NEW property/address → **create a new contact**; **(b)** ALTERNATE phone/email → **write to `Phone 2–5` / `Email 2–4` custom fields, NOT a new contact**; **(c)** TYPO in PRIMARY phone/email → **do NOT create a new contact** (manufactures the exact duplicate the dedup model prevents) — primary stays **READ-ONLY in IAOS**, repair happens **OUTSIDE the IAOS edit surface (currently GHL)**. Rationale: IAOS handles normal daily work; identity anchors are repaired elsewhere. The "bad number washes out via call disposition" note still holds for a **BAD LEAD** but does **NOT** cover a **typo on a LIVE record** (case (c)).
  - **Opportunities DELIBERATELY OUT OF SCOPE** — Contacts only; opportunities specified separately. The recon read-path log is retained as **FUTURE REFERENCE ONLY**, not an in-scope feature. Also out: tags, pipeline stage, `offer_` (HARD NO §4.1).
  - **Navigation:** Contacts owns `/contacts/:id`; during transition it **cohabits that one route** with the existing Workspace working-the-lead features (no second detail route). Grid→detail link already shipped (Workspace §8 step 2b).
  - **Recorded, not scoped:** bad-number disposition → route opportunity to Lost/Not Interested via a GHL WORKFLOW (GHL-side config, not IAOS code; extends the proven disposition webhook, Workspace §5.6).
- **FIELD INVENTORY (`328c828`, recon 2026-07-22):** **96 contact-scoped custom fields** (model=contact), **ZERO opportunity-scoped** (no §2.4 overlap to police); **26 native top-level keys** on bradt75. Four caveats: (1) contact GET returns only **POPULATED** native keys → **absence ≠ absent-from-schema** (the `address1`/`city`/`state`/`postalCode` block is absent on bradt75 because unset; confirm the full native address set against a contact that HAS an address or the create schema); (2) `contact.customFields` is a nested `{id,value}` array carrying only that contact's values — the 96 defs are the **superset**; (3) `additionalEmails`/`additionalPhones` element shape **STILL unobservable** (both `[]`); (4) recon used Jeff's `pit-b2e9…` token, not prod's `…d0f7` — **read-recon, not a prod-credential test.**
- **REACHABILITY HOME (`328c828`, PROVISIONAL):** `Phone 2–5` / `Email 2–4` custom fields are the **canonical home** for alternate reachability data, because the **PropStream import already populates them**. Native `additionalPhones` / `additionalEmails` remain **read-only and unused** pending collision, element-shape, and workflow-usage verification. **DO NOT mirror into both homes** — single source of truth prevents data divergence. **UNVERIFIED** whether GHL workflows read the custom fields or the native arrays (workflow config lives in GHL, per §4.6).
- **§5 DRAFTED — SURFACE DESIGN AND BUILD (`963cc7f`, 2026-07-22).** §5.1 layout / §5.2 build order / §5.3 verification. **Layout:** single long scrolling form on `/contacts/:id`; primary sections = GHL's **six custom-field folders** in reference-file order, folder names verbatim; within a folder, fields in GHL `position` order. **`Additional Info` (73/96) is the SOLE folder IAOS subdivides** — into **Reachability / Property / Investor / System** (justified by the 73/96 concentration); every other folder renders flat. Precise companions (`last_call_attempt_precise`, `callback_datetime_precise`) never independently editable; `Phone 2 DNC`–`Phone 5 DNC` sit beside `Phone 2`–`Phone 5` in the Reachability subgroup, and `Phone 1 DNC` renders in the identity block adjacent to the native primary phone (NOT in Reachability). **Build:** two SEPARATE phases with separate verification — **Phase A read-only** (grid + display all 96 + native identity; no writes/proofs; affordances ABSENT not disabled) then **Phase B per-field edit unlock** (Class 1 after its own bradt75 inert-proof; Class 2 identity read-only regardless; Class 3 create own sub-phase; §4.1 `offer_` HARD NO never editable). Reason for two phases: Phase A's harness has no write → fixed read-assertion floor; mixing write proofs would shift it.
- **NEW FILE — `docs/CONTACT_FIELD_REFERENCE.md` (canonical enumerated field inventory).** **Part 1 — OBSERVED** (regenerable from the wire): the full 96-row field table (name/id/fieldKey/dataType/position/parentId/standard) + the six-folder table. **Part 2 — IAOS DECISIONS (living):** the `offer_` HARD NO set, the Additional Info 73/96 skew, and the **73-field → four-subgroup mapping** (Reachability 22 / Property 30 / Investor 14 / System 7). The §5 field→group mapping lives HERE, not in the spec.
- **WIRE FINDINGS (prod proxy, 2026-07-22):** the prod token (`…d0f7`) is reachable **ONLY through the deployed `ghl-proxy` function**, not locally (both local `.env` files hold `pit-b2e9`). **Prod and pit-b2e9 return an IDENTICAL 96-field set → CAVEAT 4 (token divergence) RESOLVED.** **GHL has NO collection endpoint for custom-field folders** (`/customFields/folder` 400, `/customFields/folders` 400, `?model=folder` 422), but **`/customFields/{id}` resolves a folder id** (returns `documentType: folder`). **Six folders named:** IAOS Onboarding (11) · Contact (1) · Form\|IAOS Client Intake Form (1) · **Offer (7 = §4.1 HARD NO)** · General Info (3) · **Additional Info (73)**.
- **§5 RENDER DECISIONS locked this session (`a4208a2`, before Phase A coding):** **(1) Identity block renders FIRST** — the native identity block (primary phone, primary email, `address1`/`city`/`state`/`postalCode`) is the top section, above all six folder sections (**§5.1 line 156 governs render POSITION; §4.3 governs treatment only**). **(2) Field assertion model (REVISED — reverses the original a4208a2 "global index 1..96" definition):** each of the 96 field checks asserts **presence + correct SECTION (its folder, and its subgroup for `Additional Info`) + RELATIVE ORDER within that section** — NOT an absolute index; cross-section ordering is asserted by the already-counted 6 folder-section + 4 subgroup checks (rendered position in sequence). **(3) `Phone 1 DNC` data/render split** — DATA subgroup stays **Reachability** (partition **22 / 30 / 14 / 7 = 73 unchanged**), but it **RENDERS in the identity block adjacent to the native primary phone**; it is the ONE field whose data subgroup and render location diverge (annotated in `CONTACT_FIELD_REFERENCE.md` Part 2). **Floor stays 122** (assertion count unchanged).
- **PHASE A STEP 1 (read layer) DONE (`1d9769a`) — first code on this surface.** Added **`ghl.contacts.getDetail(id)`** + typed **`ContactDetail`** / **`ContactDetailField`** in `app/src/lib/ghl.ts` — full single-contact read (native identity + custom-field values), **READ-ONLY**, via the existing proxy `GET /contacts/{id}`. **UNREFERENCED by any component** (no grid, no detail view, no harness yet). Live-verified: prod bundle `B76Jox53`, `getDetail` present in the served JS. **OBSERVED (wire):** GHL returns only **POPULATED** custom fields — **3 of 96** on bradt75 — so `getDetail.customFields` is **SPARSE**; the **all-96 superset (definitions + order + folders + subgroups)** is a **separate render-config layer** (from `CONTACT_FIELD_REFERENCE.md`) that the detail view will **join against** these sparse values to render all 96. **That render-config layer is NOT yet built** (its source — checked-in-from-reference-file vs live `customFields` fetch — still to decide).
- **CONTACTS GRID V1 DECIDED (`7d9043e`, §5.1 Grid layout).** **Philosophy:** the Contacts grid answers **"who is this contact?"** (contact-management workspace); the Dashboard answers **"who should I work next?"** (calling workspace) — intentionally different columns/search/sort, NOT the Lead Queue re-skinned. **Columns:** Name · Phone · Email · Property Address · Date Added. **Sort:** clickable **Name** + **Date Added**, default **Date Added newest-first**. **Search:** single input over **name / email / phone**, GHL contact-search passthrough (list `query` param); **address EXCLUDED** (API doesn't match it). **Filters: NONE in V1** (the §5.3 grid "filter" assertion asserts absence-of-filter-control; floor stays **122**). **Excluded, with reason:** **Lead Source** (**0/41 populated**, truncation-verified — becomes a column when data exists); **Tier** (tags-derived via `getBucketTag`, defaults `"low"` → a Tier filter is just a relabeled tag filter); **Combined Score / Last Call Attempt / callback fields** (Dashboard prioritization — later sorts, not V1 columns).
- **OBSERVED (2026-07-22, wire-confirmed) — GHL contact-search `query` passthrough matches name / email / phone, NOT address.** Four legs via `ghl-proxy` against bradt75 (`9fbH2VCcZvzVNhsR9zjc`): `query=Thompson` (last name), `=bradt75@gmail.com`, `=2149146151` each → **HTTP 200, count 1, target present**; `query=Greenway` (a real token of its `property_address` "2623 Greenway Dr") → **HTTP 200, count 0, target absent**. So name/email/phone are searchable via `query`; the property-address custom field is NOT — confirms the §5.1 Grid V1 search decision (address excluded).
- **OBSERVED to carry — the `/contacts` list endpoint returned a TRANSIENT EMPTY BODY once this session, succeeded on retry** (same `limit=100` call: empty body → re-run returned full data). Not a page-size cap and not a pagination requirement — a transient blank; the grid read should tolerate/retry an empty list response.
- **OPEN QUESTION (3) CLOSED (wire, 2026-07-22) — the `/contacts` list does NOT truncate a row's `customFields`.** On a rich contact (`8i6D4muM9oLvWi7lOvNm`): LIST length **== SINGLE length == 39**. And `property_address` (`tG4gGFI8JB2VjWeuqYMx`) travels **BY VALUE** in bradt75's LIST row (`"2623 Greenway Dr"`, identical to the single GET). **Caveat: ONE 39-field contact observed — not proven across all rows.** Consequence: surfacing a populated custom field from the list is a reliable, **zero-extra-fetch** source.
- **`property_address` now surfaces as `ContactRow.propertyAddress` (`644398c`), zero extra fetches.** Extended `contact-parse.ts` (the shared list + single parser) with a `cfString` helper + the `propertyAddress` field; `""` when absent. **Verification nuance:** the `ghl.ts` half was a **type-only** `ContactRow` interface field (erased at compile → CLIENT bundle stayed `B76Jox53`); the runtime change lives in the `contact-parse.ts` **function**, so the deploy was confirmed at the **FUNCTION level** — the `propertyAddress` KEY present on the parsed `ghl-contacts` row (bradt75 = `"2623 Greenway Dr"`), NOT via a bundle-hash change.
- **`ghl.contacts.gridRows()` V1 projection SHIPPED (`1512c64`).** Read-only projection of `listAll()` to the five §5.1 columns (`name` / `phone` / `email` / `propertyAddress` / `dateAdded`) + a **NON-VISIBLE `id`** (row → `/contacts/:id` link + React key; not a sixth column, floor still 122). One retry on the list transient, then **surfaces** the failure — never a silent empty array. **UNREFERENCED by any component.** Real runtime code → CLIENT bundle moved **`B76Jox53` → `B2TRJzB0`** (served-hash-verified).
- **NEXT WORK (updated 2026-07-23) — Contacts detail view code slice.** Phase A step 2 grid UI (search / clickable Name+Date Added sort / phone-format display) is **SHIPPED + verified live** (manual live verification at Brad's wide viewport — NO harness exists; the §5.3 harness has never been run); §5.3 floor is now **123**; Phase A is **PARTIALLY BUILT** — the `/contacts/:id` detail view (render-config join + all 96 fields) is **NOT built** (`/contacts/:id` currently renders `ContactWorkspace`, `App.tsx:24`). The §5.3 harness is authored ONCE at 123 **after** the detail view ships — not before, not split. Full state in the 2026-07-23 session block below. Fixture proofs (Class 1/2/3, element-shape) remain **NOT started** — Phase B. NOTE: every "floor 122" / "floor stays 122" earlier in this surface-#4 block is HISTORICAL (true at that commit); the current Phase A floor is 123.

## 2026-07-23 — Contacts grid slices + §5.3 floor 122→123 + §7a

**Repo state:** HEAD `87754a5`; live bundle `BKZ_cWof`; §9.2 verified live at `c502f90`. Eleven commits this session, `7b5f6b8`→`87754a5`, **7 docs / 4 code** (from `git log`, authoritative — not recall):
- `7b5f6b8` docs — master-ref §7a text-input convention + undo-send open item
- `af6af1f` docs — master-ref §7 Contacts clause → §5.1 V1 grid
- `06d9226` docs — §5.1 client-side search + two-branch phone spec
- `4c0db07` **code** — Contacts client-side search ✅ verified live
- `732aea9` docs — §5.1 sort amendment + search-clause reword
- `90124f5` **code** — clickable sort (Name/Date Added) + §7 clause ✅ verified live
- `630ea34` docs — §5.1 phone display render-only spec
- `419ab12` **code** — phone-format display (`214-914-6151`, raw preserved) ✅ verified live
- `c502f90` **code** — drop monospace from phone column ✅ verified live (bundle `BKZ_cWof`)
- `e6109f0` docs — §5.3 Phase A floor 122→123 (phone-format check)
- `87754a5` docs — §7a Enter-to-Save scoping decided

**§9.2 SILENT-FAILURE FINDING:** the bundle-poll regex was `[A-Za-z0-9_]+`, excluding hyphens. A valid deploy `D2L-sSsB` returned an EMPTY match and the gate **FAILED OPEN** — reported nothing instead of a mismatch. `NLbaDHhk` and `BJK1Mqyc` were hyphen-free by luck, masking it across two passes. Corrected class `[A-Za-z0-9_-]+`, exercised against both a hyphen (`D2L-sSsB`) and an underscore (`BKZ_cWof`).

**§5.3 floor 122 → 123** (`e6109f0`). 123 is a **Phase A** floor. Phase A = grid + detail per §5.2.

**PHASE A IS PARTIALLY BUILT.** OBSERVED 2026-07-23: `/contacts/:id` routes to `ContactWorkspace` (`App.tsx:24`); `ContactWorkspace` does not consume `getDetail`; `ghl.contacts.getDetail` (`ghl.ts:343`) has zero UI consumers. The §5 detail view is **NOT BUILT**. **5 of 123 checks are authorable today; 118 target the unbuilt view.**

**HARNESS DECISION:** authored ONCE, at 123, after the detail view ships. NOT split into grid/detail harnesses. A grid-only harness at floor 5 was **REJECTED** — a green 5/5 named for the Contacts surface misreports Phase A coverage. The floor is **NOT lowered**: it follows harness design, never a passing run and never the current state of the code.

**HARNESS DESIGN OF RECORD (verbatim, do not re-derive):** static canonical 96-field ID list so `checksRun` is invariant on a truncated payload; exact `checksRun !== 123` abort, **not** `<`; check-name uniqueness `Set` guard; failures must be zero; any throw exits non-zero; bundle gate aborts before any check. `exit 0` is reachable only when all five hold.

**UNEXERCISED BRANCHES (not defects, not pending work):** the null-`dateAdded` sort branch and the non-empty malformed-phone fallback are NOT live-coverable under Phase A production-only constraints. OBSERVED against 42 live rows: 42/42 have `dateAdded`, 0 malformed phones, 1 empty (taohua yu). A passing 123/123 does NOT mean these were exercised.

**§7a ENTER-TO-SAVE:** DECIDED 2026-07-23, RECORDED INTENT, **no code on any surface.** Dashboard notes and Contact Workspace notes get Enter=Save / Shift+Enter=newline — same INTERNAL write class. Conversation replies (Enter=SEND) are a DISTINCT OUTWARD write class, explicitly DEFERRED until the outbound-send surface is designed and verified.

**NETLIFY:** docs-only deploy cancellation is expected by rule but **NOT OBSERVED for `e6109f0` or `87754a5`** — not stated as verified.

**OPEN ITEM — `offer_` fields:** the HARD NO on `offer_` is a **WRITE** prohibition. Whether the **Offer** folder (7 fields, `YslJ5oke73JrBOgaq0np`) is READ and DISPLAYED on the read-only detail view is an **open product decision for Brad** when the detail layout is built. Do not silently exclude it.

**NEXT:** Contacts detail view code slice.

## 2026-07-24 — Contacts detail view Phase A VERIFIED LIVE + secret rotation

- **Contacts detail view Phase A: VERIFIED LIVE at floor 119.** Harness `app/scripts/verify-contacts.cjs` at commit `25b3de5`, bundle `index-hN7nM3rs.js`, **119/119 clean run** (checksRun=119, failures=0) on fixture `FiIT0hUaxVCIuokQpZuc` (Neelima Bale). Covers grid (5) + six folder sections (6) + 96 custom fields (96) + four Additional Info subgroups counted from DOM 22/30/14/7 (4) + three D1 identity-header renders (3) + four Phone N DNC adjacencies (4) + no-input scoped to the record section + identity header (1). Floor was reconciled 123 → 119 against D1 (identity = reused ContactWorkspace header: name / formatted phone / combined address; Phone 1 DNC renders in Reachability, not the identity block) and the no-input assertion SCOPED to the Phase A field display (§5.3, `03ba60f`).
- **Harness re-pin discipline:** `verify-contacts.cjs` `EXPECTED` must be re-pinned to the served bundle hash after ANY app-code deploy — the §9.2 bundle gate `exit 1` aborts before check 1 on a mismatch. `data-testid="record-section"` + `data-testid="identity-header"` hooks were added to ContactWorkspace so check #119 targets a stable scope, not a positional DOM walk (a MISSING hook fails #119, never a zero-input pass).
- **Secret rotation (SECURITY):** `IAOS_WEBHOOK_SECRET` had been set to the bradt75 GHL contact ID `9fbH2VCcZvzVNhsR9zjc` — a value that is public throughout `docs/`. It surfaced when Netlify secret-scan flagged that literal on the harness fixture (harness commit `9ff7ab0` build FAILED to publish for this reason). Rotated to a fresh random value in **GHL Custom Value `iaos_webhook_secret`** + the **Netlify env var**, both confirmed live (old value now `401`s at `ghl-disposition`, which validates the `X-IAOS-Secret` header against `process.env.IAOS_WEBHOOK_SECRET`). The **16 fixture references** to `9fbH2VCcZvzVNhsR9zjc` across the harness + docs STAY — it is a public contact ID again, not the secret. No repo edit was needed to rotate (the secret lives only in Netlify/GHL, never committed).

## 2026-07-27 — Phase B B1 CLOSED: property_notes unlocked, floor 123, Part 1 + Part 2 PASS

Commits this session (from `git log 82771c6..HEAD`, oldest to newest, all on `main`, pushed):

- `2baefd7` docs: PB-D1 setPropertyNotes named write, PB-D2 through PB-D5 B1 unlock decisions
- `190a0f3` feat: unlock property_notes textarea per PB-D1 through PB-D5, harness floor 123
- `fd6689e` harness: re-pin EXPECTED to DrFkq5CQ after property_notes unlock deploy
- `3178f54` docs: PHASE_B_INERT_PROOFS Part 2, property_notes UI behavior verified

**State.** HEAD `3178f54`. Served bundle `index-DrFkq5CQ.js`; harness `EXPECTED` pinned to match. Harness passes at `checksRun=123 uniqueNames=123 failures=0`.

**What closed.** `property_notes` / `k7O0TYVMpqCpnMHRLPol` is the first Class 1 unlocked field. PB-D1 through PB-D5 are recorded — PB-D1 in `CONTACTS_OPPORTUNITIES_SPEC.md` 4.4 as the fourth named GHL write, PB-D2 through PB-D5 in `PHASE_B_SPEC.md` 10.7. Inert-proof Part 1 and Part 2 both PASS in `PHASE_B_INERT_PROOFS.md`.

**Sequence that held, reusable for the next field.** Docs-only commit authorizing the write, THEN app code. The write did not exist in code before the spec said it existed.

**New OBSERVED fact.** Newlines round-trip through app to proxy to GHL and back on a TEXT custom field, breaks intact. Previously UNKNOWN.

**Open UNKNOWN.** One unreproduced Save failure on a page held open across the `190a0f3` deploy. Cause UNKNOWN; stale bundle INFERRED not observed. Recorded in Part 2. Revisit only if it recurs on a freshly loaded page.

**Next.** Second unlocked field repeats B0 wire read, inert-proof, unlock, 4N. Floor moves 123 to 127. No candidate pinned — B0 must confirm TEXT type and population on Neelima first, per 10.5's vacuity rule.

## 2026-07-28 — Phase B B2: ARV MONETORY inert-proof Part 1 PASS

**Commits (oldest → newest, all pushed).**
- `0bbbb31` docs: PHASE_B_SPEC 10.8 editor taxonomy, PB-D6 through PB-D15
- `dcf7384` docs: PHASE_B_INERT_PROOFS contact.arv Part 1, MONETORY write and clear contracts OBSERVED
- `0a8a24d` scripts: ARV MONETORY inert-proof steps 1-5, evidence artifacts for PB B2

**State.** HEAD `0a8a24d`. Served bundle `index-DrFkq5CQ.js`; harness `EXPECTED` pinned
to match — verified from the wire after the `0a8a24d` deploy, no re-pin needed. Harness
floor unchanged at 123. bradt75 restored to its exact 5-field Phase A baseline.

**What closed.** Three MONETORY UNKNOWNs, all OBSERVED on `wMBTGWMs97yysQFx7Vad` (ARV):
write accepts an unquoted JS number; no coercion to string and no rounding at two
decimals (187500.25 round-tripped exactly, typeof number); `field_value:""` returns
KEY_ABSENT, same as TEXT and NOT ignored as DATE ignores it. The step-4b null fallback
was designed for and never needed.

**PB-D6 amended in practice.** §10.8 left the B2 field unpinned by design. It is now
ARV — chosen because it was the only MONETORY with an already-OBSERVED read contract,
so no extra write to Neelima was needed to satisfy §10.5's vacuity rule.

**Method note that earned its keep.** The step-3 poll asserted PRESENCE, not value
equality, and recorded raw value / typeof / strict-equality as OBSERVED lines. Copying
the property_notes value-equality assertion verbatim would have reported a coercion
finding as a proof failure. Where the stored representation IS the unknown under test,
it cannot also be the assertion.

**Corrected record.** `PHASE_B_INERT_PROOFS.md` previously stated clear semantics were
settled "for every subsequent field" off the TEXT proof alone. Narrowed to TEXT.
MONETORY agrees, but two agreeing dataTypes is not a general rule — DATE disagrees.
Per-dataType first proof stands.

**Deploy-rule correction.** Only pure `docs/` commits cancel BOTH Netlify sites. The
`app/scripts/` commit built and published both, `iaos-app` in 16s with "all files
already uploaded" — byte-identical output, bundle unmoved.

**Next.** B2 is proven, not shipped. Remaining: a PB-D naming `setARV` (§4.4 forbids a
generic parameterized setter, so each field earns its own named public method); the
currency editor per §10.8's currency + explicit pair; floor 123 → 127; `EXPECTED`
re-pin after that deploy; then Part 2 UI verification.

**Open UNKNOWN carried.** ARV is almost certainly a read input to the MAO Calculator.
The Part 1 proof PUT via script with no UI mounted, so it structurally cannot detect a
UI-triggered `offer_` recompute. That belongs to Part 2, not to Part 1's inertness
result.

## 2026-07-28 (later session) — Phase B B2 CLOSED: ARV shipped, cleanup shipped, Parts 2-4 PASS

**Supersedes the "Next" list in the section above.** Every item on it has shipped:
floor 123 → 127, `setARV`, the currency editor, the `EXPECTED` re-pin, and Part 2.

**Commits (oldest → newest, all pushed).**
- `64026bf` docs: PHASE_B_INERT_PROOFS contact.arv Part 2, UI behavior PASS, failure branches NOT EXERCISED
- `6ffe7e2` docs: PHASE_B_INERT_PROOFS contact.arv Part 3, GET-error branch PASS, PB-D21 poll-bound gap OPEN
- `15ab0a3` fix: Enter commits via blur single path, verify reads before sleeping, correct _putMonetaryField comment
- `c64d3fc` harness: re-pin EXPECTED to CAm1I0Dq after Enter/verify cleanup deploy
- `31f82e8` docs: PHASE_B_INERT_PROOFS contact.arv Part 4, post-cleanup UI behavior PASS, focus-on-invalid gap OPEN

**State.** HEAD `31f82e8`. Served bundle `index-CAm1I0Dq.js`; harness `EXPECTED` pinned
to match, verified from the wire after the `15ab0a3` deploy. Floor 127, checksRun=127
uniqueNames=127 failures=0. Neelima restored to ARV 250000.5 and confirmed across a hard
refresh. bradt75 untouched this session.

**What closed.** ARV is the second Class 1 unlocked field and the first currency + inline.
All three commit paths — Enter, Tab, click-out — write exactly one PUT and one verify GET,
OBSERVED with the DevTools Method column. Escape cancels with zero requests. Invalid input
stays open with zero requests. PB-D21's GET-error branch was exercised for the first time
and "Couldn't verify save" rendered with no automatic PUT retry.

**Two known defects fixed in `15ab0a3`.** Enter previously called `commit()` directly while
unmount also fired blur; it now calls `blur()` and blur is the single commit path, so
correctness no longer rests on PB-D10's unchanged-value guard. `verify()` previously slept
1000ms before its first read; it now reads immediately and sleeps only between retries.

**A recorded mechanism was wrong.** Part 2 attributed Enter's single PUT to the
unchanged-value guard. `setSaved` runs only after the PUT resolves, so at unmount the guard
would not have short-circuited — whatever suppressed the second write was not the guard.
Part 4 records the correction; the Part 2 sentence stands in place, superseded.

**Method finding.** Response size does NOT discriminate PUT from GET on the ghl-proxy rows;
the two endpoints carry different payloads. The Method column is the only reliable
discriminator. The size heuristic used informally in Parts 2 and 3 should not be reused.

**Blocking is not available for failure-branch testing.** The save PUT and the verify GET
share one identical URL and differ only by method; DevTools request blocking matches on URL
only, so blocking kills both and exercises "Save failed" instead. The Offline-toggle
technique used in Part 3 depended on the 1000ms pre-read sleep and died with it. Any future
failure-branch test needs a new method.

**Two OPEN spec items, both against `PHASE_B_SPEC.md`, neither cosmetic.**
- PB-D21 specifies a bounded poll of 3 attempts 1s apart. That governs the NO-MATCH case. A
  thrown GET error exits after one attempt — the `catch` sits outside the loop. Code and
  wire agree; the decision text describes neither. Not yet reconciled.
- PB-D20 says focus is NEVER forced back after invalid input but does not say what focus
  SHOULD do. OBSERVED answer: nothing. The editor stays open, draft preserved, and is inert
  until clicked. Pre-existing on Tab and click-out; `15ab0a3` extends it to Enter, making all
  three paths consistent on an unspecified behavior.

**Two branches still unexercised.** "Save failed" (PUT non-2xx) — no method identified.
"Save accepted — not yet confirmed" (2xx PUT, no match inside the bound) — never reached
across Parts 2, 3, and 4; the poll hit on attempt 1 every time, including with the pre-read
sleep removed.

**Stale comment, unfixed.** `verify-contacts.cjs` `TARGET` carries `// detail-view fixture
(checks 6-119)`. Floor is 127. Cosmetic, no behavior.

**Next.** The two OPEN decisions above, then PB-D15's parameterized inert-proof runner — its
stated precondition of two observed dataType contracts (TEXT and MONETORY) is met. The
remaining MONETORY candidates (Asking Price, Estimated Repairs, Carrying Cost) are ABSENT on
both fixtures, so §10.5's vacuity rule requires populating Neelima first. That is a manual
GHL edit, not an IAOS write task: no app write path exists for those fields and PB-D16 says
none will until each passes its own proof.

## 2026-07-29 — PB-D20 and PB-D21 decided and shipped; PB-D20 FAILS on the wire

**Commits (oldest → newest, all pushed).**
- `8e0cf8b` docs: PHASE_B_SPEC PB-D21 bound covers thrown reads, correct Part 4 PB-D20 finding to spec violation
- `556dfd5` docs: PHASE_B_SPEC PB-D21 terminal state distinguishes completed from thrown reads
- `54aff63` fix: Enter keeps focus on invalid input per PB-D20, verify poll absorbs thrown reads per PB-D21
- `18702b2` harness: re-pin EXPECTED to Dg2_4V9j after PB-D20/PB-D21 fix deploy
- `6f79044` docs: PHASE_B_INERT_PROOFS Part 5, PB-D20 focus FAIL mechanism not isolated, Save failed branch exercised

**State.** HEAD `6f79044`. Served bundle `index-Dg2_4V9j.js`; harness `EXPECTED`
pinned to match and verified against the live deploy. Floor 127, checksRun=127
failures=0. Neelima restored to ARV 250000.5; bradt75 untouched.

**PB-D20 was never a spec gap.** The prior session recorded it as one. It is not:
PB-D20 says "On Enter, focus stays in the field," which specifies the Enter case
explicitly, and the observed behavior was its opposite. `15ab0a3` introduced the
violation by routing Enter through `blur()`. Tab and click-out were always
compliant. The decision needed no amendment; the implementation needed a fix.

**PB-D21 amended twice.** First to state that a thrown read consumes an attempt
and the poll continues — the transport helper throws on any non-2xx as well as a
rejected fetch, so a transient 5xx and a dead socket are the same exception, and
a transient 5xx is exactly what a bounded poll exists to absorb. Then to fix a
contradiction introduced by that amendment: an exhausted poll settles to "Save
accepted — not yet confirmed" if ANY read completed, and to "Couldn't verify
save" only if all three threw. A completed read is evidence about the data; a
thrown read is evidence about the instrument.

**`54aff63` implements both.** `draftIsValid()` extracted so Enter screens the
draft BEFORE causing a blur and blurs only if it will be accepted; blur remains
the sole commit path. `verify()` moves its try/catch inside the loop and tracks
`anyCompleted`/`lastErr`.

**PB-D20 STILL FAILS ON THE DEPLOYED BUNDLE. Mechanism not isolated.** Manual
verification could not confirm that a keystroke lands after an invalid Enter
without an intervening click. Two candidates, both untested: the fix did not take,
or the failure came entirely from the empty-clear path below. Recorded in
PHASE_B_INERT_PROOFS.md Part 5. This is the first item next session.

**NEW OPEN spec question — the empty-clear foot-gun.** Clearing the field and
pressing Enter commits a real clear. That is PB-D20 and PB-D16 as written and the
code is correct. The hazard is the interaction: a rejected draft leaves the editor
open, the natural recovery is select-all-delete, and that draft is now VALID, so
Enter erases the field. From outside it reads as one event — "it rejected my entry
and then wiped the field." May be the whole of the FAIL above. Test the two as ONE
interaction path, not as separate cases.

**"Save failed" branch NEWLY EXERCISED.** Held Offline, Enter on a changed value
produced a failed PUT and the UI rendered "Save failed: Failed to fetch". Open
since Part 2, now OBSERVED. Three consecutive failed PUTs in the log were separate
manual Enter presses, not auto-repeat.

**Still unexercised.** PB-D21's retry-on-thrown-read is UNVERIFIED — reaching it
needs a succeeding PUT followed by failing reads, and that window is now ~0ms since
the pre-read sleep was removed. "Save accepted — not yet confirmed" has never been
reached across Parts 2 through 5. No instrument produces either condition: URL
blocking kills the PUT alongside the GET, since they share one URL and differ only
by method.

**Process rules added this session, both from observed failures.**
- NO `git commit --amend` without explicit approval, even when unpushed. An amend
  is a history rewrite and requires a stop. Jeff amended unprompted after mangling
  a commit message.
- Commit messages use ONE plain `-m "message"`. No heredoc, here-string, or other
  shell-specific multiline syntax. PowerShell here-string syntax in the Bash tool
  put literal `@` lines into a commit message.

**Watch item.** Jeff substituted a prose description for `git diff` output twice
this session after being asked to print it. The diff is the checkpoint that reads
the whole file rather than three approval fragments; a description is not that
checkpoint.

**Deferred cosmetic.** `verify-contacts.cjs` `TARGET` carries `// detail-view
fixture (checks 6-119)`. Floor is 127.

**Next.** Isolate the PB-D20 failure by reading `handleKeyDown` in the DEPLOYED
bundle rather than the repo, then design a deterministic test covering the focus
and empty-clear paths together. After that, PB-D15's parameterized inert-proof
runner — settle fixed-pair versus open-registry for the dataType contract table
BEFORE writing code, since TEXT and MONETORY agree on clear semantics and DATE
does not. Remaining MONETORY candidates (Asking Price, Estimated Repairs, Carrying
Cost) are still ABSENT on both fixtures; §10.5 vacuity requires populating Neelima
by hand in GHL first.

## Commit map — through 2026-07-22 (oldest → newest; all on `main`, pushed)
Contact Workspace §8 (already in the specs, not re-detailed): step 7 `becaa17`, spec recording `0015a85` (steps 4–5 `dc60d1e`, step 6 `6fa154c`).
- `2147900` — master ref: §2a roadmap reverted to the locked sequence.
- `c3dd42a` — Conversations read-only code (6 files: `ghl-conversations.ts` +`?scope=all`, `ghl.ts` ThreadRow+threads(), App route, Sidebar nav, `Conversations.tsx`, `CONVERSATIONS_SPEC.md`).
- `df0fbd1` — Conversations verification, `CONVERSATIONS_SPEC.md` §6.1: 10/10, floor 10 (a pre-fix 8/10 recorded honestly as superseded).
- `159a269` — master ref: Conversations §2a → DONE (read-only).
- `0804767` — email-bubble collapse (`CLAMP_LINES=5`, local `MessageBubble`, Workspace untouched) + unread-badge record correction.
- `e8f87c2` — collapse verification, `CONVERSATIONS_SPEC.md` §6.2: 13/13, floor 13.
- `853710c` — **app** `netlify.toml` build-ignore rule.
- `90b3810` — **marketing** (root) `netlify.toml` build-ignore rule.
- `6550bcc` — corrected the token env-var record (ghl-proxy header + master ref §11).
- `2443ccf` — Calendars WRITE finding + four-way-secret partly-resolved.
- `27a7e51` — prior session handoff (superseded by THIS file).
- `e4b2ea9` — recorded build-ignore rules confirmed; corrected Netlify billing to Pro.
- `89bcbc3` — **GHL-FIRST invariant** recorded (master ref §2a).
- `ab2859e` — Calendars READ findings + `CALENDARS_SPEC.md` v1 (findings, approved read-view plan, open item).
- `bb74450` — **Calendars read-only agenda view SHIPPED** (`ghl-calendar-events.ts` + `/calendars` route + nav + `Calendars.tsx`).
- `110343a` — Calendars verified (`CALENDARS_SPEC.md` §5, 10/10) + master ref §2a Calendars → DONE (read-only); next surface → Contacts/Opportunities.

### Today (2026-07-22, docs-only; both Netlify builds Cancel; bundle `Bg9d3CqX` unchanged)
- `3977535` — relocate RECON FINDINGS to end-of-file appendix (so §5 appends after §4.6).
- `38dfccb` — add canonical `docs/CONTACT_FIELD_REFERENCE.md` from prod wire pull; correct TEXT 45 / NUMERICAL 25 counts; resolve CAVEAT 4 (token divergence).
- `61c011a` — add GHL folder names + folder-lookup path to the field reference; record Additional Info 73/96 skew.
- `963cc7f` — draft §5 (surface design and build); add Additional Info subgroup mapping (73 → four subgroups).
- `05f241f` — §5.3 set Phase A harness floor = **122**; §5.1 Phone 1 DNC adjacent to native primary phone; §5.3 native-identity assertions + Additional Info subgroup render order; sync status/trailer.
- `714d339` — handoff next-work → Phase A build; floor 122 fixed at 05f241f.
- `24714b2` — clear stale floor-TBD references in handoff.
- `a4208a2` — §5 render decisions: identity block renders first; "rendered ordinal" defined as global index 1..96; Phone 1 DNC placement (data subgroup Reachability, rendered in identity block ordinal 1).
- `1d9769a` — **feat(contacts): FIRST CODE on this surface** — typed single-contact detail read (`ghl.contacts.getDetail`, `ContactDetail`/`ContactDetailField` in `app/src/lib/ghl.ts`); read-only, unreferenced by any component. App build ran → bundle `Bg9d3CqX` → `B76Jox53`.
- `728eb76` — handoff refresh: tip 1d9769a, bundle B76Jox53, Phase A step 1 done.
- `44df0e1` — reverse global-ordinal assertion model → section + relative order (spec §5.3, reference file, handoff); floor stays 122.
- `7d9043e` — add Contacts grid V1 layout to §5.1 (columns/sort/search, exclusions; §5.3 filter-absence note).
- `345f12b` — handoff refresh: tip 7d9043e, Contacts grid V1 decided, step 2 next.
- `009fbeb` — record GHL contact-search wire-confirm (name/email/phone match, address does not); §5.1 + handoff.
- `644398c` — **feat(contacts):** surface `property_address` as `ContactRow.propertyAddress` via `parseContact` (type-only client change → bundle stayed `B76Jox53`; function verified via propertyAddress KEY).
- `1512c64` — **feat(contacts):** read-only `gridRows()` V1 projection over `listAll()` (+ non-visible `id`); client runtime → bundle `B76Jox53` → `B2TRJzB0`.

## GHL-FIRST invariant (settled `89bcbc3`, master ref §2a — applies to EVERY surface)
GHL is the sole system of record AND the sole system of behavior. IAOS is a front-end over GHL's engine, not a reimplementation. Where GHL already provides a mechanism — booking widgets, confirmation emails, workflows, scheduling logic — the app SURFACES it rather than rebuilding it. **Building our own path is the EXCEPTION and requires an OBSERVED finding that GHL has no path, not an assumption that it doesn't.** GHL's mechanisms are proven and maintained upstream; anything built from scratch is ours to break and ours to fix.

## Credential map — RESOLVED
Prod runs on **`GHL_PRIVATE_API_KEY` = the canonical PIT ending …d0f7** ("IAOS Netlify Integration" in GHL). All 9 GHL-talking functions read `GHL_PRIVATE_API_KEY ?? GHL_API_TOKEN`; with both set on the app site, `GHL_PRIVATE_API_KEY` always wins → **`GHL_API_TOKEN` is a dead fallback**. `app/.env`'s `pit-b2e9…` is Jeff-the-Bot's separate build-phase integration — NOT a prod mismatch. **Scope LIST still UNKNOWN** (GHL UI wizard-gates it). Observed scopes: contacts R+W, conversations R, calendars R, calendars/events W; **Conversations WRITE UNTESTED (not absent).** No Netlify dashboard/CLI access — do not infer scopes from `app/.env`.

## Calendars findings (OBSERVED 2026-07-17; full detail in `CALENDARS_SPEC.md`)
- **`/calendars/events` (v2021-07-28) returns APPOINTMENTS ONLY.** Google-sync "Busy" block-slot mirrors are NOT in the API under any scoping tried — API and UI diverge; where block slots surface is UNKNOWN. App renders what the endpoint returns; no mirror-filtering needed.
- **Scope IS required:** `locationId` alone → **HTTP 422**; must pass one of `calendarId`/`userId`/`groupId`. calendarId ≡ userId (same events).
- **GHL QUIRK:** every event ships the status field TWICE — correctly-spelled `appointmentStatus` and misspelled `appoinmentStatus`. Read the correct one; never rely on the misspelling.
- **Calendars WRITE — OBSERVED present, but BOOKING NOT proven.** `POST /calendars/events/block-slots` returned 400-not-401 (scope present, nothing created). **Caveat (verbatim):** block-slots proved write access to /calendars/events/; an actual appointment creation succeeding end-to-end is INFERRED from shared scope, NOT separately observed. (CALENDARS_SPEC §2.) Do not conclude booking is proven from "calendars/events W" alone.
- **OPEN — userId scope span UNKNOWN:** whether a `userId` query returns appointments across ALL calendars a user is assigned to is unverified (only Seller-calendar appts observed under `userId`). Fan-over-calendarId sidesteps it for v1; matters for multi-user SaaS.
- 3 active calendars (Seller/Buyer/Investor Consultation). Verification baseline: Jul 20 = exactly 2 confirmed appointments, contact Brad Thompson `9fbH2VCcZvzVNhsR9zjc`.

## Netlify
- **Plan: Pro $20/mo, 3,000 credits/mo, GRANDFATHERED.** The currently-listed Pro is $33/mo for 5,000 credits with rollover — **DO NOT touch the plan selector; changing it forfeits the grandfathered rate.** Auto-recharge OFF, hard credit ceiling holds, Brad monitors it.
- **Build-ignore rules (853710c app `-- .` / 90b3810 marketing `':(exclude)docs'`) confirmed skipping BOTH sites on FOUR separate docs-only commits** (Brad-verified off the deploy logs). Docs-only commits now cost zero builds.
  - **The app discriminator is `app/` SCOPE, not scripts-vs-source (corrected 2026-07-21, `d7fae9d` observed).** Netlify runs the app `ignore` from base dir `app/`, so `-- .` scopes the diff to EVERYTHING under `app/`. A commit skips the app site ONLY when it touches nothing under `app/` (pure `docs/`, or root-level marketing files). **Any file under `app/` — INCLUDING `app/scripts/` harness edits (e.g. an EXPECTED re-pin) — triggers an app BUILD, not a skip.** That build may still reproduce the identical bundle (deterministic → "All files already uploaded by a previous deploy with the same commits"), leaving the served hash unchanged — but it is a BUILD, not a skip. The earlier "scripts-only skips" belief was wrong: `20883bf` (a `app/scripts/verify-conversations.cjs` edit) BUILT-and-reproduced too; the §6.5 record's "reproducing `B6PPkWme`" was about the bundle HASH, not a skipped build. The Brad-verified skip evidence was FOUR **docs-only** commits — never a scripts-under-`app/` commit.
  - **OBSERVED live on the Deploy tab (`8344344`, docs-only, 2026-07-21):** both sites **Canceled**. App log — the ignore command is literally `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- .` (`-- .` = whole-repo pathspec; the **content-check does the discrimination**), returned **exit 0 → "Canceled build due to no content change,"** Deploying/Cleanup/Post-processing **Skipped**. Marketing same on `':(exclude)docs'`. `d7fae9d` (touched `app/scripts/`) BUILT; `8344344` (docs-only) CANCELED — the corrected rule verified end-to-end. This behaviorally matches the §6.6 note; the operative test is "no content change under the effective scope," however that scope resolves.
  - Failure signature: app rule can only ever STOP skipping (harmless); if a commit touching **nothing under `app/`** ever shows anything but "Skipped"/"Canceled", stop and re-derive.
  - **MARKETING build rule — the trigger is FILE PATHS, not the `docs:` message prefix (OBSERVED 2026-07-21 across `d7fae9d` / `4e95bce` / `d804ac4` / `c030182`).** The marketing `ignore` is `git diff … -- ':(exclude)docs'`, so marketing SKIPS only when EVERY changed file is under `docs/` (a pure-docs commit). **ANY non-docs path in the commit — INCLUDING `app/scripts/*` (e.g. the harness `EXPECTED` re-pin) — makes marketing BUILD**, even when the commit message starts `docs:`. The repeated session prediction "scripts+docs → marketing skips" was WRONG: those `§6.x`-record commits carry a non-docs file (`app/scripts/verify-conversations.cjs`), so BOTH sites build. Retire "marketing skips on docs: commits" — the paths decide, not the message. (Net: a pure-docs commit cancels BOTH; a scripts+docs commit builds BOTH — app reproduces its bundle, marketing rebuilds.)
- No Netlify dashboard/CLI/API access from the agent; Brad reads deploy logs / dashboard.
- **LOCAL `vite preview` LIMIT — serves the static build, NOT the Netlify Functions (OBSERVED 2026-07-21).** `vite preview` / `pnpm preview` serves `dist/` only; any surface that fetches `/.netlify/functions/*` (the `/api` path) gets the SPA `index.html` back instead of JSON and fails with `Unexpected token '<', <!DOCTYPE…`. A data-driven surface (Conversations threads, Dashboard, etc.) then loads no data → nothing to select → nothing to eyeball. Local preview is useful ONLY for surfaces with zero backend calls. **Pixel/layout checks on data-driven surfaces MUST be done live on prod** — which needs commit + push (there is no prod deploy of uncommitted code). This bit the §8.9 indent viewport check (a `vite preview` attempt was abandoned for exactly this reason).

## Send-test fixture (available)
Brad is a clean GHL contact — **bradt75@gmail.com / 214-914-6151, no DnD.** Use as the fixture for the Conversations SEND test (and any authorized write test), so no seller is touched.

## Open items carried (none blocking)
- **Write phases NOT built:** Conversations send/compose + unread management; Calendars booking/reschedule + availability.
- **Step 6 live dispositioned call** — a real softphone call → Custom-Disposition tap (~1–2 min, §5.2 transient prompt) → published Workflow → `ghl-disposition`. IAOS side proven; GHL side never fired live.
- **Outbound-SMS render** — code-correct, not live-verified (zero outbound SMS in location). Trigger: first observed outbound SMS thread.
- **Short-email sub-branch** — `collapsible=true && overflowing=false` unverified (all 71 emails are 874+ chars). Narrow gap; button-absent proven via the SMS path.
- **STOP anomaly** — john sanchez `05gYdxJcyNTCKWTwkbbs` inbound SMS "STOP" with no preceding outbound SMS in `/messages`; unresolved.
- **7 unauthed netlify functions** + `Access-Control-Allow-Origin: *` — deferred by Brad's call while single-tenant; trigger = first user who isn't Brad. (`ghl-disposition` is authed via `X-IAOS-Secret`.)
- **listAll lowercase names** — `ghl-contacts` returns names lowercase; Dashboard shows all names lowercase (cosmetic, unfixed).
- **2026-07-07 pipeline rows** — two `TYPE_ACTIVITY_OPPORTUNITY` rows flipped `New Lead ↔ Seller Offer Sent`; something with the IAOS credential moved stages. Cause unproven; do not design a fix against it.

## The method (how Brad works — follow it)
- **Print the diff and STOP, every time, until Brad says commit.** Jeff bundled the commit into the same turn as a reprint three times on 2026-07-17.
- **Per-command approval is always option 1** — show the raw diff, nothing staged, and **wait**. Never `git add && commit && push` before he's read it.
- **Give one recommendation, not a menu of options.**
- **Bundle gate = §9.2:** build the commit AND its parent, prove the hashes DISCRIMINATE, poll prod to the expected hash, re-assert at runtime. "Hash changed" ≠ "your code is live."
- **Verification floor = the literal counted `check()` count** in the harness (counted from the file, never estimated — it's been off-by-one when guessed).
- **OBSERVED vs INFERRED on every line.** If you can't observe it, say UNKNOWN and stop — don't infer (esp. credentials/scopes).
- **Poll to convergence, never fixed-wait** (§11: listAll lag 11s–105s+, variable).
- Don't round a partial/failed run up to a clean one in the permanent record.

## Open decisions for Brad (still Brad's, unresolved)
1. **Does the Conversations SEND write join the three-write invariant, or form a new write class?** (Invariant today: notes + last_call_attempt + callback; send is a new outward-facing write to a seller.)
2. **Same for Calendars BOOK/reschedule** — new write class, or folded in?
Both now DEFAULT to GHL-FIRST: **surface GHL's mechanism (booking widget, send path), build our own only on an OBSERVED finding that GHL has none.** Both must gate on DnD (john sanchez's "DnD enabled by customer" is the live example). The write-class decision stays Brad's to make.

## 2026-07-29 (later session) — PB-D22 shipped; PB-D20 failure isolated and superseded

**Commits (oldest → newest, all pushed).**
- `573d294` docs: SESSION_HANDOFF 2026-07-29, PB-D20 and PB-D21 shipped, PB-D20 fails on the wire
- `618d399` docs: PHASE_B_INERT_PROOFS Part 6, PB-D20 focus PASS on served bundle, Part 5 FAIL superseded
- `54e2d69` docs: PHASE_B_SPEC PB-D22, empty draft restores rather than clears, PB-D20 empty clause amended
- `218e732` fix: empty draft restores rather than clears per PB-D22
- `c72770d` harness: re-pin EXPECTED to index-DGhQbSl_.js after PB-D22 deploy
- `9462a38` docs: PHASE_B_INERT_PROOFS Part 7, PB-D22 post-invalid recovery verified on the wire, Tests 1-3 PASS

**State.** HEAD `9462a38`, working tree clean. Served bundle `index-DGhQbSl_.js`; harness `EXPECTED` pinned to match and verified against the live deploy. Floor 127, checksRun=127 failures=0. Neelima ARV 250000.5; bradt75 untouched.

**The previously reported PB-D20 failure was superseded.** Inspection of the served bundle (rather than the repository source) showed the invalid-draft guard present in the compiled artifact. The helper appears minified as `Z`, and the keydown path only blurs when that guard succeeds. The reviewed fix was present and correctly compiled, so the Part 5 observation is contradicted rather than explained. The empty-clear path is the likely source and is recorded as INFERRED, not observed. Part 5's FAIL is SUPERSEDED by Part 6. Part 5 was not edited.

**The real defect was the empty-clear.** Invalid input leaves the editor open, which is correct. Select-all-delete is the natural recovery. That draft is VALID, so Enter committed a real clear and the field was erased. Both halves individually spec-compliant; the hazard was entirely in their interaction.

**PB-D22 decided.** Empty is not a clear. On Enter, Tab, or blur an empty draft exits edit mode and restores the current persisted value, with no PUT. Two alternatives rejected: status quo, which leaves a destructive act behind the recovery gesture; and suppress-only-after-invalid, which creates an invisible mode — PB-D19's defect class — and would need an affordance PB-D17 forbids. PB-D16's wire contract is unchanged: `setARV(id, "")` still clears. PB-D22 removes only the inline keystroke that could invoke that operation. Consequence accepted deliberately: there is NO way to clear a MONETORY field from the UI until an explicit action is designed.

**PB-D20's empty clause amended in place.** "Empty input is valid and is a real clear" contradicted PB-D22. The spec must read true standing alone.

**Part 7 — PB-D22 verified on the wire.** Test 1 (clean empty + Enter): zero requests, restored. Test 2 (the exact sequence that erased the field): invalid Enter holds the editor open with zero requests, select-all-delete then Enter closes and restores with zero requests, reopen shows `250000.5` with the invalid flag reset. Test 3 (regression): each valid commit produced exactly one PUT 200 followed by one GET 200. Every observed request listed `index-DGhQbSl_.js:3` in the DevTools Initiator column, confirming the tests executed against the pinned bundle.

**Still unexercised.** PB-D21's retry-on-thrown-read remains UNVERIFIED — each PUT was followed by exactly one successful verification GET, so no retry condition arose. "Save accepted — not yet confirmed" has never been reached across Parts 2 through 7. No instrument produces either condition: PUT and verify GET share one URL and differ only by method, so URL blocking kills both. A method-aware intercepting proxy would work but was rejected — it would sit in front of a live write path. No attempt was made to introduce a method-aware proxy solely to exercise these branches. The realistic answer is a controllable test hook, or it stays unverified.

**Instruction-shape rules added this session, all from repeated observed failures.** These govern how prompts are written, not how Jeff behaves.
- Exactly one executable step per message. Narrative before or after is fine. A step may chain a validating read with `;` where the second command exists only to check the first (the diff form below); no second independent action belongs in the same message. A commit was lost to batching: add/status/commit sent together, commit ran first against an empty index.
- Diffs are never "shown." The working form is two messages: `git diff <path> > /tmp/d.txt; wc -l /tmp/d.txt`, then `cat /tmp/d.txt`. The line count catches truncation or fabrication. Run it BEFORE staging — after commit the working tree is clean and the diff is empty.
- All prompts go in copy bubbles, including bare git commands.
- Commit messages: ONE plain `-m`, verified after commit with `git log -1 --format=%s` before pushing.
- Section-structure conventions must be read from the file before editing it. This session's rollover carried a "stale HEAD `31f82e8`" cosmetic that was not a defect: each session section holds its own State paragraph, accurate as of that section.

**Deferred cosmetic, carried.** `verify-contacts.cjs` `TARGET` carries `// detail-view fixture (checks 6-119)`. Floor is 127. It lives under `app/`, so fixing it triggers a build on both sites and an `EXPECTED` re-pin check — it must be its own commit, never bundled with docs.

**Next.** PB-D15's parameterized inert-proof runner. Settle fixed-pair versus open-registry for the dataType contract table BEFORE writing code: TEXT and MONETORY agree on clear semantics and DATE does not, so a two-entry table would encode an agreement that isn't general. Remaining MONETORY candidates (Asking Price, Estimated Repairs, Carrying Cost) are ABSENT on both fixtures; §10.5 vacuity requires populating Neelima by hand in GHL first — a manual precondition, not an IAOS write task.

## 2026-07-29 (evening session) — PB-D23 and PB-D24 shipped; B3 field left undesignated

**Commits (oldest → newest, all pushed).**
- `ec4f130` docs: PHASE_B_SPEC PB-D23, inert-proof runner parameterized by field not dataType, contract table deferred
- `6c7fe63` docs: normalize Part 7 heading level, broaden PB-D22 failure citation to Parts 5-7
- `91baf42` docs: PHASE_B_SPEC PB-D24, strict restoration for KEY_ABSENT origin, PB-D16 promotion gate is eligibility not authorization
**State.** HEAD `91baf42`, working tree clean. Served bundle `index-DGhQbSl_.js`; harness `EXPECTED` pinned to match. Floor 127, checksRun=127 failures=0 — re-run AFTER fixture population, so the harness is not coupled to fixture emptiness. Neelima `FiIT0hUaxVCIuokQpZuc`: asking_price 115000, estimated_repairs 15000, carrying_cost 6000, ARV 250000.5. bradt75 `9fbH2VCcZvzVNhsR9zjc`: all three MONETORY candidates and ARV ABSENT. Both origin states now exist deliberately — populated-origin rollback provable on Neelima, absent-origin on bradt75.
**PB-D23 and PB-D24 postdate the prior section entirely.** Neither appears above; the prior section's State and Next describe the pre-PB-D23 world and are correct as of that section.
**PB-D23 — runner parameterized by field, not dataType.** Rejected fixed-pair (two identical entries discriminate nothing — the tautology trap in structural form) and open-registry (no first consumer). DATE excluded because its behavior is largely UNKNOWN, not because it is known to differ. Trigger to revisit: a third dataType enters inert-proof AND at least one proven behavior differs.
**PB-D24 — strict restoration and the promotion gate.** Capture value AND key presence; rollback restores the exact original wire state; rollback is not complete until a read confirms it — a successful PUT is necessary but not sufficient, per PB-D21. Absent-origin mechanism is `field_value:""` → KEY_ABSENT per PB-D16, MONETORY-specific, no cross-dataType claim. Rejected value-only rollback (not inert by definition) and require-prepopulation (relocates the absent-origin write rather than removing it).
**Promotion gate is eligibility, not authorization.** The B3 field is PB-D16's "second MONETORY field." Its passing proof satisfies the eligibility condition for reviewing the public-API restriction and does not itself change the API. That change is a separate named decision, never a side effect.
**§10.5 vacuity precondition satisfied.** The three MONETORY fields were populated by hand in the GHL UI on Neelima, ~15:00 CDT, and wire-confirmed MONETORY against the location custom-field schema. This closed the prior section's manual precondition.
**Pre-B3 reconnaissance — recorded here, deliberately not in PHASE_B_INERT_PROOFS.md.** That file is for proofs; this is reconnaissance. Surfaces inspected ~80 min after the manual population: Activity pane, Conversation History, Opportunity stage history, the four System scores, Tags, the three values plus ARV. No downstream activity anywhere inspected — Activity pane empty, latest conversation entries Jul 13–20, opportunity history unchanged (Jul 07, Jul 20; contact in Long-Term Nurture), scores byte-identical (Motivation 54, Deal 100, Combined 78, Data Completeness 91). Data Completeness did not recompute despite three fields going absent→populated; change-triggered vs scheduled vs excludes-these-fields is UNKNOWN. Scope limits: Tags UNKNOWN (pre-edit state never captured, so no tag addition can be ruled out); no audit log (GHL's "Contact updates" panel is product announcements, not change history — all findings are absence-of-effect in UI surfaces); the ~80-minute window does not exclude delayed or business-hours-gated workflows; and this covered manual population of previously absent fields on Neelima, a different operation than the planned proof, which writes a temporary value on bradt75 and restores the original wire state. Evidence is informative, not dispositive. No field shows automation on it, so none is disqualified — the tie among the three is NOT broken.
**Two prior deferred cosmetics closed in `6c7fe63`.** Part 7's heading level normalized from `##` to `###`, and the PB-D22 failure citation broadened to Parts 5-7. The `verify-contacts.cjs` `TARGET` comment cosmetic is NOT among them and remains open.
**Still unexercised.** PB-D21's retry-on-thrown-read remains UNVERIFIED — every PUT was followed by exactly one successful verify GET, so no retry condition arose. PUT and verify GET share one URL and differ only by method, so URL blocking kills both; a method-aware intercepting proxy was rejected because it would sit in front of a live write path. Realistic answer is a controllable test hook, or it stays unverified. "Save accepted — not yet confirmed" has never been reached across Parts 2–7. Neelima now returns 51 customFields (was 39); seven are the `offer_` set and three are the new MONETORY fields, leaving two entries unaccounted for and not investigated.
**Next.** PB-D15's parameterized inert-proof runner, now unblocked — parameterized by field, rollback contract settled by PB-D24. First `app/` commit since `218e732`, so build-skip stops applying: both Netlify sites build and publish, `EXPECTED` re-pin is required, and harness `checksRun===N` may need incrementing. The `verify-contacts.cjs` `TARGET` comment (`// detail-view fixture (checks 6-119)` → 127) is under `app/` and can ride with the runner commit rather than earning its own build. B3 field designation is deferred until it is the first thing that actually blocks; if taken on current evidence, record it as arbitrary — "The three candidate fields were indistinguishable on all available evidence. One was selected for implementation convenience only. The selection conveys no additional safety inference beyond the reconnaissance recorded in this section." Do not manufacture a rationale.

## 2026-07-29 (late evening session) — PB-D25 shipped, §9.2 read from canonical text, runner placement guided by precedent

**Commits (oldest → newest, all pushed).**
- `f7e05f3` docs: PHASE_B_SPEC PB-D25, post-write assertion is value equality not presence, TEXT and MONETORY scope

**State.** HEAD `f7e05f3`, working tree clean, all pushed. `PHASE_B_SPEC.md` at 472 lines; the decision series runs through PB-D25. No `app/` commit occurred, so bundle, `EXPECTED`, and the 127 floor are untouched from the prior section. Both Netlify sites Canceled `f7e05f3` and their Published timestamps remain unmoved at 1:15 PM, verified on both Deploy tabs.

**PB-D25 — post-write assertion is value equality, not presence.** Every TEXT or MONETORY inert-proof write step asserts read-back equality; presence of the field key is not a sufficient pass condition. Origin state determines what the rollback restores to, not assertion strength. DATE excluded — its stored representation is unproven and it truncates time-of-day.

**The presence-only path was a bootstrap, now closed.** `inert-proof-arv-step3.cjs` gates on `!!entry` and records `observedValue` / `observedType` / `strictEqualsTemp` without asserting on them; `inert-proof-property-notes-step3.cjs` gates on `deepEqual`. The divergence is explained by origin state and the then-unknown MONETORY representation, not by any observed property of the MONETORY dataType itself. ARV was absent at capture; PB-D14 closed the representation unknown, so the weaker assertion does not transfer.

**§9.2 is at `CONTACT_WORKSPACE_SPEC_v2.md:335`, and step 2 is a diagnostic.** Every other `(§9.2)` in `docs/` is a back-reference to that one section; `CONTACTS_DETAIL_SPEC.md:118` is an unrelated numbering collision. Canonical text: a change that doesn't move the hash makes the gate worthless, and step 2 is what tells you whether the hash can prove anything. A non-discriminating hash therefore means the gate has **no evidentiary power** for that commit — not that the commit failed. The prior section's Next assumes a bundling commit. For a non-bundling commit, §9.2 step 2 first determines whether the bundle hash has evidentiary power for that change.

**PB-D14 is the MONETORY read contract. The clear-semantics note has no decision number.** PB-D14 at line 336 records bare JavaScript number, `typeof` number, decimals preserved, no wrapper, corroborated across the seven `offer_` fields. PB-D24's line 446 cites "the clear-semantics note at PB-D14," which is a pointer, not a definition — the note itself sits in an unlabeled RESOLVED block between PB-D14 and PB-D15 and carries no PB-D number. That is why the citation has now been misattributed twice.

**Runner placement follows existing precedent; no decision needed.** The inert-proof scripts already live under `app/scripts/` — two families, `property-notes` and `arv`, each a base plus steps 2–5, alongside `b0-property-recon.cjs`, `verify-contacts.cjs`, and `verify-conversations.cjs`. Those two families are the "two observed contracts" PB-D15 requires. Base and step5 diverge only on identity constants (`FIELD_ID`, doc comment, evidence paths, log label); step3 diverges on poll-convergence, which appears to be the principal parameterization surface. Whether a `.cjs` under `app/scripts/` moves the Vite entry hash is UNKNOWN — §9.2 step 2 is the experiment that settles it.

**Zero wire reads in the PB-D25 work.** Every read was a local file or `git`. All fixture values remain as recorded in the prior section — inherited, not re-observed here.

**Still unexercised.** PB-D21's retry-on-thrown-read remains UNVERIFIED. "Save accepted — not yet confirmed" has never been reached. Two of Neelima's 51 customFields remain unaccounted for and uninvestigated. The `verify-contacts.cjs` `TARGET` comment cosmetic remains open.

**Next.** PB-D15's parameterized inert-proof runner, in `app/scripts/` per precedent, asserting value equality per PB-D25. First `app/` commit since `218e732`. When the first `app/` commit is ready, run §9.2 step 2 — build the commit and its parent and compare hashes — before assuming a re-pin is needed; if the hashes do not discriminate, record that the gate has no evidentiary power for this commit rather than treating it as a failure. B3 field designation still deferred, tie still unbroken.

## 2026-07-30 — PB-D29 shipped; capture stage implemented AND executed; evidence archive established

**Commits today** (oldest → newest, from `git log`, all on `main`, all pushed):

- `ff24d74` docs: PHASE_B_SPEC PB-D26 runner stage ownership and boundaries
- `bc9e4c0` docs: PHASE_B_SPEC PB-D27 one stage per invocation, PB-D28 in-file keyed field registry
- `2af4c82` feat: inert-proof-runner.cjs dispatcher skeleton per PB-D26/D27/D28, scripts-only so bundle hash does not discriminate
- `bb2b896` docs: JEFF_OUTPUT_RULES verbatim output requirement for build oversight
- `1438678` docs: PHASE_B_SPEC PB-D29 stage exit codes and evidence path derivation
- `9e82d03` docs: PB_D15_EVIDENCE_ARCHIVE provenance manifest for original step-1 evidence
- `ff33568` feat: inert-proof-runner capture stage per PB-D23/D26/D27/D28/D29, read-only, two GETs, no PUT

Netlify: the five `docs/` commits Canceled on both sites; `2af4c82` and `ff33568` Published on both. Bundle stayed `index-DGhQbSl_.js` across both app commits — a `.cjs` under `app/scripts/` builds both sites but does not move the Vite entry hash. `EXPECTED` at `verify-contacts.cjs:17` needs no re-pin. Confirmed twice now.

**PB-D29 — decided and shipped.** Dispatcher exit codes stay 10–13. Each implemented stage allocates distinct codes for its own distinct failure branches; future ranges are assigned when those stages exist, not in advance. Evidence paths are derived, not stored: a directory constant plus a filename from stage and field, with the registry key mapped through the existing script-name convention. Existing `-step<N>.json` filenames are retained and stage maps to step number internally. §10.4 governs `PHASE_B_INERT_PROOFS.md` (markdown, per field, two dated parts) and does NOT govern transient stage evidence JSON.

**Evidence archive.** PB-D29's derivation reproduces the two original step-1 evidence filenames exactly, so capture overwrites them. Both originals were copied to `C:\Users\brad\Documents\IAOS Evidence\PB-D15 originals\` before capture ran, with SHA-256 verified byte-identical and mtimes preserved. `docs/PB_D15_EVIDENCE_ARCHIVE.md` records filenames, timestamps, byte counts, and hashes. The JSON itself is deliberately NOT committed — it carries live contact IDs, tags, full custom-field values, and opportunity IDs.

**Capture — implemented and EXECUTED.** `capture arv` and `capture property_notes` both ran against live GHL and both exited `0`. Read-only: two GETs, no PUT. Each reproduced its hand-written step-1 evidence semantically and structurally — the only added key is `fieldKey`, the only differing value is `timestamp`. Every load-bearing field (`contactId`, `fieldId`, `fieldPresent`, the full `customFields` array, `tags`, all seven `offerIds`, all four opportunity/pipeline IDs) came back byte-identical two and three days after the originals. PB-D29's filename derivation confirmed on the wire: `property_notes` → `inert-proof-property-notes-step1.json`.

Both fields report ABSENT on bradt75. **Populated-origin restore per PB-D24 has still never executed** and must not be inferred from these absent-origin captures.

**Operational facts now load-bearing:**

- The runner must be invoked from the repo root. A prior `cd app` for a build persists into later commands and produces `MODULE_NOT_FOUND` on `app/app/scripts/...`.
- Node's module loader exits `1`, below the dispatcher's 10–13. An exit of `1` means the script never started, not that a stage failed.
- Jeff's tool result clips the final line of stdout. When an exit code is the thing being read, redirect script stdout to `/dev/null` so `echo "EXIT=$?"` lands first.

**Still open:** PB-D21 retry-on-thrown-read UNVERIFIED. "Save accepted — not yet confirmed" never reached. Two of Neelima's 51 customFields unaccounted for. Clear-semantics note at `PHASE_B_SPEC.md:338` sits in an unlabeled RESOLVED block with no PB-D number. `verify-contacts.cjs` TARGET comment cosmetic. B3 field designation deferred; asking_price / estimated_repairs / carrying_cost tie unbroken. Seven unauthenticated Netlify functions with `ACAO:*` — deferred by explicit call, trigger is first non-Brad user. One MCP server needs authentication (`/mcp`), unexamined. Heading at `SESSION_HANDOFF.md:451` carries a stray `</parameter>` fragment from prior tooling — cosmetic, not corrected here to keep this diff clean.

**Next.** Execute no further stages yet. Read the write-stage precondition and failure structure, then implement `write` only after its exit-code branches and evidence contract are enumerated from the existing scripts. Populated-origin restore remains unverified and must not be inferred from the absent-origin captures.

## 2026-07-31 — PB-D30 shipped; write stage implemented but NEVER executed; step-2 evidence archived

**Commits today** (oldest → newest, from `git log`, all on `main`, all pushed):

- `cd96a78` docs: PHASE_B_SPEC PB-D30 write stage contract, absent-origin only, observed temp values, five exit codes
- `d033183` feat: write stage implementation per PB-D30, one PUT, absent-origin only, five exit codes
- `6bb6269` docs: PB_D15_EVIDENCE_ARCHIVE step-2 originals archived and SHA-verified before write execution

Netlify: `cd96a78` and `6bb6269` Canceled on both sites; `d033183` Published on both. Bundle remained `index-DGhQbSl_.js`. This is the third observed instance in which an `app/scripts/*.cjs` change built both sites without changing the Vite entry hash. The observation is recorded; it is not generalized beyond that class of changes. `EXPECTED` at `verify-contacts.cjs:17` needs no re-pin. HEAD is `6bb6269`, tree clean, pushed.

**Write stage — implemented, NEVER executed.** `app/scripts/inert-proof-runner.cjs` is now 264 lines. `capture` and `write` are implemented; `verify` and `restore` remain stubs and were not touched. `write` performs EXACTLY ONE PUT, gated on three precondition classes: config (`tempValue == null` → exit 30, semantic so a future `0` passes), capture evidence (contactId, fieldId, `fieldPresent !== false`, array shapes → exit 30), and live contact state (id match, refuse-if-field-already-present, deep-equal on `customFields` and `tags` → exit 31). Evidence persistence is attempted before response classification, so the implementation gives exit 33 precedence over exit 32 when evidence cannot be written. The outer catch exits 34 and reports whether a response was received. The live precondition is contact-only — no opportunity search anywhere in `write`.

**Seven-key evidence contract retained.** `write`'s evidence record is `timestamp`, `contactId`, `fieldId`, `tempValue`, `requestBody`, `responseStatus`, `responseBody` — identical to the hand-written step-2 records. `fieldKey` is logged to the console summary but deliberately NOT persisted: the summary serves the operator, the evidence record is the transport artifact, and `fieldKey` is already recoverable from the derived filename and the registry mapping. PB-D31 was deliberately not opened. Capture's evidence carries `fieldKey`; write's evidence intentionally does not. The difference is deliberate and reflects the retained seven-key write contract.

**Stale comment corrected as a seventh change.** The PB-D28 registry comment above `const FIELDS` still said `tempValue` was intentionally absent while the registry below it carried `tempValue` on both entries. Corrected in the same commit. The comment now reflects the current registry state and ties the omission to observation rather than implementation timing.

**Evidence archive — all four originals now covered.** `STEP_BY_STAGE.write = 2`, so `write` resolves onto the existing `-step2.json` filenames, exactly as `capture` overwrote `-step1`. Both step-2 originals were copied to `C:\Users\brad\Documents\IAOS Evidence\PB-D15 originals\` with `cp -p` before any execution, SHA-256 verified byte-identical on both sides, and recorded in `docs/PB_D15_EVIDENCE_ARCHIVE.md` in the five-bullet step-1 shape. The Verification section was amended in the same commit so it no longer claims all pairs were verified before capture was implemented.

**Not executed.** `write arv` is ready for first execution and would PUT `187500.25` to `9fbH2VCcZvzVNhsR9zjc`. `write property_notes` intentionally aborts at exit 30 because its `tempValue` is `null` — no network call is made. PB-D24's populated-origin restore path remains unexercised and must not be inferred from absent-origin behavior.

**Observation only.** `iaos-app` Observability reported 12.50% errors (1 of 8 requests) over the last hour at session close. `investor-automation-os` reported 0.00%. No investigation was performed, and no causal connection to today's work is claimed. The runner communicates directly with the proxy rather than through the frontend bundle, so the observation is recorded without interpretation.

**Process watch.** Observed: across four attempts to read `SESSION_HANDOFF.md:474–504` through the terminal — direct `sed`, redirected `cat`, and numbered `awk` — the section's content was not visible in the terminal display, while reads of other files displayed normally throughout the session. Two of the four showed a collapsed "Read 1 file" indicator rather than inline output. Whether the content was returned and the display collapsed it, or the content was not emitted, is UNKNOWN. The section was ultimately read directly in VS Code.

**Still open:** PB-D21 retry-on-thrown-read UNVERIFIED. Two of Neelima's 51 customFields unaccounted for. Clear-semantics note at `PHASE_B_SPEC.md:338` sits in an unlabeled RESOLVED block with no PB-D number. `verify-contacts.cjs` TARGET comment cosmetic. B3 field designation deferred; asking_price / estimated_repairs / carrying_cost tie unbroken. Seven unauthenticated Netlify functions with `ACAO:*` deferred by explicit call, trigger is first non-Brad user. One MCP server needs authentication (`/mcp`), unexamined. `SESSION_HANDOFF.md:451` still carries the stray `</parameter>` fragment — cosmetic, deliberately not corrected here to keep the diff clean.

**Next.** Execute `write arv`, or continue implementing `verify`. Do neither before re-reading the write stage's precondition and failure structure from the script itself rather than from this summary.

## 2026-07-31 (evening session) — write stage EXECUTED and cleared; full round-trip verified on the wire

No commits. HEAD remains `86fcd2f`, tree clean. This session executed against live GHL and changed no code.

**Write executed.** `node app/scripts/inert-proof-runner.cjs write arv` — EXIT=0, PUT status 200, evidence written to `inert-proof-arv-step2.json`. Preceded by a full four-window verbatim re-read of `write` (lines 148–230) from the committed file, per the afternoon section's gate. Line numbers had shifted +1 from the pre-commit read because the PB-D28 comment fix added a net line.

**Wire confirmed the write, read-only GET.** `customFieldCount` 5 → 6; `arv` = `187500.25` stored as a JavaScript number, decimals preserved, confirming MONETORY is number-in/number-out; `tagCount` 1, unchanged. A one-field PUT to GHL disturbs nothing outside the named field — observed, not assumed.

**Runner reproduces the hand-written proof.** `diff` of the runner-written step-2 against the archived Jul 28 original: three differences, all inherently per-run — `timestamp`, `responseBody.dateUpdated`, `responseBody.traceId`. `contactId`, `fieldId`, `tempValue`, `requestBody`, `responseStatus`, and the rest of the payload byte-identical. Mirrors the capture-stage result from 7/30.

**Six unarchived originals discovered and archived.** `inert-proof-arv-step4.json` was about to be overwritten by the clear — the same archive-before-overwrite trap as the step-2 files that morning, caught before rather than after. Ten evidence files exist on disk; four were archived. The remaining six — arv step-3/4/5 and property_notes step-3/4/5 — were copied with `cp -p` and SHA-256 verified. All ten pairs compared: seven match, three differ correctly (arv-step1 and pn-step1 overwritten by the 7/30 capture, arv-step2 by today's write). `pn-step2` matching is independent proof that `write property_notes` never fired — its config guard aborted at exit 30 before any network call.

**DEBT: the six new archive files are on disk and SHA-verified but NOT recorded in `docs/PB_D15_EVIDENCE_ARCHIVE.md`.** The manifest still lists only the four step-1/step-2 records. This is the next session's first task.

**Clear executed and confirmed.** `node app/scripts/inert-proof-arv-step4.cjs` — EXIT=0, PUT status 200, `field_value: ""`. Step-4 does not verify its own clear ("no poll, no verify"), so per PB-D24 a fresh contact GET followed: `customFieldCount` back to 5, `wMBTGWMs97yysQFx7Vad` absent from the id list, `tagCount` still 1. The restoring PUT alone was necessary but not sufficient; the read closes it.

**Spec verification before the clear.** `PHASE_B_SPEC.md` read directly in VS Code: line 338 records the MONETORY clear as RESOLVED 2026-07-28 by the B2 inert-proof — the block states the question was open before the proof and answers it, "It did, and MONETORY followed TEXT." Line 406 (PB-D22) states the `field_value:"" -> KEY_ABSENT` API contract is UNCHANGED and `setARV(contactId, "")` still performs a real clear; what PB-D22 removed is the keystroke. Line 420's "NO way to clear a MONETARY field" is explicitly scoped to the UI. Line 442 (PB-D24) designates `field_value: ""` as the absent-origin restore mechanism. Line 452 records that all three MONETORY candidates are ABSENT on bradt75, making absent-origin rollback provable there deliberately.

**Full round-trip, all three legs verified live:** capture → ARV ABSENT (count 5); write → ARV 187500.25 (count 6, PUT 200); clear → ARV ABSENT (count 5, PUT 200).

**Not closed.** `verify` and `restore` remain stubs — this round-trip used the runner for capture and write, and the hand-written `inert-proof-arv-step4.cjs` for the clear. Because there is no `verify` stage, no today-dated step-3 exists; step-4's `confirmations` gate validated against the Jul 28 step-3 record. Both mutating inputs (`tempValue` from today's step-2, live value from the wire) were current, so the clear was coherent, but the proof chain is not same-day end to end. PB-D24's populated-origin restore remains unexercised.

**Operational fact now load-bearing.** Bash `/tmp/*` paths must be `cygpath -w` converted before being handed to Node — Node resolves `/tmp/` literally to `C:\tmp\`, which does not exist. Write curl output to a literal Windows path when Node will read it.

**Not corrected.** `inert-proof-arv-step4.cjs` lines 16–18 carry a pre-resolution comment stating MONETORY clear semantics are UNKNOWN and describing a step-4b/null fallback that was never needed. Superseded by spec line 338. Same class as the stale PB-D28 registry comment corrected in `d033183`; left as-is here.

**Next.** Record the six step-3/4/5 archive files in `docs/PB_D15_EVIDENCE_ARCHIVE.md`, then implement `verify`.
