# INV-98 Board #9 — Production activation evidence

This file is the Board #9 activation evidence named in
`docs/CONTACTS_OPPORTUNITIES_SPEC.md` §4.1a. Each entry states exactly how faithfully it reproduces its source,
followed by any dated clarification. Clarifications never edit
the source text.

---

## 1. P1 — Production entry reconfirmation (Spock, read-only)

**Source:** Spock's report, relayed by Brad on 2026-09-30.

**Evidence record (1b below).** Spock's P1 evidence block, preserved exactly as Brad relayed it: from "BOARD #9 — PRODUCTION P1 RECONFIRMATION" through "RULING: PASS. Production flags remain OFF." It includes the 38-workflow correction and the limitations. It was compared character by character against the relayed message and matches. That establishes fidelity to the relayed text only, not to anything upstream of Brad's relay.

**Context (1a below).** Spock's narration around the block, as relayed. The relay may have normalized its formatting, so it is **not** claimed to be exact, and it is not part of the evidence record. The block is the record.

Nothing has been added to or inferred in either.

### 1a. Accompanying narration (context only; as relayed, possibly normalized)

```text
Going straight to Seller - Under Contract Exit (e6a4de9d-34aa-4e6e-981a-094b91c156b1) to read its trigger and action. After that, the workflow list to confirm nothing has been added or changed since yesterday's 36-workflow inventory.

Target workflow verified; the Saved button stays disabled, so no unsaved changes. Now the list, to check workflow count and any "Last updated" after yesterday's inventory.

PASS. Seller - Under Contract Exit matches the reviewed configuration. No other Published workflow fires on entry to Under Contract.

One correction to yesterday's report: the Production list has 38 Published workflows, not 36. I missed the last two rows, Sequence - Hot Tag Mail and Sequence - Low Tag Mail. I checked both today. They trigger on Contact Tag Added ("hot" / "low"), not on a stage change, so yesterday's conclusions hold. The count was still wrong, and that's on me.

I can't write to the Board #9 activation evidence record from here. The block below is formatted to be pasted into it.

This goes to Jess:
```

### 1b. P1 evidence block (exactly as relayed)

```text
BOARD #9 — PRODUCTION P1 RECONFIRMATION — READ-ONLY — PASS
Location jmHG4B8RdzwpfqruNf68 · Observed Sep 30, 2026, from 9:56 AM CDT
Method: GHL workflow builder UI. Panels opened and closed via Cancel. Nothing edited,
saved, published, or triggered; the Saved button stayed disabled throughout.

SELLER - UNDER CONTRACT EXIT
Workflow ID: e6a4de9d-34aa-4e6e-981a-094b91c156b1 · Status: Published
Last updated Sep 24, 2026, 6:34 PM · Total enrolled 1 · Active 0
Trigger: Pipeline stage changed ("Pipeline Stage Changed")
  - In pipeline: Seller Leads Pipeline
  - Pipeline stage: Under Contract
  - Status: Is Open
Actions: exactly one, then END
  - Remove from Workflow, "Another workflow": Seller 6 - Follow-Up Reminder,
    Seller 7 - Offer Sent, Seller 8 - Long-Term Nurture
  - Sends message: NO · Changes stage: NO · Enrolls contact: NO
Matches the reviewed configuration.

NO OTHER PUBLISHED WORKFLOW FIRES ON ENTRY TO UNDER CONTRACT
- Full list rescanned today: 38 Published workflows. No Last-updated date after
  Sep 24, 2026 on any row, so none has changed since the Sep 29 trigger inventory.
- CORRECTION to the Sep 29 report: that report said 36. Two rows were missed:
  - Sequence - Hot Tag Mail (d4218621-fbb0-4876-a968-c88317591b25)
    Trigger: Contact tag, Tag added = "hot" · Active 5
  - Sequence - Low Tag Mail (2b224bb3-b2cd-4b64-a42d-37d688a4d94b)
    Trigger: Contact tag, Tag added = "low" · Active 23
  Both are tag-triggered, not stage-triggered, so the Sep 29 conclusion stands.
- Stage-triggered workflows other than UC Exit, all filtered to other stages or pipelines:
  - Seller 6: Seller Follow-Up
  - Seller 7: Seller Offer Sent
  - Seller 8: Long-Term Nurture
  - Seller 9: Closed / status Won
  - Investor 2/7/8: Investor Leads Pipeline
  - 7-Day Check-In and IAOS Account Activation: IAOS Client Pipeline
  The other 36 trigger filters were read on Sep 29 and not re-opened today. Since
  none was updated after Sep 24, the Sep 29 reads remain current.

LIMITATIONS
1. "No change since Sep 29" rests on the list's Last-updated column. That covers
   builder saves; the UI gives no way to check it against a separate change history.
2. External listeners (Make.com, Netlify, Marketplace apps) on stage-change events
   are not visible in the workflow UI.
3. Seller 8 is still configured for removal. It has 40 active enrollments, but the
   pinned contact is in none of Seller 6, 7, or 8, so the removal is a no-op for it.

OBSERVED, NOT INVESTIGATED
- An existing Chrome tab shows a Production document preview,
  6abc7a5d07906671ae20bc22. The Sep 29 Production D&C list had 0 documents, so this
  was created after that check. I did not open it; flagging it for Jess to confirm
  it is the authorized Board #9 document.

RULING: PASS. Production flags remain OFF.
```

