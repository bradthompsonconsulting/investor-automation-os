/**
 * GHL Contacts — server-side function. Holds GHL_API_TOKEN.
 *
 * GET /.netlify/functions/ghl-contacts
 * Returns all contacts in the location with their three score fields,
 * paging through the GHL API server-side so the client gets one flat array.
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

// Score field IDs — hardcoded (confirmed via /locations/.../customFields)
const SCORE_IDS = {
  motivation_score:        "8vH9yq10xeYVVMHXbS0C",
  deal_score:              "cfkm0kb9CLvjZgyrcIFz",
  combined_score:          "9SVnuzznYsZOQQazpxld",
  data_completeness_score: "r9sD1rlTIqhOx9Mhvftt",
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function cfValue(customFields: any[], id: string): number | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  const raw = f?.value ?? f?.fieldValue ?? null;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return isNaN(n) ? null : n;
}

async function fetchAllContacts(token: string): Promise<any[]> {
  const all: any[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, { headers: headers(token) });
    const body = await res.json();

    if (!res.ok) throw new Error(`GET /contacts → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.contacts ?? [];
    all.push(...batch);

    const meta = body.meta ?? {};
    if (!meta.startAfterId || batch.length < 100) break;
    startAfterId = meta.startAfterId;
    startAfter   = meta.startAfter;
    await delay(110); // stay under 10 req/sec
  }

  return all;
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_API_TOKEN not configured" }) };
  }

  try {
    const raw = await fetchAllContacts(token);

    const contacts = raw.map((c: any) => {
      const cf: any[] = c.customFields ?? [];
      return {
        id:              c.id,
        firstName:       c.firstName ?? "",
        lastName:        c.lastName  ?? "",
        phone:           c.phone     ?? "",
        email:           c.email     ?? "",
        dateAdded:       c.dateAdded ?? null,
        motivationScore:    cfValue(cf, SCORE_IDS.motivation_score),
        dealScore:          cfValue(cf, SCORE_IDS.deal_score),
        combinedScore:      cfValue(cf, SCORE_IDS.combined_score),
        completenessScore:  cfValue(cf, SCORE_IDS.data_completeness_score),
      };
    });

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(contacts),
    };
  } catch (err: any) {
    console.error("[ghl-contacts]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
