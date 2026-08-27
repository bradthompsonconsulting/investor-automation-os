# JEFF BRIEF — Board Item #4, MEASUREMENT PASS ONLY

**Date:** 2026-08-27
**Status:** RELEASED. Authorized by Brad, architecture and risk reviewed by Jess, 2026-08-27.
**Board:** `claude/execution-board-locked-2026-08-26.md` · **Scope:** `claude/board-4-consolidated-scope-2026-08-27.md` (rev 2)

> ## THIS IS NOT A BUILD BRIEF
>
> **NO IMPLEMENTATION. NO GHL MODIFICATIONS. NO PRODUCTION WRITES.**
>
> You are being asked to **measure and report**. The deliverable is a plan, a comparison and a set of objections. Not code, and not a vague estimate.
>
> **Your sequence:** baseline gate -> exhaustive relevant-trigger enumeration -> measurement -> native-vs-softphone recommendation -> **STOP.**

---

# HOW TO READ THIS BRIEF

It is deliberately split in two, and the split matters:

| Section | What it is | Your standing |
|---|---|---|
| **§1 PROVEN CURRENT STATE** | facts, with provenance | **Challenge freely.** If any of it is wrong, say so — that is the most valuable thing you can return |
| **§2 BUSINESS RULINGS** | decisions locked by Brad and Jess | **Not yours to reopen.** Challenge *feasibility* and *cost*, never the decision |

The separation exists so you can tell us an implementation assumption is broken **without accidentally reopening a business decision**. If a ruling in §2 turns out to be technically impossible or disproportionately expensive, say exactly that and stop — do not redesign it.

---

# §0 — BASELINE GATE. RUN THIS FIRST.

