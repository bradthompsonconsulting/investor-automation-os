export type IaosEnv = "production" | "test";

export interface GhlConfig {
  locationId: string;
  fields: {
    lastCallAttempt: string;
    lastCallAttemptPrecise: string;
    callbackDatetime: string;
    callbackDatetimePrecise: string;
    propertyNotes: string;
    arv: string;
    propertyAddress: string;
    motivationScore: string;
    dealScore: string;
    combinedScore: string;
    dataCompletenessScore: string;
    phoneStatus: string;
    estimatedRepairs: string;
    askingPrice: string;
    /* Board 4 carriers, created S0 2026-08-28. Contact custom fields in the
       Additional Info folder, written by the native disposition control.
         callDisposition  SINGLE_OPTIONS, seven values
         callRouting      SINGLE_OPTIONS, two values
         dispositionAt    TEXT — an ISO instant. TEXT and not DATE because GHL
                          DATE truncates time-of-day, and this carries the
                          moment a call outcome was recorded. */
    callDisposition: string;
    callRouting: string;
    dispositionAt: string;
    /* Board #5 S3. contact.occupancy_status, MULTIPLE_OPTIONS, three options:
       Owner Occupied / Tenant Occupied / Vacant.
       ⚠ RULED SINGLE-SELECT, AND THE RULING BINDS THIS FIELD ONLY. It is not a
       property of MULTIPLE_OPTIONS. motivation_level may genuinely be
       multi-valued and gets its own ruling; nothing here may be generalised to
       it. Cardinality is a declared property of the field (PB-D9), never
       inferred from dataType. */
    occupancyStatus: string;
  };
  folders: {
    offer: string;
    additionalInfo: string;
  };
  /**
   * Location-scoped Custom Values: investor policy per PB-D56 §IV, plus
   * operational pointers.
   */
  customValues: {
    sellingCostPct: string;
    closingCost: string;
    monthlyCarry: string;
    holdMonths: string;
    buyerProfitPct: string;
    financingEnabled: string;
    financingLtv: string;
    financingRate: string;
    financingPoints: string;
    standardMinimum: string;
    profitSharePct: string;
    mailerDigestRecipient: string;
  };
  /** Deal-level Opportunity carriers. PB-D56 section VI. */
  opportunityFields: {
    endBuyerMaxPrice: string;
    assignmentMode: string;
    sellerMAO: string;
  };
  /**
   * Existing Opportunity deal inputs, read by PB-D55 seed-then-supersede.
   * Distinct from opportunityFields, which holds underwriting outputs and
   * mode. These are facts about the deal; those are state IAOS produces.
   *
   * `currentOffer` — INV-70 / B9-07A Phase 2 approved ruling (Family 5).
   * ONE Opportunity-owned carrier replacing the fourteen-field mirrored
   * `offer_*` architecture. Before Agreement Reached it holds the latest
   * negotiated offer; at Agreement Reached it freezes at the accepted
   * price (`current-offer-carrier.ts`'s `currentOfferWriteGate` is the
   * pure freeze logic; `ghl.opportunities.setCurrentOffer` is the writer).
   * Created live in TEST 2026-09-11 (`opportunity.current_offer`, id
   * `7pmvwi6vlu74f5rLOp9M`, NUMERICAL, Opportunity Details folder),
   * inert-proofed the same session. An EARLIER attempt that same session
   * was refused (`HTTP 401 "The token is not authorized for this
   * scope"` — Custom Fields write/create scope was not yet granted to
   * the Test Private Integration token); once that scope was added, the
   * identical script created the field on the first retry. PRODUCTION
   * still carries `CURRENT_OFFER_NOT_PROVISIONED` below — provisioning it
   * there was never in this phase's scope (GHL mutations are Test-only
   * this phase) and remains a separate, later decision.
   */
  opportunityFacts: {
    arv: string;
    repairs: string;
    askingPrice: string;
    currentOffer: string;
  };
  /**
   * INV-67 / B9-12 contract-population repair, extended by the INV-67
   * checkbox-marker / broker-model repair. One narrowly-scoped Opportunity
   * custom field per remaining TREC 20-19 fact -- the exact key set
   * `app/src/lib/contract-ghl-projection-model.ts`'s
   * `CONTRACT_PROJECTION_FIELD_KEYS` declares (110 live keys: 29 retained
   * single-TEXT keys + 48 `"X"`/`""` checkbox markers + 11 restructured
   * contract-text keys + 22 page-11 broker-text keys; kept in sync with
   * that module by hand, guarded by `scripts/test-contract-ghl-projection.cjs`'s
   * drift check). Deliberately EXCLUDES: the four proven-invariant facts
   * (buyer capacity, Texas-license status, the fixed $0 financing sum, the
   * fixed not-applicable financing addenda -- no field, no GHL mutation),
   * the two facts that reuse the existing `opportunityFacts.currentOffer`
   * carrier instead of a new field (sales-price cash portion / total --
   * never duplicated), and 19 keys RETIRED by the checkbox-marker repair
   * (their GHL Test fields still exist, physically untouched, but are no
   * longer written -- see `CONTRACT_PROJECTION_RETIRED_KEYS`).
   * `contractDraftRequest` is the separate one-shot dropdown control
   * (`Idle` / `Requested`) -- see `app/src/lib/contract-draft-request-model.ts`.
   */
  contractProjectionFields: Record<string, string>;
  contractDraftRequest: string;
  /** Pipelines. PB-D51 scope extension, Gate 4B-2. */
  pipelines: {
    sellerLeads: string;
  };
  /**
   * Seller Leads Pipeline stages. Ids only; names and positions are display
   * metadata and live at the call site in ghl-opportunities.ts. Previously
   * excluded from PB-D51 by deliberate scope decision — that exclusion is
   * reversed in Gate 4B-2, because a stage id is exactly as environment-bound
   * as a field id.
   */
  stages: {
    newLeadSeller: string;
    contactInitiated: string;
    sellerCallBooked: string;
    noShow: string;
    sellerCallCompleted: string;
    sellerFollowUp: string;
    sellerOfferSent: string;
    sellerClosedWon: string;
    longTermNurture: string;
    lostNotInterested: string;
  };
  /**
   * B9-08 / INV-63. SERVER-SIDE ONLY, with ONE deliberate exception
   * (`populationVerification`, see the RUNTIME_GROUPS doc comment below)
   * -- every other key here is never added to RUNTIME_GROUPS /
   * RuntimeConfig, and never sent to the browser. `ghl-proxy.ts`
   * reads this and UNCONDITIONALLY OVERWRITES the `contactId` field of any
   * `POST /proposals/templates/send` request body with it, ignoring
   * whatever the browser supplied -- the browser is never trusted to name
   * the recipient of an actual e-sign send, per
   * `docs/BOARD9_CONTRACT_INVENTORY_V1.md`'s own proposed recipient-
   * allowlist safeguard for this exact endpoint. `approvedTestContactId`
   * is the ONE pre-approved GHL Test contact ("IAOS Underwriting Test",
   * `NAGtUZ9aOE5C1GatJzpT`) Brad's own live Test transaction already used
   * (that document, 2026-09-09). PRODUCTION's value is a deliberately
   * fake, obviously-invalid sentinel -- non-empty (so `getConfig`'s own
   * completeness check still passes) but never a real GHL id, so this
   * capability is structurally inert if this selector is ever
   * (mis)configured to "production": the outbound call would carry an
   * invalid contactId and GHL itself would reject it.
   *
   * `senderUserId` -- the documented `POST /proposals/templates/send`
   * request body requires `userId` (the GHL user the send is attributed
   * to) as a REQUIRED field, verified directly from that endpoint's own
   * reference page. TEST's value is Brad's own verified GHL Test sender
   * user id ("IAOS Test Sender") -- NOT invented or guessed.
   *
   * `templateId` / `expectedTemplateName` -- the GHL Documents & Contracts
   * "Send Template" endpoint is resolved by ID, never by a live name
   * search: `ghl-proxy.ts`'s GATE 2 UNCONDITIONALLY OVERWRITES the request
   * body's `templateId` with this value too, exactly like `contactId`/
   * `userId` -- a mutable GHL display name is never trusted as the SEND
   * target, only as a pre-flight drift check the client performs against
   * `expectedTemplateName` before ever offering the Send button (see
   * `ContractWorkspace.tsx`). TEST's values are Brad's own verified GHL
   * Test template identity ("TREC NO 20-19 RESALE V1",
   * `6aa417de09c51fa0927e77cd`).
   *
   * `populationVerification` -- Brad has confirmed the uploaded TREC PDF
   * backing this template carries NO overlaid population, initial, date,
   * checkbox, or signature fields today. GHL's public Documents &
   * Contracts API (List/Send Templates, List/Send Documents -- the
   * complete public surface, verified against GHL's own reference pages)
   * exposes NO operation to create a template, upload a PDF, or place/map
   * fields; that configuration can only be done by a human inside GHL's
   * own template editor, and this codebase has no way to verify it
   * happened other than a human attestation recorded here. While this
   * equals `POPULATION_NOT_VERIFIED`, `ghl-proxy.ts`'s GATE 2 refuses
   * every `/proposals/templates/send` request, unconditionally, for BOTH
   * environments -- there is no code path that can make sending safe
   * while the template is actually blank, and no sentinel value this
   * build is authorized to treat as satisfying that. Flipping this
   * requires Brad to (1) complete the field placement in GHL, (2) accept
   * that IAOS's own send-time readback check (`contract-send-model.ts`'s
   * `classifyDocumentReadback`) is the only available verification, since
   * the API has no pre-send introspection of a template's own field
   * layout, and (3) record a new value here himself, as its own reviewed
   * commit -- never toggled at runtime.
   */
  documentsContracts: {
    approvedTestContactId: string;
    senderUserId: string;
    templateId: string;
    expectedTemplateName: string;
    populationVerification: string;
  };
}

