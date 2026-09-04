# Underwriting Field Reference

Identifiers for the GHL carriers PB-D56 names. This document holds ids and
keys; PB-D56 holds the decisions about what they mean. Where the two
disagree, PB-D56 governs and this file is corrected.

This is not Contact schema. `docs/CONTACT_FIELD_REFERENCE.md` covers the
contact model; these are location-scoped Custom Values and
Opportunity-model custom fields, which are different objects with
different scopes.

**Not yet consumed by code.** No IAOS code reads any identifier below.
When it does, PB-D51 governs: identifiers move into the shared
configuration module rather than being copied from this file into call
sites. This document is the human reference and the record of what was
created; it is not a substitute for shared config.

OBSERVED 2026-08-14 through the deployed proxy at
`/locations/jmHG4B8RdzwpfqruNf68/customValues` and
`/customFields?model=opportunity`.

---

## Investor policy Custom Values

The eleven values PB-D56 section IV names, each authoritative for its
assumption. Values are stored as flat strings and carry no symbols --
`10` not `10%`, `5000` not `$5,000`.

| Value | Id | fieldKey | Starter | Status |
|---|---|---|---|---|
| Default Selling Cost Percentage | `huOzq1VKscRVL6O2Wp20` | `custom_values.default_selling_cost_percentage` | 10 | created 2026-08-13 |
| Default Closing Cost Estimate | `kapXvTS9tNYVRn7L3WBY` | `custom_values.default_closing_cost_estimate` | 2500 | pre-existing, retained |
| Default Monthly Holding Cost | `GLOwuyga9MW2qA7jfGUC` | `custom_values.default_monthly_holding_cost` | 500 | created 2026-08-13 |
| Default Hold Period Months | `ZABxPRW2bCYZVnnRuLop` | `custom_values.default_hold_period_months` | 5 | created 2026-08-13 |
| Default Buyer Profit Percentage | `Ld3CuvhR9KUxYbfT8keM` | `custom_values.default_buyer_profit_percentage` | 15 | created 2026-08-13 |
| Purchase Financing Enabled | `dq8qdnXR6qxzGy0shUby` | `custom_values.purchase_financing_enabled` | On | created 2026-08-13 |
| Default Financing LTV Percentage | `kEoZ1afVMK2LrSrvnWUR` | `custom_values.default_financing_ltv_percentage` | 70 | created 2026-08-13 |
| Default Interest Rate Percentage | `veTIWiG4s4cvYTMuVbUY` | `custom_values.default_interest_rate_percentage` | 12 | created 2026-08-13 |
| Default Financing Points Percentage | `9ONatv0Y9FOfpdDTIkGz` | `custom_values.default_financing_points_percentage` | 2 | created 2026-08-13 |
| Standard Minimum Assignment Spread | `MuQih1mjmxVVOQ01Naq1` | `custom_values.standard_minimum_assignment_spread` | 5000 | created 2026-08-13 |
| Buyer Profit Share Percentage | `XqzNrXRIXXS3dcvAFz6o` | `custom_values.buyer_profit_share_percentage` | 25 | created 2026-08-13 |

**fieldKeys are recorded as the interpolation stem.** GHL renders them in
templates as `{{ custom_values.x }}`. The braces are the template syntax,
not part of the key.

### Legacy Custom Values, deliberately not adopted

Both remain in GHL. Neither is authoritative under PB-D56.

| Value | Id | Current | Why retained |
|---|---|---|---|
| Default Assignment Fee Minimum | `CYbQD0obDuQFaF7kIoVv` | 5000 | PB-D56 section VI: NOT renamed and NOT deleted. `Standard Minimum Assignment Spread` is the authority; this is a deliberate, time-boxed duplicate held until workflow references are verified. Renaming may change the fieldKey; deleting may break a workflow that interpolates it. |
| Default Wholesale Percentage | `YrXemW06OZe6S85Vgl5b` | 70 | Belongs to the 70%-rule formula retired 2026-08-13 with `mao-webhook.ts`. Obsolete for underwriting and not read by the PB-D56 model. Retained pending the same workflow-reference verification. |

