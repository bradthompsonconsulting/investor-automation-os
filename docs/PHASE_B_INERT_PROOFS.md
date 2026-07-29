# Phase B — inert-proof evidence record

Per PHASE_B_SPEC.md 10.4. One entry per field, two dated parts, never merged.
Part 1 authorizes the unlock commit. Part 2 is written after the unlock deploys.

---

## contact.property_notes

Field ID k7O0TYVMpqCpnMHRLPol / TEXT / Investor subgroup / parentId qYS1wakeOTmfgjyeSJ8M
Fixture bradt75, contact ID 9fbH2VCcZvzVNhsR9zjc, per CONTACTS_OPPORTUNITIES_SPEC.md 4.2

### Part 1 — inert-proof (2026-07-27) — PASS

Executed as five separately approved increments per the 10.3 write-separation
invariant. Two PUTs total, each independently approved and verified.

**Before-state, OBSERVED from the singular GET.**
Target field k7O0TYVMpqCpnMHRLPol ABSENT.
customFields, 5 entries, id and value as returned:
  1cTefPDpZRypKYHtgZrq  "Unknown"
  LM4bs21UP3i6OJpUirQQ  ["90+ Days"]
  tG4gGFI8JB2VjWeuqYMx  "2623 Greenway Dr"
  2vz1igGMxF3wv7HaWm97  "2026-07-23T20:03:17.066Z"
  lGoNXM9Wrte4m7ShwQPT  "2026-07-23"
tags ["seller-lead"]
opportunity 4zCenJMlSlrwPF5UUQRv, pipeline GpUWK4YlhNqBzm5Hrm58,
pipelineStageId and pipelineStageUId both 71227a30-2303-4165-aa58-e56860146959

**PUT 1 — temporary value.**
PUT /contacts/9fbH2VCcZvzVNhsR9zjc through ghl-proxy, Content-Type application/json
Body as sent:
  {"customFields":[{"id":"k7O0TYVMpqCpnMHRLPol","field_value":"IAOS INERT PROOF 2026-07-27 DO NOT USE"}]}
Response HTTP 200. Response body carried keys: succeded, succeeded, contact, traceId.
GHL returns both the misspelled and correctly spelled success keys. OBSERVED, not corrected.

**10.3 step-4 confirmation after PUT 1 — all five PASS.**
Target value observed on poll 1 of 15 via singular GET, not the PUT echo.
  PASS targetEqualsTemp
  PASS othersUnchanged   union of before and after ids, deep compare
  PASS tagsUnchanged
  PASS offersAbsent      all seven offer_ ids still absent
  PASS stageUnchanged    all four opportunity values equal

**PUT 2 — clear.**
Body as sent:
  {"customFields":[{"id":"k7O0TYVMpqCpnMHRLPol","field_value":""}]}
Response HTTP 200.

**Clear semantics, OBSERVED.**
KEY_ABSENT. The key is removed from the customFields array entirely.
It does NOT return as an empty string. No permanent fixture residue.
Observed on poll 1 of 15 via singular GET.

Per 10.3, clear semantics are now OBSERVED for TEXT. This determination is not
repeated for other TEXT fields. It does NOT carry to other dataTypes: DATE ignores
"" and requires null (see setCallbackDatetime in ghl.ts). Each new dataType tests
clear semantics in its own first proof.

**Restore confirmation — all four PASS.**
  PASS othersUnchanged
  PASS tagsUnchanged
  PASS offersAbsent
  PASS stageUnchanged
bradt75 returned to its exact before-state: same five custom fields, same values,
same tags, same stage. Target field absent, as it was before the proof.

**General findings carried to all future fields.**
Reads return the key `value`. Writes take the key `field_value`. Not interchangeable.
A single-field PUT is inert: it changes the target and nothing else.

**Evidence artifacts.**
Scripts app/scripts/inert-proof-property-notes-step1 through step5 .cjs
Commits 66960e8, 1a6087f, 4f54c41, d364f8f, f8af043, bc47dab

### Part 2 — UI behavior

