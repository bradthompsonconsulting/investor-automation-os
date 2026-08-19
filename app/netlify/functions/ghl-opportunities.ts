/**
 * GHL Opportunities — server-side function. Requires GHL_PRIVATE_API_KEY; no fallback.
 *
 * GET /.netlify/functions/ghl-opportunities
 * Returns every opportunity in the Seller Leads Pipeline, paged server-side,
 * plus the pipeline's stage list (id/name/position) for the "Move to" control.
 */

import { getConfig } from "../../shared/ghl-config";

const GHL_BASE    = "https://services.leadconnectorhq.com";
// PB-D51 — location, pipeline and stage ids all resolve once at module scope
// from the shared config. Gate 4B-2 reversed PB-D51's original exclusion of
// pipeline and stage UUIDs: a stage id is exactly as environment-bound as a
// field id, and leaving them here meant a populated TEST map would still have
// resolved production stages.
const CONFIG      = getConfig(process.env.IAOS_ENV);
const LOCATION_ID = CONFIG.locationId;
const PIPELINE_ID = CONFIG.pipelines.sellerLeads;

// Names and positions stay here deliberately — they are display metadata, not
// environment-bound identifiers. ORDER IS AUTHORITATIVE.
const STAGES = [
  { id: CONFIG.stages.newLeadSeller,       name: "New Lead - Seller",     position: 0 },
  { id: CONFIG.stages.contactInitiated,    name: "Contact Initiated",     position: 1 },
  { id: CONFIG.stages.sellerCallBooked,    name: "Seller Call Booked",    position: 2 },
  { id: CONFIG.stages.noShow,              name: "No Show",               position: 3 },
  { id: CONFIG.stages.sellerCallCompleted, name: "Seller Call Completed", position: 4 },
  { id: CONFIG.stages.sellerFollowUp,      name: "Seller Follow-Up",      position: 5 },
  { id: CONFIG.stages.sellerOfferSent,     name: "Seller Offer Sent",     position: 6 },
  { id: CONFIG.stages.sellerClosedWon,     name: "Seller Closed-Won",     position: 7 },
  { id: CONFIG.stages.longTermNurture,     name: "Long-Term Nurture",     position: 8 },
  { id: CONFIG.stages.lostNotInterested,   name: "Lost / Not Interested", position: 9 },
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

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
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