**The duplicate is intentional and is not a defect.** PB-D56 section VI
creates it knowingly and names which value governs. It resolves when
workflow references to the legacy value are checked -- which per §4.6 is
not API-derivable and must be done in the GHL builder.

---

## Opportunity underwriting fields

Opportunity-model custom fields. PB-D55 establishes that underwriting
authority belongs to the Opportunity; these are its carriers.

| Field | Id | fieldKey | Type | Carries |
|---|---|---|---|---|
| End-Buyer Maximum Purchase Price | `zOVIPwzLe41a0SQmwVAJ` | `opportunity.endbuyer_maximum_purchase_price` | NUMERICAL | the modeled buyer ceiling |
| Assignment Mode | `TpLo0WRc303TXAaBUbBf` | `opportunity.assignment_mode` | SINGLE_OPTIONS | which of PB-D56's three spread modes governs |
| MAO (Max Allowable Offer) | `Atu5XCjpFElY8H64VG4h` | `opportunity.mao_max_allowable_offer` | NUMERICAL | Seller MAO |

### Opportunity deal facts — write status

Deal facts are what the operator supplies; the three carriers above are what
underwriting produces. PB-D59 section I keeps them apart and excludes the deal
facts from Approve. That separation is unchanged.

| Field | Field ID (Production / Test) | dataType | Inert proof | Named writer |
|---|---|---|---|---|
| `opportunity.arv_after_repair_value` | `cBkygqcHRseZUGCYYeba` / `ppe2ZTO7DJTMao74xvYI` | NUMERICAL | **Proven inert in the IAOS TEST location, 2026-09-04** — five-step absent-origin cycle on Test fixture `MAl1FWHEsK0QqsXt4v6f`, PB-D62, recorded in `PHASE_B_INERT_PROOFS.md`. Production-location workflow behaviour is NOT established by it; see PB-D62 section V | **Implemented, PB-D63 / INV-25 Tranche 2** — `ghl.opportunities.setApprovedArv`, one field, named, config-resolved, singular-GET-confirmed |
| `opportunity.repair_estimate` | `hId4Yog6u5GP1Iwz1aNx` / `lSWxFUmWksfrViePG4UC` | NUMERICAL | none | none |
| `opportunity.asking_price` | `YxCDaX7dLhBJL9GLGFpJ` / `owIOWnJuIheiwJVdJWQ5` | NUMERICAL | Proven inert 2026-08-29, PB-D60, Production fixture | `setAskingPrice` |

Both new fields were created 2026-08-13 in folder
`FQJ2zGEAIJu0JA9NubCL`, alongside the existing underwriting fields.

**Assignment Mode picklist options, exactly and in order.** OBSERVED from
the wire:

    Standard Minimum
    25% of Buyer Profit
    Manual

These match PB-D56 section II's three modes verbatim. The option strings
are the stored values; changing one silently invalidates any deal
carrying it.

**`mao_max_allowable_offer` is reused, not created.** It predates this
model. Its only writer was `mao-webhook.ts`, retired 2026-08-13, and the
field is empty on all 42 opportunities in the location. PB-D56 assigns it
to Seller MAO because it has no surviving consumer and no semantics to
violate. Note the inherited exposure: unlike the two new fields, this one
existed long enough for a workflow to reference it, and whether any does
is UNKNOWN.

---

## Wire shape

Opportunity custom fields do not return in the contact model's shape.

    contact:      { id, value }
    opportunity:  { id, type, fieldValueNumber }
                  { id, type, fieldValueDate }

The projection is sparse -- only populated fields appear. Dates arrive as
unix milliseconds rather than ISO. An opportunity read path needs its own
parser and cannot reuse `parseContact`'s readers; `MaoCalculator.tsx`'s
three type-specific readers are the existing precedent.

Custom Values return as flat strings with an id, name, fieldKey, value,
locationId, and `documentType: "field"`.

---

## What is not here

Deal-override fields. PB-D56 creates them on first real need rather than
in advance, so none exists yet. `opportunity.closing_costs` and
`opportunity.wholesale_fee_` are candidates whose only readers were the
two functions retired 2026-08-13; `opportunity.assignment_fee_target` is
still referenced by `MaoCalculator.tsx`.
