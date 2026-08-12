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

  const entries: Array<[string, string]> = [
    ["locationId", config.locationId],
    ["fields.lastCallAttempt", config.fields.lastCallAttempt],
    ["fields.lastCallAttemptPrecise", config.fields.lastCallAttemptPrecise],
    ["fields.callbackDatetime", config.fields.callbackDatetime],
    ["fields.callbackDatetimePrecise", config.fields.callbackDatetimePrecise],
    ["fields.propertyNotes", config.fields.propertyNotes],
    ["fields.arv", config.fields.arv],
    ["fields.propertyAddress", config.fields.propertyAddress],
    ["fields.offerPrice", config.fields.offerPrice],
    ["fields.motivationScore", config.fields.motivationScore],
    ["fields.dealScore", config.fields.dealScore],
    ["fields.combinedScore", config.fields.combinedScore],
    ["fields.dataCompletenessScore", config.fields.dataCompletenessScore],
    ["fields.phoneStatus", config.fields.phoneStatus],
    ["folders.offer", config.folders.offer],
    ["folders.additionalInfo", config.folders.additionalInfo],
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
