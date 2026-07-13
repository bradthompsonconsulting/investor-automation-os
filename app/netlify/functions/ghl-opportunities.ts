/**
 * GHL Opportunities — server-side function. Holds GHL_API_TOKEN.
 *
 * GET /.netlify/functions/ghl-opportunities
 * Returns every opportunity in the Seller Leads Pipeline, paged server-side,
 * plus the pipeline's stage list (id/name/position) for the "Move to" control.
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

// Seller Leads Pipeline — confirmed via GET /opportunities/pipelines
const PIPELINE_ID = "GpUWK4YlhNqBzm5Hrm58";

// Stages — hardcoded, confirmed via GET /opportunities/pipelines. Order is authoritative.
const STAGES = [
  { id: "0f0511af-2e59-49c9-a141-12a7f1c78914", name: "New Lead - Seller",     position: 0 },
  { id: "c7d1e692-8d9f-4527-a756-724e468800e7", name: "Contact Initiated",     position: 1 },
  { id: "5b6634e6-098f-453e-b08e-09c78af682a7", name: "Seller Call Booked",    position: 2 },
  { id: "02992967-3b10-4ae6-ae89-81daf622fc59", name: "No Show",               position: 3 },
  { id: "3ac16587-0db8-48ca-9ec0-536e67db9963", name: "Seller Call Completed", position: 4 },
  { id: "71227a30-2303-4165-aa58-e56860146959", name: "Seller Follow-Up",      position: 5 },
  { id: "a0f01076-5019-4abc-b809-7f4b0218dd35", name: "Seller Offer Sent",     position: 6 },
  { id: "0c45ee3d-7be7-4651-97a4-6df53f53481b", name: "Seller Closed-Won",     position: 7 },
  { id: "a7436df7-e05a-4bf0-bd29-70f7066ec0bd", name: "Long-Term Nurture",     position: 8 },
  { id: "f1960b50-8aa2-4a69-ba58-a7a0dc66ce82", name: "Lost / Not Interested", position: 9 },
];

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchAllOpportunities(token: string): Promise<any[]> {
  const all: any[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ location_id: LOCATION_ID, pipeline_id: PIPELINE_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/opportunities/search?${params}`, { headers: headers(token) });
    const body = await res.json();

    if (!res.ok) throw new Error(`GET /opportunities/search → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.opportunities ?? [];
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

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_API_TOKEN not configured" }) };
  }

  try {
    const raw = await fetchAllOpportunities(token);

    const opportunities = raw.map((o: any) => ({
      id:              o.id,
      contactId:       o.contactId ?? "",
      contactName:     o.contact?.name ?? o.name ?? "",
      opportunityName: o.name ?? "",
      phone:           o.contact?.phone ?? "",
      email:           o.contact?.email ?? "",
      stageId:         o.pipelineStageId ?? "",
      customFields:    o.customFields ?? [],
    }));

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineId: PIPELINE_ID, stages: STAGES, opportunities }),
    };
  } catch (err: any) {
    console.error("[ghl-opportunities]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
