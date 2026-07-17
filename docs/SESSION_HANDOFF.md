# IAOS — Session Handoff (2026-07-17)

**Read first, in the repo (I have NOT paraphrased their contents here — read them directly):**
`docs/IAOS_Master_Architecture_Reference_V10_2.txt` (master ref, internally v10.3), `docs/CONTACT_WORKSPACE_SPEC_v2.md`, `docs/CONVERSATIONS_SPEC.md`, `docs/DASHBOARD_SPEC_v2.txt`. The master ref §2a is the locked Coverage Roadmap: **Dashboard → Conversations → Calendars → Contacts/Opportunities** (order is locked; a Contact Workspace surface was built between Dashboard and Conversations as *build history*, not a roadmap re-sequence).

**Where things stand:** Dashboard ✅, Contact Workspace §8 steps 1–7 ✅ (verified live, specs §9.3–9.5), Conversations **read-only** ✅ (verified live, `CONVERSATIONS_SPEC.md` §6.1/§6.2). **Next roadmap surface: Calendars.**

## Commit map (10 commits this session, all on `main`, pushed)
- `2147900` — master ref: §2a roadmap reverted to the locked sequence (a prior draft had wrongly re-sequenced it).
- `c3dd42a` — Conversations read-only code (6 files: `ghl-conversations.ts` +`?scope=all` branch, `ghl.ts` `ThreadRow`+`threads()`, `App.tsx` route, `Sidebar.tsx` nav, `Conversations.tsx` new, `CONVERSATIONS_SPEC.md` new).
- `df0fbd1` — verification record, `CONVERSATIONS_SPEC.md` §6.1: 10/10, floor 10, 4× clean (a pre-fix 8/10 recorded honestly as a superseded harness-timing FAIL).
- `159a269` — master ref: Conversations §2a → DONE (read-only); sequence unchanged.
- `0804767` — email-bubble collapse (`CLAMP_LINES=5`, CSS line-clamp + Expand-on-overflow, LOCAL `MessageBubble` in `Conversations.tsx` — NOT a shared component; `ContactWorkspace.tsx` untouched) + unread-badge record correction.
- `e8f87c2` — verification record, `CONVERSATIONS_SPEC.md` §6.2: 13/13, floor 13.
- `853710c` — **app** `netlify.toml` build-ignore rule.
- `90b3810` — **marketing** (root) `netlify.toml` build-ignore rule.
- `6550bcc` — corrected the token env-var record (ghl-proxy header + master ref §11).
- `2443ccf` — recorded Calendars WRITE finding + four-way-secret partly-resolved (docs-only; confirmed skipped both builds).

Earlier this session (already in the specs, not re-detailed here): Call button `dc60d1e`, disposition webhook `6fa154c`, name-click `becaa17`.

## Credential map — RESOLVED
- **Prod runs on `GHL_PRIVATE_API_KEY`** = the canonical PIT ending **…d0f7** ("IAOS Netlify Integration" in GHL). All 9 GHL-talking functions read `GHL_PRIVATE_API_KEY ?? GHL_API_TOKEN`; with both set on the app site, `GHL_PRIVATE_API_KEY` always wins → **`GHL_API_TOKEN` is a dead fallback that never engages.**
- `app/.env`'s `pit-b2e9…` is **"Jeff the Bot's" separate build-phase integration — NOT a prod mismatch.** Do not treat it as prod.
- **Scope LIST still UNKNOWN** — the GHL UI wizard-gates it (not exposed). I have no Netlify dashboard/CLI access; do not infer scopes from `app/.env`.

## Scope findings (OBSERVED, 2026-07-17)
- **Calendars WRITE = OBSERVED present.** `POST /calendars/events/block-slots` returned **400 "The calendar is not an event calendar"** (business validation), **not 401** (scope denial) → token carries `calendars/events` write scope. Zero side effects, nothing created. **Caveat (verbatim):** *block-slots proved write access to /calendars/events/; an actual appointment creation succeeding end-to-end is INFERRED from shared scope, NOT separately observed.*
- **Conversations WRITE = UNTESTED, not absent.** The only write path is `POST /conversations/messages`, which would send a real message — no safe no-op equivalent. Recorded as untested.
- Observed scopes to date: contacts R+W, conversations R, calendars R, calendars/events W.