### 1c. Clarification — IAOS Production code flags (Jeff, 2026-09-30)

The source's last line, "Production flags remain OFF", does not match the IAOS
Production code flags at the time of this record.

- **Live deploy:** `iaos-app` deploy `6abd1e656bc9fe0008243a42`, `main@eab3133`,
  published 2026-09-30T14:43:06Z, auto publishing locked. Read back from the
  Netlify API.
- **In that commit's `app/shared/ghl-config.ts`:**
  - `contractProductionEnabled: CONTRACT_PRODUCTION_ENABLED`
  - `productionProofScope.enabled: PRODUCTION_PROOF_SCOPE_ENABLED`
- **Both are ON, and have been since PR #104's enabled build.** The pinned
  walkthrough writes of 2026-09-29/30 succeeded in Production. The proof scope
  refuses every Production write with `PRODUCTION_WRITES_DISABLED` while these
  flags are off.

**Open question for Spock — ANSWERED 2026-09-30 by §1e:** the line is withdrawn. It was an unverified restatement of an earlier instruction premise, and Spock did not observe IAOS flag state. The original question is kept below, unchanged.

**Open question for Spock:** what did "Production flags remain OFF" refer to?
If it meant these IAOS code flags, the statement is incorrect for this deploy.
If it meant something else, name it: for example, a GHL-side setting, or the
three P2 mover filters, which are absent in Production. This record will add
his answer as a further dated clarification. It will not edit the source.

### 1d. Clarification — the document Spock flagged (Jeff, 2026-09-30)

These are IAOS ledger facts, read from the pinned contact's notes (GET only).
They are recorded for Jess's confirmation, not as a substitute for it.

- The accepted manual-send record, note `QM9yMi8yilDMea9lKWsu`, names
  provider document `6abc7a5d07906671ae20bc22`. Its attemptId is
  `2026-09-30T03:13:00.000Z`, `templateSource: manual_ghl_upload`, and it
  records no document revision.
- The contract authorization, note `V3thwK4bmDtpU2GiBBgy`, covers the
  generated PDF with SHA-256
  `d942a58051db268f88e1d6759048686672fba0236fc0793445cc9e38dda5f16c`.

### 1e. Addendum — Spock's flags correction (2026-09-30)

**Source:** Spock's addendum, relayed by Brad on 2026-09-30. It is reproduced below exactly as relayed, compared character by character against the relayed message. The §1b block is unchanged by it, as the addendum itself says.

