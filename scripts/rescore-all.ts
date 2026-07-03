/**
 * Fetches all contacts from GHL and re-scores each via the live endpoint.
 * Run: GHL_PRIVATE_API_KEY=pit-... npx tsx scripts/rescore-all.ts
 */

import { config } from "dotenv";
config();

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const SCORE_URL   = "https://investor-automation-os.netlify.app/.netlify/functions/motivation-score";
const TOKEN       = process.env.GHL_PRIVATE_API_KEY ?? "";
const DELAY_MS    = 250; // ~4 req/sec — stay safe

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ContactMeta { id: string; firstName: string; lastName: string; }

async function fetchAllIds(): Promise<ContactMeta[]> {
  const all: ContactMeta[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28" },
    });
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`GET /contacts → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.contacts ?? [];
    all.push(...batch.map((c: any) => ({ id: c.id, firstName: c.firstName ?? "", lastName: c.lastName ?? "" })));

    const meta = body.meta ?? {};
    if (!meta.startAfterId || batch.length < 100) break;
    startAfterId = meta.startAfterId;
    startAfter   = meta.startAfter;
    await delay(110);
  }

  return all;
}

async function score(contact: ContactMeta): Promise<any> {
  const res = await fetch(SCORE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId: contact.id }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}` };
  }
  return res.json();
}

(async () => {
  if (!TOKEN) { console.error("GHL_PRIVATE_API_KEY not set"); process.exit(1); }

  console.log("Fetching contacts from GHL...");
  const contacts = await fetchAllIds();
  console.log(`Found ${contacts.length} contacts. Re-scoring via live endpoint...\n`);

  const rows: Array<{
    name: string;
    motivation: number; deal: number; combined: number; completeness: number;
    bucketTag: string;
    suppressed: boolean; error?: string;
  }> = [];

  for (const c of contacts) {
    const res = await score(c);
    const name = `${c.firstName} ${c.lastName}`.trim() || c.id;
    if (res.error) {
      rows.push({ name, motivation: 0, deal: 0, combined: 0, completeness: 0, bucketTag: "?", suppressed: false, error: res.error });
      console.log(`  ✗ ${name}: ${res.error}`);
    } else {
      const row = {
        name,
        motivation:   res.motivationScore   ?? 0,
        deal:         res.dealScore         ?? 0,
        combined:     res.combinedScore     ?? 0,
        completeness: res.completenessScore ?? 0,
        bucketTag:    res.bucketTag         ?? "?",
        suppressed:   res.suppressed        ?? false,
      };
      rows.push(row);
      const sup = row.suppressed ? " [SUPP]" : "";
      console.log(
        `  ${name.padEnd(28)} M=${String(row.motivation).padStart(3)}  D=${String(row.deal).padStart(3)}  C=${String(row.combined).padStart(3)}  Comp=${String(row.completeness).padStart(3)}%  [${row.bucketTag.toUpperCase()}]${sup}`
      );
    }
    await delay(DELAY_MS);
  }

  console.log("\n── Summary ──────────────────────────────────────────────────────");
  const ok = rows.filter(r => !r.error);
  const suppressed = ok.filter(r => r.suppressed);
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const hot  = ok.filter(r => r.bucketTag === "hot").length;
  const warm = ok.filter(r => r.bucketTag === "warm").length;
  const low  = ok.filter(r => r.bucketTag === "low").length;
  console.log(`Contacts:    ${contacts.length} total, ${suppressed.length} suppressed`);
  console.log(`Bucket tags: hot=${hot}  warm=${warm}  low=${low}  (total tagged=${hot+warm+low})`);
  console.log(`Avg scores:  Motivation=${avg(ok.map(r => r.motivation))}  Deal=${avg(ok.map(r => r.deal))}  Combined=${avg(ok.map(r => r.combined))}  Completeness=${avg(ok.map(r => r.completeness))}%`);
  console.log(`Completeness range: min=${Math.min(...ok.map(r => r.completeness))}%  max=${Math.max(...ok.map(r => r.completeness))}%`);

  // Sort by completeness desc for final report
  const sorted = [...ok].sort((a, b) => b.completeness - a.completeness);
  console.log("\n── Top 10 by completeness ───────────────────────────────────────");
  sorted.slice(0, 10).forEach(r =>
    console.log(`  ${r.name.padEnd(28)} Comp=${r.completeness}%  C=${r.combined}`)
  );
  console.log("\n── Bottom 10 by completeness ────────────────────────────────────");
  sorted.slice(-10).reverse().forEach(r =>
    console.log(`  ${r.name.padEnd(28)} Comp=${r.completeness}%  C=${r.combined}`)
  );
})();