/** GATE 2 / B9-08 -- the literal placeholder value for an unconfigured `senderUserId`. Exported so ghl-proxy.ts can refuse a send while it is in effect, without hardcoding the sentinel a second time. */
export const SENDER_USER_ID_NOT_CONFIGURED = "GHL_SENDER_USER_ID_NOT_YET_PROVIDED" as const;

/** GATE 2 / B9-08 -- the ONE value that permits a real send. Anything else (including an empty string, which `getConfig`'s completeness check already refuses) fails closed. There is no partial/staged value; population is either verified or it is not. */
export const POPULATION_VERIFIED = "POPULATION_VERIFIED" as const;
/** The value both PRODUCTION and TEST carry until a human records `POPULATION_VERIFIED` above, as its own reviewed commit. */
export const POPULATION_NOT_VERIFIED = "POPULATION_NOT_VERIFIED" as const;

/**
 * INV-70 / B9-07A Phase 2 — the literal placeholder value for the
 * not-yet-provisioned Current Offer field. Carried by `PRODUCTION` only
 * as of this revision (`TEST` now has a real id — see the
 * `opportunityFacts` interface doc comment): provisioning a new
 * Opportunity field in Production was never in this phase's scope (GHL
 * mutations are Test-only this phase) and remains a separate, later
 * decision. `ghl.opportunities.setCurrentOffer` refuses immediately,
 * before any network call, whenever the configured id equals this
 * sentinel -- the same fail-closed pattern `SENDER_USER_ID_NOT_CONFIGURED`
 * already established for B9-08's Documents & Contracts send gate.
 * Exported so a real Production id, once created, replaces this in
 * exactly one place -- never toggled, always a reviewed commit.
 */
export const CURRENT_OFFER_NOT_PROVISIONED = "CURRENT_OFFER_FIELD_NOT_YET_PROVISIONED" as const;

/**
 * INV-67 / B9-12 -- the literal placeholder value for a not-yet-provisioned
 * contract-projection field or the Contract Draft Request control. Carried
 * by `PRODUCTION` for every key in `contractProjectionFields` plus
 * `contractDraftRequest`: this repair is Test-only GHL mutation, exactly
 * like `CURRENT_OFFER_NOT_PROVISIONED` before it. `ghl.ts`'s writers refuse
 * immediately, before any network call, whenever a configured id equals
 * this sentinel -- the same fail-closed pattern already established.
 */
export const CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED = "CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED" as const;

/**
 * INV-67 checkbox-marker / broker-model repair -- the exact 110 live keys,
 * duplicated by hand from `app/src/lib/contract-ghl-projection-model.ts`'s
 * `CONTRACT_PROJECTION_FIELD_KEYS` (that module cannot be imported here --
 * `shared/` stays free of an `src/lib` dependency, the same layering every
 * other key in this file already respects). Kept in sync by
 * `scripts/test-contract-ghl-projection.cjs`'s drift check, which fails
 * loud if the two lists ever diverge.
 *
 * 110 = 29 retained (UNCHANGED single-TEXT keys from the original 48) +
 * 48 `"X"`/`""` checkbox markers + 11 restructured contract-text keys +
 * 22 page-11 broker-text keys (11 per side). 19 of the original 48 keys
 * are RETIRED from the live projection (14 checkbox-shaped + 1 checkbox-
 * adjacent, replaced by markers/restructured text; 1
 * (`representation.representation`) replaced by the 22-key broker-text
 * decomposition; 3 retired from the TREC 20-19 projection while retained
 * canonically or as IAOS audit metadata -- `closingPossession.
 * possessionDetails` stays a real, readable fact scoped to a future
 * addendum, `noticeContact.buyerSignerName`/`buyerSignerRole` stay IAOS
 * audit/internal metadata, Board #10 scope). See
 * `contract-ghl-projection-model.ts`'s `CONTRACT_PROJECTION_RETIRED_KEYS`
 * for the precise per-key disposition. Batches 1 (48 markers), 2 (11
 * restructured contract-text keys), and 3 (22 page-11 broker-text keys)
 * were all provisioned live in GHL Test, 2026-09-14/15 -- see the
 * `contractProjectionFields` doc comment below for the exact
 * apply/verification record. All 110 live projection keys now carry a
 * real `TEST` id -- zero sentinels remain in `TEST`. No GHL field of any
 * kind was created, modified, or deleted for `PRODUCTION` -- it carries
 * the sentinel for all 110 keys, unconditionally.
 */
