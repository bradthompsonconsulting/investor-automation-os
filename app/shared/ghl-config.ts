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
    offerPrice: string;
    motivationScore: string;
    dealScore: string;
    combinedScore: string;
    dataCompletenessScore: string;
    phoneStatus: string;
    estimatedRepairs: string;
    askingPrice: string;
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
   */
  opportunityFacts: {
    arv: string;
    repairs: string;
    askingPrice: string;
  };
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
    offerPrice:              "v2VO2wUwTYRojmU7VXyZ",
    motivationScore:         "8vH9yq10xeYVVMHXbS0C",
    dealScore:               "cfkm0kb9CLvjZgyrcIFz",
    combinedScore:           "9SVnuzznYsZOQQazpxld",
    dataCompletenessScore:   "r9sD1rlTIqhOx9Mhvftt",
    phoneStatus:             "6WJG2a40490bW0c62YFT",
    estimatedRepairs:        "OQnud97MfdxMcTgMVTgf",
    askingPrice:             "60UCjsYT1Ak3Kyy5ZCL8",
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
  },
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
};

// PB-D51 -- schema only. Populated after a GHL test location exists.
// Empty values make getConfig throw.
const TEST: GhlConfig = {
  locationId: "",
  fields: {
    lastCallAttempt:         "",
    lastCallAttemptPrecise:  "",
    callbackDatetime:        "",
    callbackDatetimePrecise: "",
    propertyNotes:           "",
    arv:                     "",
    propertyAddress:         "",
    offerPrice:              "",
    motivationScore:         "",
    dealScore:               "",
    combinedScore:           "",
    dataCompletenessScore:   "",
    phoneStatus:             "",
    estimatedRepairs:        "",
    askingPrice:             "",
  },
  folders: {
    offer:          "",
    additionalInfo: "",
  },
  customValues: {
    sellingCostPct:     "",
    closingCost:        "",
    monthlyCarry:       "",
    holdMonths:         "",
    buyerProfitPct:     "",
    financingEnabled:   "",
    financingLtv:       "",
    financingRate:      "",
    financingPoints:    "",
    standardMinimum:    "",
    profitSharePct:     "",
    mailerDigestRecipient: "",
  },
  opportunityFields: {
    endBuyerMaxPrice:   "",
    assignmentMode:     "",
    sellerMAO:          "",
  },
  opportunityFacts: {
    arv:                "",
    repairs:            "",
    askingPrice:        "",
  },
  pipelines: {
    sellerLeads:         "",
  },
  stages: {
    newLeadSeller:       "",
    contactInitiated:    "",
    sellerCallBooked:    "",
    noShow:              "",
    sellerCallCompleted: "",
    sellerFollowUp:      "",
    sellerOfferSent:     "",
    sellerClosedWon:     "",
    longTermNurture:     "",
    lostNotInterested:   "",
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
    ...Object.entries(config.pipelines).map(
      ([k, v]): [string, string] => [`pipelines.${k}`, v],
    ),
    ...Object.entries(config.stages).map(
      ([k, v]): [string, string] => [`stages.${k}`, v],
    ),
  ];

  for (const [key, value] of entries) {
    if (value.trim() === "") {
      throw new Error(
        `[ghl-config] selector ${JSON.stringify(selector)} resolves to an ` +
          `incomplete configuration: ${key} is empty.`,
      );
    }
  }

  return config;
}
