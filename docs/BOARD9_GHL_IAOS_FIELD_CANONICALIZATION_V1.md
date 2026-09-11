# Board #9 GHL/IAOS field canonicalization — B9-07A / INV-70, Phase 1

## What this is

The inventory and proposed canonical mapping INV-70 requires, before any
further Board #9 coding (INV-63 through INV-67) resumes. Confirmed
duplication exists across GHL Contact fields, Opportunity fields, and IAOS
code for several business facts (ARV, Asking Price, Offer Price, Offer
Date, Offer MAO / MAO, Offer Repair Total / repair estimates, Offer
Wholesale Fee, Offer Margin, and others this document adds). The goal is
one authoritative carrier per actual business fact, per the governing
ownership rule: Contact owns seller identity and communication facts;
Opportunity owns property, deal economics, underwriting, offer, contract,
execution and closing facts.

**This is Phase 1: inventory and proposed mapping only.** It authorizes no
GHL field creation, edit, rename, migration, archival or deletion; no
application code change; no workflow or configuration change; no PR. GHL
access used to produce this document was strictly read-only (`GET`
requests only, IAOS Test location `SoTgVoaFGHtBdRFvXWQV`). Every
classification below is a finding about what exists, not a decision about
what should be built. Where evidence does not reach an answer, that is
recorded as an open question or a conflict for Brad/Jess to resolve —
**never silently resolved here.**

**Method**, mirroring the established precedent in
`docs/BOARD8_ECONOMICS_INVENTORY_V1.md` (B8-02) and
`docs/BOARD9_CONTRACT_INVENTORY_V1.md` (B9-02): every claim cites a file
and line number (code, read directly from the working tree on
`inv-70-b9-07a-canonicalize-fields`, branched from authoritative
`origin/main` at `26a3a3352734e71ddbd710c509f085b4838eea9b`), a document and
section (a locked decision), a live read-only GET actually issued this
session against IAOS Test, or an explicit grep with a stated "no matches"
result (verified absence). OBSERVED / INFERRED / UNKNOWN is used
throughout per `docs/FOUNDATIONAL_PRINCIPLES.md`.

A great deal of this canonicalization work already happened, correctly,
under Board #8 and Board #9's own inventories (`BOARD8_ECONOMICS_
INVENTORY_V1.md`, `BOARD9_CONTRACT_INVENTORY_V1.md`, and the decisions in
`docs/PHASE_B_SPEC.md`). This document does not re-litigate those rulings.
Where a fact family is already fully resolved, it is restated with its
citation, not re-derived. Where INV-70's premise (confirmed duplication)
turns out to be **already-ruled, deliberate separation** rather than an
unresolved duplicate, that distinction is stated plainly — collapsing a
ruled distinction into "duplication" would be its own error.

---

## Inventory summary

**Live GHL Test location (`SoTgVoaFGHtBdRFvXWQV`) read-only GET, this
session:**

- `GET /locations/{id}/customFields` → **109 Contact custom fields**
- `GET /locations/{id}/customFields?model=opportunity` → **16 Opportunity
  custom fields**
- 8 folders resolved by parentId (6 Contact-model: Additional Info, IAOS
  Onboarding, General Info, Offer, Contact, Form | IAOS Client Intake
  Form; 2 Opportunity-model: Offer, Opportunity Details)

**Duplicate/near-duplicate families identified: 9** (named families 1–7
below, matching the rollover's list, plus 2 additional families this
document adds per its "do not assume the list is complete" instruction:
Closing Costs field-vs-value naming collision, and Contact-side deal-
economics fields sitting outside the stated ownership rule).

**Already fully resolved by existing locked decisions (no further Phase-1
finding needed, restated only): 0 of the 9** — every family below carries
at least one open question, a live conflict, or a confirmed dead-writer
condition that INV-70's gate exists to catch. Two families (ARV, Asking
Price) have a **clean, working canonical/seed pattern already in
production use** — their "finding" is that the pattern is healthy, not
that it needs to change.

**Fields requiring migration or a backfill decision: 1 confirmed
(Repairs)**, with a second (the "presented offer" family, 14 fields)
pending a prior architecture decision (Current Offer / negotiation-state
carrier) before migration planning is even possible.

**Immediate integrity finding, unrelated to duplication:** the entire
7-key "presented offer" `offer_*` family (14 field ids: 7 keys × 2 models)
exists as **hardcoded literals inside `app/src/pages/MaoCalculator.tsx`**
and is **not present in `app/shared/ghl-config.ts`** at all — a direct
exception to PB-D51's rule that "identifiers move into the shared
configuration module rather than being copied from this file into call
sites" (`docs/UNDERWRITING_FIELD_REFERENCE.md:12-16`). This predates
INV-70 and is recorded here because it bears directly on canonicalization:
one of these 14 ids cannot be found by grepping `ghl-config.ts`, which is
exactly the blind spot that lets a duplicate go unnoticed.

---

## Family 1 — ARV / After Repair Value

**Status: RESOLVED pattern, already in production use. REUSE.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| ARV (deal authority) | Opportunity | `opportunity.arv_after_repair_value` | `cBkygqcHRseZUGCYYeba` / `ppe2ZTO7DJTMao74xvYI` | NUMERICAL | Opportunity Details |
| ARV (seed) | Contact | `contact.arv` | `wMBTGWMs97yysQFx7Vad` / `QkWl09I9yXGz8OIcs5Xd` | MONETORY | Additional Info |
| Offer ARV | Contact | `contact.offer_arv` | `Z88Y6IqCK1i7hObZcrQM` / `VQaObD0PsDjPbsEknHK5` | NUMERICAL | Offer |
| Offer ARV | Opportunity | `opportunity.offer_arv` | `Nm1LZvQzaCGvXDq7TRCh` / `2zjZh6Ma4DQX77UBWgCN` | NUMERICAL | Offer |

**Ruling (PB-D55, restated from `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
"ARV" row):** Opportunity owns underwriting ARV once approved; Contact
`arv` is a one-time seed consulted only when the Opportunity field is
absent, never re-consulted once approved underwriting is written, never
mirrored back. **Readers:** `parseOpportunityValues` / `parseContactSeeds`
(`app/src/lib/underwriting/resolver.ts:224-272`), `resolveDealFacts`
(`resolver.ts:312-333`). **Writer:** `setApprovedArv`
(`app/src/lib/ghl.ts:933-965`), gated by `arvPersistGate` and recorded by
`persistApprovedArv` (`app/src/lib/arv-persist.ts:48-146`), wired into
`app/src/components/ArvCompsWorkspace.tsx`. **Inert-proofed** in IAOS Test,
2026-09-04, PB-D62.