const CONTRACT_PROJECTION_FIELD_KEYS = [
  // -- 29 retained, UNCHANGED single-TEXT keys --
  "identity.propertyStreetAddress",
  "parties.buyerEntityName",
  "parties.sellerSigners",
  "propertyLegalDescription.lot",
  "propertyLegalDescription.block",
  "propertyLegalDescription.addition",
  "propertyLegalDescription.county",
  "propertyLegalDescription.exclusions",
  "earnestMoneyOption.escrowAgentName",
  "earnestMoneyOption.escrowAgentAddress",
  "earnestMoneyOption.earnestMoney",
  "earnestMoneyOption.optionFee",
  "earnestMoneyOption.optionPeriodDays",
  "earnestMoneyOption.additionalEarnestMoney",
  "titleSurvey.titleCompanyName",
  "titleSurvey.objectionsText",
  "titleSurvey.objectionsDays",
  "propertyCondition.serviceContractCap",
  "closingPossession.closingDate",
  "settlementExpense.sellerCreditCap",
  "addendaApplicability.districtNotices",
  "noticeContact.buyerNoticeAddress",
  "noticeContact.buyerNoticePhone",
  "noticeContact.buyerNoticeEmail",
  "noticeContact.sellerNoticeAddress",
  "noticeContact.sellerNoticePhone",
  "noticeContact.sellerNoticeEmail",
  "attorneyManualFields.specialProvisions",
  "attorneyManualFields.otherAddendaText",
  // -- 48 checkbox markers ("X" | "") --
  "lease_residential_mark",
  "lease_fixture_mark",
  "lease_nrl_applies_mark",
  "lease_nrl_delivered_mark",
  "lease_nrl_not_delivered_mark",
  "title_expense_seller_mark",
  "title_expense_buyer_mark",
  "shortage_not_amended_mark",
  "shortage_amended_mark",
  "shortage_amended_buyer_mark",
  "shortage_amended_seller_mark",
  "survey_opt1_mark",
  "survey_opt2_mark",
  "survey_opt3_mark",
  "survey_opt1_expense_buyer_mark",
  "survey_opt1_expense_seller_mark",
  "poa_is_subject_mark",
  "poa_is_not_subject_mark",
  "sdn_received_mark",
  "sdn_not_received_mark",
  "sdn_not_required_mark",
  "as_is_plain_mark",
  "as_is_with_repairs_mark",
  "water_received_mark",
  "water_not_received_mark",
  "water_exempt_mark",
  "possession_upon_closing_mark",
  "possession_leaseback_mark",
  "spbb_applies_mark",
  "spbb_dollar_mark",
  "spbb_percent_mark",
  "bpsb_applies_mark",
  "bpsb_dollar_mark",
  "bpsb_percent_mark",
  "addenda_sale_of_other_property_mark",
  "addenda_lender_appraisal_termination_mark",
  "addenda_section_1031_exchange_mark",
  "addenda_short_sale_mark",
  "addenda_hydrostatic_testing_mark",
  "addenda_environmental_assessment_mark",
  "addenda_lead_based_paint_mark",
  "addenda_propane_gas_service_area_mark",
  "addenda_seaward_of_gulf_intracoastal_mark",
  "addenda_coastal_area_property_mark",
  "addenda_poa_membership_mark",
  "addenda_non_realty_items_mark",
  "addenda_back_up_contract_mark",
  "addenda_mineral_reservation_mark",
  // -- 11 restructured contract-text keys --
  "lease_nrl_terminate_within_days_text",
  "survey_opt1_seller_furnish_days_text",
  "survey_opt2_buyer_obtain_days_text",
  "survey_opt3_seller_furnish_days_text",
  "sdn_deliver_within_days_text",
  "water_deliver_within_days_text",
  "water_source_text",
  "spbb_dollar_amount_text",
  "spbb_percent_amount_text",
  "bpsb_dollar_amount_text",
  "bpsb_percent_amount_text",
  // -- 22 page-11 broker-text keys (11 per side) --
  "seller_broker_firm_name_text",
  "seller_broker_address_text",
  "seller_broker_firm_license_no_text",
  "seller_broker_associate_name_text",
  "seller_broker_team_name_text",
  "seller_broker_associate_email_text",
  "seller_broker_associate_phone_text",
  "seller_broker_associate_license_no_text",
  "seller_broker_supervisor_name_text",
  "seller_broker_supervisor_phone_text",
  "seller_broker_supervisor_license_no_text",
  "buyer_broker_firm_name_text",
  "buyer_broker_address_text",
  "buyer_broker_firm_license_no_text",
  "buyer_broker_associate_name_text",
  "buyer_broker_team_name_text",
  "buyer_broker_associate_email_text",
  "buyer_broker_associate_phone_text",
  "buyer_broker_associate_license_no_text",
  "buyer_broker_supervisor_name_text",
  "buyer_broker_supervisor_phone_text",
  "buyer_broker_supervisor_license_no_text",
] as const;

/** Builds a sentinel-filled `contractProjectionFields` map -- one call site, never 48 hand-typed literals. */
function sentinelContractProjectionFields(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONTRACT_PROJECTION_FIELD_KEYS) out[key] = CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED;
  return out;
}

