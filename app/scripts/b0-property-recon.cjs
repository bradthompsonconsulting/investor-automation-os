/* READ-ONLY. This script performs NO writes — no PUT, POST, PATCH, or DELETE.
   Three GETs only: location custom-fields schema, and singular contact GET on
   two fixtures. Safe to re-run at any time. */
/* B0 — read-only recon for Phase B (docs/PHASE_B_SPEC.md §10.6). THREE GETs via the
   deployed ghl-proxy. NO PUT/POST/write of any kind. Property roster is read from the
   config file (app/src/config/additionalInfoSubgroups.ts), never guessed. A CONFIG
   SANITY CHECK runs first (pre-network); LIVE ASSERTIONS then resolve the roster against
   the wire schema; nothing is printed as a table unless all live assertions pass. */
const fs = require("fs");
const path = require("path");

const ORIGIN  = "https://app.investorautomationos.com";
const LOC     = "jmHG4B8RdzwpfqruNf68";
const NEELIMA = "FiIT0hUaxVCIuokQpZuc"; // harness display fixture
const BRADT75 = "9fbH2VCcZvzVNhsR9zjc"; // inert-proof write fixture (read only here)

// Literal /contacts + /locations path; no nested ?&= to encode; NO --data-urlencode.
const PROXY = (p) => `${ORIGIN}/.netlify/functions/ghl-proxy?path=${p}`;

