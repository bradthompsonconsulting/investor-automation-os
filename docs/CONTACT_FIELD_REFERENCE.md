# IAOS — Contact Field Reference

This file has **two clearly separated parts**. Keep them separate:

- **PART 1 — OBSERVED** is wire facts only. It contains no IAOS decisions. It is **regenerable from the wire** (re-pull the custom-fields endpoint) and **diffable against a fresh pull** — if GHL's field set changes, replace Part 1 wholesale and diff.
- **PART 2 — IAOS DECISIONS** is the living layer. Nothing here is a wire fact; everything here is an IAOS choice, recorded deliberately.

---

## PART 1 — OBSERVED (wire facts only; regenerable & diffable)

**OBSERVED on the wire via `ghl-proxy` under the PROD private-integration token** (`GHL_PRIVATE_API_KEY`, ends …d0f7) — NOT the pit-b2e9 build token.

- **Source call:** `GET /.netlify/functions/ghl-proxy?path=/locations/jmHG4B8RdzwpfqruNf68/customFields` → HTTP 200
- **Location:** `jmHG4B8RdzwpfqruNf68`
- **Date observed:** 2026-07-22
- **Total custom fields:** 96 (all `model: contact`; zero opportunity-scoped)
- **Sort:** by `parentId`, then `position`
- **Regenerate:** re-run the source call and re-sort by (`parentId`, `position`); this table is a pure projection of the response — diff a fresh pull against it to detect any field add/remove/rename/regroup.