**PASS (2026-07-27).** Verified manually against the deployed unlock, commit
190a0f3, bundle index-DrFkq5CQ.js. Fixture bradt75 / 9fbH2VCcZvzVNhsR9zjc per
4.4. Observations taken from the browser DevTools Network panel, not inferred.

- Input starts at wire value. Textarea renders the GHL value on load; empty when
  the key is absent.
- Dirty state. Editing enables Save and Cancel; both are disabled while clean.
- Cancel restores the wire value and performs NO write. Request count unchanged
  across the Cancel click (118 before, 118 after). OBSERVED.
- Save performs exactly ONE PUT. One ghl-proxy row per click, HTTP 200.
- Write contract confirmed from the app, not only from a script. Request payload
  OBSERVED as `{customFields: [{id: "k7O0TYVMpqCpnMHRLPol", field_value: "text"}]}`.
  Response body carried both `succeded: true` and `succeeded: true` and returned
  the contact with `{"id": "k7O0TYVMpqCpnMHRLPol", "value": "text"}`. Reads
  return `value`, writes take `field_value` — confirmed on the wire from the UI.
- Persistence. Reload re-reads from GHL and shows the saved value.
- Newlines round-trip. NEW OBSERVATION, previously UNKNOWN: a multi-line value
  survives app to proxy to GHL and back with line breaks intact on a TEXT field.
  Four lines were written and four returned after reload. PB-D2's newline clause
  holds on the wire.
- Enter does not submit. Enter and Shift+Enter both insert a newline; only the
  Save control writes. No blur autosave. PB-D2 confirmed.
- Empty Save clears. Clearing the textarea and saving returns the key to absent;
  reload shows empty. PB-D1 clear semantics confirmed from the UI. Fixture
  restored to its pre-test state.

**UNKNOWN — one unreproduced failure.** The first Save attempt of the session, on
a page that had been open across the 190a0f3 deploy, did not persist and surfaced
no error. Every subsequent attempt on a freshly loaded page passed. The cause is
UNKNOWN. A stale bundle in that tab is INFERRED, not observed; the evidence was
not captured before the page was reloaded. Recorded here rather than explained
away. If it recurs on a freshly loaded page it is a real defect and this entry
should be revisited.

**Evidence artifacts.**
Manual verification, browser DevTools. Unlock commit 190a0f3; harness re-pin
fd6689e. Harness at floor 123 passing is recorded separately per 10.5 and does
not cover save/cancel behavior by design.

## contact.arv

First MONETORY-class field. Part 1 fixture bradt75 / 9fbH2VCcZvzVNhsR9zjc per
CONTACTS_OPPORTUNITIES_SPEC.md §4.2. Part 2 names its own fixture; see below.

### Part 1 — inert-proof (2026-07-28) — PASS

Target wMBTGWMs97yysQFx7Vad (ARV), dataType MONETORY. ABSENT on the fixture before
the proof, so "restore" IS "clear" — the restore step depended on the clear-semantics
unknown the proof was run to settle. Both outcomes were designed for up front.

**Before-state.** ARV ABSENT. 5 custom fields, tags ["seller-lead"], opportunity
4zCenJMlSlrwPF5UUQRv, pipelineStageId 71227a30-2303-4165-aa58-e56860146959.

**PUT 1 — temporary value.**
Body as sent:
  {"customFields":[{"id":"wMBTGWMs97yysQFx7Vad","field_value":187500.25}]}
Sent as an unquoted JS number via JSON.stringify — the shape a currency editor
would send. HTTP 200.

**Step-4 confirmation after PUT 1 — all five PASS.**
Target observed on poll 1 of 15 via singular GET, not the PUT echo.
  PASS targetPresent     presence, not value equality — the stored representation
                         was the UNKNOWN under test and could not be an assertion
  PASS othersUnchanged
  PASS tagsUnchanged
  PASS offersAbsent
  PASS stageUnchanged

**MONETORY WRITE contract, OBSERVED.**
raw value 187500.25, typeof number, strictly equal to the number sent. A MONETORY
write accepts an unquoted number. GHL neither coerces to string nor rounds at two
decimals. This is the write-side complement to the read contract in PHASE_B_SPEC.md
§10.8 PB-D14, and unlike PB-D14 it was observed on a value chosen for the test.

