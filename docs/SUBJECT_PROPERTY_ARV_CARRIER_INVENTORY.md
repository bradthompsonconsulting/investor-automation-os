# Subject-property and ARV carrier inventory — B7-03 / INV-20

## Purpose and boundary

This is the bounded B7-03 inventory of carriers that already exist for the
subject property and ARV. It records where an existing carrier is sufficient,
where a genuine carrier gap remains, and which superficially similar fields
must not be repurposed.

This inventory creates no field and authorizes no write. It implements no
comp import, classification, valuation, repair-estimation, MAO, offer, or
Production behavior. PB-D61 remains the authority for the future ARV evidence
contract; PB-D55 remains the authority for deal-fact ownership.

Every finding below is classified under `FOUNDATIONAL_PRINCIPLES.md` section I.
`OBSERVED` names a repository source. `INFERRED` is a conclusion from those
sources. `UNKNOWN` means the repository does not establish the fact.

## Existing carriers

### Subject-property identity

| Carrier | Scope and shape | Current IAOS use | Finding |
|---|---|---|---|
| `contact.address1` / `city` / `state` / `postalCode` | Native Contact fields; together they are the address-identity set | `scripts/import-propstream-csv.ts` binds them from PropStream's Address + Unit #, City, State and Zip columns. B7-02's handoff requires street, city and state and copies the complete address for the operator. | **OBSERVED — sufficient.** `PROPSTREAM_HANDOFF_V1.md` lines 125-139 and `CONTACTS_OPPORTUNITIES_SPEC.md` lines 110-120 identify these as the one-contact/one-property key and the address returned to PropStream. **NO CHANGE:** reuse them; create no parallel subject-address carrier. |
| `contact.property_address` | Contact custom TEXT field; Production id `tG4gGFI8JB2VjWeuqYMx`, Test id `1B6u7F1MipquMxVWnAD9` | Parsed for Contact display/list use and present in shared configuration. The PropStream importer does not populate it and B7-02 deliberately excludes it from the handoff. | **OBSERVED — existing duplicate, not the subject key.** `PROPSTREAM_HANDOFF_V1.md` lines 137-139, `contact-parse.ts`, and `shared/ghl-config.ts` establish the behavior and ids. **NO CHANGE:** do not backfill, synchronize, rename, remove, or promote it under B7-03. |

The native address-identity set is read-only on an existing Contact. A new
property means a new Contact; changing the address on the existing Contact
would corrupt IAOS's one-contact/one-property rule. `country` is not part of
the set. These are **OBSERVED** decisions in
`CONTACTS_OPPORTUNITIES_SPEC.md` section 4.3, not new B7-03 policy.

### Subject-property descriptive facts already present on the Contact

All rows below are **OBSERVED** in `CONTACT_FIELD_REFERENCE.md` and
`FIELD_REGISTER.md`. They are Contact custom fields in GHL's Additional Info
folder unless noted otherwise.

| Fact | fieldKey | Production id | Type |
|---|---|---|---|
| County | `contact.county` | `kRon68UXcYdwf7qhiN41` | TEXT |
| APN | `contact.apn` | `q9zsc4u0VphwgHhuo0q9` | TEXT |
| Property Status | `contact.property_status` | `vQsnHuf4RwwDFVR6o4vs` | TEXT |
| Property Notes | `contact.property_notes` | `k7O0TYVMpqCpnMHRLPol` | TEXT |
| Property Type | `contact.property_type` | `ba4WeG05Y9H4DZNIqtbr` | TEXT |
| Bedrooms | `contact.bedrooms` | `NgPGkwiRYKJo2pJUA0fD` | NUMERICAL |
| Total Bathrooms | `contact.total_bathrooms` | `Eq0QNB2jynlQQKisRrbg` | NUMERICAL |
| Building Sqft | `contact.building_sqft` | `NBESmVYKID36qE4z6CIy` | NUMERICAL |
| Lot Size Sqft | `contact.lot_size_sqft` | `pSZd41d0elvtCBIAOGOX` | NUMERICAL |
| Effective Year Built | `contact.effective_year_built` | `LAmqLtHfmVoHz8bn3Smt` | NUMERICAL |

PB-D61 needs subject square footage for its price-per-square-foot cross-check
and compatible property type for its primary-comp gate. **OBSERVED:** existing
`contact.building_sqft` and `contact.property_type` carriers already match
those facts. **NO CHANGE:** B7-03 creates no replacements. Whether imported
values are sufficiently normalized for future automated comparison is
**UNKNOWN**; a carrier's existence and data type do not prove value quality or
comparison semantics.

The Contact also has assessed value, prior-sale, estimated-value, loan,
equity, MLS, lien, occupancy, and condition fields. They remain available to
future authorized work, but none is reclassified here as comp evidence or as
ARV. In particular, `contact.est_value` and `contact.total_assessed_value` are
not substitutes for investor-approved ARV. That no-change conclusion follows
from PB-D61's evidence contract and the investor-authority amendment in
`SELLER_ACQUISITION_WORKFLOW.md`.

### ARV