## Calendars read-side (for when that surface is scoped)
- **3 active calendars:** `7W0xCZbReQp7Tq2NnmYl` "Seller Calendar Consultation", `kpY7Ut88pwl3NayutSFa` "Buyer Calendar Consultation", `nx8oeOVysifoyJaSdUlB` "Investor Calendar Consultation".
- **0 appointments** in ±1yr on all three. Calendar groups empty.
- **No calendar netlify function exists yet** — Calendars starts from zero on the function side (unlike Conversations, whose functions pre-existed).

## The two Netlify ignore rules (confirmed working)
- **App** (`app/netlify.toml`, base dir = `app/`, Netlify runs ignore from base): `ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- ."`. `-- .` scopes to `app/`. Fails safe (if ever run from root → always builds; can't skip-all real code).
- **Marketing** (root `netlify.toml`, no base → runs from repo root): `ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- ':(exclude)docs'"`. Skips only when every changed file is under `docs/`. Deliberately does NOT exclude `app/` (marketing build command is UI-set, unverifiable from repo → fail-safe over optimal).
- **Failure signatures to watch:** app rule *stops skipping* (builds on docs commits) → harmless, just no savings. Marketing rule builds on a docs-only commit → pathspec issue; a real (non-docs) change getting skipped → can't happen by the logic. If a real `app/` code commit ever shows "Skipped" in the app deploy log, stop and re-derive — but base=app/ is confirmed today.
- **Confirmed OBSERVED 2026-07-17** from the deploy logs: both sites skipped `2443ccf` — app `-- .` exit 0 / 1.745s / no build; marketing `':(exclude)docs'` exit 0 / 1.723s / no build; Deploying/Cleanup/Post-processing skipped on both.

## Send-test fixture (available)
Brad is a clean GHL contact — **bradt75@gmail.com / 214-914-6151, no DnD.** Use as the fixture for the Conversations **send** test (and any authorized write test), so no seller is touched.

## Open items carried (none blocking)
- **Send/compose path + unread management** (Conversations write phase — not scoped/built).
- **Step 6 live dispositioned call** — a real softphone call → Custom-Disposition tap (within ~1–2 min, §5.2 transient prompt) → published Workflow → `ghl-disposition`. IAOS side proven; GHL side never fired live.
- **Outbound-SMS render** — code-correct, not live-verified (zero outbound SMS in location). Trigger: first observed outbound SMS thread.
- **Short-email sub-branch** — `collapsible=true && overflowing=false` unverified (no email under 5 lines exists; all 71 are 874+ chars). Narrow gap; button-absent IS proven via the SMS path.
- **STOP anomaly** — john sanchez `05gYdxJcyNTCKWTwkbbs` has an inbound SMS "STOP" with no preceding outbound SMS in `/messages`; unresolved whether the endpoint drops outbound SMS or none was sent.
- **7 unauthed netlify functions** + `Access-Control-Allow-Origin: *` — deferred by Brad's call while single-tenant; trigger to fix = first user who isn't Brad, not a lead count. (`ghl-disposition` is the exception — authed via `X-IAOS-Secret`.)
- **listAll lowercase names** — `ghl-contacts` returns names lowercase; Dashboard shows all names lowercase (cosmetic, unfixed, cause unproven).
- **2026-07-07 pipeline rows** — two `TYPE_ACTIVITY_OPPORTUNITY` rows flipped `New Lead ↔ Seller Offer Sent`; something carrying the IAOS credential moved stages. Cause unproven; do not design a fix against it.

## The method (how Brad works — follow it)
- **Per-command approval is always option 1** — Brad reviews the diff before every commit. Show the raw diff, nothing staged, and **wait**. Never `git add && commit && push` before he's read it.
- **Give one recommendation, not a menu of options.**
- **Bundle gate = §9.2:** build the commit AND its parent, prove the hashes discriminate, poll prod to the expected hash, re-assert at runtime. "Hash changed" ≠ "your code is live."
- **Verification floor = the literal counted `check()` count** in the harness (counted from the file, never estimated — it's been off-by-one when guessed).
- **OBSERVED vs INFERRED on every line.** If you can't observe it, say UNKNOWN and stop — don't infer (esp. credentials/scopes).
- **Poll to convergence, never fixed-wait** (§11: listAll lag measured 11s–105s+, variable).
- Don't round a partial/failed run up to a clean one in the permanent record.

## Open decisions for Brad (raise before building the write phases)
1. **Does the Conversations SEND write join the three-write invariant, or is it a separate write class?** (The invariant today is notes + last_call_attempt + callback; send is a new outward-facing write to a seller.)
2. **Same question for Calendars BOOK/reschedule** — new write class, or folded into the invariant? Both must gate on DnD (john sanchez's "DnD enabled by customer" is the live example).
