# IAOS — CALENDARS SPEC v1

Status: read endpoint PROBED live 2026-07-17 (OBSERVED, from the wire); the read VIEW is NOT built. Coverage Roadmap surface after Conversations (master ref §2a, locked order Dashboard → Conversations → Calendars → Contacts/Opportunities). **GHL-FIRST invariant applies** (master ref §2a): surface what GHL returns, build nothing GHL already does.

## 0. LOCATION CALENDARS (OBSERVED 2026-07-17)

3 active calendars: `7W0xCZbReQp7Tq2NnmYl` "Seller Calendar Consultation", `kpY7Ut88pwl3NayutSFa` "Buyer Calendar Consultation", `nx8oeOVysifoyJaSdUlB` "Investor Calendar Consultation". Calendar groups empty. **No calendar netlify function exists yet** — Calendars starts from zero on the function side (unlike Conversations, whose functions pre-existed).

## 1. READ ENDPOINT — OBSERVED FINDINGS (from the wire, 2026-07-17)

1. **`/calendars/events` (v2021-07-28) returns APPOINTMENTS ONLY.** The Google-sync "Busy" blocked slots visible in GHL's Manage view are NOT in the API response under any scoping tried (calendarId or userId). **API and UI diverge.** Where the block slots surface is **UNKNOWN — not found, not guessed.** Consequence: the app renders what the endpoint returns; **no client-side mirror-filtering is needed.**
2. **Scope IS required.** `locationId` alone → **HTTP 422**. Must pass one of `calendarId` / `userId` / `groupId`. `calendarId` and `userId` are **equivalent** — both returned the same 2 appointments.
3. **GHL QUIRK — status field shipped TWICE.** Every event carries both the correctly-spelled `appointmentStatus` and the misspelled `appoinmentStatus`, both `"confirmed"`. **Read the correctly-spelled one; never rely on the misspelling, and never assume it stays present.**
4. **The earlier "zero appointments over ±365" was accurate for the calendar's state at the time** — the identical `calendarId` query returned 0 then, 2 now; both appointments have `dateAdded` `2026-07-17T20:50Z` via `createdBy.source="booking_widget"`. **NOT a scoping artifact.** Caveat preserved: a GHL-side consistency lag cannot be 100% excluded.
5. **Baseline for build verification:** Jul 20 holds exactly **2 confirmed appointments**, contact **Brad Thompson** (`9fbH2VCcZvzVNhsR9zjc`): `PZdh1iE9jZ55wDRL8qcL` 09:00–09:45 CDT, `fvAktDkilpq3nxp8ZWuS` 12:00–12:45 CDT (both calendar `7W0xCZbReQp7Tq2NnmYl`, `assignedUserId` `CE0Z1lk5t4ftMF9YfEr9`, `createdBy.source="booking_widget"`).

## 2. WRITE SCOPE (from master ref §11 SCOPE PROBE, 2026-07-17)

Calendars WRITE = **OBSERVED present** (`POST /calendars/events/block-slots` → 400 "not an event calendar", NOT 401; zero side effects, nothing created). **Caveat (verbatim):** block-slots proved write access to `/calendars/events/`; an actual appointment creation succeeding end-to-end is INFERRED from shared scope, NOT separately observed. Booking/reschedule is a separate later phase — and per GHL-FIRST, the DEFAULT is to surface GHL's booking widget, not rebuild a booker.

## 3. READ VIEW — PLAN (approved 2026-07-17; no code yet)

**Scope:** surface the appointments GHL returns. Read-only. No booking, no availability logic, no block-slot rendering — GHL owns all of those.

**Data path:** a new read-only function (none exists yet) — `ghl-calendar-events`: takes a time window; **fans out over the 3 calendarIds** and merges. Rationale (OBSERVED): the endpoint 422s without a scope param, and `calendarId`/`userId` are equivalent, so fan-over-calendarId is the explicit, OBSERVED-correct choice — 3 bounded GETs, same pattern as Mailers fanning over contacts (§14f). Normalizes each event, **reading the correctly-spelled `appointmentStatus`** (never `appoinmentStatus`), plus title / startTime / endTime / contactId / calendarId / assignedUserId / notes. Returns appointments only — **no client-side mirror-filtering** (the API doesn't return the "Busy" slots). Uses the prod token (`GHL_PRIVATE_API_KEY`, calendars-read OBSERVED). Zero writes. Default window: upcoming (today → +30 days); the endpoint requires start/end, so it's a param with a default.

**Surface:** new route `/calendars` + nav item. Per GHL-FIRST it is an **agenda / list of upcoming appointments** (what GHL returns), grouped by day — **NOT a rebuilt calendar-grid booker.** Each row: date/time, calendar name (Seller / Buyer / Investor), contact name → deep-link to `/contacts/:id` (reuse the step-7 `Link` pattern), status, notes.

**What we deliberately do NOT build (GHL-FIRST) — do NOT relitigate:** the booking widget (GHL's), availability computation (GHL's), and the Google-sync "Busy" mirrors (not in the API; UI-only). Booking/reschedule is a separate later **write** phase, and its default per GHL-FIRST is to **surface / embed GHL's booking widget, not rebuild a booker.** A future thread will be tempted to build a grid booker or an availability engine — this line says don't; surface what GHL already does.

**Verification baseline (from §1 finding #5):** a window covering Jul 20 must render **exactly the 2 confirmed appointments** — Brad Thompson `9fbH2VCcZvzVNhsR9zjc`, `PZdh1iE9jZ55wDRL8qcL` 09:00 and `fvAktDkilpq3nxp8ZWuS` 12:00 — scoped by explicit calendarId, correct `appointmentStatus` read, zero writes, no listAll. Bundle gate §9.2, floor = the literal counted `check()` count.

## 4. OPEN ITEMS

- **userId scope span — UNKNOWN (named, not chased).** Whether a `userId` query returns appointments across ALL calendars a user is assigned to is UNKNOWN — only Seller-calendar appointments were OBSERVED under `userId` (2026-07-17). Fan-over-calendarId (§3) sidesteps it for v1; it matters for the multi-user SaaS shape later. Verify before relying on `userId` scoping for a location-wide read.
