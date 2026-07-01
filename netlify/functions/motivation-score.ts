/**
 * Motivation Score — Netlify function.
 *
 * Triggered by GHL workflow webhook after contact import.
 * Reads contact custom fields, computes a 0-100 motivation score,
 * and writes the result to the motivation_score custom field.
 *
 * POST body: { contactId: string }
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

// MLS modifier constants (within spec ranges: Active −30–35, Expired +10–15)
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /customFields → ${res.status}: ${text}`);
  }
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /contacts/${contactId} → ${res.status}: ${text}`);
  }
  const body: any = await res.json();
  return body.contact;
}

async function writeScore(contactId: string, score: number, fieldId: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({
      customFields: [{ id: fieldId, field_value: score }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /contacts/${contactId} → ${res.status}: ${text}`);
  }
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

// ── Scoring logic ─────────────────────────────────────────────────────────────

interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
  suppressed: boolean;
  suppressReason?: string;
}

function computeScore(cf: any[], ids: Record<string, string>): ScoreResult {
  // ── STEP 1: Suppression gate ─────────────────────────────────────────────
  // phone_1_dnc: any non-empty value other than "No" means suppressed.
  // PropStream exports "Public DNC" (not "Yes"), so we check for presence.
  const phoneDnc  = str(cf, ids.phone_1_dnc);
  const litigator = str(cf, ids.litigator);

  if (phoneDnc && phoneDnc.toLowerCase() !== "no") {
    return { score: 0, breakdown: {}, suppressed: true, suppressReason: `phone_1_dnc="${phoneDnc}"` };
  }
  if (litigator) {
    return { score: 0, breakdown: {}, suppressed: true, suppressReason: `litigator="${litigator}"` };
  }

  // ── STEP 2: Base score ───────────────────────────────────────────────────
  const breakdown: Record<string, number> = {};

  // est_ltv — 25 pts
  const ltv = num(cf, ids.est_ltv);
  let ltvPts = 0;
  if (ltv !== null) {
    if      (ltv <= 20) ltvPts = 25;
    else if (ltv <= 40) ltvPts = 19;
    else if (ltv <= 60) ltvPts = 13;
    else if (ltv <= 80) ltvPts =  6;
    // 81%+ → 0
  }
  breakdown.est_ltv = ltvPts;

  // est_equity — 15 pts
  const equity = num(cf, ids.est_equity);
  let equityPts = 0;
  if (equity !== null) {
    if      (equity >= 150000) equityPts = 15;
    else if (equity >= 100000) equityPts = 11;
    else if (equity >=  50000) equityPts =  7;
    else if (equity >=  20000) equityPts =  3;
    // <$20k → 0
  }
  breakdown.est_equity = equityPts;

  // owner_occupied — 25 pts (absentee owner = motivated)
  const ownerOccupied = str(cf, ids.owner_occupied).toLowerCase();
  const ownerPts = ownerOccupied === "no" ? 25 : 0;
  breakdown.owner_occupied = ownerPts;

  // foreclosure_factor — 20 pts (TEXT label from PropStream)
  const foreclosure = str(cf, ids.foreclosure_factor).toLowerCase();
  const foreclosureScale: Record<string, number> = {
    "very low":   0,
    "low":        3,
    "medium low": 7,
    "medium":    10,
    "medium high": 13,
    "high":      17,
    "very high": 20,
  };
  breakdown.foreclosure_factor = foreclosureScale[foreclosure] ?? 0;

  // total_condition — 7 pts (worse condition = higher score)
  const conditionRaw = str(cf, ids.total_condition);
  const condition    = conditionRaw.toLowerCase();
  const conditionScale: Record<string, number> = {
    "poor":      7,
    "fair":      6,
    "average":   4,
    "good":      2,
    "very good": 1,
    "excellent": 0,
  };
  let conditionPts = 0;
  if (condition) {
    if (condition in conditionScale) {
      conditionPts = conditionScale[condition];
    } else {
      // Unmapped non-empty label → default Average (4 pts) and log for triage
      console.warn(`[motivation-score] Unmapped total_condition value: "${conditionRaw}" — defaulting to Average (4 pts)`);
      conditionPts = 4;
    }
  }
  breakdown.total_condition = conditionPts;

  // effective_year_built — 4 pts
  const yearBuilt = num(cf, ids.effective_year_built);
  let yearPts = 0;
  if (yearBuilt !== null) {
    if      (yearBuilt >= 2000) yearPts = 4;
    else if (yearBuilt >= 1975) yearPts = 3;
    else if (yearBuilt >= 1950) yearPts = 2;
    else                        yearPts = 1; // pre-1949
  }
  breakdown.effective_year_built = yearPts;

  // lien_amount — 2 pts (ratio of lien to est_value)
  const lienAmt = num(cf, ids.lien_amount);
  const estVal  = num(cf, ids.est_value);
  let lienPts = 0;
  if (lienAmt && lienAmt > 0 && estVal && estVal > 0) {
    lienPts = (lienAmt / estVal) >= 0.26 ? 2 : 1;
  }
  breakdown.lien_amount = lienPts;

  // phone_type — 2 pts
  const phoneType = str(cf, ids.phone_type).toLowerCase();
  breakdown.phone_type = phoneType === "mobile" ? 2 : 0;

  const baseScore = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // ── STEP 3: MLS modifier (outside the 99-pt pool) ────────────────────────
  const mlsStatus = str(cf, ids.mls_status).toLowerCase();
  let mlsMod = 0;
  if (mlsStatus === "active") {
    mlsMod = MLS_ACTIVE_MODIFIER;
  } else if (["cancelled", "expired", "withdrawn", "fail", "removed"].includes(mlsStatus)) {
    mlsMod = MLS_EXPIRED_MODIFIER;
  }
  breakdown.mls_modifier = mlsMod;

  // ── STEP 4: Floor / ceiling ───────────────────────────────────────────────
  const score = Math.min(100, Math.max(0, baseScore + mlsMod));

  return { score, breakdown, suppressed: false };
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

  // GHL webhooks surface contactId under several key names
  const contactId: string =
    data.contactId ?? data.contact_id ?? data.id ?? data.data?.contactId ?? "";

  if (!contactId) {
    return { statusCode: 400, body: "Missing contactId" };
  }

  try {
    // 1. Resolve custom field IDs
    const fieldIdMap = await fetchFieldIdMap();

    // Fields needed for scoring + writing the result
    const ids = {
      phone_1_dnc:          fieldIdMap.phone_1_dnc          ?? "",
      litigator:            fieldIdMap.litigator             ?? "",
      est_ltv:              fieldIdMap.est_ltv               ?? "",
      est_equity:           fieldIdMap.est_equity            ?? "",
      owner_occupied:       fieldIdMap.owner_occupied        ?? "",
      foreclosure_factor:   fieldIdMap.foreclosure_factor    ?? "",
      total_condition:      fieldIdMap.total_condition       ?? "",
      effective_year_built: fieldIdMap.effective_year_built  ?? "",
      lien_amount:          fieldIdMap.lien_amount           ?? "",
      est_value:            fieldIdMap.est_value             ?? "",
      phone_type:           fieldIdMap.phone_type            ?? "",
      mls_status:           fieldIdMap.mls_status            ?? "",
      motivation_score:     fieldIdMap.motivation_score      ?? "",
    };

    if (!ids.motivation_score) {
      throw new Error("motivation_score custom field not found in GHL — was it created?");
    }

    // 2. Fetch contact
    const contact = await fetchContact(contactId);
    const cf: any[] = contact?.customFields ?? [];

    // 3. Compute score
    const result = computeScore(cf, ids);

    console.log(
      `[motivation-score] contact=${contactId}` +
      (result.suppressed
        ? ` SUPPRESSED (${result.suppressReason}) → score=0`
        : ` score=${result.score} breakdown=${JSON.stringify(result.breakdown)}`)
    );

    // 4. Write result
    await writeScore(contactId, result.score, ids.motivation_score);

    return {
      statusCode: 200,
      body: JSON.stringify({
        contactId,
        score: result.score,
        suppressed: result.suppressed,
        suppressReason: result.suppressReason,
        breakdown: result.breakdown,
      }),
    };

  } catch (err) {
    console.error("[motivation-score] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
