// Additional Info subgroup mapping (§5.4) — the ONE checked-in IAOS config the
// spec permits; everything else stays LIVE from GHL. Transcribed verbatim from
// docs/CONTACT_FIELD_REFERENCE.md (Part 2 table, line 151), fieldKey → subgroup.
// GHL exposes no subgroup on the wire (all 73 share parentId qYS1wakeOTmfgjyeSJ8M);
// this is the sole source of the four-way partition. A module-load assertion
// pins the 73-count and the 22/30/14/7 partition so a transcription drift fails
// loudly at import, not silently at render.

export type AdditionalInfoSubgroup = "Reachability" | "Property" | "Investor" | "System";

export const ADDITIONAL_INFO_SUBGROUPS: Record<string, AdditionalInfoSubgroup> = {
  // Reachability (22)
  "contact.phone_1_dnc": "Reachability",
  "contact.phone_2": "Reachability",
  "contact.phone_2_dnc": "Reachability",
  "contact.phone_3": "Reachability",
  "contact.phone_3_dnc": "Reachability",
  "contact.phone_4": "Reachability",
  "contact.phone_4_dnc": "Reachability",
  "contact.phone_5": "Reachability",
  "contact.phone_5_dnc": "Reachability",
  "contact.email_2": "Reachability",
  "contact.email_3": "Reachability",
  "contact.email_4": "Reachability",
  "contact.owner_2_first_name": "Reachability",
  "contact.owner_2_last_name": "Reachability",
  "contact.litigator": "Reachability",
  "contact.mailing_care_of_name": "Reachability",
  "contact.mailing_address": "Reachability",
  "contact.mailing_city": "Reachability",
  "contact.mailing_state": "Reachability",
  "contact.mailing_zip": "Reachability",
  "contact.mailing_county": "Reachability",
  "contact.do_not_mail": "Reachability",
  // Property (30)
  "contact.property_address": "Property",
  "contact.loan_amount": "Property",
  "contact.interest_rate": "Property",
  "contact.county": "Property",
  "contact.apn": "Property",
  "contact.property_status": "Property",
  "contact.property_type": "Property",
  "contact.bedrooms": "Property",
  "contact.total_bathrooms": "Property",
  "contact.building_sqft": "Property",
  "contact.lot_size_sqft": "Property",
  "contact.effective_year_built": "Property",
  "contact.total_assessed_value": "Property",
  "contact.last_sale_date": "Property",
  "contact.last_sale_amount": "Property",
  "contact.total_open_loans": "Property",
  "contact.est_remaining_loan_balance": "Property",
  "contact.est_value": "Property",
  "contact.est_ltv": "Property",
  "contact.est_equity": "Property",
  "contact.mls_status": "Property",
  "contact.mls_date": "Property",
  "contact.mls_amount": "Property",
  "contact.lien_amount": "Property",
  "contact.foreclosure_factor": "Property",
  "contact.total_condition": "Property",
  "contact.interior_condition": "Property",
  "contact.bathroom_condition": "Property",
  "contact.kitchen_condition": "Property",
  "contact.exterior_condition": "Property",
  // Investor (14)
  "contact.asking_price": "Investor",
  "contact.arv": "Investor",
  "contact.estimated_repairs": "Investor",
  "contact.motivation_level": "Investor",
  "contact.timeline_to_sell": "Investor",
  "contact.lead_source": "Investor",
  "contact.occupancy_status": "Investor",
  "contact.follow_up_date": "Investor",
  "contact.mao_viability_flag": "Investor",
  "contact.hold_months": "Investor",
  "contact.carrying_cost": "Investor",
  "contact.repair_line_items": "Investor",
  "contact.owner_occupied": "Investor",
  "contact.property_notes": "Investor",
  // System (7)
  "contact.marketing_lists": "System",
  "contact.date_added_to_list": "System",
  "contact.motivation_score": "System",
  "contact.deal_score": "System",
  "contact.combined_score": "System",
  "contact.data_completeness_score": "System",
  "contact.callback_datetime_precise": "System",
};

// Startup assertion (§5.4) — runs at module load. Any drift throws at import,
// naming the failed condition and the actual number, so it never renders wrong.
(function assertAdditionalInfoSubgroups() {
  const SUBGROUPS: AdditionalInfoSubgroup[] = ["Reachability", "Property", "Investor", "System"];
  const EXPECTED: Record<AdditionalInfoSubgroup, number> = { Reachability: 22, Property: 30, Investor: 14, System: 7 };

  const entries = Object.entries(ADDITIONAL_INFO_SUBGROUPS);
  if (entries.length !== 73) {
    throw new Error(`additionalInfoSubgroups: entry count must be 73, got ${entries.length}`);
  }

  const counts: Record<AdditionalInfoSubgroup, number> = { Reachability: 0, Property: 0, Investor: 0, System: 0 };
  for (const [fieldKey, sub] of entries) {
    if (!SUBGROUPS.includes(sub)) {
      throw new Error(`additionalInfoSubgroups: "${fieldKey}" has invalid subgroup "${sub}"`);
    }
    counts[sub]++;
  }

  for (const sub of SUBGROUPS) {
    if (counts[sub] !== EXPECTED[sub]) {
      throw new Error(`additionalInfoSubgroups: ${sub} count must be ${EXPECTED[sub]}, got ${counts[sub]}`);
    }
  }
})();
