const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

const PIPELINE_ID = "GpUWK4YlhNqBzm5Hrm58";
const STAGE_ID = "0f0511af-2e59-49c9-a141-12a7f1c78914"; // New Lead - Seller

const FIELD_ID = {
  ARV:              "cBkygqcHRseZUGCYYeba",
  REPAIR:           "hId4Yog6u5GP1Iwz1aNx",
  ASKING_PRICE:     "YxCDaX7dLhBJL9GLGFpJ",
  CLOSING_COSTS:    "N8Aa9t1SZhU7XnPPzxWk",
  ASSIGNMENT_FEE:   "xwbPw1JVkgJevJTPNmxa",
  MAO:              "Atu5XCjpFElY8H64VG4h",
  WHOLESALE_FEE:    "RS2trZUHrZwaGxadLvHB",
  HOLD_MONTHS:      "Ju1U6ROdDNnCFlsn4eeS",
  CARRYING_COST:    "FhcyP63sSAtWInl4Q4iI",
  LOAN_AMOUNT:      "3ZlSKldh0jR2MWhjOmHe",
  INTEREST_RATE:    "i1mVFCwHIySFFzR1hVfQ",
  REPAIR_LINE_ITEMS:"IwVPbXc9dKUzWGpe4NPx",
} as const;

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

function num(v: any): number | null {
  const n = parseFloat(String(v ?? ""));
  return isNaN(n) ? null : n;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

function formatRepairLineItems(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((item, i) => {
      const cat = item.category ?? "";
      const desc = item.description ?? "";
      const amt = item.amount != null ? `$${Number(item.amount).toLocaleString()}` : "";
      return `${i + 1}. [${cat}] ${desc} ${amt}`.trim();
    })
    .join("\n");
}

async function findContact(query: string): Promise<string | null> {
  const url = `${GHL_BASE}/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return body.contacts?.[0]?.id ?? null;
}

async function createContact(payload: any): Promise<string> {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({ ...payload, locationId: LOCATION_ID }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /contacts/ → ${res.status}: ${text}`);
  }
  const body = await res.json();
  return body.contact.id;
}

async function createOpportunity(payload: any): Promise<string> {
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /opportunities/ → ${res.status}: ${text}`);
  }
  const body = await res.json();
  return body.opportunity?.id ?? body.id;
}

export const handler = async (event: any) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let data: any = {};
  try {
    data = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: "Invalid JSON" };
  }

  try {
    // ── 1. Resolve or create contact ──────────────────────────────────────
    const { firstName, lastName } = splitName(data.seller_name ?? "");
    const phone: string = (data.seller_phone ?? "").trim();
    const email: string = (data.seller_email ?? "").trim();

    let contactId: string | null = null;

    // Search by phone first, then email
    if (phone) contactId = await findContact(phone);
    if (!contactId && email) contactId = await findContact(email);

    if (contactId) {
      console.log(`[deal-submit] Found existing contact ${contactId}`);
    } else {
      const contactPayload: any = { firstName, lastName };
      if (phone) contactPayload.phone = phone;
      if (email) contactPayload.email = email;
      if (data.property_address) contactPayload.address1 = data.property_address;
      if (data.lead_source) contactPayload.source = data.lead_source;
      contactId = await createContact(contactPayload);
      console.log(`[deal-submit] Created contact ${contactId}`);
    }

    // ── 2. Build opportunity custom fields ────────────────────────────────
    const customFields: { id: string; field_value: any }[] = [];

    const fieldMap: [string, any][] = [
      [FIELD_ID.ARV,               num(data.arv)],
      [FIELD_ID.REPAIR,            num(data.repair_estimate)],
      [FIELD_ID.ASKING_PRICE,      num(data.asking_price)],
      [FIELD_ID.CLOSING_COSTS,     num(data.closing_costs)],
      [FIELD_ID.ASSIGNMENT_FEE,    num(data.assignment_fee)],
      [FIELD_ID.MAO,               num(data.mao)],
      [FIELD_ID.WHOLESALE_FEE,     num(data.wholesale_fee_pct)],
      [FIELD_ID.HOLD_MONTHS,       num(data.hold_months)],
      [FIELD_ID.CARRYING_COST,     num(data.carrying_cost)],
      [FIELD_ID.LOAN_AMOUNT,       num(data.loan_amount)],
      [FIELD_ID.INTEREST_RATE,     num(data.interest_rate)],
    ];

    for (const [id, value] of fieldMap) {
      if (value !== null) customFields.push({ id, field_value: value });
    }

    const repairText = formatRepairLineItems(data.repair_line_items);
    if (repairText) {
      customFields.push({ id: FIELD_ID.REPAIR_LINE_ITEMS, field_value: repairText });
    }

    // ── 3. Create opportunity ─────────────────────────────────────────────
    const oppName = [data.seller_name, data.property_address]
      .filter(Boolean)
      .join(" — ");

    const oppPayload: any = {
      locationId: LOCATION_ID,
      pipelineId: PIPELINE_ID,
      pipelineStageId: STAGE_ID,
      contactId,
      name: oppName || "New Seller Lead",
      status: "open",
      customFields,
    };

    if (num(data.asking_price) !== null) {
      oppPayload.monetaryValue = num(data.asking_price);
    }

    if (data.notes) {
      oppPayload.notes = data.notes;
    }

    const opportunityId = await createOpportunity(oppPayload);
    console.log(`[deal-submit] Created opportunity ${opportunityId} for contact ${contactId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ opportunityId, contactId }),
    };

  } catch (err) {
    console.error("[deal-submit] Error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: String(err),
    };
  }
};