| name | id | fieldKey | dataType | position | parentId | standard |
|---|---|---|---|---|---|---|
| Business Phone | `nuQ6CNjg191xgSUHqQKE` | `contact.business_phone` | PHONE | 50 | `2kmTfkj3wxLc0v52AxHS` | false |
| Business Website | `OpINXfJKRJdUHSULBXiU` | `contact.business_website` | TEXT | 100 | `2kmTfkj3wxLc0v52AxHS` | false |
| Wholesaling Market | `cuNHdba3jJ4Ftrn3e3go` | `contact.wholesaling_market` | TEXT | 150 | `2kmTfkj3wxLc0v52AxHS` | false |
| SMS Sender Name | `ofZIPGHM8lyd7nmuSRw8` | `contact.sms_sender_name` | TEXT | 200 | `2kmTfkj3wxLc0v52AxHS` | false |
| Sending Domain | `f7segVRuW8csg0jAenho` | `contact.sending_domain` | TEXT | 350 | `2kmTfkj3wxLc0v52AxHS` | false |
| Booking Calendar Link | `ZqeAqwa0H32dx4cyhiv5` | `contact.booking_calendar_link` | TEXT | 450 | `2kmTfkj3wxLc0v52AxHS` | false |
| Onboarding Notes | `8uMESzer8JOcpqO4OrTr` | `contact.onboarding_notes` | LARGE_TEXT | 550 | `2kmTfkj3wxLc0v52AxHS` | false |
| Has Sending Domain | `QyJIHLFd7zDZgOU0ctU8` | `contact.has_sending_domain` | SINGLE_OPTIONS | 600 | `2kmTfkj3wxLc0v52AxHS` | false |
| Has Booking Calendar | `YBibHRnsFj3guZrSztS7` | `contact.has_booking_calendar` | SINGLE_OPTIONS | 650 | `2kmTfkj3wxLc0v52AxHS` | false |
| Has Existing Leads | `gAL6XdVAxQIld4AZYvrF` | `contact.has_existing_leads` | SINGLE_OPTIONS | 700 | `2kmTfkj3wxLc0v52AxHS` | false |
| Existing GHL Account | `ebGJCMbSeJmok61mw7X7` | `contact.existing_ghl_account` | SINGLE_OPTIONS | 750 | `2kmTfkj3wxLc0v52AxHS` | false |
| Phone Type | `1cTefPDpZRypKYHtgZrq` | `contact.phone_type` | TEXT | 350 | `8NV0bLrpGEi4bRflnasN` | false |
| Upload Your Lead CSV (if applicable) | `K2iMbgOSOqsBcOzcg7R0` | `contact.upload_your_lead_csv_if_applicable` | FILE_UPLOAD | 50 | `8WVFNtuUuYZ4aEqrUWMb` | false |
| Offer Price | `v2VO2wUwTYRojmU7VXyZ` | `contact.offer_price` | NUMERICAL | 50 | `YslJ5oke73JrBOgaq0np` | false |
| Offer MAO | `aAMFPmgxGZT422uGAQOx` | `contact.offer_mao` | NUMERICAL | 100 | `YslJ5oke73JrBOgaq0np` | false |
| Offer Wholesale Fee | `qYzkp66x87rG7Pbs36GP` | `contact.offer_wholesale_fee` | NUMERICAL | 150 | `YslJ5oke73JrBOgaq0np` | false |
| Offer Repair Total | `2EpRGXb8rj4RtHfFhYbB` | `contact.offer_repair_total` | NUMERICAL | 200 | `YslJ5oke73JrBOgaq0np` | false |
| Offer Margin | `ec06A3RId4Isorc97jeQ` | `contact.offer_margin` | NUMERICAL | 250 | `YslJ5oke73JrBOgaq0np` | false |
| Offer ARV | `Z88Y6IqCK1i7hObZcrQM` | `contact.offer_arv` | NUMERICAL | 300 | `YslJ5oke73JrBOgaq0np` | false |
| Offer Date | `SJ6x7OqUxTKg1ri8ltb7` | `contact.offer_date` | DATE | 350 | `YslJ5oke73JrBOgaq0np` | false |
| Callback Datetime | `JeQWtwpwUbvPA50UfuPU` | `contact.callback_datetime` | DATE | 400 | `kmPmjCjI4noq8KISyq2e` | false |
| Last Call Attempt | `lGoNXM9Wrte4m7ShwQPT` | `contact.last_call_attempt` | DATE | 450 | `kmPmjCjI4noq8KISyq2e` | false |
| last_call_attempt_precise | `2vz1igGMxF3wv7HaWm97` | `contact.last_call_attempt_precise` | TEXT | 500 | `kmPmjCjI4noq8KISyq2e` | false |
| Property Address | `tG4gGFI8JB2VjWeuqYMx` | `contact.property_address` | TEXT | 50 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Asking Price | `60UCjsYT1Ak3Kyy5ZCL8` | `contact.asking_price` | MONETORY | 100 | `qYS1wakeOTmfgjyeSJ8M` | false |
| ARV | `wMBTGWMs97yysQFx7Vad` | `contact.arv` | MONETORY | 150 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Estimated Repairs | `OQnud97MfdxMcTgMVTgf` | `contact.estimated_repairs` | MONETORY | 200 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Motivation Level | `zGuC7cIc0jPe81ZzmsaP` | `contact.motivation_level` | MULTIPLE_OPTIONS | 250 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Timeline to Sell | `LM4bs21UP3i6OJpUirQQ` | `contact.timeline_to_sell` | MULTIPLE_OPTIONS | 300 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Lead Source | `75JS5wGqhBuSUx7frJok` | `contact.lead_source` | MULTIPLE_OPTIONS | 350 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Occupancy Status | `op57wOVFSMRBFbHmD6ej` | `contact.occupancy_status` | MULTIPLE_OPTIONS | 400 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Follow Up Date | `ldPIeL9SJAyC6PH6clUD` | `contact.follow_up_date` | DATE | 450 | `qYS1wakeOTmfgjyeSJ8M` | false |
| MAO Viability Flag | `o87cyzuCyScbY72VrOmq` | `contact.mao_viability_flag` | SINGLE_OPTIONS | 500 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Hold Months | `Ju1U6ROdDNnCFlsn4eeS` | `contact.hold_months` | NUMERICAL | 550 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Carrying Cost | `FhcyP63sSAtWInl4Q4iI` | `contact.carrying_cost` | MONETORY | 600 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Loan Amount | `3ZlSKldh0jR2MWhjOmHe` | `contact.loan_amount` | MONETORY | 650 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Interest Rate | `i1mVFCwHIySFFzR1hVfQ` | `contact.interest_rate` | FLOAT | 700 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Repair Line Items | `IwVPbXc9dKUzWGpe4NPx` | `contact.repair_line_items` | LARGE_TEXT | 750 | `qYS1wakeOTmfgjyeSJ8M` | false |
| County | `kRon68UXcYdwf7qhiN41` | `contact.county` | TEXT | 800 | `qYS1wakeOTmfgjyeSJ8M` | false |
| APN | `q9zsc4u0VphwgHhuo0q9` | `contact.apn` | TEXT | 850 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 1 DNC | `Z6MNxVFyDYcWvHlMs1DQ` | `contact.phone_1_dnc` | TEXT | 900 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 2 | `A4k5ttImNQzwNiuGtsXn` | `contact.phone_2` | TEXT | 950 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 2 DNC | `a96a1YMjW8nyECsBV2Bv` | `contact.phone_2_dnc` | TEXT | 1000 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 3 | `Dvb6splg6vnENls89Tk7` | `contact.phone_3` | TEXT | 1050 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 3 DNC | `BEfYkha0gHwRYNViEqGU` | `contact.phone_3_dnc` | TEXT | 1100 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 4 | `ywf5AV5DoDzoTSg0IGCE` | `contact.phone_4` | TEXT | 1150 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 4 DNC | `fk9osvLxgFNDA2IaCobL` | `contact.phone_4_dnc` | TEXT | 1200 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 5 | `nHY69vgjWrboisxl4Eu7` | `contact.phone_5` | TEXT | 1250 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Phone 5 DNC | `MItHyeOcp4HpGja2fpoB` | `contact.phone_5_dnc` | TEXT | 1300 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Email 2 | `GtnG0KZ6a387l9c2O4SR` | `contact.email_2` | TEXT | 1350 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Email 3 | `7nAzvubCqPu2cMnb6208` | `contact.email_3` | TEXT | 1400 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Email 4 | `4xWRmf9my1rNy63k5leF` | `contact.email_4` | TEXT | 1450 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Owner Occupied | `TqyNsDVXejt9uwDoQYJb` | `contact.owner_occupied` | TEXT | 1500 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Owner 2 First Name | `IsOkUKWeHTMx1elb9GDk` | `contact.owner_2_first_name` | TEXT | 1550 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Owner 2 Last Name | `5TpsB4Ttiou4z6ae18Pu` | `contact.owner_2_last_name` | TEXT | 1600 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Litigator | `VY4GnE1RYjRwZnN0M72j` | `contact.litigator` | TEXT | 1650 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing Care of Name | `IieItbzIlY0yGzxry4Xd` | `contact.mailing_care_of_name` | TEXT | 1700 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing Address | `EUxfdM3Szo6W3nPUFGty` | `contact.mailing_address` | TEXT | 1750 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing City | `RsDLn9BklezGFROL5e72` | `contact.mailing_city` | TEXT | 1800 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing State | `C1CSbz13qufMy5IBeHe1` | `contact.mailing_state` | TEXT | 1850 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing Zip | `FbBIzADc5UHhDFTkfsWV` | `contact.mailing_zip` | TEXT | 1900 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Mailing County | `ltlt1wVlfaX6nnen5Uis` | `contact.mailing_county` | TEXT | 1950 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Do Not Mail | `BDu234KJVQAP5MiXTQx3` | `contact.do_not_mail` | TEXT | 2000 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Property Status | `vQsnHuf4RwwDFVR6o4vs` | `contact.property_status` | TEXT | 2050 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Property Notes | `k7O0TYVMpqCpnMHRLPol` | `contact.property_notes` | TEXT | 2100 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Property Type | `ba4WeG05Y9H4DZNIqtbr` | `contact.property_type` | TEXT | 2150 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Bedrooms | `NgPGkwiRYKJo2pJUA0fD` | `contact.bedrooms` | NUMERICAL | 2200 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Total Bathrooms | `Eq0QNB2jynlQQKisRrbg` | `contact.total_bathrooms` | NUMERICAL | 2250 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Building Sqft | `NBESmVYKID36qE4z6CIy` | `contact.building_sqft` | NUMERICAL | 2300 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Lot Size Sqft | `pSZd41d0elvtCBIAOGOX` | `contact.lot_size_sqft` | NUMERICAL | 2350 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Effective Year Built | `LAmqLtHfmVoHz8bn3Smt` | `contact.effective_year_built` | NUMERICAL | 2400 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Total Assessed Value | `nePkRIWaCRDPlizizjO8` | `contact.total_assessed_value` | NUMERICAL | 2450 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Last Sale Date | `Ba794nce87tnKjz22L2U` | `contact.last_sale_date` | DATE | 2500 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Last Sale Amount | `IoDiaRolzX85CxGtitBR` | `contact.last_sale_amount` | NUMERICAL | 2550 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Total Open Loans | `2IwKH45tzP1fCY9ugtjc` | `contact.total_open_loans` | NUMERICAL | 2600 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Est. Remaining Loan Balance | `QW1gnJvySbBOQEKeLzhm` | `contact.est_remaining_loan_balance` | NUMERICAL | 2650 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Est. Value | `qiSOMt8S6TVtg7l5Ak32` | `contact.est_value` | NUMERICAL | 2700 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Est. Loan-to-Value | `fZ9u5cbKLCB4XKWcBHgr` | `contact.est_ltv` | NUMERICAL | 2750 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Est. Equity | `jRukT5GvU6zOHqozD6pP` | `contact.est_equity` | NUMERICAL | 2800 | `qYS1wakeOTmfgjyeSJ8M` | false |
| MLS Status | `QUiXGxWZ3coYgp2z6uPk` | `contact.mls_status` | TEXT | 3150 | `qYS1wakeOTmfgjyeSJ8M` | false |
| MLS Date | `Cz6aKd0UbphPhkSLqhPv` | `contact.mls_date` | DATE | 3200 | `qYS1wakeOTmfgjyeSJ8M` | false |
| MLS Amount | `5V5OZja1wCzhuSJQFMC7` | `contact.mls_amount` | NUMERICAL | 3250 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Lien Amount | `y2SFdePy7WZqzJhliwR7` | `contact.lien_amount` | NUMERICAL | 3300 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Marketing Lists | `0GlqkqOlXuARL12qVWss` | `contact.marketing_lists` | TEXT | 3350 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Date Added to List | `RrBo7h7WLMDjKfkGtw9m` | `contact.date_added_to_list` | DATE | 3400 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Motivation Score | `8vH9yq10xeYVVMHXbS0C` | `contact.motivation_score` | NUMERICAL | 3450 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Foreclosure Factor | `ift3gXXi3SlEOIFBKiSE` | `contact.foreclosure_factor` | TEXT | 3500 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Total Condition | `TzqqngntzYeC1kSQBZVi` | `contact.total_condition` | TEXT | 3550 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Interior Condition | `DQ924ixAQQslu0v7va3u` | `contact.interior_condition` | TEXT | 3600 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Bathroom Condition | `1qx82ZCe7gDnscCDV6qz` | `contact.bathroom_condition` | TEXT | 3650 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Kitchen Condition | `yGnColCshVmynckoZv7o` | `contact.kitchen_condition` | TEXT | 3700 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Exterior Condition | `21mJCmUYXjhJPCUA3uBr` | `contact.exterior_condition` | TEXT | 3750 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Deal Score | `cfkm0kb9CLvjZgyrcIFz` | `contact.deal_score` | NUMERICAL | 3800 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Combined Score | `9SVnuzznYsZOQQazpxld` | `contact.combined_score` | NUMERICAL | 3850 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Data Completeness Score | `r9sD1rlTIqhOx9Mhvftt` | `contact.data_completeness_score` | NUMERICAL | 3900 | `qYS1wakeOTmfgjyeSJ8M` | false |
| Callback Datetime Precise | `7qRUkZQK8bi2HNo7zDHd` | `contact.callback_datetime_precise` | TEXT | 3950 | `qYS1wakeOTmfgjyeSJ8M` | false |

---

## PART 2 — IAOS DECISIONS (living)

Nothing here is a wire fact. Every entry is a deliberate IAOS choice. This part is intentionally near-empty: **no per-field inert-proof has run**, so no field is characterized beyond what is recorded below.

- **Folder `YslJ5oke73JrBOgaq0np` (the 7 `offer_` fields) is the `CONTACTS_OPPORTUNITIES_SPEC.md` §4.1 HARD NO set.** Its members (from Part 1): Offer Price, Offer MAO, Offer Wholesale Fee, Offer Repair Total, Offer Margin, Offer ARV, Offer Date.
