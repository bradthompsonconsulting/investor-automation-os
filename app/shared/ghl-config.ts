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
  };
  folders: {
    offer: string;
    additionalInfo: string;
  };
  /** Location-scoped investor policy. PB-D56 section IV. */
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
  };
  /** Deal-level Opportunity carriers. PB-D56 section VI. */
  opportunityFields: {
    endBuyerMaxPrice: string;
    assignmentMode: string;
    sellerMAO: string;
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
  },
  opportunityFields: {
    endBuyerMaxPrice:   "zOVIPwzLe41a0SQmwVAJ",
    assignmentMode:     "TpLo0WRc303TXAaBUbBf",
    sellerMAO:          "Atu5XCjpFElY8H64VG4h",
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
  },
  opportunityFields: {
    endBuyerMaxPrice:   "",
    assignmentMode:     "",
    sellerMAO:          "",
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