const PRODUCTION: GhlConfig = {
  locationId: "jmHG4B8RdzwpfqruNf68",
  fields: {
    lastCallAttempt:         "lGoNXM9Wrte4m7ShwQPT",
    lastCallAttemptPrecise:  "2vz1igGMxF3wv7HaWm97",
    callbackDatetime:        "JeQWtwpwUbvPA50UfuPU",
    callbackDatetimePrecise: "7qRUkZQK8bi2HNo7zDHd",
    propertyNotes:           "k7O0TYVMpqCpnMHRLPol",
    arv:                     "wMBTGWMs97yysQFx7Vad",
    propertyAddress:         "tG4gGFI8JB2VjWeuqYMx",
    // offerPrice REMOVED, INV-70 / B9-07A Phase 3 correction -- its one
    // reader (netlify/functions/lib/contact-parse.ts, feeding Dashboard's
    // "Offers to review" tile) was retired in favor of
    // opportunityFacts.currentOffer. The GHL field itself
    // (contact.offer_price, v2VO2wUwTYRojmU7VXyZ) is untouched -- only this
    // now-dead config pointer is gone. See the canonicalization doc's
    // Phase 3 section.
    motivationScore:         "8vH9yq10xeYVVMHXbS0C",
    dealScore:               "cfkm0kb9CLvjZgyrcIFz",
    combinedScore:           "9SVnuzznYsZOQQazpxld",
    dataCompletenessScore:   "r9sD1rlTIqhOx9Mhvftt",
    phoneStatus:             "6WJG2a40490bW0c62YFT",
    estimatedRepairs:        "OQnud97MfdxMcTgMVTgf",
    askingPrice:             "60UCjsYT1Ak3Kyy5ZCL8",
    // Board 4 S0, read back from GHL 2026-08-28 — not transcribed from the
    // creation sheet. fieldKeys contact.iaos_call_disposition /
    // .iaos_call_routing / .iaos_disposition_at, all parented to Additional Info.
    callDisposition:         "vvgwGb0X4WKOHDGIuoAS",
    callRouting:             "Zjy57J2LgsAIOA5iurz3",
    dispositionAt:           "y92B4WX7RVCFTm3An3WN",
    // Board #5 S3, READ BACK FROM GHL 2026-08-28 via
    // GET /locations/{id}/customFields -- not transcribed from FIELD_REGISTER,
    // which is stale (96 fields recorded, 101 live). fieldKey
    // contact.occupancy_status, parented to Additional Info, options observed
    // ["Owner Occupied","Tenant Occupied","Vacant"].
    occupancyStatus:         "op57wOVFSMRBFbHmD6ej",
  },
  folders: {
    offer:          "YslJ5oke73JrBOgaq0np",
    additionalInfo: "qYS1wakeOTmfgjyeSJ8M",
  },
  customValues: {
    sellingCostPct:     "huOzq1VKscRVL6O2Wp20",
    closingCost:        "kapXvTS9tNYVRn7L3WBY",
    monthlyCarry:       "GLOwuyga9MW2qA7jfGUC",
    holdMonths:         "ZABxPRW2bCYZVnnRuLop",
    buyerProfitPct:     "Ld3CuvhR9KUxYbfT8keM",
    financingEnabled:   "dq8qdnXR6qxzGy0shUby",
    financingLtv:       "kEoZ1afVMK2LrSrvnWUR",
    financingRate:      "veTIWiG4s4cvYTMuVbUY",
    financingPoints:    "9ONatv0Y9FOfpdDTIkGz",
    standardMinimum:    "MuQih1mjmxVVOQ01Naq1",
    profitSharePct:     "XqzNrXRIXXS3dcvAFz6o",
    mailerDigestRecipient: "IjDam7C5cUR4l7uENWQT",
  },
  opportunityFields: {
    endBuyerMaxPrice:   "zOVIPwzLe41a0SQmwVAJ",
    assignmentMode:     "TpLo0WRc303TXAaBUbBf",
    sellerMAO:          "Atu5XCjpFElY8H64VG4h",
  },
  opportunityFacts: {
    arv:                "cBkygqcHRseZUGCYYeba",
    repairs:            "hId4Yog6u5GP1Iwz1aNx",
    askingPrice:        "YxCDaX7dLhBJL9GLGFpJ",
    // Created live in Production 2026-09-12 via
    // scripts/inv70-create-current-offer-field.cjs --apply (INV-70 / B9-07A
    // Phase 3 correction), once Brad explicitly authorized Production
    // provisioning and this credential's use. fieldKey
    // opportunity.current_offer, NUMERICAL, Opportunity Details folder
    // (FQJ2zGEAIJu0JA9NubCL -- resolved live from
    // opportunity.arv_after_repair_value's own parentId, same as Test).
    // Inert-proofed the same session against the confirmed stale
    // calculator-test opportunity 1AP9BfFPJ2xYZ0RPTm9U -- see
    // docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md.
    currentOffer:       "yZgEdTOvppmmCvv8kx9n",
  },
  // INV-67 / B9-12 -- Production provisioning is out of this repair's
  // authorized scope (Test-only GHL mutation, per Brad's explicit
  // authorization for this issue). Every key fails closed via
  // CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED until a separate, later
  // decision provisions Production -- the same deferral
  // opportunityFacts.currentOffer used above.
  contractProjectionFields: sentinelContractProjectionFields(),
  contractDraftRequest: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,
  pipelines: {
    sellerLeads:         "GpUWK4YlhNqBzm5Hrm58",
  },
  stages: {
    newLeadSeller:       "0f0511af-2e59-49c9-a141-12a7f1c78914",
    contactInitiated:    "c7d1e692-8d9f-4527-a756-724e468800e7",
    sellerCallBooked:    "5b6634e6-098f-453e-b08e-09c78af682a7",
    noShow:              "02992967-3b10-4ae6-ae89-81daf622fc59",
    sellerCallCompleted: "3ac16587-0db8-48ca-9ec0-536e67db9963",
    sellerFollowUp:      "71227a30-2303-4165-aa58-e56860146959",
    sellerOfferSent:     "a0f01076-5019-4abc-b809-7f4b0218dd35",
    sellerClosedWon:     "0c45ee3d-7be7-4651-97a4-6df53f53481b",
    longTermNurture:     "a7436df7-e05a-4bf0-bd29-70f7066ec0bd",
    lostNotInterested:   "f1960b50-8aa2-4a69-ba58-a7a0dc66ce82",
  },
  // B9-08 / INV-63. Deliberately fake and obviously invalid -- see the
  // interface doc comment above. This is NOT a real GHL id and must never
  // become one; Production e-sign sending is out of scope for V1 and this
  // value exists only so getConfig("production") stays completeness-valid.
  documentsContracts: {
    approvedTestContactId: "PRODUCTION_SEND_NOT_AUTHORIZED_NO_CONTACT_CONFIGURED",
    senderUserId: "PRODUCTION_SEND_NOT_AUTHORIZED_NO_USER_CONFIGURED",
    templateId: "PRODUCTION_SEND_NOT_AUTHORIZED_NO_TEMPLATE_CONFIGURED",
    expectedTemplateName: "PRODUCTION_SEND_NOT_AUTHORIZED_NO_TEMPLATE_CONFIGURED",
    populationVerification: POPULATION_NOT_VERIFIED,
  },
};