**Corrected scope of P1:**
- **P1: PASS for the GHL workflow layer only.** That covers the `Seller - Under Contract Exit` configuration, the 38-workflow scan, and the finding that no other Published workflow fires on entry to Under Contract.
- **IAOS flag state: not observed by Spock.** The IAOS Production flag state rests solely on §1c: deploy `6abd1e65`, `main@eab3133`, both flags ON.
- **The same withdrawal applies to the identical closing line in Spock's Sep 29 reports:** the workflow preflight, D&C settings, S0 and the post-step-2 snapshot. Those reports are not reproduced in this file.

```text
ADDENDUM TO SEP 30 P1 RECONFIRMATION — CORRECTION (original block unchanged)

The closing line "Production flags remain OFF" is WITHDRAWN.

What it was: a restatement of a premise from earlier Board #9 instructions
("enablement remains OFF" / "write flags remain OFF"), carried into the report without
verification. The Sep 30 P1 instruction did not state flag status.

What was actually observed: GHL workflow builder and workflow list only. No IAOS
deploy, commit, environment variable, or feature-flag value was inspected on Sep 29
or Sep 30. Spock has no observation of contractProductionEnabled or
productionProofScope.enabled, or of the live deploy at main@eab3133.

Effect on P1: none. The Seller - Under Contract Exit configuration, the
38-workflow scan, and the "no other Published workflow fires on Under Contract entry"
finding are GHL-UI observations and stand.

Same correction applies to the identical closing lines in the Sep 29 reports (workflow
preflight, D&C settings, S0, post-step-2 snapshot). Each echoed the instruction
premise; none verified flag state.

Corrected P1 ruling line: PASS (GHL workflow layer). IAOS flag state: not observed
by Spock.
```

---

## 2. P2 — status against `main` §4.1a (Jeff, 2026-09-30)

None of the five P2 exit guards is built and proven in Production:
`Seller - Follow Up`, `Seller - Not Interested`,
`Seller - Route to Long-Term Nurture`, `Seller 6` and `Seller 7`.
P1 passing does not satisfy P2. The proposed one-time exception for the
pinned synthetic transition is in §4.1a, **P2-X**.

---

## 3. Written risk acceptance (Brad) — RECORDED 2026-09-30

**Brad's exact words:** `I accept this risk.`

**When:** Sep 30, 2026, 10:45 AM CDT (2026-09-30T15:45 UTC). Relayed to Jeff by
Brad.

**Context, as relayed:** Brad's written response directly followed Jess's
plain-language explanation of the one synthetic transition, and the detailed
"Risk Brad accepts" text in PR #108.

**Form of acceptance: by direct reference.** Brad wrote the four words above.
He did **not** type the risk statement below; it is the text his words refer
to. Spec §4.1a P2-X allows this form of acceptance. The statement is
reproduced below from `docs/CONTACTS_OPPORTUNITIES_SPEC.md` §4.1a P2-X,
"Risk Brad accepts", as it stood at PR #108 head
`ab5be60b00e87d9c04339b560d25f95cf0e2e9b9`. That head was committed at
10:39 AM CDT and was current at 10:45 AM CDT. The statement text is
identical at every PR #108 head (`a494754`, `a250fa0`, `ab5be60`) and in
this commit. It is quoted as Markdown source.

**Risk statement the acceptance refers to:**

```markdown
"For the one INV-98 Board #9 synthetic Under Contract transition of Production opportunity `44hLQ4PD4a4HBVLPr4nl` (contact `T3t5AZ3Z5lak0BmZawvP`) only, I accept these risks:
    - `Seller - Follow Up`, `Seller - Not Interested`, `Seller - Route to Long-Term Nurture`, `Seller 6` and `Seller 7` have no built or proven Under Contract guard in Production. If any of them, or any other Seller Leads stage writer, is triggered for this contact while the opportunity is Under Contract, it may move the opportunity out of Under Contract and may enroll the contact or send messages to the fixture's contact details.
    - External listeners on stage-change events (Make.com, Netlify, Marketplace apps) are not visible in the workflow builder, and are not audited.
    - P1's 'no change since Sep 29' rests on the builder list's Last-updated column.

    This acceptance covers no other contact, opportunity or transition, and it is not a finding that the guards exist."
```