**PUT 2 — clear.**
Body as sent:
  {"customFields":[{"id":"wMBTGWMs97yysQFx7Vad","field_value":""}]}
HTTP 200. A 200 alone does not distinguish removal from silent ignore — DATE returns
200 on "" and ignores it. The singular GET settled it.

**MONETORY clear semantics, OBSERVED.**
KEY_ABSENT on poll 1 of 15. field_value:"" removes the key entirely, same as TEXT,
NOT ignored as DATE ignores it. The step-4b null fallback that was designed for was
not needed and was never built.

**Restore confirmation — all four PASS.**
  PASS othersUnchanged
  PASS tagsUnchanged
  PASS offersAbsent
  PASS stageUnchanged
bradt75 returned to its exact before-state: same five custom fields, same values,
same tags, same stage. ARV absent, as it was before the proof.

**Findings carried forward.**
MONETORY and TEXT agree on clear semantics. Two agreeing dataTypes is not a general
rule — DATE already disagrees. The per-dataType first proof stands.

**Evidence artifacts.**
Scripts app/scripts/inert-proof-arv.cjs and inert-proof-arv-step2 through step5 .cjs

### Part 2 — UI behavior

**PASS (2026-07-28).** Verified manually against the deployed unlock, commit
cae3435, bundle index-CZhV6PIw.js, harness re-pin 5f022fc. Fixture Neelima /
FiIT0hUaxVCIuokQpZuc — NOT the bradt75 write fixture used in Part 1. ARV is
ABSENT on bradt75 and every display-side case below requires a populated value,
so §10.5's vacuity rule forced the display fixture. Deviation recorded, not
silent. Observations taken from the browser DevTools Network panel filtered to
ghl-proxy, Preserve log on, not inferred.

**At rest.**
- Display span renders $250,000.50. No input element present. PB-D17's Model B
  display→edit swap confirmed in the DOM.

**Cancellation.**
- Escape after typing 999: display reverted, ZERO requests. PB-D19's synchronous
  cancellation verified on the wire, not only in the ref.

**Invalid input.**
- 25,00,0 then Enter: editor STAYED OPEN, draft preserved, red border, inline
  "Not a valid amount", ZERO requests. PB-D20's grouping rule holds — the
  malformed value was not silently stripped to 25000 and focus was not forced.

**No-op.**
- Unchanged value plus click-out: ZERO requests. PB-D10 confirmed from the UI.

**Commits — exactly one PUT and one GET each, four times.**
- Enter, 260000. Saved.
- Tab, 265000.75. Saved, focus advanced to Property Notes. Decimals survive the
  UI round-trip, matching the Part 1 write contract.
- Click-out, 270000. Saved.
- Enter, accepted syntax $250,000.50. Saved; $ and comma normalized and a bare
  number sent to GHL. This commit doubled as the fixture restore.

**Enter double-commit — no second write. OBSERVED, with a caveat.**
Enter calls commit() directly and the unmount also fires blur, calling commit()
again. Exactly one PUT appeared on every Enter commit; the second call
short-circuits before the network on PB-D10's unchanged-value guard. The absence
of a second PUT is OBSERVED. The caveat is structural: correctness rests on the
guard rather than on a single commit path, which is the shape PB-D21 rejects
elsewhere. Known defect, not fixed in cae3435.

**Verify poll — hit on attempt 1, all four commits. NEW OBSERVATION.**
PB-D21's bounded poll never needed a second attempt; GHL's singular GET
reflected the write within roughly 250ms every time, so "Save accepted — not yet
confirmed" was never reached. Separately, verify() sleeps 1000ms BEFORE its
first read, so every save displayed "Verifying…" for a full second despite the
read being available far earlier. Known defect, not fixed in cae3435.

**Persistence.**
- Hard refresh: $250,000.50 persisted.

