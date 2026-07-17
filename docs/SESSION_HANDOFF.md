# IAOS — Session Handoff (2026-07-17)

**Read first, in the repo (I have NOT paraphrased their contents here — read them directly):**
`docs/IAOS_Master_Architecture_Reference_V10_2.txt` (master ref, internally v10.3), `docs/DASHBOARD_SPEC_v2.txt`, `docs/CONTACT_WORKSPACE_SPEC_v2.md`, `docs/CONVERSATIONS_SPEC.md`, `docs/CALENDARS_SPEC.md`. The master ref §2a is the locked Coverage Roadmap: **Dashboard → Conversations → Calendars → Contacts/Opportunities** (order is locked; a Contact Workspace surface was built between Dashboard and Conversations as *build history*, not a roadmap re-sequence).

**Where things stand:** surfaces **#1 Dashboard, #2 Conversations (read-only), #3 Calendars (read-only)** are DONE + verified live. Contact Workspace §8 steps 1–7 also done (workspace spec §9.3–9.5). **Next roadmap surface: Contacts/Opportunities** (full create/edit/manage depth). The read-only phases shipped; the WRITE phases (Conversations send/compose + unread management, Calendars booking/reschedule + availability) are separately-scoped later steps, not built.

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
- **Build-ignore rules (853710c app `-- .` / 90b3810 marketing `':(exclude)docs'`) confirmed skipping BOTH sites on FOUR separate docs-only commits** (Brad-verified off the deploy logs). Docs-only commits now cost zero builds. Failure signature: app rule can only ever STOP skipping (harmless); if a real `app/` code commit ever shows "Skipped", stop and re-derive.
- No Netlify dashboard/CLI/API access from the agent; Brad reads deploy logs / dashboard.

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