**The two `offer_arv` fields are a distinct fact** ("presented offer," see
Family 5) — not part of this canonicalization, but listed here because the
name collision is exactly the kind of thing a superficial grep would
conflate with deal-authority ARV.

**Proposed canonical carrier:** `opportunity.arv_after_repair_value`
(already canonical; no change proposed). **Retirement candidates:** none
— `contact.arv` remains a legitimate, intentional seed, not dead weight.
**Conflict-handling rule (already in force):** Opportunity value, once
written, is permanent; Contact fallback is consulted only when Opportunity
is absent, and is never used to overwrite. **Compatibility/rollback
risk:** none identified — this pattern is live and proven.
**Unresolved questions:** none for this family specifically.

---

## Family 2 — Asking Price

**Status: RESOLVED pattern, already in production use. REUSE.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Asking Price (deal authority) | Opportunity | `opportunity.asking_price` | `YxCDaX7dLhBJL9GLGFpJ` / `owIOWnJuIheiwJVdJWQ5` | NUMERICAL | Opportunity Details |
| Asking Price (seed) | Contact | `contact.asking_price` | `60UCjsYT1Ak3Kyy5ZCL8` / `Oeo3jPhh3ICnU7Cv1iTT` | MONETORY | Additional Info |

**Ruling:** identical seed-then-supersede pattern to ARV
(`docs/PHASE_B_SPEC.md:1787-1797`, PB-D55). **Writer (Opportunity):**
`setAskingPrice`, inert-proofed PB-D60, 2026-08-29
(`docs/UNDERWRITING_FIELD_REFERENCE.md:85`). **Contact-side note, exact
as recorded:** PB-D35 designated `contact.asking_price` for its own
inert-proof cycle (2026-08-04) and `docs/FIELD_REGISTER.md:23` records its
write column as "Proven" while also noting "no UI editor and no named
setter" — i.e. the field was proven writable via the inert-proof harness,
but no standing application write path exists for it today. This is not a
contradiction this document resolves; it is restated exactly as found.

**Proposed canonical carrier:** `opportunity.asking_price` (already
canonical). **Retirement candidates:** none. **Conflict-handling rule:**
same as ARV. **Compatibility/rollback risk:** none identified.

---

## Family 3 — Repairs / Estimated Repairs / Repair Estimate

**Status: OPEN GAP — the aspirational canonical carrier has no writer, and
the field actually operative in production differs from the one the
architecture names as authoritative. This is the clearest real instance of
the condition INV-70 exists to catch.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Repair Estimate (named deal-authority carrier, PB-D55) | Opportunity | `opportunity.repair_estimate` | `hId4Yog6u5GP1Iwz1aNx` / `lSWxFUmWksfrViePG4UC` | NUMERICAL | Opportunity Details |
| Estimated Repairs (actually-operative carrier) | Contact | `contact.estimated_repairs` | `OQnud97MfdxMcTgMVTgf` / `SU4n8ylrXnUm8xDi729R` | MONETORY | Additional Info |
| Offer Repair Total | Contact | `contact.offer_repair_total` | `2EpRGXb8rj4RtHfFhYbB` / `G3qYa7TSwvKLI4uZJ2XA` | NUMERICAL | Offer |
| Offer Repair Total | Opportunity | `opportunity.offer_repair_total` | `XbW0B973nuaLtIjMkzO9` / `5mmCNT6zM5tGNeAQutbW` | NUMERICAL | Offer |