**NOT EXERCISED — failure branches.**
"Save failed" (PUT non-2xx) and "Couldn't verify save" (GET errors) were not
reached. No natural way to induce either during normal operation. The intended
method is DevTools request blocking on the ghl-proxy GET, conditional on the
verify GET and the save PUT being distinguishable by URL — if they share a URL
and differ only by method, blocking kills the PUT and exercises "Save failed"
instead. That distinction is UNKNOWN and must be OBSERVED before the test is
designed. These branches were unverified as of Part 2. See Part 3 — the URL
distinction was OBSERVED as identical, blocking was rejected, and "Couldn't
verify save" was exercised by another method. "Save failed" remains unverified.

**Evidence artifacts.**
Manual verification, browser DevTools, no script. Unlock commit cae3435; harness
re-pin 5f022fc; harness race fix 7dd0352. Harness at floor 127 passing is
recorded separately per §10.5 and does not cover commit or cancellation behavior
by design — per PB-D17 the at-rest no-input allowlist governs the DOM but does
not prove editability, and the harness must not type or dispatch blur.

### Part 3 — failure branch, GET error

**PASS (2026-07-28).** Same build as Part 2 — commit cae3435, bundle
index-CZhV6PIw.js, no deploy between. Fixture Neelima / FiIT0hUaxVCIuokQpZuc.
Browser DevTools, Network filtered to ghl-proxy.

**Blocking rejected — the method Part 2 named does not work. OBSERVED.**
Every contacts-path row carries the identical URL,
ghl-proxy?path=%2Fcontacts%2FFiIT0hUaxVCIuokQpZuc, for both the save PUT and the
verify GET. The path is fully rendered, not truncated. There is no method
discriminator in the URL and DevTools request blocking matches on URL only.
Blocking that pattern would kill the PUT alongside the GET and exercise "Save
failed" instead of the intended branch. The UNKNOWN Part 2 recorded is now
settled, and the answer invalidated the plan.

**Method used instead.** Network conditions toggled to Offline in the window
between PUT completion and the first verify read. This depends on verify()
sleeping 1000ms BEFORE its first read — the known defect recorded in Part 2 is
what made the window wide enough to hit by hand. See the reusability note below.

**Result — PB-D21 GET-error branch PASS.**
ARV committed as 100000 by Enter. Exactly two rows appeared:
  PUT   200, 3.2 kB, 587 ms
  GET   (failed) net::ERR_..., 0.0 kB, 2 ms
UI rendered "Couldn't verify save" beside a retained $100,000.00 display. No
second PUT. PB-D21's no-auto-repeat guarantee held under a real transport
failure, not by inspection.

**Display retention is correct.** The optimistic value was retained rather than
reverted. The PUT was accepted; only verification failed. Reverting would have
misreported a write that had in fact landed.

**NEW OBSERVATION — spec gap, OPEN.**
Exactly ONE failed GET appeared, not three. A thrown fetch error exits the poll
immediately; PB-D21's bound of 3 attempts 1s apart governs the NO-MATCH case, not
the ERROR case. This is defensible behavior — a disconnected transport will not
heal within 2s — but it is not what PB-D21's text says, and it was never a
recorded decision. OBSERVED here; PB-D21 not yet reconciled. Open item.

**Method not reusable after the pending cleanup.** The planned verify()
read-then-sleep fix removes the 1000ms pre-read window this test depended on.
Any future re-run of this branch needs a new method. Recorded so the technique
is not assumed available.

**Fixture restored.** Network restored to No throttling, ARV re-committed as
250000.50 by Enter: 1 PUT + 1 GET, both 2xx, "Saved". Neelima back to its Part 2
baseline of 250000.5.

**STILL NOT EXERCISED.**
"Save failed" — PUT returns non-2xx. Not reached; no method identified.
"Save accepted — not yet confirmed" — 2xx PUT with no match inside the poll
bound. Not reached; the poll hit on attempt 1 on every successful commit across
Parts 2 and 3.

### Part 4 — UI behavior after the Enter/verify cleanup

**PASS (2026-07-28).** Commit 15ab0a3, bundle index-CAm1I0Dq.js, harness re-pin
c64d3fc. Fixture Neelima / FiIT0hUaxVCIuokQpZuc, hard-refreshed onto the new
bundle before the first commit. Browser DevTools, Network filtered to ghl-proxy
with the Method column enabled. Method is the ONLY reliable PUT/GET
discriminator — response size does not separate them, since the two endpoints
carry different payloads. The size heuristic used informally in Parts 2 and 3
should not be relied on again.