// TEST identifiers are captured from the GHL Test Environment, never hand-typed.
// Populated in Gate 4C C3b by resolving each config key through the frozen
// binding artifact (scripts/ghl-bindings.json) against that location.
const TEST: GhlConfig = {
  locationId: "SoTgVoaFGHtBdRFvXWQV",
  fields: {
    lastCallAttempt:         "H9enWYyMkrKO4dEZ61dB",
    lastCallAttemptPrecise:  "KPrx8XMf4oPPwj25Agi2",
    callbackDatetime:        "CwjPJ1bRjOcwBZNAaGkU",
    callbackDatetimePrecise: "xmOYN98dSP9q4FNv1p3J",
    propertyNotes:           "SWTp5VaVY6OLLKNxq3wn",
    arv:                     "QkWl09I9yXGz8OIcs5Xd",
    propertyAddress:         "1B6u7F1MipquMxVWnAD9",
    // offerPrice REMOVED -- see PRODUCTION.fields' matching comment above.
    motivationScore:         "kugS259mDJzJyHkK2ble",
    dealScore:               "aCEzgjAIpdx1t87bn0YE",
    combinedScore:           "FYoNN6qK9MbE9x9iloum",
    dataCompletenessScore:   "X5FbotWfk8hTAGboJFrX",
    phoneStatus:             "aLqIaUk3UwvSeu1ijFL8",
    estimatedRepairs:        "SU4n8ylrXnUm8xDi729R",
    askingPrice:             "Oeo3jPhh3ICnU7Cv1iTT",
    // Board 4 S0, read back from GHL 2026-08-28. Same three fieldKeys and the
    // same Additional Info parentage as Production; ids differ per location.
    callDisposition:         "30yWD1NmL12949C7zdfv",
    callRouting:             "W2jz3m0vexRUKTgprgyK",
    dispositionAt:           "aRjrDKXjuY5p5UFvcfyO",
    // Board #5 S3, read back from the TEST location the same way and on the
    // same date. NOT resolvable through scripts/ghl-bindings.json: that frozen
    // artifact predates this key and carries no occupancy binding, so the live
    // read-back is the provenance -- the same route Board #4 S0 used for the
    // three carriers above. Options identical to Production.
    occupancyStatus:         "H3daXFIC1fXl99oG7YX7",
  },
  folders: {
    offer:          "w8jbeT1AwN0YZjA9geAX",
    additionalInfo: "bFcK1ZfHR2nY7sii2qCg",
  },
  customValues: {
    sellingCostPct:     "LJb7qXN0lbyEzUBE6rTf",
    closingCost:        "uSml4RQLMNstTrqeEDtA",
    monthlyCarry:       "rTDzvj2YAceS7UqFeLMh",
    holdMonths:         "igCXTO0FWUbe0PUe3q21",
    buyerProfitPct:     "hMXd0QgNLOPTiC7dCLT7",
    financingEnabled:   "KX5WCOcy9QGzHdfqS8DY",
    financingLtv:       "TrLTErSdYxGJf3CDCaS3",
    financingRate:      "ty9AbbMctkrypw7UOEXp",
    financingPoints:    "HyCJUFphHkpkm6COxvLV",
    standardMinimum:    "uWRZSLe67uy10G8uHqnk",
    profitSharePct:     "Daa4JZsnoReyoKSoxp3P",
    mailerDigestRecipient: "8Sa96hCYLYZFcnV2VEuY",
  },
  opportunityFields: {
    endBuyerMaxPrice:   "EUMpREBOjnHXzpBZHawC",
    assignmentMode:     "SsPgqpu3d3aU424Dsve9",
    sellerMAO:          "ZfOljSm5fLFCFZhfi0ri",
  },
  opportunityFacts: {
    arv:                "ppe2ZTO7DJTMao74xvYI",
    repairs:            "lSWxFUmWksfrViePG4UC",
    askingPrice:        "owIOWnJuIheiwJVdJWQ5",
    // Created live in Test 2026-09-11 via
    // scripts/inv70-create-current-offer-field.cjs --apply, once the
    // Test Private Integration was granted Custom Fields write/create
    // scope. fieldKey opportunity.current_offer, NUMERICAL, folder
    // Opportunity Details (sGP3pbDQFN7fXS62MAgA). Inert-proofed the same
    // session -- see docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md.
    currentOffer:       "7pmvwi6vlu74f5rLOp9M",
  },
  // INV-67 / B9-12 -- the 29 RETAINED fields below were created live in
  // Test via `scripts/inv67-create-contract-projection-fields.cjs --apply`
  // (2026-09), Opportunity Details folder (sGP3pbDQFN7fXS62MAgA, same
  // folder as `opportunityFacts.currentOffer`). No clash on any
  // name/fieldKey; no Test data was populated, no other field was touched.
  //
  // INV-67 checkbox-marker / broker-model repair RETIRES 19 of the
  // original 48 keys (14 checkbox-shaped + 1 checkbox-adjacent, replaced
  // by 48 new marker keys + 11 restructured text keys; 1 replaced by the
  // 22-key broker-text decomposition; 3 retired from the TREC 20-19
  // projection while retained canonically or as IAOS audit metadata --
  // `closingPossession.possessionDetails` stays a real, readable fact
  // scoped to a future addendum; `noticeContact.buyerSignerName`/
  // `buyerSignerRole` stay IAOS audit/internal metadata, Board #10 scope
  // -- see `contract-ghl-projection-model.ts`'s
  // `CONTRACT_PROJECTION_RETIRED_KEYS` for the full list and precise
  // per-key disposition). THEIR GHL TEST FIELDS ARE UNTOUCHED -- still
  // physically present in Test, simply no longer written by this
  // repository.
  //
  // Batch 1 (48 CHECKBOX_MARKER_KEYS) was provisioned live in GHL Test
  // (`scripts/inv67-create-checkbox-marker-fields-batch1.cjs --apply`,
  // 2026-09-14, location SoTgVoaFGHtBdRFvXWQV, canonical parentId
  // sGP3pbDQFN7fXS62MAgA -- Opportunity Details, same folder as
  // `opportunityFacts.currentOffer`) -- 67 -> 115 existing Opportunity
  // fields, all 48 created and independently readback-verified against
  // name/fieldKey/dataType/model/parentId, re-confirmed via a SECOND,
  // fully independent fresh-GET-plus-join verification pass before these
  // 48 real ids were wired in below.
  //
  // Batch 2 (11 CHECKBOX_TEXT_KEYS) was provisioned live in GHL Test the
  // same day (`scripts/inv67-create-checkbox-text-fields-batch2.cjs
  // --apply`, 2026-09-14, same location and canonical parentId) -- 115 ->
  // 126 existing Opportunity fields, all 11 created and independently
  // readback-verified the same way, re-confirmed via a second,
  // independent fresh-GET-plus-join verification pass (that pass also
  // re-verified Batch 1's 48 ids were unaffected, and that no Batch
  // 3-shaped field exists) before these 11 real ids were wired in below.
  //
  // Batch 3 (22 BROKER_TEXT_KEYS) was provisioned live in GHL Test
  // (`scripts/inv67-create-broker-text-fields-batch3.cjs --apply`,
  // 2026-09-15, same location and canonical parentId) -- 126 -> 148
  // existing Opportunity fields, all 22 created and independently
  // readback-verified the same way, re-confirmed via a third, independent
  // fresh-GET-plus-join verification pass (that pass also re-verified all
  // 29 retained + 48 Batch 1 + 11 Batch 2 ids were unaffected) before
  // these 22 real ids were wired in below.
  //
  // The `sentinelContractProjectionFields()` spread below is now fully
  // overridden -- ALL 110 live projection keys carry a real id (29
  // retained + 48 Batch 1 + 11 Batch 2 + 22 Batch 3). Zero sentinels
  // remain in `TEST`.
  contractProjectionFields: {
    ...sentinelContractProjectionFields(),
    // -- 29 retained (unchanged, pre-existing this repair) --
    "identity.propertyStreetAddress": "UjJRDmdeuEpQKA9I2yFr",
    "parties.buyerEntityName": "roFgPXN9bPMeLBxLPhpw",
    "parties.sellerSigners": "ELLuYUYyPqhVMIKMjSAh",
    "propertyLegalDescription.lot": "0N1jKEJBP1LOsBO9WAfE",
    "propertyLegalDescription.block": "v3PvqyE7KqNo9wHuF77k",
    "propertyLegalDescription.addition": "8P8xlcoQvJPiTCtEYmze",
    "propertyLegalDescription.county": "VQdEFCszBn2I1R29v9Ku",
    "propertyLegalDescription.exclusions": "8BkJWlSfgp8WfqcdTE60",
    "earnestMoneyOption.escrowAgentName": "bhxE1ZSOmyYWrOHqm6jf",
    "earnestMoneyOption.escrowAgentAddress": "EvuENItvKDCw8WaCHMd3",
    "earnestMoneyOption.earnestMoney": "HJpetNeLUCy6mIv4hOKO",
    "earnestMoneyOption.optionFee": "Gygwe13y13CZJJvJFk3y",
    "earnestMoneyOption.optionPeriodDays": "02LqDO3fMiKBLBFzheJX",
    "earnestMoneyOption.additionalEarnestMoney": "lx0NWWA8tgilbEY71n3b",
    "titleSurvey.titleCompanyName": "hqovBqMSkSzi7hgyyonq",
    "titleSurvey.objectionsText": "cqOCAubHmuLFbCl9TczS",
    "titleSurvey.objectionsDays": "vAInvdtJ0nYHINzAwGy3",
    "propertyCondition.serviceContractCap": "UiWOxyGDrbWO9cTkJSx9",
    "closingPossession.closingDate": "s7jauYhoSPQd09GjoGOr",
    "settlementExpense.sellerCreditCap": "fUWZ54vsfUyGBlxszHB0",
    "addendaApplicability.districtNotices": "SpRUfNbdSL94QZz7vfrs",
    "noticeContact.buyerNoticeAddress": "OWVLUUS4pyD0JA2bRqBy",
    "noticeContact.buyerNoticePhone": "4ehkRvZbgm4xTFqjugib",
    "noticeContact.buyerNoticeEmail": "glYaD6otYjvlw5avJ5I0",
    "noticeContact.sellerNoticeAddress": "4ZSZTquyk1MTN7wBLqlO",
    "noticeContact.sellerNoticePhone": "G7ovatOKYrMECUchooxr",
    "noticeContact.sellerNoticeEmail": "T9TlfDicQnhiHInISE2N",
    "attorneyManualFields.specialProvisions": "eZImM9FtKYff6CJzAafO",
    "attorneyManualFields.otherAddendaText": "xQ1mLI1l8aHnhOLe07fy",
    // -- Batch 1: 48 checkbox-marker keys, provisioned and readback-
    //    verified live in GHL Test 2026-09-14 --
    "lease_residential_mark": "aScwbIAJRuV3cFiKS09E",
    "lease_fixture_mark": "h60tQTX5V339pL2Kkygs",
    "lease_nrl_applies_mark": "WMXYsnvXYQN9b3CmGXNT",
    "lease_nrl_delivered_mark": "vJz27kh08aSSvBqKaakT",
    "lease_nrl_not_delivered_mark": "LKli45H0Nr3nbZpYwjbp",
    "title_expense_seller_mark": "2Su66drCeruZD3BPWLTE",
    "title_expense_buyer_mark": "ayCF12CoJpuDrp0o2D5T",
    "shortage_not_amended_mark": "8pphVEZBaRLbjiwOSo91",
    "shortage_amended_mark": "OO8u48boOVwvUhTPlSNb",
    "shortage_amended_buyer_mark": "04o5JNDHU8RT1FLBcO4w",
    "shortage_amended_seller_mark": "23SCz6pfBxlzXRLBAe23",
    "survey_opt1_mark": "VF0IBL2Si2LaBFh2feaW",
    "survey_opt2_mark": "XZS6zPtncMRmOE7uC2Kx",
    "survey_opt3_mark": "ZoX7uWlw4D7sNnIHhSXb",
    "survey_opt1_expense_buyer_mark": "uCdzFP5SGvJ4gN7nlupp",
    "survey_opt1_expense_seller_mark": "MszEe7kMJBhsjtSqFciy",
    "poa_is_subject_mark": "Z0UnZIVEI1zGK61NpSKJ",
    "poa_is_not_subject_mark": "IcSITgJPOFRkrLMulqjg",
    "sdn_received_mark": "8C5DbEYVF1YRuelPRZQV",
    "sdn_not_received_mark": "pvKObPCyffKDzx1hwoYt",
    "sdn_not_required_mark": "KgtPnweNDnOuz6BKjM6k",
    "as_is_plain_mark": "khQmW6JpU3kFzJBH7Nlm",
    "as_is_with_repairs_mark": "oIcJ9Xd21ktI7hOOlvCk",
    "water_received_mark": "MLxpIA58JR9Wqr2ltazg",
    "water_not_received_mark": "dJGi6Pq1bU2lK8NVK8AW",
    "water_exempt_mark": "TkG9weH8ruhKP2iLxmco",
    "possession_upon_closing_mark": "Ae1IFhDcZwJYONOgJXR5",
    "possession_leaseback_mark": "yV2k1PAdSpxCg2B9nBOd",
    "spbb_applies_mark": "O7CzOFOa0phJFy3PEExP",
    "spbb_dollar_mark": "8fuIJmOMzmwBkIS7ymMn",
    "spbb_percent_mark": "0mlDez8SVUYQDHXuCEsW",
    "bpsb_applies_mark": "ZQywx7qCjxuvds5iexzT",
    "bpsb_dollar_mark": "u3aE3seViwHuJNBfhOYv",
    "bpsb_percent_mark": "Ty3PKjwT1nwBQL2ZVHVy",
    "addenda_sale_of_other_property_mark": "YFgsEFYuzmEXHhkLef9E",
    "addenda_lender_appraisal_termination_mark": "gEfEATkLQv1yX21005c3",
    "addenda_section_1031_exchange_mark": "K9NWow38jwnjGBgHdq9x",
    "addenda_short_sale_mark": "GSbwMGY31JdPaMpiVUi6",
    "addenda_hydrostatic_testing_mark": "JlSUHhT1NFTa8kkXkqi5",
    "addenda_environmental_assessment_mark": "Btu5r6Iuv31PA8vrZoFv",
    "addenda_lead_based_paint_mark": "0abvgNZlKfsfPzO1jn1x",
    "addenda_propane_gas_service_area_mark": "7Sa2WVq1Y72awT34WVgL",
    "addenda_seaward_of_gulf_intracoastal_mark": "CoqFFXPbIN0QcHPGH75X",
    "addenda_coastal_area_property_mark": "NXTZ9IiHoqdJLIJdABeO",
    "addenda_poa_membership_mark": "5ZU2f0XeMWHjQbwBEsD1",
    "addenda_non_realty_items_mark": "3PU9i62PLkov9YV6q3Mc",
    "addenda_back_up_contract_mark": "CVKqL2Ir1VNglli2XO6f",
    "addenda_mineral_reservation_mark": "1TpO61JNm595TSf7DxwT",
    // -- Batch 2: 11 restructured contract-text keys, provisioned and
    //    readback-verified live in GHL Test 2026-09-14 --
    "lease_nrl_terminate_within_days_text": "eeamXWV5F7d8Q6ne9HJy",
    "survey_opt1_seller_furnish_days_text": "u59OMAoyjK9YuTwcqa0r",
    "survey_opt2_buyer_obtain_days_text": "61wPlte1S9BkNZpfGLys",
    "survey_opt3_seller_furnish_days_text": "j05f5WAhuvVWbBEzaRP9",
    "sdn_deliver_within_days_text": "9Ct8c2DpVFf5Gv0hMAMo",
    "water_deliver_within_days_text": "iyEFgnDlPSrUTnjWh6AL",
    "water_source_text": "mBCxlruQK1THlKzAlCND",
    "spbb_dollar_amount_text": "cLVDbtp1nlPKH9NGUCUz",
    "spbb_percent_amount_text": "mWYz5ZTIbMvSBTOVroCN",
    "bpsb_dollar_amount_text": "btZyfuT3OWUtno5lXBY0",
    "bpsb_percent_amount_text": "zF8SP63sgaDucKbSu9aM",
    // -- Batch 3: 22 page-11 broker-text keys, provisioned and
    //    readback-verified live in GHL Test 2026-09-15. All 110 live
    //    projection keys are now real ids -- zero sentinels remain. --
    "seller_broker_firm_name_text": "fQ5nJcC4J75talRkepts",
    "seller_broker_address_text": "G45ZH9axVugvfobPGvuS",
    "seller_broker_firm_license_no_text": "AoBHfaBz9pBJKikN1Eko",
    "seller_broker_associate_name_text": "Pdep7yJF2NSjUcjSth3k",
    "seller_broker_team_name_text": "sdI6iQaoNk59KbL21Lfl",
    "seller_broker_associate_email_text": "8GvAYN43flkL9Ym8taP6",
    "seller_broker_associate_phone_text": "TnPsNqI99PneMzrGbPdD",
    "seller_broker_associate_license_no_text": "KAb0Le7PTH7nvCa8IUtB",
    "seller_broker_supervisor_name_text": "xWpS4xAMNhFRdl4pAOZU",
    "seller_broker_supervisor_phone_text": "kOMxDcTFZGrYjfEP8V6f",
    "seller_broker_supervisor_license_no_text": "QuDhSYEG7OPf6pQSYHqP",
    "buyer_broker_firm_name_text": "VwPs2a9SxVX0tCvh7Fdn",
    "buyer_broker_address_text": "rzGaryRSVJJ4kIf0x9SX",
    "buyer_broker_firm_license_no_text": "UvftPMxalVkg6W2kaFKR",
    "buyer_broker_associate_name_text": "3u0i3DFGlwEndug8J1mb",
    "buyer_broker_team_name_text": "p2r4okZEpPOAVrb8jmWz",
    "buyer_broker_associate_email_text": "TGV1cchvAHsytzeG0F0k",
    "buyer_broker_associate_phone_text": "fx126eOS938C09GQx8LM",
    "buyer_broker_associate_license_no_text": "dI3u3ab6APNEI0kyDLlw",
    "buyer_broker_supervisor_name_text": "LQPRlxZ4muswJ74cwGBj",
    "buyer_broker_supervisor_phone_text": "mHsY9gaeivKRLZabmw25",
    "buyer_broker_supervisor_license_no_text": "usaUY2BYjLFXzTMklCU0",
  },
  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI",
  pipelines: {
    sellerLeads:         "wdvKMdPMxs38qoA6lkUa",
  },
  stages: {
    newLeadSeller:       "1228a837-09b1-4ce5-8821-cfd98a6d9367",
    contactInitiated:    "3541be01-0405-40cb-9077-4c94703b8d22",
    sellerCallBooked:    "fba35e9d-c65e-4da2-87ee-51b9abde0116",
    noShow:              "65b0b638-a8b4-43ab-b8d6-762b855f19ba",
    sellerCallCompleted: "7928e9a0-e59a-4e71-bf36-e8022e733d3a",
    sellerFollowUp:      "38b6498e-dc4a-42f0-9081-7e59eb05447f",
    sellerOfferSent:     "9f9ad696-6760-4233-af87-fa8f1dd122e1",
    sellerClosedWon:     "bfca8a93-5f24-4064-9317-bc6ba1cca3af",
    longTermNurture:     "c44d504e-cb1b-4a7f-b077-74117e92d91a",
    lostNotInterested:   "08b4d86d-7cdb-48fa-b195-a72b52d0ab8c",
  },
  // B9-08 / INV-63. The ONE pre-approved GHL Test contact ("IAOS
  // Underwriting Test") -- the same contact Brad's own live Documents &
  // Contracts Test transaction used directly in GHL's UI, 2026-09-09
  // (docs/BOARD9_CONTRACT_INVENTORY_V1.md item 8). SERVER-SIDE ONLY -- see
  // the interface doc comment; never added to RUNTIME_GROUPS.
  documentsContracts: {
    approvedTestContactId: "NAGtUZ9aOE5C1GatJzpT",
    // Brad's own verified GHL Test sender ("IAOS Test Sender").
    senderUserId: "d42aAm0d06yZZLsmVuOL",
    // Brad's own verified GHL Test template identity.
    templateId: "6aa417de09c51fa0927e77cd",
    expectedTemplateName: "TREC NO 20-19 RESALE V1",
    // Brad confirmed this template's uploaded PDF has NO overlaid
    // population/initial/date/checkbox/signature fields yet -- see the
    // interface doc comment. Sending is refused (GATE 2, ghl-proxy.ts)
    // unconditionally while this is not POPULATION_VERIFIED.
    populationVerification: POPULATION_NOT_VERIFIED,
  },
};

