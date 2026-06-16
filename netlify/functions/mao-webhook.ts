const GHL_BASE = "https://services.leadconnectorhq.com";

const FIELD_ID = {
  ARV:              "cBkygqcHRseZUGCYYeba",
  REPAIR:           "hId4Yog6u5GP1Iwz1aNx",
  WHOLESALE_FEE:    "RS2trZUHrZwaGxadLvHB",
  ASSIGNMENT_FEE:   "xwbPw1JVkgJevJTPNmxa",
  MAO:              "Atu5XCjpFElY8H64VG4h",
  CLOSING_COSTS:    "N8Aa9t1SZhU7XnPPzxWk",
  VIABILITY_FLAG:   "o87cyzuCyScbY72VrOmq",
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
const DEFAULT_CLOSING_COSTS = 2500;

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

function extractText(customFields: any[], id: string): string | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  if (!f) return null;
  const raw = f.fieldValue ?? f.value ?? f.fieldValueString ?? "";
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
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

async function fetchContact(contactId: string): Promise<any> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /contacts/${contactId} → ${res.status}: ${text}`);
  }
  const body = await res.json();
  return body.contact;
}

async function writeViabilityFlag(contactId: string, viability: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({
      customFields: [{ id: FIELD_ID.VIABILITY_FLAG, value: viability }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /contacts/${contactId} → ${res.status}: ${text}`);
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

  // contactId may be in the payload; if not we'll get it from the fetched opportunity
  const payloadContactId =
    payload.contactId ??
    payload.contact_id ??
    payload.data?.contactId;

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

    const arv           = extractNum(fields, FIELD_ID.ARV);
    const repair        = extractNum(fields, FIELD_ID.REPAIR);
    const assignmentFee = extractNum(fields, FIELD_ID.ASSIGNMENT_FEE);
    const currentMAO    = extractNum(fields, FIELD_ID.MAO);
    let wholesaleFee    = extractNum(fields, FIELD_ID.WHOLESALE_FEE);
    let closingCosts    = extractNum(fields, FIELD_ID.CLOSING_COSTS);

    if (wholesaleFee === null) wholesaleFee = DEFAULT_WHOLESALE_FEE;
    if (closingCosts === null) closingCosts = DEFAULT_CLOSING_COSTS;

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

    // Viability: deal is viable only when MAO exceeds closing costs + assignment fee
    const threshold = closingCosts + assignmentFee;
    const viability = mao > threshold ? "Viable" : "Not Viable";

    console.log(
      `[mao-webhook] ${opportunityId}: ` +
      `(${arv} × ${wholesaleFee}%) − ${repair} − ${assignmentFee} = ${mao} | ` +
      `threshold=${threshold} → ${viability}`
    );

    // --- Write MAO to Opportunity (loop-prevention: skip if unchanged) ---
    const maoUnchanged = currentMAO !== null && Math.abs(currentMAO - mao) < 0.01;
    if (!maoUnchanged) {
      await writeMAO(opportunityId, mao);
    }

    // --- Write viability flag to Contact ---
    const contactId = payloadContactId ?? opp?.contactId ?? opp?.contact_id;
    if (!contactId) {
      console.log(`[mao-webhook] No contactId for opportunity ${opportunityId}, skipping viability write`);
      return { statusCode: 200, body: `MAO=${mao} (no contactId for viability flag)` };
    }

    // Loop-prevention: fetch contact and compare current flag value
    const contact = await fetchContact(contactId);
    const contactFields: any[] = contact?.customFields ?? [];
    const currentFlag = extractText(contactFields, FIELD_ID.VIABILITY_FLAG);

    if (currentFlag === viability) {
      console.log(`[mao-webhook] Viability flag already "${viability}" for contact ${contactId}, skipping`);
    } else {
      await writeViabilityFlag(contactId, viability);
    }

    return { statusCode: 200, body: `MAO=${mao} viability=${viability}` };

  } catch (err) {
    console.error("[mao-webhook] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