**Three commit paths, one write each. PASS.**
- Enter, 260000: PUT 200 3.4 kB / 751 ms, GET 200 1.7 kB / 240 ms. Saved.
- Tab, 265000.75: PUT 200 3.4 kB / 605 ms, GET 200 1.7 kB / 289 ms. Saved.
  Decimals survive under the blur-single-path commit, consistent with the Part 1
  MONETORY write contract and the Part 2 round-trip.
- Click-out, 270000: PUT 200 3.2 kB / 422 ms, GET 200 1.6 kB / 230 ms. Saved.

**Enter double-commit CLOSED.** Part 2 recorded exactly one PUT on Enter but
attributed it to PB-D10's unchanged-value guard. That attribution does not
survive the code: setSaved runs only after the PUT resolves, so at unmount the
guard would not have short-circuited. Whatever suppressed the second write in
Part 2 was not the guard. Under 15ab0a3 the question is moot — Enter calls blur
and blur is the single commit path — and one PUT per Enter is OBSERVED here on
the wire. The Part 2 sentence naming the guard is INCORRECT AS WRITTEN and is
superseded by this entry.

**Verify poll — attempt 1, every commit, reading immediately.**
With the 1000ms pre-read sleep removed, the first read still matched on every
commit including a slow one (PUT 1.73 s, GET 272 ms). GHL reflects a MONETORY
write faster than the PUT round-trip itself, so the removed sleep was pure dead
time. "Save accepted — not yet confirmed" remains unreached.

**NEW OBSERVATION — focus is lost on invalid input. OPEN.**
Typed 25,00,0 and pressed Enter. The editor stayed open with the draft
preserved, red border, inline "Not a valid amount", ZERO requests — and focus
went NOWHERE. Typing a character with no intervening click produced nothing. A
click back into the field restored focus with the draft intact (25,00,0 became
25,00,09, still invalid, still zero requests), and a subsequent valid commit
behaved normally: 1 PUT + 1 GET, Saved.

This was INFERRED from source before the test and is now OBSERVED. The editor is
open but inert until clicked.

**CORRECTION — this is a spec violation, not a spec gap.** The paragraph above as
first written claimed PB-D20 does not say what focus should do. It does: "On
Enter, focus stays in the field." Enter is specified explicitly, and the observed
behavior is its opposite. PB-D20 further specifies that on click-out or Tab focus
moves normally and the editor stays open but unfocused — so those two paths are
COMPLIANT and always were. The claim that this condition was pre-existing on Tab
and click-out and merely extended to Enter is also wrong: before 15ab0a3, Enter
called commit() directly with the input still mounted and focused, and satisfied
the decision. 15ab0a3 routed Enter through blur(), which removes focus by
definition, and autoFocus fires only at mount so it never returns.

PB-D20 requires no amendment. The implementation must be restored to satisfy it.
Tracked as a defect for the next app commit; the introducing commit is named here
rather than in the specification, which states required behavior and carries no
commit history.

**Fixture restored.** ARV re-committed as 250000.50: 1 PUT + 1 GET, both 2xx,
Saved, persisted across hard refresh. Neelima back to baseline 250000.5.

**STILL NOT EXERCISED.** "Save failed" (PUT non-2xx) — no method identified.
"Save accepted — not yet confirmed" — never reached across Parts 2, 3, and 4.
The Part 3 Offline-window technique is no longer available; the pre-read sleep
it depended on was removed by 15ab0a3.

## contact.arv — post-fix verification

### Part 5 — PB-D20/PB-D21 fixes, manual verification. MIXED.

**2026-07-29.** Commit 54aff63, bundle index-Dg2_4V9j.js, harness re-pin 18702b2.
Fixture Neelima / FiIT0hUaxVCIuokQpZuc. Browser DevTools, Network filtered to
ghl-proxy, Method column enabled. Harness passed 127/127 against the new bundle
before manual work began — that covers the at-rest surface only and by design
exercises neither fix.