export function getConfig(selector: string | undefined): GhlConfig {
  if (selector === undefined || selector === "") {
    throw new Error(
      `[ghl-config] selector is required; received ${JSON.stringify(selector)}. ` +
        `Expected "production" or "test". There is no default.`,
    );
  }

  if (selector !== "production" && selector !== "test") {
    throw new Error(
      `[ghl-config] unknown selector ${JSON.stringify(selector)}. ` +
        `Expected "production" or "test". There is no default.`,
    );
  }

  const config: GhlConfig = selector === "production" ? PRODUCTION : TEST;

  // Derived rather than enumerated: a hand-maintained list is a third
  // place to forget an edit, and an omission silently narrows PB-D51's
  // fail-loud invariant. Every key in every map is checked automatically.
  const entries: Array<[string, string]> = [
    ["locationId", config.locationId],
    ...Object.entries(config.fields).map(
      ([k, v]): [string, string] => [`fields.${k}`, v],
    ),
    ...Object.entries(config.folders).map(
      ([k, v]): [string, string] => [`folders.${k}`, v],
    ),
    ...Object.entries(config.customValues).map(
      ([k, v]): [string, string] => [`customValues.${k}`, v],
    ),
    ...Object.entries(config.opportunityFields).map(
      ([k, v]): [string, string] => [`opportunityFields.${k}`, v],
    ),
    ...Object.entries(config.opportunityFacts).map(
      ([k, v]): [string, string] => [`opportunityFacts.${k}`, v],
    ),
    ...Object.entries(config.contractProjectionFields).map(
      ([k, v]): [string, string] => [`contractProjectionFields.${k}`, v],
    ),
    ["contractDraftRequest", config.contractDraftRequest],
    ...Object.entries(config.pipelines).map(
      ([k, v]): [string, string] => [`pipelines.${k}`, v],
    ),
    ...Object.entries(config.stages).map(
      ([k, v]): [string, string] => [`stages.${k}`, v],
    ),
    ...Object.entries(config.documentsContracts).map(
      ([k, v]): [string, string] => [`documentsContracts.${k}`, v],
    ),
  ];

  const missing = firstIncompleteKey(entries);
  if (missing !== null) {
    throw new Error(
      `[ghl-config] selector ${JSON.stringify(selector)} resolves to an ` +
        `incomplete configuration: ${missing} is empty.`,
    );
  }

  return config;
}