**The gap, exact, restated from `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
"Repairs" row (lines 44-58):** `opportunity.repair_estimate` is PB-D55's
named Opportunity-side deal-authority carrier, but it has **no writer,
verified absent** — `Grep "setRepairEstimate\|repair_estimate\|
opportunityFacts.repairs"` against `app/src/lib/ghl.ts` returns no
matches, independently corroborated by `docs/UNDERWRITING_FIELD_
REFERENCE.md:84` ("Inert proof: none, Named writer: none"). The field
Board 6's repair estimator actually approves and writes to is
`contact.estimated_repairs`, via named writer `setEstimatedRepairs`,
gated by `persistGate` (`app/src/lib/repair-estimation/persist.ts:47-65`,
Board 6 / INV-13). Because `resolveDealFacts`'s seed-then-supersede path
(`resolver.ts:327`) reads Opportunity first and Contact only when
Opportunity is absent, and Opportunity is **never populated because
nothing writes it**, **Contact `estimated_repairs` is, in practice, the
repairs figure underwriting resolves from today for every deal** — not a
seed-and-forget convenience as designed, but the sole operative path.

**Readers:** `resolver.ts:327` (seed-then-supersede),
`app/src/lib/seller-call-readiness-inputs.ts:20-23` (explicitly comments
on this exact gap), `app/scripts/test-seller-call-workspace-wiring.cjs:
568-570` (test asserts the Contact-side wiring specifically because
`repair_estimate` "has no writer"), `app/src/pages/UnderwritingWorkspace.
tsx:546,764,773,811`, `app/src/pages/DealCalculator.tsx:82`,
`app/src/config/additionalInfoSubgroups.ts:70`. **Downstream consumer:**
Board 9's contract-facing `OutcomeSnapshot` (`app/src/lib/seller-call-
outcome.ts:67-76`) copies `repairs` verbatim at Agreement Reached — so
this gap's actual value silently flows into every Board 9 contract fact
snapshot today, sourced from Contact, not Opportunity.

**Related, distinct fact:** `offer_repair_total` (Contact and Opportunity)
is the "presented offer" snapshot (Family 5), not this family's deal
input — same dead-writer status as the rest of that family.

**Proposed canonical carrier:** does not choose between the two — **this
is exactly the kind of conflict this document must not silently resolve.**
Two live options, stated with their tradeoffs:
- **(a) Formally re-designate `contact.estimated_repairs` as canonical**
  for repairs, retire the aspirational role of
  `opportunity.repair_estimate` (leave the field in place, orphaned,
  documented as superseded — GHL field deletion is out of scope and risky
  per the existing "deliberate, time-boxed duplicate" precedent at
  `docs/PHASE_B_SPEC.md:2266-2276`). Lowest migration cost: zero data
  movement, zero new writer, matches what already runs in production.
  Breaks the "Opportunity owns deal economics" ownership rule as stated
  in the rollover, for this one fact, unless the rule is read to permit an
  Opportunity-first-then-Contact-seed pattern collapsing to Contact when
  Opportunity has no writer.
- **(b) Build the missing Opportunity-side writer** (a `setRepairEstimate`
  analogous to `setApprovedArv`/`setAskingPrice`) and migrate existing
  Contact `estimated_repairs` values onto the Opportunity carrier for
  every deal that has one, matching the ARV/Asking-Price pattern exactly.
  Higher cost (new writer, its own inert-proof cycle, a backfill pass
  deciding what happens to Contacts with no Opportunity), but brings
  Repairs into architectural parity with ARV and Asking Price and honors
  the ownership rule as written.

**Migration/backfill plan:** not proposed here — it depends entirely on
which of (a)/(b) is chosen, which is a product/architecture decision, not
a Phase 1 finding. **Conflict-handling rule:** N/A until (a) or (b) is
decided — no non-empty-value conflict currently exists because
Opportunity's copy is always empty (unwritten). **Compatibility/rollback
risk:** low for (a) (documentation-only); moderate for (b) (new write
path, its own inert-proof, and a backfill affecting every existing deal
that has both a Contact repairs value and a linked Opportunity).
**Unresolved question, explicit: which of (a)/(b) does Brad/Jess want?**
This is the single highest-value decision this document surfaces.

---

## Family 4 — Seller MAO vs. "Offer MAO" (two deliberately distinct facts, correctly separated — but the presented-offer half is dead code)

**Status: The distinction itself is RESOLVED and correct — restated, not
re-opened. The finding for INV-70 is about the presented-offer half, not
about Seller MAO.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Seller MAO (underwriting output) | Opportunity | `opportunity.mao_max_allowable_offer` | `Atu5XCjpFElY8H64VG4h` / `ZfOljSm5fLFCFZhfi0ri` | NUMERICAL | Opportunity Details |
| Offer MAO (presented offer) | Contact | `contact.offer_mao` | `aAMFPmgxGZT422uGAQOx` / `uwANCq7HLT1BuOSGfSOu` | NUMERICAL | Offer |
| Offer MAO (presented offer) | Opportunity | `opportunity.offer_mao` | `9jm2SoN2aDtUtbesL0kG` / `0Q31sQlUhWxbhGEtFdQ3` | NUMERICAL | Offer |

**Ruling, exact, `docs/PHASE_B_SPEC.md:1748-1757`:** "`mao_max_allowable
_offer` and `offer_mao` are deliberately different numbers." Seller MAO
(`sellerMAO = endBuyerMaxPrice − assignmentSpread`, `compute.ts:176`) is
the underwriting ceiling; `offer_mao` is what was actually presented to
the seller, which the current architecture treats as a separate,
timestamped snapshot. **This is not a duplicate to merge.** **Writer
(Seller MAO):** `saveUnderwritingFields`
(`app/src/lib/ghl.ts:1107-1124`), one of exactly three approved
underwriting carriers. **Reader:** `app/src/lib/rail.ts:273` (persistent
call rail "Seller MAO" cell, live in `ContactWorkspace.tsx`).

**What IS a genuine open duplicate, inside the presented-offer half:**
`contact.offer_mao` and `opportunity.offer_mao` are the same fact on two
models, with **no declared canonical between them** — see Family 5, which
covers this and the other six `offer_*` keys together, since all seven
share one writer, one dead-code status, and one open question.

**Proposed canonical carrier (Seller MAO):** `opportunity.mao_max_allowable
_offer` (already canonical; no change proposed). **Unresolved questions:**
none for Seller MAO itself; see Family 5 for `offer_mao`.

---

## Family 5 — the "presented offer" family (`offer_price`, `offer_mao`, `offer_wholesale_fee`, `offer_repair_total`, `offer_margin`, `offer_arv`, `offer_date` — 7 keys × 2 models = 14 fields)

**Status: OPEN — a real Contact-vs-Opportunity duplicate with no declared
canonical, currently moot only because the sole writer is dead code.**

| Key | Contact ID (Prod / Test) | Opportunity ID (Prod / Test) | Type |
|---|---|---|---|
| `offer_price` | `v2VO2wUwTYRojmU7VXyZ` / `oUJHAbPq7tcw67U2Q5Zx` | `4YiACDV4uB3zOlAdNIBb` / `xjPRKyyzKvPibg9iutmQ` | NUMERICAL |
| `offer_mao` | `aAMFPmgxGZT422uGAQOx` / `uwANCq7HLT1BuOSGfSOu` | `9jm2SoN2aDtUtbesL0kG` / `0Q31sQlUhWxbhGEtFdQ3` | NUMERICAL |
| `offer_wholesale_fee` | `qYzkp66x87rG7Pbs36GP` / `XEGpmThEZVCZ0Zo8v5iW` | `GxChepYArmgPllhKPq0R` / `gHrAmtFAOag95Zvay3Wa` | NUMERICAL |
| `offer_repair_total` | `2EpRGXb8rj4RtHfFhYbB` / `G3qYa7TSwvKLI4uZJ2XA` | `XbW0B973nuaLtIjMkzO9` / `5mmCNT6zM5tGNeAQutbW` | NUMERICAL |
| `offer_margin` | `ec06A3RId4Isorc97jeQ` / `beRhLuaz9QRDs0qdwqkU` | `eY5BOqE9juGpBfqwacWT` / `v5Cfdz3odamvyKA3Udpn` | NUMERICAL |
| `offer_arv` | `Z88Y6IqCK1i7hObZcrQM` / `VQaObD0PsDjPbsEknHK5` | `Nm1LZvQzaCGvXDq7TRCh` / `2zjZh6Ma4DQX77UBWgCN` | NUMERICAL |
| `offer_date` | `SJ6x7OqUxTKg1ri8ltb7` / `bNGoqaqvUlhCkbacDarB` | `73oLHWnVjmOGSrBo5sC6` / `Gle5K6Um2FYw1TZZ0Art` | DATE |

(Prod ids for `offer_price`/`offer_mao`/`offer_wholesale_fee`/
`offer_repair_total`/`offer_margin` Contact-side are corroborated
independently by `docs/CONTACT_FIELD_REFERENCE.md:54-57` and
`docs/FIELD_REGISTER.md:47-52`; all 14 Prod ids and both Test folder
memberships are read directly from `app/src/pages/MaoCalculator.tsx:41-60`
and this session's live Test `GET /locations/{id}/customFields`.)

**Semantics, ruled (`docs/PHASE_B_SPEC.md:1748-1757`):** these fields
record "the offer prepared for and ultimately presented to a seller,"
distinct from underwriting outputs. **What is NOT ruled:** which of the
Contact copy or the Opportunity copy is authoritative when they disagree,
or why both need to exist at all if one writer sets both simultaneously.

**Writer, singular, currently dead:** `handleSave`
(`app/src/pages/MaoCalculator.tsx:1157-1193`) calls
`ghl.contacts.saveOfferFields` (`app/src/lib/ghl.ts:608`) and, when an
Opportunity is linked, `ghl.opportunities.saveOfferFields`
(`app/src/lib/ghl.ts:834`) — **writing all seven keys to both models in
one save, unconditionally overwriting, no history.** `MaoCalculator.tsx`
is **confirmed unrouted**: `grep -n "MaoCalculator" app/src/App.tsx`
returns no matches, corroborating `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s
and `docs/PHASE_B_SPEC.md:2593-2595`'s independent findings that the page
was retired from navigation 2026-08-16. **This writer cannot currently
run through the live application.**