**Before any measurement, verify this brief is satisfiable.** On the last brief (#2) your baseline gate caught two defects and **both were Claude's**: "Test, then Production" was not achievable, and the verification sequence was ordered so it could never pass. That was worth more than the work it interrupted.

Assume the same is true here. Specifically check:

1. **Every identifier in §1.8** resolves in Production and matches what the repository binds.
2. **The five workflows in §1.3** exist, are Published, and carry the triggers described.
3. **The trigger population — see §0.1 below.**
4. **§1.9's release constraints** still hold.
5. Anything in §1 you can disprove.

**Report objections before measuring, not after.** If the brief is unsatisfiable as written, say so and stop.

## §0.1 — Exhaustive trigger enumeration, and its scope guardrail

**The correct statement of what we know is not "there are five."** It is:

> **Five disposition-triggered workflows are proven known. The complete `Call Details / Custom disposition` trigger population has NOT been exhaustively enumerated.**

Claude inspected workflows individually and did not run a filter by trigger type. The count moved from four to five once during preparation of this brief. **We are not freezing another number on partial inspection.**

**Task:** enumerate **every** workflow in Production whose trigger is `Call Details / Custom disposition`. The reproducible path is Workflows list -> Advanced filters -> Trigger type -> Is -> *(select the trigger type)* -> Apply. Report the complete population.

**A missed workflow is a guaranteed dead zone** — its handling would silently stop the moment capture moves to IAOS.

### GUARDRAIL — enumeration is DISCOVERY ONLY

**Finding additional `Call Details`-triggered workflows does NOT automatically place them in #4 scope.**

For each workflow beyond the five listed in §1.3, report:

- its name and id
- its trigger filter and its actions
- **whether native disposition capture would affect it, and how**

**Then stop.** Do not migrate it, do not plan to migrate it, and do not fold it into your cutover sequence. **Scope expansion requires Jess and Brad authorization.**

This exists so that *"enumerate everything"* does not quietly become *"migrate everything."*

---

# §1 — PROVEN CURRENT STATE (challenge freely)

Repository facts are from a direct read of `main` @ **`9a299b061a016967bd56650ea27f9f604d220bd1`**. GHL facts are from read-only inspection of Production location **`jmHG4B8RdzwpfqruNf68`** on 2026-08-27. No writes were made to either.

## 1.1 The disposition pipeline already exists and works

Shipped and **verified live 2026-08-07**. This is the single most important fact in the brief: **#4 is mostly not a build. It is a re-wiring.**

- Workflow **`IAOS Webhook Relay`** · `9d1d5cc9-86de-47f7-93b8-f39dc2e4c971` · Published
- Trigger: **Call Details -> Custom disposition**, operator *"contains any of"*
- Action: **standard Webhook** -> `/.netlify/functions/ghl-disposition`, header `X-IAOS-Secret`
- Payload proven: `disposition` (a single string, despite the plural field name), `contact_id`, `duration`
- On fire IAOS writes the note `Call: {disposition} — {duration}s` then calls `setLastCallAttempt`, gated in that order
- **The endpoint returns 502 on attempt-failure so it never 2xx's with the row un-greyed.** GHL retries; dedupe keeps it idempotent

**Deliberate design note (do not "fix"):** the standard Webhook action is used rather than Custom Webhook because Custom Webhook is LC Premium and meters per execution.

**Why it rarely fires:** the trigger depends on the GHL softphone's Call Summary disposition picker, which is transient (~1-2 minutes, unrecoverable). **Brad calls from his cell.** That is the entire problem #4 exists to solve.

## 1.2 Do Not Call is captured by nothing — OBSERVED 2026-08-27

The `IAOS Webhook Relay` trigger filter has **six** values selected:

> No Answer · Voicemail · Follow Up · Requested Appointment · Not Interested · Incorrect Number

The value picker offers **seven**. **`Do Not Call` exists and is unchecked.** There is no *is-not-empty* operator, so every value must be selected explicitly.

**Consequence:** tapping Do Not Call today fires no webhook, writes no note, and sets no `last_call_attempt`.

## 1.3 The five PROVEN KNOWN disposition-triggered workflows

**Not a complete population — see §0.1.** Treat five as the floor.

| Workflow | ID | Action on fire |
|---|---|---|
| `IAOS Webhook Relay` | `9d1d5cc9-86de-47f7-93b8-f39dc2e4c971` | Webhook -> `ghl-disposition` |
| `Seller - Not Interested` | `1d3c0b8e-7ab9-4c3a-8534-6c53b730fe4f` | Find opportunity -> Update opportunity -> **Pipeline Stage: Lost / Not Interested**; Remove from Workflow `Seller 6` |
| `Seller - Follow Up` | `ec9704b4-2800-4469-81df-33bd01d2f9e4` | Find opportunity -> Update opportunity -> **Pipeline Stage: Seller Follow-Up** |
| `Seller - Phone Status Incorrect Number` | `fd07d27e-bb99-4741-89af-4eb470e117f7` | Update contact field -> **Phone Status = "Incorrect Number"** |
| `Seller 2.5 - Routing Requested Appointment Disposition` | `a4951492-2002-427c-bcbb-a227fa826927` | **Add to Workflow -> `Seller 2 - Engagement Detected`** |

All Published. All values read from the action panels directly, not inferred from names.

**Every one of these stops firing the moment capture moves to IAOS.** That is the dead-zone risk in concrete terms.

## 1.4 Contact-field writes are cleared; the pattern is proven twice

Board item #1 established: **exactly one `Contact Changed` workflow exists, scoped to Phone changes only.** It is `Seller - Reset Phone Status on Phone Change` · `236b0435-cb69-4f75-a6a1-a4c1d83b7b0a` — trigger *Contact Changed -> Phone has changed*, condition *if Phone Status is "Incorrect Number"*, action *set Phone Status to Callable*.

So **contact custom field + `Contact Changed` trigger** is a live, working pattern in this account. Relevant to §4.

## 1.5 The IAOS write surface today

Three sanctioned contact-side writes (`docs/CONTACT_WORKSPACE_SPEC_v2.md` §4):

1. `ghl.notes.create()` -> POST `/contacts/{id}/notes`
2. `ghl.contacts.setLastCallAttempt()` -> one PUT carrying `last_call_attempt` **and** `last_call_attempt_precise`
3. `ghl.contacts.setCallbackDatetime()` -> one PUT carrying `callback_datetime` **and** `callback_datetime_precise`

Board #2 added opportunity-side writes: `setARV`, `setEstimatedRepairs`, `setAssignmentMode`, and `saveUnderwritingFields` (End-Buyer Max, Seller MAO, Assignment Mode) — the last verified twice in Production on 2026-08-27 with independent GHL read-back.

**`callback_datetime` is DATE-typed in GHL and truncates time-of-day.** `callback_datetime_precise` (TEXT) exists solely to carry the real timestamp, and `Dashboard.tsx:329` reads Precise first. **Do not build a new date carrier.**

## 1.6 Invariants — §4.1 HARD NO

> **tags · pipeline stage · `offer_*` fields · workflow triggers. IAOS never fires a workflow.**

Load-bearing across the Dashboard, the Contact Workspace and the disposition webhook. **§2 does not relax it.**

## 1.7 Lead Queue mechanics

- **Grey:** a fresh `last_call_attempt` under `RESURFACE_HOURS = 12` (`Dashboard.tsx:50`) greys a row. Notes are **not** read by the grey computation.
- **Return:** on un-grey the row re-enters **Band 1** (attempted-but-no-response), **oldest-first**, so a just-attempted contact sits at the back and works forward.
- **Six cold-outreach exclusions (PB-D54):** escalated · terminal · any scheduled callback (future included) · offer awaiting · Seller Follow-Up stage · `phoneStatus` **exactly** "Incorrect Number".
- **There is NO DND / opt-out / DNC predicate among them.** `optedOutContactIds` exists but is wired only to `visibleUnanswered` (Waiting on Me). PB-D50 scoped itself to Unanswered Inbound deliberately and was never extended.

## 1.8 Identifiers — Production, from `app/shared/ghl-config.ts`

| Key | ID |
|---|---|
| `fields.lastCallAttempt` | `lGoNXM9Wrte4m7ShwQPT` |
| `fields.lastCallAttemptPrecise` | `2vz1igGMxF3wv7HaWm97` |
| `fields.callbackDatetime` | `JeQWtwpwUbvPA50UfuPU` |
| `fields.callbackDatetimePrecise` | `7qRUkZQK8bi2HNo7zDHd` |
| `fields.phoneStatus` | `6WJG2a40490bW0c62YFT` |
| `stages.sellerFollowUp` | `71227a30-2303-4165-aa58-e56860146959` |
| `stages.lostNotInterested` | `f1960b50-8aa2-4a69-ba58-a7a0dc66ce82` |
| `stages.longTermNurture` | `a7436df7-e05a-4bf0-bd29-70f7066ec0bd` |

Ten Seller Leads stages are bound (Gate 4B-2). **Binding a stage id does not make writing stage permitted** — §1.6 still governs.

## 1.9 Release and environment constraints — these bit us last time

- `app/netlify.toml` carries **no context blocks**. One site, one publish target.
- `IAOS_ENV` exists **only** in the Production context, so a Deploy Preview **fails closed at boot** and cannot exercise the app.
- **There is no deployed non-Production IAOS app environment.** **Do not produce a plan whose safety depends on one existing.** Any brief or plan that says "test, then production" for app code is unsatisfiable today.
- `verify-contacts.cjs` and `verify-underwriting.cjs` run against the **live deploy** and gate on a **pinned bundle hash**. They cannot pass before a deploy exists. Correct order: offline checks -> push -> deploy -> confirm publish -> re-pin -> live harnesses.
- **`verify-contacts.cjs` derives its floor as `121 + 4N`** (N = unlocked field count) **+9 for D5 parity, enforced as strict equality.** N=3 currently yields 142. **If #4 unlocks fields, that floor moves and the harness fails until it is updated.** Include this in your estimate — we do not want another false red caused by a legitimate field-count change.

---

# §2 — BUSINESS RULINGS (locked — challenge feasibility only)

Ruled by Brad, ratified by Jess, 2026-08-27.

**R1 — Capture.** IAOS-native disposition control in the Contact Workspace. Call mechanism and business outcome are decoupled. **Fallback:** retain the GHL softphone path temporarily if your measurement shows the coordinated build plus migration is disproportionate. Native is preferred because it matches how Brad works — cell phone plus IAOS.

**R2 — Carrier.** Disposition is stored in durable structured state. The note stays as human history, **never as machine state.** IAOS must never parse its own prose to determine an outcome.

**R3 — Stage writes.** IAOS writes a field; a GHL workflow watches it and moves the stage. §4.1 survives intact. **A tag would violate it** — tags are named in the prohibition, and a tag whose only content is an instruction *is* IAOS firing a workflow. The governing test: *would the thing IAOS writes have a reason to exist if no workflow ever watched it?*

**R4 — The seven dispositions.**

| Disposition | Behaviour |
|---|---|
| No Answer | 60-second routing decision (R5) |
| Voicemail | 60-second routing decision (R5) |
| Follow Up | callback date, default **+3 days**, explicit date/time allowed including same-day · **and** stage -> Seller Follow-Up |
| Requested Appointment | routes to the engaged-seller track. **Distinct from Appointment Booked**, which only a real calendar appointment sets |
| Incorrect Number | Phone Status -> queue exclusion. Uncorrected -> Lost / Not Interested |
| Not Interested | stage -> Lost / Not Interested |
| Do Not Call | terminal outbound suppression, DNC-governed, never auto-resurrected by ordinary engagement |

*Wrong Person* and *Busy / Call Back* are **not** dispositions — caller judgment routes them to existing ones.

**R5 — The routing decision. This replaces all earlier attempt-counter and five-try-ladder language; that design is deleted.**

> No Answer / Voicemail saves the disposition, then presents a **60-second non-blocking** choice: *Stay in Cold Outreach* (default) or *Move to Long-Term Nurture*.
>
> - **Move to LTN** -> write the routing intent; GHL handles the stage.
> - **Nothing selected** -> **do absolutely nothing.** Existing behaviour returns the lead to Cold Outreach naturally.
>
> **There is no attempt count and no elapsed-time cutoff.**

**"Stay" must write nothing.** The disposition and `last_call_attempt` are already written; the 12-hour grey and Band 1 return already produce exactly "stay". **A browser crash therefore produces the correct default**, which is the point of the design — there is no timer to make reliable.

**It is LTN, not Not Interested.** Nobody answered, so there is no evidence of disinterest. *Not Interested* stays reserved for a seller who said so.

**Accepted trade, documented once:** a seller can cycle indefinitely if Brad continually leaves them in Cold Outreach. **That is not a software defect. It is an explicit operator decision offered after every unsuccessful call.** Do not design around it.

**R6 — Follow Up reuses `setCallbackDatetime`.** No new date carrier.

**R7 — Operating hours: 8am-8pm Central, fixed.** Per-contact timezone is **out of IAOS scope** — Brad owns it personally. Jess's scope challenge is accepted:

| | Build? |
|---|---|
| Lead Queue presents callable leads only inside the window, with a clear unavailable state outside it | **Yes** |
| Callback / follow-up picker refuses out-of-window times | **Yes** — IAOS controls the value being written; real enforcement |
| Blocking an actual dial | **No.** IAOS does not place the call. Do not build fake enforcement |

**R8 — Suppression predicate.** Add a seventh cold-outreach exclusion so the Lead Queue can suppress DND/opt-out/DNC contacts. **Standing doctrine: staying A2P compliant takes precedence over all other rules.**

**R9 — Atomicity.** The expanded write set behaves as one operator action. IAOS must not report success while part of the state disagrees. **Follow existing precedent rather than inventing semantics** — the 502-on-attempt-failure pattern in `ghl-disposition`, the gated ordering in the callback path, and `saveUnderwritingFields`' per-carrier reporting where a partial is *named*, not treated as a crash.

---

# §3 — YOUR ASSIGNMENT

**Measure. Do not implement.**

> Determine the **smallest safe #4 cutover** that introduces IAOS-native disposition capture and the durable disposition/routing carriers **while re-pointing the existing GHL disposition-triggered workflows without creating a dead zone** where a captured disposition receives no downstream handling.
>
> Compare that measured implementation and risk against **retaining the existing GHL softphone disposition path temporarily.**

## The dead zone, both directions

- IAOS captures a disposition -> **nothing reacts** (workflows still waiting on the softphone trigger)
- GHL expects the new carrier -> **IAOS is not writing it yet**

**The IAOS control and the GHL trigger migrations are ONE functional release spanning two systems.** Sequencing is the core of what you are measuring.

---

# §4 — THE CARRIER QUESTION (evidence, not instruction)

Jess's explicit challenge:

> *Do we actually need a persistent routing carrier for the one-time "Move to LTN" command, or is there an existing safe carrier/event pattern we can reuse without violating the no-direct-stage-write invariant? Don't invent infrastructure merely because we've named a field.*

**Claude's evidence — offered so you do not start from zero. Confirm or refute it during measurement.**

- **Contact custom field + `Contact Changed` trigger is a proven pattern** in this account (§1.4), and contact-field writes were cleared in #1.
- **Tags are prohibited** by §4.1 and by R3's test.
- **Opportunity-field-change trigger availability is UNVERIFIED.** Claude did not confirm whether GHL exposes such a trigger type. If it does, an opportunity-side carrier may be viable and is worth pricing.
- **A GHL workflow needs something durable to trigger on**, which is why the carrier appears unavoidable rather than merely convenient.

**Therefore a contact-field carrier appears to be the smallest known solution — but that is Claude's read, not a decision.** Refute it if you find something cheaper or safer.

Specifically price **one carrier or two**: disposition and routing are orthogonal facts about the same call (*disposition = No Answer*, *routing = LTN*), which suggests two — but a single field with composite values may be cheaper. **Measure it; do not assume two new fields is the smallest implementation.**

---

# §5 — BOUNDED UNRESOLVED — neither blocks this measurement

| Item | Gates | Status |
|---|---|---|
| Does any GHL workflow read or write the `Follow Up Date` contact field? | **B5 only** (retiring that field) | Brad's read, not yours |
| Does the `seller-lead` tag survive a move to Lost / Not Interested? | **B3 only** (uncorrected Incorrect Number -> Lost). `Seller 2` resurrection is gated on that tag | Brad's read, not yours |

Do not chase either. Note them if they intersect your sequencing.

---

# §6 — DELIVERABLE

Return exactly this. Not code. Not a vague estimate.

1. **Baseline-gate objections** — everything in §1 you can disprove
2. **Complete `Call Details / Custom disposition` trigger population** — with, for each workflow beyond the five in §1.3, its trigger, its actions, and whether native capture would affect it. **Report only. Do not scope them in** (§0.1 guardrail)
3. **Smallest safe native-capture cutover sequence** — ordered, with the dead-zone-free property argued explicitly
4. **Exact IAOS and GHL surfaces affected** — files, functions, workflows, fields
5. **Carrier recommendation** — your answer to §4, with one-carrier-or-two priced
6. **Native vs. softphone comparison** — cost and risk, side by side
7. **Identified dead-zone and partial-failure risks** — including how R9 atomicity is satisfied
8. **Recommendation:** is native capture small and safe enough to authorize now, or do we take the fallback and move toward Dollar #1?

---

# §7 — HARD PROHIBITIONS

- **NO IMPLEMENTATION.** No code changes, no commits, no pushes.
- **NO GHL MODIFICATIONS.** No workflow edits, no trigger changes, no field creation, no publishing.
- **NO PRODUCTION WRITES** of any kind.
- **Do not modify** `.claude`, `.claude.json`, `CLAUDE.md` or related instruction/configuration files.
- **Do not expand scope** on the strength of enumeration alone (§0.1).
- **Do not reopen** Seller 8 / Long-Term Nurture. Ruled: intended lifecycle behaviour, not an incident, not a work item.
- **Do not reopen** any §2 ruling. Challenge feasibility and cost only.
- **Do not rerank the board.** #4 -> #5 -> rerank, in that order.

**Repository-state claims must come from a direct current read with the SHA identified — not from memory, stale mirrors, or old conversation summaries.**

If anything here is unsatisfiable, **say so and stop.** That is the most useful thing you can do, and it is what happened last time.