| Carrier | Scope and authority | Current behavior | Finding |
|---|---|---|---|
| `contact.arv` | Contact custom MONETORY field; Production id `wMBTGWMs97yysQFx7Vad`, Test id `QkWl09I9yXGz8OIcs5Xd` | Read as the Contact seed when the selected Opportunity has no ARV. | **OBSERVED — sufficient as seed only.** `shared/ghl-config.ts`, `FIELD_REGISTER.md`, and `underwriting/resolver.ts` establish the ids, proof status, and seed behavior. **NO CHANGE:** retain; do not make it the approved deal authority. |
| `opportunity.arv_after_repair_value` | Opportunity custom NUMERICAL field; Production id `cBkygqcHRseZUGCYYeba`, Test id `ppe2ZTO7DJTMao74xvYI` | When populated, it supersedes the Contact seed. PB-D55 makes the Opportunity the authoritative home of approved deal facts. | **OBSERVED — sufficient for the ARV amount used by underwriting.** `SESSION_HANDOFF.md` lines 520-540, `shared/ghl-config.ts`, `UnderwritingWorkspace.tsx`, and `underwriting/resolver.ts` establish the ids and resolution rule. **NO CHANGE:** create no new ARV amount field. |
| `contact.offer_arv` | Contact `offer_` NUMERICAL field; Production id `Z88Y6IqCK1i7hObZcrQM` | Historical Save Offer surface from the superseded MAO Calculator. | **OBSERVED — protected snapshot, not an ARV authority.** It is in the section 4.1 HARD NO set. **NO CHANGE:** never repurpose or edit it through B7-03. |
| Opportunity `offer_arv` | Opportunity `offer_` NUMERICAL field; legacy id `Nm1LZvQzaCGvXDq7TRCh` in dormant `MaoCalculator.tsx` | The dormant calculator used it as the last saved offer snapshot and preferred it during that superseded surface's prepopulation. | **OBSERVED — protected legacy snapshot, not an ARV authority.** `SESSION_HANDOFF.md` records that the calculator is removed from operator navigation and its save helpers have zero callers. **NO CHANGE:** do not add it to shared config, restore the calculator, or reuse the field. |

The coexistence of Contact and Opportunity ARV is not itself a missing
carrier. **OBSERVED:** `resolveDealFacts` applies PB-D55's seed-then-supersede
rule: Opportunity wins when present; Contact supplies a seed only when it is
absent. `SESSION_HANDOFF.md` records that this duplication has caused operator
confusion. The amount carriers nevertheless suffice. Improving provenance
display or operator guidance would be separate UI scope, not carrier creation
and not part of B7-03.

## Genuine gaps

The following gaps are **OBSERVED** from PB-D61's final “What this does not
do” paragraph and the current-capability section of
`SELLER_ACQUISITION_WORKFLOW.md`:

1. No carrier exists for the comparable-sale evidence set.
2. No carrier exists for a comp's `ACCEPTED`, `SUPPORTING`, or `REJECTED`
   classification or the reason for that classification.
3. No carrier exists for the applied expansion level (`STANDARD`, `EXPANDED`,
   or manual-review `EXCEPTION`).
4. No carrier exists for the computed ARV indication, its categorical evidence
   state (`HIGH`, `MODERATE`, `LOW`, or `INSUFFICIENT`), or an
   `ARV_EVIDENCE_CONFLICT` result as evidence provenance distinct from the
   investor-approved ARV amount.
5. No carrier exists for override provenance: what IAOS computed, the evidence
   state it carried, and what Brad approved or changed it to.

These are inventory findings, not authorization to fill the gaps. PB-D61
explicitly says it creates no ARV-evidence or provenance carrier. Any future
carrier decision must preserve GHL as the sole system of record, separate a
computed indication from investor-approved ARV, and receive its own approval
and inert-proof before any write.

The repository does not establish whether a future comp import should persist
all five categories above, derive any of them, or use one record shape versus
another. Those implementation choices are **UNKNOWN** and deliberately remain
undecided here.

## Explicit no-change findings

- **NO CHANGE — subject address:** native `address1` / `city` / `state` /
  `postalCode` already carry the subject identity used by the PropStream
  handoff.
- **NO CHANGE — subject comparison inputs:** `contact.property_type` and
  `contact.building_sqft` already carry the PB-D61 property-type and square-foot
  facts. Carrier creation is unnecessary; normalization quality remains a
  later evidence question.
- **NO CHANGE — approved ARV amount:**
  `opportunity.arv_after_repair_value` already carries the authoritative deal
  amount. `contact.arv` remains its seed and is not synchronized back from the
  Opportunity.
- **NO CHANGE — custom Property Address:** keep
  `contact.property_address` as an existing read/display carrier; do not make it
  the PropStream subject key or introduce synchronization.
- **NO CHANGE — offer snapshots:** neither Contact nor Opportunity
  `offer_arv` is reused. The Contact `offer_` family remains HARD NO, and the
  dormant calculator does not create a new authority.
- **NO CHANGE — estimated/assessed values:** they are not renamed or treated as
  ARV.
- **NO CHANGE — repairs:** this inventory does not alter
  `contact.estimated_repairs`, `opportunity.repair_estimate`, the repair
  estimator, or any repair-estimation rule.
- **NO CHANGE — runtime and GHL:** no application code, shared configuration,
  GHL schema, GHL record, workflow, tag, pipeline stage, or Production state is
  changed.

## B7-03 disposition

**INFERRED from the observed carriers:** no new subject-property carrier and no
new approved-ARV amount carrier are justified for the next Board #7 step. The
genuine gaps are evidence/provenance gaps around a future comp workflow, and
they remain unimplemented until a separately authorized decision defines
their persistence contract.
