# IAOS — Session Handoff (2026-07-17)

**Repo tip (updated 2026-07-21): `cc06568` on `main`, pushed; prod app bundle `Bg9d3CqX`** (unchanged — `cc06568` is a pure-docs commit; both Netlify builds Canceled per the build-ignore rules). The Conversations navy-header **banner** is built out through **§8.10**: the selected contact's name renders LARGE (22px) indented under the Notes column, in one card with the Workspace / Reply-in-GHL / **Call** action links. **§8.10 Call button VERIFIED LIVE 24/24** (`CONVERSATIONS_SPEC.md` §6.9; harness floor now **24**, bundle `Bg9d3CqX`). Call + Reply BOTH tab-hop to the GHL contact-detail page (reused `ghlContactDetailUrl`, no new URL); there is **no in-app dialer — GHL exposes none** (recon 2026-07-21, OBSERVED: the softphone is an in-UI click, not a deep-link). Still **READ-ONLY — zero writes**, three-write invariant untouched. Banner history: §8.9 name-in-banner (§6.7) → name indent (§6.8) → §8.10 Call (§6.9). **Next roadmap surface: Contacts/Opportunities** (master ref §2a; full create/edit/manage depth).

**Read first, in the repo (I have NOT paraphrased their contents here — read them directly):**
`docs/IAOS_Master_Architecture_Reference_V10_2.txt` (master ref, internally v10.3), `docs/DASHBOARD_SPEC_v2.txt`, `docs/CONTACT_WORKSPACE_SPEC_v2.md`, `docs/CONVERSATIONS_SPEC.md`, `docs/CALENDARS_SPEC.md`, `docs/CONTACTS_OPPORTUNITIES_SPEC.md` (surface #4 — §4-v3 write invariant only so far; see the surface-#4 block below). The master ref §2a is the locked Coverage Roadmap: **Dashboard → Conversations → Calendars → Contacts/Opportunities** (order is locked; a Contact Workspace surface was built between Dashboard and Conversations as *build history*, not a roadmap re-sequence).

**Where things stand:** surfaces **#1 Dashboard, #2 Conversations (read-only), #3 Calendars (read-only)** are DONE + verified live. Contact Workspace §8 steps 1–7 also done (workspace spec §9.3–9.5). **Surface #4 Contacts/Opportunities is STARTED — spec only, no code (see the surface-#4 block below).** The read-only phases shipped; the WRITE phases (Conversations send/compose + unread management, Calendars booking/reschedule + availability) are separately-scoped later steps, not built.

## Surface #4 — Contacts/Opportunities (STARTED 2026-07-21; spec only, NO code)
`docs/CONTACTS_OPPORTUNITIES_SPEC.md` now exists. Only **§4-v3 write invariant** is committed (`cc06568`); **sections 0–3 and 5+ are undrafted** and deliberately left unwritten until the write class is locked. This is the first surface that EDITS contact fields — a materially larger write surface than every prior (read-only or three-write) phase.

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
- **OPEN read-path question (UNRESOLVED):** `/opportunities/search` **rejects `contactId` with HTTP 422** — how to fetch a given contact's opportunities (the contact→opportunities read) is **not yet resolved**. Settle before drafting the read view.

## Commit map (this session, oldest → newest; all on `main`, pushed)
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