**Scope reminder:** this acceptance does not satisfy P2 for any ordinary
Production transition, and it is not a finding that the P2 guards exist.
It satisfies only the P2-X acceptance precondition, and only once P2-X is
approved and merged.

---

## 4. P2-X preflight item 4 — Contract Ready checklist exclusion (2026-09-30)

### 4a. Observed (Jeff, read-only)

- **When and how:** 2026-09-30T16:28:25Z, one GET of the pinned contact
  `T3t5AZ3Z5lak0BmZawvP`'s notes.
- **Result:** 27 notes. The app's own checklist parser at `main@1c3ff0b`
  (`parseContractReadyChecklistNote`, `app/src/lib/seller-call-readiness-carriers.ts`)
  matches **0** of them, and no note carries a "CONTRACT READY" header. No
  Contract Ready checklist record exists for this agreement: accept outcome
  2026-09-30T02:02:51.332Z at $250,000. The checklist is absent, not stale.
- **Why it can't exist:** each checklist box writes a checklist note, and the
  Production proof scope refuses that note type:
  `{ parse: parseContractReadyChecklistNote, allow: null }`
  (`app/netlify/functions/lib/production-write-scope.ts`).
  Contract Ready is derived from those five confirmations
  (`app/src/lib/board9-contract-model.ts`, `evaluateContractReady`), so
  Contract Workspace can only show "Not Contract Ready — 5 items remaining"
  in Production.
- **No dependency:** none of these read Contract Ready:
  - authorization and PDF generation;
  - the manual send record;
  - execution: signer mapping, executed-terms attestation, the Under
    Contract record;
  - the server's stage-transition verification.

  Its only other consumer is the retired Contract Sent evaluation in
  `ContractWorkspace.tsx`, whose result isn't displayed.
- **Contract Workspace as Brad reported it (a fresh reload, before this
  entry):**
  - executed PDF verified (expected hash, 13 pages);
  - six material terms MATCH;
  - existing attestation current;
  - Under Contract note recorded;
  - preserved artifact present;
  - transition button enabled;
  - the "Not Contract Ready — 5 items remaining" banner, with all five boxes
    unchecked.

### 4b. Ruling (Jess, 2026-09-30, as relayed)

- **Item 4's required checks:** preflight item 4 requires these Contract
  Workspace checks after a fresh reload:
  - executed PDF verified against the expected hash and 13 pages;
  - all six material terms MATCH;
  - attestation current;
  - Under Contract record present;
  - executed artifact preserved;
  - transition button enabled.
- **The exclusion:** the five-item Contract Ready checklist/banner is excluded
  from this one P2-X preflight. The Production proof scope refuses checklist
  notes, and the send, execution and transition paths don't depend on it.
- **Nothing else changes:** no other preflight item, scope, stop rule or
  monitoring requirement is weakened.

Spec §4.1a P2-X item 4 is clarified to match. The exclusion takes effect
only once that clarification is approved and merged.

---

## 5. P2-X transition and monitoring (2026-09-30) — COMPLETE (Brad ruling, §5f)

The one P2-X transition of opportunity `44hLQ4PD4a4HBVLPr4nl` (contact
`T3t5AZ3Z5lak0BmZawvP`). Each entry names who observed it, how, and the
limits of that observation. Items without source text in hand are marked
**PENDING**; nothing is filled in on anyone's behalf.

### 5a. Preflight (spec §4.1a P2-X, as clarified by §4)

- **Items 1 and 2 (Jeff; Netlify API, git and GHL GETs), final run
  2026-09-30T18:07:54Z–18:07:58Z:**
  - live deploy `6abd1e656bc9fe0008243a42` (`main@eab3133`), locked;
  - both IAOS Production flags ON at that commit;
  - fixture: sole opportunity, Seller Leads / New Lead - Seller / open,
    `lastStageChangeAt` 2026-09-25T20:11:38.476Z, no tags, 27 notes, latest
    `leqBHiwRRtV0hqVwHWjE`;
  - all identical to the preceding readbacks. PASS.
- **Item 3 (Spock):** the enrollment snapshot for this final window —
  **PENDING** relay of Spock's text. (An earlier item 3, at about 11:06 AM
  CDT, was relayed as a PASS; it belonged to an earlier, expired window.)
