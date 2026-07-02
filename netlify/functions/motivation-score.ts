/**
 * Motivation Score v2 — Netlify function.
 * Three-score system: motivation_score, deal_score, combined_score.
 * POST body: { contactId: string }
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

// Output field IDs (deal_score and combined_score created 2026-07-01)
const DEAL_SCORE_FIELD_ID     = "cfkm0kb9CLvjZgyrcIFz";
const COMBINED_SCORE_FIELD_ID = "9SVnuzznYsZOQQazpxld";

// MLS modifier constants (within spec ranges: Active −30–35, Expired/Failed +10–15)
const MLS_ACTIVE_MODIFIER  = -32;
const MLS_EXPIRED_MODIFIER = +12;

// ── GHL helpers ───────────────────────────────────────────────────────────────

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

async function fetchFieldIdMap(): Promise<Record<string, string>> {
  const res = await fetch(`${GHL_BASE}/locations/${LOCATION_ID}/customFields`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) throw new Error(`GET /customFields → ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  const fields: any[] = body.customFields ?? body.fields ?? [];
  const map: Record<string, string> = {};
  for (const f of fields) {
    const key = (f.fieldKey ?? f.key ?? "").replace(/^contact\./, "");
    if (key && f.id) map[key] = f.id;
  }
  return map;
}

async function fetchContact(contactId: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) throw new Error(`GET /contacts/${contactId} → ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  return body.contact;
}

async function writeScores(
  contactId: string,
  motivationFieldId: string,
  motivationScore: number,
  dealScore: number,
  combinedScore: number,
): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({
      customFields: [
        { id: motivationFieldId,   field_value: motivationScore },
        { id: DEAL_SCORE_FIELD_ID, field_value: dealScore },
        { id: COMBINED_SCORE_FIELD_ID, field_value: combinedScore },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PUT /contacts/${contactId} → ${res.status}: ${await res.text()}`);
}

// ── Field readers ─────────────────────────────────────────────────────────────

function str(customFields: any[], id: string): string {
  const f = customFields?.find((cf: any) => cf.id === id);
  return String(f?.value ?? f?.fieldValue ?? f?.field_value ?? "").trim();
}

function num(customFields: any[], id: string): number | null {
  const raw = str(customFields, id);
  if (!raw) return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

interface ScoreResult {
  motivationScore: number;
  dealScore: number;
  combinedScore: number;
  suppressed: boolean;
  suppressReason?: string;
  breakdown: {
    motivation: Record<string, number>;
    deal: Record<string, number>;
  };
}

function computeScores(contact: any, cf: any[], ids: Record<string, string>): ScoreResult {
  // ── STEP 1: Channel-aware suppression gate ───────────────────────────────
  const email     = String(contact?.email ?? "").trim();
  const phoneType = str(cf, ids.phone_type).toLowerCase();
  const phoneDnc  = str(cf, ids.phone_1_dnc);
  const litigator = str(cf, ids.litigator);

  const phoneDncClear  = !phoneDnc || phoneDnc.toLowerCase() === "no";
  const litigatorClear = !litigator;
  const hasViableChannel =
    email !== "" ||
    (phoneType === "mobile" && phoneDncClear && litigatorClear);

  // Condition data is shared by both motivation and deal score sections
  const conditionRaw = str(cf, ids.total_condition);
  const condition    = conditionRaw.toLowerCase();
  const mConditionScale: Record<string, number> = {
    "poor":      7, "fair":      6, "average":   4,
    "good":      2, "very good": 1, "excellent": 0,
  };
  const dConditionScale: Record<string, number> = {
    "poor":      6, "fair":     12, "average":  18,
    "good":     14, "very good": 8, "excellent": 3,
  };

  // ── STEP 2: Motivation Score (raw pool = 54, rescaled to 0-100) ──────────
  // Zero when no viable channel; deal score still computes unconditionally.
  const mBreakdown: Record<string, number> = {};
  if (hasViableChannel) {
    // owner_occupied — 25 pts (absentee = motivated)
    const ownerOccupied = str(cf, ids.owner_occupied).toLowerCase();
    mBreakdown.owner_occupied = ownerOccupied === "no" ? 25 : 0;

    // foreclosure_factor — 20 pts (7-tier TEXT label)
    const foreclosure = str(cf, ids.foreclosure_factor).toLowerCase();
    const foreclosureScale: Record<string, number> = {
      "very low":    0, "low":         3, "medium low":  7, "medium":     10,
      "medium high": 13, "high":       17, "very high":  20,
    };
    mBreakdown.foreclosure_factor = foreclosureScale[foreclosure] ?? 0;

    // total_condition — 7 pts (worse = higher motivation)
    if (!condition) {
      mBreakdown.total_condition = 0;
    } else if (condition in mConditionScale) {
      mBreakdown.total_condition = mConditionScale[condition];
    } else {
      console.warn(`[motivation-score] Unmapped total_condition: "${conditionRaw}" — defaulting to Average`);
      mBreakdown.total_condition = 4;
    }

    // phone_type — 2 pts
    mBreakdown.phone_type = phoneType === "mobile" ? 2 : 0;
  }

  const mRaw = Object.values(mBreakdown).reduce((a, b) => a + b, 0);
  const motivationScore = hasViableChannel ? Math.round((mRaw / 54) * 100) : 0;

  // ── STEP 3: Deal Score (raw pool = 100, MLS modifier outside pool) ───────
  const dBreakdown: Record<string, number> = {};

  // est_equity — 35 pts
  const equity = num(cf, ids.est_equity);
  if      (equity !== null && equity >= 150000) dBreakdown.est_equity = 35;
  else if (equity !== null && equity >= 100000) dBreakdown.est_equity = 26;
  else if (equity !== null && equity >=  50000) dBreakdown.est_equity = 16;
  else if (equity !== null && equity >=  20000) dBreakdown.est_equity =  7;
  else                                          dBreakdown.est_equity =  0;

  // est_ltv — 20 pts
  const ltv = num(cf, ids.est_ltv);
  if      (ltv !== null && ltv <=  20) dBreakdown.est_ltv = 20;
  else if (ltv !== null && ltv <=  40) dBreakdown.est_ltv = 15;
  else if (ltv !== null && ltv <=  60) dBreakdown.est_ltv = 10;
  else if (ltv !== null && ltv <=  80) dBreakdown.est_ltv =  5;
  else                                 dBreakdown.est_ltv =  0;

  // total_condition — 18 pts, bell curve (peaks at Average)
  if (!condition) {
    dBreakdown.total_condition = 0;
  } else if (condition in dConditionScale) {
    dBreakdown.total_condition = dConditionScale[condition];
  } else {
    dBreakdown.total_condition = 18; // unmapped → default Average
  }

  // effective_year_built — 12 pts
  const yearBuilt = num(cf, ids.effective_year_built);
  if      (yearBuilt !== null && yearBuilt >= 2000) dBreakdown.effective_year_built = 12;
  else if (yearBuilt !== null && yearBuilt >= 1975) dBreakdown.effective_year_built = 10;
  else if (yearBuilt !== null && yearBuilt >= 1950) dBreakdown.effective_year_built =  3;
  else if (yearBuilt !== null)                      dBreakdown.effective_year_built =  1;
  else                                              dBreakdown.effective_year_built =  0;

  // lien_amount — 8 pts (lien-to-value ratio; no lien = best)
  const lienAmt = num(cf, ids.lien_amount);
  const estVal  = num(cf, ids.est_value);
  if (!lienAmt || lienAmt <= 0) {
    dBreakdown.lien_amount = 8;
  } else if (estVal && estVal > 0) {
    const ratio = lienAmt / estVal;
    if      (ratio <= 0.15) dBreakdown.lien_amount = 5;
    else if (ratio <= 0.30) dBreakdown.lien_amount = 2;
    else                    dBreakdown.lien_amount = 0;
  } else {
    dBreakdown.lien_amount = 0;
  }

  // est_remaining_loan_balance — 7 pts
  const remainingLoan = num(cf, ids.est_remaining_loan_balance);
  if      (remainingLoan === null || remainingLoan <  50000) dBreakdown.est_remaining_loan_balance = 7;
  else if (remainingLoan < 150000)                           dBreakdown.est_remaining_loan_balance = 5;
  else if (remainingLoan < 300000)                           dBreakdown.est_remaining_loan_balance = 2;
  else                                                       dBreakdown.est_remaining_loan_balance = 0;

  // MLS modifier (applied after raw sum, before floor/cap)
  const mlsStatus = str(cf, ids.mls_status).toLowerCase();
  let mlsMod = 0;
  if (mlsStatus === "active") {
    mlsMod = MLS_ACTIVE_MODIFIER;
  } else if (["cancelled", "expired", "withdrawn", "fail", "removed"].includes(mlsStatus)) {
    mlsMod = MLS_EXPIRED_MODIFIER;
  }
  dBreakdown.mls_modifier = mlsMod;

  const dBase = Object.entries(dBreakdown)
    .filter(([k]) => k !== "mls_modifier")
    .reduce((a, [, v]) => a + v, 0);
  const dealScore = Math.min(100, Math.max(0, dBase + mlsMod));

  // ── STEP 4: Combined Score ───────────────────────────────────────────────
  const combinedScore =
    motivationScore === 0 || dealScore === 0
      ? 0
      : Math.round(Math.pow(motivationScore, 0.4) * Math.pow(dealScore, 0.6));

  return {
    motivationScore,
    dealScore,
    combinedScore,
    suppressed: !hasViableChannel,
    suppressReason: !hasViableChannel ? "no viable contact channel" : undefined,
    breakdown: { motivation: mBreakdown, deal: dBreakdown },
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, body: "Method Not Allowed" };

  let data: any = {};
  try {
    data = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const contactId: string =
    data.contactId ?? data.contact_id ?? data.id ?? data.data?.contactId ?? "";

  if (!contactId) return { statusCode: 400, body: "Missing contactId" };

  try {
    const fieldIdMap = await fetchFieldIdMap();

    const ids = {
      phone_type:                 fieldIdMap.phone_type                  ?? "",
      phone_1_dnc:                fieldIdMap.phone_1_dnc                 ?? "",
      litigator:                  fieldIdMap.litigator                   ?? "",
      owner_occupied:             fieldIdMap.owner_occupied              ?? "",
      foreclosure_factor:         fieldIdMap.foreclosure_factor          ?? "",
      total_condition:            fieldIdMap.total_condition             ?? "",
      est_equity:                 fieldIdMap.est_equity                  ?? "",
      est_ltv:                    fieldIdMap.est_ltv                     ?? "",
      effective_year_built:       fieldIdMap.effective_year_built        ?? "",
      lien_amount:                fieldIdMap.lien_amount                 ?? "",
      est_value:                  fieldIdMap.est_value                   ?? "",
      est_remaining_loan_balance: fieldIdMap.est_remaining_loan_balance  ?? "",
      mls_status:                 fieldIdMap.mls_status                  ?? "",
      motivation_score:           fieldIdMap.motivation_score            ?? "",
    };

    if (!ids.motivation_score) {
      throw new Error("motivation_score custom field not found in GHL");
    }

    const contact = await fetchContact(contactId);
    const cf: any[] = contact?.customFields ?? [];

    const result = computeScores(contact, cf, ids);

    console.log(
      `[motivation-score] contact=${contactId}` +
      (result.suppressed
        ? ` SUPPRESSED (${result.suppressReason}) → motivation=0 deal=${result.dealScore} combined=0`
        : ` motivation=${result.motivationScore} deal=${result.dealScore} combined=${result.combinedScore}`)
    );

    await writeScores(
      contactId,
      ids.motivation_score,
      result.motivationScore,
      result.dealScore,
      result.combinedScore,
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        contactId,
        motivationScore: result.motivationScore,
        dealScore:       result.dealScore,
        combinedScore:   result.combinedScore,
        suppressed:      result.suppressed,
        suppressReason:  result.suppressReason,
        breakdown:       result.breakdown,
      }),
    };

  } catch (err) {
    console.error("[motivation-score] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
