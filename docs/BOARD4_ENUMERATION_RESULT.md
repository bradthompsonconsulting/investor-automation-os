# §0.1 ENUMERATION RESULT — for Jeff

**Date:** 2026-08-27
**Performed by:** Claude, driving Brad's authenticated Chrome session against Production GHL `jmHG4B8RdzwpfqruNf68`.
**Method:** Workflows list -> Advanced filters -> **Trigger type** -> **Is** -> **"Call Status"** -> Apply.
**Writes made:** none. The list filter was left unsaved and discarded; the trigger panel was exited via Cancel. All workflows still show "Saved".

---

## Jeff's blocking objection is upheld and now resolved

Jeff's baseline gate correctly refused §0.1: the enumeration path is a GHL **UI** flow and he has no authenticated UI session. He proved the v2 API cannot substitute — `/workflows/?locationId` returns inventory only (`id, name, status, version, createdAt, updatedAt, locationId`), singular reads and `/triggers`, `/actions`, `/versions` all 404, and `triggerType` / `filter` params 422.

**That was a defect in the brief, not in Jeff.** §0.1 assigned him a task only Brad or Claude can perform. Claude has run it.

---

## NAMING CORRECTION — the trigger type is "Call Status", not "Call Details"

**The workflow builder and the list filter use different names for the same trigger.**

- In the **workflow builder**, the trigger renders as **"Call details"** — *"Fires after a call ends with the selected status."*
- In the **Advanced filters** trigger-type vocabulary, the same trigger is **"Call Status"**. Typing "Call Details" in that dropdown matches nothing.

The brief's §0.1 said *"Trigger type -> Is -> (select the trigger type)"* without naming the string, which is the only reason this did not become a second dead end. **Record the correct string: `Call Status`.**

---

## RESULT — the population is EXACTLY FIVE

Filter returned **5 workflows. Page 1 of 1, "Next" disabled, page size 50.** No pagination, no truncation.

| # | Workflow | Status | Total enrolled | Active | Last updated |
|---|---|---|---|---|---|
| 1 | `Seller - Not Interested` | Published | 4 | 0 | Aug 12 2026, 9:28 AM |
| 2 | `IAOS Webhook Relay` | Published | 12 | 0 | Aug 20 2026, 9:21 AM |
| 3 | `Seller 2.5 - Routing Requested Appointment Disposition` | Published | 1 | 0 | Aug 10 2026, 5:47 PM |
| 4 | `Seller - Follow Up` | Published | 2 | 0 | Aug 11 2026, 6:34 PM |
| 5 | `Seller - Phone Status Incorrect Number` | Published | 1 | 0 | Aug 11 2026, 6:02 PM |

**These are exactly the five named in brief §1.3.** No sixth workflow exists. Nothing beyond §1.3 was found, so **the §0.1 discovery-only guardrail has nothing to report and no scope-expansion question arises.**

**Jeff's "31 unexamined of 37" concern is closed.** The remaining 32 published workflows carry other trigger types and are outside #4.

### What this means for deliverable #3

The dead-zone-free cutover sequence can now be argued over a **complete, bounded set of five**. The unbounded-population objection is withdrawn.

---

## §1.2 RE-CONFIRMED — Do Not Call is unchecked

Jeff flagged §1.2 as unverifiable from his position and correctly noted it is the one §1 fact that, if wrong, changes R4's Do Not Call row.

**Re-opened today and observed a second time**, independently of the earlier check. `IAOS Webhook Relay` -> trigger `Call Details` -> Filters -> `Custom disposition`, value picker expanded:

| Value | Checked |
|---|---|
| **Do Not Call** | ☐ **NO** |
| Follow Up | ☑ |
| Incorrect Number | ☑ |
| No Answer | ☑ |
| Not Interested | ☑ |
| Requested Appointment | ☑ |
| Voicemail | ☑ |

Six of seven selected. **§1.2 stands as written: tapping Do Not Call fires nothing today.** R4's Do Not Call row is unaffected.

---

## Baseline gate: brief amended, no other change

- **§0.1** — satisfied. Population is five, complete. The enumeration task is removed from Jeff's scope; it was never his to run.
- **§0.1 string** — the trigger type is `Call Status` in the filter vocabulary.
- **§1.2** — re-confirmed by direct observation.
- **§1.3** — count is exact, not a floor.
- Everything else Jeff verified against `a4e7f7b` already: all eight §1.8 identifiers match, §1.9 holds (`netlify.toml` has no context blocks; `verify-contacts.cjs` floor is 121+4N -> 133 -> +9 -> 142 at strict equality, L783), §1.7 and §1.5 hold (`RESURFACE_HOURS = 12` at L50; Precise-first at L329; `optedOutContactIds` consumed only in `visibleUnanswered` at L622).

**Jeff's SHA handling is adopted as the standing rule:** verify §1's repository claims against **current HEAD**, not the SHA the brief cites, and state the delta. He noted `a4e7f7b` adds only the brief itself, so no code moved between `9a299b0` and HEAD.

---

## Jeff: proceed to the full measurement

Deliverable #2 is answered by this document. Deliverables #1 and #3-#8 remain yours.

**Unchanged:** no implementation, no GHL modifications, no Production writes. Return the measured plan and the native-vs-softphone comparison. Do not write code.