async function getJson(url, label) {
  let resp;
  try { resp = await fetch(url, { headers: { "Cache-Control": "no-cache" } }); }
  catch (e) { throw new Error(`${label}: fetch threw — ${e.message}`); }
  const status = resp.status;
  let body;
  try { body = await resp.json(); }
  catch (e) { throw new Error(`${label}: non-JSON body (HTTP ${status})`); }
  if (status !== 200) throw new Error(`${label}: HTTP ${status} — ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

(async () => {
  // ── Roster from the config file (do not guess) ──
  const cfgPath = path.join(__dirname, "../src/config/additionalInfoSubgroups.ts");
  const cfgText = fs.readFileSync(cfgPath, "utf8");
  const propertyKeys = [...cfgText.matchAll(/"(contact\.[a-z0-9_]+)":\s*"Property"/g)].map((m) => m[1]);
  const propertySet  = new Set(propertyKeys);
  const aiRosterKeys = new Set(
    [...cfgText.matchAll(/"(contact\.[a-z0-9_]+)":\s*"(Reachability|Property|Investor|System)"/g)].map((m) => m[1]),
  );

  // ── CONFIG SANITY CHECK (pre-network; passes even if every network call fails) ──
  const cfgFail = [];
  if (propertyKeys.length !== 30) cfgFail.push(`Property roster in config = ${propertyKeys.length}, expected 30`);
  if (aiRosterKeys.size   !== 73) cfgFail.push(`Additional Info roster in config = ${aiRosterKeys.size}, expected 73`);
  if (cfgFail.length) {
    console.log("CONFIG SANITY CHECK FAILED (pre-network) — STOPPED:");
    cfgFail.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log(`CONFIG SANITY CHECK PASS: Property roster = ${propertyKeys.length}, Additional Info roster = ${aiRosterKeys.size}`);

  // ── (1) live schema ──
  const schema = await getJson(PROXY(`/locations/${LOC}/customFields`), "schema");
  const defs = Array.isArray(schema.customFields) ? schema.customFields : null;
  if (!defs) throw new Error("schema: customFields not an array");

  // ── LIVE ASSERTIONS against the RESOLVED set ──
  const byKey = (k) => defs.filter((d) => d.fieldKey === k);
  const unresolved = propertyKeys.filter((k) => byKey(k).length === 0);
  const ambiguous  = propertyKeys.filter((k) => byKey(k).length > 1);
  const propertyDefs = defs.filter((d) => propertySet.has(d.fieldKey));

  // folder-level (replaces the vacuous orphan check) — parentId observed from the wire.
  const propParentIds = [...new Set(propertyDefs.map((d) => d.parentId))];
  const aiParent = propParentIds.length === 1 ? propParentIds[0] : null;
  const aiDefs   = aiParent ? defs.filter((d) => d.parentId === aiParent) : [];
  const aiOrphans = aiDefs.filter((d) => !aiRosterKeys.has(d.fieldKey)).map((d) => d.fieldKey);

  const fail = [];
  if (propertyDefs.length !== 30) fail.push(`(a) live-resolved Property count = ${propertyDefs.length}, expected 30`);
  if (unresolved.length)          fail.push(`(b) config keys with ZERO live defs [config→schema unresolved]: ${JSON.stringify(unresolved)}`);
  if (ambiguous.length)           fail.push(`(b) config keys with >1 live def [ambiguous]: ${JSON.stringify(ambiguous)}`);
  if (propParentIds.length !== 1) fail.push(`(c) 30 Property defs span ${propParentIds.length} distinct parentIds: ${JSON.stringify(propParentIds)}`);
  if (aiParent && aiDefs.length !== 73) fail.push(`(c) Additional Info folder (parentId ${aiParent}) carries ${aiDefs.length} defs, expected 73`);
  if (aiOrphans.length)           fail.push(`(c) AI-folder wire fields absent from config roster [real orphans]: ${JSON.stringify(aiOrphans)}`);
  if (fail.length) {
    console.log("LIVE ASSERTION FAILURE — table NOT printed, recon STOPPED:");
    fail.forEach((f) => console.log("  " + f));
    process.exit(2);
  }

  // ── (2)(3) contacts ──
  const neeBody  = await getJson(PROXY(`/contacts/${NEELIMA}`), "Neelima GET");
  const bradBody = await getJson(PROXY(`/contacts/${BRADT75}`), "bradt75 GET");
  const neeC  = neeBody.contact  || neeBody;
  const bradC = bradBody.contact || bradBody;
  const neeMap  = new Map((Array.isArray(neeC.customFields)  ? neeC.customFields  : []).map((f) => [f.id, f.value]));
  const bradMap = new Map((Array.isArray(bradC.customFields) ? bradC.customFields : []).map((f) => [f.id, f.value]));

  // ── observed schema shape ──
  const defByKey = new Map(defs.map((d) => [d.fieldKey, d]));
  const firstDef = defByKey.get(propertyKeys[0]);
  const propUnionKeys   = [...new Set(propertyDefs.flatMap((d) => Object.keys(d)))];
  const schemaUnionKeys = [...new Set(defs.flatMap((d) => Object.keys(d)))];
  const optKeyProp   = propUnionKeys.find((k) => /picklist|option/i.test(k)) || null;
  const optKeySchema = schemaUnionKeys.find((k) => /picklist|option/i.test(k)) || null;

  console.log("LIVE ASSERTIONS PASS: (a) 30 resolved  (b) 0 unresolved / 0 ambiguous  (c) 1 parentId, folder=73, 0 orphans");
  console.log(`OBSERVED Additional Info parentId (from wire, not a constant): ${aiParent}  — folder def count = ${aiDefs.length}`);
  console.log("SCHEMA MEMBERSHIP: folder EXPOSED via parentId (above); subgroup NOT exposed by schema — \"Property\" is config-derived only.");
  console.log(`TOP-LEVEL KEYS on first resolved Property def (${firstDef.fieldKey}): ${JSON.stringify(Object.keys(firstDef))}`);
  console.log(`picklist-options key on Property defs: ${optKeyProp || "NONE"}   |   anywhere in schema: ${optKeySchema || "NONE"}`);
  console.log("");

  // ── table (config/position order) ──
  const fmt = (v) => (v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
  const pickCell = (d) => {
    if (optKeyProp) return (optKeyProp in d) ? JSON.stringify(d[optKeyProp]) : `(no ${optKeyProp} on this def)`;
    return optKeySchema
      ? `n/a (Property defs carry no options key; schema uses '${optKeySchema}' for picklist types)`
      : "n/a (schema exposes no options key at all)";
  };
  console.log("id | name | fieldKey | dataType | picklistOptions | Neelima | bradt75");
  for (const key of propertyKeys) {
    const d = defByKey.get(key);
    const nee  = neeMap.has(d.id)  ? `Y=${fmt(neeMap.get(d.id))}`   : "N (unpopulated)";
    const brad = bradMap.has(d.id) ? `Y=${fmt(bradMap.get(d.id))}` : "N (unpopulated)";
    console.log(`${d.id} | ${d.name} | ${d.fieldKey} | ${d.dataType} | ${pickCell(d)} | ${nee} | ${brad}`);
  }
})().catch((e) => { console.error("RECON ERROR:", e.message); process.exit(3); });