/**
 * THE completeness check. ONE implementation, shared by getConfig above and by
 * setRuntimeConfig below — a second validator would let one path accept a
 * payload the other rejects, which is the defect class Gate 4B removed at the
 * identifier level and Gate 4B-4 removed at the matcher level.
 *
 * The typeof guard is inert for getConfig, whose maps are typed string
 * literals. It matters only on the runtime path, where the input arrives over
 * the wire and an absent key is `undefined` rather than "".
 */
function firstIncompleteKey(entries: Array<[string, string]>): string | null {
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.trim() === "") return key;
  }
  return null;
}

// ── Runtime configuration (Gate 4B-5) ──────────────────────────────────────
//
// The browser no longer receives a build-time selector. It fetches a projection
// of this config at boot, and main.tsx populates the singleton below BEFORE it
// dynamically imports App. Every module-scope getRuntimeConfig() call downstream
// therefore sees a populated value, exactly as the build-time constant used to
// behave — the change is WHEN it is known, not HOW it is read.

/**
 * The payload contract. ONE source of truth: the endpoint PROJECTS through it
 * and the browser VALIDATES against it, so the served shape and the checked
 * shape cannot drift apart.
 *
 * These are the keys the four frontend call sites actually consume, and nothing
 * else. Deliberately absent: pipelines (server-only, ghl-opportunities),
 * customValues.mailerDigestRecipient (server-only, mailer-digest), and the seven
 * contact fields no browser code reads. Nothing here is a secret; adding a key
 * that is means this comment is now wrong.
 *
 * `documentsContracts.populationVerification` / `templateId` /
 * `expectedTemplateName` (B9-08 / INV-63) are exceptions to that group's
 * own "SERVER-SIDE ONLY" doctrine above -- exposing them carries none of
 * the risk `senderUserId` / `approvedTestContactId` would, because GATE 2
 * in `ghl-proxy.ts` unconditionally overrides the SEND'S ACTUAL
 * contactId/userId/templateId server-side regardless of what any caller
 * (browser included) supplies or claims. `populationVerification` and
 * `templateId`/`expectedTemplateName` are exposed so `ContractWorkspace.tsx`
 * can (1) show an honest, correct "not eligible" reason BEFORE ever
 * attempting a send instead of only discovering the same server-side
 * refusal after a failed POST, and (2) perform its OWN pre-flight drift
 * check -- does the locked template id still exist in GHL and still carry
 * this exact name? This is precisely the SAME kind of exposure every
 * other RUNTIME_GROUPS entry above already makes (e.g.
 * `stages.sellerClosedWon`, `opportunityFields.sellerMAO` -- real GHL
 * identifiers, browser-visible today) -- `approvedTestContactId` /
 * `senderUserId` stay withheld specifically because THOSE name who
 * receives or sends an actual e-sign, which this build never lets the
 * browser choose; a template identifier carries no equivalent risk.
 */