**Governing constraint, unchanged by this document:** `CONTACTS_
OPPORTUNITIES_SPEC.md §4.1` HARD NO — "Tags, pipeline stage, `offer_`
fields, workflow triggers... Editing a contact field is not a licence to
touch a tag, move a stage, or set an offer field" — and §5.2/§2.4: "the
seven `offer_` fields (GHL folder 'Offer') — never become editable" in
the general Contact field-edit surface. This bars the general editor from
ever touching these fields; it does not itself bar a purpose-built writer
(the now-dead `MaoCalculator.tsx` was exactly that kind of exception).

**Known stale data, restated for anyone who queries live records:**
`docs/PHASE_B_SPEC.md:1759-1771` records that opportunity
`1AP9BfFPJ2xYZ0RPTm9U` (Neelima Bale) is the one Production record
carrying `offer_*` test data (price 245001 vs. MAO 245000.5, margin −0.5)
— a calculator test that persisted, not a real deal. Not verified against
Test in this session; flagged so a future reader does not treat it as
evidence.

**Integrity gap, distinct from the duplication question:** all 14 ids
live only as literals in `MaoCalculator.tsx`, absent from `app/shared/
ghl-config.ts` — see "Inventory summary" above.

**Proposed canonical carrier:** none proposed. This family's disposition
is downstream of a decision `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
already named as a **REAL CARRIER GAP**: "Current Offer" / negotiation-
state (Part A, "Opening Offer / Current Offer / negotiation fields," and
Part B, "Current Offer"). Building or reviving a "presented offer" carrier
before that decision is made risks creating a second, competing
negotiation-state mechanism. **Recommendation:** treat this whole family
as frozen legacy pending the Current-Offer/negotiation-carrier decision;
do not build new consumers against either the Contact or Opportunity copy
in the meantime; when that decision is made, decide in the same pass
whether these 14 fields are retired (in favor of a new carrier), reused as
that carrier, or one of the two models is dropped in favor of the other.
**Retirement candidates:** all 14, contingent on the above — not proposed
for retirement by this document alone. **Migration/backfill plan:** none
proposed; depends on the above decision. **Compatibility/rollback risk:**
low today (writer is unreachable), but reviving `MaoCalculator.tsx`
without first resolving this would reintroduce a live, unreconciled
duplicate. **Unresolved questions:** (1) does the Current-Offer decision
retire, reuse, or replace this family; (2) if reused, which model
(Contact or Opportunity) is canonical between the two copies; (3) should
`MaoCalculator.tsx` be formally retired (deleted) rather than left as
reachable-if-re-routed dead code carrying 14 ungoverned field ids.

---

## Family 6 — Offer Wholesale Fee vs. Wholesale Fee Percent (two different facts, one orphaned, one historically mis-recorded)

**Status: mostly resolved as non-duplicative; one historical-memory
discrepancy flagged for verification.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Offer Wholesale Fee (presented offer, a dollar amount) | Contact | `contact.offer_wholesale_fee` | `qYzkp66x87rG7Pbs36GP` / `XEGpmThEZVCZ0Zo8v5iW` | NUMERICAL | Offer |
| Offer Wholesale Fee (presented offer, a dollar amount) | Opportunity | `opportunity.offer_wholesale_fee` | `GxChepYArmgPllhKPq0R` / `gHrAmtFAOag95Zvay3Wa` | NUMERICAL | Offer |
| Wholesale Fee Percent (a rate, not a dollar amount) | Opportunity | `opportunity.wholesale_fee_` | UNKNOWN (Prod, not read this session) / `kRGt4FKC3bW2Kvgsyshw` | NUMERICAL | Opportunity Details |

**`offer_wholesale_fee` is part of Family 5** (presented offer) — same
writer, same dead-code status, same open question. Listed again here only
because its name is easy to confuse with the next field.

**`opportunity.wholesale_fee_` is orphaned, not a live duplicate of
anything.** `docs/PHASE_B_SPEC.md:2301-2305`: "`opportunity.closing_costs`
and `opportunity.wholesale_fee_` were read only by the two functions
retired 2026-08-13 and now have no consumer at all... either may be
deliberately assigned a meaning under this model rather than requiring
archaeology." `docs/UNDERWRITING_FIELD_REFERENCE.md:132-135` corroborates:
listed under "What is not here" (deal-override fields), a "candidate"
with no current reader.

**Historical-memory discrepancy, flagged for verification, not asserted as
fact:** a prior session's memory record (`reference_ghl_mao_fields.md`,
~87 days old) described a **Contact-model** field `contact.wholesale_fee_`
(id `RS2trZUHrZwaGxadLvHB`, part of the old deal-submit function's field
set). **No field with fieldKey `contact.wholesale_fee_` or a "Wholesale
Fee Percent" name appears in this session's live 109-field Test Contact
inventory.** Two explanations are equally consistent with current
evidence and this document does not choose between them: (a) the field
was deleted or renamed in GHL since that memory was recorded (unverified,
GHL field deletion is not something the read-only tooling used this
session could confirm one way or the other for a field no longer present
to inspect), or (b) the memory record was simply inaccurate at the time
(the same era's `deal-submit` Netlify function, retired 2026-08-13 per
`docs/PHASE_B_SPEC.md:2261`, is the kind of thing that could produce a
stale/incorrect field record). **Unresolved question: confirm in
Production (out of scope for this Test-only Phase 1 read) whether a
Contact-side `wholesale_fee_`/`RS2trZUHrZwaGxadLvHB` field still exists,
before assuming it is gone.**

**Proposed canonical carrier:** none needed — `opportunity.wholesale_fee_`
has no current consumer and is not in conflict with anything live.
**Retirement candidates:** `opportunity.wholesale_fee_` is a candidate for
either formal retirement or deliberate reassignment, per PHASE_B_SPEC's
own framing — a decision for whoever designs the eventual deal-override
carrier set, not this document. **Compatibility/rollback risk:** none —
no consumer to break.

---

## Family 7 — Assignment Fee Target (single live carrier; a historical-memory identifier collision, resolved by this document)

**Status: RESOLVED — the apparent Contact/Opportunity duplicate does not
exist. One historical memory record was incorrect.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Assignment Fee Target | Opportunity | `opportunity.assignment_fee_target` | `xwbPw1JVkgJevJTPNmxa` / `1UHwussLeAXwsxGpe9w0` | NUMERICAL | Opportunity Details |

**The apparent duplicate, resolved:** a prior session's memory
(`reference_ghl_mao_fields.md`) recorded a **Contact-model**
`contact.assignment_fee_target` at id `xwbPw1JVkgJevJTPNmxa`. That is the
**exact same id** this session confirms, directly from
`app/src/pages/MaoCalculator.tsx:30-34`, as the **Opportunity-model**
field (`SOURCE_FIELD_IDS.assignmentFeeTarget`, whose surrounding comment
states explicitly "Opportunity-side only"). A single GHL custom-field id
cannot simultaneously belong to two different model objects — it is one
field. **This session's live 109-field Test Contact inventory confirms
no field named "Assignment Fee Target" exists on the Contact model.**
**Finding: the memory record's model label was incorrect; there is one
field, on Opportunity, not two.** This document corrects that record
(the memory file should be updated to remove the Contact-model claim —
noted here for whoever next touches that memory, not actioned by this
Phase 1 document since memory files are outside the repository).

**Current reader:** `app/src/pages/MaoCalculator.tsx:32` (`SOURCE_
FIELD_IDS.assignmentFeeTarget`), read-only prepopulate, per its own
comment "read FROM these for prepopulate, never written to." **No
writer exists for this field anywhere in the codebase** (grep of
`app/src` for `assignment_fee_target` and `assignmentFeeTarget` returns
only this one read site). **Disposition tied to `MaoCalculator.tsx`'s own
fate**, exactly as `docs/UNDERWRITING_FIELD_REFERENCE.md:134` states:
"`opportunity.assignment_fee_target` is still referenced by
`MaoCalculator.tsx`" — the same unrouted, dead-in-practice page as
Family 5.

**Proposed canonical carrier:** `opportunity.assignment_fee_target`
(single carrier; no duplicate to resolve). **Retirement candidates:** none
required by this document; tied to whatever happens to `MaoCalculator.tsx`
and Family 5. **Unresolved questions:** none beyond Family 5's.

---

## Family 8 — Closing Costs: a field/value naming collision, not a duplicate fact

**Status: RESOLVED as non-duplicative — flagged because the naming
collision is a real risk for a future reader, per this document's "do not
assume the list is complete" instruction.**

| Candidate | GHL object type | Key | ID (Prod / Test) | Authoritative for |
|---|---|---|---|---|
| Closing Costs (per-deal, orphaned) | Opportunity **custom field** | `opportunity.closing_costs` | `N8Aa9t1SZhU7XnPPzxWk` / `qRfhbMv9wBXmE2o1wbnD` | nothing today — no consumer |
| Default Closing Cost Estimate | Location **custom value** (a different GHL object type entirely) | `custom_values.default_closing_cost_estimate` | `kapXvTS9tNYVRn7L3WBY` / `uSml4RQLMNstTrqeEDtA` | the location-wide default Investor Policy assumption, PB-D56 §IV |

**These are not the same fact.** The custom VALUE is a location-wide
policy default (starter `2500`), read by `parsePolicy`
(`app/src/lib/underwriting/resolver.ts:146-206`) and used in
`compute.ts:153` (`Closing Costs = Effective Closing Cost Estimate`),
authoritative per PB-D56 §IV and confirmed in
`docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s Investor Policy table. The
custom FIELD is a per-deal Opportunity field with **no live consumer**,
explicitly the subject of `docs/PHASE_B_SPEC.md`'s "discovery cycle"
section (chosen for its own inert-proof specifically because it had zero
consumers to disturb) and confirmed still orphaned
(`docs/PHASE_B_SPEC.md:2301-2305`).

