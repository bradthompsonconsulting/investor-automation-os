const GHL_BASE = "https://services.leadconnectorhq.com";

const FIELD_ID = {
  ARV:            "cBkygqcHRseZUGCYYeba",
  REPAIR:         "hId4Yog6u5GP1Iwz1aNx",
  WHOLESALE_FEE:  "RS2trZUHrZwaGxadLvHB",
  ASSIGNMENT_FEE: "xwbPw1JVkgJevJTPNmxa",
  MAO:            "Atu5XCjpFElY8H64VG4h",
  CLOSING_COSTS:  "N8Aa9t1SZhU7XnPPzxWk",
} as const;

// Fields whose changes should trigger a recalculation.
// Writing to MAO is intentionally excluded so we don't loop.
const INPUT_FIELD_IDS = new Set([
  FIELD_ID.ARV,
  FIELD_ID.REPAIR,
  FIELD_ID.WHOLESALE_FEE,
  FIELD_ID.ASSIGNMENT_FEE,
]);

const DEFAULT_WHOLESALE_FEE = 70;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

function extractNum(customFields: any[], id: string): number | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  if (!f) return null;
  // GHL returns numeric values under different keys depending on API version
  const raw = f.fieldValue ?? f.value ?? f.fieldValueString ?? "";
  const n = parseFloat(String(raw));
  return !isNaN(n) && n !== 0 ? n : null;
}

async function fetchOpportunity(id: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}/opportunities/${id}`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /opportunities/${id} → ${res.status}: ${text}`);
  }
  const body = await res.json();
  return body.opportunity;
}

async function writeMAO(opportunityId: string, mao: number): Promise<void> {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({
      customFields: [{ id: FIELD_ID.MAO, field_value: mao }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /opportunities/${opportunityId} → ${res.status}: ${text}`);
  }
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload: any = {};
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // GHL OpportunityUpdate payloads vary — normalise to opportunity ID
  const opportunityId =
    payload.id ??
    payload.objectId ??
    payload.opportunityId ??
    payload.data?.id;

  if (!opportunityId) {
    console.log("[mao-webhook] No opportunity ID found in payload");
    return { statusCode: 200, body: "no-op: no opportunity ID" };
  }

  // Primary loop-breaker: if GHL tells us which field changed and it isn't
  // one of the four input fields (e.g. it's the MAO field we just wrote),
  // bail immediately before making any API calls.
  const changedField =
    payload.customFieldId ?? payload.fieldId ?? payload.changedField;
  if (changedField && !INPUT_FIELD_IDS.has(changedField)) {
    console.log(`[mao-webhook] Non-input field changed (${changedField}), skipping`);
    return { statusCode: 200, body: "no-op: non-input field" };
  }

  try {
    const opp = await fetchOpportunity(opportunityId);
    const fields: any[] = opp?.customFields ?? [];

    const arv          = extractNum(fields, FIELD_ID.ARV);
    const repair       = extractNum(fields, FIELD_ID.REPAIR);
    const assignmentFee = extractNum(fields, FIELD_ID.ASSIGNMENT_FEE);
    const currentMAO   = extractNum(fields, FIELD_ID.MAO);
    let wholesaleFee   = extractNum(fields, FIELD_ID.WHOLESALE_FEE);

    // Only default wholesale fee when the field is genuinely empty — never
    // overwrite an intentionally set value
    if (wholesaleFee === null) {
      wholesaleFee = DEFAULT_WHOLESALE_FEE;
    }

    // All three required inputs must be present and non-zero to calculate
    if (arv === null || repair === null || assignmentFee === null) {
      console.log(
        `[mao-webhook] Skipping ${opportunityId}: missing required fields`,
        { arv, repair, assignmentFee }
      );
      return { statusCode: 200, body: "no-op: missing required input fields" };
    }

    // MAO = (ARV × Wholesale Fee %) − Repair Estimate − Assignment Fee Target
    // Negative results are valid (non-viable deal) — write as-is
    const mao = (arv * wholesaleFee) / 100 - repair - assignmentFee;

    // Secondary loop-breaker: skip the write if the value hasn't changed.
    // Handles GHL payloads that don't report which field changed.
    if (currentMAO !== null && Math.abs(currentMAO - mao) < 0.01) {
      console.log(`[mao-webhook] MAO already ${mao} for ${opportunityId}, skipping write`);
      return { statusCode: 200, body: "no-op: MAO unchanged" };
    }

    console.log(
      `[mao-webhook] ${opportunityId}: ` +
      `(${arv} × ${wholesaleFee}%) − ${repair} − ${assignmentFee} = ${mao}`
    );

    await writeMAO(opportunityId, mao);
    return { statusCode: 200, body: `MAO written: ${mao}` };

  } catch (err) {
    console.error("[mao-webhook] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