- **Item 4 (Brad, Contract Workspace):** the six named checks —
  **PENDING** relay of what Brad observed in this window.

### 5b. IAOS transition result

- **Reported (relayed to Jeff, 2026-09-30):** the transition was confirmed
  in IAOS.
- **Exact displayed result text:** **PENDING** relay from Brad.
- **Limit:** Jeff cannot read the `ghl-write` function log or the Blob
  store. A confirmed success emits no `[ghl-write]` log line and clears
  the stage-unresolved marker by design; neither was independently
  observed by Jeff.

### 5c. GHL readbacks (Jeff; GHL API GETs with the repository-root Production token)

**Limits, for every row below:** these GETs cover the opportunity,
contact, tags, notes, tasks and appointments only. Conversations return
HTTP 401 with this token, so **messages are not observed here**.
Workflow enrollment is not observable through the API.

| Snapshot | Observed (UTC) | After stage change | Result |
|---|---|---|---|
| Immediate (baseline) | 2026-09-30T18:11:03Z–18:11:05Z | +40s | Seller Leads / **Under Contract** (`bf17076b-3830-4479-94bb-b8af70fe9163`) / open. `lastStageChangeAt` **2026-09-30T18:10:23.466Z**, `updatedAt` 18:10:23.552Z, `lastStatusChangeAt` unchanged (2026-09-25T20:11:38.476Z). Sole opportunity. No tags. 27 notes (none new). 0 tasks, 0 appointments. ARV 485000, repairs 52000, Current Offer 250000. Contact `dateUpdated` unchanged (02:02:56.379Z), `lastActivity` null. |
| Early check — **does not count as +15m** | 2026-09-30T18:14:35Z | +4m12s | 18/18 unchanged from the baseline. Recorded for completeness only. |
| **+15 minutes** | **2026-09-30T18:30:25.991Z** | +20m02s | **18/18 unchanged from the baseline: PASS.** |
| +24 hours | **CANCELED** by Brad's ruling (§5f); not taken | — | — |

The 18 compared items: owner, pipeline, stage, status,
`lastStageChangeAt`, `lastStatusChangeAt`, opportunity `updatedAt`, ARV,
repairs, Current Offer, sole opportunity, contact tags, contact
`dateUpdated`, contact `lastActivity`, note count, latest note, tasks,
appointments.

### 5d. Workflow and message snapshots (Spock, GHL UI)

- **Immediate:** **PENDING** relay of Spock's text, verbatim.
- **+15 minutes:** **PENDING** relay of Spock's text, verbatim.
- **`Seller - Under Contract Exit` execution entry for this contact:**
  **PENDING** (spec: "as seen by Spock").
- **+24 hours:** **CANCELED** by Brad's ruling (§5f).

### 5e. Closing statement and ruling

**Superseded by §5f.** No closing statement is made here beyond what was
observed: Jeff's GHL readbacks (5c) found nothing in the P2-X stop list
through the +15-minute snapshot (2026-09-30T18:30:25.991Z). Nothing after
that time was observed by Jeff.

### 5f. Ruling — walkthrough complete; +24-hour checkpoint canceled (Brad, 2026-09-30, as relayed)

- **Ruling (Brad, Product Owner):** the Board #9 Production walkthrough is
  complete.
- **Start Disposition (reported by Brad):** recorded, and verified by fresh
  readback in IAOS. Jeff did not independently read back the handoff note.
- **The +24-hour checkpoint:** canceled by Brad. It is **not a gate**, and
  the +24-hour GHL and Spock snapshots were not taken.
- **Relationship to the spec:** spec §4.1a P2-X, as merged, lists a
  +24-hour snapshot in its monitoring requirement. This ruling departs from
  that text for this one transition, and is recorded here as Brad's ruling.
  It is not a spec change.
- **Still-open evidence slots:** the items marked PENDING above (5a items
  3-4 for the final window, the exact 5b result text, and the 5d Spock
  snapshots) remain unrelayed. The walkthrough is closed without them.