**The risk this document flags, not a current defect:** if
`opportunity.closing_costs` is ever assigned a meaning (e.g., an
investor's per-deal override of the default), its name will be
indistinguishable in casual reference from the location-wide default it
would be overriding. **Recommendation, not a decision:** whoever assigns
`opportunity.closing_costs` a meaning should name it explicitly as a
**per-deal override** of the Investor Policy default in whatever carrier
documentation follows (matching the pattern PB-D56 §II.4 already uses for
financing on/off/unresolved three-state overrides), so the two are never
conflated in a resolver's `pick()` hierarchy without an explicit precedence
statement. **Proposed canonical carrier:** N/A — no merge needed; both may
coexist as distinct facts once the per-deal field is given a use.
**Unresolved questions:** should `opportunity.closing_costs` be retired
outright (GHL field deletion, its own decision) or reserved for the
future per-deal override role PHASE_B_SPEC already floats.

---

## Family 9 — Contact-side deal-economics fields sitting outside the stated ownership rule (Carrying Cost, Loan Amount, Interest Rate, Hold Months)

**Status: not a duplicate family — flagged as a standing tension with the
rollover's own ownership rule, for awareness, not for action in Phase 1.**

| Field | Object | Key | ID (Prod / Test) | Type |
|---|---|---|---|---|
| Carrying Cost | Contact | `contact.carrying_cost` | `FhcyP63sSAtWInl4Q4iI` / `VL1H3LuJCtbgN3WVtneW` | MONETORY |
| Loan Amount | Contact | `contact.loan_amount` | `3ZlSKldh0jR2MWhjOmHe` / `iIDiypNtXr7GJMMF7K77` | MONETORY |
| Interest Rate | Contact | `contact.interest_rate` | `i1mVFCwHIySFFzR1hVfQ` / `JnsOzL61ZlEfBrEPKL59` | FLOAT |
| Hold Months | Contact | `contact.hold_months` | `Ju1U6ROdDNnCFlsn4eeS` / `aztp3NdLgCwzK0m1SWQc` | NUMERICAL |

**Not a duplicate:** none of these four has an Opportunity-model twin —
they are single-carrier facts, so there is no conflicting-value risk of
the kind Families 1-6 have. **The tension:** the rollover's governing
ownership rule states "Opportunity owns... deal economics"; these four are
per-deal financing/holding economics inputs that currently live on
Contact, inert-proofed there under PB-D30/33/34 as part of the pre-PB-D56
generation of MONETORY field designations
(`docs/PHASE_B_SPEC.md:613-644`), predating the Opportunity-centric
underwriting model PB-D55/56 later established. **No named writer exists
for any of the four in `app/src/lib/ghl.ts` today** (grep confirms only
`setEstimatedRepairs`, `setApprovedArv`, `setAskingPrice`, and the three
underwriting/offer writers already covered above; none references
`carrying_cost`, `loan_amount`, `interest_rate`, or `hold_months` as a
write target). They hold historical/inert-proof data only.

**Proposed canonical carrier:** not proposed — these are not yet
duplicated, so there is nothing to canonicalize between two carriers.
Whether they should ever become genuine per-deal Opportunity inputs
(paralleling ARV/Asking-Price/Repairs) is a product question outside
INV-70's stated scope (duplicate resolution), not something this document
recommends deciding now. **Flagged only so a future Board #9/10 financing
feature does not create a *second*, Opportunity-side financing-input set
without first checking whether these four are meant to be reused, seeded,
or retired.**

---

## Cross-cutting findings

**The Accepted Purchase Price — the fact Board 9's contract work actually
needs — is not any field in this document, and is not a `offer_price`.**
Recorded here because it bears directly on why INV-63 (contract sending)
was paused and gated on this document. `docs/BOARD9_CONTRACT_INVENTORY_
V1.md` item 6 and `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s "Accepted
price" row both establish that the price actually consumed downstream is
`OutcomeSnapshot.currentOffer`, captured verbatim at seller-call
acceptance and persisted as a **GHL Note** through the sanctioned
`ghl.notes.create()` — never a custom field. `app/src/lib/seller-call-
outcome.ts:40-45` states this as a module-level design invariant, in these
words: **"ACCEPTED PRICE IS THE EXISTING CURRENT OFFER, NEVER A NEW
FIELD."** The same header (lines 47-54) documents a known, accepted,
NOT-closed gap: a GHL note is durable and re-readable but not queryable or
pipeline-reportable, unlike a custom field — recorded there for INV-54,
not solved by anything in this document. **Neither `contact.offer_price`
nor `opportunity.offer_price` (Family 5) is this value.** A future
TREC/contract field-mapping pass that reaches for either `offer_price`
field expecting the accepted price would be reading the wrong carrier
entirely — the real value lives in note text, keyed by `agreementAt`, and
is invisible to a grep across custom-field ids. Stated plainly so it is
not rediscovered as a bug during Board 9's next attempt at INV-63.

**Property Address ownership is a deliberate, already-ruled exception to
the general ownership rule, not a gap.** `contact.property_address`
(`tG4gGFI8JB2VjWeuqYMx` / `1B6u7F1MipquMxVWnAD9`) is READ-ONLY in the
Contact edit surface, explicitly because IAOS treats "a new property = a
new contact" as its identity model
(`docs/CONTACTS_OPPORTUNITIES_SPEC.md:115-118,150`). No Opportunity-model
address field exists (confirmed: none of the 16 live Test Opportunity
fields names an address). This document does not treat this as a Family
to canonicalize — it is a standing architectural choice with its own
citation — but records it because the rollover's ownership rule, read
literally ("Opportunity owns property... facts"), is in tension with it.
Reconciling that tension, if ever needed, is a product decision belonging
to whoever revisits the one-property-per-contact assumption, not to this
document.

**MAO Viability Flag** (`contact.mao_viability_flag`,
`o87cyzuCyScbY72VrOmq` / `jSStfAuqN6Ycb7O9Khp8`, SINGLE_OPTIONS) —
observed live in both Contact inventories, not part of any named family,
but its only historical association (per `docs/FIELD_REGISTER.md` and the
"70% rule" formula in `docs/PHASE_B_SPEC.md:2314-2320`) is the retired
`mao-webhook.ts` calculator. Not confirmed as read or written by any live
code path this session (a targeted grep of `app/src` for
`mao_viability_flag` and `maoViabilityFlag` returns no matches).
**Flagged as a likely-orphaned legacy field, unverified, not asserted as
dead** — a candidate for the same retire-or-reassign treatment as
`opportunity.wholesale_fee_` and `opportunity.closing_costs`, on its own
future review.

**PB-D51's shared-configuration rule has one confirmed exception**
(Family 5's 14 hardcoded `offer_*` ids in `MaoCalculator.tsx`). This is an
integrity finding, not a duplication finding, but it directly enables
duplication risk: identifiers outside `ghl-config.ts` are invisible to
any future grep-based audit (including a repeat of this one) that only
checks the shared config module.

---

## What this document does not do

No GHL field was created, edited, renamed, migrated, archived or deleted.
No application code, configuration, workflow, or test file was changed.
No canonical carrier is finally chosen for Family 3 (Repairs) or Family 5
(presented offer) — both are surfaced as open, decision-requiring
conflicts, per the explicit instruction never to silently choose between
conflicting non-empty values or an unresolved architecture question. No
Production location was queried — every live read this session was
`GET`-only against IAOS Test (`SoTgVoaFGHtBdRFvXWQV`). No Linear issue is
marked Done. No PR is opened.

---

## Unresolved questions, collected

1. **Family 3 (Repairs):** re-designate `contact.estimated_repairs` as
   canonical (low cost, breaks the stated ownership rule for this one
   fact), or build the missing `opportunity.repair_estimate` writer and
   migrate (higher cost, matches ARV/Asking-Price precedent)?
2. **Family 5 (presented offer, 14 fields):** does resolving Board 8's
   named "Current Offer" carrier gap retire, reuse, or replace this
   family? If reused, which model (Contact or Opportunity) governs
   between the two copies? Should `MaoCalculator.tsx` be formally retired
   rather than left as re-routable dead code?
3. **Family 6:** does a Contact-side `wholesale_fee_`
   (`RS2trZUHrZwaGxadLvHB`) still exist in Production? (Out of scope for
   this Test-only read; flagged for a future check before assuming it
   gone.)
4. **Family 6/8:** should `opportunity.wholesale_fee_` and
   `opportunity.closing_costs` be formally retired or reserved for a
   future per-deal override role?
5. **Family 9:** are Carrying Cost / Loan Amount / Interest Rate / Hold
   Months intended to become genuine per-deal Opportunity inputs
   eventually, or remain permanently Contact-side historical fields?
6. **Cross-cutting:** is `contact.mao_viability_flag` fully dead, and if
   so, is it a retirement candidate?
7. **Memory correction (not a repository change):** the session memory
   file recording GHL MAO field ids should be corrected — its
   `contact.assignment_fee_target` entry names an id that this
   document confirms is actually `opportunity.assignment_fee_target`.

None of these is decided by this document. Each requires a Product Owner
and/or Chief Architect ruling before any Board #9 coding that touches the
affected fields resumes.