**PB-D20 focus retention — FAIL. Mechanism NOT ISOLATED.**
Required behavior, from PB-D20 verbatim: "On Enter, focus stays in the field."
The acceptance criterion is behavioral — after an invalid amount plus Enter, the
NEXT KEYSTROKE must land without an intervening click.

That did not occur reliably. 25,00,0 plus Enter left the editor open with the
draft and the inline error and fired ZERO requests, all correct; what followed
was not. Whether the subsequent keystroke landed was not captured on screen and
the operator's account and the screenshots do not agree closely enough to call
either way. Recorded as FAIL rather than inconclusive: the criterion is that the
behavior is reliable, and it was not.

Two candidate mechanisms, both UNTESTED:
  (a) focus is still lost — the 54aff63 fix did not take on the deployed bundle
  (b) focus is retained, and the observed failure came entirely from the
      empty-clear path below

**Empty-clear — PASS against the contract, HAZARDOUS in practice. OPEN.**
Clearing the field and pressing Enter committed a real clear: PUT 200 3.3 kB,
ARV displayed as "—", "Saved". This is PB-D20 as written — empty is valid input
and a real clear to KEY_ABSENT per PB-D16 — and the code is correct.

The hazard is the interaction with the invalid path. A user whose input was
rejected has an editor sitting open with a bad draft in it; the natural recovery
is select-all-delete, and that draft is now VALID, so Enter commits a clear and
the field's value is gone. From outside, "the app rejected my entry and then
erased the field" is one event, not two. This may also be the whole of the
FAIL above — if the recovery instinct is select-all-delete, fixing focus alone
would not have prevented what was observed.

Recorded as an OPEN spec question, not a code defect. Next session tests the two
as ONE interaction path, not as separate cases.

**Valid Enter commit — PASS.**
260000 plus Enter: PUT 200 3.2 kB / 331 ms, GET 200 1.6 kB / 280 ms, "Saved".
Exactly one write. The blur-single-path commit survived the 54aff63 change; this
was the regression risk in gating the blur and it did not regress.

**"Save failed" — NEWLY EXERCISED. Closes a branch open since Part 2.**
With Network conditions held Offline, Enter on a changed value produced PUT
(failed) net::ERR, 0.0 kB, 4 ms, and the UI rendered "Save failed: Failed to
fetch". PB-D21's PUT-failure branch had been NOT EXERCISED across Parts 2, 3,
and 4. It is now OBSERVED.

Three consecutive failed PUTs appear in the log. These were separate manual
Enter presses, not automatic repetition — the no-repeat rule is not implicated.
Stated here because three identical failures in sequence is exactly what an
auto-retry would look like and the record should not leave that ambiguous.

**PB-D21 retry-on-thrown-read — NOT TESTED.**
The 54aff63 change moves the catch inside the poll so a thrown read consumes an
attempt and the poll continues. That path was not reached: holding Offline kills
the PUT, so verification never starts. Reaching it requires a SUCCEEDING PUT
followed by FAILING reads, and the window between them is now approximately zero
because the pre-read sleep was removed. No instrument currently produces that
condition — URL blocking kills both, since the PUT and the verify GET share one
URL and differ only by method. Unverified.

**Fixture restored.** ARV re-committed as 250000.50: PUT 200 3.4 kB / 774 ms,
GET 200 1.7 kB / 232 ms, "Saved". Neelima back to baseline 250000.5.

**Carried to next session.** Inspect handleKeyDown in the DEPLOYED bundle to
settle (a) versus (b) from source rather than from the UI, then design a
deterministic test. Both the focus behavior and the empty-clear contract may
need changes; they are not the same defect and must not be conflated, but they
must be tested as one path.

### Part 6 — PB-D20 failure isolated. Part 5's FAIL is SUPERSEDED.

**2026-07-29, same day, no deploy between.** Bundle index-Dg2_4V9j.js read
directly over the wire with curl. No UI interaction; this entry is source
inspection of the SERVED artifact, not behavior.

**PB-D20 focus retention — PASS. Implemented as specified.**
The deployed keydown handler, verbatim from the bundle:

  function P(ae){
    if(ae.key==="Escape"){G.current=!0,ae.currentTarget.blur();return}
    ae.key==="Enter"&&(ae.preventDefault(),Z()&&ae.currentTarget.blur())
  }

