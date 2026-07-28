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

First MONETORY-class field. Fixture bradt75 / 9fbH2VCcZvzVNhsR9zjc per
CONTACTS_OPPORTUNITIES_SPEC.md §4.2. No Part 2 — no unlock has shipped.

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
