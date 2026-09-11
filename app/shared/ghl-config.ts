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
   * reference page (2026-09-11). TEST's value is Brad's own verified GHL
   * Test sender user id ("IAOS Test Sender", supplied 2026-09-11 Jess
   * Gate correction round) -- NOT invented or guessed.
   *
   * `templateId` / `expectedTemplateName` -- INV-63 correction round
   * (2026-09-11). The GHL Documents & Contracts "Send Template" endpoint
   * is resolved by ID, never by a live name search: `ghl-proxy.ts`'s
   * GATE 2 UNCONDITIONALLY OVERWRITES the request body's `templateId`
   * with this value too, exactly like `contactId`/`userId` -- a mutable
   * GHL display name is never trusted as the SEND target, only as a
   * pre-flight drift check the client performs against `expectedTemplateName`
   * before ever offering the Send button (see `ContractWorkspace.tsx`).
   * TEST's values are Brad's own verified GHL Test template identity
   * ("TREC NO 20-19 RESALE V1", `6aa417de09c51fa0927e77cd`).
   *
   * `populationVerification` -- Brad has confirmed (2026-09-11) the
   * uploaded TREC PDF backing this template carries NO overlaid
   * population, initial, date, checkbox, or signature fields today.
   * GHL's public Documents & Contracts API (List/Send Templates, List/
   * Send Documents -- the complete public surface, verified against
   * GHL's own reference pages) exposes NO operation to create a
   * template, upload a PDF, or place/map fields; that configuration can
   * only be done by a human inside GHL's own template editor, and this
   * codebase has no way to verify it happened other than a human
   * attestation recorded here. While this equals
   * `POPULATION_NOT_VERIFIED`, `ghl-proxy.ts`'s GATE 2 refuses every
   * `/proposals/templates/send` request, unconditionally, for BOTH
   * environments -- there is no code path that can make sending safe
   * while the template is actually blank, and no sentinel value this
   * build is authorized to treat as satisfying that. Flipping this
   * requires Brad to (1) complete the field placement in GHL, (2)
   * accept that IAOS's own send-time readback check (`contract-send-
   * model.ts`'s `classifyDocumentReadback`) is the only available
   * verification, since the API has no pre-send introspection of a
   * template's own field layout, and (3) record a new value here
   * himself, as its own reviewed commit -- never toggled at runtime.
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

/** GATE 2 / B9-08 correction round -- the ONE value that permits a real send. Anything else (including an empty string, which `getConfig`'s completeness check already refuses) fails closed. There is no partial/staged value; population is either verified or it is not. */
export const POPULATION_VERIFIED = "POPULATION_VERIFIED" as const;
/** The value both PRODUCTION and TEST carry until a human records `POPULATION_VERIFIED` above, as its own reviewed commit. */
export const POPULATION_NOT_VERIFIED = "POPULATION_NOT_VERIFIED" as const;

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
    offerPrice:              "oUJHAbPq7tcw67U2Q5Zx",
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
  },
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
    // Brad's own verified GHL Test sender ("IAOS Test Sender"), supplied
    // 2026-09-11 -- see the interface doc comment.
    senderUserId: "d42aAm0d06yZZLsmVuOL",
    // Brad's own verified GHL Test template identity, supplied 2026-09-11.
    templateId: "6aa417de09c51fa0927e77cd",
    expectedTemplateName: "TREC NO 20-19 RESALE V1",
    // Brad confirmed 2026-09-11 this template's uploaded PDF has NO
    // overlaid population/initial/date/checkbox/signature fields yet --
    // see the interface doc comment. Sending is refused (GATE 2,
    // ghl-proxy.ts) unconditionally while this is not POPULATION_VERIFIED.
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
 * These are the keys the frontend call sites actually consume, and nothing
 * else. Deliberately absent: pipelines (server-only, ghl-opportunities),
 * customValues.mailerDigestRecipient (server-only, mailer-digest), and the seven
 * contact fields no browser code reads. Nothing here is a secret; adding a key
 * that is means this comment is now wrong.
 *
 * `documentsContracts.populationVerification` / `templateId` /
 * `expectedTemplateName` (INV-63 correction round, 2026-09-11) are
 * exceptions to that group's own "SERVER-SIDE ONLY" doctrine above --
 * exposing them carries none of the risk `senderUserId` /
 * `approvedTestContactId` would, because GATE 2 in `ghl-proxy.ts`
 * unconditionally overrides the SEND'S ACTUAL contactId/userId/templateId
 * server-side regardless of what any caller (browser included) supplies
 * or claims. `populationVerification` and `templateId`/
 * `expectedTemplateName` are exposed so `ContractWorkspace.tsx` can (1)
 * show an honest, correct "not eligible" reason BEFORE ever attempting a
 * send instead of only discovering the same server-side refusal after a
 * failed POST, and (2) perform its OWN pre-flight drift check -- does
 * the locked template id still exist in GHL and still carry this exact
 * name? -- per item 2 of that correction round ("prefer the locked
 * template ID with validation of its expected name... rather than
 * relying solely on a mutable display name"). This is precisely the
 * SAME kind of exposure every other RUNTIME_GROUPS entry above already
 * makes (e.g. `stages.sellerClosedWon`, `opportunityFields.sellerMAO` --
 * real GHL identifiers, browser-visible today) -- `approvedTestContactId`
 * / `senderUserId` stay withheld specifically because THOSE name who
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
  opportunityFacts: ["arv", "repairs", "askingPrice"],
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
  stages: Pick<
    GhlConfig["stages"],
    "sellerClosedWon" | "lostNotInterested" | "sellerFollowUp"
  >;
  documentsContracts: Pick<GhlConfig["documentsContracts"], "populationVerification" | "templateId" | "expectedTemplateName">;
}

/** Server side: project a full config down to what the browser consumes. */
export function projectRuntimeConfig(config: GhlConfig): RuntimeConfig {
  const out: Record<string, unknown> = { locationId: config.locationId };
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