Z()&&ae.currentTarget.blur() short-circuits. On an invalid draft Z() returns
false and blur never fires, so focus stays in the input. That is PB-D20's "On
Enter, focus stays in the field," satisfied in the served code.

Z is draftIsValid, minified. Verbatim from the bundle:

  function Z(){const ae=j.trim();return ae!==""&&!Xg.test(ae)?(_(!0),!1):!0}

Trim, test against the currency regex, set the invalid flag and return false on
failure, otherwise true. commit() opens with if(!Z())return, so the defensive
gate is present as well.

**Part 5's FAIL is SUPERSEDED.** Part 5 recorded PB-D20 focus retention as FAIL
with mechanism NOT ISOLATED, and named two candidates. Candidate (a) — the fix
did not take on the deployed bundle — is now DISPROVED. Candidate (b) is
CONFIRMED. Part 5's finding was correct on the evidence then available and is
wrong as a standing conclusion; this entry supersedes it. Part 5 is not edited.

**What actually happened, reconstructed.**
  1. 25,00,0 plus Enter. Z() false, no blur, focus RETAINED, error shown. Correct.
  2. Select-all-delete to recover from the rejected draft. Draft is now empty.
  3. Enter. Empty is VALID per PB-D20, so Z() returns true, blur fires, commit
     runs, and empty commits a real clear to KEY_ABSENT per PB-D16.
  4. ARV renders as "—". The row is a display span again; the editor is gone.

From outside this is one event: "it rejected my entry and then erased the field."
Both halves are individually spec-compliant. The defect is in the interaction,
not in either rule.

This also explains the "cannot change anything, refresh does nothing" observed at
the time — after the clear the row is a display span, and the Additional Info
folder collapses on reload, so there was no input to type into.

**Deployment and compilation candidates CLOSED.** The served bundle contains the
reviewed fix, correctly compiled. Neither a deployment mismatch nor a
minification artifact is implicated. Recorded because ruling these out was the
reason to read the served artifact rather than the repo.

**What remains OPEN.** Whether an empty draft should commit a clear on Enter at
all, given that select-all-delete is both the natural recovery from a rejected
draft and the destructive gesture. That is a specification question against
PB-D20 and PB-D16, not a defect in either. No code changes until it is decided.

## Part 7 — PB-D22 manual verification, ARV on FiIT0hUaxVCIuokQpZuc

Bundle under test: `index-DGhQbSl_.js`. Every observed network request in this Part listed `index-DGhQbSl_.js:3` in the DevTools Initiator column, confirming these tests executed against the pinned bundle. Method column enabled; filter `ghl-proxy`; Preserve log on.

**Test 1 — empty draft + Enter on a populated field (clean path).** Zero requests. Editor closed. ARV display restored to `$250,000.50`. PASS.

**Test 2 — full recovery path (the sequence that erased the field on 2026-07-28).**
- Click ARV, type `25,00,0`, Enter: red border, "Not a valid amount", editor open, focus retained, **zero requests**.
- Select-all, Delete: editor empty, **zero requests**.
- Enter: editor closed, ARV display restored to `$250,000.50`, **zero requests** in a Preserve-log capture taken after the keystroke.
- Reopen ARV: editor opens with `250000.5`, no red border, no error text. The invalid flag is reset on PB-D22 exit.

PASS. PB-D22 covers the complete post-invalid recovery path. The field was not cleared and no PUT was issued. Step 3 independently corroborates Part 6: focus was retained on invalid input.

**Test 3 — valid commit still works.**
- `260000` + Enter: exactly two requests, PUT 200 (947 ms) then GET 200 (241 ms). Display `$260,000.00`, "Saved".
- `250000.5` + Enter: exactly two requests, PUT 200 (633 ms) then GET 200 (226 ms). Display `$250,000.50`, "Saved".

PASS. Fixture restored to `250000.5`.

**Not exercised in Part 7:** PB-D21 retry-on-thrown-read. Each successful PUT was followed by exactly one successful verification GET; no retry condition occurred. "Save accepted — not yet confirmed" was likewise not reached and remains UNVERIFIED.