const RUNTIME_GROUPS = {
  fields: [
    "lastCallAttempt",
    "lastCallAttemptPrecise",
    "callbackDatetime",
    "callbackDatetimePrecise",
    "propertyNotes",
    "arv",
    "estimatedRepairs",
    "askingPrice",
    // Board 4: browser-WRITTEN, so unlike phoneStatus (server-parsed only)
    // these ids must reach the client.
    "callDisposition",
    "callRouting",
    "dispositionAt",
    // Board #5 S3: browser-WRITTEN by the occupancy editor, so its id must
    // reach the client.
    "occupancyStatus",
  ],
  folders: ["offer", "additionalInfo"],
  customValues: [
    "sellingCostPct",
    "closingCost",
    "monthlyCarry",
    "holdMonths",
    "buyerProfitPct",
    "financingEnabled",
    "financingLtv",
    "financingRate",
    "financingPoints",
    "standardMinimum",
    "profitSharePct",
  ],
  opportunityFields: ["endBuyerMaxPrice", "assignmentMode", "sellerMAO"],
  opportunityFacts: ["arv", "repairs", "askingPrice", "currentOffer"],
  /**
   * INV-67 / B9-12 -- browser-WRITTEN by the Contract Workspace sync
   * control, so every id must reach the client, exactly like
   * `opportunityFacts` above. None of these is a secret: they are GHL
   * Opportunity custom-field identifiers, the same risk class as every
   * other id this object already exposes.
   */
  contractProjectionFields: CONTRACT_PROJECTION_FIELD_KEYS,
  stages: ["sellerClosedWon", "lostNotInterested", "sellerFollowUp"],
  documentsContracts: ["populationVerification", "templateId", "expectedTemplateName"],
} as const;

export interface RuntimeConfig {
  locationId: string;
  fields: Pick<
    GhlConfig["fields"],
    | "lastCallAttempt"
    | "lastCallAttemptPrecise"
    | "callbackDatetime"
    | "callbackDatetimePrecise"
    | "propertyNotes"
    | "arv"
    | "estimatedRepairs"
    | "askingPrice"
    | "callDisposition"
    | "callRouting"
    | "dispositionAt"
    | "occupancyStatus"
  >;
  folders: GhlConfig["folders"];
  customValues: Omit<GhlConfig["customValues"], "mailerDigestRecipient">;
  opportunityFields: GhlConfig["opportunityFields"];
  opportunityFacts: GhlConfig["opportunityFacts"];
  contractProjectionFields: GhlConfig["contractProjectionFields"];
  /** INV-67 / B9-12 -- flat, like `locationId` above: the Contract Draft Request field is a single id, not a nested group. */
  contractDraftRequest: string;
  stages: Pick<
    GhlConfig["stages"],
    "sellerClosedWon" | "lostNotInterested" | "sellerFollowUp"
  >;
  documentsContracts: Pick<GhlConfig["documentsContracts"], "populationVerification" | "templateId" | "expectedTemplateName">;
}

/** Server side: project a full config down to what the browser consumes. */
export function projectRuntimeConfig(config: GhlConfig): RuntimeConfig {
  const out: Record<string, unknown> = { locationId: config.locationId, contractDraftRequest: config.contractDraftRequest };
  for (const [group, keys] of Object.entries(RUNTIME_GROUPS)) {
    const source = config[group as keyof GhlConfig] as Record<string, string>;
    const picked: Record<string, string> = {};
    for (const key of keys as readonly string[]) picked[key] = source[key];
    out[group] = picked;
  }
  return out as unknown as RuntimeConfig;
}

/** Derived entries for an untrusted payload, walked against RUNTIME_GROUPS. */
function runtimeEntries(payload: unknown): Array<[string, string]> {
  const p = (payload ?? {}) as Record<string, Record<string, string> | string>;
  const entries: Array<[string, string]> = [
    ["locationId", p.locationId as string],
    ["contractDraftRequest", p.contractDraftRequest as string],
  ];
  for (const [group, keys] of Object.entries(RUNTIME_GROUPS)) {
    const g = p[group] as Record<string, string> | undefined;
    for (const key of keys as readonly string[]) {
      // An absent group yields undefined per key, which the shared check
      // rejects — so a payload missing a whole group fails closed rather than
      // passing because it had nothing to walk.
      entries.push([`${group}.${key}`, g == null ? (undefined as unknown as string) : g[key]]);
    }
  }
  return entries;
}

let RUNTIME: RuntimeConfig | null = null;

/**
 * Validate a fetched payload and populate the singleton. Throws on anything
 * incomplete, which is what keeps main.tsx from importing App.
 */
export function setRuntimeConfig(payload: unknown): RuntimeConfig {
  const missing = firstIncompleteKey(runtimeEntries(payload));
  if (missing !== null) {
    throw new Error(
      `[ghl-config] runtime configuration is incomplete: ${missing} is ` +
        `empty or absent.`,
    );
  }
  RUNTIME = payload as RuntimeConfig;
  return RUNTIME;
}

/**
 * Read the runtime config. Throws if boot has not populated it — which cannot
 * happen through the supported path, because App is only imported after
 * setRuntimeConfig succeeds. A throw here means someone imported an
 * application module outside that boot sequence.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (RUNTIME === null) {
    throw new Error(
      "[ghl-config] runtime configuration was read before it was set. " +
        "App must only be imported after setRuntimeConfig() succeeds.",
    );
  }
  return RUNTIME;
}
